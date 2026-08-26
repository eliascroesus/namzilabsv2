import { canvasCells, GRID_COLS, ROW_UNIT_PX, type GridBox } from "@/lib/board/grid";
import { defaultSize, type ChartId } from "@/lib/board/charts";
import { CustomTile, type CustomTileSource } from "@/components/custom-tile";
import { CanvasHarness } from "./harness";
import { BOARD_GRID, PageContainer, SectionHeading } from "@/components/ui/page";

/**
 * THE CUSTOM VIEW'S GRID, DRIVABLE WITHOUT AUTHENTICATION.
 *
 * The dashboard sits behind WorkOS, so no screenshot and no browser harness can
 * reach it — which is exactly how three drag regressions shipped in a row on the
 * groups board, each one invisible to a suite that read source and asserted what
 * it said. `/design/board` ended that cycle by mounting the real component with
 * fake data; this is the same move for the canvas, and it exists BEFORE the
 * gestures rather than after them, so there is somewhere to point a harness at
 * the moment there is something to drag.
 *
 * The geometry here is real: `canvasCells` is the function the dashboard calls,
 * and the CSS is the same two classes. Only the cards are fake.
 */
/**
 * DYNAMIC, not static: this mounts the REAL `CustomBoard`, which imports the
 * board's server actions, and a statically rendered page cannot carry those.
 *
 * The writes will fail here — there is no session — and that is useful rather
 * than a limitation: it is the only place the optimistic revert and its toast
 * can be watched happening. What is being verified is the GESTURE, which is
 * entirely client-side: the preview, the packing, and the teardown.
 */
export const dynamic = "force-dynamic";

type Specimen = GridBox & { chart: ChartId; title: string; source: CustomTileSource | null };

/**
 * Fake tiles in the SHAPE the materializer really stores, so the renderer is
 * exercised rather than mimicked — `byRange` per period, presentation fields at
 * the top level, and one metric that answers three ways.
 */
const rich = (over: Record<string, unknown> = {}): Extract<CustomTileSource, { kind: "flow" }> => ({
  kind: "flow",
  status: "fresh",
  tile: {
    format: "number",
    precision: 0,
    byRange: {
      today: {
        value: 12,
        series: [
          { bucket: "2026-08-22", value: 3 },
          { bucket: "2026-08-23", value: 6 },
          { bucket: "2026-08-24", value: 4 },
          { bucket: "2026-08-25", value: 9 },
          { bucket: "2026-08-26", value: 12 },
        ],
        groups: [
          { label: "Afeef", value: 7 },
          { label: "Armaan", value: 5 },
        ],
      },
      yesterday: { value: 8 },
    },
    ...over,
  },
});

/** A classic funnel result — the only shape `funnel` and `pipeline` can draw. */
const FUNNEL: CustomTileSource = {
  kind: "classic",
  target: null,
  result: {
    stages: [
      { label: "SMS sent", count: 420, conversionFromFirst: 1, conversionFromPrev: 1 },
      { label: "Replied", count: 180, conversionFromFirst: 0.43, conversionFromPrev: 0.43 },
      { label: "Booked", count: 96, conversionFromFirst: 0.23, conversionFromPrev: 0.53 },
      { label: "Showed", count: 41, conversionFromFirst: 0.1, conversionFromPrev: 0.43 },
    ],
    bottleneckIndex: 1,
  },
};

