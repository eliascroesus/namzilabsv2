/**
 * Live prober for Smartlead. Prints measurements; asserts only comparisons
 * between its own responses. Run: SMARTLEAD_API_KEY=… pnpm tsx scripts/verify-smartlead.ts
 *
 * Pace: api.smartlead.ai/guides/rate-limits publishes 60 requests/minute per
 * API key on Standard (120 on Pro), "across all endpoints combined" — so one
 * request a second, with margin.
 *
 * THE KEY IS A QUERY PARAMETER, so no URL is ever printed here: only paths,
 * statuses and field names go to stdout.
 *
 * What this is FOR: the leads-statistics ROW SHAPE is not published (the
 * reference page shows `"data": []`), and src/connectors/smartlead.ts reads two
 * candidate names per fact because of it. Section 2 prints the real field names.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://server.smartlead.ai/api/v1"; // keep in step with src/connectors/smartlead.ts
const probe = createProbe("Smartlead");
const key = requireEnv("SMARTLEAD_API_KEY", "an API key (Settings → API)");
/** Built here, never printed — the credential is inside it. */
const url = (path: string, params: Record<string, string | number> = {}) => {
  const u = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set("api_key", key);
  return u.toString();
};
const rowsOf = (body: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
};
const CANDIDATES: Record<string, readonly string[]> = {
  sent: ["sent_time", "time_sent"],
  opened: ["open_time", "time_opened"],
  clicked: ["click_time", "time_clicked"],
  replied: ["reply_time", "time_replied"],
};

async function main() {
  probe.head("SECTION 1 — campaigns (GET /campaigns, api_key in the query)");
  const list = await probe.section("campaigns", () => attemptJson(probe, url("/campaigns")));
  if (!list?.ok) {
    probe.check("campaign list responds 2xx", false, list ? `HTTP ${list.status}` : "no response");
    probe.report();
  }
  const campaigns = rowsOf(list!.body);
  probe.note("shape", Array.isArray(list!.body) ? "bare array (as documented)" : `object with keys ${Object.keys(list!.body as object).join(", ")}`);
  probe.note("campaign count", String(campaigns.length));
  const first = campaigns[0];
  probe.note("first campaign", first ? `${String(first["id"])} — ${String(first["name"])} (${String(first["status"])})` : "no campaigns");
  if (!first?.["id"]) probe.report();
  const campaignId = String(first["id"]);

  probe.head("SECTION 2 — leads-statistics: the row shape the docs do not publish");
  await pace(1100);
  const page = await probe.section("leads-statistics", () => attemptJson(probe, url(`/campaigns/${campaignId}/leads-statistics`, { limit: 5, offset: 0 })));
  if (page?.ok) {
    probe.note("envelope keys", Array.isArray(page.body) ? "bare array" : Object.keys((page.body ?? {}) as object).join(", ") || "none");
    const rows = rowsOf(page.body);
    probe.note("rows returned", String(rows.length));
    const r = rows[0];
    probe.note("first row's fields", r ? Object.keys(r).join(", ") : "no rows");
    if (r) {
      for (const [fact, names] of Object.entries(CANDIDATES)) {
        const present = names.filter((n) => n in r);
        probe.check(`${fact}: one of ${names.join(" | ")} exists`, present.length > 0, present.length ? `${present.join(", ")} = ${present.map((n) => String(r[n])).join(", ")}` : "NEITHER — the connector cannot date this fact");
      }
      probe.check("a row identity exists (stats_id, else lead + sequence)", Boolean(r["stats_id"] ?? r["email_stats_id"] ?? ((r["lead_email"] ?? r["to_email"]) && r["sequence_number"])), `stats_id=${String(r["stats_id"])} lead_email=${String(r["lead_email"])} sequence_number=${String(r["sequence_number"])}`);
    }
  } else {
    probe.check("leads-statistics responds 2xx", false, page ? `HTTP ${page.status}: ${String(page.body).slice(0, 200)}` : "no response");
  }

  probe.head("SECTION 3 — does `event_time_gt` FILTER? (bounded vs unbounded control)");
  await pace(1100);
  const all = await probe.section("unbounded", () => attemptJson(probe, url(`/campaigns/${campaignId}/leads-statistics`, { limit: 100, offset: 0 })));
  await pace(1100);
  const bounded = await probe.section("bounded", () => attemptJson(probe, url(`/campaigns/${campaignId}/leads-statistics`, { limit: 100, offset: 0, event_time_gt: "2030-01-01" })));
  if (all?.ok && bounded?.ok) {
    probe.check(
      "a far-future event_time_gt returns zero rows (the parameter is honoured, so the watermark is real)",
      rowsOf(bounded.body).length === 0,
      `unbounded=${rowsOf(all.body).length} bounded=${rowsOf(bounded.body).length}`,
    );
  }

  probe.head("SECTION 4 — paging and rate-limit headers");
  await pace(1100);
  const second = await probe.section("offset page", () => attemptJson(probe, url(`/campaigns/${campaignId}/leads-statistics`, { limit: 1, offset: 1 })));
  if (all?.ok && second?.ok) {
    const firstId = rowsOf(all.body)[1]?.["stats_id"];
    probe.note("offset=1 returns the second row of offset=0", `${String(rowsOf(second.body)[0]?.["stats_id"])} vs ${String(firstId)}`);
  }
  await pace(1100);
  const res = await fetch(url("/campaigns"));
  probe.bump();
  probe.note(
    "rate-limit headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none (the published limit is 60/min per API key on Standard, 120 on Pro)",
  );
  // Every header name, so a future signature capture can be compared against
  // what a real delivery carries (the docs name X-Smartlead-Signature).
  probe.note("all header names", [...res.headers.keys()].join(", "));
  probe.report();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.split(key).join("…") : e);
  process.exit(1);
});
