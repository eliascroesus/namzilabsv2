import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  standardWebhooksVerify,
  timestampedHmacVerify,
  hmacHeaderVerify,
  sharedTokenVerify,
} from "@/connectors/kit/verify";

const BODY = '{"id":"evt_1","type":"payment.succeeded"}';
const nowSec = () => Math.floor(Date.now() / 1000);
const hmac = (key: string | Buffer, msg: string, enc: "hex" | "base64" = "hex") =>
  createHmac("sha256", key).update(msg, "utf8").digest(enc);

describe("standardWebhooksVerify (webhook-id.webhook-timestamp.body, v1 base64)", () => {
  const raw = Buffer.from("a-32-byte-secret-for-the-tests-!").toString("base64");
  const secret = `whsec_${raw}`;
  const headersFor = (sig: string, ts = String(nowSec())) => ({ "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": sig });
  const sign = (ts: string) => `v1,${hmac(Buffer.from(raw, "base64"), `msg_1.${ts}.${BODY}`, "base64")}`;

  it("accepts a fresh, correctly signed delivery — and one of several v1 entries", () => {
    const ts = String(nowSec());
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sign(ts), ts), secret })).toBe(true);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(`v1,AAAA ${sign(ts)}`, ts), secret })).toBe(true);
  });
  it("accepts the secret without its whsec_ prefix and a literal (undecoded) secret", () => {
    const ts = String(nowSec());
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sign(ts), ts), secret: raw })).toBe(true);
    const literal = "plain-literal-secret";
    const sig = `v1,${hmac(literal, `msg_1.${ts}.${BODY}`, "base64")}`;
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sig, ts), secret: literal })).toBe(true);
  });
  it("fails closed: no secret, missing headers, wrong secret, tampered body, stale timestamp", () => {
    const ts = String(nowSec());
    const h = headersFor(sign(ts), ts);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: h, secret: null })).toBe(false);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: { "webhook-id": "msg_1" }, secret })).toBe(false);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: h, secret: "whsec_d3Jvbmc=" })).toBe(false);
    expect(standardWebhooksVerify({ rawBody: BODY + " ", headers: h, secret })).toBe(false);
    const old = String(nowSec() - 3600);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sign(old), old), secret })).toBe(false);
  });
});

describe("timestampedHmacVerify (t=…,v1=… style)", () => {
  const secret = "whsec_test";
  const opts = {
    header: "stripe-signature",
    timestampKey: "t",
    signatureKey: "v1",
    message: (t: string, body: string) => `${t}.${body}`,
  } as const;
  it("accepts a fresh signature, including when two v1 values are present", () => {
    const t = String(nowSec());
    const v1 = hmac(secret, `${t}.${BODY}`);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=${t},v1=${v1}` }, secret }, opts)).toBe(true);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=${t},v1=deadbeef,v1=${v1}` }, secret }, opts)).toBe(true);
  });
  it("supports another separator, base64, and a custom message (Paddle ts;h1, OnceHub t=,s=)", () => {
    const t = String(nowSec());
    const h1 = hmac(secret, `${t}:${BODY}`);
    expect(
      timestampedHmacVerify(
        { rawBody: BODY, headers: { "paddle-signature": `ts=${t};h1=${h1}` }, secret },
        { header: "paddle-signature", pairSeparator: ";", timestampKey: "ts", signatureKey: "h1", message: (ts, b) => `${ts}:${b}` },
      ),
    ).toBe(true);
    const s = hmac(secret, `${t}.${BODY}`, "base64");
    expect(
      timestampedHmacVerify(
        { rawBody: BODY, headers: { "oncehub-signature": `t=${t},s=${s}` }, secret },
        { header: "oncehub-signature", timestampKey: "t", signatureKey: "s", encoding: "base64", message: (ts, b) => `${ts}.${b}` },
      ),
    ).toBe(true);
  });
  it("fails closed: no secret, no header, wrong secret, stale, unparseable timestamp", () => {
    const t = String(nowSec());
    const v1 = hmac(secret, `${t}.${BODY}`);
    const headers = { "stripe-signature": `t=${t},v1=${v1}` };
    expect(timestampedHmacVerify({ rawBody: BODY, headers, secret: null }, opts)).toBe(false);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: {}, secret }, opts)).toBe(false);
    expect(timestampedHmacVerify({ rawBody: BODY, headers, secret: "other" }, opts)).toBe(false);
    const old = String(nowSec() - 3600);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=${old},v1=${hmac(secret, `${old}.${BODY}`)}` }, secret }, opts)).toBe(false);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=soon,v1=${hmac(secret, `soon.${BODY}`)}` }, secret }, opts)).toBe(false);
  });
});

describe("hmacHeaderVerify (one header over the raw body)", () => {
  const secret = "s3cret";
  it("hex, base64, and a sha256= prefix", () => {
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { "x-cal-signature-256": hmac(secret, BODY) }, secret }, { header: "x-cal-signature-256", encoding: "hex" })).toBe(true);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { "typeform-signature": `sha256=${hmac(secret, BODY, "base64")}` }, secret }, { header: "typeform-signature", encoding: "base64", prefix: "sha256=" })).toBe(true);
  });
  it("fails closed", () => {
    const sig = hmac(secret, BODY);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { h: sig }, secret: null }, { header: "h", encoding: "hex" })).toBe(false);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: {}, secret }, { header: "h", encoding: "hex" })).toBe(false);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { h: sig }, secret: "nope" }, { header: "h", encoding: "hex" })).toBe(false);
    expect(hmacHeaderVerify({ rawBody: BODY + "x", headers: { h: sig }, secret }, { header: "h", encoding: "hex" })).toBe(false);
  });
});

describe("sharedTokenVerify (a bare token, constant-time)", () => {
  it("matches a header or a caller-extracted token, and fails closed", () => {
    expect(sharedTokenVerify({ rawBody: BODY, headers: { "x-token": "abc" }, secret: "abc" }, { header: "x-token" })).toBe(true);
    expect(sharedTokenVerify({ rawBody: BODY, headers: {}, secret: "abc" }, { token: "abc" })).toBe(true);
    expect(sharedTokenVerify({ rawBody: BODY, headers: { "x-token": "abc" }, secret: null }, { header: "x-token" })).toBe(false);
    expect(sharedTokenVerify({ rawBody: BODY, headers: {}, secret: "abc" }, { header: "x-token" })).toBe(false);
    expect(sharedTokenVerify({ rawBody: BODY, headers: { "x-token": "abd" }, secret: "abc" }, { header: "x-token" })).toBe(false);
  });
});
