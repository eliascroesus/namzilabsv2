/**
 * Live prober for Tally. Prints measurements; asserts only comparisons
 * between its own responses. Run: TALLY_API_KEY=tly-… pnpm tsx scripts/verify-tally.ts
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.tally.so"; // keep in step with src/connectors/tally.ts
const probe = createProbe("Tally");
const key = requireEnv("TALLY_API_KEY", "an API key (Settings → API keys)");
const headers = { authorization: `Bearer ${key}` };
const count = (x: unknown) => (Array.isArray((x as { submissions?: unknown[] })?.submissions) ? (x as { submissions: unknown[] }).submissions.length : -1);

async function main() {
  probe.head("SECTION 1 — forms");
  const forms = await probe.section("forms", () => attemptJson(probe, `${API}/forms?limit=5`, { headers }));
  if (!forms?.ok) {
    probe.check("forms list responds 2xx", false, forms ? `HTTP ${forms.status}` : "no response");
    probe.report();
  }
  const first = ((forms!.body as { items?: Array<{ id?: string; name?: string }> }).items ?? [])[0];
  probe.note("first form", first ? `${first.id} — ${first.name}` : "no forms");
  if (!first?.id) probe.report();
  const formId = first!.id!;

  probe.head("SECTION 2 — submissions: envelope and fields");
  const page = await probe.section("submissions", () => attemptJson(probe, `${API}/forms/${formId}/submissions?limit=5&filter=all`, { headers }));
  if (page?.ok) {
    const body = page.body as { hasMore?: boolean; totalNumberOfSubmissionsPerFilter?: unknown; submissions?: Array<Record<string, unknown>> };
    probe.note("hasMore / totals", `${body.hasMore} / ${JSON.stringify(body.totalNumberOfSubmissionsPerFilter ?? null)}`);
    const s = body.submissions?.[0];
    probe.note("first submission's fields", s ? Object.keys(s).join(", ") : "no submissions");
    probe.note("respondentId present", s ? String("respondentId" in s) : "n/a");
  }

  probe.head("SECTION 3 — does startDate FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/forms/${formId}/submissions?limit=50&filter=all`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/forms/${formId}/submissions?limit=50&filter=all&startDate=2030-01-01T00:00:00.000Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future startDate returns zero rows (the parameter is honoured)", count(bounded.body) === 0, `unbounded=${count(all.body)} bounded=${count(bounded.body)}`);
  }

  probe.head("SECTION 4 — rate-limit headers");
  const res = await fetch(`${API}/forms?limit=1`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none (the published limit is 100 per minute)");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
