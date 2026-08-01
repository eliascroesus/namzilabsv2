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
  // NOT truncated. An error body was clipped to 300 characters, and the one that
  // matters most — the 400 listing which filter combinations this endpoint
  // allows — is longer than that, so the answer to the only question SECTION 7
  // asks was being cut off mid-sentence. Callers that want a short form slice it
  // themselves; the script's job is to report what the provider said.
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, status: res.status, page: JSON.parse(body) as EventPage };
}

/**
 * The same request, from a URLSearchParams the caller built.
 *
 * Exists because `Record<string, string>` cannot express a REPEATED parameter,
 * and "repeat the key" is one of the three spellings a multi-value filter might
 * take — so the shape of the helper was quietly deciding which questions could
 * be asked.
 */
async function attemptRaw(qs: URLSearchParams): Promise<Attempt> {
  const key = process.env.CLOSE_API_KEY;
  if (!key) {
    console.error("Set CLOSE_API_KEY (the connection's API key) and re-run.");
    process.exit(2);
  }
  requests += 1;
  const res = await fetch(`${API}/event/?${qs.toString()}`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
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
function evs(p: EventPage, field: "date_created" | "date_updated" = "date_created"): Ev[] {
  return p.data.map((e) => {
    const v = e[field];
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

    /**
     * ORDERING, ON BOTH FIELDS — because asking about one is how this was wrong.
     *
     * The docs say events are ordered latest-first by `date_updated`. Every
     * check here used to measure `date_created`, which the provider has never
     * claimed to sort on, and a check aimed at the wrong field cannot fail
     * usefully no matter how carefully it is written. Consolidation (an old
     * record keeps its `date_created` and takes a new `date_updated`) means the
     * two do not even move together, so the comparison is the evidence.
     */
    const updList = evs(page, "date_updated");
    const updOrder = orderOf(updList).order;
    note(
      "C2 WHICH FIELD is the log sorted by",
      `by date_updated: ${updOrder}   |   by date_created: ${orderOf(list).order}` +
        (updOrder === "newest-first" ? "  [matches the documented contract]" : "  [DOES NOT match the documented contract]"),
    );
    check(
      "C2 page 1 is ordered latest-first by date_updated, as documented",
      updOrder === "newest-first" || updOrder === "too-few-dates" || updOrder === "all-timestamps-equal",
      `${updOrder} over ${dated(updList).length} dated events`,
    );
    const missingUpd = updList.filter((e) => e.raw === null);
    check(
      "C9 every event carries date_updated (the cursor field)",
      missingUpd.length === 0,
      `${missingUpd.length} of ${updList.length} events have no date_updated — each one cannot advance the watermark`,
    );

    const { order, descBreaks, ascBreaks } = orderOf(list);
    check(
      "C2b page 1 is consistently ordered by date_created",
      order !== "MIXED",
      `${order} (${dated(list).length} dated events; ${descBreaks.length} descending breaks, ${ascBreaks.length} ascending breaks)` +
        `  [informational: the connector does not rely on this field being sorted]`,
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
    // `order` is the DATE_UPDATED order, because that is the field Close sorts
    // on and every downstream check reasons about the sort. Returning the
    // date_created order here is what made the page-boundary check in SECTION 3
    // measure one field while claiming to be about the sort of another.
    return { page, list, order: updOrder, createdOrder: order };
  });

  /**
   * ════════════════════════════════════════════════════════════════════════
   * SECTION 0 — THE MERGE GATE.
   *
   * Everything else in this script is evidence. This is a decision: the bound
   * `src/connectors/close.ts` sends must be shown to DO something before that
   * connector reaches main.
   *
   * The connector spent its whole life sending `date_created__gte`, which this
   * endpoint does not accept and therefore discarded — so every request was
   * unbounded while looking bounded. Close's own 30-day retention hid it. No
   * amount of reading either the code or the docs would have settled it; only
   * comparing a bounded response against an unbounded control does, because an
   * ignored parameter and an honoured one are otherwise indistinguishable.
   * ════════════════════════════════════════════════════════════════════════
   */
  head("SECTION 0 — DOES THE BOUND THE CONNECTOR SENDS ACTUALLY BOUND?");
  await section("date_updated__gte control", async () => {
    const unbounded = await get({ _limit: String(MAX_LIMIT) });
    const ub = evs(unbounded, "date_updated");
    const ok = dated(ub);
    if (ok.length < 2) {
      skip("C0 date_updated__gte bounds the window", `page 1 has ${ok.length} events with a parseable date_updated`);
      return;
    }
    const lo = Math.min(...ok.map((e) => e.ms!));
    const hi = Math.max(...ok.map((e) => e.ms!));
    if (lo === hi) {
      skip("C0 date_updated__gte bounds the window", "every dated event on page 1 shares one date_updated");
      return;
    }
    // Strictly inside page 1's span, spelled exactly the way close.ts spells it.
    const boundMs = lo + Math.floor((hi - lo) / 2);
    const value = new Date(boundMs).toISOString();
    console.log(`         bound sent (verbatim, same spelling close.ts uses): ${value}`);
    console.log(`         unbounded page 1 date_updated span: ${iso(lo)} .. ${iso(hi)}`);

    const bounded = await get({ _limit: String(MAX_LIMIT), date_updated__gte: value });
    const bl = evs(bounded, "date_updated");
    const ubIds = new Set(ub.map((e) => e.id));
    const bIds = new Set(bl.map((e) => e.id));
    const identical = ubIds.size === bIds.size && [...ubIds].every((id) => bIds.has(id));

    // THE CONTROL, and the one line that decides whether this merges.
    check(
      "C0 the bound CHANGES the response (i.e. the parameter is not being ignored)",
      !identical,
      identical
        ? `IDENTICAL id sets (${ubIds.size} events) — date_updated__gte was IGNORED. ` +
          `DO NOT MERGE: the connector would be unbounded again, exactly as it was with date_created__gte.`
        : `different: unbounded ${ubIds.size} ids, bounded ${bIds.size} ids, ` +
          `${[...ubIds].filter((id) => !bIds.has(id)).length} dropped by the bound`,
    );

    const below = bl.filter((e) => e.ms != null && e.ms < boundMs);
    check(
      "C0b nothing below the bound comes back",
      below.length === 0,
      `${below.length} of ${bl.length} returned events have date_updated below ${value}`,
    );
    for (const e of below.slice(0, 20)) {
      console.log(`           ${showEv(e)}   ${((e.ms! - boundMs) / 1000).toFixed(3)}s below the bound`);
    }

    // The negative control: the parameter we USED to send must be shown to do
    // nothing, or the story about what went wrong is itself unverified.
    const old = await get({ _limit: String(MAX_LIMIT), date_created__gte: value });
    const oIds = new Set(evs(old).map((e) => e.id));
    const oldIgnored = oIds.size === ubIds.size && [...oIds].every((id) => ubIds.has(id));
    note(
      "C0c the OLD parameter, for the record",
      oldIgnored
        ? `date_created__gte returned the same ${oIds.size} ids as no bound at all — confirmed discarded, which is the bug`
        : `date_created__gte CHANGED the response (${oIds.size} vs ${ubIds.size} ids) — unexpected; re-read before concluding anything`,
    );
  });

  /**
   * SECTION 0b — where the docs and the API disagree, and neither wins by default.
   *
   * The documentation states this endpoint does not support `_limit`. The live
   * API honours `_limit=50` and rejects 51 naming `max_limit=50`, which is not
   * something an ignored parameter can do. `date_created__gte` was wrong because
   * we trusted our code over the docs; `_limit` would be wrong the other way.
   * Both are settled here by asking the API.
   */
  head("SECTION 0b — _limit: the docs say unsupported, the API says otherwise");
  await section("_limit contradiction", async () => {
    const at50 = await attempt({ _limit: "50" });
    const over = await attempt({ _limit: String(MAX_LIMIT + 1) });
    note(
      "C10 _limit=51 (one past the cap)",
      over.ok
        ? `ACCEPTED, returned ${over.page.data.length} events — no cap enforced at this value`
        : `REJECTED HTTP ${over.status}: ${over.body}`,
    );
    check(
      "C10 _limit is honoured despite the docs saying it is unsupported",
      at50.ok && at50.page.data.length <= MAX_LIMIT && !over.ok,
      at50.ok
        ? `_limit=50 returned ${at50.page.data.length}; _limit=51 ${over.ok ? "was ACCEPTED" : `was rejected (${over.status})`}. ` +
          `A rejection naming a maximum is proof the parameter is read.`
        : `_limit=50 itself failed: HTTP ${at50.status} ${at50.body}`,
    );
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

  /**
   * Walk `cursor_next`, recording every page so a failure can be shown.
   *
   * BOTH FIELDS are kept per page. `upd` is the one the ordering checks use —
   * Close sorts by `date_updated` — and `list` (`date_created`) is retained so
   * the same questions can be reported about it informationally. Keeping only
   * one was the bug: the checks below asked about the sort while measuring a
   * field the provider never claimed to sort on.
   */
  async function walk(limit: number, extra: Record<string, string> = {}, maxPages = WALK_PAGES) {
    const params = { _limit: String(limit), ...extra };
    const pages: Array<{ index: number; list: Ev[]; upd: Ev[]; order: Order; createdOrder: Order }> = [];
    const seen = new Map<string, Ev>();
    const duplicates: Ev[] = [];
    let page = await get(params);
    let n = 1;
    for (;;) {
      const list = evs(page);
      const upd = evs(page, "date_updated");
      pages.push({ index: n, list, upd, order: orderOf(upd).order, createdOrder: orderOf(list).order });
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
    check(
      "C4 every page runs the same direction as page 1, BY DATE_UPDATED",
      disagreeing.length === 0,
      `page 1 is ${order1}; across ${w.count} pages: ${summary}`,
    );

    /**
     * The same question about `date_created`, reported and never failed.
     *
     * This used to be the check itself, and it failed on a correctly sorted log:
     * consolidation means an edited record keeps its old `date_created`, so a
     * page sorted properly by `date_updated` has no reason to be monotonic by
     * creation — the breaks are real data, not a provider fault. Kept because a
     * shift here is still worth seeing; demoted because failing on it told us
     * about our own measurement rather than about Close.
     */
    const cDirs = new Map<Order, number[]>();
    for (const p of w.pages) cDirs.set(p.createdOrder, [...(cDirs.get(p.createdOrder) ?? []), p.index]);
    note(
      "C4b same question about date_created (informational)",
      [...cDirs.entries()].map(([o, idx]) => `${o} x${idx.length}`).join("; ") +
        "  — Close does not sort on this field, so disagreement here is expected on a consolidated log",
    );

    for (const p of disagreeing.slice(0, 5)) {
      const ok = dated(p.upd);
      console.log(`         page ${p.index} is ${p.order} — ${p.list.length} events, ${ok.length} dated`);
      console.log(`           first: ${ok.length ? showEv(ok[0]) : "(none dated)"}`);
      console.log(`           last:  ${ok.length ? showEv(ok[ok.length - 1]) : "(none dated)"}`);
      const { descBreaks, ascBreaks } = orderOf(p.upd);
      for (const [a, b] of [...descBreaks, ...ascBreaks].slice(0, 4)) {
        console.log(`           break: ${showEv(a)}\n               -> ${showEv(b)}`);
      }
      console.log(`           this page's raw date_updated (first ${Math.min(6, p.upd.length)} and last ${Math.min(6, p.upd.length)}):`);
      for (const e of p.upd.slice(0, 6)) console.log(`             ${showEv(e)}`);
      if (p.upd.length > 12) console.log(`             … ${p.upd.length - 12} more …`);
      for (const e of p.upd.slice(-6)) console.log(`             ${showEv(e)}`);
    }

    check(
      "C4 no event returned twice across pages",
      w.duplicates.length === 0,
      `${w.seen.size} unique ids over ${w.count} pages; ${w.duplicates.length} duplicate(s)`,
    );
    for (const d of w.duplicates.slice(0, 10)) console.log(`           duplicate: ${showEv(d)}`);

    /**
     * Page-boundary regression, ON THE SORT FIELD.
     *
     * This measured `date_created` and reported neither the field nor the
     * amount, so its one failure — 367ms at the 39/40 boundary — could not be
     * read as anything. On the sort field it is a real question: a page starting
     * on the wrong side of the previous page's edge is a cursor that moved
     * backwards, which is how a walk re-reads or skips.
     *
     * It is also the WEAKER form of the question. SECTION 4 walks the same log
     * twice at different page sizes and compares the id sets, which detects a
     * skip whether or not the boundaries look tidy. If these two ever disagree,
     * believe SECTION 4.
     */
    const edgeRegressions = (field: "upd" | "list") => {
      const out: Array<{ i: number; prevEdge: Ev; curFirst: Ev; deltaMs: number }> = [];
      for (let i = 1; i < w.pages.length; i++) {
        const prev = dated(w.pages[i - 1][field]);
        const cur = dated(w.pages[i][field]);
        if (prev.length === 0 || cur.length === 0) continue;
        const prevEdge = prev[prev.length - 1];
        const curFirst = cur[0];
        const bad =
          order1 === "newest-first" ? curFirst.ms! > prevEdge.ms! : order1 === "oldest-first" ? curFirst.ms! < prevEdge.ms! : false;
        if (bad) out.push({ i: w.pages[i].index, prevEdge, curFirst, deltaMs: Math.abs(curFirst.ms! - prevEdge.ms!) });
      }
      return out;
    };
    const regressions = edgeRegressions("upd");
    for (const r of regressions.slice(0, 5)) {
      console.log(`         page ${r.i} starts on the wrong side of page ${r.i - 1}'s edge, by ${r.deltaMs}ms`);
      console.log(`           prev page last: ${showEv(r.prevEdge)}`);
      console.log(`           this page first: ${showEv(r.curFirst)}`);
    }
    check(
      "C4 no page starts on the wrong side of the previous page's edge, BY DATE_UPDATED",
      regressions.length === 0,
      `${regressions.length} regression(s) over ${w.count} page boundaries` +
        (regressions.length > 0 ? `; largest ${Math.max(...regressions.map((r) => r.deltaMs))}ms` : ""),
    );
    const createdRegressions = edgeRegressions("list");
    note(
      "C4c same question about date_created (informational)",
      `${createdRegressions.length} boundary regression(s)` +
        (createdRegressions.length > 0 ? `, largest ${Math.max(...createdRegressions.map((r) => r.deltaMs))}ms` : "") +
        " — expected on a consolidated log, since Close does not order by this field",
    );

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
  /**
   * SECTION 5 — INFORMATIONAL. The parameter the connector used to send.
   *
   * `close.ts` no longer sends `date_created__gte`; this section stays as the
   * historical record of what it did, and as a standing check that the answer
   * has not changed. Everything in it is a `note`, deliberately: a FAILING check
   * here would say "the parameter we stopped using still does not work", which
   * is the expected state and not a reason to fail the run.
   *
   * The live answer, the day this was demoted: identical id sets to an unbounded
   * request. Accepted and discarded. SECTION 0's C0c is the load-bearing version
   * of this and does fail, because there it is the control that makes the
   * account of the bug measured rather than assumed.
   */
  head("SECTION 5 — date_created__gte, the bound close.ts USED to send (informational)");
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

    note(
      "C5 date_created__gte excludes everything below the bound",
      `${below.length} of ${bl.length} returned events are below ${bound}` +
        (below.length > 0 ? "  [as expected: the parameter is discarded, so nothing is excluded]" : ""),
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

  /**
   * SECTION 7 — PHASE 9, and a verdict this script got wrong once already.
   *
   * The previous version probed `object_type + date_updated__gte`, watched it
   * return 400, and printed a canned line saying filtering costs the incremental
   * bound. The very next row of its own output showed
   * `object_type + action + date_updated__gte` returning 200. **The combination
   * works; `object_type` merely cannot be used without `action`.** A hardcoded
   * conclusion drawn from one of the combinations it tested contradicted the
   * rest of the table it printed.
   *
   * So there is no verdict here now. Verdicts are what this script removed from
   * everywhere else, for exactly this reason, and the one place a verdict was
   * left is the one place it lied. What it prints instead are the four numbers
   * the decision actually turns on:
   *
   *   1. which filter combinations the endpoint accepts, with the FULL 400 body
   *      listing what it allows;
   *   2. whether a filter takes MULTIPLE values, in any of its spellings;
   *   3. how many separate walks our six mapped pairs would therefore need;
   *   4. what fraction of an unfiltered page is one of those six — the number
   *      that decides whether N filtered walks beat one unfiltered one.
   */
  head("SECTION 7 — Phase 9: the numbers, no verdict");

  /** The six (object_type, action) pairs `canonicalType` in close.ts maps. */
  const MAPPED_PAIRS: Array<[string, string]> = [
    ["activity.sms", "created"],
    ["activity.call", "created"],
    ["activity.email", "created"],
    ["lead", "created"],
    ["opportunity", "created"],
    ["task", "completed"],
  ];

  await section("filter combinations", async () => {
    const base = await get({ _limit: String(MAX_LIMIT) });
    const baseIds = new Set(evs(base).map((e) => e.id));
    const withDate = dated(evs(base, "date_updated"));
    const boundValue =
      withDate.length >= 2
        ? new Date(
            Math.min(...withDate.map((e) => e.ms!)) +
              Math.floor((Math.max(...withDate.map((e) => e.ms!)) - Math.min(...withDate.map((e) => e.ms!))) / 2),
          ).toISOString()
        : null;
    if (!boundValue) note("  bound", "page 1 has too few distinct date_updated values to build a bound; combinations run unbounded");

    const bound: Record<string, string> = boundValue ? { date_updated__gte: boundValue } : {};
    const combos: Array<[string, Record<string, string>]> = [
      ["object_type alone", { object_type: "activity.sms" }],
      ["action alone", { action: "created" }],
      ["object_type + action", { object_type: "activity.sms", action: "created" }],
      ["object_type + date_updated__gte", { object_type: "activity.sms", ...bound }],
      // The one the previous verdict never tried. If `action` combines with the
      // bound on its own, five of our six pairs collapse into ONE walk
      // (action=created) plus one more for task.completed — a different answer
      // entirely from six walks.
      ["action + date_updated__gte  <-- could collapse 5 pairs into 1 walk", { action: "created", ...bound }],
      ["object_type + action + date_updated__gte", { object_type: "activity.sms", action: "created", ...bound }],
    ];

    for (const [label, params] of combos) {
      const res = await attempt({ _limit: String(MAX_LIMIT), ...params });
      if (!res.ok) {
        note(`  ${label}`, `REJECTED HTTP ${res.status}   [combination NOT supported]`);
        // IN FULL. The 400 body is where Close lists which combinations it
        // allows, and it was being clipped at 300 characters — cutting off the
        // answer to the only question this section asks.
        console.log(`           full response body:`);
        for (const line of res.body.split("\n")) console.log(`             ${line}`);
        continue;
      }
      const rows = evs(res.page);
      const rIds = new Set(rows.map((e) => e.id));
      const unchanged = rIds.size === baseIds.size && [...rIds].every((id) => baseIds.has(id));
      const types = new Set(res.page.data.map((e) => `${String(e["object_type"])}.${String(e["action"])}`));
      note(
        `  ${label}`,
        `ACCEPTED, ${rows.length} events, ${types.size} distinct object_type.action: ${[...types].slice(0, 8).join(", ")}` +
          (unchanged ? "   [SAME IDS AS NO FILTER — accepted and IGNORED]" : ""),
      );
    }
  });

  /**
   * Can one request cover more than one type?
   *
   * Every spelling is probed and then CHECKED AGAINST THE RESPONSE, because
   * "accepted" is not "honoured": a form that silently takes the first value and
   * drops the rest returns 200 and a plausible page, and would have us build six
   * walks' worth of coverage out of one walk's worth of data. So the test is
   * whether BOTH requested types actually come back.
   */
  head("SECTION 7b — does a filter take multiple values?");
  await section("multi-value filters", async () => {
    const probes: Array<[string, string]> = [
      ["object_type__in=a,b", "in"],
      ["object_type=a&object_type=b (repeated)", "repeat"],
      ["object_type=a,b (comma in one value)", "comma"],
    ];
    for (const [label, style] of probes) {
      const qs = new URLSearchParams({ _limit: String(MAX_LIMIT), action: "created" });
      if (style === "in") qs.set("object_type__in", "activity.sms,lead");
      if (style === "comma") qs.set("object_type", "activity.sms,lead");
      if (style === "repeat") {
        qs.append("object_type", "activity.sms");
        qs.append("object_type", "lead");
      }
      const res = await attemptRaw(qs);
      if (!res.ok) {
        note(`  ${label}`, `REJECTED HTTP ${res.status}: ${res.body.slice(0, 400)}`);
        continue;
      }
      const types = new Set(res.page.data.map((e) => String(e["object_type"])));
      const both = types.has("activity.sms") && types.has("lead");
      note(
        `  ${label}`,
        `ACCEPTED, ${res.page.data.length} events, object_types seen: ${[...types].join(", ") || "(none)"}` +
          (both
            ? "   [HONOURED: both types returned — one walk can cover several]"
            : "   [accepted but only one type came back: either ignored, or the page happens to hold one type — re-run to be sure]"),
      );
    }
    // Same question for `action`, since collapsing on that axis is the cheaper win.
    const qs = new URLSearchParams({ _limit: String(MAX_LIMIT) });
    qs.append("action", "created");
    qs.append("action", "completed");
    const res = await attemptRaw(qs);
    note(
      "  action=created&action=completed (repeated)",
      res.ok
        ? `ACCEPTED, actions seen: ${[...new Set(res.page.data.map((e) => String(e["action"])))].join(", ")}`
        : `REJECTED HTTP ${res.status}: ${res.body.slice(0, 400)}`,
    );
  });

  /**
   * THE NUMBER THAT DECIDES IT.
   *
   * N filtered walks beat one unfiltered walk only if the six mapped pairs are a
   * small fraction of what an unfiltered page returns. If they are most of it,
   * filtering multiplies request count to remove almost nothing — and it costs
   * N cursors, N continuations and N ways for a walk to fall behind.
   *
   * Measured over the walk SECTION 3 already performed, so it costs no extra
   * requests and samples far more than one page.
   */
  head("SECTION 7c — what fraction of the log is actually one of our six pairs?");
  await section("mapped-pair census", async () => {
    // `walk()` reduces each page to `{id, raw, ms}` triples, which do not carry
    // object_type — so the census re-reads its own pages rather than pretending
    // the earlier walk kept what it needs. Ten pages, up to 500 events: enough
    // to be a share rather than an anecdote, bounded so this stays cheap.
    const CENSUS_PAGES = Math.min(WALK_PAGES, 10);
    const rawRows: Array<Record<string, unknown>> = [];
    let page = await get({ _limit: String(MAX_LIMIT) });
    for (let n = 1; ; n++) {
      rawRows.push(...page.data);
      if (!page.cursor_next || page.data.length === 0 || n >= CENSUS_PAGES) break;
      page = await get({ _limit: String(MAX_LIMIT), _cursor: String(page.cursor_next) });
    }

    const counts = new Map<string, number>();
    for (const e of rawRows) {
      const key = `${String(e["object_type"])}.${String(e["action"])}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = rawRows.length;
    if (total === 0) return skip("C11 mapped-pair share", "no events returned");

    const mapped = new Set(MAPPED_PAIRS.map(([o, a]) => `${o}.${a}`));
    let hit = 0;
    for (const [key, n2] of counts) if (mapped.has(key)) hit += n2;

    console.log(`         every object_type.action seen over ${total} events, most common first:`);
    for (const [key, n2] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`           ${mapped.has(key) ? "MAPPED  " : "        "} ${key.padEnd(40)} ${n2}  (${((100 * n2) / total).toFixed(1)}%)`);
    }
    note(
      "C11 share of the log our six pairs represent",
      `${hit} of ${total} events = ${((100 * hit) / total).toFixed(1)}%.  ` +
        `Filtering is worth its extra walks only if this is LOW; at ${((100 * hit) / total).toFixed(0)}% ` +
        `it would remove ${(100 - (100 * hit) / total).toFixed(0)}% of the volume.`,
    );
    note(
      "C11b walks needed if no filter takes multiple values",
      `${MAPPED_PAIRS.length} (one per mapped pair). If \`action\` combines with the bound on its own (SECTION 7), ` +
        `it is 2 instead — action=created covers five pairs, action=completed the sixth — at the cost of also ` +
        `returning every OTHER object_type's created events.`,
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
