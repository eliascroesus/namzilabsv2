import { ChartLine, ChevronDown, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { connections, flows } from "@/db/schema";
import { requireOrg, requestAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { TopBarFreshness, TopBarTitle } from "@/components/topbar-slots";
import { MetricCard } from "@/components/metric-card";
import { EmptyBoard } from "@/components/board-empty";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Sparkbars, TargetBar } from "@/components/charts";
import { FreshnessPoller } from "@/components/freshness-poller";
import { FunnelView } from "@/components/funnel-view";
import { FlowTile, tileValueForRange, type FlowResultRow } from "@/components/flow-tile";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { BoardControls, RangeMenu, TileArea, ViewStrip } from "./board-controls";
import { BoardLayout } from "./board-layout";
import { CustomBoard, type CanvasTile } from "./custom-board";
import type { CustomTileSource } from "@/components/custom-tile";
import { CHART_IDS, CHARTS, blockKindOf, chartsFor, shapeOfClassic, shapeOfTile } from "@/lib/board/charts";
import { parseTileConfig } from "@/lib/board/tile-config";
import { listBoardGroups, listTilePlacements } from "@/lib/board/store";
import { navViews } from "@/lib/board/nav-views";
import { UNSET_TILE_KEY } from "@/lib/board/types";
import { listBoardTiles } from "@/lib/board/tiles-store";
import {
  canvasRowFate,
  tileKeyOfFlow,
  tileKeyOfMetric,
  viewStrip as buildViewStrip,
  type BoardGroup,
  type BoardTile,
  type BoardTileRow,
  type CustomTileOption,
  type BoardView,
  type BoardViewKind,
  type TilePlacement,
} from "@/lib/board/types";
import { importProgressByStreamRef } from "@/lib/backfill/jobs";
import { calendarFlowTiles, resultsVersion, unpublishedFlowIds } from "@/lib/flow/materialize";
import { versionedFlowTiles } from "@/lib/flow/tile-cache";
import { listFlowNames } from "@/lib/flow/store";
import { CalendarBoard, type CalendarMetric } from "@/components/calendar/calendar-board";
import { calendarMonths, dayKey } from "@/lib/metrics/calendar";
import { refreshAllFlowsAction } from "@/app/dashboard/flows/actions";
import { AddViewButton, type CalendarOption } from "./view-template-picker";
import { setCalendarMetricAction } from "./board-actions";
import { listMetrics, type Metric } from "@/lib/metrics/store";
import { parseDefinition } from "@/lib/metrics/types";
import {
  computeAggregate,
  computeFunnel,
  type AggregateResult,
  type FunnelResult,
} from "@/lib/metrics/compute";
import { resolveRange, windowLabel } from "@/lib/metrics/range";
import { withDerivedRange } from "@/lib/metrics/derive-range";
import { CustomRangeCompute } from "./custom-range-compute";
import { formatMetricValue } from "@/lib/format";
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

/**
 * THE TWO WAYS CREATING A VIEW CAN BE REFUSED, and the sentences for them.
 *
 * Both arrive as a redirect param from `addViewAction`, which is the only voice
 * a FormData action has. Spelled as data so the page renders them in one place
 * rather than growing a branch per error.
 */
const VIEW_ERRORS = [
  ["rank", "Your role doesn\u2019t allow adding views to this dashboard."],
  ["view_limit", "This workspace has reached its view limit, so nothing was created. Delete one to add another."],
  /**
   * NOT A VIEW ERROR, AND IT LANDS HERE ANYWAY. `createOrganizationAction`
   * refuses at the workspace cap with a redirect, and a redirect needs
   * somewhere to say why \u2014 this banner is the only reader of `?error=` the
   * product has. Without the entry the refusal is a navigation that changes
   * nothing: you name a workspace, press Create, and arrive back on the
   * dashboard with no workspace and no reason, which is the exact failure the
   * other two rows in this table were added to stop.
   */
  [
    "workspace_limit",
    "You\u2019ve created as many workspaces as your account allows, so nothing was created.",
  ],
] as const;

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

  /**
   * TWO READS THAT DEPEND ON NOTHING BUT THE ORG, STARTED HERE AND AWAITED
   * WHERE THEY ARE ACTUALLY NEEDED.
   *
   * The Neon HTTP driver is one round trip per query with no pipelining, so on
   * this page DEPTH is the only thing that costs: measured against the real
   * endpoint, a single query is ~110ms warm and five in parallel are ~112ms.
   * A view switch was a chain of six to nine of them, and two of the links were
   * false: `access` was awaited at the top and not read until the metric filter
   * two hundred lines down, and the tile read takes only `db` and `orgId` yet
   * queued behind every board read and the classic compute. (It now chains
   * behind `resultsVersionP`, which keys its cache — still overlapping those
   * reads rather than preceding them, which is what this note is about.)
   *
   * Both now overlap the `Promise.all` below instead of preceding it. Rank
   * visibility still resolves once for the whole page — `effectiveAccess` is
   * `cache()`d, so AppShell shares this very promise and attaches its own
   * handler.
   */
  /**
   * THE NORMALIZED KEY, not the one in the URL. `resolveRange` already falls
   * back to "7d" for anything it does not recognise, and the raw string used
   * to be handed to the tiles anyway — so `?range=lastweek` selected the 7-day
   * WINDOW for every computation on the page while every tile looked its own
   * stored ranges up under "lastweek", found nothing, and reported "not
   * computed yet" about data that was computed and sitting right there. A
   * typo in a shared link became a statement about the customer's numbers.
   *
   * IT IS DERIVED BEFORE THE TILE READ NOW, because the read depends on it: a
   * window the customer drew on the calendar is answered by SUMMING the stored
   * day values, and those are stripped from the query unless someone asks for
   * them. `preset` is null for exactly those windows — see `resolveRange`,
   * which canonicalises a picked pair back to a preset when it happens to
   * equal one, so this is only true of a window the six cannot express.
   */
  const { key: rangeKey, preset: rangePreset, range } = resolveRange(one(sp.range) || "7d");
  const customRange = rangePreset == null;

  const accessP = requestAccess(orgId, userId, role);
  /**
   * C16 — THE FRESHNESS POLLER'S SEED, started here for the same reason as
   * the two above. `resultsVersion` is the exact aggregate
   * `/api/results-version` computes, over this same `getReadDb()` handle
   * (`db`), so there is no primary/replica lag between the number this
   * render shows and the number the poller's first comparison uses — and no
   * second query to drift from the route's. Swallowed rather than thrown: a
   * poller that fails to seed still works, it just starts from `null` the
   * way it always has (see `FreshnessPoller`'s own note on why that gap can
   * miss a change).
   *
   * IT IS ALSO THE TILE READ'S CACHE KEY now — see the block directly below —
   * so it is no longer merely awaited before the return. The same string that
   * tells an open dashboard its numbers moved is what makes the next render
   * re-read them, which is why there is one query for it and not two.
   */
  const resultsVersionP = resultsVersion(db, orgId).catch(() => undefined);

  /**
   * THE TILE READ, AT MOST ONCE PER RESULTS VERSION — see `tile-cache.ts`.
   *
   * This read does not depend on the RANGE: the selected window picks a key out
   * of each tile's `byRange` long after the rows arrive. So 7d -> today -> 7d
   * was three identical queries for a tile jsonb per published Output, on the
   * most-rendered page in the product, against a database that bills every byte
   * it returns. Keyed by `resultsVersionP`, a range switch now reads nothing.
   *
   * IT STILL OVERLAPS THE BOARD READS, which is the property the note above
   * cares about. It chains behind the version rather than starting beside it,
   * but it is awaited after the `Promise.all` below — so the extra hop runs
   * while those are in flight rather than adding to the page's depth.
   */
  const flowRowsP = resultsVersionP
    .then((version) => versionedFlowTiles(db, orgId, { withDays: customRange, version }))
    .catch((e) => {
      console.error("[dashboard] published tiles read failed", e);
      return null;
    });

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
    [metrics, connCount, flowCount, views] = await Promise.all([
      listMetrics(orgId),
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
      // THE SAME PROMISE THE RAIL AWAITS. `navViews` is `cache()`d per request,
      // so the sidebar's nested view list costs this page nothing — see its own
      // note for why the shell cannot simply be handed the answer.
      navViews(orgId),
    ]);
    /**
     * A VIEW THE WORKSPACE DOES NOT HAVE IS THE DEFAULT VIEW, not an error. A
     * stale link, or one shared after the view was deleted, opens the board
     * rather than a page reporting that it could not find something.
     */
    /**
     * WHICH VIEW, AND WHAT `/dashboard` WITH NO `?view=` LANDS ON.
     *
     * A stale link, or one shared after the view was deleted, opens the board
     * rather than a page reporting that it could not find something.
     *
     * The fallback used to be the row flagged `isDefault`, because a workspace
     * always had a default board — synthesised if it had no row. It does not any
     * more (see `viewStrip`), so there is nothing privileged to fall back TO:
     * the honest answer is the first tab in the strip, which is what a reader
     * sees selected. `null` only survives for a workspace with no views at all,
     * which never reaches a board — it gets the Get-started card.
     */
    const ordered = buildViewStrip(views);
    activeView = views.some((v) => v.id === requestedView) ? requestedView : (ordered[0]?.id ?? null);
    // The DEFAULT view has no row, so "which kind is it" must have an answer
    // when there is nothing to read. It is always a groups board.
    activeKind = views.find((v) => v.id === activeView)?.kind ?? "groups";
    if (activeKind === "custom" && activeView) {
      // A CUSTOM VIEW READS NEITHER GROUPS NOR PLACEMENTS, because it has
      // neither — no columns, no lane order. Asking for them would be two
      // queries per poll returning two empty arrays.
      canvasRows = await listBoardTiles(db, orgId, activeView);
    } else if (activeKind === "calendar" && activeView) {
      /**
       * A CALENDAR VIEW READS ONE ROW: which metric it is a calendar of.
       *
       * No groups — it has no columns — so the groups read is skipped for the
       * same reason a canvas skips it. `listTilePlacements` is reused rather
       * than given a narrower sibling: a calendar view holds exactly one
       * placement, so "read this view's placements" already returns it, and a
       * second query spelling the same thing is the drift this board keeps
       * avoiding elsewhere.
       */
      placements = await listTilePlacements(db, orgId, activeView);
    } else {
      /**
       * BOTH AT ONCE, AND THE COST ARGUMENT FLIPPED WHEN IT WAS MEASURED.
       *
       * This was sequential on the reasoning that a view with no groups renders
       * the plain grid, so its placements cannot exist and the second read is
       * pure waste. That is true about ROWS and wrong about TIME: every Neon
       * round trip on this page measures 110–190ms, so waiting to find out
       * whether to ask costs a full round trip on every board that DOES have
       * groups — which is the common case and the one the owner is waiting on.
       *
       * The wasted query, when it happens, is a narrow indexed read of a view
       * with no placements returning zero rows. That is the cheapest thing this
       * page does, and it is paid only by boards that render the plain grid.
       *
       * Trading a certain 110ms for an occasional empty query is the right way
       * round; the old comment had the ledger but not the clock.
       */
      [groups, placements] = await Promise.all([
        listBoardGroups(db, orgId, activeView),
        listTilePlacements(db, orgId, activeView),
      ]);
      // A plain grid has no lanes to place into, so anything read above is not
      // merely unused — it cannot be meaningful. Dropped rather than rendered.
      if (groups.length === 0) placements = [];
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

  /**
   * EVERY KEY THAT EXISTS, taken BEFORE the rank filter below.
   *
   * A canvas row whose metric this viewer may not see joins to nothing, and
   * "joins to nothing" is also what a genuinely deleted metric looks like —
   * two completely different facts arriving as the same `undefined`. Without
   * this set the canvas told a restricted viewer "It isn't published any more.
   * Publish it again", which is false, and printed the tile's title while
   * saying it. See `canvasTiles` for what each case renders.
   */
  const existingKeys = new Set(metrics.map((m) => tileKeyOfMetric(m.id)));

  // Filter the SOURCE list, not the rendering: every classic-metric surface on
  // this page (aggregate tiles, funnel tiles, drill-in links) derives from
  // `metrics`, so a hidden metric cannot leak through any section — and its
  // compute below is never even run.
  const access = await accessP;
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
  /**
   * A CALENDAR VIEW COMPUTES NONE OF THEM, which is the largest saving on this
   * page and the reason the branch is worth having at all.
   *
   * Classic metrics are not stored — each one is a live `events` query per
   * render and a funnel is one query PER STAGE, and this block re-runs on every
   * `router.refresh()` and every twelve-second freshness poll. A calendar draws
   * a single materialised metric's `byDay` and cannot show a classic metric at
   * all (they have no day map — see the note on `calendarOptions`), so every one
   * of those queries would be paid for and thrown away.
   *
   * The `custom` narrowing above is the same argument one step weaker: a canvas
   * computes the classics it references. A calendar references none.
   */
  const classicsToCompute =
    activeKind === "calendar"
      ? []
      : activeKind === "custom"
        ? metrics.filter((m) => referencedKeys.has(tileKeyOfMetric(m.id)))
        : metrics;

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
    // Started before the board reads — see `flowRowsP`. `null` is the read
    // having failed, which the catch below already knew how to answer.
    const allRows = await flowRowsP;
    if (!allRows) throw new Error("published tiles unavailable");
    // Before the filter — see `existingKeys` above. A flow tile this viewer's
    // rank hides must be told apart from one that no longer exists.
    for (const r of allRows) existingKeys.add(tileKeyOfFlow(r.flowId, r.outputNodeId));
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
    /**
     * A WINDOW THE CUSTOMER DREW, ANSWERED HERE OR HANDED ON.
     *
     * `withDerivedRange` writes the summed slot INTO the row when the tile can
     * answer it out of its stored day values — a count metric inside the
     * two-month horizon. Upstream of the components on purpose: three of them
     * read `byRange` (`FlowTile`, `CustomTile` and `tileValueForRange`, which
     * the board's value sort calls), and a branch in one would leave the other
     * two disagreeing about what the same tile is worth under the same window.
     *
     * A row it cannot answer is left exactly as it was, so the tile renders its
     * own "not computed for this range" state — and `pendingCustom` below names
     * those flows for the client to ask the server about.
     */
    flowTiles = rows.map((r) => (customRange ? withDerivedRange({ ...r }, rangeKey) : { ...r }));

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
    /**
     * BOTH DECORATIONS AT ONCE. They are two independent reads of the same
     * `rows` — neither needs the other's answer — and awaiting them in sequence
     * put two more round trips on the critical path for two annotations. Each
     * keeps its own failure: a marker or a badge may go missing, never the
     * numbers under them.
     */
    const [unpubResult, progressResult] = await Promise.allSettled([
      // Nothing on the board, nothing to annotate — a workspace mid-onboarding
      // should not pay for a graph comparison to decorate zero tiles.
      rows.length > 0 ? unpublishedFlowIds(db, orgId) : Promise.resolve(new Set<string>()),
      importProgressByStreamRef(db, orgId, rows.flatMap((r) => streamRefsOfProvenance(r.provenance))),
    ]);

    let unpublished = new Set<string>();
    if (unpubResult.status === "fulfilled") {
      unpublished = unpubResult.value;
      if (unpublished.size > 0) flowTiles = flowTiles.map((r) => (unpublished.has(r.flowId) ? { ...r, unpublished: true } : r));
    }

    if (progressResult.status === "fulfilled") {
      const progress = progressResult.value;
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
  /**
   * THE NEWEST THING ON THE BOARD, which is what "Updated …" in bar two means.
   * Flow tiles carry `computedAt`; classic metrics compute live at render, so
   * their freshness is now. Null when the board has neither, and the slot is
   * `empty:hidden`, so an unknown freshness makes no claim.
   */
  const newestComputedAt: string | null =
    flowTiles.reduce<string | null>((newest, r) => {
      const at = r.computedAt ? new Date(r.computedAt).toISOString() : null;
      return at && (!newest || at > newest) ? at : newest;
    }, null) ?? null;

  const hasTiles = activeKind === "custom" || tiles.length > 0 || flowTiles.length > 0;

  /**
   * THE FLOWS A DRAWN WINDOW STILL OWES AN ANSWER.
   *
   * After `withDerivedRange`, a tile either carries a slot for the active range
   * or genuinely cannot answer it here — a rate or an average, which may not be
   * folded across days, or a span older than the stored day horizon. Those are
   * the ones `CustomRangeCompute` asks the server to materialize.
   *
   * A row that has never computed (`status` other than fresh) is left out: it
   * has nothing to window, and asking would re-run a flow to reproduce the same
   * failure. Deduped by flow, because one flow can publish several tiles and
   * one run answers all of them.
   */
  const pendingCustomFlows = customRange
    ? [
        ...new Set(
          flowTiles
            .filter((r) => r.status === "fresh")
            .filter((r) => (r.tile as { byRange?: Record<string, unknown> } | null)?.byRange?.[rangeKey] == null)
            .map((r) => r.flowId),
        ),
      ]
    : [];

  /**
   * NO VIEWS — the Get-started card, and none of this page's chrome.
   *
   * It is one fact now. It carried two more, and both were scaffolding for the
   * synthesised default tab that no longer exists:
   *
   *   `&& !hasTiles` meant a workspace with any published metric could never be
   *   empty, so deleting every view put the board back with the metrics on it. A
   *   metric is not a board — they live in `flow_results`, untouched by any of
   *   this, and what is missing with no views is somewhere to PUT them. Creating
   *   one brings every one of them back on the next render.
   *
   *   `&& groups.length === 0` protected a board stored at `view_id IS NULL`,
   *   which only the synthesised tab could reach. With that tab gone the check
   *   protects nothing, and the live database has no such rows in any case.
   *
   * A view is a row. No rows, no board.
   */
  const emptyWorkspace = views.length === 0;

  /**
   * THE CALENDAR VIEW'S OWN READ, and the two things it feeds.
   *
   * `calendarFlowTiles` is the MIRROR of `publishedFlowTiles`: it selects the
   * name, the six keys that decide how a number is spelled, and `byDay` — and
   * nothing else. The dashboard's read drops `byDay` in SQL for exactly the same
   * reason, because sixty-odd day entries per tile on a query that runs every
   * twelve seconds is real money against a database that bills by the byte.
   * Choosing between them per view kind is the pattern the pair was built for.
   *
   * ONE READ SERVES BOTH the sheet and the picker, because the narrow projection
   * already carries the names.
   *
   * THE COST THAT IS NOT HIDDEN: `flowRowsP` was started at the top of this
   * function, before anything knew which view was active — deliberately, so it
   * overlaps the board reads. On a calendar view that result is discarded. The
   * alternative is awaiting the view list before choosing, which adds a serial
   * round trip to EVERY view on the most-rendered page in the product to save
   * one read on a single kind. The promise already carries its own `.catch`, so
   * nothing is left unhandled.
   */
  let calendarMetrics: CalendarMetric[] = [];
  let calendarRowsFailed = false;
  if (activeKind === "calendar" && !loadError) {
    const calRows = await calendarFlowTiles(db, orgId).catch((err) => {
      console.error("[dashboard] calendar tile read failed", err);
      return null;
    });
    // `null` is a FAILED read; `[]` is a workspace with nothing published. The
    // two must not collapse — one is our outage rendered as the customer's
    // empty workspace, which is the product telling them their work is gone.
    if (calRows == null) calendarRowsFailed = true;
    else {
      const flowNames = new Map<string, string>();
      try {
        for (const f of await listFlowNames(db, orgId)) flowNames.set(f.id, f.name);
      } catch {
        // A missing hint costs a subtitle, never the board.
      }
      calendarMetrics = calRows
        // THE SAME RANK GATE THE BOARD APPLIES. A metric hidden from a member on
        // one view must be hidden on every other way of looking at it, or the
        // restriction is decoration.
        .filter((r) => access.canSeeMetric(`flow:${r.flowId}`))
        .map((r) => {
          const stored = (r.tile ?? {}) as Record<string, unknown> & { byDay?: CalendarMetric["days"] };
          return {
            id: `${r.flowId}:${r.outputNodeId}`,
            flowId: r.flowId,
            flowName: flowNames.get(r.flowId) ?? "Flow",
            // A row whose tile jsonb is null has never computed successfully, so
            // there is no stored name — the output id is the only honest handle.
            name: (stored.name as string | undefined) ?? `Output ${r.outputNodeId.slice(0, 8)}`,
            format: {
              format: stored.format as string | undefined,
              precision: stored.precision as number | undefined,
              unit: stored.unit as string | undefined,
              currency: stored.currency as string | undefined,
              durationDisplay: stored.durationDisplay as string | undefined,
            },
            days: stored.byDay ?? {},
            status: r.status,
            error: r.error,
            computedAt: r.computedAt ? new Date(r.computedAt).toISOString() : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "en-US"));
    }
  }

  /**
   * WHAT A CALENDAR COULD BE OF — the picker's second step, costing no query.
   *
   * On a calendar view it comes from the narrow read above; on any other view
   * from the flow tiles the board already holds. Either way the list is one the
   * page had in hand.
   *
   * CLASSIC METRICS ARE ABSENT, and that is a property of the data rather than a
   * policy: they are computed live by the frozen engine in `lib/metrics/compute.ts`
   * and never materialised, so they have no `byDay` for a calendar to draw. The
   * standalone page never offered them either.
   */
  const calendarOptions: CalendarOption[] =
    activeKind === "calendar"
      ? calendarMetrics.map((m) => ({ key: `flow:${m.id}`, name: m.name, hint: m.flowName }))
      : flowTiles.map((r) => {
          const stored = (r.tile ?? {}) as { name?: string };
          return {
            key: tileKeyOfFlow(r.flowId, r.outputNodeId),
            name: stored.name ?? `Output ${r.outputNodeId.slice(0, 8)}`,
          };
        });

  /**
   * WHICH METRIC THIS CALENDAR IS OF — the view's one placement, as the id the
   * board speaks. A view with no placement yet (or one whose row was cleaned up)
   * is `null`, which opens on the first metric exactly as the old page did.
   */
  const calendarSelected =
    activeKind === "calendar" ? (placements[0]?.tileKey?.replace(/^flow:/, "") ?? null) : null;

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

  /**
   * THE STRIP, AND THE ONE TAB THAT MAY OR MAY NOT BE A ROW.
   *
   * A workspace that has never renamed its board has no row for it, so the tab
   * is synthesised here and sorts first — nothing else can put it there. Once it
   * has been ADOPTED it is in `views` like any other tab, carrying its own `pos`
   * (minted to sort first, and movable afterwards), so prepending would show the
   * same board twice under two names.
   */
  // Shared with the rail's nested list — see `viewStrip`. It was spelled here
  // and nowhere else, which is why the rail showed no views at all on a
  // workspace whose only board is the default one.
  const viewTabs: BoardView[] = buildViewStrip(views);

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
                 go. It shares a line with "New group", "All sources" and
                 "Refresh all": everything on that row is about THIS BOARD,
                 while the period control in the page header narrows which
                 numbers are on it.

                 24px BETWEEN TABS, not 4px, and the change is what the
                 underline costs. A filled pill carries its own edges, so tabs
                 set tight beside each other still read as separate objects; an
                 underlined tab is a WORD with a rule under it, and at 4px apart
                 four of those are one long rule broken by gaps nobody reads as
                 boundaries. 24px is the distance at which each label owns its
                 own rule. The `+` rides the same gap — it is the last item in
                 the row, not a control appended to it.

                 `p-1` (4px) all round, pulled back by `-mx-1`, so the focus
                 ring on the first tab has room without the row indenting.

                 THE LIST IS A CLIENT COMPONENT NOW, and only because the order
                 is DRAGGABLE. The tabs are unchanged — still real anchors from
                 server-computed hrefs, so a link pasted into Slack still opens
                 on the sender's view. `ViewStrip` holds the order and the
                 pointer, which a server component cannot, and writes one row's
                 `pos` on drop. The rail's nested list follows for free: both
                 sort on `pos`. */
              <ViewStrip
                views={viewTabs.map((v) => ({
                  key: v.id ?? "default",
                  id: v.id,
                  name: v.name,
                  href: qs({ view: v.id ?? "" }),
                  pos: v.pos,
                  kind: v.kind,
                  isDefault: v.id === null,
                }))}
                activeView={activeView}
                canEdit={access.can("create_flows")}
                defaultHref={qs({ view: "" })}
              >
                {access.can("create_flows") && (
                  <AddViewButton rangeKey={rangeKey} source={boardSource} calendarOptions={calendarOptions} />
                )}
              </ViewStrip>
  );


  /**
   * THE RANGE CONTROL IS A DROPDOWN NOW — see `RangeMenu` in
   * board-controls.tsx, which is where its markup and its argument both live.
   *
   * What stood here was the case for a SEGMENTED TRACK: eleven free-floating
   * chips across two filter dimensions had wrapped onto a second line and
   * orphaned the last two sources, so sitting the ranges in one groove made
   * them read as one control with one answer. That was right against loose
   * chips and it is not what the 4 September Figma draws — six pills is a
   * ~520px object in a header slot, carrying its own horizontal scroller so a
   * narrow viewport would not push the page sideways, and a dropdown answers
   * the same question in a tenth of the width with no scroller to carry.
   *
   * The range still lives in the URL; the source filter is still gone; the
   * press still lands optimistically through `BoardControls`. Only the shape
   * changed.
   */

  /**
   * `boardActions` IS RETIRED, IN THE FIX ROUND THAT CO-LOCATED THE HEADER.
   *
   * It used to carry the source picker (removed earlier — see the note that
   * lived here) and Refresh all, rendered on the server and handed down to
   * whichever board was mounted, for the same reason `viewStrip` was: the
   * source rows were real anchors and Refresh all is a plain form post, so
   * neither needed the client boundary the board itself is behind.
   *
   * Refresh all is the one that survived, and the Figma's own ruling on the
   * three header actions ("+ Add", "Today", "Refresh All") puts it beside the
   * other two in `PageHeader`'s own `actions` slot rather than on the board's
   * row — see that slot below, where the button and its styling rationale
   * both moved. With nothing left to carry, the variable goes with it rather
   * than surviving as a prop three files thread through for no reason; see
   * `board-layout.tsx` and `custom-board.tsx` for the matching removal.
   */

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
  /**
   * A ROW THIS VIEWER MAY NOT SEE IS NOT RENDERED AS ANYTHING.
   *
   * Both filters above drop hidden metrics at the source, so a canvas row
   * pointing at one joined to nothing and fell through to `source: null` —
   * which draws `DeadTile`. That was wrong twice over: it printed the tile's
   * TITLE (the override lives on the row, which is not permission-filtered),
   * and it said "It isn't published any more. Publish it again" to somebody
   * whose only problem is that they are not allowed to look at it.
   *
   * `existingKeys` is what separates the two: taken before either filter, it
   * still contains a hidden metric's key and never contained a deleted one.
   * Hidden → the row is omitted here and NOTHING about it crosses to the
   * client. Genuinely gone → `DeadTile`, which is the right answer and stays.
   */
  const fateOf = (row: BoardTileRow) =>
    canvasRowFate(row.tileKey, flowByKey.has(row.tileKey) || classicByKey.has(row.tileKey), existingKeys);
  const hiddenOnThisView = canvasRows.filter((row) => fateOf(row) === "hidden").length;

  const canvasTiles: CanvasTile[] = canvasRows.flatMap((row) => {
    const flow = flowByKey.get(row.tileKey);
    const classic = classicByKey.get(row.tileKey);
    if (fateOf(row) === "hidden") return [];
    const stored = (flow?.tile ?? {}) as { name?: string };
    /** Furniture: no metric to name it after, no freshness to rank. */
    const block = blockKindOf(row.tileKey);
    /** Chosen nothing yet — an invitation, not a loss. See `UNSET_TILE_KEY`. */
    const unset = row.tileKey === UNSET_TILE_KEY;
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
    return [{
      id: row.id,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      chart: row.chart,
      tileKey: row.tileKey,
      // A block is named after its KIND — "Heading", "Divider" — so the tile
      // menu has something to call it. "Untitled" is what a metric with no name
      // is, and a divider is not an untitled anything.
      // A block is named after its KIND, and an UNSET tile after its absence —
      // "Untitled" is what a metric with no name is, and neither a divider nor
      // an empty slot is an untitled anything.
      metricName: block
        ? (CHARTS.find((c) => c.id === block)?.label ?? "Block")
        : unset
          ? "No metric"
          : (stored.name ?? classic?.metric.name ?? "Untitled"),
      // Through the one parser, so a corrupt bag costs its own keys and
      // nothing else. The CLIENT derives the title — it owns the optimistic
      // rename, and a derivation here would be a second opinion it overrides.
      config: parseTileConfig(row.config),
      // What its METRIC could be drawn as — the same `chartsFor` the renderer
      // enforces with, so the menu can never offer a chart the tile refuses.
      // NOTHING CONSTRAINS AN UNSET TILE, so every chart is on offer: the rule
      // this list enforces is "a metric's shape decides what can draw it", and
      // there is no metric yet. Narrowing it to the empty set instead would
      // leave a fresh tile unable to change its own chart — the one edit
      // somebody is most likely to want before picking data.
      charts: unset
        ? (CHART_IDS as readonly string[]).slice()
        : (chartsFor(flow ? shapeOfTile(flow.tile) : shapeOfClassic(classic && classic.kind !== "error" ? classic.result : null, classic?.metric.target == null ? null : Number(classic.metric.target))) as string[]),
      // The groups board's own attention rules, extended to the canvas: a dead
      // tile ranks as stale rather than fine, because "needs a look" is true.
      // A block can never need a look: it has no run to fail, no result to go
      // stale, and no published version to drift from. Without this it ranked
      // as `1` — the "dead metric" tier — and sorted above real problems.
      // An unset tile can never need a look, for the reason a block cannot: no
      // run to fail, no result to go stale, no published version to drift from.
      // Without this it ranked `1` — the DEAD-metric tier — and an empty slot
      // would sort above a genuinely broken number.
      attention: block || unset ? 0 : flow ? attentionOf(flow, value) : classic?.kind === "error" ? 3 : classic ? 0 : 1,
      data: source,
    }];
  });

  // Awaited here, not above: nothing between its start and this line reads
  // it, so there is no reason to block on it any earlier — it has been
  // racing every read above since before the `Promise.all`.
  const initialResultsVersion = await resultsVersionP;

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* G.4: refresh the server-rendered tiles when the org's results move.
          C16: seeded so a change before the first poll is never missed. */}
      <FreshnessPoller initialVersion={initialResultsVersion} />
      <PageContainer width="full">
        {/* ── NOTHING HERE YET ──────────────────────────────────────────────
            A whole page shape rather than the usual one with holes in it. The
            title, the period track, the tab strip and the action row all
            describe a board, and there is no board — so none of them render,
            and the only thing on screen is the invitation to make one.
            Most of that is free: `New group` is rendered INSIDE `BoardLayout`
            (client state, gated on `canEdit`), which lives inside `TileArea`,
            so not taking that branch already removes it. `PageHeader` carries
            the view strip, the period dropdown, "+ Add" and Refresh all —
            all three header actions, since the fix round that co-located
            them — so skipping the header is what removes the rest.
            `BoardControls` is skipped with it. It is a context provider that
            emits no DOM, and nothing here calls `useBoard()` — `RangeMenu`,
            `ViewTab` and `TileArea` are its only consumers now and
            none of them render in this branch.
            A LOAD ERROR IS NOT AN EMPTY BOARD, so it wins: a workspace whose
            reads failed sees the banner and the ordinary page, never an
            invitation to start over on top of numbers that exist. */}
        {emptyWorkspace && !loadError ? (
          /* THE PAGE, CENTRED ON ITS ONE BLOCK. The height is the viewport less
             the 70px chrome band and `PageContainer`'s own vertical padding —
             `py-6` below `sm` and `py-8` above it, so the subtraction steps with
             it. Matched, the three add back to exactly 100dvh and nothing
             scrolls. The heading travels inside `EmptyBoard`, so this centres
             the pair rather than pinning a title to the top of an empty page. */
          <div className="flex min-h-[calc(100dvh-70px-3rem)] items-center justify-center p-6 sm:min-h-[calc(100dvh-70px-4rem)]">
            <EmptyBoard
              rangeKey={rangeKey}
              source={boardSource}
              canCreate={access.can("create_flows")}
              calendarOptions={calendarOptions}
            />
          </div>
        ) : (
        <>
        {/* The filters and the tiles are ONE control: pressing a pill has to
            change both, and the second one has to say it is thinking. They
            share a client boundary so the press can land before the server
            answers — see board-controls.tsx. `PageHeader` is INSIDE it because
            the period pills are `RangeLink`s and read that context. */}
        {/* THE DRAWN WINDOW'S SECOND HALF. Renders nothing; it asks the
            server for the ranges the tiles could not answer from what they
            already carried, then refreshes. Inside the board's own branch so
            it never mounts on an empty workspace. See `derive-range.ts` for
            which windows reach it and why. */}
        {pendingCustomFlows.length > 0 && (
          <CustomRangeCompute rangeKey={rangeKey} flowIds={pendingCustomFlows} />
        )}
        <BoardControls>
        {/* ── THE PAGE HEADER ───────────────────────────────────────────────
            THE TITLE IS BACK, and the argument that removed it is what returns
            it. That argument was: "Dashboard" as an h1 sat directly beside a
            sidebar row that already said Dashboard, so the page opened by
            saying the same word twice. True of a 264px sidebar with labels on
            it. The navigation is a 70px ICON RAIL now — no words anywhere in
            it — so this h1 is the only place on the screen that names where you
            are, and a page whose first line is a filter pill has no head.

            AND IT IS THE VIEW'S OWN NAME NOW, not the word "Dashboard".
            The h1 was a literal, sitting an inch above a tab strip that already
            names every view — so renaming "View 2" to "Revenue" gave you a page
            headed Dashboard with Revenue underlined beneath it. The name a view
            already has is the page's title, and typing in the title renames the
            view: one fact, one row it is stored in, two places it is shown. See
            `ViewTitle`, which also explains why the DEFAULT view's title is
            static — that board is the absence of a row, so it has no name to
            write to.

            THE SUBTITLE NAMES THE SCOPE, it does not narrate the page. The
            lede this file deleted described the board's whole mechanism —
            published, recomputed on a schedule, stamped with when it was last
            true — three facts the tiles each say for themselves. A subtitle's
            job in this header is one phrase saying what the numbers below are
            drawn FROM, which nothing else on the screen says.

            IT IS STILL A LITERAL, DELIBERATELY. Making it editable beside the
            title would need somewhere to put it, and there is nowhere: the
            title rides `dashboard_views.name`, which already exists, while a
            per-view subtitle is a column that does not — so an editable field
            here could only accept a sentence and forget it on the next load,
            which is worse than a fixed one that is true. It becomes editable
            the same day `dashboard_views` grows a nullable `subtitle` and
            `renameViewAction` gains a sibling to write it. */}
        {/* BAR TWO'S LEFT HALF, from the page that knows what it is. The bar
            is global — `AppFrame` renders it on every route — so it cannot know
            what page it is on or when that page last computed anything, and a
            bar cannot honestly claim a freshness it has not measured. These two
            portal into the slots it draws (`#topbar-title`, `#topbar-status`),
            the same arrangement the flow builder's toolbar already uses.
            The title is the ACTIVE VIEW's name, so the filled tab below and the
            heading above it say one word. */}
        {/* THE WINDOW RIDES WITH THE NAME. `range` is the RESOLVED window,
            already normalised by `resolveRange` — so a URL spelling a custom
            pair that happens to equal a preset prints that preset's days, and
            two spellings of one window cannot read differently. */}
        {/* `||` AND A TRIM, NOT `??`. A view whose name is the empty string —
            a rename saved blank, a row written before names were required —
            is not "no name" to `??`, which only catches null and undefined, so
            it passed straight through and the bar rendered an empty heading
            that looked exactly like the portal bug beside it. Two different
            causes for one symptom is how a fix gets declared and the report
            comes back. */}
        <TopBarTitle range={windowLabel(range)}>
          {viewTabs.find((v) => v.id === activeView)?.name?.trim() ||
            viewTabs[0]?.name?.trim() ||
            "Dashboard"}
        </TopBarTitle>
        <TopBarFreshness at={newestComputedAt} />

        <PageHeader
          /* `band` — THE FRAME'S THIRD BAR, and its absence here is why the
             board's controls sat on the page instead of on a white band while
             /design/overview looked correct. The harness got this prop and the
             page a customer opens did not. */
          band
          /* TABS AND ACTIONS, AND NO THIRD ZONE ANY MORE.
             The 4 September Figma drew one row as tabs left, the view's name
             CENTRED, the actions right — so `PageHeader` grew a `tabs` slot
             and a three-zone grid to hold it. Node 49:5399 draws two zones:
             the tab strip and the three buttons. The name appears exactly
             once, on its own tab, with the "Options for Overview" menu beside
             it (node 49:5406).

             That menu is `ViewTab`'s, and it already owns Rename, Duplicate
             and Delete — so the centred `ViewTitle` was a second copy of a
             string the tab was already showing, with a second route to the
             same rename. Dropping it costs nothing and removes the only place
             in the product where one name was drawn twice on one row. */
          tabs={viewStrip}
          actions={
            /* THE THREE HEADER ACTIONS, CO-LOCATED — fixed in the first
               review round, which found the Figma's own three ("+ Add",
               "Today", "Refresh All") spread across two places: "+ Add" was
               still inline in `custom-board.tsx`'s own row and Refresh all
               was still in the retired `boardActions`. The ruling puts all
               three here, in this order, because the header is the one slot
               every view shares — a groups board, a canvas and a calendar all
               render this same fragment, and only the middle third differs
               between them. */
            <>
              {/* "+ ADD", AND ONLY ON A CANVAS. `AddChartMenu` is `custom-
                  board.tsx`'s own popover — it owns the metric-add state
                  (`picking`, `busy`, the optimistic `addTile`), which lives
                  inside that CLIENT component, not in this async server one.
                  This page cannot instantiate it directly, so it leaves an
                  empty placeholder in the slot the Figma draws "+ Add" in,
                  and `CustomBoard` portals its own button and popover into it
                  — the identical trick the calendar uses for `#calendar-tools`
                  and `#calendar-period` below, and for the same reason: the
                  state belongs to the client, the position belongs to the
                  server-rendered header, and neither can hand the other what
                  it has. `CustomBoard` gates the portal on `canEdit` itself,
                  so a viewer without `create_flows` sees an empty div here,
                  same as the groups board and the calendar always have.
                  `empty:hidden` is what makes that div cost nothing in the
                  actions zone's layout when it stays unfilled, rather than a
                  hollow gap where a button would otherwise sit. */}
              {activeKind === "custom" && <div id="canvas-add-chart" className="flex items-center empty:hidden" />}
              {/* "NEW GROUP", BESIDE THE DATE RANGE. Same arrangement as the
                  two slots around it and for the same reason: the button calls
                  `addGroup`, which writes optimistically into the `groups`
                  `board-layout.tsx` owns, so this async server component cannot
                  instantiate it — it holds the POSITION and the client portals
                  the control in. It stood on a row of its own between the
                  header and the board, which was the last third band left in
                  the product. */}
              {activeKind === "groups" && <div id="board-new-group" className="flex items-center empty:hidden" />}
              {/* A CALENDAR PUTS ITS OWN TIME CONTROL HERE INSTEAD.
                  The period pills narrow WHICH NUMBERS a board shows; a
                  calendar answers two fixed months — the only two the
                  materializer stores — so six live pills would be the
                  interface offering something it cannot do. But the SLOT is
                  right: this is where every view says what span it is
                  reading, and a calendar reads in months. The board fills
                  this from the client (it owns which month is on screen); an
                  empty div collapses to nothing if it never does. */}
              {activeKind === "calendar" ? (
                <div id="calendar-period" className="flex items-center gap-1.5" />
              ) : (
                /* ── THE PERIOD CONTROL ──────────────────────────────────
                   ONE DROPDOWN, SIX ANSWERS, AND THE SAME URL UNDERNEATH.
                   The six-pill track that stood here is gone; what replaces
                   it says the current range on its face and opens the other
                   five. `RANGE_OPTIONS` is still the list, and each `href` is
                   still `qs()`'s, so nothing about which numbers a link opens
                   on has changed.

                   The scroller went with the track, and that is the point
                   rather than a side effect: a ~520px control in this slot
                   could only survive a 390px viewport by scrolling inside
                   itself, and the header's right column had to stop being
                   `shrink-0` to let it. A 24px dropdown needs neither. */
                <RangeMenu
                  activeRange={rangeKey}
                  /* The board's own URL, so a picked window keeps the view and
                     the source rather than throwing you back to the default
                     board. `qs({})` is that URL with the current range in it. */
                  href={qs({})}
                  /* Today, from the SERVER's clock. The picker renders on both
                     sides of the hydration boundary and must not compute the
                     current UTC day twice — see its own header. */
                  now={new Date()}
                />
              )}
              {/* REFRESH ALL, LAST, AND ON EVERY VIEW — the groups board, a
                  canvas and the calendar all recompute the same published
                  metrics, so it belongs to the page rather than to any one
                  board's own row. It used to sit inside `boardActions` (see
                  the retirement note above) and inside the calendar branch's
                  own row before that; both threaded it down as server markup
                  for no reason once the header could hold it directly.
                  NOT THE FILL, AS OF THE 4 SEP 2026 BLUE RETHEME. This used
                  to argue for spending the brand's one filled control here —
                  first as scarcity ("the single act the page exists for"),
                  then as a fill/stroke rule keyed to which control CHANGES
                  something rather than narrows what is shown. The Figma
                  settles it a third way, by naming names: blue is reserved
                  for "+ Add" and "New flow"; every other header action —
                  Refresh all included — is `secondary`, the kit's ordinary
                  grey button (see `ui/button.tsx`). Acting is no longer the
                  test; being one of exactly two adds-something verbs is.
                  `xs`, WITH A 16px ICON — the header's smallest rung, and the
                  same override as "+ Add" and "Today" beside it: `xs` ships
                  `[&_svg]:size-3.5` (14px), which is not what this row draws,
                  so the 16 is spelled on the button rather than the icon,
                  because the size variant's own descendant rule would win
                  over a class on the svg no matter which order they were
                  written in. */}
              {/* COMPARE TO — DRAWN, AND NOT WIRED, and it belongs on the REAL
                  board rather than only on the design harness. Node 0:5 puts it
                  between the period and the refresh. What it would open is a
                  comparison SERIES this product does not compute — DESIGN.md
                  has recorded the two-series legend as unbuilt since before the
                  chrome rebuild — so it ships disabled with a title that says
                  so, rather than as a menu that opens onto nothing. */}
              {/* AND IT STANDS DOWN ON A CALENDAR, where the metric picker
                  takes its place. Two reasons, and the second is the real one:
                  a comparison PERIOD is meaningless on a sheet that answers two
                  fixed months, and the slot is the best position on the row for
                  the one control a calendar genuinely has — the picker was
                  living on a row of its own below the header, which is the
                  third-bar mismatch this whole chrome pass has been removing.
                  `#calendar-tools` is filled by `CalendarBoard`'s portal; an
                  empty div collapses if it never is. */}
              {activeKind === "calendar" ? (
                <div id="calendar-tools" className="flex shrink-0 items-center gap-2 empty:hidden" />
              ) : (
                <Button
                  variant="white"
                  disabled
                  title="Comparison periods are not built yet"
                  className="shrink-0"
                >
                  <ChartLine />
                  Compare To
                  <ChevronDown />
                </Button>
              )}
              <form action={refreshAllFlowsAction} className="shrink-0">
                <SubmitButton
                  /* WHITE, WITH "Today" BESIDE IT — node 49:5439. The two
                     non-brand controls in this row are the loudest things on
                     the screen after the brand, which reads against the kit's
                     own "quiet chrome" thesis and is drawn that way anyway,
                     twice, on two adjacent controls. Followed rather than
                     corrected; DESIGN.md owns the tension out loud. */
                  variant="white"
                 
                  pendingLabel="Refreshing…"
                  title="Recompute every published metric now"
                >
                  <RefreshCw />
                  Refresh All
                </SubmitButton>
              </form>
            </>
          }
        />

        {/* WHAT `addViewAction` SAID WHEN IT REFUSED.
            It redirects to `?error=rank` or `?error=view_limit` and this page
            read neither, so a refusal was a navigation that changed nothing —
            you pressed a layout and landed back where you were, with no view and
            no reason. The `<details>` at least stayed open showing its two rows;
            the modal unmounts on the redirect, so there was not even that.
            Dismissable by navigating back to the board without the param, the
            same shape the flows list uses for its own two. */}
        {VIEW_ERRORS.map(([key, message]) =>
          one(sp.error) === key ? (
            <div
              key={key}
              className="mb-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink"
            >
              <p>{message}</p>
              <Link
                href={qs({})}
                aria-label="Dismiss"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "iconSm" }),
                  "text-danger-ink/70 hover:bg-danger-soft hover:text-danger-ink",
                )}
              >
                <X />
              </Link>
            </div>
          ) : null,
        )}
        {loadError && (
          <div className="mt-6 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-sm text-warn-ink">
            Some dashboard data couldn&rsquo;t be loaded just now. Refresh to try again — nothing has been lost, and
            your numbers are still stored.
          </div>
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
        {/* THE BOARD RENDERS WHENEVER THERE IS A BOARD — which is not the same
            question as "are there tiles", and conflating the two put a hole in
            the one path this whole feature exists to create.
            It used to be `!hasTiles ? checklist : board`. Follow that from the
            empty state: Get started → Columns → `addViewAction` inserts the row
            and redirects onto it → `views.length` is 1 so the page is no longer
            empty → but a brand-new workspace still has no tiles, so `hasTiles`
            is false → the checklist rendered INSTEAD of the board, and the view
            just created had no tab strip, no `+`, no New group and nothing to
            put a metric into. A dead end reachable in two clicks.
            Custom escaped it by accident: `hasTiles` is true for a canvas
            whatever it holds, so that template landed correctly while the other
            did not — two templates behaving differently after creation, which is
            the tell that the condition was wrong rather than the copy.
            `emptyWorkspace` answers the real question, and the checklist becomes
            a supplement UNDER the board rather than a replacement for it. That
            is also the more honest arrangement: a workspace with a view and no
            metrics has furniture AND advice, not one pretending the other is
            not there. */}
        {/* A CALENDAR VIEW IS RENDERED OUTSIDE `TileArea`, ON PURPOSE.
            `TileArea` exists to swap the board for same-sized skeletons the
            instant a range pill is pressed. A calendar answers two fixed months
            from values already in this payload — "there is no spinner because
            there is nothing to wait for" — and the period pills do not apply to
            it at all (they are hidden above, with `PageHeader`'s track). Putting
            it inside would flash a three-up column of skeletons for a press that
            changes nothing on screen.
            The tab strip, the period control, "+ Add" and Refresh all are all
            `PageHeader`'s job now, above this branch rather than inside it — a
            branch that forgot any of them would still show all four, because
            none of them live down here any more. All this branch still owns is
            its own metric picker's slot, `#calendar-tools`. */}
        {!emptyWorkspace && activeKind === "calendar" ? (
          /**
           * NO `mt-4` HERE, AND THAT ABSENCE IS THE WHOLE POINT.
           *
           * `PageHeader` already ends in `pb-4` — the 16px step this row is
           * meant to sit at, and every page in the product gets it from there.
           * A margin here adds a SECOND one, so the title block and the tab
           * strip stand 32px apart and the top of the page reads as two
           * unrelated bands rather than one head.
           *
           * `board-layout.tsx` carries that same note, because it had this
           * exact bug and removed this exact class — and the calendar branch
           * reintroduced it, which is what made switching from a Columns tab to
           * a Calendar tab shift the whole row down. One owner for the
           * distance, and it is the header. The sheet below keeps its own
           * `mt-4`, which is this row's gap rather than the header's.
           */
          <div>
            {/* THE METRIC PICKER'S SLOT MOVED UP INTO THE HEADER, into the
                position "Compare To" holds on every other view — see the note
                there. There must be exactly ONE `#calendar-tools` in the
                document: `getElementById` answers with the first, so a second
                one here would be the portal's target and the picker would
                render back down on a row of its own. */}
            {calendarRowsFailed ? (
              <p className="mt-6 rounded-card border border-danger-soft bg-danger-soft/50 p-3 text-md text-danger-ink">
                This calendar couldn&rsquo;t be loaded. Nothing has been deleted and no number has changed — refresh to
                try again.
              </p>
            ) : (
              <CalendarBoard
                // A DIFFERENT VIEW IS A DIFFERENT CALENDAR: the board seeds its
                // selected metric once (so the twelve-second poll cannot yank it
                // mid-read), which means switching tabs has to remount it.
                key={activeView ?? "default"}
                metrics={calendarMetrics}
                months={calendarMonths()}
                // Decided on the SERVER: every value was filed under a UTC day,
                // so a browser working out "today" locally would ring the wrong
                // square for anyone east of Greenwich after midnight.
                todayKey={dayKey(new Date())}
                selectedId={calendarSelected}
                // The two slots above are this page's; the board fills them.
                hosted
                /* A SERVER ACTION, bound to this view — which is what crosses
                   the RSC boundary. A plain closure would fail the build, and
                   is why `/design` renders this component with the prop left
                   off entirely. Rank-gated like every other write on the board:
                   a viewer who may not arrange the dashboard gets a picker that
                   still switches locally but writes nothing. */
                onPick={access.can("create_flows") && activeView ? setCalendarMetricAction.bind(null, activeView) : undefined}
              />
            )}
          </div>
        ) : !emptyWorkspace ? (
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
                /**
                 * WHY THE ARRANGEMENT IS FROZEN FOR THIS VIEWER — computed on
                 * the server, because the client cannot see what was omitted.
                 *
                 * An omitted row is gone from this viewer's layout, so any drag
                 * lets `compact` reflow the survivors up into the hidden tile's
                 * space — and `setCustomTileLayoutAction` would write that,
                 * overlapping a tile for everyone who CAN see it. One viewer's
                 * permissions must not rearrange another's board.
                 */
                layoutFrozen={hiddenOnThisView > 0}
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
              tiles={boardTiles}
              groups={groups}
              placements={placements}
              canEdit={access.can("create_flows")}
            />
            )}
          </TileArea>
        ) : null}
        {/* The checklist is about BUILDING metrics, and a calendar view is a way
            of reading one — a workspace that has got as far as making a calendar
            has not got there without a metric. It also cannot render inside that
            branch's own layout without sitting under a month grid, which is the
            wrong place for onboarding advice. */}
        {!hasTiles && !loadError && activeKind !== "calendar" && (
          <OnboardingChecklist hasConnection={connCount > 0} hasFlow={flowCount > 0} hasPublished={flowTiles.length > 0} />
        )}
        </BoardControls>
        </>
        )}
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
    /**
     * THE SAME CARD AS EVERY OTHER TILE ON THIS BOARD — which it was not.
     *
     * This component's own comment used to claim it was "kept in step with
     * FlowTile's shape on purpose". It disagreed on four things at once: the
     * shell (`surface`, not the `tile` rung with its pointer response), the
     * padding, the title (16px sentence-case `text-foreground`, against the
     * micro-label voice every other tile uses), and the footer. A workspace
     * with one classic metric beside one flow metric showed two different
     * objects in one grid, with nothing to explain the difference — the reader
     * cannot see which storage a number came from, and should not be able to.
     *
     * Everything structural now comes from `MetricCard`, so the only things
     * left here are the ones genuinely particular to a `metrics` row: it has no
     * `computedAt` (it is computed live on this render, so a timestamp would be
     * furniture saying "now") and no freshness marker for the same reason.
     *
     * "DRILL IN" IS IN THE TILE MENU NOW, with the flow tile's own Refresh and
     * Open — the 6 Sep 2026 export's card has two rows and no footline to hang
     * an act from. Both kinds of tile are `BoardTile.node` inside the same
     * `TileCard`, so one menu serves both and the two stop differing on where
     * their acts live. See `board-tile-menu.tsx`.
     */
    <MetricCard
      title={metric.name}
      headline={
        tile.kind === "error" || total == null ? undefined : formatMetricValue(total, numberFormat)
      }
      /* The unit rides the headline slot rather than the name, because it
         belongs to the FIGURE — "1,204 leads" is one fact, and putting the noun
         up in the label row would make the number read as unitless. */
      delta={
        metric.unit && tile.kind !== "error" && total != null ? (
          <span className="text-sm font-normal text-muted-foreground">{metric.unit}</span>
        ) : null
      }
      qualifications={tile.kind === "error" ? <p className="mt-2 text-xs text-warn-ink">{tile.error}</p> : null}
    >
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
    </MetricCard>
  );
}
