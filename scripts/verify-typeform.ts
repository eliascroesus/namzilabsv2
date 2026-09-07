/**
 * Live prober for Typeform. Prints measurements; asserts only comparisons
 * between its own responses. Run: TYPEFORM_API_KEY=tfp_… pnpm tsx scripts/verify-typeform.ts
 * Pace: the Responses API allows two requests per second per account.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.typeform.com"; // keep in step with src/connectors/typeform.ts
const probe = createProbe("Typeform");
const key = requireEnv("TYPEFORM_API_KEY", "a personal access token (Account → Personal tokens)");
const headers = { authorization: `Bearer ${key}` };
const count = (x: unknown) => (Array.isArray((x as { items?: unknown[] })?.items) ? (x as { items: unknown[] }).items.length : -1);

async function main() {
  probe.head("SECTION 1 — forms");
  const forms = await probe.section("forms", () => attemptJson(probe, `${API}/forms?page_size=5`, { headers }));
  if (!forms?.ok) {
    probe.check("forms list responds 2xx", false, forms ? `HTTP ${forms.status}` : "no response");
    probe.report();
  }
  const first = ((forms!.body as { items?: Array<{ id?: string; title?: string }> }).items ?? [])[0];
  probe.note("first form", first ? `${first.id} — ${first.title}` : "no forms");
  if (!first?.id) probe.report();
  const formId = first!.id!;

  probe.head("SECTION 2 — responses: sentinel and ordering");
  await pace(600);
  const page = await probe.section("responses", () => attemptJson(probe, `${API}/forms/${formId}/responses?page_size=5&sort=submitted_at,asc`, { headers }));
  if (page?.ok) {
    const items = (page.body as { items?: Array<Record<string, unknown>> }).items ?? [];
    probe.note("first item's fields", items[0] ? Object.keys(items[0]).join(", ") : "no responses");
    probe.note("submitted_at values", items.map((i) => String(i["submitted_at"])).join(", ") || "none");
    probe.note("any year-1 sentinel among completed responses", items.some((i) => i["submitted_at"] === "0001-01-01T00:00:00Z") ? "yes" : "no");
  }

  probe.head("SECTION 3 — does `since` FILTER? (bounded vs unbounded control)");
  await pace(600);
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/forms/${formId}/responses?page_size=50`, { headers }));
  await pace(600);
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/forms/${formId}/responses?page_size=50&since=2030-01-01T00:00:00Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future `since` returns zero rows (the parameter is honoured)", count(bounded.body) === 0, `unbounded=${count(all.body)} bounded=${count(bounded.body)}`);
  }

  probe.head("SECTION 4 — rate-limit headers");
  await pace(600);
  const res = await fetch(`${API}/forms?page_size=1`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none (the published limit is two requests per second per account)");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
