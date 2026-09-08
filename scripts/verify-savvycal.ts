/**
 * Live prober for SavvyCal (Meetings). Prints measurements; asserts only
 * comparisons between its own responses.
 * Run: SAVVYCAL_API_KEY=pt_secret_… pnpm tsx scripts/verify-savvycal.ts
 *
 * What it is here to settle, because the docs do not:
 *  - the list envelope really is `{ entries, metadata: { after } }`;
 *  - `period=fixed` accepts `from` WITHOUT `until` (the schema marks both
 *    optional, and the connector sends only `from`);
 *  - `from` filters the meeting's START date and nothing else — a far-future
 *    `from` must return zero rows even though old events exist;
 *  - `state=all` and `attendance=any` widen the default `confirmed`/`attending`;
 *  - whether any rate-limit headers come back (developers.savvycal.com publishes
 *    no figure, so the catalog's 60/min is a placeholder until this says otherwise).
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

const API = "https://api.savvycal.com/v1"; // keep in step with src/connectors/savvycal.ts
const probe = createProbe("SavvyCal");
const key = requireEnv("SAVVYCAL_API_KEY", "a personal access token (Settings → Developers → Create a token)");
const headers = { authorization: `Bearer ${key}`, accept: "application/json" };

type Page = { entries?: Array<Record<string, unknown>>; metadata?: Record<string, unknown> };
const entries = (x: unknown): Array<Record<string, unknown>> => (Array.isArray((x as Page)?.entries) ? (x as Page).entries! : []);

async function main() {
  probe.head("SECTION 1 — who the token is");
  const me = await probe.section("me", () => attemptJson(probe, `${API}/me`, { headers }));
  if (!me?.ok) {
    probe.check("/v1/me responds 2xx (the token and the base URL are right)", false, me ? `HTTP ${me.status}: ${me.body}` : "no response");
    probe.report();
  }
  probe.note("me fields", Object.keys(me!.body as Record<string, unknown>).join(", "));

  probe.head("SECTION 2 — the list envelope and the Event's field names");
  await pace(400);
  const page = await probe.section("events", () => attemptJson(probe, `${API}/events?limit=5&state=all&attendance=any&period=all`, { headers }));
  if (page?.ok) {
    probe.note("top-level keys", Object.keys(page.body as Record<string, unknown>).join(", ") || "none");
    probe.note("metadata keys", Object.keys(((page.body as Page).metadata ?? {}) as Record<string, unknown>).join(", ") || "none");
    const first = entries(page.body)[0];
    probe.note("first event's fields", first ? Object.keys(first).join(", ") : "no events");
    if (first) {
      probe.note("dates", ["created_at", "start_at", "end_at", "canceled_at", "rescheduled_at"].map((k) => `${k}=${String(first[k])}`).join(", "));
      probe.note("state", String(first["state"]));
      probe.note("payment", JSON.stringify(first["payment"] ?? null));
      probe.check("payment carries amount_total (cents), not amount", !first["payment"] || "amount_total" in (first["payment"] as object), JSON.stringify(first["payment"] ?? null));
    }
  } else {
    probe.check("events list responds 2xx", false, page ? `HTTP ${page.status}: ${page.body}` : "no response");
  }

  probe.head("SECTION 3 — does `period=fixed` + `from` FILTER, and is `until` optional?");
  await pace(400);
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/events?limit=50&state=all&attendance=any&period=all`, { headers }));
  await pace(400);
  const bounded = await probe.section("from only", () => attemptJson(probe, `${API}/events?limit=50&state=all&attendance=any&period=fixed&direction=asc&from=2030-01-01`, { headers }));
  if (bounded) {
    probe.check("`period=fixed` with `from` and NO `until` is accepted", bounded.ok, bounded.ok ? "HTTP 200" : `HTTP ${bounded.status}: ${bounded.body}`);
  }
  if (all?.ok && bounded?.ok) {
    probe.check(
      "a far-future `from` returns zero rows (the parameter is honoured, on START date)",
      entries(bounded.body).length === 0,
      `unbounded=${entries(all.body).length} bounded=${entries(bounded.body).length}`,
    );
  }
  await pace(400);
  const past = await probe.section("from in the past", () => attemptJson(probe, `${API}/events?limit=50&state=all&attendance=any&period=fixed&direction=asc&from=2000-01-01`, { headers }));
  if (past?.ok) {
    const starts = entries(past.body).map((e) => String(e["start_at"]));
    probe.note("first five start_at, direction=asc", starts.slice(0, 5).join(", ") || "none");
    probe.check("direction=asc really orders by start_at", starts.length < 2 || starts.every((s, i) => i === 0 || s >= starts[i - 1]), starts.slice(0, 5).join(" <= ") || "too few rows");
    const created = entries(past.body).map((e) => String(e["created_at"]));
    probe.note("the same rows' created_at (the watermark axis we do NOT get to filter on)", created.slice(0, 5).join(", ") || "none");
  }

  probe.head("SECTION 4 — do `state` and `attendance` widen the defaults?");
  await pace(400);
  const dflt = await probe.section("defaults", () => attemptJson(probe, `${API}/events?limit=100&period=all`, { headers }));
  await pace(400);
  const wide = await probe.section("widened", () => attemptJson(probe, `${API}/events?limit=100&period=all&state=all&attendance=any`, { headers }));
  if (dflt?.ok && wide?.ok) {
    probe.check(
      "state=all&attendance=any returns at least as much as the defaults (confirmed/attending)",
      entries(wide.body).length >= entries(dflt.body).length,
      `default=${entries(dflt.body).length} widened=${entries(wide.body).length}`,
    );
    probe.note("states present when state=all", [...new Set(entries(wide.body).map((e) => String(e["state"])))].join(", ") || "none");
  }

  probe.head("SECTION 5 — pagination: is `metadata.after` null at the end?");
  await pace(400);
  const one = await probe.section("limit=1", () => attemptJson(probe, `${API}/events?limit=1&state=all&attendance=any&period=all`, { headers }));
  if (one?.ok) {
    const after = ((one.body as Page).metadata ?? {})["after"];
    probe.note("metadata.after on a full page", String(after));
    if (typeof after === "string" && after) {
      await pace(400);
      const next = await probe.section("after=…", () => attemptJson(probe, `${API}/events?limit=1&state=all&attendance=any&period=all&after=${encodeURIComponent(after)}`, { headers }));
      if (next?.ok) {
        probe.check(
          "the cursor advances (a different event id on the next page)",
          entries(next.body)[0]?.["id"] !== entries(one.body)[0]?.["id"],
          `${String(entries(one.body)[0]?.["id"])} → ${String(entries(next.body)[0]?.["id"])}`,
        );
      }
    }
  }

  probe.head("SECTION 6 — rate-limit headers");
  await pace(400);
  const res = await fetch(`${API}/events?limit=1&period=all`, { headers });
  probe.bump();
  probe.note(
    "headers",
    [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") ||
      "none (developers.savvycal.com publishes no figure; the catalog's 60/min is a placeholder)",
  );
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
