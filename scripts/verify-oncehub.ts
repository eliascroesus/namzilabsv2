/**
 * Live prober for OnceHub. Prints measurements; asserts only comparisons
 * between its own responses. Run: ONCEHUB_API_KEY=… pnpm tsx scripts/verify-oncehub.ts
 *
 * What it is here to settle (help.oncehub.com/developers, read 8 Sep 2026):
 * the `API-Key` header, that the server really is /v2, that
 * `last_updated_time.gt` FILTERS (it is the watermark), that the envelope is
 * { data, has_more } with `after` paging, and what the booking rows actually
 * carry — the plan's `customer.email` does not exist, `form_submission.email`
 * does. Pace: the published limit is 5 requests per second per account and
 * 200 per 5 minutes per IP.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.oncehub.com/v2"; // keep in step with src/connectors/oncehub.ts
const probe = createProbe("OnceHub");
const key = requireEnv("ONCEHUB_API_KEY", "an API key from Settings → API & Webhooks (app.oncehub.com/integrations/api)");
const headers = { "api-key": key };

type Row = Record<string, unknown>;
const rows = (x: unknown): Row[] => (Array.isArray((x as { data?: unknown[] })?.data) ? ((x as { data: Row[] }).data ?? []) : []);
const dig = (r: Row | undefined, path: string): string => {
  let cur: unknown = r;
  for (const part of path.split(".")) cur = (cur as Row | undefined)?.[part];
  return cur == null ? "absent" : typeof cur === "object" ? JSON.stringify(cur).slice(0, 120) : String(cur);
};

async function main() {
  probe.head("SECTION 1 — the API-Key header and the /v2 server");
  const test = await probe.section("validate key", () => attemptJson(probe, `${API}/test`, { headers }));
  probe.check("GET /v2/test accepts the API-Key header", Boolean(test?.ok), test ? `HTTP ${test.status} ${JSON.stringify(test.body).slice(0, 160)}` : "no response");
  await pace(300);
  const unversioned = await probe.section("unversioned host", () => attemptJson(probe, "https://api.oncehub.com/bookings?limit=1", { headers }));
  probe.note("GET /bookings (no /v2) — the plan's path", unversioned ? `HTTP ${unversioned.status}` : "no response");

  probe.head("SECTION 2 — the bookings list: envelope and row shape");
  await pace(300);
  const page = await probe.section("bookings", () => attemptJson(probe, `${API}/bookings?limit=5&expand=owner`, { headers }));
  if (!page?.ok) {
    probe.check("bookings list responds 2xx", false, page ? `HTTP ${page.status}: ${page.body}` : "no response");
    probe.report();
  }
  probe.note("top-level keys", Object.keys((page!.body ?? {}) as Row).join(", ") || "none");
  probe.note("has_more present", "has_more" in ((page!.body ?? {}) as Row) ? "yes" : "NO — pagination must fall back to the Link header");
  const first = rows(page!.body)[0];
  probe.note("first booking's fields", first ? Object.keys(first).join(", ") : "no bookings in this account");
  if (!first) probe.report();
  for (const path of ["id", "status", "creation_time", "starting_time", "last_updated_time", "form_submission.email", "owner.email", "tracking_id", "payment_information.amount_charged", "payment_information.currency"]) {
    probe.note(path, dig(first, path));
  }
  probe.check(
    "the customer's email is form_submission.email (the plan's customer.email does not exist)",
    dig(first, "customer.email") === "absent",
    `customer.email=${dig(first, "customer.email")} form_submission.email=${dig(first, "form_submission.email")}`,
  );
  probe.note("statuses on this page", rows(page!.body).map((r) => String(r["status"])).join(", "));

  probe.head("SECTION 3 — does `last_updated_time.gt` FILTER? (bounded vs unbounded control)");
  await pace(300);
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/bookings?limit=50`, { headers }));
  await pace(300);
  const bounded = await probe.section("bounded (far future)", () => attemptJson(probe, `${API}/bookings?limit=50&last_updated_time.gt=2030-01-01T00:00:00Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check(
      "a far-future `last_updated_time.gt` returns zero rows (the watermark axis is honoured)",
      rows(bounded.body).length === 0,
      `unbounded=${rows(all.body).length} bounded=${rows(bounded.body).length}`,
    );
  }
  await pace(300);
  const past = await probe.section("bounded (epoch)", () => attemptJson(probe, `${API}/bookings?limit=50&last_updated_time.gt=1970-01-01T00:00:00Z`, { headers }));
  if (all?.ok && past?.ok) {
    probe.check(
      "an epoch bound returns as much as an unbounded read (no hidden retention cut-off)",
      rows(past.body).length === rows(all.body).length,
      `unbounded=${rows(all.body).length} epoch-bounded=${rows(past.body).length}`,
    );
  }
  await pace(300);
  const byCreation = await probe.section("creation_time.gt", () => attemptJson(probe, `${API}/bookings?limit=50&creation_time.gt=2030-01-01T00:00:00Z`, { headers }));
  probe.note("creation_time.gt=2030 row count (the plan's filter — exists, but bounds the wrong axis)", byCreation?.ok ? String(rows(byCreation.body).length) : `HTTP ${byCreation?.status}`);

  probe.head("SECTION 4 — pagination: has_more + `after` = the last row's id");
  await pace(300);
  const p1 = await probe.section("page 1", () => attemptJson(probe, `${API}/bookings?limit=1`, { headers }));
  const anchor = rows(p1?.ok ? p1.body : null)[0];
  if (p1?.ok && anchor) {
    probe.note("has_more on a one-row page", String((p1.body as Row)["has_more"]));
    await pace(300);
    const p2 = await probe.section("page 2", () => attemptJson(probe, `${API}/bookings?limit=1&after=${encodeURIComponent(String(anchor["id"]))}`, { headers }));
    const second = rows(p2?.ok ? p2.body : null)[0];
    probe.check(
      "`after` = the last row's id moves the window",
      Boolean(second) && second!["id"] !== anchor["id"],
      `page1=${String(anchor["id"])} page2=${second ? String(second["id"]) : "empty"}`,
    );
    probe.note("ordering (page1 vs page2 last_updated_time)", `${dig(anchor, "last_updated_time")} → ${dig(second, "last_updated_time")}`);
  }

  probe.head("SECTION 5 — webhook subscriptions and rate-limit headers");
  await pace(300);
  const hooks = await probe.section("webhooks", () => attemptJson(probe, `${API}/webhooks`, { headers }));
  if (hooks?.ok) {
    const h = rows(hooks.body)[0];
    probe.note("existing subscriptions", String(rows(hooks.body).length));
    probe.note("first subscription", h ? `${dig(h, "id")} api_version=${dig(h, "api_version")} secret=${dig(h, "secret") === "absent" ? "absent (v1 — unsigned)" : "present"}` : "none");
  } else {
    probe.note("GET /v2/webhooks", hooks ? `HTTP ${hooks.status}: ${hooks.body.slice(0, 160)}` : "no response");
  }
  await pace(300);
  const res = await fetch(`${API}/bookings?limit=1`, { headers });
  probe.bump();
  probe.note(
    "rate-limit / link headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after|^link$/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none (published: 5 requests per second per account, 200 per 5 minutes per IP)",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
