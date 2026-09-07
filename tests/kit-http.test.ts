import { describe, it, expect, vi, afterEach } from "vitest";
import { bearerClient, basicClient, headerKeyClient, requireCredential } from "@/connectors/kit/http";
import { HttpError } from "@/lib/http-client";

afterEach(() => vi.unstubAllGlobals());

function stub(status = 200, body: unknown = { ok: true }, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Nope",
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

describe("provider clients", () => {
  it("bearer: joins base and path, encodes params, drops nullish params, sends the header", async () => {
    const calls = stub();
    const c = bearerClient("https://api.example.com/v2/", "tok", "example");
    await c.get("/bookings", { after: "2026-01-01", limit: 50, skip: undefined, nothing: null });
    expect(calls[0].url).toBe("https://api.example.com/v2/bookings?after=2026-01-01&limit=50");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(c.calls()).toBe(1);
  });
  it("basic and header-key clients send their credential", async () => {
    const calls = stub();
    await basicClient("https://api.example.com", "user", "pass", "example").get("x");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    await headerKeyClient("https://api.example.com", "api-key", "k1", "example").get("x");
    expect((calls[1].init.headers as Record<string, string>)["api-key"]).toBe("k1");
  });
  it("post sends JSON with a content-type", async () => {
    const calls = stub();
    await bearerClient("https://api.example.com", "t", "example").post("/webhooks", { url: "https://x" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"url":"https://x"}');
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
  it("captures the provider's rate-limit headers", async () => {
    stub(200, {}, { "x-ratelimit-limit": "120", "x-ratelimit-remaining": "7", "x-ratelimit-reset": "30" });
    const c = bearerClient("https://api.example.com", "t", "example");
    expect(c.rateLimit()).toBeNull();
    await c.get("x");
    expect(c.rateLimit()).toEqual({ limit: 120, remaining: 7, resetSeconds: 30 });
  });
  it("forwards a caller's onResponse after capturing the rate limit", async () => {
    stub(200, {}, { "resource-id": "77", "x-ratelimit-remaining": "3" });
    let seen: string | null = null;
    const c = bearerClient("https://api.example.com", "t", "example", {}, { onResponse: (res) => { seen = res.headers.get("resource-id"); } });
    await c.post("/webhooks", {});
    expect(seen).toBe("77");
    expect(c.rateLimit()?.remaining).toBe(3);
  });
  it("turns a 401 into a reconnect hint and leaves other errors as HttpError", async () => {
    stub(401, { error: "bad key" });
    await expect(bearerClient("https://api.example.com", "t", "Example").get("x")).rejects.toThrow(
      "Example rejected this credential — open the connection and reconnect.",
    );
    stub(500, {});
    await expect(bearerClient("https://api.example.com", "t", "Example", {}, { retries: 0 }).get("x")).rejects.toBeInstanceOf(HttpError);
  });
  it("requireCredential trims a present field and names the missing one", () => {
    expect(requireCredential({ apiKey: " k " }, "apiKey", "Example")).toBe("k");
    expect(() => requireCredential({}, "apiKey", "Example")).toThrow("Example: this connection has no apiKey — open it and reconnect.");
  });
});
