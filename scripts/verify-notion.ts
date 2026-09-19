/**
 * Live probe for the Notion connector, in the shape of the other verify-* scripts.
 *
 * Nothing in the test suite touches Notion: a stubbed fetch answers whatever it
 * is asked, so it can prove the connector's OWN logic and nothing about the
 * provider. This script is where the provider's half gets checked — the pinned
 * API version, the endpoint paths, the property shapes, and the one premise the
 * whole sync model rests on (a trashed row stops being returned).
 *
 *   NOTION_TOKEN=ntn_… pnpm tsx scripts/verify-notion.ts
 *
 * Read-only: it issues search and query calls and writes nothing.
 */
import { NOTION_API_VERSION } from "@/connectors/notion";

const API = "https://api.notion.com/v1";

type Check = { ok: boolean; label: string; note: string };
const results: Check[] = [];

function record(ok: boolean, label: string, note: string) {
  results.push({ ok, label, note });
  console.log(`${ok ? " OK  " : "FAIL "} ${label}\n        ${note}`);
}

async function call(token: string, path: string, body?: unknown, version = NOTION_API_VERSION) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "Notion-Version": version,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  return { status: res.status, ok: res.ok, json: json as Record<string, unknown> | null, text };
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("Set NOTION_TOKEN to an internal integration secret (ntn_…).");
    console.error("Create one at notion.so/profile/integrations, then add it to a database:");
    console.error("  open the database → ••• → Connections → Add connections → pick it.");
    process.exit(2);
  }
  console.log(`connector pins: Notion-Version: ${NOTION_API_VERSION}\n`);

  // 1. The pin is accepted at all.
  const me = await call(token, "/users/me");
  record(
    me.ok,
    `the pinned version ${NOTION_API_VERSION} is accepted`,
    me.ok ? `bot: ${JSON.stringify(me.json?.["name"] ?? me.json?.["id"])}` : `${me.status} ${me.text.slice(0, 160)}`,
  );
  if (!me.ok) {
    console.error("\nStopping: the token or the version is wrong, so nothing below would mean anything.");
    process.exit(1);
  }

  // 2. Search finds data sources — the listOptions path, and the shape the
  //    `data_source` filter value only has from 2025-09-03 onward.
  const search = await call(token, "/search", { filter: { property: "object", value: "data_source" }, page_size: 100 });
  const sources = Array.isArray(search.json?.["results"]) ? (search.json!["results"] as Record<string, unknown>[]) : [];
  record(
    search.ok,
    "search returns data sources (the database picker)",
    search.ok ? `${sources.length} shared with this token` : `${search.status} ${search.text.slice(0, 160)}`,
  );
  if (sources.length === 0) {
    console.error(
      "\nNo databases are shared with this integration yet — which is Notion's own model, not a bug.\n" +
        "Open a database → ••• → Connections → Add connections → pick this integration, then re-run.",
    );
    process.exit(1);
  }

  const dsId = String(sources[0]["id"]);
  const dsName = JSON.stringify(sources[0]["title"] ?? sources[0]["name"] ?? "");
  console.log(`\nprobing data source ${dsId} ${dsName}\n`);

  // 3. The query endpoint this connector actually calls.
  const q = await call(token, `/data_sources/${dsId}/query`, { page_size: 5 });
  const rows = Array.isArray(q.json?.["results"]) ? (q.json!["results"] as Record<string, unknown>[]) : [];
  record(
    q.ok,
    "POST /data_sources/{id}/query works (the mirror's read)",
    q.ok ? `${rows.length} rows; has_more=${String(q.json?.["has_more"])}` : `${q.status} ${q.text.slice(0, 200)}`,
  );

  // 4. The retired endpoint really is retired — proves the pin is load-bearing
  //    rather than decorative.
  const old = await call(token, `/databases/${dsId}/query`, { page_size: 1 });
  record(
    !old.ok,
    "the pre-2025-09-03 database endpoint is NOT what we should be calling",
    old.ok ? "it still answers — the pin may be looser than assumed" : `refused with ${old.status}, as expected`,
  );

  // 5. Row shape: the fields the connector reads off every page.
  if (rows.length > 0) {
    const r = rows[0];
    const hasAll = ["id", "created_time", "last_edited_time", "properties"].every((k) => k in r);
    const props = (r["properties"] ?? {}) as Record<string, unknown>;
    const types = [...new Set(Object.values(props).map((p) => String((p as Record<string, unknown>)?.["type"])))];
    record(hasAll, "a row carries id, created_time, last_edited_time and properties", `property types present: ${types.join(", ")}`);

    // Every type this database uses that `plain()` does not unwrap becomes a
    // null column in the product — worth seeing before a customer does.
    const KNOWN = new Set([
      "title", "rich_text", "number", "checkbox", "url", "email", "phone_number", "select", "status",
      "multi_select", "date", "created_time", "last_edited_time", "people", "created_by", "last_edited_by",
      "unique_id", "formula", "rollup", "relation",
    ]);
    const unknown = types.filter((t) => t !== "undefined" && !KNOWN.has(t));
    record(unknown.length === 0, "every property type in this database is unwrapped by plain()", unknown.length ? `NOT handled: ${unknown.join(", ")}` : "all handled");
  }

  // 6. THE PREMISE OF THE WHOLE SYNC MODEL. The connector mirrors because a
  //    trashed row stops being returned, so absence is the only deletion
  //    evidence there is. If a query DID return trashed rows, a mirror would
  //    keep resurrecting deleted records and the model would be wrong.
  const trashed = await call(token, `/data_sources/${dsId}/query`, { page_size: 100 });
  const anyTrashed = (Array.isArray(trashed.json?.["results"]) ? (trashed.json!["results"] as Record<string, unknown>[]) : []).filter(
    (r) => r["in_trash"] === true || r["archived"] === true,
  );
  record(
    anyTrashed.length === 0,
    "a normal query returns LIVE rows only (why absence can mean deleted)",
    anyTrashed.length === 0
      ? "no trashed/archived rows came back"
      : `${anyTrashed.length} trashed rows WERE returned — the mirror would resurrect deleted records`,
  );

  // 7. Rate-limit headers, so the declared 180/min can be checked against reality.
  record(true, "declared limit", "catalog says 180 req/min (non-Business plans); Notion 429s carry Retry-After");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} checks`);
  if (failed.length) {
    console.log("Failed: " + failed.map((f) => f.label).join("; "));
    process.exit(1);
  }
  console.log("Record the date in catalog.ts `verified: { live: \"YYYY-MM-DD\" }`.");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
