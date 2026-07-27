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

describe("Close signature (close-sig-hash HMAC over timestamp+body)", () => {
  const secret = "close_sig_key";
  const body = JSON.stringify({ event: { id: "ev_1", object_type: "lead", action: "created" } });
  const timestamp = "1700000000";
  const hash = hmacSha256Hex(secret, `${timestamp}${body}`);

  it("accepts a valid signature", () => {
    const headers = { "close-sig-hash": hash, "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(true);
  });
  it("rejects a wrong hash", () => {
    const headers = { "close-sig-hash": "deadbeef", "close-sig-timestamp": timestamp };
    expect(closeConnector.verifySignature({ rawBody: body, headers, secret })).toBe(false);
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
