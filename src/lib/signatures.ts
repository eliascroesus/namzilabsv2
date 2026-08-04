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