const GALLERY_CHARTS = [
  { id: "number" as const, label: "Single number", source: rich(), config: { showDelta: true }, h: 4 },
  { id: "number" as const, label: "Number + sparkline", source: rich(), config: { showSpark: true }, h: 5 },
  { id: "line" as const, label: "Line", source: rich(), config: {}, h: 6 },
  { id: "area" as const, label: "Area", source: rich(), config: { color: "teal" }, h: 6 },
  { id: "bar" as const, label: "Bar", source: rich(), config: { showLabels: true }, h: 6 },
  { id: "category" as const, label: "Breakdown", source: rich(), config: { color: "indigo" }, h: 6 },
  { id: "pie" as const, label: "Pie", source: rich(), config: {}, h: 6 },
  { id: "pie" as const, label: "Donut", source: rich(), config: { donut: true, legend: "bottom" as const }, h: 6 },
  { id: "progress" as const, label: "Progress to goal", source: rich({ target: 20 }), config: {}, h: 4 },
  { id: "funnel" as const, label: "Funnel", source: FUNNEL, config: {}, h: 7 },
  { id: "pipeline" as const, label: "Pipeline", source: FUNNEL, config: {}, h: 7 },
  { id: "table" as const, label: "Table", source: rich(), config: {}, h: 6 },
];

const GALLERY_STATES: Array<{ label: string; chart: ChartId; source: CustomTileSource | null }> = [
  { label: "Fine", chart: "bar", source: rich() },
  { label: "Stale — a refresh is on its way", chart: "bar", source: { ...rich(), status: "stale" } },
  {
    label: "Can't answer this period",
    chart: "bar",
    source: {
      kind: "flow",
      status: "fresh",
      tile: { format: "number", precision: 0, byRange: { today: { unavailable: "Division by zero — check the second number." } } },
    },
  },
  {
    /**
     * A QUIET PERIOD, not an illegal chart — and the difference is the whole
     * reason both cards are here. `shapeOfTile` reads across every range slot,
     * so this metric HAS a trend (yesterday's) and today simply has none of it.
     * Drop the yesterday series and this card silently becomes the "can't be
     * drawn that way" one below, which is exactly the confusion the two
     * separate sentences exist to prevent.
     */
    label: "Nothing in this period",
    chart: "bar",
    source: {
      kind: "flow",
      status: "fresh",
      tile: {
        format: "number",
        precision: 0,
        byRange: { today: { value: 0 }, yesterday: { value: 8, series: [{ bucket: "2026-08-24", value: 8 }] } },
      },
    },
  },
  {
    label: "The run failed",
    chart: "number",
    source: {
      kind: "flow",
      status: "error",
      flowId: "demo",
      error: "Close refused the connection — the API key may have been rotated.",
      tile: { format: "number", precision: 0, byRange: {} },
    },
  },
  { label: "Edited since publishing", chart: "number", source: { ...rich(), unpublished: true, flowId: "demo" } },
  {
    label: "Still importing",
    chart: "number",
    source: { ...rich(), importing: { coveredMs: 12 * 86_400_000, targetMs: 90 * 86_400_000 } },
  },
  {
    label: "Some records carry no date",
    chart: "number",
    source: {
      kind: "flow",
      status: "fresh",
      tile: { format: "number", precision: 0, byRange: { today: { value: 12, undated: 3 } } },
    },
  },
  { label: "The metric is gone", chart: "number", source: null },
  {
    label: "This metric can't be drawn that way",
    chart: "category",
    source: { kind: "flow", status: "fresh", tile: { format: "number", precision: 0, byRange: { today: { value: 5 } } } },
  },
];

/**
 * Deliberately AWKWARD. A row of quarter-width tiles, a wide chart beside a tall
 * one, and a full-width strip — the arrangement that catches a packer which
 * cannot fit a short tile beside a tall one, and the widths that do not halve
 * cleanly into six columns.
 */
const TILES: Specimen[] = [
  { id: "t1", title: "Booked Leads", chart: "number", source: rich(), x: 0, y: 0, ...defaultSize("number") },
  { id: "t2", title: "Total Leads", chart: "number", source: rich(), x: 3, y: 0, ...defaultSize("number") },
  { id: "t3", title: "On Calendar", chart: "bar", source: rich(), x: 6, y: 0, ...defaultSize("bar") },
  { id: "t4", title: "Pickup Rate", chart: "progress", source: rich({ target: 20 }), x: 0, y: 4, ...defaultSize("progress") },
  { id: "t5", title: "Claimed by rep", chart: "category", source: rich(), x: 3, y: 4, ...defaultSize("category") },
  // The dead tile — the state that keeps its box and says the metric is gone.
  { id: "t6", title: "Revenue (deleted flow)", chart: "number", source: null, x: 7, y: 4, ...defaultSize("number") },
  // The same metric as t3, drawn a second way. The whole point of the table.
  { id: "t7", title: "Booked Leads, by rep", chart: "category", source: rich(), x: 0, y: 10, w: 12, h: 6 },
];

