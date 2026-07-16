import { describe, it, expect } from "vitest";
import { hmacSha256Hex } from "@/lib/signatures";
import { calendlyConnector } from "@/connectors/calendly";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";

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
  it("accepts everything when no secret is configured", () => {
    expect(instantlyConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(true);
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
  it("accepts when no secret is configured", () => {
    expect(sendblueConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(true);
  });
});
