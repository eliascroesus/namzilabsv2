import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { connections, flows } from "@/db/schema";
import { requireOrg, requestAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Sparkbars, TargetBar } from "@/components/charts";
import { FreshnessPoller } from "@/components/freshness-poller";
import { SourceMark } from "@/components/source-mark";
import { FunnelView } from "@/components/funnel-view";
import { FlowTile, tileValueForRange, type FlowResultRow } from "@/components/flow-tile";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { BoardControls, MetaLine, RangeLink, SourceLink, TileArea, ViewTab } from "./board-controls";
import { BoardLayout } from "./board-layout";
import { CustomBoard, type CanvasTile } from "./custom-board";
import type { CustomTileSource } from "@/components/custom-tile";
import { chartsFor, shapeOfClassic, shapeOfTile } from "@/lib/board/charts";
import { parseTileConfig } from "@/lib/board/tile-config";
import { listBoardGroups, listBoardViews, listTilePlacements } from "@/lib/board/store";
import { listBoardTiles } from "@/lib/board/tiles-store";
import {
  tileKeyOfFlow,
  tileKeyOfMetric,
  type BoardGroup,
  type BoardTile,
  type BoardTileRow,
  type CustomTileOption,
  type BoardView,
  type BoardViewKind,
  type TilePlacement,
} from "@/lib/board/types";
import { importProgressByStreamRef } from "@/lib/backfill/jobs";
import { publishedFlowTiles, unpublishedFlowIds } from "@/lib/flow/materialize";
import { refreshAllFlowsAction } from "@/app/dashboard/flows/actions";
import { addViewAction } from "./board-actions";
import { listMetrics, type Metric } from "@/lib/metrics/store";
import { parseDefinition } from "@/lib/metrics/types";
import {
  computeAggregate,
  computeFunnel,
  connectedSources,
  type AggregateResult,
  type FunnelResult,
} from "@/lib/metrics/compute";
import { resolveRange, RANGE_OPTIONS } from "@/lib/metrics/range";
import { catalogEntry } from "@/connectors/catalog";
import { formatDateTime, formatMetricValue, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ImportCoverage } from "@/connectors/types";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget: the tile "Refresh" button's server action runs
 * `materializeFlow` INLINE under this segment's config — a full flow compute
 * over up to APP_LOAD_CEILING rows — and the platform default (10s Hobby)
 * kills it mid-write. 60 is the Hobby ceiling; pinned by
 * tests/timeout-budgets.test.ts.
 */
export const maxDuration = 60;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

type Tile =
  | { metric: Metric; kind: "aggregate"; result: AggregateResult; error?: undefined }
  | { metric: Metric; kind: "funnel"; result: FunnelResult; error?: undefined }
  | { metric: Metric; kind: "error"; error: string };

/**
 * The stream keys `materializeFlow` recorded alongside a result.
 *
 * Defensive because `provenance` is untyped jsonb written by an older code
 * path for every row that predates this: a result materialized before the
 * mapping existed simply has no streams, and must read as "nothing importing"
 * rather than throw the dashboard.
 */
