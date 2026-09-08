import { describe, it, expect } from "vitest";
import { parseWebhookBody, challengeFrom } from "@/lib/webhooks/parse-body";

const q = (s: string) => new URLSearchParams(s);

describe("the catch-hook understands what senders actually post", () => {
  it("parses JSON, and parses it even when the sender lies about the content type", () => {
    const body = '{"email":"a@b.io","amount":10}';
    expect(parseWebhookBody(body, "application/json")).toEqual({ kind: "json", payload: { email: "a@b.io", amount: 10 } });
    // text/plain, and no header at all — both extremely common in the wild.
    expect(parseWebhookBody(body, "text/plain").payload).toEqual({ email: "a@b.io", amount: 10 });
    expect(parseWebhookBody(body, null).payload).toEqual({ email: "a@b.io", amount: 10 });
    expect(parseWebhookBody(body, "application/vnd.acme+json").payload).toEqual({ email: "a@b.io", amount: 10 });
  });

  it("parses a form-encoded body into readable fields instead of one opaque string", () => {
    const r = parseWebhookBody("email=a%40b.io&amount=10", "application/x-www-form-urlencoded; charset=utf-8");
    expect(r.kind).toBe("form");
    expect(r.payload).toEqual({ email: "a@b.io", amount: "10" });
  });

  it("a repeated form key is a list, not a last-one-wins overwrite", () => {
    expect(parseWebhookBody("tag=a&tag=b&name=x", "application/x-www-form-urlencoded").payload).toEqual({ tag: ["a", "b"], name: "x" });
  });

  it("merges the query string into the payload, and the body always wins a collision", () => {
    const r = parseWebhookBody('{"source":"body","email":"a@b.io"}', "application/json", q("source=query&tenant=acme"));
    expect(r.payload).toEqual({ source: "body", email: "a@b.io", tenant: "acme" });
  });

  it("an array payload keeps its items pure — no query fields injected into rows", () => {
    const r = parseWebhookBody('[{"id":1},{"id":2}]', "application/json", q("tenant=acme"));
    expect(r.payload).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("an empty body is not an error: a query-only delivery is a real shape, and a bare ping is empty", () => {
    expect(parseWebhookBody("", null, q("email=a@b.io"))).toEqual({ kind: "empty", payload: { email: "a@b.io" } });
    expect(parseWebhookBody("", null)).toEqual({ kind: "empty", payload: {} });
    expect(parseWebhookBody("   ", "application/json").kind).toBe("empty");
  });

  it("keeps anything it cannot parse, verbatim, with the content type that came with it", () => {
    const xml = "<order><id>7</id></order>";
    expect(parseWebhookBody(xml, "application/xml")).toEqual({ kind: "raw", payload: { _raw: xml, _contentType: "application/xml" } });
    // Malformed JSON is kept rather than guessed at.
    const broken = '{"a":1,';
    expect(parseWebhookBody(broken, "application/json")).toEqual({ kind: "raw", payload: { _raw: broken, _contentType: "application/json" } });
  });

  it("a prose body with an equals sign is not mistaken for a form", () => {
    const prose = "the total = 10 dollars";
    expect(parseWebhookBody(prose, null).kind).toBe("raw");
  });
});

describe("the verification handshake", () => {
  it("echoes the challenge parameter the platform sent", () => {
    expect(challengeFrom(q("hub.mode=subscribe&hub.challenge=abc123"))).toBe("abc123");
    expect(challengeFrom(q("challenge=xyz"))).toBe("xyz");
    expect(challengeFrom(q("crc_token=tok"))).toBe("tok");
    expect(challengeFrom(q("validationToken=vt"))).toBe("vt");
  });
  it("is null when there is nothing to echo, which is a plain liveness check", () => {
    expect(challengeFrom(q(""))).toBeNull();
    expect(challengeFrom(q("foo=bar"))).toBeNull();
  });
});
