/**
 * Live prober for Retell AI. Prints measurements; asserts only comparisons
 * between its own responses. Run: RETELL_API_KEY=key_… pnpm tsx scripts/verify-retell.ts
 *
 * What it is here to contradict (docs read 8 Sep 2026):
 *  - that the list endpoint is `/v3/list-calls` and not the plan's `/v2`;
 *  - that `filter_criteria.start_timestamp` is a NumberFilter `{type,op,value}`
 *    that actually FILTERS (a far-future `ge` must return nothing);
 *  - that timestamps are epoch MILLISECONDS, not seconds;
 *  - that `call_analysis` carries call_successful / user_sentiment /
 *    custom_analysis_data, and `call_cost` is a cost object we must not store;
 *  - whether any rate-limit header exists, since no requests-per-minute figure
 *    is published (docs.retellai.com/deploy/concurrency limits CALLS, not
 *    requests).
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.retellai.com"; // keep in step with src/connectors/retell.ts
const probe = createProbe("Retell AI");
const key = requireEnv("RETELL_API_KEY", "a Retell API key (Dashboard → API Keys)");
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const post = (body: unknown) => ({ method: "POST", headers, body: JSON.stringify(body) });
type Call = Record<string, unknown>;
type Page = { items?: Call[]; has_more?: boolean; pagination_key?: string };
const items = (x: unknown): Call[] => (Array.isArray((x as Page)?.items) ? (x as Page).items! : []);

const YEAR_2100_MS = 4_102_444_800_000;

async function main() {
  probe.head("SECTION 1 — POST /v3/list-calls (the v2 path the plan named is gone)");
  const first = await probe.section("list-calls", () =>
    attemptJson(probe, `${API}/v3/list-calls`, post({ limit: 5, sort_order: "descending" })),
  );
  if (!first?.ok) {
    probe.check("v3/list-calls responds 2xx", false, first ? `HTTP ${first.status}: ${String(first.body).slice(0, 200)}` : "no response");
    probe.report();
  }
  const page = first!.body as Page;
  probe.check("the reply is an object with `items`, not a bare array", !Array.isArray(first!.body) && Array.isArray(page.items), `keys=${Object.keys(page).join(", ")}`);
  probe.note("has_more / pagination_key", `${String(page.has_more)} / ${page.pagination_key ?? "none"}`);
  const rows = items(page);
  probe.note("calls returned", String(rows.length));
  if (rows.length === 0) {
    probe.note("no calls on this account", "sections 2-4 cannot measure a call object");
    probe.report();
  }

  probe.head("SECTION 2 — the call object: milliseconds, analysis, cost");
  const c = rows[0]!;
  probe.note("fields", Object.keys(c).join(", "));
  const start = Number(c["start_timestamp"] ?? 0);
  probe.check(
    "start_timestamp is epoch MILLISECONDS (13 digits, inside living memory)",
    start > 1_000_000_000_000 && start < YEAR_2100_MS,
    `${start} → ${Number.isFinite(start) ? new Date(start).toISOString() : "unparseable"}`,
  );
  const end = Number(c["end_timestamp"] ?? 0);
  if (end > 0) {
    const durationMs = Number(c["duration_ms"] ?? 0);
    probe.check("duration_ms ≈ end − start (so /1000 really is seconds)", Math.abs(end - start - durationMs) < 2_000, `end-start=${end - start} duration_ms=${durationMs}`);
  } else probe.skip("duration_ms vs end − start", "the newest call has not ended");
  probe.note("call_status / disconnection_reason", `${String(c["call_status"])} / ${String(c["disconnection_reason"] ?? "none")}`);
  probe.note("direction / from_number / to_number", `${String(c["direction"] ?? "n/a")} / ${String(c["from_number"] ?? "n/a")} / ${String(c["to_number"] ?? "n/a")}`);
  const analysed = rows.find((r) => r["call_analysis"] && Object.keys(r["call_analysis"] as object).length > 0);
  probe.note("call_analysis keys", analysed ? Object.keys(analysed["call_analysis"] as object).join(", ") : "no analysed call in this page");
  probe.note("call_cost keys (never stored, never the value)", c["call_cost"] ? Object.keys(c["call_cost"] as object).join(", ") : "absent");
  probe.check(
    "v3 omits the transcript twins we drop anyway",
    !("transcript_object" in c) && !("transcript_with_tool_calls" in c),
    `transcript_object=${String("transcript_object" in c)} transcript_with_tool_calls=${String("transcript_with_tool_calls" in c)}`,
  );

  probe.head("SECTION 3 — does filter_criteria.start_timestamp FILTER? (bounded vs unbounded control)");
  await pace(400);
  const unbounded = await probe.section("unbounded", () => attemptJson(probe, `${API}/v3/list-calls`, post({ limit: 50 })));
  await pace(400);
  const future = await probe.section("bounded far-future", () =>
    attemptJson(probe, `${API}/v3/list-calls`, post({ limit: 50, filter_criteria: { start_timestamp: { type: "number", op: "ge", value: YEAR_2100_MS } } })),
  );
  if (unbounded?.ok && future?.ok) {
    probe.check(
      "a far-future `ge` returns zero rows (the parameter is honoured, and in ms)",
      items(future.body).length === 0 && items(unbounded.body).length > 0,
      `unbounded=${items(unbounded.body).length} bounded=${items(future.body).length}`,
    );
  }
  await pace(400);
  const past = await probe.section("bounded to the newest call", () =>
    attemptJson(probe, `${API}/v3/list-calls`, post({ limit: 50, sort_order: "ascending", filter_criteria: { start_timestamp: { type: "number", op: "ge", value: start } } })),
  );
  if (past?.ok) {
    const oldest = Number(items(past.body)[0]?.["start_timestamp"] ?? 0);
    probe.check("`ge` is inclusive of the bound itself (the overlap the walk relies on)", oldest === start, `bound=${start} oldest returned=${oldest}`);
  }

  probe.head("SECTION 4 — pagination and rate-limit headers");
  await pace(400);
  const p1 = await probe.section("page 1", () => attemptJson(probe, `${API}/v3/list-calls`, post({ limit: 1, sort_order: "ascending" })));
  if (p1?.ok && (p1.body as Page).has_more && (p1.body as Page).pagination_key) {
    await pace(400);
    const p2 = await probe.section("page 2", () =>
      attemptJson(probe, `${API}/v3/list-calls`, post({ limit: 1, sort_order: "ascending", pagination_key: (p1.body as Page).pagination_key })),
    );
    if (p2?.ok) {
      const a = items(p1.body)[0]?.["call_id"];
      const b = items(p2.body)[0]?.["call_id"];
      probe.check("pagination_key advances (page 2 is a different call)", Boolean(a && b && a !== b), `page1=${String(a)} page2=${String(b)}`);
    }
  } else probe.skip("pagination_key advances", "this account has one page of calls at limit 1");

  await pace(400);
  const res = await fetch(`${API}/v3/list-calls`, post({ limit: 1 }));
  probe.bump();
  probe.note(
    "rate-limit headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none — no requests-per-minute figure is published (deploy/concurrency limits CALLS); the entry's 60/min stands until measured",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
