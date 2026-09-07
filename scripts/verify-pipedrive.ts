/**
 * Live prober for Pipedrive. Prints measurements; asserts only comparisons
 * between its own responses. Run: PIPEDRIVE_API_KEY=… pnpm tsx scripts/verify-pipedrive.ts
 * Set PIPEDRIVE_COMPANY_DOMAIN to measure the company host as well.
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const domain = process.env.PIPEDRIVE_COMPANY_DOMAIN;
const API = domain ? `https://${domain}.pipedrive.com` : "https://api.pipedrive.com"; // keep in step with src/connectors/pipedrive.ts
const probe = createProbe("Pipedrive");
const token = requireEnv("PIPEDRIVE_API_KEY", "a personal API token (Settings → Personal preferences → API)");
const headers = { "x-api-token": token };
const count = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);

async function main() {
  probe.head("SECTION 1 — /api/v2/deals answers with the token header");
  const page = await probe.section("list", () => attemptJson(probe, `${API}/api/v2/deals?limit=5&sort_by=update_time&sort_direction=desc`, { headers }));
  if (page) {
    probe.check("deals list responds 2xx", page.ok, `HTTP ${page.status}`);
    if (page.ok) {
      const body = page.body as { data?: Array<Record<string, unknown>>; additional_data?: Record<string, unknown> };
      probe.note("additional_data", JSON.stringify(body.additional_data ?? null));
      const d = body.data?.[0];
      probe.note("first deal: add_time / update_time / stage_change_time / won_time", d ? `${d["add_time"]} / ${d["update_time"]} / ${d["stage_change_time"]} / ${d["won_time"]}` : "no deals");
    }
  }

  probe.head("SECTION 2 — does updated_since FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/api/v2/deals?limit=100`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/api/v2/deals?limit=100&updated_since=2030-01-01T00:00:00Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future updated_since returns zero rows (the parameter is honoured)", count(bounded.body) === 0, `unbounded=${count(all.body)} bounded=${count(bounded.body)}`);
  }

  probe.head("SECTION 3 — the generic host vs the company host");
  const generic = await probe.section("api.pipedrive.com", () => attemptJson(probe, `https://api.pipedrive.com/api/v2/deals?limit=1`, { headers }));
  if (generic) probe.note("api.pipedrive.com with x-api-token", `HTTP ${generic.status}`);

  probe.head("SECTION 4 — webhooks list and version");
  const hooks = await probe.section("webhooks", () => attemptJson(probe, `${API}/v1/webhooks`, { headers }));
  if (hooks?.ok) {
    const rows = (hooks.body as { data?: Array<Record<string, unknown>> }).data ?? [];
    probe.note("existing webhooks and their versions", rows.map((w) => `${w["id"]}:${w["version"]}:${w["event_object"]}`).join(", ") || "none");
  }

  probe.head("SECTION 5 — rate-limit headers");
  const res = await fetch(`${API}/api/v2/deals?limit=1`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|daily-requests|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
