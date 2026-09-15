/**
 * Fathom `/meetings` — RAW EVIDENCE about the request `src/connectors/fathom.ts`
 * actually sends.
 *
 * ═══ WHY THIS EXISTS, AND WHY IT IS BEING WRITTEN LATE ═══
 *
 * A connection was made with a real key on 15 Sep 2026 and returned "0 loaded ·
 * No records returned" against an account with meetings recorded that same day.
 * The database confirmed it: zero events, zero raw events, zero deliveries, and
 * a `sync_state` row showing the poll ran and found nothing.
 *
 * The connector was written entirely from the published docs and every fact in
 * it still checks out against them — `GET https://api.fathom.ai/external/v1`,
 * `X-Api-Key`, `items` + `next_cursor`, `created_after`. What had never
 * happened was a single live request. THIS FILE WAS THE SCAFFOLD THE GENERATOR
 * LEFT BEHIND: `https://api.example.com/v1`, `Authorization: Bearer`, an
 * `/events` path, a `{data:[]}` envelope and an `updated_after` parameter that
 * Fathom does not have. It asserted nothing about Fathom and would have passed
 * against nothing, which is how `verified: { live: null }` in the catalog came
 * to be the only honest record of the connector's status.
 *
 * ═══ WHAT THIS MEASURES, AND WHY EACH ONE ═══
 *
 * "Zero rows" has exactly four causes and they need different fixes, so each
 * gets its own control. Reading the response to one request cannot separate
 * them; reading the DIFFERENCE between paired requests can.
 *
 *   1. THE KEY CANNOT SEE THESE MEETINGS. Fathom's help centre is explicit:
 *      "API keys are created at the user level, and your key can access
 *      meetings recorded by you or shared to your Team." A key minted by one
 *      teammate returns an empty list for another's recordings, with a 200 and
 *      no error. Section 2's unfiltered request is the control: if THAT is
 *      empty, no parameter is at fault and the key is looking at an empty
 *      account.
 *   2. THE DATE FILTER EXCLUDES EVERYTHING. Section 3 asks the same question
 *      with and without `created_after`. A filter that is honoured returns
 *      fewer rows for a tighter bound and the same rows for a loose one;
 *      a filter that is silently rejected returns identical sets.
 *   3. THE AUTH MODE IS WRONG. The reference lists `X-Api-Key` AND
 *      `Authorization: Bearer`, which are two different schemes — the second is
 *      for OAuth access tokens. Section 4 sends the key both ways. If Bearer
 *      works and the header does not, the connector's `KEY_HEADER` is wrong.
 *   4. THE ROWS COME BACK BUT WE DROP THEM. `toCanonical` returns null without
 *      an `id`, and dates the row from `scheduled_start_time`. Section 5 prints
 *      the field names Fathom actually sends so a mapper built on the docs can
 *      be checked against the payload rather than against the prose.
 *
 * ═══ REPORTING RULES, same as the Calendly and Close probers ═══
 *
 * `check()` requires an `observed` argument — a check that cannot say what it
 * saw cannot be written. No verdict strings: this prints measurements and a
 * human decides. Nothing here writes, and no meeting content is printed —
 * counts, ids, field NAMES and timestamps only, because a transcript is
 * somebody's conversation.
 *
 * Run: `FATHOM_API_KEY=… pnpm tsx scripts/verify-fathom.ts`
 */
import { createProbe, attemptJson, requireEnv, pace } from "./lib/probe";

/** Kept in step with `API` in src/connectors/fathom.ts. */
const API = "https://api.fathom.ai/external/v1";

const probe = createProbe("Fathom");
const key = requireEnv("FATHOM_API_KEY", "a Fathom API key from Settings → API Access");

/** The header the connector uses. See `KEY_HEADER` in the connector. */
const keyHeaders = { "x-api-key": key };

type Page = { items?: unknown[]; next_cursor?: string | null };

const asPage = (body: unknown): Page => (body && typeof body === "object" ? (body as Page) : {});
const rows = (body: unknown): unknown[] => (Array.isArray(asPage(body).items) ? (asPage(body).items as unknown[]) : []);
const idsOf = (body: unknown): string[] =>
  rows(body)
    .map((r) => (r && typeof r === "object" ? String((r as Record<string, unknown>).id ?? "") : ""))
    .filter(Boolean);

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

