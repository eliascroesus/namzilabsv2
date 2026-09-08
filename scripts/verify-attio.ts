/**
 * Live prober for Attio. Prints measurements; asserts only comparisons
 * between its own responses. Run: ATTIO_API_KEY=… pnpm tsx scripts/verify-attio.ts
 *
 * The three beliefs the connector rests on and no fixture can test:
 *   1. `created_at` is FILTERABLE on the records query (the watermark),
 *   2. `created_at` is SORTABLE as a plain attribute slug (offset paging),
 *   3. a short page really is the end of the result set.
 * Pace: the published read limit is 100 requests/second, and the query
 * endpoint scores each request over a 10-second sliding window.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.attio.com/v2"; // keep in step with src/connectors/attio.ts
const probe = createProbe("Attio");
const key = requireEnv("ATTIO_API_KEY", "an access token — Workspace settings → Developers → Access tokens");
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const rows = (x: unknown): Array<Record<string, unknown>> => ((x as { data?: unknown[] })?.data ?? []).filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;
const createdOf = (r: Record<string, unknown> | undefined) => (r ? String(r["created_at"]) : "—");

const query = (object: string, body: unknown) => attemptJson(probe, `${API}/objects/${object}/records/query`, { method: "POST", headers, body: JSON.stringify(body) });

async function main() {
  probe.head("SECTION 1 — objects in this workspace");
  const objects = await probe.section("objects", () => attemptJson(probe, `${API}/objects`, { headers }));
  if (!objects?.ok) {
    probe.check("GET /v2/objects responds 2xx", false, objects ? `HTTP ${objects.status}: ${String(objects.body).slice(0, 200)}` : "no response");
    probe.report();
  }
  const slugs = rows(objects!.body).map((o) => String(o["api_slug"]));
  probe.note("api_slugs", slugs.join(", ") || "none");
  const object = slugs.includes("deals") ? "deals" : (slugs.find((s) => s === "people") ?? slugs[0]);
  probe.note("object probed below", object ?? "none");
  if (!object) probe.report();

  probe.head("SECTION 2 — records query: shape and ordering");
  await pace(300);
  const asc = await probe.section("query asc", () => query(object, { sorts: [{ direction: "asc", attribute: "created_at" }], limit: 5, offset: 0 }));
  if (asc?.ok) {
    const items = rows(asc.body);
    probe.check("sorting by the `created_at` attribute slug is accepted", true, `HTTP ${asc.status}, ${items.length} row(s)`);
    probe.note("first row's top-level fields", items[0] ? Object.keys(items[0]).join(", ") : "no records");
    probe.note("created_at values (asc)", items.map(createdOf).join(", ") || "none");
    probe.note("value attribute keys on the first row", items[0] ? Object.keys((items[0]["values"] ?? {}) as Record<string, unknown>).join(", ") : "—");
    probe.note("stage value (raw)", JSON.stringify(((items[0]?.["values"] ?? {}) as Record<string, unknown>)["stage"] ?? null).slice(0, 300));
  } else {
    probe.check("sorting by the `created_at` attribute slug is accepted", false, asc ? `HTTP ${asc.status}: ${String(asc.body).slice(0, 200)}` : "no response");
  }

  await pace(300);
  const desc = await probe.section("query desc", () => query(object, { sorts: [{ direction: "desc", attribute: "created_at" }], limit: 5, offset: 0 }));
  if (asc?.ok && desc?.ok) {
    const a = createdOf(rows(asc.body)[0]);
    const d = createdOf(rows(desc.body)[0]);
    probe.check("asc and desc disagree on the first row (the sort is honoured)", rows(desc.body).length < 2 || a !== d, `asc=${a} desc=${d}`);
  }

  probe.head("SECTION 3 — does the created_at filter FILTER? (bounded vs unbounded control)");
  await pace(300);
  const all = await probe.section("unbounded", () => query(object, { limit: 50, offset: 0 }));
  await pace(300);
  const future = await probe.section("bounded far future", () => query(object, { filter: { created_at: { $gte: "2030-01-01T00:00:00Z" } }, limit: 50, offset: 0 }));
  if (all?.ok && future?.ok) {
    probe.check(
      "a far-future `created_at.$gte` returns zero rows (the filter is honoured)",
      rows(future.body).length === 0,
      `unbounded=${rows(all.body).length} bounded=${rows(future.body).length}`,
    );
  } else if (future && !future.ok) {
    probe.check("a far-future `created_at.$gte` is accepted at all", false, `HTTP ${future.status}: ${String(future.body).slice(0, 300)}`);
  }

  await pace(300);
  const epoch = await probe.section("bounded epoch", () => query(object, { filter: { created_at: { $gte: "2000-01-01T00:00:00Z" } }, limit: 50, offset: 0 }));
  if (all?.ok && epoch?.ok) {
    probe.check("an epoch `created_at.$gte` returns the same rows as unbounded", rows(epoch.body).length === rows(all.body).length, `unbounded=${rows(all.body).length} epoch=${rows(epoch.body).length}`);
  }

  probe.head("SECTION 4 — limit/offset paging");
  await pace(300);
  const page1 = await probe.section("limit 2 offset 0", () => query(object, { sorts: [{ direction: "asc", attribute: "created_at" }], limit: 2, offset: 0 }));
  await pace(300);
  const page2 = await probe.section("limit 2 offset 2", () => query(object, { sorts: [{ direction: "asc", attribute: "created_at" }], limit: 2, offset: 2 }));
  if (page1?.ok && page2?.ok) {
    const idOf = (r: Record<string, unknown> | undefined) => String(((r?.["id"] ?? {}) as Record<string, unknown>)["record_id"] ?? "—");
    const overlap = rows(page1.body).map(idOf).filter((id) => rows(page2.body).map(idOf).includes(id));
    probe.check("offset advances the window (no overlap between page 1 and page 2)", overlap.length === 0, `overlap=${overlap.join(",") || "none"}`);
    probe.note("page sizes", `page1=${rows(page1.body).length} page2=${rows(page2.body).length}`);
  }

  probe.head("SECTION 5 — attributes and lists (where a stage actually lives)");
  await pace(300);
  const attrs = await probe.section("attributes", () => attemptJson(probe, `${API}/objects/${object}/attributes?limit=100`, { headers }));
  if (attrs?.ok) {
    const status = rows(attrs.body).filter((a) => a["type"] === "status");
    probe.note("status attributes", status.map((a) => `${String(a["api_slug"])} (${String(a["title"])})`).join(", ") || "none");
    probe.note("currency attributes", rows(attrs.body).filter((a) => a["type"] === "currency").map((a) => String(a["api_slug"])).join(", ") || "none");
  }
  await pace(300);
  const lists = await probe.section("lists", () => attemptJson(probe, `${API}/lists`, { headers }));
  if (lists?.ok) probe.note("lists (pipelines modelled as lists are NOT read by this connector)", rows(lists.body).map((l) => String(l["api_slug"])).join(", ") || "none");

  probe.head("SECTION 6 — webhooks and rate-limit headers");
  await pace(300);
  const hooks = await probe.section("webhooks", () => attemptJson(probe, `${API}/webhooks`, { headers }));
  if (hooks?.ok) probe.note("existing webhooks", rows(hooks.body).map((w) => `${String(((w["id"] ?? {}) as Record<string, unknown>)["webhook_id"])} → ${String(w["target_url"])} [${String(w["status"])}]`).join("; ") || "none");
  else if (hooks) probe.note("webhooks list", `HTTP ${hooks.status} — the token may lack webhook:read-write`);

  await pace(300);
  const res = await fetch(`${API}/objects`, { headers });
  probe.bump();
  probe.note(
    "rate-limit headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none (the published limits are 100 reads/second and 25 writes/second, plus a 10-second scored window on queries)",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
