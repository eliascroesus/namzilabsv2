import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { connections, flows } from "@/db/schema";
import { requireOrg, requestAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { EmptyBoard } from "@/components/board-empty";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageContainer, PageHeader, PERIOD_PILL, PERIOD_TRACK } from "@/components/ui/page";
import { Sparkbars, TargetBar } from "@/components/charts";
import { FreshnessPoller } from "@/components/freshness-poller";
import { SourceMark } from "@/components/source-mark";
import { FunnelView } from "@/components/funnel-view";
import { FlowTile, tileValueForRange, type FlowResultRow } from "@/components/flow-tile";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { BoardControls, RangeLink, SourceLink, TileArea, ViewTab, ViewTitle } from "./board-controls";
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
import { calendarFlowTiles, publishedFlowTiles, unpublishedFlowIds } from "@/lib/flow/materialize";
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
  connectedSources,
  type AggregateResult,
  type FunnelResult,
} from "@/lib/metrics/compute";
import { resolveRange, RANGE_OPTIONS } from "@/lib/metrics/range";
import { catalogEntry } from "@/connectors/catalog";
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
   * two hundred lines down, and `publishedFlowTiles` takes only `db` and
   * `orgId` yet queued behind every board read and the classic compute.
   *
   * Both now overlap the `Promise.all` below instead of preceding it. Rank
   * visibility still resolves once for the whole page — `effectiveAccess` is
   * `cache()`d, so AppShell shares this very promise and attaches its own
   * handler.
   */
  const accessP = requestAccess(orgId, userId, role);
  const flowRowsP = publishedFlowTiles(db, orgId).catch((e) => {
    console.error("[dashboard] published tiles read failed", e);
    return null;
  });

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
  const hasTiles = activeKind === "custom" || tiles.length > 0 || flowTiles.length > 0;

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
                 ring on the first tab has room without the row indenting. */
              <div className="-mx-1 flex flex-wrap items-center gap-6 px-1 py-1">
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
                  <AddViewButton rangeKey={rangeKey} source={boardSource} calendarOptions={calendarOptions} />
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
   * THE ACTION HALF OF THE TAB ROW — and the filter island is gone.
   *
   * There used to be a white bar above the board holding all three of these:
   * the period pills, the source picker and Refresh all. It was a sound object
   * on a white page and it is the wrong one now, for two reasons that arrived
   * together.
   *
   * ONE: the page has a HEADER again. The old bar existed partly because there
   * was nothing else at the top of this screen — the title had been deleted as
   * a duplicate of a sidebar row that said "Dashboard" beside it. That sidebar
   * is a 70px icon rail with no words on it, so the duplication it was deleted
   * for no longer exists, and the period control has somewhere better to be:
   * the header's right slot, where it reads as "this page, over this window".
   *
   * TWO: an island on a dark ground is a THIRD surface. The board is already
   * white cards on a dark page inside a dark band; a white bar between them is
   * one more panel for the eye to account for before it reaches a number.
   *
   * So the two controls that are not the period join the row that was already
   * there — the view tabs and New group — and the bar dissolves. The row's own
   * question is unchanged by the arrivals: the tabs and New group say how the
   * board is ARRANGED, and these two say what is ON it. Both are about this
   * board; the period is about the numbers inside it, and it stays upstairs.
   *
   * Rendered here, on the server, and handed to whichever board is mounted —
   * the same trick `viewStrip` uses, and for the same reason: the source rows
   * are real anchors and Refresh all is a plain form post, so neither needs the
   * client boundary the board itself is behind.
   */
  const boardActions = (
    <>
      {/* A <details> popover rather than a select: the source lives in the URL,
          so each option has to be a real link, and this page renders on the
          server with no client JS to submit a form. Collapsing the sources
          behind their own current value is also what stops the row growing
          every time a workspace connects another app. */}
      {/* NOT ON A CALENDAR VIEW, for the reason the period track is not either.
          The source filter narrows which EVENTS a number is computed from, and
          a calendar draws values that were already computed and stored — every
          square comes from the tile's `byDay`, which no filter on this page can
          reach. Pressing a source would have changed the URL, re-rendered the
          page and left all 31 squares exactly as they were.
          "Refresh all" stays: recomputing every flow is what fills these
          squares in, so it is the one control on this row that still acts. */}
      {sources.length > 0 && activeKind !== "calendar" && (
        <details className="group/src relative shrink-0">
          {/* PILL, not `rounded-control`. It sits between New group and Refresh
              all, both of which are `Button`s and therefore `rounded-full` from
              the kit's own base — a single rounded rectangle in a row of three
              pills reads as a control from a different set. h-9 is 36px, which
              is `size="sm"`: the same height as the buttons either side of it,
              stated here because a <summary> cannot be a Button. */}
          <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-xs transition-colors duration-(--duration-fast) hover:bg-muted [&::-webkit-details-marker]:hidden">
            {boardSource && <SourceMark source={boardSource} />}
            {activeSourceLabel}
            <ChevronDown size={14} className="text-muted-foreground transition-transform group-open/src:rotate-180" />
          </summary>
          {/* Right-aligned: the control sits near the row's right edge, so a
              left-anchored menu opened off the end of the page.
              PANEL then ROW, and nothing in between: `rounded-surface` +
              `shadow-surface` for the floating surface, `p-1.5` so a row's
              corner clears the panel's own, `rounded-control` on the rows.
              It is the shape the vendored menu, the Select and the Command
              palette all take — see `ui/dropdown-menu.tsx`, where the menu
              language is written down. */}
          <div className="absolute right-0 top-full z-20 mt-1.5 min-w-52 rounded-surface border border-border bg-card p-1.5 shadow-surface">
            <SourceLink
              href={qs({ source: "" })}
              className={cn(
                "block rounded-control px-2.5 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                /* THE ROW IN FORCE WEARS THE WASH, not coloured words on
                   nothing. `text-primary` is the brand yellow, which measures
                   1.55:1 as text on this white panel — it is a fill colour and
                   cannot be read as ink at all. What speaks is the marker, and
                   its ramp splits the same way: the 500 draws while the 700
                   (6.79:1) carries text. `accent`/`accent-foreground` is that
                   pair spelled as roles. */
                !boardSource ? "bg-accent font-semibold text-accent-foreground" : "text-foreground",
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
                  "flex items-center gap-2 rounded-control px-2.5 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  boardSource === srcName ? "bg-accent font-semibold text-accent-foreground" : "text-foreground",
                )}
              >
                <SourceMark source={srcName} />
                {catalogEntry(srcName)?.name ?? srcName}
              </SourceLink>
            ))}
          </div>
        </details>
      )}
      {/* Recompute every published metric.
          THE YELLOW IS SPENT HERE, and the reason is no longer scarcity. This
          file used to argue at length about how many yellows a screen may hold
          — that the colour belongs to "the single act the page exists for", and
          that a second one halves the value of the first. The kit retired that
          rule because nothing could check it. What replaced it is the
          fill/stroke split: yellow may only paint a FILLED object, and this is a
          filled control carrying near-black ink at 11.24:1, which is the only
          combination the brand is measured in. That is permission rather than
          instruction, so the reason it is THIS control and not its neighbours
          survives the change of rule: it is the one thing in the row that
          CHANGES anything rather than narrowing what is shown, and the two
          beside it stay white pills.
          `variant="accent"` IS that fill — `bg-primary` under
          `text-primary-foreground`. The `yellow` variant this used to name has
          been deleted: with a yellow primary the two resolved to the same
          object under two names.
          `px-5` is 20px, wider than `size="sm"`'s own 14px, because the button
          that acts is the one that is meant to be reached for. */}
      <form action={refreshAllFlowsAction} className="shrink-0">
        <SubmitButton
          variant="accent"
          size="sm"
          className="px-5"
          pendingLabel="Refreshing…"
          title="Recompute every published metric now"
        >
          Refresh all
        </SubmitButton>
      </form>
    </>
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

  /**
   * WHAT THE TOP BAR'S RING COUNTS, AND WHY IT COSTS NOTHING.
   *
   * Two arrays this page already holds: every published flow tile and every
   * classic metric, both of them already narrowed by `access` above, so the
   * ring can never count a metric its viewer is not allowed to see. No query is
   * added — the shell renders after this body's awaits (see its own note), so
   * anything counted THERE would be a fresh round trip on the critical path of
   * every render and every twelve-second poll.
   *
   * `metrics`, NOT `tiles`. They are the same list on a groups board and they
   * diverge on a custom view, where `classicsToCompute` narrows the compute to
   * the classics the canvas actually references. That is a statement about what
   * is expensive to draw, not about what the workspace HAS — reading `tiles`
   * here would make the ring drop when you switched to a custom view, as though
   * metrics had been deleted by opening a tab.
   *
   * UNDEFINED UNDER A LOAD ERROR. When either read above failed, these arrays
   * are short or empty for a reason that has nothing to do with the customer's
   * workspace, and "0/6" is then a false claim printed over the banner that
   * says the data could not be loaded. No answer is the honest answer, and the
   * bar knows how to draw that: no ring.
   */
  const metricCount = loadError ? undefined : metrics.length + flowTiles.length;

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email} metricCount={metricCount}>
      {/* G.4: refresh the server-rendered tiles when the org's results move. */}
      <FreshnessPoller />
      <PageContainer width="full">
        {/* ── NOTHING HERE YET ──────────────────────────────────────────────
            A whole page shape rather than the usual one with holes in it. The
            title, the period track, the tab strip and the action row all
            describe a board, and there is no board — so none of them render,
            and the only thing on screen is the invitation to make one.
            Most of that is free: `viewStrip` and `boardActions` are rendered
            INSIDE `BoardLayout`/`CustomBoard`, which live inside `TileArea`, so
            not taking that branch already removes the strip, the `+`, New group,
            All sources and Refresh all. `PageHeader` is the only chrome that
            survived the old empty path, and this is what removes it.
            `BoardControls` is skipped with it. It is a context provider that
            emits no DOM, and nothing here calls `useBoard()` — `RangeLink`,
            `SourceLink`, `ViewTab` and `TileArea` are its only consumers and
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
        <PageHeader
          title={
            /* KEYED BY THE ACTIVE VIEW, for the reason `BoardLayout` is: this
               holds the optimistic name until the refresh carrying the server's
               lands, and switching views without a remount would leave one
               view's typed name over another's board. */
            <ViewTitle
              key={activeView ?? "default"}
              viewId={activeView}
              name={viewTabs.find((v) => v.id === activeView)?.name ?? "Untitled"}
              canEdit={access.can("create_flows")}
            />
          }
          actions={
            /* A CALENDAR PUTS ITS OWN TIME CONTROL HERE INSTEAD.
               The period pills narrow WHICH NUMBERS a board shows; a calendar
               answers two fixed months — the only two the materializer stores —
               so six live pills would be the interface offering something it
               cannot do. But the SLOT is right: this is where every view says
               what span it is reading, and a calendar reads in months. The
               board fills this from the client (it owns which month is on
               screen); an empty div collapses to nothing if it never does. */
            activeKind === "calendar" ? (
              <div id="calendar-period" className="flex items-center gap-1.5" />
            ) : (
            /* ── THE PERIOD CONTROL ────────────────────────────────────────
               THE SAME SIX LINKS, ON THE OTHER SIDE OF THE PAGE. This is the
               range track that used to open the filter island — moved, not
               rebuilt, and still `RangeLink`s carrying real `href`s so
               middle-click, copy-link and a JavaScript-less viewer all keep
               working. What changed is where it sits and what it is made of.

               IT IS THE ONE CONTROL IN THE REDESIGN THAT FOLLOWS THE PAGE
               RATHER THAN THE CHROME. The rail and the top bar are near-black
               in both themes on purpose — that is the product's identity and it
               does not flip. This group sits on the GROUND, and a near-black
               pill group on a #f5f5f5 page would be a second dark object
               competing with the chrome for the eye. So `--period-bg` and
               `--period-line` answer differently under `.dark`, and the tokens'
               own notes in globals.css carry the ratios.

               THE SELECTED PILL IS THE BRAND FILL, where it used to be the
               near-black `--foreground`. Black was right when this track was one
               of two marks on a white bar and the app's selection colour was
               spent on the view tabs a row below. The tabs are an underline now
               — a rule is a stroke, so it is drawn in the marker — which leaves
               the FILL free for the thing that is genuinely a SELECTION: one of
               six mutually exclusive periods, a filled chip carrying near-black
               ink at 11.24:1. A near-black chip inside a near-black group in
               dark theme would have been invisible anyway.
               `bg-primary`/`text-primary-foreground` rather than a new pair of
               tokens: the brand IS `--primary`, and a second name for it is how
               a product ends up with two primaries.

               THE SCROLLER SURVIVES THE MOVE, and it has to. Six pills is a
               ~520px track that cannot wrap — they are `shrink-0`, correctly,
               or "Last 30 days" folds onto two lines inside its own pill — so
               at 390px it would push the whole page into horizontal scroll.
               The `-mx-1`/`px-1` pair is deliberate too: a bare
               `overflow-x-auto` clips its children's focus ring at both ends,
               so the first and last pill lose their outline exactly when a
               keyboard user reaches them. See `PageHeader`'s own note for why
               its right slot had to stop being `shrink-0` for this to work. */
            <div className="-mx-1 min-w-0 overflow-x-auto px-1">
              {/* The groove is `PERIOD_TRACK` now, imported rather than spelled:
                  the calendar's month stepper sits in the same slot and has to
                  be the same object, not a second one that looks like it. */}
              <div className={PERIOD_TRACK}>
                {RANGE_OPTIONS.map((r) => (
                  // The press lands NOW: the pill lights and the tiles become
                  // skeletons while this page re-renders, instead of a second
                  // of nothing over numbers that answer the old range.
                  <RangeLink
                    key={r.key}
                    href={qs({ range: r.key })}
                    rangeKey={r.key}
                    activeRange={rangeKey}
                    className={PERIOD_PILL}
                    activeClassName="bg-primary text-primary-foreground"
                    /* Hover reaches for `--ground-ink`, which is the page's own
                       ink at both exposures — white on the dark group, near-
                       black on the white one. `--foreground` would have been
                       wrong in exactly one theme, which is the kind of bug that
                       ships. */
                    idleClassName="text-muted-foreground hover:text-foreground"
                  >
                    {r.label}
                  </RangeLink>
                ))}
              </div>
            </div>
            )
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
            It still carries `viewStrip` and `boardActions`, because those are
            rendered by the BOARD components rather than by this page — a branch
            that forgot them would lose the tab strip and the `+`. */}
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
            {/* THE SAME ROW EVERY OTHER VIEW HAS: arrangement on the left,
                what-changes-the-board and the actions on the right. The metric
                picker lands in `#calendar-tools`, which is where a groups board
                puts "New group" and a canvas puts "+ Add" — the one control
                that changes what you are looking at. */}
            <div className="flex items-center justify-between gap-4">
              {viewStrip}
              <div className="flex items-center gap-2">
                <div id="calendar-tools" className="flex items-center gap-2" />
                {boardActions}
              </div>
            </div>
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
                viewStrip={viewStrip}
                boardActions={boardActions}
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
              boardActions={boardActions}
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
     * furniture saying "now"), no freshness marker for the same reason, and one
     * act rather than two.
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
      actions={
        tile.kind === "aggregate" ? (
          <Button asChild variant="ghost" size="xs" className="hover:text-accent-foreground">
            <Link href={`/dashboard/metrics/${metric.id}`}>Drill in</Link>
          </Button>
        ) : null
      }
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
