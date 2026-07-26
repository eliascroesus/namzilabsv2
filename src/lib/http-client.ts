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
};

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

/** JSON fetch with timeout, jittered retries and Retry-After handling. */
export async function fetchJson<T = unknown>(url: string, init?: FetchJsonOptions): Promise<T> {
  const {
    timeoutMs = 30_000,
    retries = 2,
    backoffBaseMs = 500,
    backoffCapMs = 10_000,
    sleep = defaultSleep,
    ...requestInit
  } = init ?? {};
  const method = (requestInit.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";

  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchWithTimeout(url, requestInit, timeoutMs);
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
      await sleep(err.retryAfterMs != null ? Math.min(err.retryAfterMs, backoffCapMs * 6) : backoff);
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
