/**
 * Live prober for Airtable. Prints measurements; asserts only comparisons
 * between its own responses. Run: AIRTABLE_API_KEY=pat… pnpm tsx scripts/verify-airtable.ts
 *
 * Pace: 5 requests per second per base, 50 per second per token
 * (airtable.com/developers/web/api/rate-limits, read 8 Sep 2026) — every call
 * below is spaced at 250ms, the same gap the connector walks pages at.
 *
 * The question this exists to answer, beyond "does it respond": the connector
 * mirrors a table because list-records has NO time filter. That claim is worth
 * more than a doc line, so section 4 sends the parameter a walk would have used
 * and shows whether the row count moves.
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.airtable.com/v0"; // keep in step with src/connectors/airtable.ts
const GAP = 250;
const probe = createProbe("Airtable");
const key = requireEnv("AIRTABLE_API_KEY", "a personal access token with data.records:read and schema.bases:read");
const headers = { authorization: `Bearer ${key}` };
const rows = (x: unknown) => (Array.isArray((x as { records?: unknown[] })?.records) ? (x as { records: unknown[] }).records.length : -1);

async function main() {
  probe.head("SECTION 1 — bases (scope schema.bases:read)");
  const bases = await probe.section("meta/bases", () => attemptJson(probe, `${API}/meta/bases`, { headers }));
  if (!bases?.ok) {
    probe.check("meta/bases responds 2xx", false, bases ? `HTTP ${bases.status}: ${bases.body}` : "no response");
    probe.report();
  }
  const list = (bases!.body as { bases?: Array<{ id?: string; name?: string; permissionLevel?: string }>; offset?: string }).bases ?? [];
  probe.note("bases", list.map((b) => `${b.id} — ${b.name} (${b.permissionLevel})`).join(", ") || "none");
  probe.note("bases page carries an offset", (bases!.body as { offset?: string }).offset ? "yes" : "no");
  const baseId = list[0]?.id;
  if (!baseId) {
    probe.check("the token can see at least one base", false, "no bases — grant the token a base and re-run");
    probe.report();
  }

  probe.head("SECTION 2 — tables of the first base");
  await pace(GAP);
  const tables = await probe.section("meta/bases/{baseId}/tables", () =>
    attemptJson(probe, `${API}/meta/bases/${baseId}/tables`, { headers }),
  );
  if (!tables?.ok) {
    probe.check("tables responds 2xx", false, tables ? `HTTP ${tables.status}: ${tables.body}` : "no response");
    probe.report();
  }
  const tbls = (tables!.body as { tables?: Array<{ id?: string; name?: string; fields?: Array<{ name?: string; type?: string }> }> }).tables ?? [];
  probe.note("tables", tbls.map((t) => `${t.id} — ${t.name}`).join(", ") || "none");
  const table = tbls[0];
  probe.note("first table's fields", (table?.fields ?? []).map((f) => `${f.name}:${f.type}`).join(", ") || "none");
  if (!table?.id) {
    probe.check("the first base has at least one table", false, "no tables");
    probe.report();
  }

  probe.head("SECTION 3 — records: shape and pagination");
  await pace(GAP);
  const page = await probe.section("records", () =>
    attemptJson(probe, `${API}/${baseId}/${table!.id}?pageSize=5`, { headers }),
  );
  if (page?.ok) {
    const first = ((page.body as { records?: Array<Record<string, unknown>> }).records ?? [])[0];
    probe.note("record keys", first ? Object.keys(first).join(", ") : "no records");
    probe.note("createdTime", first ? String(first["createdTime"]) : "no records");
    probe.check(
      "every record carries a createdTime (the connector's default date)",
      ((page.body as { records?: Array<Record<string, unknown>> }).records ?? []).every((r) => typeof r["createdTime"] === "string"),
      `${rows(page.body)} record(s) read`,
    );
    const offset = (page.body as { offset?: string }).offset;
    probe.note("offset present (the table is longer than 5 rows)", offset ? `yes — ${offset}` : "no");
    if (offset) {
      await pace(GAP);
      const next = await probe.section("records (page 2)", () =>
        attemptJson(probe, `${API}/${baseId}/${table!.id}?pageSize=5&offset=${encodeURIComponent(offset)}`, { headers }),
      );
      if (next?.ok) {
        const ids = (b: unknown) => ((b as { records?: Array<{ id?: string }> }).records ?? []).map((r) => r.id);
        const overlap = ids(next.body).filter((id) => ids(page.body).includes(id));
        probe.check("the offset advances (no page overlaps the one before it)", overlap.length === 0, `overlap: ${overlap.join(", ") || "none"}`);
      }
    }
  }

  probe.head("SECTION 4 — is there ANY time filter? (the mirror's premise)");
  await pace(GAP);
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/${baseId}/${table!.id}?pageSize=100`, { headers }));
  await pace(GAP);
  // `since` is invented on purpose: the docs list no time parameter, so this
  // measures what an unknown parameter DOES. Airtable rejecting it (422) is the
  // clean answer; silently ignoring it is the dangerous one a walk would have
  // been built on, and either way the counts say which happened.
  const bounded = await probe.section("bounded", () =>
    attemptJson(probe, `${API}/${baseId}/${table!.id}?pageSize=100&since=2030-01-01T00:00:00Z`, { headers }),
  );
  if (all?.ok && bounded) {
    probe.note("unbounded rows", String(rows(all.body)));
    probe.note(
      "with an invented `since`",
      bounded.ok ? `HTTP 200, ${rows(bounded.body)} rows` : `HTTP ${bounded.status}: ${bounded.body.slice(0, 200)}`,
    );
    probe.check(
      "no time filter exists — a `since` cannot narrow the read (so the connector must mirror)",
      !bounded.ok || rows(bounded.body) === rows(all.body),
      bounded.ok ? `unbounded=${rows(all.body)} bounded=${rows(bounded.body)}` : `rejected with HTTP ${bounded.status}`,
    );
  }

  probe.head("SECTION 5 — rate-limit headers and the 429 penalty");
  await pace(GAP);
  const res = await fetch(`${API}/${baseId}/${table!.id}?pageSize=1`, { headers });
  probe.bump();
  probe.note(
    "headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none (the published limit is 5 requests/second per base, 50/second per token)",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
