/**
 * Live prober for Fathom. Prints measurements; asserts only comparisons
 * between its own responses. Run: FATHOM_API_KEY=… pnpm tsx scripts/verify-fathom.ts
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.example.com/v1"; // FILL-ME: keep in step with src/connectors/fathom.ts
const probe = createProbe("Fathom");
const key = requireEnv("FATHOM_API_KEY", "an API key for a test account");
const headers = { authorization: `Bearer ${key}` };

async function main() {
  probe.head("SECTION 1 — the list endpoint answers");
  const page = await probe.section("list", () => attemptJson(probe, `${API}/events?limit=5`, { headers }));
  if (page) probe.check("list endpoint responds 2xx", page.ok, `HTTP ${page.status}`);

  probe.head("SECTION 2 — does the date filter FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/events?limit=50`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/events?limit=50&updated_after=2030-01-01T00:00:00Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    const n = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);
    probe.check("a future bound returns fewer rows than no bound (the parameter is honoured)", n(bounded.body) < n(all.body), `unbounded=${n(all.body)} bounded=${n(bounded.body)}`);
  }

  probe.head("SECTION 3 — rate-limit headers");
  const res = await fetch(`${API}/events?limit=1`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
