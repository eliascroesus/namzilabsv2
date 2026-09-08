/**
 * Live prober for JustCall. Prints measurements; asserts only comparisons
 * between its own responses. Run: JUSTCALL_API_KEY=api_key:api_secret pnpm tsx scripts/verify-justcall.ts
 *
 * What the fixtures cannot decide, and this can:
 *  - whether `from_datetime` actually FILTERS (a far-future bound must be empty);
 *  - what the list envelope really contains (the calls page's OpenAPI response
 *    schema is a bare call object; the contacts page documents
 *    status/count/current_page/per_page/data/next_page_link);
 *  - which time zone `from_datetime` is read in, measured as the gap between a
 *    call's `call_date`+`call_time` (documented UTC) and its
 *    `call_user_date`+`call_user_time` (the account's zone) — the offset the
 *    connector's 12-hour margin exists to cover;
 *  - whether `sort=datetime&order=asc` is honoured, which is what lets a poll
 *    that stops early resume from the newest row it saw.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.justcall.io/v2.1"; // keep in step with src/connectors/justcall.ts
const probe = createProbe("JustCall");
const pair = requireEnv("JUSTCALL_API_KEY", "api_key:api_secret from justcall.io/app/developers");
const headers = { authorization: pair };

type Call = Record<string, unknown>;
type Page = { status?: string; count?: number; current_page?: number; per_page?: number; data?: Call[]; next_page_link?: string | null };
const rows = (x: unknown): Call[] => (Array.isArray((x as Page)?.data) ? (x as Page).data! : []);
const at = (c: Call | undefined) => (c ? `${c["call_date"]} ${c["call_time"]}` : "—");
const userAt = (c: Call | undefined) => (c ? `${c["call_user_date"]} ${c["call_user_time"]}` : "—");

/** "yyyy-mm-dd hh:mm:ss" — the only shape from_datetime documents. */
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

