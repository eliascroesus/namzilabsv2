/**
 * Live prober for Paddle Billing. Prints measurements; asserts only comparisons
 * between its own responses. Run:
 *   PADDLE_API_KEY=pdl_live_apikey_… pnpm tsx scripts/verify-paddle.ts
 *   PADDLE_SANDBOX=yes PADDLE_API_KEY=pdl_sdbx_apikey_… pnpm tsx scripts/verify-paddle.ts
 * A key with `transaction.read` and `notification_setting.read` is enough.
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

// keep in step with src/connectors/paddle.ts
const LIVE = "https://api.paddle.com";
const SANDBOX = "https://sandbox-api.paddle.com";
const API = process.env.PADDLE_SANDBOX?.trim().toLowerCase() === "yes" ? SANDBOX : LIVE;

const probe = createProbe("Paddle");
const key = requireEnv("PADDLE_API_KEY", "an API key from Paddle → Developer tools → Authentication");
const headers = { authorization: `Bearer ${key}` };

type Row = Record<string, unknown>;
const rows = (x: unknown): Row[] => (Array.isArray((x as { data?: unknown[] })?.data) ? ((x as { data: Row[] }).data ?? []) : []);
const count = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);
const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "null" : String(v));

async function main() {
  probe.head(`SECTION 1 — /transactions answers (base ${API})`);
  const page = await probe.section("list", () => attemptJson(probe, `${API}/transactions?per_page=5&status=completed,paid&order_by=billed_at[DESC]`, { headers }));
  if (page) {
    probe.check("transactions list responds 2xx", page.ok, `HTTP ${page.status}${page.ok ? "" : `: ${String(page.body).slice(0, 200)}`}`);
    if (page.ok) {
      const data = rows(page.body);
      probe.note("rows returned for per_page=5", String(data.length));
      probe.note("statuses seen", [...new Set(data.map((r) => s(r["status"])))].join(", ") || "none");
      probe.note("billed_at values (DESC)", data.map((r) => s(r["billed_at"])).join(", ") || "none");
      probe.note("any row with a null billed_at", data.some((r) => r["billed_at"] == null) ? "YES — the bound would exclude it" : "no");
      const totals = data[0] ? ((totalsOf(data[0]) ?? {}) as Row) : {};
      probe.note("details.totals keys on the first row", Object.keys(totals).join(", ") || "none");
      probe.note("fee / earnings on the first row", `${s(totals["fee"])} / ${s(totals["earnings"])} (documented as null until completed)`);
      const pagination = ((page.body as { meta?: { pagination?: Row } }).meta?.pagination ?? {}) as Row;
      probe.note("meta.pagination", Object.entries(pagination).map(([k, v]) => `${k}=${s(v)}`).join(", ") || "none");
    }
  }

  probe.head("SECTION 2 — does billed_at[GTE] FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/transactions?per_page=30&status=completed,paid`, { headers }));
  const bounded = await probe.section("bounded", () =>
    attemptJson(probe, `${API}/transactions?per_page=30&status=completed,paid&billed_at[GTE]=2030-01-01T00:00:00Z`, { headers }),
  );
  if (all?.ok && bounded?.ok) {
    probe.check(
      "a far-future billed_at[GTE] returns zero rows (the parameter is honoured)",
      count(bounded.body) === 0,
      `unbounded=${count(all.body)} bounded=${count(bounded.body)}`,
    );
  }

  probe.head("SECTION 3 — does order_by=billed_at[ASC] ORDER? (the walk assumes it)");
  const asc = await probe.section("ascending", () => attemptJson(probe, `${API}/transactions?per_page=30&status=completed,paid&order_by=billed_at[ASC]`, { headers }));
  if (asc?.ok) {
    const stamps = rows(asc.body).map((r) => Date.parse(s(r["billed_at"]))).filter((n) => Number.isFinite(n));
    const sorted = stamps.every((n, i) => i === 0 || n >= stamps[i - 1]);
    probe.check("billed_at is non-decreasing across the page", sorted || stamps.length < 2, `${stamps.length} dated row(s)`);
  }

  probe.head("SECTION 4 — per_page ceiling (documented maximum: 30)");
  const over = await probe.section("per_page=200", () => attemptJson(probe, `${API}/transactions?per_page=200&status=completed,paid`, { headers }));
  if (over) probe.note("per_page=200", over.ok ? `HTTP 200, ${count(over.body)} row(s) — silently capped` : `HTTP ${over.status}: ${String(over.body).slice(0, 160)}`);

  probe.head("SECTION 5 — the 90-day event wall, measured");
  const events = await probe.section("events", () => attemptJson(probe, `${API}/events?per_page=200&order_by=id[ASC]`, { headers }));
  if (events?.ok) {
    const stamps = rows(events.body).map((r) => s(r["occurred_at"])).filter((v) => v !== "null");
    const oldest = stamps.length ? stamps.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
    probe.note(
      "oldest occurred_at reachable from /events",
      oldest ? `${oldest} (${Math.round((Date.now() - Date.parse(oldest)) / 86_400_000)} days ago)` : "no events",
    );
    probe.note("event types seen", [...new Set(rows(events.body).map((r) => s(r["event_type"])))].slice(0, 12).join(", ") || "none");
  } else if (events) {
    probe.note("/events", `HTTP ${events.status}: ${String(events.body).slice(0, 160)}`);
  }

  probe.head("SECTION 6 — notification destinations already registered");
  const settings = await probe.section("notification-settings", () => attemptJson(probe, `${API}/notification-settings`, { headers }));
  if (settings?.ok) {
    probe.note(
      "destinations",
      rows(settings.body).map((r) => `${s(r["id"])} → ${s(r["destination"])} (${s(r["type"])}, active=${s(r["active"])})`).join("; ") || "none",
    );
  } else if (settings) {
    probe.note("notification-settings", `HTTP ${settings.status}: ${String(settings.body).slice(0, 160)}`);
  }

  probe.head("SECTION 7 — rate-limit headers");
  const res = await fetch(`${API}/transactions?per_page=1`, { headers });
  probe.bump();
  probe.note(
    "headers",
    [...res.headers.entries()]
      .filter(([k]) => /ratelimit|retry-after/i.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "none (the published limit is 240 requests/minute per IP)",
  );
  probe.report();
}

function totalsOf(row: Row): unknown {
  const details = row["details"];
  return details && typeof details === "object" ? (details as Record<string, unknown>)["totals"] : null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
