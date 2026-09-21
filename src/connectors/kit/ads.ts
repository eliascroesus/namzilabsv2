import { createHash } from "node:crypto";
import type { ObservedRateLimit } from "@/lib/http-client";
import type { CanonicalEvent, PollBudget, PollResult } from "../types";

const DAY_MS = 86_400_000;

/**
 * THE ADS REPORT WALK — the shape every ad platform's reporting API has, and
 * the one `google-analytics.ts` already had without a name for it.
 *
 * ═══ WHY THIS IS NOT `windowedWalk` ═══
 *
 * `windowedWalk` syncs RECORDS: things with an id, a created time and an
 * updated time, which arrive once and are then edited. Its whole machinery —
 * the high-water mark, the continuation, the overlap — exists to answer "what
 * changed since I last looked", and every ad reporting API answers that
 * question with silence. There is no `updated_at` on a day's spend. There is no
 * id. There is no webhook. A row does not exist until you ask for it: it is the
 * output of a GROUP BY that the flow's own config defines, computed fresh on
 * every request over a warehouse that keeps revising itself.
 *
 * So the only sync mechanism available is a date-windowed RE-READ, and the
 * correctness of the whole thing rests on the row identity below rather than on
 * any cursor. That is a different algorithm, not a variation on one, which is
 * why it is a second function and not a flag on the first.
 *
 * ═══ THE TRAILING WINDOW IS THE PROVIDER'S NUMBER, NOT OURS ═══
 *
 * Every sweep re-reads the last `trailingDays` days because the provider is
 * still changing them. Each connector takes that figure from its own provider's
 * published statement and cites it — Meta says insights "do not change after 28
 * days of being reported", and that sentence IS the 28. A window shorter than
 * the provider's restatement period freezes numbers at a value the provider has
 * since revised, and nothing anywhere will contradict it.
 */

/** One request's worth of report rows. `next` is null when the window is exhausted. */
export type AdsReportPage<Row> = {
  rows: Row[];
  /** The provider's continuation (page token, page number, offset), or null at the end. */
  next: string | null;
  rateLimit?: ObservedRateLimit | null;
};

export type DailyReportWalkOpts<Row> = {
  /**
   * How far back every sweep re-reads, from the provider's own statement about
   * when its numbers stop moving. Cite the sentence at the call site.
   */
  trailingDays: number;
  /**
   * A deeper floor for this stream, honoured for BOTH the request bound and the
   * retirement declared below.
   *
   * `types.ts` is explicit that a connector honouring `windowFloor` must spend
   * the same value in both places or a deepened import is retired by the next
   * sweep. This shape hits that hardest, because the window IS the sync: `from`
   * is computed once, below, and used twice.
   */
  windowFloor?: Date | null;
  budget?: PollBudget;
  /** Injectable clock; `budget.nowMs` wins when both are given. */
  now?: () => number;
  /** Memory ceiling on pages even when the budget allows more. */
  maxPages: number;
  /** One provider request for a slice of `[from, to]`, continuing from `cont`. */
  fetchPage: (q: { from: Date; to: Date; page: number; cont: string | null }) => Promise<AdsReportPage<Row>>;
  /** Null skips the row — a row that cannot be dated has no place on a timeline. */
  map: (row: Row) => CanonicalEvent | null;
};

/**
 * Re-read a trailing window of provider-computed daily rows, refreshing them in
 * place and retiring what the provider no longer reports.
 *
 * ═══ WHY THE RETIREMENT IS CONDITIONAL, AND THE BUG IF IT IS NOT ═══
 *
 * `mirrorScope` and `retireOutsideWindow` are declared ONLY when the walk
 * reached the end of the window. Both mean "this read enumerated its span", and
 * a walk that stopped on its page budget enumerated a PREFIX. Declaring the
 * full window off a prefix tombstones every row past the last page reached —
 * silently, on a sweep that reported no error, and worst on exactly the biggest
 * accounts, whose reports are the ones that run out of pages.
 *
 * Omitting both is always safe: the stream is then treated as incremental,
 * nothing is retired, and the next sweep re-reads the same window anyway.
 */
export async function dailyReportWalk<Row>(o: DailyReportWalkOpts<Row>): Promise<PollResult> {
  const nowMs = o.budget?.nowMs ?? o.now ?? Date.now;
  const to = new Date(nowMs());
  const trailing = new Date(to.getTime() - o.trailingDays * DAY_MS);
  // The deeper of the two floors wins, and is then the ONLY floor in play.
  const from = o.windowFloor && o.windowFloor < trailing ? o.windowFloor : trailing;

  const pageCap = o.budget ? Math.min(o.maxPages, Math.max(1, o.budget.maxCalls)) : o.maxPages;
  const deadline = o.budget?.deadlineMs;

  /**
   * KEYED BY eventId, NOT PUSHED. A provider that restates a row inside one
   * walk would otherwise produce two canonical events carrying one id, and the
   * writer's last-write-wins would make the order of our own pages decide the
   * number. One row, one entry, last reading kept.
   */
  const records = new Map<string, CanonicalEvent>();
  let providerCalls = 0;
  let rateLimit: ObservedRateLimit | null = null;
  let cont: string | null = null;

  for (let page = 0; page < pageCap; page++) {
    // Checked BETWEEN requests, so a walk overshoots by at most one bounded
    // call — the same contract `windowedWalk` keeps.
    if (page > 0 && deadline != null && nowMs() >= deadline) break;

    providerCalls += 1;
    const res = await o.fetchPage({ from, to, page, cont });
    if (res.rateLimit) rateLimit = res.rateLimit;
    for (const row of res.rows) {
      const ev = o.map(row);
      if (ev) records.set(ev.eventId, ev);
    }

    cont = res.next;
    if (!cont || res.rows.length === 0) {
      /**
       * THE WINDOW WAS READ END TO END, so a row inside it that this read did
       * not return is genuinely gone — spend fell to zero, a campaign was
       * deleted, the provider withdrew a thresholded row. Retiring those is
       * what keeps a dashboard from showing last week's number for ever.
       *
       * Scoped to the window: history older than `from` is never touched.
       */
      return {
        records: [...records.values()],
        nextCursor: null,
        providerCalls,
        rateLimit: rateLimit ?? undefined,
        mirrorScope: { from, to },
        retireOutsideWindow: { from, to },
      };
    }
  }

  return {
    records: [...records.values()],
    nextCursor: null,
    providerCalls,
    rateLimit: rateLimit ?? undefined,
    incomplete: true,
  };
}

