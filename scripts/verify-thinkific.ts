/**
 * Live prober for Thinkific. Prints measurements; asserts only comparisons
 * between its own responses.
 *
 *   THINKIFIC_API_KEY='<api key>:<subdomain>' pnpm tsx scripts/verify-thinkific.ts
 *
 * The site must be on Grow / Pro + Growth or above — the API is plan-gated and
 * answers 401 {"error":"Authentication Error"} otherwise.
 *
 * SECTION 2 IS THE ONE THAT MATTERS. `GET /orders` has no date filter, so the
 * connector applies the window client-side and stops at the first page holding
 * nothing inside it — which is only sound if the list runs NEWEST-FIRST. No
 * Thinkific page states the order, so it is measured here. Until this run says
 * "descending", `verified.live` stays null in the catalog.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.thinkific.com/api/public/v1"; // keep in step with src/connectors/thinkific.ts
const probe = createProbe("Thinkific");
const raw = requireEnv("THINKIFIC_API_KEY", "'<api key>:<subdomain>' — Settings → Code & Analytics → API");
const [key, subdomain] = raw.split(":");
if (!key || !subdomain) {
  console.error("THINKIFIC_API_KEY must be '<api key>:<subdomain>' (the subdomain is the part before .thinkific.com).");
  process.exit(2);
}
const headers = { "X-Auth-API-Key": key, "X-Auth-Subdomain": subdomain, "Content-Type": "application/json" };

type Order = Record<string, unknown>;
type Page = { items?: Order[]; meta?: { pagination?: Record<string, unknown> } };
const items = (x: unknown): Order[] => ((x as Page)?.items ?? []).filter((o) => o && typeof o === "object");
const dateOf = (o: Order): string | null => {
  const v = o["created_at"] ?? o["created at"]; // the Admin API spec spells the order's field with a space
  return typeof v === "string" ? v : null;
};
const ms = (o: Order): number => Date.parse(dateOf(o) ?? "") || 0;

async function main() {
  probe.head("SECTION 1 — /orders answers, and what a row actually carries");
  const first = await probe.section("orders", () => attemptJson(probe, `${API}/orders?limit=5`, { headers }));
  if (!first?.ok) {
    probe.check("orders list responds 2xx", false, first ? `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 200)}` : "no response");
    probe.report();
  }
  const rows = items(first!.body);
  probe.note("rows on a limit=5 page", String(rows.length));
  probe.note("first row's fields", rows[0] ? Object.keys(rows[0]).join(", ") : "no orders on this site");
  probe.check(
    "an order's date field is created_at (not the spec's 'created at' typo)",
    rows.length === 0 || typeof rows[0]["created_at"] === "string",
    rows[0] ? `created_at=${JSON.stringify(rows[0]["created_at"])} "created at"=${JSON.stringify(rows[0]["created at"])}` : "no orders",
  );
  probe.note(
    "amount_dollars / amount_cents types",
    rows[0] ? `${typeof rows[0]["amount_dollars"]} (${String(rows[0]["amount_dollars"])}) / ${typeof rows[0]["amount_cents"]} (${String(rows[0]["amount_cents"])})` : "no orders",
  );
  probe.note("a currency field on the order?", rows[0] ? (("currency" in rows[0]) ? String(rows[0]["currency"]) : "absent — value is stated with currency null") : "no orders");
  probe.note("meta.pagination", JSON.stringify((first!.body as Page).meta?.pagination ?? null));

  probe.head("SECTION 2 — ORDERING: is the list newest-first? (the walk's one assumption)");
  await pace(600);
  const big = await probe.section("page 1", () => attemptJson(probe, `${API}/orders?limit=250&page=1`, { headers }));
  const p1 = big?.ok ? items(big.body) : [];
  if (p1.length < 2) {
    probe.skip("page 1 is sorted newest-first", `only ${p1.length} order(s) on this site — nothing to compare`);
  } else {
    const dates = p1.map(ms);
    const descending = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
    const ascending = dates.every((d, i) => i === 0 || d >= dates[i - 1]);
    probe.check(
      "page 1 runs newest-first (descending created_at)",
      descending,
      `first=${dateOf(p1[0])} last=${dateOf(p1[p1.length - 1])} — ${descending ? "descending" : ascending ? "ASCENDING: the connector's stop rule reads nothing; fix it before trusting a sync" : "unsorted"}`,
    );
    const outOfOrder = dates.filter((d, i) => i > 0 && d > dates[i - 1]).length;
    probe.note("rows out of descending order on page 1", `${outOfOrder} of ${dates.length}`);
  }
  const pagination = (big?.ok ? (big.body as Page).meta?.pagination : null) ?? {};
  const total = Number(pagination["total_pages"] ?? 1);
  probe.note("total_pages / total_items at limit=250", `${total} / ${String(pagination["total_items"])}`);
  if (total > 1 && p1.length > 0) {
    await pace(600);
    const last = await probe.section("last page", () => attemptJson(probe, `${API}/orders?limit=250&page=${total}`, { headers }));
    const pn = last?.ok ? items(last.body) : [];
    if (pn.length > 0) {
      probe.check(
        "the LAST page is older than the first (pages descend too)",
        ms(pn[pn.length - 1]) <= ms(p1[0]),
        `page 1 newest=${dateOf(p1[0])} · page ${total} oldest=${dateOf(pn[pn.length - 1])}`,
      );
    }
  }

  probe.head("SECTION 3 — there is no date filter: an unknown parameter must not change the result");
  await pace(600);
  const plain = await probe.section("unfiltered", () => attemptJson(probe, `${API}/orders?limit=50`, { headers }));
  await pace(600);
  const filtered = await probe.section("with a date-ish parameter", () => attemptJson(probe, `${API}/orders?limit=50&created_at__gte=2099-01-01T00:00:00Z&since=2099-01-01T00:00:00Z`, { headers }));
  if (plain?.ok && filtered?.ok) {
    probe.check(
      "a far-future date parameter is IGNORED (so the window has to be applied client-side)",
      items(plain.body).length === items(filtered.body).length,
      `unfiltered=${items(plain.body).length} with-parameter=${items(filtered.body).length} — a smaller number would mean an undocumented filter exists and the walk should use it`,
    );
  }

  probe.head("SECTION 4 — page size and rate-limit headers");
  await pace(600);
  const capped = await probe.section("limit=1000", () => attemptJson(probe, `${API}/orders?limit=1000`, { headers }));
  if (capped?.ok) probe.note("rows returned for limit=1000 (documented maximum is 250)", String(items(capped.body).length));
  const res = await fetch(`${API}/orders?limit=1`, { headers });
  probe.bump();
  probe.note(
    "rate-limit headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none (the published limit is 120 requests/minute per site, 10 concurrent)",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
