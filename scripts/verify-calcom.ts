/**
 * Live prober for Cal.com. Prints measurements; asserts only comparisons
 * between its own responses. Run: CALCOM_API_KEY=cal_… pnpm tsx scripts/verify-calcom.ts
 * Set CALCOM_API_BASE for a self-hosted instance.
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = process.env.CALCOM_API_BASE ?? "https://api.cal.com/v2"; // keep in step with src/connectors/calcom.ts
const API_VERSION = "2026-05-01";
const probe = createProbe("Cal.com");
const key = requireEnv("CALCOM_API_KEY", "an API key (Settings → Developer → API keys)");
const headers = { authorization: `Bearer ${key}`, "cal-api-version": API_VERSION };
const count = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);

async function main() {
  probe.head("SECTION 1 — /v2/bookings answers under the pinned api version");
  const page = await probe.section("list", () => attemptJson(probe, `${API}/bookings?limit=5&sortUpdatedAt=desc`, { headers }));
  if (page) {
    probe.check("bookings list responds 2xx", page.ok, `HTTP ${page.status}`);
    if (page.ok) {
      const body = page.body as { data?: Array<Record<string, unknown>>; pagination?: Record<string, unknown> };
      probe.note("pagination block", JSON.stringify(body.pagination ?? null));
      const first = body.data?.[0];
      probe.note("first booking's fields", first ? Object.keys(first).join(", ") : "no bookings");
      probe.note("createdAt / updatedAt / start on the first booking", first ? `${first["createdAt"]} / ${first["updatedAt"]} / ${first["start"]}` : "n/a");
    }
  }

  probe.head("SECTION 2 — does afterUpdatedAt FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/bookings?limit=50`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/bookings?limit=50&afterUpdatedAt=2030-01-01T00:00:00.000Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future afterUpdatedAt returns zero rows (the parameter is honoured)", count(bounded.body) === 0, `unbounded=${count(all.body)} bounded=${count(bounded.body)}`);
  }

  probe.head("SECTION 3 — without cal-api-version");
  const bare = await probe.section("no version header", () => attemptJson(probe, `${API}/bookings?limit=1`, { headers: { authorization: headers.authorization } }));
  if (bare) probe.note("response without the header", `HTTP ${bare.status}; keys: ${bare.ok ? Object.keys(bare.body as object).join(", ") : String(bare.body).slice(0, 120)}`);

  probe.head("SECTION 4 — rate-limit headers");
  const res = await fetch(`${API}/bookings?limit=1`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
