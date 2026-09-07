import { basicAuth, fetchJson, HttpError, parseRateLimit, type FetchJsonOptions, type ObservedRateLimit } from "@/lib/http-client";

export type Params = Record<string, string | number | boolean | null | undefined>;

export type ProviderClient = {
  get<T = unknown>(path: string, params?: Params): Promise<T>;
  post<T = unknown>(path: string, body: unknown, params?: Params): Promise<T>;
  del<T = unknown>(path: string, params?: Params): Promise<T>;
  /** The provider's own remaining-budget headers, from the last response that carried any. */
  rateLimit(): ObservedRateLimit | null;
  /** Requests made through this client — a poll reports it as `providerCalls`. */
  calls(): number;
};

export type ClientOpts = {
  baseUrl: string;
  headers: Record<string, string>;
  /** Display name used in the reconnect hint. */
  provider: string;
  reconnectHint?: string;
  /** Passed through to fetchJson; a caller's `onResponse` runs after the rate-limit capture. */
  fetchOptions?: Omit<FetchJsonOptions, "headers" | "method" | "body">;
};

export function providerClient(o: ClientOpts): ProviderClient {
  let calls = 0;
  let observed: ObservedRateLimit | null = null;
  const url = (path: string, params?: Params): string => {
    const u = /^https?:\/\//.test(path) ? new URL(path) : new URL(`${o.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) u.searchParams.set(k, String(v));
    return u.toString();
  };
  const run = async <T,>(method: string, path: string, params?: Params, body?: unknown): Promise<T> => {
    calls += 1;
    const { onResponse, ...rest } = o.fetchOptions ?? {};
    try {
      return await fetchJson<T>(url(path, params), {
        ...rest,
        method,
        headers: { ...o.headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        onResponse: (res) => {
          observed = parseRateLimit(res.headers) ?? observed;
          onResponse?.(res);
        },
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        throw new Error(o.reconnectHint ?? `${o.provider} rejected this credential — open the connection and reconnect.`);
      }
      throw e;
    }
  };
  return {
    get: (path, params) => run("GET", path, params),
    post: (path, body, params) => run("POST", path, params, body),
    del: (path, params) => run("DELETE", path, params),
    rateLimit: () => observed,
    calls: () => calls,
  };
}

export function bearerClient(baseUrl: string, token: string, provider: string, extraHeaders: Record<string, string> = {}, fetchOptions?: ClientOpts["fetchOptions"]): ProviderClient {
  return providerClient({ baseUrl, provider, headers: { authorization: `Bearer ${token}`, ...extraHeaders }, fetchOptions });
}
export function basicClient(baseUrl: string, username: string, password: string, provider: string, extraHeaders: Record<string, string> = {}, fetchOptions?: ClientOpts["fetchOptions"]): ProviderClient {
  return providerClient({ baseUrl, provider, headers: { authorization: basicAuth(username, password), ...extraHeaders }, fetchOptions });
}
export function headerKeyClient(baseUrl: string, header: string, key: string, provider: string, extraHeaders: Record<string, string> = {}, fetchOptions?: ClientOpts["fetchOptions"]): ProviderClient {
  return providerClient({ baseUrl, provider, headers: { [header]: key, ...extraHeaders }, fetchOptions });
}

/** A credential field that must be present — the message names the field and the fix. */
export function requireCredential(credentials: Record<string, unknown> | null | undefined, field: string, provider: string): string {
  const v = credentials?.[field];
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new Error(`${provider}: this connection has no ${field} — open it and reconnect.`);
}
