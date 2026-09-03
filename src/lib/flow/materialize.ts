import { and, asc, eq, inArray, lt, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { backfillJobs, connections, flowResults, flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { hasStreamConfig, streamConfigHash } from "@/lib/sync/stream-hash";
import {
  runFlow,
  buildTile,
  bucketUnitForWindow,
  bucketWindowsFor,
  tileByRange,
  type CompileProvenance,
  type RangeSlot,
} from "./engine";
import { compileEnabled } from "./compile/flags";
import { getPublishedVersion, graphFingerprint, graphForFingerprint } from "./store";
import { parseGraph, seedMetricFormat, seedMetricFacts, type TileSpec } from "./types";
import { resolveRange, isForwardRange, MATERIALIZED_RANGES } from "@/lib/metrics/range";
import { calendarDayRanges } from "@/lib/metrics/calendar";
import { streamRefsOfGraph } from "@/lib/sync/streams";

/**
 * Whether the graph carries a window that MOVES WITH THE CLOCK — a Filter's
 * quick date range or a Time step on a relative preset or a rolling "last N
 * days", including the legacy per-branch conditions a Paths hub can hold. A
 * fixed between-dates window is excluded when both ends are set; an open
 * "from X onwards" ends at now, so it slides too.
 */
function graphHasSlidingWindow(graph: { nodes: Array<{ type: string; data: { config?: unknown } }> }): boolean {
  const slides = (w?: { enabled?: boolean; mode?: string; to?: string }): boolean => {
    if (!w) return false;
    if (w.enabled === false) return false; // Filter ranges carry `enabled`; a Time step does not.
    if (w.mode === "between") return !w.to;
    return true; // presets and rolling windows follow the clock
  };
  for (const n of graph.nodes) {
    const cfg = (n.data.config ?? {}) as {
      dateRange?: { enabled?: boolean; mode?: string; to?: string };
      mode?: string;
      to?: string;
      paths?: Array<{ filters?: { dateRange?: { enabled?: boolean; mode?: string; to?: string } } }>;
    };
    if (n.type === "time" && slides(cfg)) return true;
    if (n.type === "filter" && slides(cfg.dateRange)) return true;
    if (n.type === "paths") {
      for (const p of cfg.paths ?? []) if (slides(p.filters?.dateRange)) return true;
    }
  }
  return false;
}

/**
 * THE STORED CROSSING, BOUNDED AT THE WRITE SITE — because one bad row here
 * stops the expiry sweep for a whole org, not just for its own tile.
 *
 * `expireAgedResults` reads this value in SQL as
 * `(tile ->> 'nextChangeAt')::timestamptz`, and Postgres THROWS on a timestamp
 * outside its range: `select '+010000-01-01T00:00:00.000Z'::timestamptz` is
 * "time zone displacement out of range". The cast runs over every candidate
 * row, so a single tile carrying an extended-year spelling fails the whole
 * UPDATE and every result in that org stops expiring — behind green dots.
 *
 * A year-10000 value is one deleted line away: `tileByRange` derives "now" from
 * the range ends, so a forward range that stops declaring itself `future`
 * hands it the sentinel, and its midnight cap lands past year 9999. The
 * arithmetic upstream is the first lock; this is the second, at the only place
 * the value becomes a stored string.
 *
 * Both bounds are the ones the arithmetic already promises: never later than
 * the next UTC midnight after this run, never a non-finite instant (which
 * `toISOString` throws on — inside materializeFlow's own catch, which would
 * then mark the flow errored and blame the customer's graph). Clamping to
 * midnight when a run straddles it costs one extra recompute, not a wrong
 * number.
 */
function nextChangeAtIso(nextChangeMs: number, slidingCapMs: number, asOf: Date): string {
  const nextMidnight = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate() + 1);
  const crossing = Number.isFinite(nextChangeMs) ? nextChangeMs : nextMidnight;
  return new Date(Math.min(crossing, slidingCapMs, nextMidnight)).toISOString();
}

/**
 * THE DASHBOARD'S OWN SLOTS — the day keys dropped, and `records` with them.
 *
 * `tileByRange` answers every window it is handed in one shape, so the seven
 * pills came back carrying a `records` count that only the CALENDAR asks for:
 * seven numbers per tile that nothing on the board reads (`flow-tile.tsx`
 * doesn't even declare the field), riding in the one column the dashboard
 * fetches on every render and every freshness poll. About a hundred bytes a
 * tile — small, and it is exactly the kind of small that accumulates unnoticed
 * in a column billed by the byte, because nothing renders differently when it
 * is there.
 *
 * Dropped HERE rather than in `tileByRange`, which has no business knowing
 * which of its callers wants which field.
 */
function dashboardRanges(
  byRange: Record<string, RangeSlot>,
  dayKeys: Set<string>,
): Record<string, RangeSlot> {
  const out: Record<string, RangeSlot> = {};
  for (const [key, slot] of Object.entries(byRange)) {
    if (dayKeys.has(key)) continue;
    const { records: _records, ...rest } = slot;
    out[key] = rest;
  }
  return out;
}

/**
 * The day slots, reduced to what a calendar square can show.
 *
 * `tileByRange` answers every window in the same rich shape — value, series,
 * groups, the reason it could not be answered — and a square has room for a
 * number and a record count. Storing the rest would put sixty copies of a
 * metric's series into every tile's jsonb to render sixty numbers.
 *
 * A day with no answer is DROPPED rather than stored with its reason (see
 * `byDay` in types.ts): the empty square already says it, and sixty stored
 * sentences per tile is real weight in a column the dashboard reads on every
 * page load. A day whose value is genuinely 0 is kept — "none happened" and
 * "we cannot say" are different facts and the calendar draws them differently.
 */
function dayValues(
  byRange: Record<string, { value?: number; records?: number }>,
  dayKeys: Set<string>,
): Record<string, { value: number; records?: number }> {
  const out: Record<string, { value: number; records?: number }> = {};
  for (const key of dayKeys) {
    const slot = byRange[key];
    if (!slot || slot.value == null || !Number.isFinite(slot.value)) continue;
    out[key] = slot.records != null && slot.records > 0 ? { value: slot.value, records: slot.records } : { value: slot.value };
  }
  return out;
}

/**
 * A TREND FOR EVERY BOUNDED RANGE, ASSEMBLED FROM WINDOWS EACH ANSWERED ON ITS
 * OWN — never composed.
 *
 * THE COMPLAINT: "if I can see it on the calendar view then I should be able to
 * see it in the charts." It was exactly right. A percentage, a currency total
 * and a duration are `shape.kind === "scalar"` at the endpoint, so `buildTile`
 * never writes them a `series` — and `chartsFor` offers line, area and bar only
 * to a metric that has one. Meanwhile the per-day numbers already existed and
 * were already paid for: the calendar renders them, out of this same
 * `tileByRange` call, for every shape there is. This files them where the chart
 * looks.
 *
 * NOTHING IS SUMMED OR AVERAGED. Each point is the metric over its own window —
 * a day's rate is that day's numerator over that day's denominator, a week's is
 * the week's. Folding days into a week is wrong for everything except a count
 * or a sum, and the tile carries no fact that could tell those apart.
 *
 * SCALARS ONLY. A dataset, a bucketed series and a breakdown already carry what
 * they measured; writing a trend into a breakdown's slot would flip a live
 * table tile from listing groups to listing periods.
 *
 * A WINDOW WITH NO ANSWER IS ABSENT, not zero — a rate whose denominator
 * emptied stored `unavailable` and has no value at all. The renderer turns the
 * gap into a hole for a ratio and into a measured zero for a count, which is
 * the same doctrine `byDay` follows.
 */
function withTrends(
  out: Record<string, RangeSlot>,
  all: Record<string, RangeSlot>,
  ranges: Array<{ key: string; start: number; end: number; all?: boolean }>,
): Record<string, RangeSlot> {
  /**
   * "ONE NUMBER PER PERIOD" IS ASKED OF THE DATA, not of the `facts` stamp.
   *
   * The first version gated on `facts.shape === "scalar"`, which is the same
   * question asked of a field that a legacy Output-node tile may simply not
   * carry — those tiles are built inside `execOutput` rather than by the
   * `factCorrected` path above, so the stamp can be absent and every metric
   * behind one silently got no trend. Percentages were the visible casualty.
   *
   * The condition that actually matters is structural: this metric measures a
   * single figure per window, so no slot of it carries a breakdown or a series
   * of its own. Reading it off the slots needs no stamp and cannot go stale —
   * and it still refuses a grouped tile, where writing a trend would flip a
   * live table from listing groups to listing periods.
   */
  const measuresOneNumber = Object.values(out).every((s) => !s.groups && !s.series);
  if (!measuresOneNumber) return out;
  for (const r of ranges) {
    if (r.all) continue;
    const slot = out[r.key];
    if (!slot || slot.unavailable || slot.series) continue;
    const points = bucketWindowsFor(r.start, r.end)
      .map((b) => ({ bucket: b.key, value: all[b.key]?.value }))
      .filter((p): p is { bucket: string; value: number } => p.value != null && Number.isFinite(p.value));
    // ONE POINT IS NOT A TREND. The tile refuses to draw it and says so, so
    // storing one is bytes on every dashboard render for a chart that cannot
    // exist. Today and Yesterday are one day long by definition.
    if (points.length < 2) continue;
    slot.series = points;
    // NOT OPTIONAL: absent, the renderer reads the slot as a row written before
    // windows carried their own buckets and tells the customer to refresh, and
    // the axis falls back to the metric's declared unit and prints raw keys.
    slot.unit = bucketUnitForWindow(r.end - r.start);
    // Says what it is, so no reader has to infer it — see the note on the type.
    slot.assembled = true;
  }
  return out;
}

/**
 * Compute the published version's Output results and store them in flow_results
 * (fast dashboard reads). Runs on publish, on a manual refresh, or when relevant
 * data changes. Never blocks the dashboard render.
 */
export async function materializeFlow(db: DB, orgId: string, flowId: string): Promise<{ ok: boolean; error?: string }> {
  const published = await getPublishedVersion(db, orgId, flowId);
  if (!published) return { ok: false, error: "Flow is not published." };
  const { version, graph } = published;

  try {
    // E.5: collect provenance for this materialization — the SQL behind every
    // number, stored with the number itself.
    const provenance: CompileProvenance[] = [];
    const asOf = new Date();
    // E.4: compile is env-gated (default off) — see compile/flags.ts. This is
    // the call site that made `EngineCtx.compile` reachable in production at
    // all; before it, the parity-proven pushdown had exactly zero callers and
    // the provenance label `engine: "compiled"` below was dead code.
    const { nodes, outputs } = await runFlow({ db, orgId, provenance, compile: compileEnabled("materialize") }, graph);

    // Tiles come from Output nodes (legacy flows) and/or endpoint metrics chosen at
    // Review & publish (new flows) — one tile per enabled metric.
    const tiles: Array<{ nodeId: string; tile: TileSpec }> = outputs.map((o) => ({ nodeId: o.nodeId, tile: o.tile }));
    /**
     * Enabled metrics whose step FAILED. Tracked separately because the tidy-up
     * at the end deletes every stored row that is not in `tiles` — so a metric
     * that started failing had its row DELETED, vanished from the dashboard
     * without a trace, and this function still returned ok. The more metrics a
     * flow had, the quieter the loss: the honest path below only runs when
     * every single tile fails.
     */
    const failed: Array<{ nodeId: string; error: string }> = [];
    /**
     * THE STEP'S CONFIG IS THE TRUTH ABOUT WHAT ITS NUMBER MEANS. A metric
     * spec snapshots the step's format/unit at seed time and is returned
     * verbatim forever after — so when a customer changed a Calculate's field
     * from `time_between.hours` to `time_between.minutes`, the published spec
     * kept `unit: "hours"`, and a median of 0.58 minutes (35 seconds, exactly
     * what the builder's Test showed) rendered on the dashboard as "35m". The
     * builder derives the unit from the field on every render; the tile must
     * derive it from the same place. Re-derived HERE, at materialize, so every
     * already-published stale spec heals on its next recompute with no
     * republish. Presentation the spec legitimately owns — name, viz,
     * precision, target, time reference — is untouched; only duration FACTS
     * follow the step, in either direction of staleness.
     */
    const nodeCfgById = new Map(graph.nodes.map((n) => [n.id, (n.data.config ?? {}) as Record<string, unknown>]));
    const factCorrected = <T extends { nodeId: string; format?: string }>(m: T): T & { facts: ReturnType<typeof seedMetricFacts> } => {
      const cfg = nodeCfgById.get(m.nodeId);
      if (!cfg) return { ...m, facts: { kind: "count" as const } };
      /**
       * THE WIDER HALF OF THE SAME RULE. `seedMetricFacts` re-derives what the
       * number IS — count, duration-with-unit, pre-multiplied ratio, ordered
       * stages — from the step config on every materialize, exactly the way
       * the duration healing below always has. It rides the presentation into
       * `buildTile`, which stamps it (plus the run's shape) onto the tile.
       */
      const facts = seedMetricFacts(cfg);
      const derived = seedMetricFormat(cfg);
      if (m.format !== "duration" && derived.format !== "duration") return { ...m, facts };
      // A step switched from duration back to plain number sheds its unit too:
      // `seedMetricFormat`'s number answer carries no unit key, so a bare
      // spread kept the old "minutes" and a count rendered as "56 minutes".
      return derived.format === "duration"
        ? { ...m, ...derived, facts }
        : { ...m, ...derived, facts, unit: undefined, durationDisplay: undefined };
    };
    for (const m of graph.metrics) {
      if (!m.enabled) continue;
      const ex = nodes.get(m.nodeId);
      if (ex && ex.status === "ok") tiles.push({ nodeId: m.nodeId, tile: buildTile(factCorrected(m), ex.shape, ex.sample) });
      else failed.push({ nodeId: m.nodeId, error: ex && ex.status === "error" ? ex.error : "This step produced no result." });
    }

    if (tiles.length === 0) {
      // Nothing produced a result. Surface the earliest failing node's error
      // (topological order) — that's the root cause, not the downstream fallout.
      let message = "The flow produced no dashboard result.";
      for (const [, n] of nodes) {
        if (n.status === "error") {
          message = n.error;
          break;
        }
      }
      await db.update(flowResults).set({ status: "error", error: message }).where(eq(flowResults.flowId, flowId));
      return { ok: false, error: message };
    }
    /**
     * Which STREAMS this result was computed from.
     *
     * Recorded here because this is the one moment the published graph is
     * already in hand — deriving it at dashboard render would mean loading a
     * whole `flow_versions` row per tile per page load, which is exactly the
     * cost materialized results exist to avoid.
     *
     * It is a MAPPING and not a snapshot of import state: the state itself is
     * read live against these keys, so several flows on one backfilling stream
     * cannot drift apart between their materializations.
     *
     * Stored inside the existing `provenance` jsonb, so this needs no schema
     * change and no migration.
     */
    const conns = await db
      .select({ id: connections.id, source: connections.source })
      .from(connections)
      .where(eq(connections.orgId, orgId));
    const streams = streamRefsOfGraph(graph, (id) => conns.find((c) => c.id === id)?.source).map((r) => ({
      connectionId: r.connectionId,
      configHash: r.configHash,
    }));

    const record = {
      asOf: asOf.toISOString(),
      engine: provenance.some((p) => p.foldedFilterNodeIds.length > 0) ? "compiled" : "js",
      reads: provenance,
      streams,
    };

    /**
     * THE SAME METRIC, SEEN THROUGH EACH DASHBOARD RANGE.
     *
     * The range pills sat above tiles they could not touch — a stored tile is
     * computed from the flow's own definition, so "Today" and "Last 90 days"
     * rendered the identical number. Reported, correctly, as "the time thing
     * doesn't work at all".
     *
     * ONE run of the graph answers every range. The first attempt re-ran it per
     * range with the window pushed into each Get-data read, which was six times
     * the database work AND wrong: truncating the read starves the flow's own
     * logic, so de-duplication picked the earliest record of the window instead
     * of the genuine first, and any pair straddling midnight was counted in
     * neither day. `tileByRange` instead windows the finished metric's records
     * and re-does only the arithmetic — see its docstring.
     */
    const ranges = MATERIALIZED_RANGES.map((key) => {
      const { range } = resolveRange(key);
      return {
        key,
        start: range.from.getTime(),
        end: range.to.getTime(),
        all: key === "all",
        // A forward range ends at a sentinel rather than at the clock, and
        // `tileByRange` derives "now" from these ends — it has to skip those
        // or every crossing it computes lands beyond the horizon.
        future: isForwardRange(key),
        // NO `rollingMs`. Every window above is midnight-anchored at both ends
        // now, so nothing sheds at `t + length`; membership changes only at UTC
        // midnight, which `tileByRange` already books unconditionally. Passing
        // shed times here bought nothing but extra mid-afternoon recomputes of
        // an unchanged tile. See the note where `rollingMsOf` used to live.
      };
    });
    /**
     * THE CALENDAR'S DAYS, ON THE SAME RUN.
     *
     * One graph run already answers seven dashboard ranges; these are sixty-odd
     * more windows over the very same records, and they are the reason the
     * calendar view can be a plain read of `flow_results` instead of a flow run
     * per page view. `tileByRange` re-does only the final arithmetic per window
     * (`reexecPure` touches no database), so the cost here is CPU over records
     * already in memory — never another query, never another byte of egress.
     *
     * The keys cannot collide with the range keys above: a day is "2026-05-04"
     * and a range is "today". The split below relies on that, and
     * tests/calendar-window.test.ts pins it.
     */
    const dayRanges = calendarDayRanges(asOf);
    const presentationOf = new Map<string, Parameters<typeof tileByRange>[3]>();
    for (const m of graph.metrics) if (m.enabled) presentationOf.set(m.nodeId, factCorrected(m));
    // An Output node carries its own presentation in its config; the tile it
    // already produced is the faithful copy of it.
    for (const o of outputs) if (!presentationOf.has(o.nodeId)) presentationOf.set(o.nodeId, o.tile as Parameters<typeof tileByRange>[3]);

    /**
     * A flow with its OWN sliding window is the one case the crossings cannot
     * see: records the in-flow filter excludes never reach the endpoint, so a
     * record due to fall out of the filter's "last 7 days" — or a future
     * meeting due to enter its "today" — is invisible to `tileByRange`. Those
     * flows get an hourly cap instead: still 24 recomputes a day instead of
     * 144, and only for the flows whose base number actually moves with the
     * clock. Fixed between-dates windows never move and take no cap.
     */
    const slidingCapMs = graphHasSlidingWindow(graph) ? asOf.getTime() + 60 * 60 * 1000 : Infinity;
    const dayKeys = new Set(dayRanges.map((d) => d.key));

    /**
     * THE TREND WINDOWS THE CALENDAR HAS NOT ALREADY PAID FOR.
     *
     * A day bucket key and a calendar day key are the same string — `bucketKey`
     * spells a day `iso.slice(0, 10)` and so does `dayKey` — and `resolveRange`
     * and `calendarDayRanges` mint the same midnight-to-midnight window. So
     * Today, Yesterday, Last 7 days and Last 30 days are day-grained and every
     * window they need is ALREADY in `dayRanges`: they cost nothing. Only the
     * weeks of Last 90 days are new, and there are thirteen of them.
     *
     * Deduped by key rather than by trusting that arithmetic to line up, which
     * also covers the one day a month-boundary range can reach past the
     * calendar's own two-month horizon.
     */
    const trendKeys = new Set(dayKeys);
    const trendRanges: typeof dayRanges = [];
    for (const r of ranges) {
      if (r.all) continue;
      for (const b of bucketWindowsFor(r.start, r.end)) {
        if (trendKeys.has(b.key)) continue;
        trendKeys.add(b.key);
        // `tracksCrossings: false` for the reason `calendarDayRanges` gives:
        // these windows are READ from the run and get no vote on when the tile
        // next changes.
        trendRanges.push({ key: b.key, start: b.start, end: b.end, tracksCrossings: false });
      }
    }

    for (const t of tiles) {
      const spec = presentationOf.get(t.nodeId);
      const derived = spec
        ? tileByRange(graph, nodes, t.nodeId, spec, [...ranges, ...dayRanges, ...trendRanges])
        : undefined;
      // `nextChangeAt` rides in the tile jsonb, so no migration — and the
      // expiry can read it in SQL. See its docstring in types.ts.
      const tile =
        derived && Object.keys(derived.byRange).length > 0
          ? {
              ...t.tile,
              // The SUPERSET, so no bucket key can leak into `byRange` and mint
              // a phantom pill. `byDay` still takes `dayKeys` alone, so the
              // calendar's own payload is unchanged.
              byRange: withTrends(dashboardRanges(derived.byRange, trendKeys), derived.byRange, ranges),
              byDay: dayValues(derived.byRange, dayKeys),
              nextChangeAt: nextChangeAtIso(derived.nextChangeMs, slidingCapMs, asOf),
            }
          : t.tile;
      await upsertResult(db, orgId, flowId, version, t.nodeId, tile, "fresh", null, record);
    }
    // A metric that broke keeps its row, its last good value, and gains the
    // reason — so the tile goes red and says why, instead of disappearing.
    for (const f of failed) {
      await db
        .update(flowResults)
        .set({ status: "error", error: f.error })
        .where(and(eq(flowResults.flowId, flowId), eq(flowResults.outputNodeId, f.nodeId)));
    }
    // Drop results for tiles that no longer exist in the published flow — the
    // failed ones are still part of it, so they are kept.
    const keep = [...tiles.map((t) => t.nodeId), ...failed.map((f) => f.nodeId)];
    await db
      .delete(flowResults)
      .where(keep.length ? and(eq(flowResults.flowId, flowId), notInArray(flowResults.outputNodeId, keep)) : eq(flowResults.flowId, flowId));
    if (failed.length > 0) return { ok: false, error: failed[0].error };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(flowResults).set({ status: "error", error: message }).where(eq(flowResults.flowId, flowId));
    return { ok: false, error: message };
  }
}

/**
 * Mark stale every published flow whose graph pulls from `source` (or the given
 * connection). Called when new data lands so the dashboard shows freshness and a
 * later recompute refreshes only what changed.
 *
 * G.1 — stream precision: when the caller knows WHICH streams changed
 * (`streamHashes` non-empty), a Get-data step with a chosen resource only
 * matches when ITS stream is among them — a change in spreadsheet A no longer
 * recomputes flows that read only spreadsheet B. A step with no chosen
 * resource reads the whole connection, so it matches any change there; callers
 * without stream knowledge (webhook path, full re-syncs) pass no hashes and
 * keep source/connection-level matching.
 */
export async function markStaleForSource(
  db: DB,
  orgId: string,
  source: string,
  connectionId?: string | null,
  streamHashes?: string[] | null,
): Promise<string[]> {
  /**
   * ONE QUERY, AND NOT ONE CACHED TEST PAYLOAD IN IT.
   *
   * THIS IS THE HOTTEST DATABASE PATH IN THE PRODUCT — it runs on every
   * ingested webhook event and on every sweep tick that found a change — and
   * it used to be the most wasteful. It read `select()` on `flows` (nine
   * columns, `draft_graph` among them) to use exactly two scalars, and then
   * issued ONE MORE unprojected query per published flow to read three keys off
   * each app node. For a ten-flow org that is eleven round trips carrying a few
   * hundred kilobytes, per event, to answer a question about node configs.
   *
   * Both halves are fixed here without changing what the loop decides:
   *
   *  - the join replaces the per-flow query, and `publishedVersion` is the join
   *    key, so a flow with no published version simply does not come back (the
   *    old `if (!f.publishedVersion) continue` and `if (!ver) continue` are now
   *    the join's own semantics);
   *  - `graphForFingerprint` projects the stored graph down to node id/type/
   *    config plus edges and metrics IN POSTGRES, so every step's cached
   *    `lastTest` — its `sample`, `inputSample` and rendered tile, the fattest
   *    jsonb the product stores — stays in the database.
   *
   * The projection is deliberately the one the fingerprint already uses rather
   * than a tighter bespoke one: its output still parses through `parseGraph`,
   * so the legacy migrations that run inside it see exactly what they saw
   * before, and the `uses` test below is answered by the same JS on the same
   * shape. A tighter SQL projection would have meant reading raw stored bytes
   * instead of migrated ones — see `comparableGraph`, which is allowed to
   * disagree with the parsed graph precisely because it only ever NARROWS a
   * question that JS then settles. Staleness has no second pass to settle it:
   * a false negative here is a customer's number silently frozen.
   */
  const published = await db
    .select({ flowId: flows.id, graph: graphForFingerprint(flowVersions.graph) })
    .from(flows)
    .innerJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
    .where(and(eq(flows.orgId, orgId), eq(flows.status, "published")));
  const changedHashes = streamHashes?.length ? new Set(streamHashes) : null;
  const affected: string[] = [];
  for (const f of published) {
    // One unparseable stored graph must not kill staleness for every OTHER
    // flow in the org — parseGraph is designed never to throw (migrations run
    // inside it), but this loop is the org-wide freshness artery and a single
    // corrupt row taking it down would freeze every tile at once.
    let graph: ReturnType<typeof parseGraph>;
    try {
      graph = parseGraph(f.graph);
    } catch {
      continue;
    }
    const uses = graph.nodes.some((n) => {
      if (n.type !== "app") return false;
      const c = (n.data.config ?? {}) as { source?: string; connectionId?: string; sourceConfig?: Record<string, unknown> };
      const matchesOrigin = c.source === source || (connectionId != null && c.connectionId === connectionId);
      if (!matchesOrigin) return false;
      // The NODE's source, falling back to the caller's: a node matched by
      // connection id alone may not name one, and the hash has to be taken the
      // same way the writer took it or a changed stream looks unchanged.
      const nodeSource = c.source ?? source;
      if (changedHashes && hasStreamConfig(c.sourceConfig ?? {}, nodeSource)) {
        return changedHashes.has(streamConfigHash(c.sourceConfig ?? {}, nodeSource));
      }
      return true; // whole-connection read, or caller without stream knowledge
    });
    if (uses) {
      await db.update(flowResults).set({ status: "stale" }).where(eq(flowResults.flowId, f.flowId));
      affected.push(f.flowId);
    }
  }
  return affected;
}

/**
 * The dashboard's tile read: every materialized result whose flow is still
 * published (the join guards orphans), WITH the stored error so a broken tile
 * can say why.
 *
 * THROWS TO THE CALLER, deliberately — this used to live inline on the
 * dashboard page behind a bare `catch {}` whose rationale ("flow_results may
 * not exist before migration 0002") died years of migrations ago. What that
 * catch actually did in production was render "No metrics yet." over a
 * customer's real published tiles whenever this one query hit a transient
 * failure — the empty state as a lie. The page turns a rejection into its
 * load-error banner; nothing below the page gets to decide that silence is
 * acceptable.
 *
 * `opts.flowId` narrows to one flow's tiles — additive and optional, so every
 * existing caller (the dashboard, `unpublishedFlowIds`, `metricCatalog`) reads
 * byte-identical SQL. It exists for `get_metric` / `get_metric_days`: an
 * assistant asking about ONE id used to cost this whole-org read (`sample`
 * records and all, for every published tile) just to find the one row it
 * wanted.
 */
export async function publishedFlowTiles(db: DB, orgId: string, opts?: { flowId?: string }) {
  return db
    .select({
      flowId: flowResults.flowId,
      outputNodeId: flowResults.outputNodeId,
      /**
       * THE TILE, MINUS THE DAY MAP IT DOES NOT USE.
       *
       * `byDay` is sixty-odd entries the CALENDAR reads and the dashboard never
       * looks at — a couple of kilobytes per tile, on the one query that runs
       * on every dashboard render, against a database that bills every byte it
       * returns. `- 'byDay'` drops the key in Postgres, so the bytes are never
       * put on the wire rather than being fetched and ignored.
       *
       * The jsonb minus-text operator is null-safe here: a row whose tile has
       * never computed is NULL, `NULL - 'byDay'` is NULL, and every caller
       * already treats that as "no stored tile".
       */
      tile: sql<Record<string, unknown> | null>`${flowResults.tile} - 'byDay'`.as("tile"),
      status: flowResults.status,
      error: flowResults.error,
      computedAt: flowResults.computedAt,
      /**
       * Which streams this number was computed from, recorded at materialize
       * time. Needed to answer "is any of it still importing" — and that ONE
       * key is all the board reads (`streamRefsOfProvenance`).
       *
       * The rest of `provenance` is the audit trail: `reads`, holding the
       * compiled SQL text and the bound parameters for every Get-data node in
       * the flow, several hundred bytes each. Shipping it here meant the
       * dashboard downloaded a copy of its own query plans on every render and
       * every freshness poll, to look at none of them. Same projection trick as
       * `calendarFlowTiles` below, and null-safe for the same reason.
       */
      provenance: sql<{ streams?: unknown } | null>`jsonb_build_object('streams', ${flowResults.provenance} -> 'streams')`.as(
        "provenance",
      ),
    })
    .from(flowResults)
    .innerJoin(flows, eq(flows.id, flowResults.flowId))
    .where(and(eq(flowResults.orgId, orgId), eq(flows.status, "published"), ...(opts?.flowId ? [eq(flowResults.flowId, opts.flowId)] : [])));
}

/**
 * THE CALENDAR'S READ — the mirror of the one above, and the reason both are
 * narrow.
 *
 * The calendar needs a metric's name, the six keys that decide how a number is
 * SPELLED, and its day map. It does not need `sample` (up to five whole
 * records), `series`, `groups` or `byRange` — which together are most of a
 * tile's bytes. Selecting the whole jsonb and picking fields in JS costs the
 * egress anyway; this builds the small object in Postgres, so a workspace with
 * twenty metrics ships kilobytes rather than hundreds of them.
 *
 * A row with no stored tile yields an object of nulls rather than NULL, which
 * every reader here already handles: the name falls back to the output id and
 * the day map to `{}`.
 *
 * `opts.flowId` narrows to one flow, additive and optional — see the note on
 * `publishedFlowTiles` above; the two share the same reason to exist.
 */
export async function calendarFlowTiles(db: DB, orgId: string, opts?: { flowId?: string }) {
  return db
    .select({
      flowId: flowResults.flowId,
      outputNodeId: flowResults.outputNodeId,
      tile: sql<Record<string, unknown> | null>`jsonb_build_object(
        'name', ${flowResults.tile} -> 'name',
        'format', ${flowResults.tile} -> 'format',
        'precision', ${flowResults.tile} -> 'precision',
        'unit', ${flowResults.tile} -> 'unit',
        'currency', ${flowResults.tile} -> 'currency',
        'durationDisplay', ${flowResults.tile} -> 'durationDisplay',
        'byDay', ${flowResults.tile} -> 'byDay'
      )`.as("tile"),
      status: flowResults.status,
      error: flowResults.error,
      computedAt: flowResults.computedAt,
    })
    .from(flowResults)
    .innerJoin(flows, eq(flows.id, flowResults.flowId))
    .where(and(eq(flowResults.orgId, orgId), eq(flows.status, "published"), ...(opts?.flowId ? [eq(flowResults.flowId, opts.flowId)] : [])));
}

/**
 * THE GRAPH, REDUCED TO WHAT COULD MOVE A NUMBER — in SQL, and only to
 * NARROW the question.
 *
 * The same rule as `graphFingerprint` (lib/flow/changes.ts) written in the
 * other dialect, which is what makes it cheap: Postgres compares the two jsonb
 * blobs in place across the whole board and returns a flow id or nothing,
 * instead of shipping every published flow's draft AND version graph — cached
 * Test samples and all — out of the database on every dashboard render.
 *
 * It is NOT the answer, because the two dialects genuinely differ on real
 * pre-existing flows: this compares stored bytes, while `graphFingerprint`
 * parses both sides first and so sees schema defaults added since a version
 * was cut (`metrics[].durationDisplay` landed after `metrics[]` shipped, and
 * every save re-parses it into the draft). Bytes differ, flows do not. Which
 * way that error runs is the whole reason for the split: it can only
 * OVER-report, so it is a candidate filter and `unpublishedFlowIds` confirms
 * each candidate in JS before anything is shown to anyone.
 *
 * Dropped here for the same reasons stated there: node positions (dragging a
 * card moves no records), `data.lastTest` (the cached Test result lives in the
 * draft, so testing after a publish would flag the flow forever), `data.label`
 * (never reaches the tile), and edge ids (redrawing the same wire mints a new
 * one). jsonb needs no key sorting — the type stores objects normalized.
 */
function comparableGraph(graph: SQLWrapper): SQL {
  return sql`jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object('i', node ->> 'id', 't', node ->> 'type', 'c', coalesce(node -> 'data' -> 'config', '{}'::jsonb)) order by node ->> 'id')
      from jsonb_array_elements(coalesce(${graph} -> 'nodes', '[]'::jsonb)) as n(node)
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(
        jsonb_build_object('s', edge ->> 'source', 'sh', edge ->> 'sourceHandle', 't', edge ->> 'target', 'th', edge ->> 'targetHandle')
        order by edge ->> 'source', edge ->> 'target', edge ->> 'sourceHandle', edge ->> 'targetHandle'
      )
      from jsonb_array_elements(coalesce(${graph} -> 'edges', '[]'::jsonb)) as e(edge)
    ), '[]'::jsonb),
    'metrics', coalesce((
      select jsonb_agg(metric order by metric ->> 'nodeId')
      from jsonb_array_elements(coalesce(${graph} -> 'metrics', '[]'::jsonb)) as m(metric)
    ), '[]'::jsonb)
  )`;
}

/**
 * WHICH PUBLISHED FLOWS MIGHT BE SHOWING A NUMBER THAT IS NOT THE CURRENT
 * FLOW — the candidate pass. Ids only, one query for the whole board, and a
 * SUPERSET of the truth: see `comparableGraph` for the one way stored bytes
 * and parsed graphs part company, and `unpublishedFlowIds` for the pass that
 * settles it.
 *
 * The join is what keeps even the candidate list honest: a flow whose version
 * row is missing (or that has no `published_version`) simply does not come
 * back, so an unanswerable comparison shows nothing rather than a guess.
 *
 * Deliberately NOT `flows.updated_at > flow_versions.published_at`: publishFlow
 * writes the version row and THEN stamps the flow, so every freshly published
 * flow would carry the marker for the rest of its life.
 */
export async function unpublishedCandidateIds(db: DB, orgId: string): Promise<Set<string>> {
  const rows = await db
    .select({ flowId: flows.id })
    .from(flows)
    .innerJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
    .where(
      and(
        eq(flows.orgId, orgId),
        eq(flows.status, "published"),
        sql`${comparableGraph(flows.draftGraph)} is distinct from ${comparableGraph(flowVersions.graph)}`,
      ),
    );
  return new Set(rows.map((r) => r.flowId));
}

/**
 * WHICH PUBLISHED FLOWS ARE SHOWING A NUMBER THAT IS NOT THE CURRENT FLOW.
 *
 * ONE definition of the rule decides what anyone is told, and it is the JS
 * one (`graphFingerprint`), because that is the definition the builder's own
 * toolbar answers with as you type. Two dialects both allowed to speak is how
 * a tile said "Edited since publishing" about a flow whose editor showed no
 * pill — a false alarm on the one marker whose entire value is being believed.
 *
 * So the SQL pass narrows and this pass decides: the candidates come back from
 * `unpublishedCandidateIds`, and only THEIR graphs are read, projected down to
 * what a fingerprint reads (`graphForFingerprint` — no cached Test payloads
 * cross the wire) and compared the way the toolbar compares them. One extra
 * query, only when something was flagged, and nothing at all on the common
 * board where every flow is published.
 *
 * A candidate that no longer joins — deleted, unpublished, or its version row
 * gone between the two queries — is dropped rather than assumed: no marker is
 * the honest answer to a question that can no longer be asked.
 */
export async function unpublishedFlowIds(db: DB, orgId: string): Promise<Set<string>> {
  const candidates = await unpublishedCandidateIds(db, orgId);
  if (candidates.size === 0) return candidates;
  const rows = await db
    .select({
      flowId: flows.id,
      draft: graphForFingerprint(flows.draftGraph),
      published: graphForFingerprint(flowVersions.graph),
    })
    .from(flows)
    .innerJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
    .where(and(eq(flows.orgId, orgId), eq(flows.status, "published"), inArray(flows.id, [...candidates])));
  const changed = new Set<string>();
  for (const r of rows) if (graphFingerprint(r.draft) !== graphFingerprint(r.published)) changed.add(r.flowId);
  return changed;
}

/**
 * G.4 — the cheap freshness beacon the dashboard polls. One aggregate over the
 * org's flow_results (a handful of rows): any recompute, staleness flip, tile
 * add/remove or error changes the string. Clients poll this (visibility-gated,
 * 10–15s) and refetch tiles only when it moves — refresh cost scales with
 * data-change rate, not with viewers holding dashboards open.
 */
export async function resultsVersion(db: DB, orgId: string): Promise<string> {
  const [row] = await db
    .select({
      tiles: sql<number>`count(*)::int`,
      nonFresh: sql<number>`count(*) filter (where ${flowResults.status} <> 'fresh')::int`,
      maxComputedAt: sql<string | null>`max(${flowResults.computedAt})`,
    })
    .from(flowResults)
    .where(eq(flowResults.orgId, orgId));
  const maxMs = row?.maxComputedAt ? Date.parse(String(row.maxComputedAt)) : 0;
  /**
   * Import progress has to be part of this string, or the label it drives never
   * updates on an open dashboard.
   *
   * An import deepening from 12 days to 30 changes no `flow_results` column —
   * same tiles, same status, same `computed_at` — so the ETag would not move
   * and the poller would not refresh. The tile would sit on "covering 12 of 90"
   * until some unrelated recompute happened to bump it.
   *
   * BOTH ends of the reached range, because `reached_floor` moves BACKWARDS as an
   * import deepens. With two running jobs, `max` is pinned by whichever is
   * shallowest — so a deep import could reach further back every slice while this
   * aggregate never moved, and the label it exists to refresh would freeze on an
   * open dashboard. `min` tracks the deepening; `max` still catches a shallow job
   * advancing. The count catches an import starting or finishing.
   *
   * This is a CHANGE DETECTOR, not a displayed depth: any component moving is
   * enough, and none of these numbers is shown to anyone.
   */
  const [bf] = await db
    .select({
      running: sql<number>`count(*)::int`,
      maxReached: sql<string | null>`max(${backfillJobs.reachedFloor})`,
      minReached: sql<string | null>`min(${backfillJobs.reachedFloor})`,
    })
    .from(backfillJobs)
    .where(and(eq(backfillJobs.orgId, orgId), inArray(backfillJobs.status, ["queued", "running"])));
  const reachedMs = bf?.maxReached ? Date.parse(String(bf.maxReached)) : 0;
  const deepestMs = bf?.minReached ? Date.parse(String(bf.minReached)) : 0;
  return `${row?.tiles ?? 0}.${row?.nonFresh ?? 0}.${maxMs}.${bf?.running ?? 0}.${reachedMs}.${deepestMs}`;
}

/**
 * H.4 — recompute-skip. A tile whose freshly-computed value is byte-identical
 * to the stored one does not need its `computed_at` bumped… but it DOES, and
 * deliberately: the as-of marker is a statement about when the number was last
 * VERIFIED against the source, not when it last changed. What H.4 actually
 * skips is upstream: `reconcileChanged` gates staleness on real data changes,
 * so an unchanged sweep never marks anything stale and this function finds
 * nothing to do. The skip lives where the work originates, not here.
 */

/**
 * One recompute pass may hold its Inngest step this long. The serverless
 * ceiling is 60s (`maxDuration` in api/inngest/route.ts); the margin leaves
 * room for the work-list query and for the one flow allowed to START near the
 * deadline — the check runs between flows, so a single slow flow can overrun
 * its slice but the LOOP can no longer compound that across the fleet.
 */
const MATERIALIZE_BUDGET_MS = 45_000;

/**
 * Recompute flows that currently have stale results (scheduled + on-demand).
 *
 * `orgId` narrows the pass to one tenant, and the debounced recompute MUST
 * pass it: `recomputeStaleFlows` debounces and serializes per org
 * (`event.data.orgId`), and an unscoped body under a per-org key made both
 * halves of that config a lie — two orgs' events ran two concurrent fleet-wide
 * passes over the same rows, and "org A's burst collapses into one run" was
 * true while org A's run also recomputed every OTHER tenant's dashboards with
 * no lock against a sibling run doing the same. The nightly-style cron
 * backstop stays unscoped, which is its job.
 *
 * Longest-stale first, for the same reason `activeStreams` is LRU-first: the
 * budget below truncates the tail, and without an order that favours the
 * starved, the same tail is cut off every tick. A truncated flow keeps its old
 * `computed_at`, so the next pass sorts it ahead of everything just
 * recomputed; never-computed tiles (NULL) are the most starved of all.
 *
 * At least ONE flow always runs — a budget too small to matter must degrade to
 * slow progress, not to a stall that looks like a healthy no-op.
 */
/**
 * A published number ages even when no data arrives: a rolling window sheds a
 * record at exactly `t + length`, a future-dated meeting enters "Today" at
 * exactly `t`, and every day-anchored range shifts at UTC midnight. But those
 * are the ONLY ways a stored tile changes without new data — and the
 * materializer computes the earliest of them from the records themselves and
 * stores it on the tile as `nextChangeAt`.
 *
 * So a tile expires when the clock reaches ITS OWN next crossing, not on a
 * blanket timer. The blanket timer was ten minutes, and it was the single
 * largest source of database egress in the product: every flow re-read its
 * whole history 144 times a day — 864 before the per-range runs were collapsed
 * — almost always to reproduce an identical tile, against a database that
 * bills every byte it sends. A quiet flow now recomputes once a day (the
 * midnight cap), a flow with a meeting due this afternoon recomputes when the
 * meeting starts, and NEW data still refreshes within a sweep because the
 * sweep marks staleness directly on change.
 *
 * `maxAgeMs` remains as an unconditional age backstop: it catches tiles
 * written before crossings existed AND a crossing computed wrongly far into
 * the future — either way, no tile can freeze for good. A quiet flow now
 * recomputes a handful of times a day instead of 144.
 *
 * "fresh" rows follow both clocks above; "stale"/"computing" are already in
 * flight so neither touches them. An "error" row follows neither — it has no
 * trustworthy `nextChangeAt` (that field describes whatever tile last
 * computed successfully, or is absent on a row that never has) — but it DOES
 * retry on the age backstop, on the same cutoff as everything else: without
 * that, `materializeFlow`'s catch sets `status: "error"` and never touches
 * `computed_at`, so a transient failure (an expired token, a flaky upstream
 * call) sticks a dashboard tile on its error state until new data happens to
 * arrive on that connection or a human presses Refresh. Retrying on the
 * backstop alone bounds a permanently broken flow to four recomputes a day —
 * enough to self-heal, not enough to hammer a known-broken flow every pass.
 */
const RESULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function expireAgedResults(db: DB, maxAgeMs = RESULT_MAX_AGE_MS, orgId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const due = or(
    and(
      eq(flowResults.status, "fresh"),
      or(
        /**
         * The tile's own stated next crossing has arrived.
         *
         * THE CAST IS GUARDED BECAUSE ONE BAD ROW STOPS EVERY ROW. Postgres
         * throws on a timestamp outside its range — `select
         * '+010000-01-01T00:00:00.000Z'::timestamptz` is "time zone displacement
         * out of range" — and this cast runs over every candidate, so a single
         * tile carrying an extended-year spelling aborts the whole UPDATE and
         * NOTHING in the org expires again. Behind green dots, which is the worst
         * possible way to fail.
         *
         * `nextChangeAtIso` bounds what this function writes, but that only
         * covers rows written after it shipped: a value already stored, or one
         * written by an older build, is exactly the row this has to survive. So
         * the shape is checked before the cast rather than trusted — CASE
         * evaluates only the branch it selects, and a four-digit-year anchor
         * rejects the extended-year form (it opens with `+`).
         *
         * A row that fails the shape test is not lost: it falls through to the
         * age backstop below, so it still expires, just on the slower clock.
         */
        sql`case
              when (${flowResults.tile} ->> 'nextChangeAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (${flowResults.tile} ->> 'nextChangeAt')::timestamptz <= now()
              else false
            end`,
        // Everything else waits for the age backstop alone.
        lt(flowResults.computedAt, cutoff),
      ),
    ),
    // An "error" row ignores `nextChangeAt` entirely — it may be stale from a
    // prior success, or absent — and retries on the age backstop only.
    // `coalesce` because an error row can carry a null `computed_at` (it
    // never once computed successfully) and still needs a clock to age against.
    and(eq(flowResults.status, "error"), sql`coalesce(${flowResults.computedAt}, ${flowResults.createdAt}) < ${cutoff}`),
  );
  const rows = await db
    .update(flowResults)
    .set({ status: "stale" })
    // Org-scoped when a per-tenant caller asks (the sweep): one org's sweep
    // must not write rows belonging to every other tenant.
    .where(orgId ? and(due, eq(flowResults.orgId, orgId)) : due)
    .returning({ flowId: flowResults.flowId });
  return rows.length;
}

export async function materializeStaleAll(
  db: DB,
  opts: { orgId?: string; budgetMs?: number } = {},
): Promise<{ recomputed: number; pending: number }> {
  const budgetMs = opts.budgetMs ?? MATERIALIZE_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const stale = await db
    .select({ orgId: flowResults.orgId, flowId: flowResults.flowId })
    .from(flowResults)
    .where(opts.orgId ? and(eq(flowResults.status, "stale"), eq(flowResults.orgId, opts.orgId)) : eq(flowResults.status, "stale"))
    .groupBy(flowResults.orgId, flowResults.flowId)
    .orderBy(sql`min(${flowResults.computedAt}) asc nulls first`, asc(flowResults.flowId));
  let recomputed = 0;
  for (const s of stale) {
    await materializeFlow(db, s.orgId, s.flowId);
    recomputed += 1;
    if (Date.now() >= deadline) break;
  }
  const pending = stale.length - recomputed;
  // A silent cap reads as "covered everything" when it didn't; the backstop
  // cron picks the tail up within 10 minutes, but the log must say there IS one.
  if (pending > 0) console.warn(`[materialize-truncated] budgetMs=${budgetMs} recomputed=${recomputed} pending=${pending}${opts.orgId ? ` org=${opts.orgId}` : ""}`);
  return { recomputed, pending };
}

async function upsertResult(
  db: DB,
  orgId: string,
  flowId: string,
  version: number,
  outputNodeId: string,
  tile: TileSpec,
  status: string,
  error: string | null,
  provenance?: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await db
    .insert(flowResults)
    .values({
      orgId,
      flowId,
      version,
      outputNodeId,
      tile: tile as unknown as Record<string, unknown>,
      status,
      error,
      provenance: provenance ?? null,
      computedAt: now,
    })
    .onConflictDoUpdate({
      target: [flowResults.flowId, flowResults.outputNodeId],
      set: { version, tile: tile as unknown as Record<string, unknown>, status, error, provenance: provenance ?? null, computedAt: now },
    });
}
