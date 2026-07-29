/**
 * One-time HUMAN-RUN verification of the Close Event Log pagination contract.
 *
 * The Close connector (src/connectors/close.ts) and its tests
 * (tests/close-poll.test.ts) pin this contract, taken from the documented API
 * shape because developer.close.com is bot-walled from the build environment:
 *
 *   C1. GET /api/v1/event/ returns { data: [...], cursor_next }
 *   C2. pages are CONSISTENTLY ordered by date_created — and the direction is
 *       reported rather than assumed (see "ordering" below)
 *   C3. `_limit` is capped at 50 for this endpoint, by clamping or by refusing
 *   C4. `cursor_next` + `_cursor` walk without overlap or skip, and reach a page
 *       with cursor_next = null (termination)
 *   C5. `date_created__gte` bounds the window (no event older than the bound)
 *   C6. does `date_created__lte` bound the other end? (probe — see below)
 *   C7. does `_order_by` control the ordering? (probe — see below)
 *
 * ORDERING IS A FINDING, NOT AN ASSUMPTION. The first run of this script
 * reported the Event Log as OLDEST-first, contradicting the newest-first shape
 * every fixture in tests/close-poll.test.ts was built from. The walk itself is
 * safe either way — it ingests every event on every page and stops only on
 * cursor exhaustion — but anything that reads MEANING out of a partial walk
 * (how far back an import has got, which records a preview shows) is wrong if
 * it assumes a direction. So C2 checks that the ordering is consistent, prints
 * which way it runs, and C4 derives its own checks from that observation.
 *
 * C6 and C7 are probes for capabilities the connector does not yet use, and
 * they never fail the run — an unsupported parameter is a finding, not a defect.
 * They are here because each would let the connector do something it currently
 * cannot: `date_created__lte` makes an exact non-overlapping window segment
 * (recent-first import with no re-reads), and `_order_by` makes "the newest N
 * events" one request instead of a bounded search.
 *
 * NO SINGLE CHECK CAN ABORT THE RUN. It used to: the `_limit` cap probe asked
 * for 100, Close answered HTTP 400 rather than clamping, the exception escaped
 * to the top level, and C4 and C5 — the two checks that actually matter, cursor
 * integrity and the 30-day first-sync bound — never ran at all. Every block is
 * now independently guarded and a thrown block is reported as its own failure.
 *
 * Run against the live API with a real (ideally read-only) key:
 *
 *   CLOSE_API_KEY=api_xxx pnpm tsx scripts/verify-close-pagination.ts
 *
 * Read-only: performs only GET requests. Exits 0 when every check passes.
 */

const API = "https://api.close.com/api/v1";

/** The endpoint's documented maximum page size, mirrored from close.ts. */
const MAX_LIMIT = 50;
/** Safety cap on the cursor walk — read-only, but no reason to page forever. */
const WALK_PAGES = 20;

type EventPage = { data: Array<Record<string, unknown>>; cursor_next?: string | null };
type Attempt = { ok: true; page: EventPage } | { ok: false; status: number; body: string };

const failures: string[] = [];
const findings: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/** A probe result: recorded and printed, never a failure. */
function note(name: string, detail: string): void {
  console.log(`  [INFO] ${name} — ${detail}`);
  findings.push(`${name}: ${detail}`);
}

/** A check that could not be evaluated. Louder than silence, not a failure. */
function skip(name: string, why: string): void {
  console.log(`  [SKIP] ${name} — ${why}`);
  findings.push(`${name} SKIPPED: ${why}`);
}

/**
 * One request, returning the HTTP failure instead of throwing it.
 *
 * The distinction matters for the cap probe specifically: "Close refuses an
 * over-limit request" and "the script crashed" are the same event to a
 * try/catch, and treating them the same is what hid C4 and C5.
 */
