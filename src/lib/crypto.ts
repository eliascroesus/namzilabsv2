import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;

/**
 * AES-256-GCM authenticated encryption. Output layout: base64(iv | tag | ciphertext).
 * Used for all stored third-party credentials, tokens and signing secrets.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Load the 32-byte key from env, accepting either hex (64 chars) or base64. */
export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (use `openssl rand -base64 32`)");
  }
  return key;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KEY ROTATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE GAP THIS CLOSES, which the Sep 2026 audit listed and did not fix: there
 * was exactly one key, used for every stored credential and every webhook
 * signing secret, and no way to change it. So if `ENCRYPTION_KEY` were ever
 * suspected compromised — a leaked env dump, a departing contractor, a
 * mis-scoped log — the only available responses were to do nothing, or to
 * change the variable and instantly break every connection in the product.
 * "We cannot rotate our data-encryption key" is a bad sentence to say to a
 * customer and a worse one to discover in the middle of an incident.
 *
 * It is not hypothetical either. The webhook route already documents a ROTATED
 * `ENCRYPTION_KEY` as one of the two causes of an unreadable signing secret,
 * and the exposure that caused — fail-open connectors reading a failed decrypt
 * as "unauthenticated is fine" — is written up at that call site. What follows
 * is what makes rotation a controlled operation instead of that.
 *
 * ═══ HOW A ROTATION GOES ═══
 *
 *   1. Set `ENCRYPTION_KEY` to the NEW key and `ENCRYPTION_KEY_PREVIOUS` to
 *      the old one. Deploy. Nothing breaks: new writes take the new key, and
 *      `decryptStored` falls back to the old one for everything already
 *      stored.
 *   2. Run `pnpm rotate:key` — it re-encrypts every ciphertext under the new
 *      key, one connection at a time, and reports what it did.
 *   3. Remove `ENCRYPTION_KEY_PREVIOUS`. Deploy. The old key is now inert and
 *      can be destroyed.
 *
 * Step 3 is the one that must actually happen: two live keys is a strictly
 * weaker position than one, so that window is meant to be hours rather than a
 * quarter. `decryptStored` logs whenever it falls back, precisely so an
 * unfinished rotation is noisy instead of comfortable.
 *
 * ═══ WHY THE FALLBACK IS SAFE ═══
 *
 * AES-GCM is AUTHENTICATED. A wrong key does not produce garbage plaintext, it
 * fails the authentication tag and throws — so "try the new key, then the old"
 * cannot silently return the wrong answer. That property is what this design
 * leans on, and it is why the same trick would be unsafe under an
 * unauthenticated mode like CBC.
 */

/** The outgoing key, while a rotation is in progress. `null` normally. */
function previousEncryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (!raw) return null;
  const key = raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    // Loud, and NOT fatal: a malformed outgoing key must not take down reads
    // that the current key can satisfy perfectly well.
    console.error("[crypto] ENCRYPTION_KEY_PREVIOUS is set but does not decode to 32 bytes — ignoring it");
    return null;
  }
  return key;
}

/** So an unfinished rotation is reported once per process, not once per read. */
let warnedAboutFallback = false;

/**
 * Decrypt something this application stored, under whichever key encrypted it.
 *
 * THE ONLY DECRYPT PATH THE APPLICATION SHOULD USE. `decrypt` stays exported
 * for the rotation script, which has to name both keys explicitly, and for the
 * tests; everything that reads a credential or a signing secret comes through
 * here, so a rotation is a deployment concern and never a code change.
 *
 * THROWS IF BOTH KEYS FAIL, and every caller's behaviour on a throw is already
 * correct and already deliberate: the webhook route fails the delivery CLOSED
 * (see that call site — a configured-but-unreadable secret must never read as
 * "no secret configured"), and `decryptCredentials` returns `{}` so a
 * connection surfaces as broken rather than as empty. Do not add a fallback
 * return value here; it would quietly undo both.
 */
export function decryptStored(payload: string): string {
  try {
    return decrypt(payload, getEncryptionKey());
  } catch (err) {
    const previous = previousEncryptionKey();
    if (!previous) throw err;
    const plaintext = decrypt(payload, previous);
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        "[crypto] decrypted with ENCRYPTION_KEY_PREVIOUS — key rotation is UNFINISHED. " +
          "Run `pnpm rotate:key`, then remove ENCRYPTION_KEY_PREVIOUS.",
      );
    }
    return plaintext;
  }
}
