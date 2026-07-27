/**
 * Provider-facing JSON fetch used by connector poll/testFetchLatest/webhook
 * registration. Reactive rate-limit hygiene lives here (workstream F, P0):
 *
 * - every request has a timeout (AbortController) — no hung poll can wedge a sweep;
 * - transient failures retry with full-jitter exponential backoff;
 * - 429 honors the provider's Retry-After (seconds or HTTP-date) and is safe to
 *   retry for ANY method — a rate-rejected request was never processed;
 * - network errors / timeouts / 5xx retry only idempotent methods (GET/HEAD),
 *   never POST-like writes, whose effects may already have been applied;
 * - failures throw typed errors (HttpError / HttpTimeoutError) so callers and
 *   the future provider-gateway can branch on status instead of parsing strings.
 *
 * Proactive budgets (token buckets, usage ledger, circuit breaker) are the P4
 * gateway's job; this layer only reacts politely.
 */

/** Non-2xx response. Message keeps the legacy "HTTP <status> ..." format. */
export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body: string;
  /** Parsed Retry-After delay in ms, when the provider sent one. */
  readonly retryAfterMs: number | null;

  constructor(args: { status: number; statusText: string; url: string; body: string; retryAfterMs: number | null }) {
    super(`HTTP ${args.status} ${args.statusText} for ${args.url}${args.body ? `: ${args.body.slice(0, 300)}` : ""}`);
    this.name = "HttpError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.url = args.url;
    this.body = args.body;
    this.retryAfterMs = args.retryAfterMs;
  }
}

/** The request exceeded its deadline (distinct from a caller-initiated abort). */
export class HttpTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`HTTP timeout after ${timeoutMs}ms for ${url}`);
    this.name = "HttpTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export type FetchJsonOptions = RequestInit & {
  /** Per-attempt deadline. Default 30s. */
  timeoutMs?: number;
  /** Extra attempts after the first (default 2 → up to 3 tries). */
  retries?: number;
  /** Full-jitter backoff base (default 500ms; delay ∈ [0, min(cap, base·2^n)]). */
  backoffBaseMs?: number;
  /** Backoff cap per wait (default 10s). Retry-After is honored up to this ×6. */
  backoffCapMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called with each response BEFORE its body is read, on success and on
   * failure alike.
   *
   * `fetchJson` returns parsed JSON, so response headers were unreachable and
   * the only rate-limit signal anyone could act on was `Retry-After` — which
   * arrives with a 429, i.e. after the limit has already been breached.
   * Providers that publish their remaining quota on EVERY response (Close sends
   * RFC `ratelimit`) were telling us how close we were and nothing was
   * listening.
   */
  onResponse?: (res: Response) => void;
};

/**
 * What a provider says is left of its own budget, from whichever header family
 * it uses. Observed truth, as opposed to the figure declared in the catalog.
 */
export type ObservedRateLimit = { limit: number | null; remaining: number; resetSeconds: number | null };

/**
 * Parse RFC 9239-style `ratelimit: limit=…, remaining=…, reset=…` and the older
 * `X-RateLimit-*` triple. Returns null unless `remaining` is actually present —
 * a partial header is not evidence.
 */
