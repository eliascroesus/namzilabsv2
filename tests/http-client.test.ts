import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, basicAuth, HttpError, HttpTimeoutError, parseRateLimit } from "@/lib/http-client";

/** Build a minimal Response-like object. */
function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 429 ? "Too Many Requests" : "Error",
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** fetch mock that serves a scripted sequence of results (last one repeats). */
function scriptedFetch(script: Array<Response | Error>) {
  let i = 0;
  return vi.fn(async () => {
    const step = script[Math.min(i++, script.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  });
}

const instantSleep = vi.fn(async () => {});

afterEach(() => {
  vi.unstubAllGlobals();
  instantSleep.mockClear();
});

describe("fetchJson — success & plain failures", () => {
  it("returns parsed JSON on 200", async () => {
    vi.stubGlobal("fetch", scriptedFetch([res(200, { hello: "world" })]));
    await expect(fetchJson("https://api.test/x")).resolves.toEqual({ hello: "world" });
  });

  it("throws a typed HttpError (legacy message format) on non-retryable 4xx, without retrying", async () => {
    const fetchMock = scriptedFetch([res(403, { error: "nope" })]);
    vi.stubGlobal("fetch", fetchMock);
    const err = await fetchJson<never>("https://api.test/x", { sleep: instantSleep }).catch((e) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("HTTP 403");
    expect(err.message).toContain("https://api.test/x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJson — 429 rate limiting", () => {
  it("retries any method on 429 and honors Retry-After seconds", async () => {
    const fetchMock = scriptedFetch([res(429, {}, { "Retry-After": "7" }), res(200, { ok: 1 })]);
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchJson("https://api.test/x", { method: "POST", sleep: instantSleep });
    expect(out).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(instantSleep).toHaveBeenCalledWith(7000);
  });

  it("throws HttpError with retryAfterMs once retries are exhausted", async () => {
    const fetchMock = scriptedFetch([res(429, {}, { "Retry-After": "1" })]);
    vi.stubGlobal("fetch", fetchMock);
    const err = await fetchJson<never>("https://api.test/x", { retries: 2, sleep: instantSleep }).catch((e) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });
});

describe("fetchJson — 5xx & network errors respect idempotency", () => {
  it("retries GET on 500 with backoff and succeeds", async () => {
    const fetchMock = scriptedFetch([res(500, {}), res(200, { ok: 1 })]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://api.test/x", { sleep: instantSleep })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(instantSleep).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry POST on 500 (the write may have been applied)", async () => {
    const fetchMock = scriptedFetch([res(500, {}), res(200, { ok: 1 })]);
    vi.stubGlobal("fetch", fetchMock);
    const err = await fetchJson<never>("https://api.test/x", { method: "POST", sleep: instantSleep }).catch((e) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries GET on a network error, then surfaces the error when persistent", async () => {
    const boom = new TypeError("fetch failed");
    const fetchMock = scriptedFetch([boom, boom, boom]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://api.test/x", { retries: 2, sleep: instantSleep })).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry POST on a network error", async () => {
    const boom = new TypeError("fetch failed");
    const fetchMock = scriptedFetch([boom]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://api.test/x", { method: "POST", sleep: instantSleep })).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJson — timeout", () => {
  it("aborts a hung request and throws HttpTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    const err = await fetchJson<never>("https://api.test/slow", { timeoutMs: 25, retries: 0 }).catch((e) => e as HttpTimeoutError);
    expect(err).toBeInstanceOf(HttpTimeoutError);
    expect(err.timeoutMs).toBe(25);
  });

  it("a caller-initiated abort is NOT converted into a timeout", async () => {
    const caller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    const p = fetchJson<never>("https://api.test/slow", { signal: caller.signal, timeoutMs: 5_000, retries: 0, method: "POST" }).catch((e) => e as DOMException);
    caller.abort();
    const err = await p;
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("AbortError");
  });
});

/**
 * A 204 (No Content) has no body, and `res.json()` on an empty body throws —
 * so a successful DELETE (Calendly's webhook teardown, C23) was read as a
 * failure purely because of how the response was parsed, never because
 * anything actually went wrong.
 */
describe("fetchJson — 204 No Content", () => {
  it("returns undefined on 204 without calling res.json()", async () => {
    const jsonSpy = vi.fn(async () => {
      throw new Error("res.json() must not be called on a 204 — there is no body to parse");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 204,
            statusText: "No Content",
            headers: { get: () => null },
            json: jsonSpy,
            text: async () => "",
          }) as unknown as Response,
      ),
    );

    await expect(fetchJson("https://api.test/x", { method: "DELETE" })).resolves.toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });
});

describe("basicAuth", () => {
  it("encodes username with empty password", () => {
    expect(basicAuth("key")).toBe(`Basic ${Buffer.from("key:").toString("base64")}`);
  });
});

/**
 * `fetchJson` returns parsed JSON, so response headers were unreachable and the
 * only rate-limit signal anyone could act on was `Retry-After` — which arrives
 * with a 429, i.e. after the limit has already been breached. Providers that
 * publish remaining quota on every response were telling us how close we were
 * and nothing was listening.
 */
describe("rate-limit headers", () => {
  const h = (map: Record<string, string>): Headers =>
    ({ get: (k: string) => map[k.toLowerCase()] ?? null }) as unknown as Headers;

  it("parses the RFC single-header form", () => {
    expect(parseRateLimit(h({ ratelimit: "limit=100, remaining=37, reset=42" }))).toEqual({
      limit: 100,
      remaining: 37,
      resetSeconds: 42,
    });
  });

  it("parses the older X-RateLimit triple", () => {
    expect(parseRateLimit(h({ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "12" }))).toEqual({
      limit: 60,
      remaining: 0,
      resetSeconds: 12,
    });
  });

  it("returns null without a remaining count — a partial header is not evidence", () => {
    expect(parseRateLimit(h({ ratelimit: "limit=100" }))).toBeNull();
    expect(parseRateLimit(h({}))).toBeNull();
    expect(parseRateLimit(null)).toBeNull();
  });

  it("hands the response to onResponse before the body is read, on success AND failure", async () => {
    const seen: Array<number> = [];
    const res = (status: number) => ({
      ok: status < 400,
      status,
      statusText: "x",
      headers: h({ ratelimit: "remaining=5" }),
      json: async () => ({ ok: true }),
      text: async () => "{}",
    }) as unknown as Response;

    vi.stubGlobal("fetch", vi.fn(async () => res(200)));
    await fetchJson("https://x.test/a", { onResponse: (r) => seen.push(r.status) });

    vi.stubGlobal("fetch", vi.fn(async () => res(429)));
    await fetchJson("https://x.test/b", { retries: 0, onResponse: (r) => seen.push(r.status), sleep: async () => {} }).catch(() => {});

    // The 429 is the one whose headers matter most.
    expect(seen).toEqual([200, 429]);
  });
});