async function main() {
  probe.head("SECTION 1 — GET /calls answers, and what the envelope really holds");
  const first = await probe.section("list", () => attemptJson(probe, `${API}/calls?per_page=5&sort=datetime&order=desc`, { headers }));
  if (!first) {
    probe.check("calls list responds 2xx to GET (the plan said POST)", false, "no response");
    probe.report();
  }
  const listed = first!;
  probe.check("calls list responds 2xx to GET (the plan said POST)", listed.ok, `HTTP ${listed.status}${listed.ok ? "" : `: ${String(listed.body).slice(0, 200)}`}`);
  if (!listed.ok) probe.report();
  const page = listed.body as Page;
  probe.note("envelope keys", Object.keys(page).join(", ") || "none");
  probe.note("count / current_page / per_page", `${page.count} / ${page.current_page} / ${page.per_page}`);
  probe.note("next_page_link", page.next_page_link ? String(page.next_page_link) : "absent");
  const newest = rows(page)[0];
  probe.note("first call: id / call_date call_time (UTC) / call_user_date call_user_time (account zone)", newest ? `${newest["id"]} / ${at(newest)} / ${userAt(newest)}` : "no calls");
  probe.note("first call: call_info", newest ? JSON.stringify(newest["call_info"]) : "—");
  probe.note("first call: call_duration (conversation_time is the value)", newest ? JSON.stringify(newest["call_duration"]) : "—");
  if (newest && typeof newest["call_date"] === "string" && typeof newest["call_user_date"] === "string") {
    const utc = Date.parse(`${newest["call_date"]}T${String(newest["call_time"]).padStart(8, "0")}Z`);
    const local = Date.parse(`${newest["call_user_date"]}T${String(newest["call_user_time"]).padStart(8, "0")}Z`);
    const hours = Number.isFinite(utc) && Number.isFinite(local) ? (local - utc) / 3_600_000 : NaN;
    probe.note("account UTC offset implied by call_user_* minus call_*", Number.isFinite(hours) ? `${hours} h` : "unparseable");
    probe.check("that offset is inside the ±12 h margin the connector widens by", !Number.isFinite(hours) || Math.abs(hours) <= 12, `${hours} h`);
  }

  probe.head("SECTION 2 — does `from_datetime` FILTER? (bounded vs unbounded control)");
  await pace(2_100); // Team plan burst is 30/min; keep well inside it.
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/calls?per_page=50`, { headers }));
  await pace(2_100);
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/calls?per_page=50&from_datetime=${encodeURIComponent("2030-01-01 00:00:00")}`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future `from_datetime` returns zero rows (the parameter is honoured)", rows(bounded.body).length === 0, `unbounded=${rows(all.body).length} bounded=${rows(bounded.body).length}`);
  }
  // The connector builds its query with URLSearchParams, which encodes the
  // space in "yyyy-mm-dd hh:mm:ss" as `+` rather than %20. Both are legal;
  // only a live account can say whether JustCall decodes `+`.
  await pace(2_100);
  const recent = stamp(new Date(Date.now() - 7 * 86_400_000));
  const plus = await probe.section("space as +", () => attemptJson(probe, `${API}/calls?per_page=50&from_datetime=${recent.replace(" ", "+")}`, { headers }));
  await pace(2_100);
  const pct20 = await probe.section("space as %20", () => attemptJson(probe, `${API}/calls?per_page=50&from_datetime=${encodeURIComponent(recent)}`, { headers }));
  if (plus?.ok && pct20?.ok) {
    probe.check("`+` and %20 are the same bound (the connector sends `+`)", rows(plus.body).length === rows(pct20.body).length, `plus=${rows(plus.body).length} pct20=${rows(pct20.body).length}`);
  }

  probe.head("SECTION 3 — is `sort=datetime&order=asc` honoured, and does the walk paginate?");
  await pace(2_100);
  const since = stamp(new Date(Date.now() - 30 * 86_400_000));
  const asc = await probe.section("ascending", () => attemptJson(probe, `${API}/calls?per_page=5&sort=datetime&order=asc&from_datetime=${encodeURIComponent(since)}`, { headers }));
  if (asc?.ok) {
    const list = rows(asc.body);
    const stamps = list.map((c) => `${c["call_date"]}T${c["call_time"]}`);
    probe.note("first five call_date/call_time, ascending", stamps.join(" | ") || "no calls in the last 30 days");
    const sorted = [...stamps].sort();
    probe.check("rows come back oldest-first when order=asc", stamps.join("|") === sorted.join("|"), stamps.join(" | ") || "no rows to order");
    probe.note("next_page_link on a full page", (asc.body as Page).next_page_link ? String((asc.body as Page).next_page_link) : "absent — the walk falls back to current_page + 1");
    const link = (asc.body as Page).next_page_link;
    if (link) {
      let carried = "unparseable";
      try {
        const p = new URL(String(link)).searchParams;
        carried = [...p.keys()].join(", ");
      } catch {
        /* reported as unparseable */
      }
      probe.note("params next_page_link carries (the connector re-sends its own, taking only `page`)", carried);
    }
  }

  probe.head("SECTION 4 — retention: how far back does the API actually reach?");
  await pace(2_100);
  const old = stamp(new Date(Date.now() - 200 * 86_400_000));
  const deep = await probe.section("200 days back", () => attemptJson(probe, `${API}/calls?per_page=5&sort=datetime&order=asc&from_datetime=${encodeURIComponent(old)}`, { headers }));
  if (deep?.ok) {
    probe.note("oldest call returned with a 200-day bound (docs say 3 months)", at(rows(deep.body)[0]));
  }

  probe.head("SECTION 5 — rate-limit headers");
  await pace(2_100);
  const res = await fetch(`${API}/calls?per_page=1`, { headers });
  probe.bump();
  const seen = [...res.headers.entries()].filter(([k]) => /rate-?limit|retry-after/i.test(k));
  probe.note("headers", seen.map(([k, v]) => `${k}=${v}`).join(", ") || "none");
  probe.check(
    "the budget headers are X-Rate-Limit-* (which the shared parser does NOT read — justcall.ts reads them itself)",
    seen.some(([k]) => /^x-rate-limit-/i.test(k)),
    seen.map(([k]) => k).join(", ") || "none",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
