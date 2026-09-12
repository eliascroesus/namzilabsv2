import { canvasCells, GRID_COLS, ROW_UNIT_PX, type GridBox } from "@/lib/board/grid";
import { defaultSize, type ChartId } from "@/lib/board/charts";
import { CustomTile, type ComposedPart, type CustomTileSource } from "@/components/custom-tile";
import { CanvasHarness, ComposedPanelSpecimen, PanelSpecimen } from "./harness";
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

/**
 * A COMPOSED TILE — a funnel or a pie assembled from OTHER published metrics.
 *
 * The anchor is this tile's own stored figure (stage 1, or the whole); the
 * parts ride on the source, resolved server-side from tiles the board already
 * holds. Both halves have to be set consistently or the specimen quietly
 * misrepresents the thing: `config.parts` is what the panel stores and what the
 * renderer counts, `source.parts` is what carries the numbers.
 *
 * These are the renderings this page exists for. A composed funnel cannot be
 * reached by hand without publishing three flows and configuring a tile, and
 * every refusal below needs a metric in a specific wrong state — which is
 * exactly how the four states above this shipped unrendered once already.
 */
const part = (
  label: string,
  value: number | null,
  over: Partial<ComposedPart> = {},
): ComposedPart => ({
  label,
  timeField: "created_at",
  format: { format: "number" },
  countable: true,
  additive: true,
  hasPeriods: true,
  byRange: { today: value },
  ...over,
});

const composed = (
  anchor: number,
  parts: ComposedPart[],
  over: Record<string, unknown> = {},
  /**
   * Outcomes for the strip under the mark. They ride the SOURCE, like parts and
   * for the same reason: `config.exits` is only the list of keys the author
   * stored, and it is `page.tsx` that turns those into figures. A specimen
   * setting only the config would draw an empty strip and photograph nothing.
   */
  exits: ComposedPart[] = [],
): Extract<CustomTileSource, { kind: "flow" }> => ({
  kind: "flow",
  status: "fresh",
  parts,
  exits: exits.length > 0 ? exits : undefined,
  tile: {
    name: "Total Leads",
    format: "number",
    precision: 0,
    timeField: "created_at",
    facts: { kind: "count", shape: "scalar", countable: true, additive: true },
    byRange: { today: { value: anchor } },
    ...over,
  },
});

/** `config.parts` only has to be the right LENGTH — the numbers ride on the source. */
const keys = (n: number) => ({ parts: Array.from({ length: n }, (_, i) => `flow:demo:p${i}`) });

