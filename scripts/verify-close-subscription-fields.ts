/**
 * Does `GET /webhook/` return `signature_key`?
 *
 * THE QUESTION IS WORTH ONE SCRIPT because the answer changes what the
 * re-activation guard IS. Today the guard is a duty-cycle dial: no finite
 * rejection-memory window can distinguish "still broken" from "fixed a minute
 * ago", because a deploy leaves no trace in `delivery_log`. So re-activation is
 * a probe, and `REJECTION_MEMORY_MS` only sets how often the probe is taken.
 *
 * If the LIST response carries `signature_key`, that changes completely.
 * Comparing it against the connection's decrypted stored secret answers "will
 * verification succeed?" DIRECTLY, before a single delivery is attempted:
 *
 *   - equal, and the frozen doc vector in tests/connectors-signatures.test.ts
 *     already proves our HMAC is byte-correct for a key of that shape → positive
 *     evidence, so re-activate now rather than probing;
 *   - different → the stored secret is stale, which `reconcile` can repair
 *     itself: it holds the DB and the encryption key.
 *
 * Either way the chicken-and-egg is gone and the 24-hour window becomes a cost
 * dial rather than the correctness mechanism.
 *
 * The update endpoint's documented response includes `signature_key`. THE LIST
 * ENDPOINT IS A DIFFERENT ENDPOINT and providers routinely omit secrets from
 * collection responses — so this measures rather than assumes. That distinction
 * is the whole reason this file exists: assuming a key's shape from a related
 * document is how the key came to be a hex string used as UTF-8.
 *
 * NEVER PRINTS A KEY. Presence, type and length only, plus a fingerprint that
 * cannot be reversed — enough to answer the question and to compare two keys
 * without either appearing in a terminal, a scrollback or a paste.
 *
 * Read-only: one GET.
 *
 *   CLOSE_API_KEY=api_xxx pnpm tsx scripts/verify-close-subscription-fields.ts
 */
import { createHash } from "node:crypto";

const API = "https://api.close.com/api/v1";

/** Irreversible, and short enough to eyeball. Never the key itself. */
const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

const HEX = /^[0-9a-fA-F]+$/;

function describeKey(v: unknown): string {
  if (v == null) return "ABSENT";
  if (typeof v !== "string") return `present but not a string (${typeof v})`;
  const shape = HEX.test(v) && v.length % 2 === 0 ? `hex, ${v.length / 2} bytes` : "NOT clean hex";
  return `present — ${v.length} chars, ${shape}, fingerprint ${fingerprint(v)}`;
}

async function main() {
  const key = process.env.CLOSE_API_KEY;
  if (!key) {
    console.error("Set CLOSE_API_KEY.");
    process.exit(2);
  }

  const res = await fetch(`${API}/webhook/`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.text();
  if (!res.ok) {
    console.log(`GET /webhook/ → ${res.status}`);
    console.log(body.slice(0, 2000));
    process.exit(1);
  }
  const parsed: unknown = JSON.parse(body);
  const hooks =
    typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { data?: unknown }).data)
      ? ((parsed as { data: Array<Record<string, unknown>> }).data)
      : [];

  console.log(`GET /webhook/ → ${res.status}, ${hooks.length} subscription(s)`);
  console.log("");

  if (hooks.length === 0) {
    console.log("No subscriptions on this API key — nothing to inspect.");
    process.exit(0);
  }

  // The union of key names across all subscriptions, so a field that happens to
  // be null on the first one is not reported as missing everywhere.
  const allFields = [...new Set(hooks.flatMap((h) => Object.keys(h)))].sort();
  console.log(`fields present across the collection (${allFields.length}):`);
  console.log(`  ${allFields.join(", ")}`);
  console.log("");
  console.log(`SIGNATURE_KEY IN THE LIST RESPONSE: ${allFields.includes("signature_key") ? "YES" : "NO"}`);
  console.log("");

  for (const h of hooks) {
    const id = typeof h["id"] === "string" ? h["id"] : "(no id)";
    console.log(`  ${id}`);
    console.log(`    url                                   ${String(h["url"] ?? "")}`);
    console.log(`    status                                ${String(h["status"] ?? "")}`);
    console.log(`    health_status                         ${String(h["health_status"] ?? "")}`);
    console.log(`    pause_reason                          ${String(h["pause_reason"] ?? "")}`);
    console.log(`    latest_error                          ${String(h["latest_error"] ?? "")}`);
    console.log(`    recent_consecutive_fail_buckets_cnt   ${String(h["recent_consecutive_fail_buckets_cnt"] ?? "")}`);
    console.log(`    signature_key                         ${describeKey(h["signature_key"])}`);
  }

  console.log("");
  console.log("To compare against what is stored, fingerprint the decrypted secret the");
  console.log("same way (sha256, first 12 hex chars) and check the two match. The keys");
  console.log("themselves never need to be seen to answer that.");
}

main().catch((e) => {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

export {};
