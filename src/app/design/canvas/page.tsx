import { canvasCells, GRID_COLS, ROW_UNIT_PX, type GridBox } from "@/lib/board/grid";
import { defaultSize, type ChartId } from "@/lib/board/charts";
import { CustomTile, type CustomTileSource } from "@/components/custom-tile";
import { CanvasHarness } from "./harness";
import { PageContainer, SectionHeading } from "@/components/ui/page";

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
const rich = (over: Record<string, unknown> = {}): CustomTileSource => ({
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
              <CustomTile chart={tile.chart} title={tile.title} rangeKey="today" source={tile.source} rows={tile.h} />
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
            title: t.title,
            node: <CustomTile chart={t.chart} title={t.title} rangeKey="today" source={t.source} rows={t.h} />,
          }))}
        />
      </PageContainer>
    </div>
  );
}