const COMPOSED_CHARTS: Array<{ label: string; chart: ChartId; source: CustomTileSource; config: Record<string, unknown>; h: number }> = [
  {
    label: "Composed funnel",
    chart: "funnel",
    source: composed(420, [part("Booked Leads", 252), part("On Calendar", 96), part("Showed", 41)]),
    config: keys(3),
    h: 7,
  },
  {
    label: "Composed pipeline",
    chart: "pipeline",
    source: composed(420, [part("Booked Leads", 252), part("On Calendar", 96)]),
    config: keys(2),
    h: 7,
  },
  {
    /* LEFT TO RIGHT: names above their own section, conversions in the gaps.
       The arrangement the DOWN flow cannot offer without cutting the body. */
    label: "Pipeline, left to right",
    chart: "pipeline",
    source: composed(420, [part("Booked Leads", 252), part("On Calendar", 96), part("Showed", 41)]),
    config: { ...keys(3), flow: "across" },
    h: 6,
  },
  {
    /**
     * THE REFERENCE DESIGN, AS CLOSE AS THE ARITHMETIC ALLOWS — the owner's
     * 12 Sep screenshot: five stages running across, a header row of counts, a
     * conversion on each narrowing, and a strip of outcomes under the mark.
     *
     * ITS OWN NUMBERS, DELIBERATELY. 11412 -> 2952 is a 74% fall that the
     * reference draws as a gentle taper; drawn honestly it is a cliff, and this
     * specimen is where the difference between the two is visible rather than
     * argued about. `tests/funnel-ribbon.test.ts` pins the same pair.
     */
    label: "The reference funnel — five stages, outcomes beneath",
    chart: "pipeline",
    source: composed(
      11412,
      [part("In contact", 2952), part("Qualified", 780), part("Booked call", 210), part("Won", 64)],
      { name: "New" },
      [part("Unqualified", 3009), part("Deposit", 4), part("No show", 19)],
    ),
    config: { ...keys(4), flow: "across", exits: ["flow:demo:x0", "flow:demo:x1", "flow:demo:x2"] },
    h: 6,
  },
  {
    label: "The owner's tile, left to right",
    chart: "pipeline",
    source: composed(12, [part("Organic Leads", 39), part("Unclaimed Leads", 0), part("Ads Leads", 12)], {
      name: "On Calendar",
      timeField: "properties.start.dateTime",
    }),
    config: { ...keys(3), flow: "across" },
    h: 6,
  },
  {
    /**
     * THE OWNER'S OWN TILE, 11 Sep 2026 — the screenshot that forced the
     * geometry change, kept as a specimen so it can never quietly come back.
     *
     * 12 -> 38 -> 0 drew [100, 100, 4] under share-of-first: two pixel-identical
     * full-width slabs and a 4% stub floating in the middle of its row, clipped
     * by the bottom of the card. Under share-of-max it is [31.6, 100, 0] — stage
     * 1 is visibly the SHORT one, which is the truth, and the zero stage is an
     * empty frame the width of the stage it lost.
     */
    label: "The owner's tile — a composition that never narrows",
    chart: "pipeline",
    source: composed(12, [part("Organic Leads", 38), part("Unclaimed Leads", 0)], {
      name: "On Calendar",
      timeField: "properties.start.dateTime",
    }),
    config: keys(2),
    h: 7,
  },
  {
    /* The same data as a Funnel rather than a Pipeline — the two marks must not
       disagree about a width, which they did until both read `stageWidths`. */
    label: "The same data, drawn as a funnel",
    chart: "funnel",
    source: composed(12, [part("Organic Leads", 38), part("Unclaimed Leads", 0)], {
      name: "On Calendar",
      timeField: "properties.start.dateTime",
    }),
    config: keys(2),
    h: 7,
  },
  {
    /* A zero TAIL on an otherwise honest funnel: the last row draws no bar at
       all, and the empty frame running to stage 3's width is the drop. */
    label: "A funnel whose last stage is zero",
    chart: "pipeline",
    source: composed(420, [part("Booked Leads", 252), part("On Calendar", 96), part("Showed", 0)]),
    config: keys(3),
    h: 7,
  },
  {
    /* The stage that is BIGGER than the top — legal, disclosed, and its bar cut
       rather than clipped flush. The failure the clamp exists for. */
    label: "Composed funnel — a stage that widens",
    chart: "funnel",
    source: composed(100, [part("Booked Leads", 340), part("On Calendar", 60)]),
    config: keys(2),
    h: 7,
  },
  {
    label: "Composed pie — parts and the residual",
    chart: "pie",
    source: composed(420, [part("Ads Leads", 180), part("Organic Leads", 200)]),
    config: keys(2),
    h: 6,
  },
  {
    /* Parts that tile the whole exactly: no "Other" arc at all. */
    label: "Composed pie — parts that tile exactly",
    chart: "pie",
    source: composed(400, [part("Ads Leads", 180), part("Organic Leads", 220)]),
    config: keys(2),
    h: 6,
  },
  {
    label: "Unconfigured — the directive, not a dead end",
    chart: "funnel",
    source: composed(420, []),
    config: {},
    h: 6,
  },
  {
    label: "Refused — a stage that is a duration",
    chart: "funnel",
    source: composed(420, [
      part("Speed to Lead", 252, { countable: false, format: { format: "duration" } }),
    ]),
    config: keys(1),
    h: 6,
  },
  {
    label: "Refused — parts exceed the whole",
    chart: "pie",
    source: composed(100, [part("Ads Leads", 80), part("Organic Leads", 60)]),
    config: keys(2),
    h: 6,
  },
  {
    label: "Refused — a part is an average",
    chart: "pie",
    source: composed(8400, [part("SMB", 2200, { additive: false }), part("Enterprise", 3000)]),
    config: keys(2),
    h: 6,
  },
  {
    label: "Refused — a stage has no number",
    chart: "funnel",
    source: composed(420, [part("Booked Leads", null)]),
    config: keys(1),
    h: 6,
  },
  {
    label: "Refused — not recomputed since this shipped",
    chart: "funnel",
    source: composed(420, [part("Booked Leads", 252, { countable: undefined, additive: undefined })]),
    config: keys(1),
    h: 6,
  },
  {
    label: "Disclosed — stages dated differently",
    chart: "funnel",
    source: composed(420, [part("Booked Leads", 252, { timeField: "booked_at" })]),
    config: keys(1),
    h: 7,
  },
];

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
        <p className="mt-1 text-sm text-muted-foreground">
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
        <p className="mt-1 text-sm text-muted-foreground">
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

        {/* Furniture, at its own default size, so the proportions are the
            real ones — a heading is full width and two rows tall, a divider is
            full width and one. None of them wears a card. */}
        <SectionHeading className="mt-12">Blocks</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Tiles with no metric: a heading, a note and a rule. They drag and resize like any other tile and bind to
          nothing.
        </p>
        <div className="mt-4 space-y-2" {...{ "data-blocks": "" }}>
          {[
            { chart: "heading" as const, config: { text: "Acquisition" } },
            { chart: "text" as const, config: { text: "Counts a lead from the first reply, not the first send.\nExcludes anyone already in Close." } },
            { chart: "divider" as const, config: {} },
            { chart: "heading" as const, config: {} },
            { chart: "text" as const, config: {} },
          ].map(({ chart, config }, i) => (
            <div key={`${chart}-${i}`} style={{ height: `${defaultSize(chart).h * ROW_UNIT_PX}px` }}>
              <CustomTile chart={chart} title={chart} rangeKey="today" source={null} config={config} cols={12} />
            </div>
          ))}
        </div>

        {/* ── COMPOSED CHARTS ─────────────────────────────────────────────
            A funnel or a pie built from several published metrics rather than
            from one metric's own shape. Half of these are REFUSALS, and they
            are here for the same reason the states below are: each needs a
            metric in a specific wrong condition — a duration stage, parts that
            overrun their whole, a tile not yet restamped — and none of them can
            be produced by clicking around. */}
        <SectionHeading className="mt-12">Composed charts</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          The tile&rsquo;s own metric is stage 1 of a funnel and the whole of a pie; the rest are other published
          metrics. A composition that would mislead refuses and says which metric caused it.
        </p>
        <div className={`mt-4 ${BOARD_GRID}`} {...{ "data-composed": "" }}>
          {COMPOSED_CHARTS.map(({ label, chart, source, config, h }) => (
            <div key={label} style={{ height: `${h * ROW_UNIT_PX}px` }}>
              <CustomTile chart={chart} title={label} rangeKey="today" source={source} config={config} cols={4} />
            </div>
          ))}
        </div>

        <SectionHeading className="mt-12">Every state</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
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

        {/* A board a restricted viewer would get: the hidden row is not here,
            and because it is not here nothing may be rearranged — `compact`
            would float these up into its space and the write would overlap it
            for everyone who can see it. */}
        <SectionHeading className="mt-12">A view holding a chart you can&rsquo;t see</SectionHeading>
        <div {...{ "data-frozen-board": "" }}>
          <CanvasHarness
            layoutFrozen
            options={[]}
            tiles={TILES.slice(0, 3).map((t) => ({
              id: t.id,
              tileKey: `flow:demo:${t.id}`,
              x: t.x,
              y: t.y,
              w: t.w,
              h: t.h,
              chart: t.chart,
              charts: ["number", "bar", "category"],
              metricName: t.title,
              config: {},
              attention: 0 as const,
              data: t.source,
            }))}
          />
        </div>

        <SectionHeading className="mt-12">The tile settings panel</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Both tabs at once, because a screenshot can&rsquo;t click. On the dashboard this is one panel pinned to the
          right of the viewport, opened by clicking a tile — the swatches and switches here are live.
        </p>
        <div className="mt-4">
          <PanelSpecimen
            options={TILES.map((t) => ({ key: `flow:demo:${t.id}`, title: t.title, charts: ["number", "bar", "category"] }))}
          />
        </div>

        {/* THE COMPOSED DATA TAB, which the specimen above cannot show: it
            mounts a bar chart, and the stages editor only exists on a chart
            that composes. Every claim about this panel's resting HEIGHT — and
            the complaint that started the redesign, that the metric list pushes
            the stages below the fold — is a claim only a rendered panel can
            settle. `pnpm composed` measures this block. */}
        <SectionHeading className="mt-12">The settings panel, composing</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          A pipeline whose middle stage was unpublished, and a pie carried past its cap of five by a chart switch. Both
          are states the tile routes an author here to fix.
        </p>
        <div className="mt-4">
          <ComposedPanelSpecimen
            options={[
              { key: "flow:demo:t1", title: "Total Leads", charts: ["number", "pie", "funnel", "pipeline"] },
              { key: "flow:demo:t2", title: "Booked Leads", charts: ["number", "pie", "funnel", "pipeline"] },
              { key: "flow:demo:t3", title: "On Calendar", charts: ["number", "pie", "funnel", "pipeline"] },
              { key: "flow:demo:t4", title: "Ads Leads", charts: ["number", "pie", "funnel", "pipeline"] },
              { key: "flow:demo:t5", title: "Organic Leads", charts: ["number", "pie", "funnel", "pipeline"] },
              { key: "flow:demo:t6", title: "Unclaimed Leads", charts: ["number", "pie", "funnel", "pipeline"] },
              { key: "flow:demo:t7", title: "Showed", charts: ["number", "pie", "funnel", "pipeline"] },
            ]}
          />
        </div>

        <SectionHeading className="mt-12">The live board — drag a card, drag its corner</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          The real component with the server played by the harness: writes SUCCEED here, because the crash that shipped
          lived on the success path. The two buttons are another tab editing the same view.
        </p>
        <div {...{ "data-live-board": "" }}>
        <CanvasHarness
          /* The SAME key shape the tiles carry, or the panel's metric list has
             nothing to tick and the specimen quietly misrepresents it. */
          options={TILES.map((t) => ({
            key: `flow:demo:${t.id}`,
            title: t.title,
            charts: ["number", "bar", "category"],
          }))}
          tiles={TILES.map((t) => ({
            id: t.id,
            tileKey: `flow:demo:${t.id}`,
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
        </div>
      </PageContainer>
    </div>
  );
}
