import { createHmac } from "node:crypto";
import { safeEqual, timestampFreshness } from "@/lib/signatures";

/** Structurally the same as `VerifyArgs` — a connector passes its args straight through. */
export type VerifyInput = { rawBody: string; headers: Record<string, string>; secret?: string | null };
type Algo = "sha256" | "sha1" | "md5";
type Enc = "hex" | "base64";

function digest(algo: Algo, key: string | Buffer, message: string, enc: Enc): string {
  return createHmac(algo, key).update(message, "utf8").digest(enc);
}

/**
 * Standard Webhooks (Svix, Stripe's Workbench, Whop, Retell, OpenPhone…):
 * `webhook-id`.`webhook-timestamp`.body, HMAC-SHA256, base64, in a
 * `webhook-signature` header of space-separated `v1,<sig>` entries. The
 * secret is usually `whsec_` + base64; both the decoded and the literal
 * key are tried, as Whop's connector learned to.
 */
export function standardWebhooksVerify(
  input: VerifyInput,
  opts: { idHeader?: string; timestampHeader?: string; signatureHeader?: string; secretPrefix?: string; toleranceMs?: number } = {},
): boolean {
  const { rawBody, headers, secret } = input;
  if (!secret) return false;
  const id = headers[opts.idHeader ?? "webhook-id"];
  const ts = headers[opts.timestampHeader ?? "webhook-timestamp"];
  const sig = headers[opts.signatureHeader ?? "webhook-signature"];
  if (!id || !ts || !sig) return false;
  if (timestampFreshness(ts, opts.toleranceMs) !== "fresh") return false;
  const prefix = opts.secretPrefix ?? "whsec_";
  const raw = secret.startsWith(prefix) ? secret.slice(prefix.length) : secret;
  const keys: Array<string | Buffer> = [Buffer.from(raw, "base64"), raw];
  const expected = keys.map((k) => digest("sha256", k, `${id}.${ts}.${rawBody}`, "base64"));
  for (const part of sig.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    if (expected.some((e) => safeEqual(value, e))) return true;
  }
  return false;
}

/**
 * One header of `key=value` pairs carrying a timestamp and one or more
 * signatures (Stripe `t=,v1=`; Paddle `ts=;h1=`; OnceHub `t=,s=`). The
 * caller states how the signed message is built from the timestamp and body.
 */
export function timestampedHmacVerify(
  input: VerifyInput,
  opts: {
    header: string;
    pairSeparator?: string;
    kvSeparator?: string;
    timestampKey: string;
    signatureKey: string;
    message: (timestamp: string, rawBody: string) => string;
    encoding?: Enc;
    algorithm?: Algo;
    toleranceMs?: number;
  },
): boolean {
  const { rawBody, headers, secret } = input;
  if (!secret) return false;
  const header = headers[opts.header];
  if (!header) return false;
  const kv = opts.kvSeparator ?? "=";
  let ts: string | null = null;
  const sigs: string[] = [];
  for (const part of header.split(opts.pairSeparator ?? ",")) {
    const i = part.indexOf(kv);
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + kv.length).trim();
    if (k === opts.timestampKey) ts = v;
    else if (k === opts.signatureKey && v) sigs.push(v);
  }
  if (!ts || sigs.length === 0) return false;
  if (timestampFreshness(ts, opts.toleranceMs) !== "fresh") return false;
  const expected = digest(opts.algorithm ?? "sha256", secret, opts.message(ts, rawBody), opts.encoding ?? "hex");
  return sigs.some((s) => safeEqual(s, expected));
}

/** One header = HMAC over the raw body (Cal.com hex; Typeform `sha256=` base64; Thinkific base64; Attio hex). */
export function hmacHeaderVerify(
  input: VerifyInput,
  opts: { header: string; encoding: Enc; prefix?: string; algorithm?: Algo; message?: (rawBody: string) => string },
): boolean {
  const { rawBody, headers, secret } = input;
  if (!secret) return false;
  const provided = headers[opts.header];
  if (!provided) return false;
  const value = opts.prefix && provided.startsWith(opts.prefix) ? provided.slice(opts.prefix.length) : provided;
  const expected = digest(opts.algorithm ?? "sha256", secret, (opts.message ?? ((b) => b))(rawBody), opts.encoding);
  return safeEqual(value, expected);
}

/**
 * A bare shared token — in a header, or extracted from the body by the
 * caller. No integrity over the body, so weaker than an HMAC; still fails
 * closed without a secret and compares in constant time.
 */
export function sharedTokenVerify(input: VerifyInput, opts: { header?: string; token?: string | null }): boolean {
  const { headers, secret } = input;
  if (!secret) return false;
  const provided = opts.token ?? (opts.header ? headers[opts.header] : undefined);
  if (!provided) return false;
  return safeEqual(provided, secret);
}