function streamRefsOfProvenance(provenance: unknown): Array<{ connectionId: string; configHash: string }> {
  const streams = (provenance as { streams?: unknown } | null)?.streams;
  if (!Array.isArray(streams)) return [];
  return streams.filter(
    (s): s is { connectionId: string; configHash: string } =>
      typeof (s as { connectionId?: unknown })?.connectionId === "string" &&
      typeof (s as { configHash?: unknown })?.configHash === "string",
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, role, auth } = await requireOrg();
  const db = getReadDb(); // read-only surface: rides the DB_DRIVER_READ soak seam (B.3)

  // Rank-based metric visibility, resolved once for the whole page. Admins and
  // members with no rank short-circuit to allow-all inside effectiveAccess, so
  // the common case costs at most one assignment lookup.
  const access = await requestAccess(orgId, userId, role);

  /**
   * THE NORMALIZED KEY, not the one in the URL. `resolveRange` already falls
   * back to "7d" for anything it does not recognise, and the raw string used
   * to be handed to the tiles anyway — so `?range=lastweek` selected the 7-day
   * WINDOW for every computation on the page while every tile looked its own
   * stored ranges up under "lastweek", found nothing, and reported "not
   * computed yet" about data that was computed and sitting right there. A
   * typo in a shared link became a statement about the customer's numbers.
   */
  const { key: rangeKey, range } = resolveRange(one(sp.range) || "7d");
  const boardSource = one(sp.source) || null;
  /**
   * WHICH VIEW, from the URL, beside the range and the source.
   *
   * Empty is the DEFAULT view — the board that existed before views did, whose
   * groups carry a null `view_id`. So every link anyone has already shared
   * still lands somewhere real.
   */
  const requestedView = one(sp.view) || null;

  let metrics: Metric[] = [];
  let sources: string[] = [];
  let connCount = 0;
  let flowCount = 0;
  let views: BoardView[] = [];
  let groups: BoardGroup[] = [];
  let placements: TilePlacement[] = [];
  let activeView: string | null = null;
  /** The default view has no row, so this has to answer when there is nothing to read. */
  let activeKind: BoardViewKind = "groups";
  let canvasRows: BoardTileRow[] = [];
  let loadError: string | null = null;

  /**
   * FIVE READS, DOWN FROM SIX. The event feed and the dead-letter roll-up used
   * to run HERE, on the most-rendered page in the product — and not merely on
   * navigation: `FreshnessPoller` calls `router.refresh()` on every results
   * version change, which re-runs this whole component. Two queries per render
   * to fill a six-row card that was the least-looked-at thing on the screen.
   *
   * Both moved to /dashboard/activity, which has room to show fifty rows and
   * runs them only when somebody opens it. See that page's own note.
   *
   * The fifth is the board's VIEWS, and it is the only one of the three board
   * reads that can run concurrently: which groups to fetch depends on which
   * view is active, and that depends on this answer. So views ride along here
   * for free, and groups and placements are sequential below.
   *
   * Same budget as everything else on this page: whatever runs here runs every
   * twelve seconds in every open tab, so all three are narrow, column-listed
   * reads of tables holding a handful of rows per workspace.
   */
  try {
    [metrics, sources, connCount, flowCount, views] = await Promise.all([
      listMetrics(orgId),
      /**
       * THE SOURCES A WORKSPACE IS CONNECTED TO, not the ones its history
       * mentions.
       *
       * This asked `distinctSources`, which is `select distinct source from
       * events` — a scan of the org's ENTIRE live event table, on every render
       * of the most-rendered page in the product, to fill a dropdown that never
       * holds more than about six items. There is no index carrying `source`,
       * so it is a heap pass: measured at ~55ms per render at 100k live rows
       * and half a second to a second at a million, growing with history
       * forever while the answer stays the same six words.
       *
       * `connections` is a tens-of-rows table and answers the same question
       * better: this picker exists to filter the board by APP, and the apps are
       * the ones you have connected. The one behaviour it changes is at the
       * edges — a source whose connection was deleted stops being offered
       * (its events are gone with it), and a freshly connected app is offered
       * before its first event lands, which is the honest state of things.
       * The legacy metric builders keep the event-derived list: they filter
       * events directly, and they are cold pages where the scan costs nothing.
       */
      connectedSources(db, orgId),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(connections)
        .where(eq(connections.orgId, orgId))
        .then((r) => Number(r[0]?.c ?? 0)),
      // Drives the onboarding checklist's "build your first flow" checkmark.
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(flows)
        .where(eq(flows.orgId, orgId))
        .then((r) => Number(r[0]?.c ?? 0)),
      listBoardViews(db, orgId),
    ]);
    /**
     * A VIEW THE WORKSPACE DOES NOT HAVE IS THE DEFAULT VIEW, not an error. A
     * stale link, or one shared after the view was deleted, opens the board
     * rather than a page reporting that it could not find something.
     */
    activeView = views.some((v) => v.id === requestedView) ? requestedView : null;
    // The DEFAULT view has no row, so "which kind is it" must have an answer
    // when there is nothing to read. It is always a groups board.
    activeKind = views.find((v) => v.id === activeView)?.kind ?? "groups";
    if (activeKind === "custom" && activeView) {
      // A CUSTOM VIEW READS NEITHER GROUPS NOR PLACEMENTS, because it has
      // neither — no columns, no lane order. Asking for them would be two
      // queries per poll returning two empty arrays.
      canvasRows = await listBoardTiles(db, orgId, activeView);
    } else {
      groups = await listBoardGroups(db, orgId, activeView);
      // THE THIRD BOARD READ, AND THE WHOLE COST ARGUMENT FOR IT. A view with no
      // groups renders the plain grid, so its placements are not merely unused —
      // they cannot exist. Sequential rather than in the Promise.all above
      // because it has to know the answer to the first one.
      if (groups.length > 0) placements = await listTilePlacements(db, orgId, activeView);
    }
  } catch (err) {
    // THE EXCEPTION GOES TO THE LOG, NOT TO THE PAGE. This used to set
    // `err.message` and render it verbatim, so a customer's dashboard could
    // announce `relation "flow_results" does not exist` — schema internals, and
    // occasionally a connection string. `loadError` is now a FLAG; the operator
    // keeps the detail.
    console.error("[dashboard] core read failed", err);
    loadError = "unavailable";
  }

  // Filter the SOURCE list, not the rendering: every classic-metric surface on
  // this page (aggregate tiles, funnel tiles, drill-in links) derives from
  // `metrics`, so a hidden metric cannot leak through any section — and its
  // compute below is never even run.
  if (!access.admin) {
    metrics = metrics.filter((m) => access.canSeeMetric(`metric:${m.id}`));
  }

  /**
   * ON A CUSTOM VIEW, ONLY THE CLASSIC METRICS THE CANVAS POINTS AT ARE
   * COMPUTED. These are the expensive rows on this page: each aggregate is a
   * live `events` query per render, and a funnel is one query PER STAGE, run
   * serially — and this whole block re-runs on every `router.refresh()` and
   * every freshness poll. A canvas referencing none of them was paying for all
   * of them.
   *
   * The canvas cannot grow new classic references: the add menu offers flow
   * metrics only (classics are out of `tileOptions` below), so this set only
   * ever shrinks. Tiles that already point at a classic metric keep rendering,
   * which is why the referenced ones still compute rather than none.
   *
   * The groups boards are untouched — every visible metric is ON that board,
   * so every compute is consumed.
   */
  const referencedKeys = new Set(canvasRows.map((r) => r.tileKey));
  const classicsToCompute =
    activeKind === "custom" ? metrics.filter((m) => referencedKeys.has(tileKeyOfMetric(m.id))) : metrics;

  const tiles: Tile[] = await Promise.all(
    classicsToCompute.map(async (metric): Promise<Tile> => {
      try {
        const def = parseDefinition(metric.definition);
        if (def.kind === "funnel") {
          return { metric, kind: "funnel", result: await computeFunnel(db, orgId, def, range, boardSource) };
        }
        return { metric, kind: "aggregate", result: await computeAggregate(db, orgId, def, range, boardSource) };
      } catch (err) {
        return { metric, kind: "error", error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  // Published-flow tiles come from stored (materialized) results — no live recompute.
  let flowTiles: FlowResultRow[] = [];
  try {
    const allRows = await publishedFlowTiles(db, orgId);
    // Same as the metrics filter above: drop hidden flows at the source, so
    // neither the tiles nor the import-badge join below ever see them.
    const rows = access.admin ? allRows : allRows.filter((r) => access.canSeeMetric(`flow:${r.flowId}`));

    /**
     * Phase 8 — import state is joined HERE, at read time, and deliberately not
     * baked into the stored tile.
     *
     * `materializeFlow` writes each flow's tiles in its own call, so a stored
     * note would freeze whatever the import had reached at that moment and two
     * flows on one backfilling stream would show different numbers for the same
     * import. Reading live gives the state exactly one home.
     *
     * One query for the whole dashboard, not one per tile.
     */
    // The TILES land first, and the import badge is decorated on afterwards.
    //
    // Assigning them only after the progress join meant a failure in that join
    // fell to the catch below with `flowTiles` still empty — so every published
    // number vanished from the dashboard and nothing said why. An import badge is
    // an annotation on a number; it must not be able to take the number with it.
    flowTiles = rows.map((r) => ({ ...r }));

    /**
     * A NUMBER COMPUTED FROM A DIFFERENT VERSION OF THE FLOW.
     *
     * Freshness and this are two different axes, and conflating them is what
     * cost three days of a customer's trust: a stored result can be perfectly
     * fresh — recomputed minutes ago, green dot and all — and still be the
     * answer to the graph as it stood before someone edited the filters. The
     * dot says when the number was verified; this says which flow it belongs to.
     *
     * Same join discipline as the import badge above: board-wide rather than
     * per tile, decorated onto rows that have already landed, and failing
     * alone. Postgres narrows it to candidates and `unpublishedFlowIds`
     * confirms each one against the rule the BUILDER uses, so a tile cannot
     * accuse a flow whose editor shows no pill.
     */
    let unpublished = new Set<string>();
    try {
      // Nothing on the board, nothing to annotate — a workspace mid-onboarding
      // should not pay for a graph comparison to decorate zero tiles.
      if (rows.length > 0) unpublished = await unpublishedFlowIds(db, orgId);
      if (unpublished.size > 0) flowTiles = flowTiles.map((r) => (unpublished.has(r.flowId) ? { ...r, unpublished: true } : r));
    } catch {
      // No marker rather than no dashboard.
    }

    try {
      const refs = rows.flatMap((r) => streamRefsOfProvenance(r.provenance));
      const progress = await importProgressByStreamRef(db, orgId, refs);
      flowTiles = rows.map((r) => {
        const mine = streamRefsOfProvenance(r.provenance)
          .map((ref) => progress.get(`${ref.connectionId}:${ref.configHash}`))
          .filter((p): p is ImportCoverage => p != null);
        // A flow reading two streams shows the one with furthest still to go —
        // the number is only as settled as its least-settled input.
        const importing = mine.sort((a, b) => b.targetMs - b.coveredMs - (a.targetMs - a.coveredMs))[0];
        // Rebuilt from the query rows (they carry `provenance`), so the marker
        // decorated above has to be re-applied rather than assumed to survive.
        return { ...r, importing, unpublished: unpublished.has(r.flowId) };
      });
    } catch {
      // No badge rather than no dashboard.
    }
  } catch (err) {
    // A failed tile read is a LOAD ERROR, never an empty state. The bare
    // catch that used to live here ("flow_results may not exist before
    // migration 0002") outlived its rationale by nineteen migrations and
    // spent that time converting transient DB failures into "No metrics
    // yet." over a customer's real published tiles. `??=` keeps the first
    // failure's message when the earlier Promise.all already set one.
    loadError ??= err instanceof Error ? err.message : String(err);
  }
  /**
   * "Is there anything to show" counts what the ACTIVE view shows: a canvas
   * shows its own rows (and the empty canvas is real content — the invitation
   * to add), while the groups boards show every metric. `tiles` alone stopped
   * being that answer when custom views began computing only the classics they
   * reference.
   */
  const hasTiles = activeKind === "custom" || tiles.length > 0 || flowTiles.length > 0;


  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    p.set("range", over.range ?? rangeKey);
    if (over.source ?? boardSource) p.set("source", over.source ?? boardSource ?? "");
    // The view rides along with every other filter link, so switching the range
    // does not silently throw you back to the default board.
    const v = over.view !== undefined ? over.view : (activeView ?? "");
    if (v) p.set("view", v);
    return `/dashboard?${p.toString()}`;
  };

  /** The default view first — it has no row, so nothing else can put it there. */
  const viewTabs: BoardView[] = [
    { id: null, name: "Dashboard", pos: "", kind: "groups" },
    ...views.slice().sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0)),
  ];

  /**
   * THE VIEW STRIP, hoisted so BOTH boards wear the same one.
   *
   * A groups board and a custom board disagree about almost everything —
   * storage, geometry, what a tile even is — but the tabs above them are the
   * same tabs, and the whole point of a view is that you can move between
   * kinds without the furniture moving. Rendered here, on the server,
   * because the tabs are real anchors and the `+` is a plain form post;
   * handed to whichever board is on screen because that is what knows where
   * its own controls go.
   */
  const viewStrip = (
              /* ── THE VIEW STRIP ────────────────────────────────────────
                 One board, several arrangements of it — Notion's view bar,
                 doing Notion's job. Rendered here, on the server, because the
                 tabs are real anchors and the `+` is a plain form post; handed
                 to the board because that is what knows where its own controls
                 go. It shares a line with "New group": both are about how the
                 board is laid out, while the filter island above narrows which
                 numbers are on it. */
              <div className="-mx-1 flex flex-wrap items-center gap-1 px-1 py-1">
                {viewTabs.map((v) => (
                  <ViewTab
                    key={v.id ?? "default"}
                    href={qs({ view: v.id ?? "" })}
                    viewId={v.id}
                    activeView={activeView}
                    canEdit={access.can("create_flows")}
                    defaultHref={qs({ view: "" })}
                  >
                    {v.name}
                  </ViewTab>
                ))}
                {access.can("create_flows") && (
                  /* TWO KINDS OF VIEW, SO THE `+` HAS TO ASK.
                     A <details> rather than a Popover for the same reason the
                     source picker above is one: this page renders on the server
                     and the `+` has always worked with no client JavaScript at
                     all. Two plain form posts keep it that way. */
                  <details className="group/add relative">
                    <summary
                      className="inline-flex size-7 cursor-pointer list-none items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
                      title="Add a view"
                    >
                      <Plus size={15} />
                      <span className="sr-only">Add a view</span>
                    </summary>
                    <div className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-surface border border-border bg-card p-1 shadow-surface">
                      {[
                        { kind: "groups", label: "Columns", blurb: "Group your metrics into named, coloured columns." },
                        { kind: "custom", label: "Canvas", blurb: "Place and size charts on a grid. One metric, several charts." },
                      ].map((o) => (
                        <form key={o.kind} action={addViewAction}>
                          <input type="hidden" name="range" value={rangeKey} />
                          <input type="hidden" name="source" value={boardSource ?? ""} />
                          <input type="hidden" name="kind" value={o.kind} />
                          <SubmitButton
                            variant="ghost"
                            size="sm"
                            pendingLabel="Adding…"
                            className="h-auto w-full justify-start px-2 py-1.5 text-left"
                          >
                            <span className="flex flex-col gap-0.5">
                              <span className="text-small font-semibold text-foreground">{o.label}</span>
                              <span className="text-tiny font-normal text-muted-foreground">{o.blurb}</span>
                            </span>
                          </SubmitButton>
                        </form>
                      ))}
                    </div>
                  </details>
                )}
              </div>
  );


  /**
   * The range control, worn by links — range lives in the URL, so these stay
   * anchors rather than becoming the Chip button.
   *
   * A SEGMENTED TRACK, not loose pills. Eleven free-floating chips across
   * two filter dimensions wrapped onto a second line and orphaned the last two
   * sources, and nothing in the row said which chips answered which question.
   * Sitting the ranges in one track makes them read as one control with one
   * answer, and leaves the source picker beside it as visibly separate.
   *
   * THE TRACK CANNOT WRAP — it is `flex` at its default `nowrap`, so another
   * option can only make it wider, never make it fold. It held seven when
   * "Upcoming" was on it and holds six now; 8px of item padding (down from 10,
   * and on the 4px grid the old value missed) is what kept seven inside the
   * container with the source picker still beside it, so six has room to
   * spare. An option ADDED here needs that measured again rather than assumed.
   *
   * THE SELECTED ITEM IS THE ACCENT WASH NOW, not a white knob. The track used
   * to be a `bg-muted` groove with a white pill riding in it — a shape that
   * only reads on a white page. On the warm canvas the groove and the page are
   * within four levels of each other, so the control dissolved and the "knob"
   * became a floating white smear. The track is a white island (the same
   * border-and-shadow every floating thing in the builder wears) and selection
   * is `bg-accent` + `text-accent-foreground`, which needs no depth to be read.
   *
   * The classes themselves now live on the `RangeLink` call below, because the
   * ACTIVE one is decided per press rather than per render — see
   * board-controls.tsx.
   */

  const activeSourceLabel = boardSource ? (catalogEntry(boardSource)?.name ?? boardSource) : "All sources";
  /**
   * WHEN THE BOARD ITSELF WAS LAST TRUE — the newest `computedAt` across every
   * tile on it. Each tile already carries its own as-of line; what none of them
   * could answer is the question a person actually asks on arrival ("is any of
   * this from today?"), which is a fact about the BOARD and therefore has to be
   * derived once, here, from the rows that are already in hand.
   */
  const boardComputedAt = flowTiles.reduce<Date | null>(
    (newest, r) => (r.computedAt && (!newest || r.computedAt > newest) ? r.computedAt : newest),
    null,
  );

  /**
   * EVERY TILE, PLUS THE FOUR FACTS AN ARRANGEMENT IS COMPUTED FROM.
   *
   * The cards are rendered HERE — server components, exactly as before — and
   * ride through as `node`. `BoardLayout` places them without ever looking
   * inside one, which is what lets the arrangement be client state while the
   * expensive half stays on the server.
   *
   * THIS ARRAY'S ORDER IS THE DEFAULT ORDER, and it is deliberately the order
   * the board already had: published flow tiles, then legacy metrics. Anything
   * a customer has not filed into a column keeps that ranking, so a workspace
   * that never makes a group sees exactly what it saw yesterday, and a newly
   * published metric appears at the END of the ungrouped row rather than in the
   * middle of an arrangement somebody built.
   */
  const boardTiles: BoardTile[] = [
    ...flowTiles.map((row): BoardTile => {
      const stored = (row.tile ?? {}) as { name?: string; format?: string; currency?: string; unit?: string };
      const value = tileValueForRange(row.tile, rangeKey);
      return {
        key: tileKeyOfFlow(row.flowId, row.outputNodeId),
        // The same fallback the card itself shows: a row whose tile jsonb is
        // null has never computed, so the output id is the only honest handle.
        title: stored.name ?? `Output ${row.outputNodeId.slice(0, 8)}`,
        unitKey: `${stored.format ?? "number"}:${stored.currency ?? ""}:${stored.unit ?? ""}`,
        value,
        attention: attentionOf(row, value),
        node: <FlowTile key={`${row.flowId}:${row.outputNodeId}`} row={row} rangeKey={rangeKey} />,
      };
    }),
    ...tiles.map((tile): BoardTile => {
      // A legacy metric is computed live and stores no format, so its number is
      // whatever `MetricTile` puts above the bars — a windowed sum for a series,
      // the scalar otherwise. Anything else has no headline figure at all.
      const total =
        tile.kind === "aggregate" && tile.result.kind === "series"
          ? tile.result.series.reduce((a, b) => a + b.value, 0)
          : tile.kind === "aggregate" && tile.result.kind === "scalar"
            ? tile.result.value
            : null;
      return {
        key: tileKeyOfMetric(tile.metric.id),
        title: tile.metric.name,
        unitKey: `number::${tile.metric.unit ?? ""}`,
        value: total,
        // A classic metric has no freshness axis — it is recomputed on every
        // render — so the only thing that can need attention is a failed
        // compute. Inventing a staleness it cannot have would rank it against
        // flow tiles on a fact that is not true of it.
        attention: tile.kind === "error" ? 3 : 0,
        node: <MetricTile key={tile.metric.id} tile={tile} />,
      };
    }),
  ];

  /**
   * A CUSTOM VIEW'S TILES — one card per stored ROW, not per metric.
   *
   * This is where the new table earns itself: `boardTiles` above is keyed by
   * metric and holds each one once, because a groups board can only show it
   * once. Here the same metric can appear three times as three charts, so the
   * cards are built from `dashboard_tiles` rows and the metric is looked up.
   *
   * A row whose metric is not on the board gets `node: null` rather than being
   * dropped. That covers a flow republished without its Output, a metric a
   * viewer's rank hides, and a genuine delete — and the client draws the
   * unavailable card itself, because Remove and Change metric are handlers and
   * nothing crossing this boundary may be a function.
   */
  /**
   * EVERY METRIC THE PICKER MAY OFFER, with the charts each one supports.
   *
   * Computed HERE, on the server, by the same `chartsFor` the renderer enforces
   * with — so what the picker offers and what a tile draws cannot drift apart.
   * Plain data, so it crosses the boundary beside the cards.
   *
   * The permission gate falls out for free: `flowTiles` has already been
   * filtered through `access.canSeeMetric`, so a metric a viewer's rank hides
   * is simply not in this list and cannot be added.
   *
   * CLASSIC METRICS ARE DELIBERATELY ABSENT. They compute live on every render
   * — a funnel is one serial query per stage — and "add as many charts as you
   * want" plus "some charts recompute live" is how a dashboard gets slow
   * exactly when it gets popular. Custom views offer flow metrics only; the
   * classic tiles that already exist keep rendering, and the compute gate
   * above shrinks with them.
   */
  const tileOptions: CustomTileOption[] = [
    ...flowTiles.map((row) => {
      const stored = (row.tile ?? {}) as { name?: string };
      return {
        key: tileKeyOfFlow(row.flowId, row.outputNodeId),
        title: stored.name ?? `Output ${row.outputNodeId.slice(0, 8)}`,
        charts: chartsFor(shapeOfTile(row.tile)) as string[],
      };
    }),
  ].filter((o) => o.charts.length > 0);

  const flowByKey = new Map(flowTiles.map((r) => [tileKeyOfFlow(r.flowId, r.outputNodeId), r]));
  const classicByKey = new Map(tiles.map((t) => [tileKeyOfMetric(t.metric.id), t]));
  const canvasTiles: CanvasTile[] = canvasRows.map((row) => {
    const flow = flowByKey.get(row.tileKey);
    const classic = classicByKey.get(row.tileKey);
    const stored = (flow?.tile ?? {}) as { name?: string };
    /**
     * THE WHOLE CONTRACT, not the half that used to cross. `unpublished`,
     * `importing` and `error` were dropped right here — the rows carry all
     * three — which is why a customer mid-import, or reading a number from a
     * flow they had already rewritten, saw a clean unmarked tile. The stored
     * jsonb rides intact: every `byRange` slice (a per-tile range override
     * reads whichever it asks for), the facts, and the presentation fields.
     */
    const source: CustomTileSource | null = flow
      ? {
          kind: "flow",
          tile: flow.tile,
          computedAt: flow.computedAt,
          status: flow.status,
          unpublished: flow.unpublished,
          importing: flow.importing,
          error: flow.error,
          flowId: flow.flowId,
        }
      : classic
        ? {
            kind: "classic",
            result: classic.kind === "error" ? null : classic.result,
            target: classic.metric.target == null ? null : Number(classic.metric.target),
          }
        : null;
    const value = flow ? tileValueForRange(flow.tile, rangeKey) : null;
    return {
      id: row.id,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      chart: row.chart,
      tileKey: row.tileKey,
      metricName: stored.name ?? classic?.metric.name ?? "Untitled",
      // Through the one parser, so a corrupt bag costs its own keys and
      // nothing else. The CLIENT derives the title — it owns the optimistic
      // rename, and a derivation here would be a second opinion it overrides.
      config: parseTileConfig(row.config),
      // What its METRIC could be drawn as — the same `chartsFor` the renderer
      // enforces with, so the menu can never offer a chart the tile refuses.
      charts: chartsFor(flow ? shapeOfTile(flow.tile) : shapeOfClassic(classic && classic.kind !== "error" ? classic.result : null, classic?.metric.target == null ? null : Number(classic.metric.target))) as string[],
      // The groups board's own attention rules, extended to the canvas: a dead
      // tile ranks as stale rather than fine, because "needs a look" is true.
      attention: flow ? attentionOf(flow, value) : classic?.kind === "error" ? 3 : classic ? 0 : 1,
      data: source,
    };
  });

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* G.4: refresh the server-rendered tiles when the org's results move. */}
      <FreshnessPoller />
      <PageContainer>
        {/* NO LEDE. It said the board holds every published flow's number,
            recomputed on a schedule and stamped with when it was last true —
            and every one of those three facts is already on the screen, said
            by the thing it is about: the tiles ARE the numbers, each carries
            its own as-of line, and the caption below states when the board as a
            whole was last true. A sentence that narrates the page under it is
            furniture. Same rule on every board in the product now. */}
        <PageHeader
          title="Dashboard"
          actions={
            <>
              {/* Every tile at once. The per-tile Refresh recomputes one flow,
                  which is the wrong unit when you have just changed something
                  upstream and want the whole board to agree with reality. */}
              <form action={refreshAllFlowsAction}>
                <SubmitButton variant="secondary" pendingLabel="Refreshing…" title="Recompute every published metric now">
                  Refresh all
                </SubmitButton>
              </form>
              {/* ONE way to build a metric. The retired form builder was still
                  advertised here as "Classic metric", and "classic" reads as
                  "the stable one" — so a first-time user took it, produced a
                  `metrics` row instead of a flow, and never saw the canvas.
                  The routes stay alive so existing metrics still open and edit
                  (their tiles link to them); they are simply no longer a door
                  anyone walks through by accident. */}
              {/* A Link wearing the Button's clothes: navigation, not a submit,
                  so it stays an <a> and takes the shared classes instead. */}
              <Link href="/dashboard/flows" className={cn(buttonVariants())}>
                <Plus size={16} />
                New flow
              </Link>
            </>
          }
        />

        {/* The filters and the tiles are ONE control: pressing a pill has to
            change both, and the second one has to say it is thinking. They
            share a client boundary so the press can land before the server
            answers — see board-controls.tsx. */}
        <BoardControls>
        {/* ── THE FILTER BAR, AS AN ISLAND ──────────────────────────────
            Two questions, two controls, one surface. They used to sit loose on
            the page: on white that was merely plain, and on the warm canvas it
            would be two orphaned controls with nothing holding them. A white
            bar with a hairline and the card shadow is the same object the
            builder floats its toolbar in — which is the point, since this bar
            does the same job at the top of this screen.

            `justify-between` so the range (what period) reads from the left
            edge and the source (whose data) sits at the right, with the gap
            between them saying they are two separate answers. */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-surface border border-border bg-card p-2 shadow-card">
          {/* THE RANGE TRACK SCROLLS RATHER THAN BREAKING THE PAGE.
              Seven pills at ~70px each is a ~500px track that cannot wrap
              (the pills are `shrink-0`, correctly — without it "Last 30 days"
              wraps to two lines inside its own pill and the track grows a
              second ragged row). At 390px that pushed the WHOLE page into
              horizontal scroll. A local scroller contains it.

              The `-mx-*`/`px-*` pair is deliberate: a bare `overflow-x-auto`
              clips its children's focus ring at both ends, so the first and
              last pill lose their outline exactly when a keyboard user reaches
              them. The negative margin lets the ring breathe inside the
              scrollport without indenting the track. */}
          <div className="-mx-1 max-w-full overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0">
            {/* No groove of its own — the island IS the container now, and a
                `bg-muted` track inside a white bar is a box drawn inside a box. */}
            <div className="inline-flex items-center gap-0.5">
              {RANGE_OPTIONS.map((r) => (
                // Still an anchor with a real href — see RangeLink. What it
                // adds is that the press lands NOW: the pill lights and the
                // tiles become skeletons while this page re-renders, instead of
                // a second of nothing over numbers that answer the old range.
                <RangeLink
                  key={r.key}
                  href={qs({ range: r.key })}
                  rangeKey={r.key}
                  activeRange={rangeKey}
                  className="inline-flex shrink-0 items-center rounded-control px-2.5 py-1.5 text-small font-medium transition-colors duration-(--duration-fast)"
                  activeClassName="bg-accent text-accent-foreground"
                  idleClassName="text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {r.label}
                </RangeLink>
              ))}
            </div>
          </div>

          {/* A <details> popover rather than a select: the source lives in the
              URL, so each option has to be a real link, and this page renders
              on the server with no client JS to submit a form. Collapsing the
              sources behind their own current value is also what stops the row
              growing every time a workspace connects another app. */}
          {sources.length > 0 && (
            <details className="group/src relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control border border-border bg-card px-3 py-1.5 text-small font-medium text-foreground transition-colors duration-(--duration-fast) hover:bg-muted [&::-webkit-details-marker]:hidden">
                {boardSource && <SourceMark source={boardSource} />}
                {activeSourceLabel}
                <ChevronDown size={14} className="text-muted-foreground transition-transform group-open/src:rotate-180" />
              </summary>
              {/* Right-aligned: the control sits at the island's right edge, so
                  a left-anchored menu opened off the end of the bar. */}
              <div className="absolute right-0 top-full z-20 mt-1.5 min-w-52 rounded-surface border border-border bg-card p-1 shadow-surface">
                <SourceLink
                  href={qs({ source: "" })}
                  className={cn(
                    "block rounded-control px-2.5 py-1.5 text-small transition-colors hover:bg-muted",
                    !boardSource ? "font-semibold text-primary" : "text-foreground",
                  )}
                >
                  All sources
                </SourceLink>
                {/* The connector's own name, not its storage key: this row read
                    "gsheets · close · webhook" while every other screen in the
                    product says "Google Sheets", "Close CRM". */}
                {sources.map((srcName) => (
                  <SourceLink
                    key={srcName}
                    href={qs({ source: srcName })}
                    className={cn(
                      "flex items-center gap-2 rounded-control px-2.5 py-1.5 text-small transition-colors hover:bg-muted",
                      boardSource === srcName ? "font-semibold text-primary" : "text-foreground",
                    )}
                  >
                    <SourceMark source={srcName} />
                    {catalogEntry(srcName)?.name ?? srcName}
                  </SourceLink>
                ))}
              </div>
            </details>
          )}
        </div>

        {loadError && (
          <div className="mt-6 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
            Some dashboard data couldn&rsquo;t be loaded just now. Refresh to try again — nothing has been lost, and
            your numbers are still stored.
          </div>
        )}

        {/* WHAT THE BOARD IS, IN ONE LINE. Every tile says when IT was last
            computed; none of them could say when the board was, which is the
            question you ask on arrival. Deliberately unboxed and quiet — it is
            a caption for the grid below, not another card competing with it. */}
        {hasTiles && (
          <MetaLine className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-muted-foreground">
            <span className="tnum">
              {activeKind === "custom"
                ? `${canvasRows.length} chart${canvasRows.length === 1 ? "" : "s"}`
                : `${tiles.length + flowTiles.length} metric${tiles.length + flowTiles.length === 1 ? "" : "s"}`}
            </span>
            {boardComputedAt && (
              <>
                <span aria-hidden>·</span>
                <span title={formatDateTime(boardComputedAt)}>newest number {relativeTime(boardComputedAt)}</span>
              </>
            )}
            {/* Still no dead-letter count here, and now for a second reason:
                it lives on Activity, whole and per connection, as a LINK to the
                page with the Replay button on it. A red number on a board with
                no door is how a dashboard teaches people to stop reading it. */}
          </MetaLine>
        )}

        {/* Metric tiles: materialized flow outputs + legacy metrics. The
            checklist renders only when the empty state is REAL — behind a
            load error the honest message is the banner above, never a
            "get started" card implying the workspace is empty.

            `items-start` on the grid: a tile is as tall as what it has to say.
            Stretching every row to its tallest member gave a bare scalar tile
            beside a breakdown a third of a card of white space, which reads as
            a tile that failed to load rather than one with nothing to add.

            THREE COLUMNS ABOVE `xl`, two below. A dashboard tile is a headline
            number and at most four bars — at two-up on a 1152px container each
            one was 560px wide holding a 36px numeral, which reads as a mostly
            empty card rather than a confident one. */}
        {!hasTiles && !loadError ? (
          <OnboardingChecklist hasConnection={connCount > 0} hasFlow={flowCount > 0} hasPublished={flowTiles.length > 0} />
        ) : !hasTiles ? null : (
          // Swapped for same-sized skeletons the instant a filter is pressed:
          // the alternative is leaving last range's numbers on screen under a
          // pill that now says something else.
          <TileArea
            count={flowTiles.length + tiles.length}
            columns={groups.length}
            canvas={activeKind === "custom" ? canvasTiles : undefined}
          >
            {activeKind === "custom" ? (
              /* A CUSTOM VIEW IS A DIFFERENT BOARD, not a groups board with no
                 groups: different storage, different geometry, different tiles.
                 It shares the view strip and the controls row, and nothing
                 else. Keyed the same way and for the same reason — the canvas
                 seeds its layout once, so a different view has to be a
                 different component instance. */
              <CustomBoard
                key={activeView ?? "default"}
                viewId={activeView!}
                tiles={canvasTiles}
                options={tileOptions}
                rangeKey={rangeKey}
                canEdit={access.can("create_flows")}
                viewStrip={viewStrip}
              />
            ) : (
            /* The ARRANGEMENT is the client's; the CARDS are still rendered
               here, on the server, and passed through as `node`. With no
               groups this emits the same BOARD_GRID markup it always did. */
            <BoardLayout
              // A DIFFERENT VIEW IS A DIFFERENT BOARD. BoardLayout seeds its
              // state once and ignores prop changes — that is what stops the
              // twelve-second poller clobbering a drag — so switching views
              // without this would leave the previous view's columns on screen.
              key={activeView ?? "default"}
              viewId={activeView}
              viewStrip={viewStrip}
              tiles={boardTiles}
              groups={groups}
              placements={placements}
              canEdit={access.can("create_flows")}
            />
            )}
          </TileArea>
        )}
        </BoardControls>
      </PageContainer>
    </AppShell>
  );
}

/**
 * A legacy `metrics` row as a tile. Kept in step with FlowTile's shape on
 * purpose — the two sit in one grid, and a board where half the cards are
 * built differently is the drift this pass exists to remove.
 */
/**
 * HOW LOUDLY A TILE IS ASKING FOR SOMETHING — the rank behind a group's
 * "Needs attention first" sort.
 *
 * Three states that already exist on the row, ordered by how much they cost the
 * person reading the number: a broken tile is showing nothing, an unpublished
 * one is showing a number computed from a version of the flow that no longer
 * exists as drawn, and a stale one is merely behind.
 *
 * `importing` is DELIBERATELY not attention. An import reaching backwards
 * through history is expected work rather than a problem — the card already
 * treats it as an annotation — and floating every backfilling metric to the top
 * of its column on the day a workspace connects an app would make the sort
 * useless exactly when it is most looked at. `computing` is transient for the
 * same reason.
 */
function attentionOf(row: FlowResultRow, value: number | null): 0 | 1 | 2 | 3 {
  if (row.status === "error") return 3;
  if (row.unpublished) return 2;
  // An em-dash under the selected range is a metric that cannot answer the
  // question being asked of it, which belongs beside "behind" rather than
  // beside "fine" — the two are the same size of problem from where the
  // customer is sitting.
  if (row.status === "stale" || value == null) return 1;
  return 0;
}

function MetricTile({ tile }: { tile: Tile }) {
  const { metric } = tile;
  // A sum over the window for a bucketed metric, so the number above the bars
  // is the same quantity the bars describe.
  const total =
    tile.kind === "aggregate" && tile.result.kind === "series"
      ? tile.result.series.reduce((a, b) => a + b.value, 0)
      : tile.kind === "aggregate" && tile.result.kind === "scalar"
        ? tile.result.value
        : null;
  // Through the same formatter the flow tiles use. A legacy metric printed its
  // raw number, so one board could show "1234.5" beside a flow tile reading
  // "1,234.5" — the same quantity, two renderings, side by side. It stores no
  // precision, so an integer keeps none and a real decimal keeps two.
  const numberFormat = { format: "number" as const, precision: total != null && Number.isInteger(total) ? 0 : 2 };

  return (
    // `surface`, matching FlowTile beside it: a tile is a thing floating on the
    // canvas now, so it takes the 16px radius every other floating surface in
    // the product wears, and answers the pointer with the ladder's hover rung.
    <Card variant="surface" className="lift hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-base font-semibold text-foreground">{metric.name}</h3>
      </div>

      {tile.kind === "error" ? (
        <p className="mt-2 text-tiny text-warn-ink">{tile.error}</p>
      ) : (
        total != null && (
          <p className="stat-numeral mt-1.5 text-stat leading-none">
            {formatMetricValue(total, numberFormat)}
            {metric.unit && <span className="ml-1.5 text-base font-normal text-muted-foreground">{metric.unit}</span>}
          </p>
        )
      )}

      {tile.kind === "aggregate" && tile.result.kind === "series" && (
        <Sparkbars series={tile.result.series} format={{ format: "number", precision: 2 }} />
      )}

      {tile.kind === "aggregate" && tile.result.kind === "scalar" && metric.target != null && (
        <TargetBar
          value={tile.result.value}
          target={Number(metric.target)}
          format={{ format: "number", precision: Number.isInteger(Number(metric.target)) ? 0 : 2 }}
        />
      )}

      {tile.kind === "funnel" && (
        <div className="mt-3">
          <FunnelView result={tile.result} />
        </div>
      )}

      {tile.kind === "aggregate" && (
        <div className="mt-3 flex items-center justify-end text-tiny text-muted-foreground">
          <Link
            href={`/dashboard/metrics/${metric.id}`}
            className="rounded-control font-medium transition-colors hover:text-primary"
          >
            Drill in
          </Link>
        </div>
      )}
    </Card>
  );
}
