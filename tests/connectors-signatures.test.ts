import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { hmacSha256Hex } from "@/lib/signatures";
import { calendlyConnector } from "@/connectors/calendly";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";
import { catchHookConnector } from "@/connectors/catch-hook";
import { googleSheetsConnector } from "@/connectors/google-sheets";
import { googleCalendarConnector } from "@/connectors/google-calendar";

describe("Calendly signature (t=,v1= HMAC over `${t}.${body}`)", () => {
  const secret = "cal_signing_key";
  const body = JSON.stringify({ event: "invitee.created", payload: {} });
  // Fresh, because `t` now doubles as replay protection: a fixture pinned to a
  // past date would be correctly rejected as a replay.
  const t = String(Math.floor(Date.now() / 1000));
  const sig = hmacSha256Hex(secret, `${t}.${body}`);

  it("accepts a valid signature", () => {
    const headers = { "calendly-webhook-signature": `t=${t},v1=${sig}` };
    expect(calendlyConnector.verifySignature({ rawBody: body, headers, secret })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const headers = { "calendly-webhook-signature": `t=${t},v1=${sig}` };
    expect(calendlyConnector.verifySignature({ rawBody: body + "x", headers, secret })).toBe(false);
  });
  it("rejects when no secret is configured", () => {
    const headers = { "calendly-webhook-signature": `t=${t},v1=${sig}` };
    expect(calendlyConnector.verifySignature({ rawBody: body, headers, secret: null })).toBe(false);
  });
});

/**
 * CLOSE'S KEY IS HEX, AND THIS VECTOR IS FROZEN SO IT CANNOT DRIFT BACK.
 *
 * Close's `signature_key` is a 64-character hex string whose 32 BYTES are the
 * HMAC key; its documented verification is
 * `hmac.new(bytearray.fromhex(key), (timestamp + data).encode(), sha256)`. The
 * connector stored the key verbatim and hashed with the shared `hmacSha256Hex`,
 * which keys on a string's UTF-8 bytes — so the key in use was the 64 ASCII
 * characters rather than the 32 bytes they spell, and every Close delivery was
 * rejected from the day the connector shipped.
 *
 * The expected digest below is a LITERAL, not a value recomputed by the code
 * under test — computing it with the same helper the connector uses would assert
 * only that a function equals itself. It was produced by Close's documented
 * Python algorithm (`hmac`/`bytearray.fromhex`), so this is a cross-
 * implementation vector, and `WRONG_UTF8_KEY_HASH` is what the bug produced for
 * the same triple. Nothing but a byte-correct implementation satisfies both.
 */
describe("Close signature (close-sig-hash HMAC over timestamp+body)", () => {
  /** A key in Close's shape: 64 hex characters = 32 bytes. */
  const secret = "4f7a2c1e9b0d8365a4e7f10c2b93d65847ae091f3c2d5b8e6017a4c9d2f3b5e8";
  const timestamp = "1700000000";
  /**
   * The digest literals below are a CROSS-IMPLEMENTATION vector computed for
   * exactly this timestamp, so the timestamp cannot move to stay fresh —
   * instead the clock moves to the timestamp. Replay staleness gets its own
   * test at real distance below.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000 + 30_000));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const body = '{"event":{"id":"ev_5Xx1kZ9qLm","object_type":"lead","action":"created"}}';
  /** HMAC-SHA256(fromhex(secret), timestamp + body) — the correct signature. */
  const hash = "718cf3ea81b048dc8a8cd49ff6bb5dca6a9e3d81bc0985dbd5f4041c129b9a9f";
  /** What the connector computed for two years: the hex STRING used as the key. */
  const WRONG_UTF8_KEY_HASH = "1391572739943b250a816b10e5374decf3d8f35d52950dd8355c208cdfe09b51";

  it("accepts the signature Close actually sends, keyed by the decoded bytes", () => {
    const headers = { "close-sig-hash": hash, "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(true);
  });

  /**
   * The regression guard proper. Reverting to `hmacSha256Hex(secret, …)` makes
   * the case above fail AND this one — a change that flips the key encoding
   * cannot pass by accident, because it has to produce a digest that is
   * simultaneously right and not the known-wrong one.
   */
  it("rejects the digest produced by keying on the hex string itself", () => {
    const headers = { "close-sig-hash": WRONG_UTF8_KEY_HASH, "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(false);
    // And the two really are different HMACs, not two names for one value.
    expect(hmacSha256Hex(secret, `${timestamp}${body}`)).toBe(WRONG_UTF8_KEY_HASH);
    expect(WRONG_UTF8_KEY_HASH).not.toBe(hash);
  });

  it("rejects a tampered body", () => {
    const headers = { "close-sig-hash": hash, "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: `${body} `, headers, secret })).toBe(false);
  });

  it("rejects a replayed body under a different timestamp", () => {
    const headers = { "close-sig-hash": hash, "close-sig-timestamp": "1700000001" };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(false);
  });

  it("rejects a wrong hash", () => {
    const headers = { "close-sig-hash": "deadbeef", "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(false);
  });

  /**
   * `Buffer.from(s, "hex")` truncates at the first non-hex character rather than
   * throwing, so an unchecked decode of a `whsec_…` secret yields an EMPTY key
   * and an HMAC that authenticates nothing. A key that is not clean hex is
   * refused, which surfaces as a recorded rejection instead of a silent accept.
   */
  it("refuses a secret that is not clean hex rather than coercing it", () => {
    for (const bad of ["whsec_AbCdEf0123456789", "4f7a2c1e9b0d836", "4f7a2c1e9b0d836g"]) {
      const headers = {
        "close-sig-hash": hmacSha256Hex(bad, `${timestamp}${body}`),
        "close-sig-timestamp": timestamp,
      };
      expect(closeConnector.verifySignature({ rawBody: body, headers, secret: bad })).toBe(false);
    }
  });

  /**
   * REPLAY PROTECTION. The timestamp is inside the signed message, so a valid
   * HMAC over a stale timestamp proves only that Close sent this ONCE — not
   * that whoever is re-sending it now is Close. A captured delivery used to
   * verify forever.
   */
  it("rejects a genuinely signed delivery replayed outside the tolerance window", () => {
    // Same authentic vector — but the clock is now an hour past the signature.
    vi.setSystemTime(new Date(1_700_000_000_000 + 60 * 60_000));
    const headers = { "close-sig-hash": hash, "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(false);
  });

  /**
   * An UNRECOGNIZED timestamp format must not reject: the HMAC covers the
   * timestamp string and body together, so authenticity is already proven, and
   * Close's timestamp format is documented nowhere reachable. Rejecting on a
   * format assumption is exactly how the hex-key bug silently refused 100% of
   * deliveries — only the replay window is lost here, never the delivery.
   */
  it("accepts an authentic delivery whose timestamp format we do not recognize", () => {
    const weird = "not-a-timestamp-format-we-know";
    const key = Buffer.from(secret, "hex");
    const h = createHmac("sha256", key).update(`${weird}${body}`, "utf8").digest("hex");
    const headers = { "close-sig-hash": h, "close-sig-timestamp": weird };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(true);
  });
});

describe("Calendly replay protection (t inside the signed payload)", () => {
  const secret = "cal_secret";
  const body = JSON.stringify({ event: "invitee.created" });
  const signedAt = (unixSeconds: number) => {
    const v1 = hmacSha256Hex(secret, `${unixSeconds}.${body}`);
    return { "calendly-webhook-signature": `t=${unixSeconds},v1=${v1}` };
  };

  it("accepts a fresh, authentic delivery", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(calendlyConnector.verifySignature({ rawBody: body, headers: signedAt(now), secret })).toBe(true);
  });

  it("rejects an authentic delivery replayed outside the tolerance window", () => {
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(calendlyConnector.verifySignature({ rawBody: body, headers: signedAt(hourAgo), secret })).toBe(false);
  });
});

describe("Instantly optional HMAC signature", () => {
  const secret = "inst_secret";
  const body = JSON.stringify({ event_type: "reply_received" });
  it("accepts a valid x-instantly-signature", () => {
    const headers = { "x-instantly-signature": hmacSha256Hex(secret, body) };
    expect(instantlyConnector.verifySignature({ rawBody: body, headers, secret })).toBe(true);
  });
  it("REJECTS when no secret is configured — rows it would write are permanent", () => {
    expect(instantlyConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(false);
  });
  it("rejects a bad signature when a secret is set", () => {
    expect(instantlyConnector.verifySignature({ rawBody: body, headers: { "x-instantly-signature": "nope" }, secret })).toBe(
      false,
    );
  });
});

describe("Sendblue secret-in-header verification", () => {
  const secret = "sb_secret";
  it("accepts when a candidate header carries the secret", () => {
    expect(sendblueConnector.verifySignature({ rawBody: "{}", headers: { "sb-signing-secret": secret }, secret })).toBe(
      true,
    );
  });
  it("rejects when the header value does not match", () => {
    expect(
      sendblueConnector.verifySignature({ rawBody: "{}", headers: { "sb-signing-secret": "wrong" }, secret }),
    ).toBe(false);
  });
  it("REJECTS when no secret is configured", () => {
    expect(sendblueConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(false);
  });
});

/**
 * Fail-open is only tolerable where an injected row is removable, and here it
 * is not: webhook rows land at generation 0 with a null stream_hash, and every
 * soft-delete site in the codebase skips that class by construction so the
 * append-only guarantee holds. An unauthenticated POST is therefore permanent.
 *
 * `createConnection` mints a secret for every `instant` source, so a missing
 * one means something went wrong — not that verification is optional.
 */
describe("which connectors may accept an unsigned request", () => {
  const unsigned = { rawBody: "{}", headers: {}, secret: null };

  it("only the catch-hook, whose open endpoint IS the product", () => {
    /**
     * EVERY connector belongs in this list — gsheets was missing from it, and
     * that omission is exactly how its fail-open shipped: the route verifies
     * BEFORE the stream-scoped doorbell bail, gsheets never gets a secret
     * (`instant: false`), and `if (!secret) return true` made any anonymous
     * POST an unauthenticated "poll this connection now" against the org's —
     * and the fleet's shared — Google quota. A contract test that samples the
     * population cannot catch the member it skipped.
     */
    const open = [
      ["webhook", catchHookConnector],
      ["calendly", calendlyConnector],
      ["close", closeConnector],
      ["instantly", instantlyConnector],
      ["sendblue", sendblueConnector],
      ["gsheets", googleSheetsConnector],
      ["gcal", googleCalendarConnector],
    ]
      .filter(([, c]) => (c as { verifySignature: (a: typeof unsigned) => boolean }).verifySignature(unsigned))
      .map(([name]) => name);
    expect(open).toEqual(["webhook"]);
  });

  it("and it upgrades to authenticated the moment a secret is set", () => {
    expect(catchHookConnector.verifySignature({ ...unsigned, secret: "s" })).toBe(false);
  });
});