async function main() {
  probe.head("SECTION 1 — does the endpoint answer at all?");
  const first = await probe.section("list", () => attemptJson(probe, `${API}/meetings`, { headers: keyHeaders }));
  if (!first) return probe.report();
  probe.check("GET /meetings responds 2xx with X-Api-Key", first.ok, `HTTP ${first.status}`);
  if (!first.ok) {
    // A 401/403 here is the whole answer and every later section would be noise.
    probe.note("error body", String(first.body).slice(0, 300));
    return probe.report();
  }
  probe.note("top-level keys", Object.keys(asPage(first.body)).join(", ") || "(none)");
  probe.check(
    "the envelope is { items, next_cursor } as the connector expects",
    Array.isArray(asPage(first.body).items),
    `items is ${Array.isArray(asPage(first.body).items) ? "an array" : typeof asPage(first.body).items}`,
  );

  probe.head("SECTION 2 — THE CONTROL: can this key see ANY meeting, unfiltered?");
  /**
   * The single most important measurement in this file. If an unfiltered
   * request is empty, no parameter is to blame and the question becomes "which
   * Fathom user minted this key" — their keys are user-scoped and reach only
   * that person's recordings plus what is shared to their Team.
   */
  const unfiltered = rows(first.body);
  probe.check(
    "an unfiltered /meetings returns at least one meeting",
    unfiltered.length > 0,
    `${unfiltered.length} item(s), next_cursor=${asPage(first.body).next_cursor ?? "null"}`,
  );
  if (unfiltered.length === 0) {
    probe.note(
      "what an empty unfiltered list means",
      "the key is valid and sees nothing — it was minted by a user with no recordings, " +
        "or the recordings are not shared to that user's Team. Not a connector bug.",
    );
  }

  probe.head("SECTION 3 — is `created_after` HONOURED, or accepted and ignored?");
  await pace(1100); // 60/min; stay well inside it.
  const wide = await probe.section("created_after 30d", () =>
    attemptJson(probe, `${API}/meetings?created_after=${encodeURIComponent(iso(30))}`, { headers: keyHeaders }),
  );
  await pace(1100);
  const future = await probe.section("created_after in the future", () =>
    attemptJson(probe, `${API}/meetings?created_after=${encodeURIComponent("2099-01-01T00:00:00Z")}`, {
      headers: keyHeaders,
    }),
  );
  if (wide?.ok && future?.ok) {
    const w = idsOf(wide.body);
    const f = idsOf(future.body);
    probe.note("30-day window", `${w.length} item(s)`);
    probe.note("future bound", `${f.length} item(s)`);
    /**
     * The control that separates "the filter works" from "the filter is
     * ignored": a bound in 2099 must exclude everything. Identical counts mean
     * the parameter is being dropped, and a connector that trusts it would walk
     * the same page forever.
     */
    probe.check(
      "a future `created_after` returns fewer rows than a 30-day one (the parameter is honoured)",
      f.length < w.length || (w.length === 0 && f.length === 0),
      `30d=${w.length} future=${f.length}`,
    );
    if (unfiltered.length > 0) {
      probe.check(
        "the 30-day window reaches the meetings an unfiltered call returns",
        w.length > 0,
        `unfiltered=${unfiltered.length} within-30d=${w.length}` +
          (w.length === 0 ? "  ← the filter is what empties the connector's request" : ""),
      );
    }
  }

  probe.head("SECTION 4 — which auth mode does the key actually work with?");
  await pace(1100);
  const bearer = await probe.section("bearer", () =>
    attemptJson(probe, `${API}/meetings`, { headers: { authorization: `Bearer ${key}` } }),
  );
  if (bearer) {
    probe.note("Authorization: Bearer <api key>", `HTTP ${bearer.status}, ${rows(bearer.body).length} item(s)`);
    probe.check(
      "X-Api-Key is the correct header for an API key (the connector's choice)",
      first.ok,
      `x-api-key=HTTP ${first.status}, bearer=HTTP ${bearer.status}`,
    );
  }

  probe.head("SECTION 5 — do the fields the mapper reads actually exist?");
  const sample = (unfiltered[0] ?? rows(wide?.ok ? wide.body : null)[0]) as Record<string, unknown> | undefined;
  if (!sample) {
    probe.skip("field shape", "no meeting came back, so there is nothing to inspect");
  } else {
    // NAMES ONLY — a transcript or a summary is somebody's conversation.
    probe.note("fields Fathom returns", Object.keys(sample).sort().join(", "));
    for (const field of ["id", "scheduled_start_time", "created_at", "recorded_by", "calendar_invitees"]) {
      probe.check(
        `toCanonical reads \`${field}\` and the payload has it`,
        field in sample,
        field in sample ? `present (${typeof sample[field]})` : "ABSENT — the mapper would fall back or drop the row",
      );
    }
    /**
     * `toCanonical` returns null without an id, which is the silent path to
     * "0 loaded" even when rows arrive.
     */
    probe.check(
      "every returned row carries an id",
      idsOf(unfiltered.length > 0 ? first.body : wide?.body).length === rows(unfiltered.length > 0 ? first.body : wide?.body).length,
      `${idsOf(unfiltered.length > 0 ? first.body : wide?.body).length} id(s) across ${rows(unfiltered.length > 0 ? first.body : wide?.body).length} row(s)`,
    );
  }

  probe.head("SECTION 6 — rate-limit headers");
  probe.bump();
  const res = await fetch(`${API}/meetings`, { headers: keyHeaders });
  probe.note(
    "headers",
    [...res.headers.entries()]
      .filter(([k]) => /ratelimit|retry-after/i.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "none",
  );

  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
