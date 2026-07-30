/**
 * Close Event Log — RAW EVIDENCE about the pagination contract.
 *
 * This script reports what the API actually returned. It used to report verdicts,
 * and that cost real work: C2 ("newest-first ordering") FAILED against a live
 * workspace whose log is newest-first, because a single event with an
 * unparseable `date_created` made `Date.parse(...) >= Date.parse(...)` compare
 * against NaN — and the failure line read "C2 newest-first ordering (page 1) —
 * 50 events", stating the condition being tested instead of the ordering
 * observed. Nothing in that output could have revealed the bug, and a connector
 * was rebuilt for an ordering that does not exist.
 *
 * So the rules here are structural, not stylistic:
 *
 * 1. `check()` REQUIRES an `observed` argument. A check that cannot say what it
 *    saw cannot be written.
 * 2. Timestamps are carried as `{raw, ms}` pairs. The raw provider string is
 *    printed verbatim; parsing is a separate, reported step, and an unparseable
 *    value is counted and shown rather than coerced into a comparison.
 * 3. When a check fails, it prints the specific rows that made it fail — the
 *    offending page, the offending adjacent pair, the events below the bound.
 * 4. Where a parameter's behaviour is in question, there is a CONTROL request
 *    without it. "The bounded response is identical to the unbounded one" is the
 *    only way to tell an ignored parameter from an honoured one.
 *
 * Read-only: every request is a GET. Exit 0 when nothing contradicts the pinned
 * contract in src/connectors/close.ts.
 *
 *   CLOSE_API_KEY=api_xxx pnpm tsx scripts/verify-close-pagination.ts
 *
 * Env knobs: CLOSE_VERIFY_PAGES (walk depth, default 40).
 */

const API = "https://api.close.com/api/v1";

/** The endpoint's documented maximum page size, mirrored from close.ts. */
const MAX_LIMIT = 50;
/** Walk depth. Raised from 20 and overridable: the 20-page cap meant the skip
 *  detector never ran on a workspace of any size. */
const WALK_PAGES = Math.max(2, Number(process.env.CLOSE_VERIFY_PAGES ?? 40) || 40);
/** Second page size for the skip detector — different boundaries, same data. */
const ALT_LIMIT = 25;

type EventPage = { data: Array<Record<string, unknown>>; cursor_next?: string | null };
type Attempt = { ok: true; page: EventPage; status: number } | { ok: false; status: number; body: string };

/** One event, with the provider's string kept verbatim beside the parse result. */
type Ev = { id: string; raw: string | null; ms: number | null };

const failures: string[] = [];
const findings: string[] = [];
let requests = 0;

/**
 * `observed` is REQUIRED. This is the fix for the class of bug that produced a
 * false C2: a message naming the expected condition tells you nothing when the
 * check is wrong about what it measured.
 */
