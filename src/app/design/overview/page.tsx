import { AppFrame } from "@/components/app-frame";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { BoardControls, RangeMenu, ViewStrip, ViewTitle } from "@/app/dashboard/board-controls";
import { Button } from "@/components/ui/button";
import { RANGE_OPTIONS } from "@/lib/metrics/range";
import { Plus, RefreshCw } from "lucide-react";
import { FlowTile, type FlowResultRow } from "@/components/flow-tile";
import { ChartFrame } from "@/components/board-charts/frame";
import { BarsVertical, LineChart } from "@/components/board-charts/cartesian";
import { accentOf } from "@/lib/board/tile-config";
import { GRID_COLS, GRID_GAP_PX, ROW_UNIT_PX } from "@/lib/board/grid";

/**
 * THE OVERVIEW, WITH FAKE METRICS, ON A PUBLIC ROUTE.
 *
 * `/design/board` exists because three drag regressions shipped in a row and
 * none of them could be caught by reading source. This page exists for the
 * neighbouring reason: the screen the product is FOR — a row of chart cards
 * over a row of metric cards — sits behind WorkOS, so every judgement about
 * the two surfaces `DESIGN.md` lists as unsettled was being made from class
 * names against a PNG opened in another window.
 *
 * It is the `node-id=14:4` frame's own composition, in the real components,
 * at the real geometry: three chart cards spanning four of twelve columns at
 * ten rows (521.33 x 456 at a 1612px content width), then four metric cards
 * spanning three columns each (385 x 108). Those numbers are not typed in
 * anywhere below — they FALL OUT of `GRID_COLS`, `GRID_GAP_PX` and
 * `ROW_UNIT_PX`, which is the point: if the board's arithmetic drifts from
 * the export, this page stops matching it and a screenshot says so.
 *
 *   SHOT_SCHEME=dark SHOT_WIDTH=1920 pnpm shot /design/overview out.png 1200
 *
 * Reads no data and renders no customer rows, exactly like the rest of
 * `/design`.
 */
export const dynamic = "force-dynamic";

const HOUR_AGO = new Date(Date.now() - 3_600_000);

/** A materialized flow row, shaped as `FlowTile` reads it. */
const row = (name: string, value: number, opts: Partial<FlowResultRow> = {}): FlowResultRow => ({
  flowId: `f-${name.replace(/\W/g, "")}`,
  outputNodeId: "n1",
  tile: { name, viz: "number", format: "number", precision: 0, value },
  status: "fresh",
  error: null,
  computedAt: HOUR_AGO,
  ...opts,
});

/**
 * THE FOUR METRIC CARDS THE EXPORT DRAWS, including its own two duration
 * tiles — "0h 8m 39s" is the string that proves a formatted duration still
 * fits beside a delta chip at three columns, which a bare "31" does not.
 * `durationDisplay: "hours"` is what prints the leading "0h": every unit from
 * the chosen one down, which is the export's own reading.
 *
 * THE DELTA COMES FROM YESTERDAY, NOT FROM A SERIES, and that is the export's
 * composition rather than a shortcut. `deriveDelta` has two paths: a
 * today/yesterday pair, or the last two points of a `series`. The second one
 * also satisfies `drawsItsSeries`, so a tile carrying a series draws SPARKBARS
 * under its number — and the export's metric cards have no mark at all, only a
 * figure and a chip. Rendering them off `byRange` is what gives the two-row
 * 108px card this page exists to check.
 */
const pair = (today: number, yesterday: number) => ({
  today: { value: today },
  yesterday: { value: yesterday },
});

const METRICS: FlowResultRow[] = [
  row("Speed To Lead (Armaan)", 519, {
    tile: {
      name: "Speed To Lead (Armaan)",
      viz: "number",
      format: "duration",
      unit: "seconds",
      durationDisplay: "hours",
      value: 519,
      byRange: pair(519, 1038),
    },
  }),
  row("Speed To Lead (Armaan)", 519, {
    tile: {
      name: "Speed To Lead (Armaan)",
      viz: "number",
      format: "duration",
      unit: "seconds",
      durationDisplay: "hours",
      value: 519,
      byRange: pair(519, 1038),
    },
  }),
  row("Total Leads (Arman)", 30, {
    tile: { name: "Total Leads (Arman)", viz: "number", format: "number", precision: 0, value: 30, byRange: pair(30, 20) },
  }),
  row("Total Leads (Arman)", 30, {
    tile: { name: "Total Leads (Arman)", viz: "number", format: "number", precision: 0, value: 30, byRange: pair(30, 20) },
  }),
];

const SERIES = [
  { bucket: "Aug 26", value: 4 },
  { bucket: "Aug 27", value: 9 },
  { bucket: "Aug 28", value: 12 },
  { bucket: "Aug 29", value: 5 },
  { bucket: "Aug 30", value: 2 },
  { bucket: "Sep 1", value: 2 },
];

