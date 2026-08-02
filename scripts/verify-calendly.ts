/**
 * Calendly `/scheduled_events` — RAW EVIDENCE about the parameters the connector
 * depends on.
 *
 * WHY THIS EXISTS. `src/connectors/calendly.ts` is the most parameter-dependent
 * connector here and the only one with no live verification. Its scan alternates
 * outward from now: the past side asks for `sort=start_time:desc` bounded by
 * `min_start_time`/`max_start_time`, the future side asks for the same with
 * `sort=start_time:asc`, and each side steps its `page_token` believing the
 * previous page ended where it thinks. Five parameters, and the traversal is
 * wrong if any one of them is quietly not doing its job.
 *
 * That shape has already been wrong twice. Close sent `date_created__gte` for
 * the life of the connector to an endpoint that filters on `date_updated`;
 * Close's ordering was documented, believed, and checked against the wrong
 * field for months. Neither was findable by reading. Both were findable in one
 * request pair.
 *
 * THE RULE THIS SCRIPT IS BUILT ON: **every parameter gets a CONTROL.** An
 * accepted-and-ignored parameter and a working one produce responses that are
 * indistinguishable in isolation. The only way to tell them apart is to issue
 * the same request without the parameter and compare what came back.
 *
 * AND THE CONTROL HAS TO MATCH THE PARAMETER'S KIND — this is the part that is
 * easy to get wrong:
 *
 *   - a FILTER changes WHICH records come back, so compare **id sets**;
 *   - an ORDERING changes only the SEQUENCE, so an id-set comparison would call
 *     a perfectly working `sort` "ignored" every single time. Compare **id
 *     sequences** instead, and separately observe which field the sequence is
 *     actually sorted by.
 *
 * Reporting rules, same as the Close script and for the same reason:
 *
 * 1. `check()` REQUIRES an `observed` argument. A check that cannot say what it
 *    saw cannot be written.
 * 2. Timestamps are `{raw, ms}` pairs. The provider's string is printed
 *    verbatim; parsing is a separate, reported step, and an unparseable value is
 *    counted rather than coerced into a comparison against NaN.
 * 3. **No verdict strings.** This script reports measurements; a human decides.
 *    The one place a verdict was left in the Close script is the one place it
 *    lied — it printed a conclusion from a single probe while the next line of
 *    its own output contradicted it.
 *
 * Read-only: every request is a GET. Nothing is written anywhere.
 *
 *   CALENDLY_API_TOKEN=eyJ… pnpm tsx scripts/verify-calendly.ts
 *
 * The token is a Calendly **Personal Access Token**:
 * Calendly → Integrations & apps → API & webhooks → Personal Access Tokens →
 * Generate new token (https://calendly.com/integrations/api_webhooks).
 *
 * Env knobs: CALENDLY_SCOPE ("user" — the connector's default — or
 * "organization"), CALENDLY_SKIP_FROM (how far back the skip detector reaches,
 * default 2015-01-01 — widen it if an account has too few events to paginate).
 */

const API = "https://api.calendly.com";

/** The connector's page size, mirrored from `calendly.ts`. */
const COUNT = 100;
/**
 * THE SKIP DETECTOR'S OWN SIZING — and the reason it is not `COUNT` and `25`.
 *
 * The first version of this script walked the connector's own 30-back/90-forward
 * window at 100 and at 25, and on the first live account that window held 23
 * events. Both walks returned "23 unique over 1 pages" and the check PASSED —
 * with no page boundaries in either walk, so nothing about `page_token` was
 * exercised at all. A vacuous pass, from data that satisfied the assumption
 * instead of testing it, which is the same trap as a fixture that only ever
 * serves newest-first.
 *
 * So the detector now takes a PREFIX of a deliberately wide span: exactly
 * `SKIP_TARGET` records at two page sizes that both force several boundaries.
 * Two properties make the comparison valid:
 *
 *   - both walks stop after the SAME number of records, so a shorter walk
 *     cannot read as a skip;
 *   - the only assumption is that the endpoint's order is STABLE between two
 *     requests — not that `sort` works, not which field it sorts by. Whatever
 *     the first 90 records are, both walks should see the same 90.
 */