function check(name: string, ok: boolean, observed: string): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}\n         observed: ${observed}`);
  if (!ok) failures.push(name);
}

/** A measurement with no pass/fail meaning. Recorded and printed. */
function note(name: string, observed: string): void {
  console.log(`  [INFO] ${name}\n         observed: ${observed}`);
  findings.push(`${name}: ${observed}`);
}

/** A check that could not be evaluated, and why. Louder than silence. */
function skip(name: string, why: string): void {
  console.log(`  [SKIP] ${name}\n         reason: ${why}`);
  findings.push(`${name} SKIPPED: ${why}`);
}

function head(title: string): void {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

async function attempt(params: Record<string, string>): Promise<Attempt> {
  const key = process.env.CLOSE_API_KEY;
  if (!key) {
    console.error("Set CLOSE_API_KEY (the connection's API key) and re-run.");
    process.exit(2);
  }
  const qs = new URLSearchParams(params).toString();
  requests += 1;
  const res = await fetch(`${API}/event/?${qs}`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: body.slice(0, 300) };
  return { ok: true, status: res.status, page: JSON.parse(body) as EventPage };
}

async function get(params: Record<string, string>): Promise<EventPage> {
  const a = await attempt(params);
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
 * Read one page into `{id, raw, ms}` triples.
 *
 * `raw` is exactly what the provider sent — including a non-string, which is
 * recorded as its stringification rather than silently becoming `""`. `ms` is
 * null when the value does not parse, and callers must handle that rather than
 * compare against NaN, which is what silently inverted C2.
 */
function evs(p: EventPage): Ev[] {
  return p.data.map((e) => {
    const v = e["date_created"];
    const raw = v == null ? null : typeof v === "string" ? v : `${JSON.stringify(v)} (not a string: ${typeof v})`;
    const parsed = typeof v === "string" ? Date.parse(v) : NaN;
    return { id: String(e["id"] ?? "(no id)"), raw, ms: Number.isFinite(parsed) ? parsed : null };
  });
}

const iso = (ms: number) => new Date(ms).toISOString();
const dated = (list: Ev[]) => list.filter((e) => e.ms != null);

type Order = "newest-first" | "oldest-first" | "all-timestamps-equal" | "too-few-dates" | "MIXED";

/** Direction, plus the adjacent pairs that break each monotonicity. */
function orderOf(list: Ev[]): { order: Order; ascBreaks: Array<[Ev, Ev]>; descBreaks: Array<[Ev, Ev]> } {
  const ok = dated(list);
  const descBreaks: Array<[Ev, Ev]> = [];
  const ascBreaks: Array<[Ev, Ev]> = [];
  for (let i = 1; i < ok.length; i++) {
    if (ok[i - 1].ms! < ok[i].ms!) descBreaks.push([ok[i - 1], ok[i]]);
    if (ok[i - 1].ms! > ok[i].ms!) ascBreaks.push([ok[i - 1], ok[i]]);
  }
  let order: Order;
  if (ok.length < 2) order = "too-few-dates";
  else if (descBreaks.length === 0 && ascBreaks.length === 0) order = "all-timestamps-equal";
  else if (descBreaks.length === 0) order = "newest-first";
  else if (ascBreaks.length === 0) order = "oldest-first";
  else order = "MIXED";
  return { order, ascBreaks, descBreaks };
}

function showEv(e: Ev): string {
  return `${e.id.padEnd(24)} ${e.raw === null ? "(date_created absent)" : e.raw}${e.ms == null && e.raw !== null ? "   <-- UNPARSEABLE" : ""}`;
}

async function main() {
  console.log("Close Event Log — RAW EVIDENCE (read-only)");
  console.log(`walk depth: ${WALK_PAGES} pages of ${MAX_LIMIT}\n`);

  // ══════════════════════════════════════════════════════ page 1, verbatim
  head("SECTION 1 — page 1 exactly as returned");
  const opened = await section("page 1", async () => {
    const page = await get({ _limit: String(MAX_LIMIT) });
    const list = evs(page);

    check(
      "C1 response carries data[] and a cursor_next key",
      Array.isArray(page.data) && "cursor_next" in page,
      `data is ${Array.isArray(page.data) ? `an array of ${page.data.length}` : typeof page.data}; ` +
        `cursor_next ${"cursor_next" in page ? `present (${JSON.stringify(page.cursor_next)})` : "ABSENT"}`,
    );
    check("C3 _limit=50 not exceeded", page.data.length <= MAX_LIMIT, `${page.data.length} events returned`);

    // The `date_created` census. This is what made C2 lie: one unparseable value
    // is enough to invert an ordering check that compares against NaN, and the
    // connector's `mapEvent` falls back to `new Date()` for the same input —
    // stamping a record with the SYNC time, which is a wrong occurredAt that
    // nothing would report.
    const absent = list.filter((e) => e.raw === null);
    const unparseable = list.filter((e) => e.raw !== null && e.ms == null);
    check(
      "C8 every event carries a parseable date_created",
      absent.length === 0 && unparseable.length === 0,
      `${list.length} events: ${dated(list).length} parseable, ${absent.length} absent, ${unparseable.length} unparseable`,
    );
    for (const e of [...absent, ...unparseable]) console.log(`           ${showEv(e)}`);

    const { order, descBreaks, ascBreaks } = orderOf(list);
    check(
      "C2 page 1 is consistently ordered by date_created",
      order !== "MIXED",
      `${order} (${dated(list).length} dated events; ${descBreaks.length} descending breaks, ${ascBreaks.length} ascending breaks)`,
    );
    if (order === "MIXED") {
      console.log("         adjacent pairs that break BOTH directions:");
      for (const [a, b] of [...descBreaks, ...ascBreaks].slice(0, 10)) {
        console.log(`           ${showEv(a)}\n        -> ${showEv(b)}`);
      }
    }
    note("C2 observed ordering", order);

    const ok = dated(list);
    if (ok.length > 0) {
      console.log(`         first 3 raw date_created:`);
      for (const e of ok.slice(0, 3)) console.log(`           ${showEv(e)}`);
      console.log(`         last 3 raw date_created:`);
      for (const e of ok.slice(-3)) console.log(`           ${showEv(e)}`);
      const lo = Math.min(...ok.map((e) => e.ms!));
      const hi = Math.max(...ok.map((e) => e.ms!));
      note("page 1 parsed span", `${iso(lo)} .. ${iso(hi)}  (${((hi - lo) / 3_600_000).toFixed(2)} hours)`);
    }
    return { page, list, order };
  });

  // ══════════════════════════════════════════════════════════ the limit cap
  head("SECTION 2 — the _limit cap");
  await section("cap probe", async () => {
    const over = await attempt({ _limit: String(MAX_LIMIT + 1) });
    if (!over.ok) {
      check(
        `C3 cap enforced when asked for ${MAX_LIMIT + 1}`,
        over.status === 400,
        `HTTP ${over.status}, body: ${over.body}`,
      );
    } else {
      check(
        `C3 cap enforced when asked for ${MAX_LIMIT + 1}`,
        over.page.data.length <= MAX_LIMIT,
        `HTTP 200 with ${over.page.data.length} events (clamped rather than refused)`,
      );
    }
  });

  if (!opened || opened.page.data.length === 0) {
    console.log("\nPage 1 is empty or failed — create some activity in Close and re-run.");
    return report();
  }
  const { page: page1, order: order1 } = opened;

  // ═══════════════════════════════════════════════════════════ the cursor walk
  head("SECTION 3 — the cursor walk");

  /** Walk `cursor_next`, recording every page so a failure can be shown. */
  async function walk(limit: number, extra: Record<string, string> = {}, maxPages = WALK_PAGES) {
    const params = { _limit: String(limit), ...extra };
    const pages: Array<{ index: number; list: Ev[]; order: Order }> = [];
    const seen = new Map<string, Ev>();
    const duplicates: Ev[] = [];
    let page = await get(params);
    let n = 1;
    for (;;) {
      const list = evs(page);
      pages.push({ index: n, list, order: orderOf(list).order });
      for (const e of list) {
        if (seen.has(e.id)) duplicates.push(e);
        else seen.set(e.id, e);
      }
      if (!page.cursor_next || list.length === 0 || n >= maxPages) break;
      page = await get({ ...params, _cursor: String(page.cursor_next) });
      n += 1;
    }
    const drained = !page.cursor_next || pages[pages.length - 1].list.length === 0;
    return { pages, seen, duplicates, drained, count: n };
  }

  const full = await section("walk", async () => {
    const w = await walk(MAX_LIMIT);

    // Direction, page by page, naming the page that disagrees. The previous
    // version printed page 1's direction as the "observed" value of a check about
    // OTHER pages, so a failure and its evidence contradicted each other.
    const dirs = new Map<Order, number[]>();
    for (const p of w.pages) dirs.set(p.order, [...(dirs.get(p.order) ?? []), p.index]);
    const summary = [...dirs.entries()].map(([o, idx]) => `${o} x${idx.length} (pages ${idx.slice(0, 6).join(",")}${idx.length > 6 ? "…" : ""})`).join("; ");
    const informative = w.pages.filter((p) => p.order !== "too-few-dates" && p.order !== "all-timestamps-equal");
    const disagreeing = informative.filter((p) => p.order !== order1);
    check("C4 every page runs the same direction as page 1", disagreeing.length === 0, `page 1 is ${order1}; across ${w.count} pages: ${summary}`);
    for (const p of disagreeing.slice(0, 5)) {
      const ok = dated(p.list);
      console.log(`         page ${p.index} is ${p.order} — ${p.list.length} events, ${ok.length} dated`);
      console.log(`           first: ${ok.length ? showEv(ok[0]) : "(none dated)"}`);
      console.log(`           last:  ${ok.length ? showEv(ok[ok.length - 1]) : "(none dated)"}`);
      const { descBreaks, ascBreaks } = orderOf(p.list);
      for (const [a, b] of [...descBreaks, ...ascBreaks].slice(0, 4)) {
        console.log(`           break: ${showEv(a)}\n               -> ${showEv(b)}`);
      }
      console.log(`           this page's raw date_created (first ${Math.min(6, p.list.length)} and last ${Math.min(6, p.list.length)}):`);
      for (const e of p.list.slice(0, 6)) console.log(`             ${showEv(e)}`);
      if (p.list.length > 12) console.log(`             … ${p.list.length - 12} more …`);
      for (const e of p.list.slice(-6)) console.log(`             ${showEv(e)}`);
    }

    check(
      "C4 no event returned twice across pages",
      w.duplicates.length === 0,
      `${w.seen.size} unique ids over ${w.count} pages; ${w.duplicates.length} duplicate(s)`,
    );
    for (const d of w.duplicates.slice(0, 10)) console.log(`           duplicate: ${showEv(d)}`);

    // Page-boundary regression, in the direction page 1 actually runs.
    let regressions = 0;
    for (let i = 1; i < w.pages.length; i++) {
      const prev = dated(w.pages[i - 1].list);
      const cur = dated(w.pages[i].list);
      if (prev.length === 0 || cur.length === 0) continue;
      const prevEdge = prev[prev.length - 1].ms!;
      const curFirst = cur[0].ms!;
      const bad = order1 === "newest-first" ? curFirst > prevEdge : order1 === "oldest-first" ? curFirst < prevEdge : false;
      if (bad) {
        regressions += 1;
        if (regressions <= 5) {
          console.log(`         page ${w.pages[i].index} starts on the wrong side of page ${w.pages[i - 1].index}'s edge`);
          console.log(`           prev page last: ${showEv(prev[prev.length - 1])}`);
          console.log(`           this page first: ${showEv(cur[0])}`);
        }
      }
    }
    check("C4 no page starts on the wrong side of the previous page's edge", regressions === 0, `${regressions} regression(s) over ${w.count} page boundaries`);

    note(
      "walk termination",
      w.drained
        ? `drained after ${w.count} pages (cursor_next null or an empty page)`
        : `STOPPED ON THE ${WALK_PAGES}-PAGE CAP with cursor_next still set — raise CLOSE_VERIFY_PAGES to go deeper`,
    );
    return w;
  });

  // ═════════════════════════════════════════════ the skip detector, which now runs
  head("SECTION 4 — does the cursor step OVER records?");
  await section("skip detection", async () => {
    if (!full) return;
    /**
     * Duplication is visible in one walk; a SKIP is not. A cursor that drops the
     * last item of every page produces no duplicate, no ordering break and a
     * clean termination — every check above passes while data is unreachable.
     * That is exactly how the original single-page Close poll stranded everything
     * below the newest 50.
     *
     * Detected by enumerating the same span a SECOND time with a different PAGE
     * SIZE. Different page sizes put the cursor on different boundaries, so a
     * cursor that skips loses different records in each walk and the id sets
     * disagree — which no replay of the same chain could ever reveal.
     *
     * Deliberately NOT done with a date bound: whether the bound is honoured is
     * itself under investigation in Section 5, and a detector built on a
     * parameter that might be ignored proves nothing.
     */
    const spanLo = Math.min(...[...full.seen.values()].filter((e) => e.ms != null).map((e) => e.ms!));
    const spanHi = Math.max(...[...full.seen.values()].filter((e) => e.ms != null).map((e) => e.ms!));
    if (!Number.isFinite(spanLo) || spanLo === spanHi) {
      skip("C4 cursor walk steps over no records", `walk 1 has no usable time span (${full.seen.size} ids)`);
      return;
    }

    // Enough pages of the smaller size to reach at least as deep as walk 1.
    const altPages = Math.ceil((full.count * MAX_LIMIT) / ALT_LIMIT) + 2;
    const alt = await walk(ALT_LIMIT, {}, altPages);

    // Compare only the span both walks covered, and ignore anything NEWER than
    // walk 1's newest — those are events created between the two walks.
    const altLo = Math.min(...[...alt.seen.values()].filter((e) => e.ms != null).map((e) => e.ms!));
    const lo = Math.max(spanLo, altLo);
    const inSpan = (e: Ev) => e.ms != null && e.ms >= lo && e.ms <= spanHi;
    const a = new Set([...full.seen.values()].filter(inSpan).map((e) => e.id));
    const b = new Set([...alt.seen.values()].filter(inSpan).map((e) => e.id));
    const onlyA = [...a].filter((id) => !b.has(id));
    const onlyB = [...b].filter((id) => !a.has(id));

    check(
      "C4 cursor walk steps over no records",
      onlyA.length === 0 && onlyB.length === 0,
      `over ${iso(lo)} .. ${iso(spanHi)}: _limit=${MAX_LIMIT} walk saw ${a.size}, _limit=${ALT_LIMIT} walk saw ${b.size}; ` +
        `${onlyA.length} missing from the small-page walk, ${onlyB.length} missing from the large-page walk`,
    );
    for (const id of onlyA.slice(0, 10)) console.log(`           only the _limit=${MAX_LIMIT} walk reached: ${showEv(full.seen.get(id)!)}`);
    for (const id of onlyB.slice(0, 10)) console.log(`           only the _limit=${ALT_LIMIT} walk reached: ${showEv(alt.seen.get(id)!)}`);
  });

  // ════════════════════════════ the 30-day bound batch 1 shipped and never verified
  head("SECTION 5 — date_created__gte, the bound src/connectors/close.ts sends");
  await section("date_created__gte", async () => {
    const ok = dated(evs(page1));
    if (ok.length < 2) {
      skip("C5 date_created__gte bounds the window", `page 1 has ${ok.length} dated events; need 2 to bound between`);
      return;
    }
    const lo = Math.min(...ok.map((e) => e.ms!));
    const hi = Math.max(...ok.map((e) => e.ms!));
    if (lo === hi) {
      skip("C5 date_created__gte bounds the window", "every dated event on page 1 shares one timestamp");
      return;
    }

    // A bound strictly inside page 1's span, spelled the way close.ts spells it:
    // `new Date(...).toISOString()` — milliseconds and a trailing Z.
    const boundMs = lo + Math.floor((hi - lo) / 2);
    const bound = new Date(boundMs).toISOString();
    console.log(`         bound sent (verbatim, same spelling close.ts uses): ${bound}`);
    console.log(`         page 1 span for reference: ${iso(lo)} .. ${iso(hi)}`);

    const bounded = await get({ _limit: String(MAX_LIMIT), date_created__gte: bound });
    const bl = evs(bounded);
    const below = bl.filter((e) => e.ms != null && e.ms < boundMs);

    console.log(`         bounded response: ${bl.length} events, cursor_next=${JSON.stringify(bounded.cursor_next)}`);
    if (below.length > 0) {
      console.log(`         EVERY event returned BELOW the bound, with its distance from it:`);
      for (const e of below.slice(0, 40)) {
        const delta = e.ms! - boundMs;
        console.log(`           ${showEv(e)}   ${(delta / 1000).toFixed(3)}s below the bound (${delta}ms)`);
      }
      if (below.length > 40) console.log(`           … ${below.length - 40} more below the bound (counts and extremes below) …`);
      const deltas = below.map((e) => e.ms! - boundMs);
      note(
        "how far below the bound the offenders sit",
        `closest ${Math.max(...deltas)}ms, furthest ${Math.min(...deltas)}ms — a cluster within a second or two points at ` +
          `precision/truncation of the bound; values spread over hours point at the parameter being ignored or violated`,
      );
    }

    // THE CONTROL. An ignored parameter and an honoured one are indistinguishable
    // without it: if the bounded response is the same set of ids as the unbounded
    // one, the bound did nothing at all.
    const unbounded = await get({ _limit: String(MAX_LIMIT) });
    const ub = new Set(evs(unbounded).map((e) => e.id));
    const bset = new Set(bl.map((e) => e.id));
    const same = ub.size === bset.size && [...ub].every((id) => bset.has(id));
    note(
      "CONTROL — bounded response vs the same request with no bound",
      same
        ? `IDENTICAL id sets (${ub.size} events) — the bound changed nothing, i.e. date_created__gte was IGNORED`
        : `different: unbounded ${ub.size} ids, bounded ${bset.size} ids, ${[...ub].filter((id) => !bset.has(id)).length} dropped by the bound`,
    );

    check(
      "C5 date_created__gte excludes everything below the bound",
      below.length === 0,
      `${below.length} of ${bl.length} returned events are below ${bound}`,
    );

    // Which SPELLINGS the endpoint honours. close.ts sends the first one, so if
    // only a coarser form works, batch 1's 30-day bound is silently doing nothing.
    console.log(`\n         Which spelling of the bound is honoured?`);
    const spellings: Array<[string, string]> = [
      ["ISO ms + Z          (what close.ts sends)", bound],
      ["ISO seconds + Z", `${new Date(boundMs).toISOString().slice(0, 19)}Z`],
      ["ISO ms + 00:00 offset", bound.replace("Z", "+00:00")],
      ["ISO seconds, no zone", new Date(boundMs).toISOString().slice(0, 19)],
      ["date only (YYYY-MM-DD)", new Date(boundMs).toISOString().slice(0, 10)],
      ["epoch seconds", String(Math.floor(boundMs / 1000))],
    ];
    for (const [label, value] of spellings) {
      const res = await attempt({ _limit: String(MAX_LIMIT), date_created__gte: value });
      if (!res.ok) {
        note(`  bound spelling: ${label}`, `REJECTED HTTP ${res.status} — ${res.body}`);
        continue;
      }
      const rows = evs(res.page);
      const under = rows.filter((e) => e.ms != null && e.ms < boundMs).length;
      const ids = new Set(rows.map((e) => e.id));
      const unchanged = ids.size === ub.size && [...ids].every((id) => ub.has(id));
      note(
        `  bound spelling: ${label}`,
        `sent ${value} -> ${rows.length} events, ${under} below the bound` +
          (unchanged ? "  [SAME AS UNBOUNDED — ignored]" : "  [response differs from unbounded]"),
      );
    }
  });

  // ═════════════════════════════════════════════════ capabilities not used today
  head("SECTION 6 — parameters the connector does not use yet (informational)");
  await section("date_created__lte", async () => {
    const ok = dated(evs(page1));
    if (ok.length < 2) return skip("C6 date_created__lte", `page 1 has ${ok.length} dated events`);
    const lo = Math.min(...ok.map((e) => e.ms!));
    const hi = Math.max(...ok.map((e) => e.ms!));
    const boundMs = lo + Math.floor((hi - lo) / 2);
    const value = new Date(boundMs).toISOString();
    const res = await attempt({ _limit: String(MAX_LIMIT), date_created__lte: value });
    if (!res.ok) return note("C6 date_created__lte", `sent ${value} -> REJECTED HTTP ${res.status}: ${res.body}`);
    const rows = evs(res.page);
    const above = rows.filter((e) => e.ms != null && e.ms > boundMs);
    note(
      "C6 date_created__lte",
      `sent ${value} -> ${rows.length} events, ${above.length} ABOVE the bound` +
        (above.length === 0 ? "  [honoured: an exclusive window segment is expressible]" : "  [ignored]"),
    );
  });

  await section("_order_by", async () => {
    const res = await attempt({ _limit: String(MAX_LIMIT), _order_by: "date_created" });
    if (!res.ok) return note("C7 _order_by=date_created", `REJECTED HTTP ${res.status}: ${res.body}`);
    const got = orderOf(evs(res.page)).order;
    note(
      "C7 _order_by=date_created (ascending, the OPPOSITE of the default)",
      `page 1 default is ${order1}; with _order_by it came back ${got}` +
        (got !== order1 && got !== "too-few-dates" && got !== "all-timestamps-equal"
          ? "  [honoured: ordering is controllable]"
          : "  [no change — ignored, or not decidable from this page]"),
    );
  });

  report();
}

function report(): void {
  head("SUMMARY");
  console.log(`  ${requests} GET requests issued (read-only).`);
  if (findings.length > 0) {
    console.log("\n  Measurements (no pass/fail meaning):");
    for (const f of findings) console.log(`    - ${f}`);
  }
  console.log(
    failures.length === 0
      ? "\n  Nothing contradicted the contract pinned in src/connectors/close.ts."
      : `\n  ${failures.length} check(s) FAILED:\n${failures.map((f) => `    - ${f}`).join("\n")}\n` +
          `  Read the observed values above before changing the connector. A failing check\n` +
          `  here has been wrong before: C2 once reported an ordering the API does not have.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // Only reachable if something outside every guarded section throws.
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});

export {};