/**
 * THE ROW IDENTITY, WHICH IS THE WHOLE DESIGN.
 *
 * A report row has no provider id, so its id has to be built from WHAT THE ROW
 * IS: a pure function of the grouping that produced it, never of what it is
 * worth. Re-reading 1 September then produces the same id with updated metric
 * values and the store UPDATES instead of duplicating — which is what makes the
 * trailing re-read safe rather than a slow leak.
 *
 * Four rules keep that hash honest. Each is a real collision, each was paid for
 * once already in `google-analytics.ts`, and this function exists so the next
 * three connectors do not each pay for them again:
 *
 *   1. THE REPORT SHAPE IS IN THE KEY. Two flows over one ad account and one
 *      day — `date x campaign` and `date x country` — are different facts that
 *      would otherwise collide on (account, date) and overwrite each other with
 *      differently-grouped numbers.
 *   2. JOINED WITH A BYTE THAT CANNOT APPEAR IN A VALUE. Campaign names contain
 *      spaces, colons, commas, emoji and newlines, so joining on any printable
 *      character makes `["a:b","c"]` and `["a","b:c"]` hash identically. A unit
 *      separator can appear in none of them.
 *   3. THE CALLER ZIPS BY HEADER, NOT BY REQUEST ORDER. Not enforceable here —
 *      stated here because this is where someone will look. Assuming the order
 *      we asked for is the order we got silently transposes two dimensions of
 *      the same cardinality.
 *   4. EMPTY IS A REAL VALUE. `(not set)`, `Unknown`, an unattributed row — do
 *      not normalise them away, and do not drop a trailing empty part; both
 *      merge genuinely different rows.
 */
// Written as an escape, never as the literal byte: a raw U+001F in source is
// invisible in a diff, in review, and in every editor — which is a poor
// property for the one character this file's correctness turns on.
export const UNIT_SEPARATOR = "\u001F";

export function reportRowId(prefix: string, parts: Array<string | null | undefined>): string {
  const hash = createHash("sha256")
    // `?? ""` rather than a filter: a missing part must still occupy its
    // position, or ["a", null, "b"] and ["a", "b"] become the same row.
    .update(parts.map((p) => p ?? "").join(UNIT_SEPARATOR))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${hash}`;
}

/**
 * The stable 8-char fingerprint of a report's SHAPE — rule 1 above, computed
 * once per poll and folded into every row's id.
 *
 * SORTED, because `[date, campaign]` and `[campaign, date]` request the same
 * report and must not produce two sets of ids for it; a flow that reorders its
 * own dimension list would otherwise duplicate its entire history.
 */
export function reportShape(dimensions: readonly string[], metrics: readonly string[]): string {
  return createHash("sha256")
    .update([...dimensions].sort().join(",") + "|" + [...metrics].sort().join(","))
    .digest("hex")
    .slice(0, 8);
}

/** `YYYY-MM-DD` in UTC — the form every one of these APIs wants its dates in. */
export const ymdUtc = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * `2026-09-01` in a named zone → the UTC instant that wall-clock midnight
 * actually was there.
 *
 * AN AD ACCOUNT REPORTS IN ITS OWN TIMEZONE, and every one of these APIs says
 * so: Meta's ad account carries `timezone_name`, Google Ads' customer carries
 * `time_zone`, and TikTok reports in the advertiser's zone unless explicitly
 * asked for UTC. Parse a report date as UTC and every row lands on the wrong day
 * for half the world — a day's spend attributed to the day before, on every
 * account west of London, for ever.
 *
 * Built by asking what UTC instant DISPLAYS as this date in that zone, rather
 * than by adding a fixed offset: the offset is not fixed, it moves twice a year,
 * and the naive arithmetic drifts an hour every spring.
 */
export function dateInZone(ymd: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
    const part = fmt.formatToParts(new Date(guess)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const off = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
    if (!off) return new Date(guess);
    const mins = (Number(off[2]) * 60 + Number(off[3])) * (off[1] === "-" ? -1 : 1);
    return new Date(guess - mins * 60_000);
  } catch {
    // An unrecognised zone must not lose the row; UTC midnight is a defensible
    // fallback and the only alternative is dropping data over a string.
    return new Date(guess);
  }
}

/**
 * A provider's numeric metric, which arrives as a STRING from every one of
 * them — integers included. `null` rather than 0 for an absent value: a day
 * with no data and a day with zero spend are different facts, and only one of
 * them should average as a zero.
 */
export function metricNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Google Ads reports money in millionths of the account's currency. */
export const fromMicros = (v: unknown): number | null => {
  const n = metricNumber(v);
  return n == null ? null : n / 1_000_000;
};