const SKIP_TARGET = 90;
const SKIP_PAGE_A = 10; // 9 pages
const SKIP_PAGE_B = 30; // 3 pages
/**
 * How far back the skip detector reaches — wide on purpose, and NOT the
 * connector's window. The question here is whether `page_token` steps over
 * records, which is a property of the pagination and not of the window; asking
 * it inside a span too small to have boundaries is how the vacuous pass
 * happened.
 */
const SKIP_FROM = process.env.CALENDLY_SKIP_FROM ?? "2015-01-01T00:00:00.000Z";
/** The window `calendly.ts` reads: 30 days back, 90 forward. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 90;

type Page = { collection: Array<Record<string, unknown>>; pagination?: { next_page_token?: string | null } };
type Attempt = { ok: true; status: number; page: Page } | { ok: false; status: number; body: string };

/** One event, with the provider's string kept verbatim beside the parse result. */
type Ev = { id: string; raw: string | null; ms: number | null };

const failures: string[] = [];
const findings: string[] = [];
let requests = 0;

function check(name: string, ok: boolean, observed: string): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}\n         observed: ${observed}`);
  if (!ok) failures.push(name);
}

function note(name: string, observed: string): void {
  console.log(`  [INFO] ${name}\n         observed: ${observed}`);
  findings.push(`${name} — ${observed}`);
}

function skip(name: string, why: string): void {
  console.log(`  [SKIP] ${name}\n         ${why}`);
}

function head(title: string): void {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

function token(): string {
  const t = process.env.CALENDLY_API_TOKEN;
  if (!t) {
    console.error(
      "Set CALENDLY_API_TOKEN and re-run.\n" +
        "Calendly → Integrations & apps → API & webhooks → Personal Access Tokens.",
    );
    process.exit(2);
  }
  return t;
}

async function attempt(path: string, params: Record<string, string>): Promise<Attempt> {
  const qs = new URLSearchParams(params).toString();
  requests += 1;
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  const body = await res.text();
  // NOT truncated: an error body is where a provider explains which parameter
  // combinations it allows, and clipping it cuts the answer off mid-sentence.
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, status: res.status, page: JSON.parse(body) as Page };
}

async function get(params: Record<string, string>): Promise<Page> {
  const a = await attempt("/scheduled_events", params);
  if (!a.ok) throw new Error(`HTTP ${a.status}: ${a.body}`);
  return a.page;
}

/** A throw inside a section fails that section and only it. */
async function section<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    check(`${label} (could not run)`, false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Read one page into `{id, raw, ms}` triples on a chosen date field.
 *
 * `field` is a parameter because the whole point of SECTION 1 is that the field
 * a list is ordered by is an OBSERVATION, not something to infer from the sort
 * parameter we happened to send. Close's ordering was checked on the wrong field
 * for months precisely because that was hard-coded.
 */
function evs(p: Page, field: "start_time" | "created_at" | "updated_at" = "start_time"): Ev[] {
  return p.collection.map((e) => {
    const v = e[field];
    const raw = v == null ? null : typeof v === "string" ? v : `${JSON.stringify(v)} (not a string: ${typeof v})`;
    const parsed = typeof v === "string" ? Date.parse(v) : NaN;
    return { id: String(e["uri"] ?? "(no uri)"), raw, ms: Number.isFinite(parsed) ? parsed : null };
  });
}

const iso = (ms: number) => new Date(ms).toISOString();
const dated = (list: Ev[]) => list.filter((e) => e.ms != null);
const showEv = (e: Ev) => `${e.id.split("/").pop()!.padEnd(38)} ${e.raw ?? "(absent)"}${e.raw !== null && e.ms == null ? "   <-- UNPARSEABLE" : ""}`;

type Order = "ascending" | "descending" | "all-equal" | "too-few-dates" | "MIXED";

function orderOf(list: Ev[]): Order {
  const ts = dated(list).map((e) => e.ms!);
  if (ts.length < 2) return "too-few-dates";
  if (ts.every((t) => t === ts[0])) return "all-equal";
  const asc = ts.every((t, i) => i === 0 || ts[i - 1] <= t);
  const desc = ts.every((t, i) => i === 0 || ts[i - 1] >= t);
  return asc ? "ascending" : desc ? "descending" : "MIXED";
}

const ids = (p: Page) => p.collection.map((e) => String(e["uri"]));
const idSet = (p: Page) => new Set(ids(p));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const sameSequence = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function main(): Promise<void> {
  console.log("Calendly /scheduled_events — RAW EVIDENCE (read-only)");
  console.log(`skip detector: first ${SKIP_TARGET} records at page size ${SKIP_PAGE_A} and ${SKIP_PAGE_B}, from ${SKIP_FROM}\n`);

  // ══════════════════════════════════════════════════════════════ who is this
  head("SECTION 0 — the token, and the scope every later request uses");
  const scope = await section("identity", async () => {
    const a = await attempt("/users/me", {});
    if (!a.ok) throw new Error(`HTTP ${a.status}: ${a.body}`);
    const me = (a.page as unknown as { resource?: { uri?: string; current_organization?: string } }).resource ?? {};
    check("CL0 the token resolves to a user", Boolean(me.uri), `uri=${me.uri ?? "(absent)"} org=${me.current_organization ?? "(absent)"}`);
    const want = process.env.CALENDLY_SCOPE === "organization" ? "organization" : "user";
    // The connector defaults to `user` (`scopeOf` in calendly.ts). Verifying a
    // different scope than the code uses would answer a question nobody asked.
    const params: Record<string, string> =
      want === "organization" ? { organization: me.current_organization! } : { user: me.uri! };
    note("CL0 scope used for every request below", `${want} → ${JSON.stringify(params)}`);
    return params;
  });
  if (!scope) return report();

  const floor = new Date(Date.now() - PAST_DAYS * 86_400_000).toISOString();
  const ceil = new Date(Date.now() + FUTURE_DAYS * 86_400_000).toISOString();
  /** The unbounded, unsorted, unfiltered CONTROL every comparison below is against. */
  const control = await section("control page", async () => {
    const p = await get({ ...scope, count: String(COUNT) });
    const list = evs(p);
    check(
      "CL1 response carries collection[] and a pagination object",
      Array.isArray(p.collection) && typeof p.pagination === "object",
      `collection is ${Array.isArray(p.collection) ? `an array of ${p.collection.length}` : typeof p.collection}; ` +
        `pagination ${p.pagination ? `present (next_page_token=${JSON.stringify(p.pagination.next_page_token ?? null)})` : "ABSENT"}`,
    );
    const absent = list.filter((e) => e.raw === null);
    const unparseable = list.filter((e) => e.raw !== null && e.ms == null);
    check(
      "CL2 every event carries a parseable start_time",
      absent.length === 0 && unparseable.length === 0,
      `${list.length} events: ${dated(list).length} parseable, ${absent.length} absent, ${unparseable.length} unparseable`,
    );
    for (const e of [...absent, ...unparseable]) console.log(`           ${showEv(e)}`);
    return p;
  });
  if (!control || control.collection.length === 0) {
    console.log("\nNo scheduled events on this account — book one and re-run, or the checks below cannot execute.");
    return report();
  }

  /**
   * ════════════════════════════════════════════════════════════════════════
   * SECTION 1 — WHICH FIELD IS IT ORDERED BY? Observed, never inferred.
   *
   * Close's ordering claim was right about the direction and wrong about the
   * FIELD, and stayed wrong because every check asked about the field the code
   * happened to use. So all three date fields are measured here, on a response
   * that carried NO sort parameter at all — this is what the endpoint does when
   * nobody tells it anything.
   * ════════════════════════════════════════════════════════════════════════
   */
  head("SECTION 1 — the DEFAULT ordering, on every date field");
  await section("default ordering", async () => {
    for (const field of ["start_time", "created_at", "updated_at"] as const) {
      const list = evs(control, field);
      note(`CL3 default order by ${field}`, `${orderOf(list)} over ${dated(list).length} dated events`);
    }
    const st = dated(evs(control));
    if (st.length > 0) {
      console.log(`         first 3 raw start_time:`);
      for (const e of st.slice(0, 3)) console.log(`           ${showEv(e)}`);
      console.log(`         last 3 raw start_time:`);
      for (const e of st.slice(-3)) console.log(`           ${showEv(e)}`);
    }
  });

  /**
   * SECTION 2 — `sort`, on which the outward scan's whole traversal rests.
   *
   * The connector asks for `start_time:desc` on the past side and
   * `start_time:asc` on the future side, then steps each side's `page_token`
   * assuming the previous page ended where the sort implies. If sort is ignored,
   * both sides walk in whatever order the endpoint feels like and the pivot
   * means nothing.
   *
   * COMPARED AS A SEQUENCE, NOT A SET. A sort that works returns the same
   * records in a different order, so the id-set comparison used everywhere else
   * in this file would report "identical — ignored" for a perfectly functioning
   * parameter. This is the one place the control has to be an ordered
   * comparison, and getting it wrong would produce a confident false negative.
   */
  head("SECTION 2 — is `sort` honoured? (compared as a SEQUENCE)");
  await section("sort", async () => {
    const base = ids(control);
    for (const direction of ["desc", "asc"] as const) {
      const value = `start_time:${direction}`;
      const res = await attempt("/scheduled_events", { ...scope, count: String(COUNT), sort: value });
      if (!res.ok) {
        note(`CL4 sort=${value}`, `REJECTED HTTP ${res.status}: ${res.body}`);
        continue;
      }
      const got = ids(res.page);
      const order = orderOf(evs(res.page));
      const expected = direction === "asc" ? "ascending" : "descending";
      note(
        `CL4 sort=${value}`,
        `returned ${got.length} events, observed start_time order: ${order}` +
          (order === expected ? "  [matches what was asked for]" : `  [does NOT match: asked for ${expected}]`) +
          (sameSequence(got, base) ? "  [SAME SEQUENCE AS NO SORT AT ALL]" : "  [sequence differs from the unsorted control]"),
      );
      // The set must not change — a sort is not a filter. If it does, `sort` is
      // doing something other than ordering and the scan's page maths is void.
      note(
        `CL4 sort=${value} — same records?`,
        sameSet(new Set(got), new Set(base))
          ? "same id set as the control, as an ordering parameter should be"
          : `DIFFERENT id set: control ${base.length}, sorted ${got.length} — sort is not purely an ordering here`,
      );
    }
    // The two directions must disagree with each other. If desc and asc return
    // the identical sequence, the parameter is being swallowed whichever way it
    // is spelled, and both sides of the outward scan are walking blind.
    const [d, a] = await Promise.all([
      attempt("/scheduled_events", { ...scope, count: String(COUNT), sort: "start_time:desc" }),
      attempt("/scheduled_events", { ...scope, count: String(COUNT), sort: "start_time:asc" }),
    ]);
    if (d.ok && a.ok) {
      const ds = ids(d.page);
      const as = ids(a.page);
      note(
        "CL4 desc vs asc — do the two directions differ?",
        sameSequence(ds, as)
          ? `IDENTICAL SEQUENCES (${ds.length} events) — sort is accepted and IGNORED in both directions`
          : `different sequences; reversed(asc) ${sameSequence([...as].reverse(), ds) ? "EQUALS" : "does not equal"} desc`,
      );
    }
  });

  /**
   * SECTION 3 — do the window bounds actually bound?
   *
   * `min_start_time` and `max_start_time` are what make the scan a WINDOW rather
   * than a walk over the whole account. Each is controlled independently and
   * then together, because a pair can behave differently from either alone —
   * Close accepts `object_type` only alongside `action`, and that combination
   * rule was invisible from testing each on its own.
   */
  head("SECTION 3 — do min_start_time / max_start_time bound?");
  await section("window bounds", async () => {
    const ok = dated(evs(control));
    if (ok.length < 2) return skip("CL5 window bounds", `control page has ${ok.length} dated events; need 2 to bound between`);
    const lo = Math.min(...ok.map((e) => e.ms!));
    const hi = Math.max(...ok.map((e) => e.ms!));
    if (lo === hi) return skip("CL5 window bounds", "every event on the control page shares one start_time");
    const midMs = lo + Math.floor((hi - lo) / 2);
    const mid = new Date(midMs).toISOString();
    console.log(`         control page start_time span: ${iso(lo)} .. ${iso(hi)}`);
    console.log(`         bound sent (verbatim, same spelling calendly.ts uses): ${mid}`);
    const base = idSet(control);

    const cases: Array<[string, Record<string, string>, (e: Ev) => boolean]> = [
      ["min_start_time alone", { min_start_time: mid }, (e) => e.ms != null && e.ms < midMs],
      ["max_start_time alone", { max_start_time: mid }, (e) => e.ms != null && e.ms > midMs],
      [
        "min_start_time + max_start_time (the pair the connector sends)",
        { min_start_time: floor, max_start_time: ceil },
        (e) => e.ms != null && (e.ms < Date.parse(floor) || e.ms > Date.parse(ceil)),
      ],
    ];
    for (const [label, params, violates] of cases) {
      const res = await attempt("/scheduled_events", { ...scope, count: String(COUNT), ...params });
      if (!res.ok) {
        note(`CL5 ${label}`, `REJECTED HTTP ${res.status}: ${res.body}`);
        continue;
      }
      const rows = evs(res.page);
      const bad = rows.filter(violates);
      const got = idSet(res.page);
      note(
        `CL5 ${label}`,
        `${rows.length} events, ${bad.length} outside the bound` +
          (sameSet(got, base)
            ? `   [IDENTICAL id set to the unbounded control (${base.size}) — the bound changed nothing]`
            : `   [id set differs from control: ${base.size} unbounded, ${got.size} bounded]`),
      );
      for (const e of bad.slice(0, 10)) console.log(`           outside: ${showEv(e)}`);
    }
  });

  /**
   * SECTION 4 — `status`.
   *
   * The connector OMITS this by default, deliberately: every meeting emits a
   * "booked" row and a canceled one also emits a "canceled" row, so filtering
   * server-side would hide the cancellation. It sends `status` only when a flow
   * narrowed it. So the question is not whether we depend on it today — it is
   * what a user gets when they DO narrow. If `status` is accepted and ignored,
   * picking "canceled only" silently returns everything.
   */
  head("SECTION 4 — does `status` filter, or is it accepted and ignored?");
  await section("status", async () => {
    const base = idSet(control);
    const seen = new Map<string, number>();
    for (const e of control.collection) {
      const s = String(e["status"] ?? "(absent)");
      seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    note("CL6 statuses present on the control page", [...seen.entries()].map(([s, n]) => `${s}=${n}`).join(", ") || "(none)");

    for (const value of ["active", "canceled"]) {
      const res = await attempt("/scheduled_events", { ...scope, count: String(COUNT), status: value });
      if (!res.ok) {
        note(`CL6 status=${value}`, `REJECTED HTTP ${res.status}: ${res.body}`);
        continue;
      }
      const wrong = res.page.collection.filter((e) => String(e["status"]) !== value);
      const got = idSet(res.page);
      note(
        `CL6 status=${value}`,
        `${res.page.collection.length} events, ${wrong.length} with a different status` +
          (sameSet(got, base)
            ? "   [IDENTICAL id set to no-status — accepted and IGNORED]"
            : "   [id set differs from the control]"),
      );
    }
  });

  /** SECTION 5 — the page size, and one past it. */
  head("SECTION 5 — the real `count` cap");
  await section("count cap", async () => {
    const at = await attempt("/scheduled_events", { ...scope, count: String(COUNT) });
    const over = await attempt("/scheduled_events", { ...scope, count: String(COUNT + 1) });
    note(
      `CL7 count=${COUNT}`,
      at.ok ? `returned ${at.page.collection.length} events` : `REJECTED HTTP ${at.status}: ${at.body}`,
    );
    note(
      `CL7 count=${COUNT + 1} (one past the cap the connector assumes)`,
      over.ok
        ? `ACCEPTED, returned ${over.page.collection.length} events` +
          (over.page.collection.length <= COUNT ? "  [clamped rather than refused]" : "  [MORE than the assumed cap]")
        : `REJECTED HTTP ${over.status}: ${over.body}`,
    );
  });

  /**
   * SECTION 6 — does `page_token` step OVER records?
   *
   * Duplication is visible within one walk; a SKIP is not. Two walks over the
   * SAME bounded span at different page sizes land their boundaries in different
   * places, so a cursor that drops a record at a boundary drops a different one
   * each time — and the id sets stop matching. This is the strongest form of the
   * pagination question and the one that does not depend on the boundaries
   * looking tidy.
   */
  head("SECTION 6 — does the page walk skip records?");
  await section("skip detection", async () => {
    const span = { min_start_time: SKIP_FROM, max_start_time: ceil };
    console.log(`         span: ${SKIP_FROM} .. ${ceil}   (deliberately wider than the connector's window)`);
    console.log(`         taking the first ${SKIP_TARGET} records at page size ${SKIP_PAGE_A} and again at ${SKIP_PAGE_B}`);

    /** The first `target` records of the span, and how many pages it took. */
    const walk = async (count: number, target: number) => {
      const seen = new Map<string, Record<string, unknown>>();
      const duplicates: string[] = [];
      let pageToken: string | null = null;
      let pages = 0;
      let exhausted = false;
      while (seen.size < target && pages < Math.ceil(target / count) + 2) {
        const params: Record<string, string> = { ...scope, ...span, count: String(count) };
        if (pageToken) params.page_token = pageToken;
        const p = await get(params);
        pages += 1;
        for (const e of p.collection) {
          const id = String(e["uri"]);
          if (seen.has(id)) duplicates.push(id);
          else if (seen.size < target) seen.set(id, e);
        }
        pageToken = p.pagination?.next_page_token ?? null;
        if (!pageToken || p.collection.length === 0) {
          exhausted = true;
          break;
        }
      }
      return { seen, duplicates, pages, exhausted };
    };

    const a = await walk(SKIP_PAGE_A, SKIP_TARGET);
    const b = await walk(SKIP_PAGE_B, SKIP_TARGET);

    /**
     * THE GUARD AGAINST A VACUOUS PASS, and it FAILS rather than skips.
     *
     * A walk that returned one page crossed no boundary, so it cannot have
     * detected a cursor stepping over one. Reporting that as a pass is how this
     * check spent its first live run proving nothing — so a run that could not
     * exercise the question says so as a failure, with what to change.
     */
    const paged = a.pages >= 2 && b.pages >= 2;
    check(
      "CL8 both walks actually paginated (a single-page walk tests nothing)",
      paged,
      `page size ${SKIP_PAGE_A}: ${a.pages} page(s), ${a.seen.size} records; ` +
        `page size ${SKIP_PAGE_B}: ${b.pages} page(s), ${b.seen.size} records` +
        (paged
          ? ""
          : `  — the span holds too few events to have a page boundary. Widen it with ` +
            `CALENDLY_SKIP_FROM=<earlier ISO date>, or this account genuinely has under ${SKIP_PAGE_B * 2} events.`),
    );

    check(
      "CL8 no event returned twice within a walk",
      a.duplicates.length === 0 && b.duplicates.length === 0,
      `${a.duplicates.length} duplicate(s) at page size ${SKIP_PAGE_A}, ${b.duplicates.length} at ${SKIP_PAGE_B}`,
    );

    // Both walks took the same prefix, so a size difference is itself a finding:
    // it means one of them ran out early and the sets are not comparable.
    const comparable = paged && a.seen.size === b.seen.size;
    if (!comparable) {
      skip(
        "CL8 two page sizes see the same records",
        `walks covered different amounts (${a.seen.size} vs ${b.seen.size}) — not comparable. ` +
          (a.exhausted || b.exhausted ? "The span ran out before the target." : ""),
      );
      return;
    }
    const onlyA = [...a.seen.keys()].filter((id) => !b.seen.has(id));
    const onlyB = [...b.seen.keys()].filter((id) => !a.seen.has(id));
    check(
      "CL8 two page sizes over one span see the same records",
      onlyA.length === 0 && onlyB.length === 0,
      `${a.seen.size} records each, ${a.pages} pages vs ${b.pages} pages; ` +
        `${onlyA.length} seen only at count=${SKIP_PAGE_A}, ${onlyB.length} seen only at count=${SKIP_PAGE_B}`,
    );
    for (const id of [...onlyA, ...onlyB].slice(0, 10)) console.log(`           only one walk saw: ${id}`);
  });

  /**
   * SECTION 7 — the scopes this run did NOT use.
   *
   * Everything above ran under `user` scope, because that is what `scopeOf` in
   * `calendly.ts` defaults to. But the connector offers two more through its
   * flowFields — `organization` and `group` — and they change the `/scheduled_events`
   * target parameter entirely. Verifying one scope and saying nothing about the
   * others would leave the same gap this whole script exists to close.
   *
   * These are reported rather than asserted: an empty organization result is a
   * legitimate answer for a token without org admin rights, and groups are a
   * paid-tier feature, so neither is a failure.
   */
  head("SECTION 7 — the organization and group scopes the connector also offers");
  await section("other scopes", async () => {
    const me = await attempt("/users/me", {});
    if (!me.ok) return skip("CL9 other scopes", `could not re-read identity: HTTP ${me.status}`);
    const org = (me.page as unknown as { resource?: { current_organization?: string } }).resource?.current_organization;
    note("CL9 scope this run used", `user — every check above. organization/group are exercised only below.`);
    if (!org) return skip("CL9 organization scope", "the token reports no current_organization");

    const orgRes = await attempt("/scheduled_events", { organization: org, count: String(COUNT) });
    note(
      "CL9 organization scope",
      orgRes.ok
        ? `${orgRes.page.collection.length} events returned` +
          (orgRes.page.collection.length === 0
            ? "  [zero — the signature of a token without organization admin rights, which is what calendly.ts's [calendly-probe] line watches for]"
            : "")
        : `REJECTED HTTP ${orgRes.status}: ${orgRes.body}`,
    );

    const groups = await attempt("/groups", { organization: org, count: "100" });
    if (!groups.ok) return note("CL9 group scope", `/groups REJECTED HTTP ${groups.status}: ${groups.body}`);
    const list = groups.page.collection ?? [];
    if (list.length === 0) {
      return note("CL9 group scope", "no groups on this plan — groups are a paid-tier feature, so an empty list is legitimate");
    }
    const uri = String(list[0]["uri"]);
    const groupRes = await attempt("/scheduled_events", { organization: org, group: uri, count: String(COUNT) });
    note(
      "CL9 group scope",
      groupRes.ok
        ? `${list.length} group(s); first returned ${groupRes.page.collection.length} events`
        : `REJECTED HTTP ${groupRes.status}: ${groupRes.body}`,
    );
  });

  report();
}

function report(): void {
  head("SUMMARY");
  console.log(`  ${requests} GET requests issued (read-only).`);
  if (findings.length > 0) {
    console.log("\n  Measurements (no pass/fail meaning — read them):");
    for (const f of findings) console.log(`    - ${f}`);
  }
  console.log(
    failures.length === 0
      ? "\n  Nothing contradicted the contract pinned in src/connectors/calendly.ts.\n" +
          "  The INFO lines above are the point of this run: an IGNORED parameter is\n" +
          "  reported there, not here, because a provider quietly not filtering is not\n" +
          "  an error it will ever return."
      : `\n  ${failures.length} check(s) FAILED:\n${failures.map((f) => `    - ${f}`).join("\n")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Makes this file a MODULE rather than a global script.
 *
 * Without it, TypeScript puts every top-level name here — `API`, `check`,
 * `Attempt`, `section` — into the shared global scope, where it collides with
 * the next verification script somebody writes. `verify-calendly.ts` typechecked
 * cleanly only because it was briefly the only non-module script in `scripts/`;
 * adding `verify-instantly.ts` beside it broke both at once.
 */
export {};
