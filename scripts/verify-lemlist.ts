/**
 * Live prober for lemlist. Prints measurements; asserts only comparisons
 * between its own responses. Run: LEMLIST_API_KEY=… pnpm tsx scripts/verify-lemlist.ts
 * Pace: the published limit is 20 requests per 2 seconds per API key, so a
 * 150ms gap keeps a whole run inside one window's worth of budget.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.lemlist.com/api"; // keep in step with src/connectors/lemlist.ts
const probe = createProbe("lemlist");
const key = requireEnv("LEMLIST_API_KEY", "an API key from Settings → Integrations → API");
// Basic auth with an EMPTY username: "THERE IS A COLON before your API key".
const headers = { authorization: `Basic ${Buffer.from(`:${key}`).toString("base64")}` };
const rows = (x: unknown): Array<Record<string, unknown>> => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);
const count = (x: unknown) => (Array.isArray(x) ? x.length : -1);
const ids = (x: unknown) => new Set(rows(x).map((r) => String(r["_id"])));

async function main() {
  probe.head("SECTION 1 — GET /activities?version=v2 answers, and what an activity carries");
  const listed = await probe.section("activities", () => attemptJson(probe, `${API}/activities?version=v2&limit=5`, { headers }));
  if (!listed) probe.report();
  const page = listed!;
  probe.check("activities list responds 2xx", page.ok, `HTTP ${page.status}${page.ok ? "" : ` — ${String(page.body).slice(0, 200)}`}`);
  if (page.ok) {
    probe.check("the response is a bare JSON array (not an envelope)", Array.isArray(page.body), `typeof=${Array.isArray(page.body) ? "array" : typeof page.body}`);
    const a = rows(page.body)[0];
    probe.note("first activity's fields", a ? Object.keys(a).join(", ") : "no activities");
    probe.note("_id / type / createdAt / leadEmail", a ? `${a["_id"]} / ${a["type"]} / ${a["createdAt"]} / ${a["leadEmail"]}` : "no activities");
    probe.note("types on this page (the walk keeps only the emails* ones)", rows(page.body).map((r) => String(r["type"])).join(", ") || "none");
    probe.note("createdAt order as returned (docs specify none)", rows(page.body).map((r) => String(r["createdAt"])).join(" | ") || "none");
  }

  probe.head("SECTION 2 — is `version=v2` load-bearing? (v2 vs the default)");
  await pace(150);
  const v1 = await probe.section("no version parameter", () => attemptJson(probe, `${API}/activities?limit=5`, { headers }));
  if (v1) {
    probe.note("HTTP without version=v2", String(v1.status));
    const a = rows(v1.ok ? v1.body : null)[0];
    probe.note("fields WITHOUT version=v2", a ? Object.keys(a).join(", ") : v1.ok ? "empty array" : String(v1.body).slice(0, 200));
    if (page.ok && v1.ok) {
      const v2Keys = Object.keys(rows(page.body)[0] ?? {}).sort().join(",");
      const v1Keys = Object.keys(a ?? {}).sort().join(",");
      probe.note("shapes differ between v2 and the default", v2Keys === v1Keys ? "no — identical field sets" : "yes");
    }
  }

  probe.head("SECTION 3 — do minDate/maxDate FILTER on createdAt? (bounded vs unbounded control)");
  await pace(150);
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/activities?version=v2&limit=100`, { headers }));
  await pace(150);
  const future = await probe.section("far-future minDate", () => attemptJson(probe, `${API}/activities?version=v2&limit=100&minDate=2030-01-01T00:00:00.000Z`, { headers }));
  if (all?.ok && future?.ok) {
    probe.check(
      "a far-future minDate returns zero rows (the parameter is honoured — Close's lesson)",
      count(future.body) === 0,
      `unbounded=${count(all.body)} bounded=${count(future.body)}`,
    );
  }
  await pace(150);
  const past = await probe.section("far-past maxDate", () => attemptJson(probe, `${API}/activities?version=v2&limit=100&maxDate=2000-01-01T00:00:00.000Z`, { headers }));
  if (past?.ok) probe.check("a far-past maxDate returns zero rows", count(past.body) === 0, `rows=${count(past.body)}`);
  // The claim under test: minDate bounds createdAt, which is what the walk's
  // watermark advances on. A row below the bound would strand records.
  if (all?.ok) {
    const oldest = rows(all.body).map((r) => String(r["createdAt"])).sort()[0];
    if (oldest) {
      const cut = new Date(Date.parse(oldest) + 1000).toISOString();
      await pace(150);
      const bounded = await probe.section("minDate just above the oldest row", () => attemptJson(probe, `${API}/activities?version=v2&limit=100&minDate=${cut}`, { headers }));
      if (bounded?.ok) {
        const below = rows(bounded.body).filter((r) => Date.parse(String(r["createdAt"])) < Date.parse(cut));
        probe.check("every returned row has createdAt >= minDate", below.length === 0, `rows=${count(bounded.body)} below the bound=${below.length}`);
      }
    }
  }

  probe.head("SECTION 4 — paging: is `limit` capped at 100, and does `offset` skip?");
  await pace(150);
  const over = await probe.section("limit=101", () => attemptJson(probe, `${API}/activities?version=v2&limit=101`, { headers }));
  if (over) probe.note("limit=101", over.ok ? `HTTP ${over.status}, ${count(over.body)} rows (documented cap: 100)` : `HTTP ${over.status} — ${String(over.body).slice(0, 200)}`);
  if (all?.ok && count(all.body) > 1) {
    await pace(150);
    const skipped = await probe.section("offset=1", () => attemptJson(probe, `${API}/activities?version=v2&limit=100&offset=1`, { headers }));
    if (skipped?.ok) {
      const first = rows(all.body)[0];
      probe.check(
        "offset=1 drops exactly the first row of offset=0 (offset skips records)",
        !ids(skipped.body).has(String(first["_id"])),
        `first _id=${first["_id"]} present at offset=1: ${ids(skipped.body).has(String(first["_id"]))}`,
      );
    }
  }

  probe.head("SECTION 5 — webhooks: does GET /hooks ever hand back a secret?");
  await pace(150);
  const hooks = await probe.section("hooks", () => attemptJson(probe, `${API}/hooks?version=v2`, { headers }));
  if (hooks) {
    probe.note("GET /hooks", hooks.ok ? `HTTP ${hooks.status}, ${JSON.stringify(hooks.body).slice(0, 300)}` : `HTTP ${hooks.status} — ${String(hooks.body).slice(0, 200)}`);
    if (hooks.ok) {
      const leaks = rows(hooks.body).some((h) => "secret" in h);
      probe.check("no hook echoes its secret back (the docs say it never is)", !leaks, leaks ? "a `secret` field is present" : "absent");
    }
  }

  probe.head("SECTION 6 — rate-limit headers");
  await pace(150);
  const res = await fetch(`${API}/activities?version=v2&limit=1`, { headers });
  probe.bump();
  probe.note(
    "headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after|signature/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none (the published limit is 20 requests per 2 seconds per key)",
  );
  probe.note("X-RateLimit-Reset shape", res.headers.get("x-ratelimit-reset") ?? "absent");
  probe.note(
    "a signature header on responses",
    [...res.headers.keys()].some((k) => /signature/i.test(k)) ? "present" : "absent — as the docs say, verification is the secret echoed in the delivery body",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