/** The three chart cards: a line, an area and a set of bars. */
const CHARTS = [
  { title: "Pickup Rate", headline: "28.2%", shape: "line" as const },
  { title: "Total Leads (Arman)", headline: "31", shape: "area" as const },
  { title: "Total Leads (Arman)", headline: "41", shape: "bar" as const },
];

/** The two axis vocabularies the export shows: one percentage, two counts. */
const FMT = {
  line: { format: "percent" as const, precision: 1 },
  area: { format: "number" as const, precision: 0 },
  bar: { format: "number" as const, precision: 0 },
};

export default function OverviewLab() {
  /**
   * `activeView={null}`, NOT `"default"` — `ViewTab` derives its key from
   * `viewId ?? ""`, so the default view's key is the empty string and only a
   * null `activeView` marks it. Passing the tab's own `key` here renders the
   * whole strip inactive: no rule, no weight, no kebab, which is exactly the
   * drift this page exists to catch — the real dashboard passes the view's id
   * and the harness was passing its label.
   */
  const viewStrip = (
    <ViewStrip
      views={[
        { key: "default", id: null, name: "Overview", href: "#", pos: "a1" },
        { key: "v2", id: "v2", name: "Group", href: "#", pos: "a2" },
        { key: "v3", id: "v3", name: "Calendar", href: "#", pos: "a3" },
      ]}
      activeView={null}
      canEdit
      defaultHref="#"
    >
      {/* The "+" rides the strip as its last item rather than as a control
          appended to it — the export draws it on the tabs' own 24px gap. The
          dashboard's is `AddViewButton`, which owns a popover of templates;
          this is the same rung and glyph without the machinery. */}
      <Button variant="secondary" size="icon" aria-label="Add a view">
        <Plus />
      </Button>
    </ViewStrip>
  );

  return (
    <AppFrame
      views={[
        { id: null, name: "Overview", pos: "a", kind: "groups", isDefault: true },
        { id: "v2", name: "Group", pos: "b", kind: "groups" },
        { id: "v3", name: "Calendar", pos: "c", kind: "calendar" },
      ]}
      workspace="Personal Workspace"
      surface="overflow-y-auto bg-panel"
      account={{ initials: "EL", panel: <p className="text-sm text-muted-foreground">elias@namzilabs.co</p> }}
    >
      <PageContainer width="full">
        <BoardControls>
          {/* THE THREE HEADER ACTIONS THE EXPORT DRAWS, in its order: "+ Add"
              (the brand's fill — one of exactly two adds-something verbs),
              the period dropdown reading "Today", then "Refresh all". The
              dashboard builds these from real state — `AddChartMenu` portals
              into a slot, `RefreshCw` submits a server action — so this page
              draws the same three controls at the same rungs rather than
              importing machinery that needs a board behind it. */}
          <PageHeader
            tabs={viewStrip}
            title={<ViewTitle viewId="v-demo" name="Overview" canEdit />}
            actions={
              <>
                <Button>
                  <Plus />
                  Add
                </Button>
                <RangeMenu
                  activeRange="today"
                  options={RANGE_OPTIONS.map((r) => ({ key: r.key, label: r.label, href: "#" }))}
                />
                <Button variant="secondary">
                  <RefreshCw />
                  Refresh all
                </Button>
              </>
            }
          />
        </BoardControls>

        {/* THE GRID, SPELLED THE WAY THE BOARD SPELLS IT — twelve columns and
            a 24px gutter, with `grid-auto-rows` at the row half of the pitch
            so a tile `h` rows tall measures `h * ROW_UNIT_PX - GRID_GAP_PX`.
            A chart at h=10 is 456px, which is the export's own card height;
            getting the pitch backwards inflates every tile by 24px a row and
            reads as a padding bug rather than an arithmetic one. */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
            gridAutoRows: `${ROW_UNIT_PX - GRID_GAP_PX}px`,
            gap: `${GRID_GAP_PX}px`,
          }}
        >
          {CHARTS.map((c, i) => (
            <div key={`chart-${i}`} style={{ gridColumn: "span 4", gridRow: "span 10" }}>
              <ChartFrame title={c.title} headline={c.headline} status="fresh" computedAt={HOUR_AGO}>
                {c.shape === "bar" ? (
                  <BarsVertical series={SERIES} format={FMT[c.shape]} accent={accentOf()} />
                ) : (
                  <LineChart series={SERIES} format={FMT[c.shape]} accent={accentOf()} area={c.shape === "area"} />
                )}
              </ChartFrame>
            </div>
          ))}

          {METRICS.map((r, i) => (
            <div key={`metric-${i}`} style={{ gridColumn: "span 3", gridRow: "span 3" }}>
              <FlowTile row={r} rangeKey="today" />
            </div>
          ))}
        </div>
      </PageContainer>
    </AppFrame>
  );
}