export default function CanvasSpecimen() {
  const cells = canvasCells(TILES);
  return (
    <div className="min-h-screen bg-canvas-bg py-10">
      <PageContainer>
        <SectionHeading>Custom view canvas</SectionHeading>
        <p className="mt-1 text-small text-muted-foreground">
          {GRID_COLS} columns at desktop, 6 at tablet, 1 on a phone — one stored layout, three renderings. A row unit is{" "}
          {ROW_UNIT_PX}px including its gutter. Narrow the window to watch it reflow.
        </p>

        <div className="board-canvas mt-6">
          {cells.map(({ tile, vars }) => (
            <div key={tile.id} className="board-cell" style={vars as React.CSSProperties}>
              <CustomTile chart={tile.chart} title={tile.title} rangeKey="today" source={tile.source} cols={tile.w} />
            </div>
          ))}
        </div>

        {/* ── THE GALLERY ─────────────────────────────────────────────────
            EVERY CHART × EVERY STATE, on one screen, because these are the
            renderings nobody can reach by hand. "Can't answer" needs a metric
            whose range failed; "importing" needs a backfill mid-flight;
            "unpublished" needs a flow edited since publishing. Waiting for
            production to produce each one is how three of them shipped
            unrendered on the canvas while the groups board drew them fine. */}
        <SectionHeading className="mt-12">Every chart</SectionHeading>
        <p className="mt-1 text-small text-muted-foreground">
          The same metric — a value, a five-bucket trend, a two-group breakdown — drawn every way the kit allows.
        </p>
        <div className={`mt-4 ${BOARD_GRID}`}>
          {/* Keyed on the LABEL, not the chart id: `number` and `pie` each
              appear twice here, once per variant. */}
          {GALLERY_CHARTS.map(({ id, label, source, config, h }) => (
            <div key={label} style={{ height: `${h * ROW_UNIT_PX}px` }}>
              <CustomTile chart={id} title={label} rangeKey="today" source={source} config={config} cols={4} />
            </div>
          ))}
        </div>

        <SectionHeading className="mt-12">Every state</SectionHeading>
        <p className="mt-1 text-small text-muted-foreground">
          One chart, every way it can fail to be a plain number. A state that replaces the mark and a state that
          qualifies it are different promises — these are both.
        </p>
        <div className={`mt-4 ${BOARD_GRID}`}>
          {GALLERY_STATES.map(({ label, chart, source }) => (
            <div key={label} style={{ height: `${6 * ROW_UNIT_PX}px` }}>
              <CustomTile chart={chart} title={label} rangeKey="today" source={source} cols={4} />
            </div>
          ))}
        </div>

        <SectionHeading className="mt-12">The live board — drag a card, drag its corner</SectionHeading>
        <p className="mt-1 text-small text-muted-foreground">
          The real component with the server played by the harness: writes SUCCEED here, because the crash that shipped
          lived on the success path. The two buttons are another tab editing the same view.
        </p>
        <CanvasHarness
          options={TILES.map((t) => ({ key: t.id, title: t.title, charts: ["number", "bar", "category"] }))}
          tiles={TILES.map((t) => ({
            id: t.id,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            chart: t.chart,
            charts: ["number", "bar", "category"],
            metricName: t.title,
            config: {},
            attention: 0 as const,
            // DATA, not markup — the tile renders client-side now, which is
            // the whole rendering-model change this page exists to exercise.
            data: t.source,
          }))}
        />
      </PageContainer>
    </div>
  );
}
