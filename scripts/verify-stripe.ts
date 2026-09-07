/**
 * Live prober for Stripe. Prints measurements; asserts only comparisons
 * between its own responses. Run: STRIPE_API_KEY=rk_… pnpm tsx scripts/verify-stripe.ts
 * A restricted key with read access to events is enough.
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.stripe.com/v1"; // keep in step with src/connectors/stripe.ts
const probe = createProbe("Stripe");
const key = requireEnv("STRIPE_API_KEY", "a restricted or secret key with events read access");
const headers = { authorization: `Bearer ${key}` };
const count = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);

async function main() {
  probe.head("SECTION 1 — /v1/events answers, and how deep it reaches");
  const page = await probe.section("list", () => attemptJson(probe, `${API}/events?limit=100`, { headers }));
  if (page) {
    probe.check("events list responds 2xx", page.ok, `HTTP ${page.status}`);
    if (page.ok) {
      const rows = (page.body as { data?: Array<{ created?: number; type?: string }> }).data ?? [];
      const oldest = rows.length ? Math.min(...rows.map((r) => r.created ?? Infinity)) : null;
      probe.note("oldest event on the first page", oldest ? `${new Date(oldest * 1000).toISOString()} (${Math.round((Date.now() / 1000 - oldest) / 86_400)} days ago)` : "no events");
      probe.note("event types seen", [...new Set(rows.map((r) => r.type))].slice(0, 12).join(", ") || "none");
    }
  }

  probe.head("SECTION 2 — does created[gte] FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/events?limit=50`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/events?limit=50&created[gte]=1900000000`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future created[gte] returns zero rows (the parameter is honoured)", count(bounded.body) === 0, `unbounded=${count(all.body)} bounded=${count(bounded.body)}`);
  }

  probe.head("SECTION 3 — does types[] FILTER?");
  const typed = await probe.section("typed", () => attemptJson(probe, `${API}/events?limit=50&types[]=charge.succeeded`, { headers }));
  if (typed?.ok) {
    const rows = (typed.body as { data?: Array<{ type?: string }> }).data ?? [];
    probe.check("every row of a types[]=charge.succeeded request is that type", rows.every((r) => r.type === "charge.succeeded"), `${rows.length} row(s), types: ${[...new Set(rows.map((r) => r.type))].join(", ") || "none"}`);
  }

  probe.head("SECTION 4 — rate-limit headers");
  const res = await fetch(`${API}/events?limit=1`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after|stripe-rate/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none (Stripe publishes limits on docs.stripe.com/rate-limits, not in headers)");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
