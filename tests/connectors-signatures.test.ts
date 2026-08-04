import { describe, it, expect } from "vitest";
import { hmacSha256Hex } from "@/lib/signatures";
import { calendlyConnector } from "@/connectors/calendly";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";
import { catchHookConnector } from "@/connectors/catch-hook";

describe("Calendly signature (t=,v1= HMAC over `${t}.${body}`)", () => {
  const secret = "cal_signing_key";
  const body = JSON.stringify({ event: "invitee.created", payload: {} });
  const t = "1700000000";
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
    const open = [
      ["webhook", catchHookConnector],
      ["calendly", calendlyConnector],
      ["close", closeConnector],
      ["instantly", instantlyConnector],
      ["sendblue", sendblueConnector],
    ]
      .filter(([, c]) => (c as { verifySignature: (a: typeof unsigned) => boolean }).verifySignature(unsigned))
      .map(([name]) => name);
    expect(open).toEqual(["webhook"]);
  });

  it("and it upgrades to authenticated the moment a secret is set", () => {
    expect(catchHookConnector.verifySignature({ ...unsigned, secret: "s" })).toBe(false);
  });
});
