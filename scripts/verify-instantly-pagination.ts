/**
 * One-time HUMAN-RUN verification of the Instantly v2 emails-list contract
 * (see PRE_LAUNCH_CHECKLIST.md item 2).
 *
 * The Instantly connector (src/connectors/instantly.ts) pins this shape:
 *
 *   I1. GET /api/v2/emails returns { items: [...], next_starting_after }
 *   I2. items are ordered newest-first by timestamp_created
 *   I3. `limit` is honored
 *   I4. `starting_after` walks strictly older items with no overlap/skip
 *
 * A 401 additionally means the key is invalid or v1-era (v1 keys stopped
 * working Jan 19, 2026) — create a v2 key and reconnect.
 *
 *   INSTANTLY_API_KEY=xxx pnpm tsx scripts/verify-instantly-pagination.ts
 *
 * Read-only (GETs only). Stays far under the endpoint's 20 req/min budget
 * (max 4 requests). Exits 0 when every check passes.
 */

const API = "https://api.instantly.ai/api/v2";

type Page = { items?: Array<Record<string, unknown>>; next_starting_after?: string | null };

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function get(params: Record<string, string>): Promise<Page> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) {
    console.error("Set INSTANTLY_API_KEY (a v2 key: Instantly → Settings → Integrations → API) and re-run.");
    process.exit(2);
  }
  const res = await fetch(`${API}/emails?${new URLSearchParams(params).toString()}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (res.status === 401) {
    console.error("\nHTTP 401 — the key is invalid or v1-era (v1 keys stopped working Jan 19, 2026). Create a v2 key and reconnect the Instantly connection.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Page;
}

const times = (p: Page) => (p.items ?? []).map((e) => String(e.timestamp_created ?? e.timestamp_email ?? ""));
const isDescending = (ts: string[]) => ts.every((t, i) => i === 0 || Date.parse(ts[i - 1]) >= Date.parse(t));

async function main() {
  console.log("Instantly v2 emails-list contract verification\n");

  const first = await get({ limit: "10" });
  check("I1 response has items[] and next_starting_after", Array.isArray(first.items) && "next_starting_after" in first);
  check("I2 newest-first ordering (page 1)", isDescending(times(first)), `${first.items?.length ?? 0} emails`);
  check("I3 limit honored", (first.items?.length ?? 0) <= 10, `got ${first.items?.length ?? 0}`);

  if (!first.items?.length) {
    console.log("\nMailbox list is empty — send a campaign email, then re-run for the walk check.");
  } else if (first.next_starting_after) {
    const seen = new Set(first.items.map((e) => String(e.id)));
    const oldestFirstPage = Date.parse(times(first)[times(first).length - 1]);
    const second = await get({ limit: "10", starting_after: String(first.next_starting_after) });
    const dup = (second.items ?? []).some((e) => seen.has(String(e.id)));
    const allOlder = times(second).every((t) => Date.parse(t) <= oldestFirstPage);
    check("I4 starting_after walks older items", allOlder && isDescending(times(second)));
    check("I4 no overlap across pages", !dup, `${seen.size} + ${second.items?.length ?? 0} unique`);
  } else {
    console.log("  (single page of history — walk check skipped, nothing to paginate)");
  }

  console.log(
    failures.length === 0
      ? "\nAll checks passed — the pinned contract holds."
      : `\n${failures.length} check(s) FAILED: ${failures.join("; ")}\n→ Update src/connectors/instantly.ts + tests/instantly-sendblue-poll.test.ts before shipping the Instantly poll.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});

export {};
