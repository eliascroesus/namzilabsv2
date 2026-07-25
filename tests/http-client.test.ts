import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, basicAuth, HttpError, HttpTimeoutError } from "@/lib/http-client";

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
    const err = await fetchJson("https://api.test/x", { sleep: instantSleep }).catch((e) => e);
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
    const err = await fetchJson("https://api.test/x", { retries: 2, sleep: instantSleep }).catch((e) => e);
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
    const err = await fetchJson("https://api.test/x", { method: "POST", sleep: instantSleep }).catch((e) => e);
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
    const err = await fetchJson("https://api.test/slow", { timeoutMs: 25, retries: 0 }).catch((e) => e);
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
    const p = fetchJson("https://api.test/slow", { signal: caller.signal, timeoutMs: 5_000, retries: 0, method: "POST" }).catch((e) => e);
    caller.abort();
    const err = await p;
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("AbortError");
  });
});

describe("basicAuth", () => {
  it("encodes username with empty password", () => {
    expect(basicAuth("key")).toBe(`Basic ${Buffer.from("key:").toString("base64")}`);
  });
});