export function parseRateLimit(headers: Headers | null | undefined): ObservedRateLimit | null {
  if (!headers?.get) return null;
  const num = (v: string | null): number | null => {
    if (v == null) return null;
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  };

  // RFC style: one header, comma-separated key=value pairs.
  const combined = headers.get("ratelimit");
  if (combined) {
    const parts = Object.fromEntries(
      combined.split(",").map((kv) => kv.split("=").map((x) => x.trim())) as Array<[string, string]>,
    );
    const remaining = num(parts["remaining"] ?? null);
    if (remaining != null) return { limit: num(parts["limit"] ?? null), remaining, resetSeconds: num(parts["reset"] ?? null) };
  }

  const remaining = num(headers.get("ratelimit-remaining") ?? headers.get("x-ratelimit-remaining"));
  if (remaining == null) return null;
  return {
    limit: num(headers.get("ratelimit-limit") ?? headers.get("x-ratelimit-limit")),
    remaining,
    resetSeconds: num(headers.get("ratelimit-reset") ?? headers.get("x-ratelimit-reset")),
  };
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

/**
 * The ceiling ONE fetchJson call may consume, including retries and backoff.
 *
 * This exists because the two budgets were inverted: the defaults were 30s
 * timeout x 3 attempts = 90s for a single provider call, inside a serverless
 * function the platform kills at 10-15s. The work was budgeted in minutes and
 * the container in seconds, so every sync-touching function died mid-flight —
 * and because the test_runs row is stamped `running` before the work starts,
 * that looked like a hang rather than an error.
 *
 * Worst case now: 2 attempts x 10s + one jittered backoff <= 10s = 30s, safely
 * inside the 60s `maxDuration` the routes declare. A provider that is slower
 * than this returns a typed HttpTimeoutError the breaker already understands
 * (recordProviderError / tripBreaker), instead of taking the whole run with it.
 *
 * If you raise maxDuration, this may rise with it — never past it.
 */
export const PROVIDER_CALL_BUDGET_MS = 30_000;

/** JSON fetch with timeout, jittered retries and Retry-After handling. */
export async function fetchJson<T = unknown>(url: string, init?: FetchJsonOptions): Promise<T> {
  const {
    timeoutMs = 10_000,
    retries = 1,
    backoffBaseMs = 500,
    backoffCapMs = 10_000,
    sleep = defaultSleep,
    onResponse,
    ...requestInit
  } = init ?? {};
  const method = (requestInit.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";

  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchWithTimeout(url, requestInit, timeoutMs);
      // Before the body: a failed response carries quota headers too, and those
      // are the most valuable ones.
      onResponse?.(res);
      if (res.ok) return (await res.json()) as T;

      const body = await res.text().catch(() => "");
      const err = new HttpError({
        status: res.status,
        statusText: res.statusText,
        url,
        body,
        retryAfterMs: parseRetryAfter(res.headers?.get?.("retry-after") ?? null),
      });
      // 429 = rejected before processing → safe to retry any method, waiting
      // out the provider's own Retry-After when it names one.
      // Retryable 5xx → idempotent methods only.
      const canRetry = err.status === 429 ? true : RETRYABLE_STATUS.has(err.status) && idempotent;
      if (!canRetry || attempt >= retries) throw err;
      const backoff = fullJitter(backoffBaseMs, backoffCapMs, attempt);
      // Honor Retry-After, but never past the per-call budget: a provider
      // asking us to wait 60s must not take the entire function down with it.
      // Exceeding it is the breaker's job (defer and retry later), not a sleep's.
      await sleep(err.retryAfterMs != null ? Math.min(err.retryAfterMs, backoffCapMs) : backoff);
      lastError = err;
      continue;
    } catch (e) {
      if (e instanceof HttpError) throw e; // decided above
      // Network failure or timeout: the request may not have reached the
      // provider — retry only when re-sending cannot double-apply.
      if (!idempotent || attempt >= retries) throw e;
      await sleep(fullJitter(backoffBaseMs, backoffCapMs, attempt));
      lastError = e;
    }
  }
  // Unreachable; loop exits only via return/throw.
  throw lastError;
}

/** Basic-auth header value for `username:` (WorkOS-style API-key-as-username). */
export function basicAuth(username: string, password = ""): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // Compose with a caller-provided signal so external aborts still work.
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (timedOut) throw new HttpTimeoutError(url, timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Full-jitter backoff: uniform in [0, min(cap, base·2^attempt)]. */
function fullJitter(baseMs: number, capMs: number, attempt: number): number {
  return Math.floor(Math.random() * Math.min(capMs, baseMs * 2 ** attempt));
}

/** Retry-After: delta-seconds or an HTTP-date; null when absent/unparseable. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
