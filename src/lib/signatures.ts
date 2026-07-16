import { createHmac, timingSafeEqual } from "node:crypto";

/** Hex HMAC-SHA256 of `message` keyed by `secret`. */
export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** Base64 HMAC-SHA256 (some providers, e.g. certain Google flows, use base64). */
export function hmacSha256Base64(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("base64");
}

/** Constant-time string comparison; false on length mismatch (never throws). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