async function attempt(params: Record<string, string>): Promise<Attempt> {
  const key = process.env.CLOSE_API_KEY;
  if (!key) {
    console.error("Set CLOSE_API_KEY (the connection's API key) and re-run.");
    process.exit(2);
  }
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/event/?${qs}`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: body.slice(0, 300) };
  return { ok: true, page: JSON.parse(body) as EventPage };
}

async function get(params: Record<string, string>): Promise<EventPage> {
  const a = await attempt(params);
  if (!a.ok) throw new Error(`HTTP ${a.status}: ${a.body}`);
  return a.page;
}

/**
 * Run one group of checks; a throw inside it fails that group and ONLY it.
 * Returns null on a throw, so a later group can tell "did not run" from a result.
 */
async function group<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    check(`${label} (could not run)`, false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

const dates = (p: EventPage) => p.data.map((e) => String(e.date_created ?? ""));
const times = (ds: string[]) => ds.map((d) => Date.parse(d)).filter((n) => Number.isFinite(n));

type Order = "newest-first" | "oldest-first" | "mixed" | "indeterminate";

/**
 * Which way a page runs, from the page itself.
 *
 * "indeterminate" covers fewer than two parseable dates and the all-identical
 * case — both are consistent with either direction, so claiming one would be
 * exactly the assumption this script exists to remove.
 */
function orderOf(ds: string[]): Order {
  const ts = times(ds);
  if (ts.length < 2) return "indeterminate";
  const desc = ts.every((t, i) => i === 0 || ts[i - 1] >= t);
  const asc = ts.every((t, i) => i === 0 || ts[i - 1] <= t);
  if (desc && asc) return "indeterminate"; // every timestamp identical
  if (desc) return "newest-first";
  if (asc) return "oldest-first";
  return "mixed";
}

async function main() {
  console.log("Close Event Log pagination contract verification\n");

  const opened = await group("C1-C3 first page", async () => {
    const page = await get({ _limit: String(MAX_LIMIT) });
    check("C1 response has data[] and cursor_next", Array.isArray(page.data) && "cursor_next" in page);

    const order = orderOf(dates(page));
    // Consistency is the contract; the DIRECTION is the finding.
    check("C2 page 1 is consistently ordered by date_created", order !== "mixed", `${page.data.length} events, ${order}`);
    note("C2 observed ordering", order);

    check("C3 _limit=50 honored", page.data.length <= MAX_LIMIT, `got ${page.data.length}`);
    return { page, order };
  });

  // The cap: asked for one MORE than the documented maximum. Close may clamp
  // (200 with <= 50 rows) or refuse (400). Both enforce the cap; only a page of
  // 51 would mean the connector's EVENT_LOG_LIMIT is wrong.
  await group("C3 cap", async () => {
    const over = await attempt({ _limit: String(MAX_LIMIT + 1) });
    if (!over.ok) {
      check(`C3 _limit cap enforced (asked ${MAX_LIMIT + 1})`, over.status === 400, `refused with HTTP ${over.status}: ${over.body}`);
    } else {
      check(`C3 _limit cap enforced (asked ${MAX_LIMIT + 1})`, over.page.data.length <= MAX_LIMIT, `clamped to ${over.page.data.length}`);
    }
  });

  if (!opened || opened.page.data.length === 0) {
    console.log("\nEvent log is empty (or page 1 failed) — create some activity and re-run for the walk checks.");
    report();
    return;
  }
  const { page: page1, order } = opened;

  /**
   * Walk `cursor_next` from a starting page, collecting every event.
   *
   * `drained` distinguishes "reached the end of the data" from "stopped on the
   * page cap" — the difference between a walk whose id set is COMPLETE over its
   * span and one that merely got tired. The skip check below is only sound on a
   * complete one.
   */
  async function walk(start: EventPage, params: Record<string, string>) {
    const events = new Map<string, string>(); // id -> date_created
    const record = (p: EventPage) => {
      let dup = false;
      for (const e of p.data) {
        const id = String(e.id);
        if (events.has(id)) dup = true;
        events.set(id, String(e.date_created ?? ""));
      }
      return dup;
    };
    let page = start;
    let pages = 1;
    let duplicate = record(page);
    let ordered = true;
    let boundaryBreak = false;
    let ts = times(dates(page));
    let prevEnd = ts.length > 0 ? ts[ts.length - 1] : null;

    while (page.cursor_next && pages < WALK_PAGES) {
      page = await get({ ...params, _cursor: String(page.cursor_next) });
      pages += 1;
      if (page.data.length === 0) break;
      if (record(page)) duplicate = true;

      const pageOrder = orderOf(dates(page));
      if (pageOrder === "mixed" || (order !== "indeterminate" && pageOrder !== "indeterminate" && pageOrder !== order)) ordered = false;

      // Continuing in the observed direction: an oldest-first walk must not step
      // back to something older than the previous page ended on, and vice versa.
      ts = times(dates(page));
      if (prevEnd != null && ts.length > 0) {
        if (order === "newest-first" && ts[0] > prevEnd) boundaryBreak = true;
        if (order === "oldest-first" && ts[0] < prevEnd) boundaryBreak = true;
      }
      if (ts.length > 0) prevEnd = ts[ts.length - 1];
    }
    const drained = !page.cursor_next || page.data.length === 0;
    return { events, pages, duplicate, ordered, boundaryBreak, drained };
  }

  // C4: the cursor walk. What matters regardless of ordering is that no event is
  // returned twice and none is stepped over — a walk that skips is the Defect #2
  // class this connector was rewritten to fix. The MONOTONICITY check is derived
  // from the direction observed above rather than assumed to be newest-first.
  const full = await group("C4 cursor walk", async () => {
    const w = await walk(page1, { _limit: String(MAX_LIMIT) });
    check("C4 every page runs the same direction as page 1", w.ordered, `${w.pages} pages, ${order}`);
    check("C4 no duplicate events across pages", !w.duplicate, `${w.events.size} unique over ${w.pages} pages`);
    check("C4 no page regresses past the previous page's edge", !w.boundaryBreak);
    check(
      "C4 walk terminates (cursor_next null or empty page)",
      w.drained || w.pages >= WALK_PAGES,
      w.pages >= WALK_PAGES ? `stopped at the ${WALK_PAGES}-page safety cap — re-check manually` : `${w.pages} pages`,
    );
    return w;
  });

  /**
   * C4's other half, and the one Defect #2 was: SKIPPING.
   *
   * Duplication is self-evident from a single walk; a skip is not. A cursor that
   * steps over ten records per page produces no duplicate, no ordering break and
   * a clean termination — every check above passes while data is silently
   * unreachable. That is exactly how the original single-page Close poll stranded
   * every event below the newest 50.
   *
   * The detector: walk the same span a SECOND time behind a `date_created__gte`
   * bound. Two complete walks over one span must return the same ids. A cursor
   * that skips lands on different offsets in the two walks, so the id sets
   * disagree — which no single walk could ever reveal.
   */
  await group("C4 skip detection", async () => {
    if (!full) return;
    if (!full.drained) {
      skip("C4 cursor walk skips no records", `the first walk stopped on the ${WALK_PAGES}-page cap, so its id set is not complete over any span`);
      return;
    }
    const ts = [...full.events.values()].map((d) => Date.parse(d)).filter((n) => Number.isFinite(n));
    if (ts.length < 3) {
      skip("C4 cursor walk skips no records", "too few events to re-walk a bounded span");
      return;
    }
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    if (lo === hi) {
      skip("C4 cursor walk skips no records", "every event shares one timestamp, so no bound splits the span");
      return;
    }
    const bound = new Date(lo + Math.floor((hi - lo) / 2)).toISOString();
    const params = { _limit: String(MAX_LIMIT), date_created__gte: bound };
    const again = await walk(await get(params), params);
    if (!again.drained) {
      skip("C4 cursor walk skips no records", "the bounded re-walk hit the page cap");
      return;
    }

    // Expected = what the first walk saw at or after the bound. Events CREATED
    // between the two walks are newer than anything the first walk saw, so they
    // are excluded rather than counted as a disagreement.
    const expected = new Set([...full.events].filter(([, d]) => Date.parse(d) >= Date.parse(bound)).map(([id]) => id));
    const got = new Set([...again.events].filter(([, d]) => Date.parse(d) <= hi).map(([id]) => id));
    const missing = [...expected].filter((id) => !got.has(id));
    const extra = [...got].filter((id) => !expected.has(id));
    check(
      "C4 cursor walk skips no records",
      missing.length === 0 && extra.length === 0,
      missing.length + extra.length === 0
        ? `${expected.size} events reached identically by two independent walks`
        : `${missing.length} unreachable on the bounded walk, ${extra.length} unreachable on the full walk — the cursor is stepping over records`,
    );
  });

  // C5: THE 30-day first-sync bound shipped in batch 1. Never verified until
  // now, because the cap probe aborted the script before reaching it.
  await group("C5 date_created__gte", async () => {
    const ts = times(dates(page1));
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    if (ts.length < 2 || lo === hi) {
      skip("C5 date_created__gte bounds the window", "page 1 has no two distinct timestamps to bound between");
      return;
    }
    // A bound strictly inside page 1's span, so an IGNORED parameter is visibly
    // different from an honored one: ignoring it returns events below the bound.
    const bound = new Date(lo + Math.floor((hi - lo) / 2)).toISOString();
    const bounded = await get({ _limit: String(MAX_LIMIT), date_created__gte: bound });
    const out = dates(bounded).filter((d) => Date.parse(d) < Date.parse(bound));
    check("C5 date_created__gte bounds the window", out.length === 0, `bound ${bound}, ${out.length} event(s) below it`);
  });

  // C6 (probe): an upper bound would make a window SEGMENT expressible, which is
  // what a recent-first import needs to walk an oldest-first log without
  // re-reading the shallower part of the window on every rung.
  await group("C6 date_created__lte probe", async () => {
    const ts = times(dates(page1));
    if (ts.length < 2) {
      skip("C6 date_created__lte", "page 1 has too few events to test an upper bound");
      return;
    }
    const bound = new Date(Math.min(...ts) + Math.floor((Math.max(...ts) - Math.min(...ts)) / 2)).toISOString();
    const res = await attempt({ _limit: String(MAX_LIMIT), date_created__lte: bound });
    if (!res.ok) {
      note("C6 date_created__lte", `REJECTED with HTTP ${res.status} — no upper bound available: ${res.body}`);
      return;
    }
    const above = dates(res.page).filter((d) => Date.parse(d) > Date.parse(bound));
    note(
      "C6 date_created__lte",
      above.length === 0
        ? `SUPPORTED — bounded at ${bound}, nothing above it (${res.page.data.length} events)`
        : `IGNORED — ${above.length} of ${res.page.data.length} events are above ${bound}`,
    );
  });

  // C7 (probe): explicit ordering would make "the newest N events" one request.
  // Only decidable while the DEFAULT ordering is not already descending — if it
  // is, a supported parameter and an ignored one look identical.
  await group("C7 _order_by probe", async () => {
    if (order === "newest-first") {
      note("C7 _order_by", "not decidable — the default ordering is already newest-first, so an ignored parameter looks supported");
      return;
    }
    const res = await attempt({ _limit: String(MAX_LIMIT), _order_by: "-date_created" });
    if (!res.ok) {
      note("C7 _order_by", `REJECTED with HTTP ${res.status}: ${res.body}`);
      return;
    }
    const got = orderOf(dates(res.page));
    note(
      "C7 _order_by=-date_created",
      got === "newest-first"
        ? "SUPPORTED — the ordering flipped to newest-first"
        : `IGNORED — still ${got} (default is ${order})`,
    );
  });

  report();
}

function report(): void {
  if (findings.length > 0) {
    console.log("\nFindings (not failures):");
    for (const f of findings) console.log(`  - ${f}`);
  }
  console.log(
    failures.length === 0
      ? "\nAll checks passed — the pinned contract holds."
      : `\n${failures.length} check(s) FAILED: ${failures.join("; ")}\n→ Update src/connectors/close.ts + tests/close-poll.test.ts before shipping the connector.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // Only reachable if something outside every guarded group throws.
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});

export {};
