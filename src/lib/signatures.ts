import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Hex HMAC-SHA256 of `message` keyed by the **UTF-8 bytes of `secret`**.
 *
 * That last part is load-bearing and is not a detail callers may skip past. It
 * is correct for every secret this codebase mints itself (`whsec_<base64url>`,
 * used as UTF-8 on both sides by construction) and WRONG for any provider that
 * hands out a hex-encoded key, where the bytes the hex spells are the key. Close
 * is such a provider, and passing its key here rejected 100% of its deliveries
 * until it was caught — see `closeSigningKey` in `connectors/close.ts`.
 *
 * Before using this for a new inbound signature, read the provider's own
 * verification example and check what it does to the key before hashing.
 */
export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** Constant-time string comparison; false on length mismatch (never throws). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Replay-protection window for signed webhook timestamps: 5 minutes, either
 * direction. This is Stripe's library default (300s) and the widest number in
 * common use — Calendly's own verification example uses 3 minutes — chosen
 * over a tighter one because the cost of too-wide is a replay window measured
 * in minutes against an idempotent consumer (`event_id` dedup makes a replayed
 * delivery a no-op), while the cost of too-tight is rejecting real deliveries
 * from a provider whose clock, or ours, has drifted.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

/**
 * Is a signed webhook timestamp within the replay window?
 *
 * Three answers, not two, and the third is the design decision:
 *  - "fresh"       — parsed, and within ±tolerance of now.
 *  - "stale"       — parsed, and outside it. The caller must reject: the
 *                    signature proves the provider sent this ONCE, not that
 *                    whoever is sending it now is the provider.
 *  - "unparseable" — a format this parser does not recognize. The caller
 *                    should ACCEPT (and may log): the HMAC is computed over
 *                    the timestamp string and the body together, so
 *                    authenticity is already proven — only the replay window
 *                    is lost. Rejecting on an unrecognized format would be the
 *                    hex-key incident again: an assumption about a provider's
 *                    encoding silently rejecting 100% of real deliveries.
 *                    Close's timestamp format is documented nowhere we can
 *                    reach (the docs are bot-walled), which is exactly the
 *                    situation this branch exists for.
 *
 * Accepts unix seconds, unix milliseconds (magnitude-discriminated: values
 * above 1e12 are milliseconds until the year 33658), and ISO-8601 date
 * strings. Future timestamps are held to the same window — clock skew runs in
 * both directions, and a timestamp far in the future is as suspect as one far
 * in the past.
 */
export function timestampFreshness(
  raw: string | null | undefined,
  toleranceMs: number = WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  nowMs: number = Date.now(),
): "fresh" | "stale" | "unparseable" {
  if (!raw) return "unparseable";
  const trimmed = raw.trim();
  let ms: number | null = null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) ms = n > 1e12 ? n : n * 1000;
  } else {
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) ms = parsed;
  }
  if (ms == null) return "unparseable";
  return Math.abs(nowMs - ms) <= toleranceMs ? "fresh" : "stale";
}
