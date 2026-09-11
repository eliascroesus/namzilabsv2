import { AppFrame } from "@/components/app-frame";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { BoardControls, RangeMenu, ViewStrip } from "@/app/dashboard/board-controls";
import { TopBarFreshness, TopBarTitle } from "@/components/topbar-slots";
import { Button } from "@/components/ui/button";
import { ChartLine, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { FlowTile, type FlowResultRow } from "@/components/flow-tile";
import { ChartFrame } from "@/components/board-charts/frame";
import { BarsVertical, LineChart } from "@/components/board-charts/cartesian";
import { accentOf } from "@/lib/board/tile-config";
import { customRangeKey, resolveRange } from "@/lib/metrics/range";
import { withDerivedRange } from "@/lib/metrics/derive-range";
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

/**
 * THE FOUR THE FRAME DRAWS, IN THE FRAME'S OWN ORDER.
 *
 * They were [Speed, Speed, Total, Total] at 30; node 0:5 draws
 * [Total 31, Speed, Speed, Total 31]. On a page whose whole job is to be
 * compared against that frame, a different order and a different headline is
 * the page lying about the thing it exists to check.
 */
const METRICS: FlowResultRow[] = [
  row("Total Leads (Arman)", 31, {
    tile: { name: "Total Leads (Arman)", viz: "number", format: "number", precision: 0, value: 31, byRange: pair(31, 20) },
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
  row("Total Leads (Arman)", 31, {
    tile: { name: "Total Leads (Arman)", viz: "number", format: "number", precision: 0, value: 31, byRange: pair(31, 20) },
  }),
];

/**
 * A COUNT TILE CARRYING A DAY MAP, so the DERIVE half of the custom-range path
 * can be seen on a public route with no database behind it.
 *
 * `withDerivedRange` sums the days a drawn window covers when the metric is a
 * count. This row proves that draws a real number and a day series — the half
 * the dashboard answers instantly. The COMPUTE half needs a real flow and a
 * session, so it is checked on the dashboard itself.
 */
const DERIVE_DAYS = 12;
const DERIVED_KEY = customRangeKey(
  new Date(HOUR_AGO.getTime() - (DERIVE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10),
  new Date(HOUR_AGO.getTime()).toISOString().slice(0, 10),
);
const DERIVED_ROW = withDerivedRange(
  row("Leads Claimed (Mohamed)", 15, {
    tile: {
      name: "Leads Claimed (Mohamed)",
      viz: "number",
      format: "number",
      precision: 0,
      value: 15,
      facts: { kind: "count", shape: "scalar" },
      byDay: Object.fromEntries(
        Array.from({ length: DERIVE_DAYS }, (_, i) => [
          new Date(HOUR_AGO.getTime() - (DERIVE_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10),
          { value: i + 1 },
        ]),
      ),
    },
  }),
  DERIVED_KEY,
);

/**
 * THE PREVIOUS WINDOW, for the two-series legend node 0:5 draws.
 *
 * The real board gets this from `byRange[key].compare`, which the materializer
 * builds out of buckets the calendar already measured. This page has no board
 * behind it, so it carries its own — same bucket COUNT as `SERIES`, because the
 * chart plots the comparison by index: the nth bucket of the previous window
 * under the nth of this one.
 */
const COMPARE = [
  { bucket: "Aug 19", value: 7 },
  { bucket: "Aug 20", value: 6 },
  { bucket: "Aug 21", value: 8 },
  { bucket: "Aug 22", value: 7 },
  { bucket: "Aug 23", value: 4 },
  { bucket: "Aug 24", value: 3 },
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

export default async function OverviewLab({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * THE HARNESS READS `?range=` TOO, so the picker's round trip can be SEEN
   * here: pick two days, the URL changes, the trigger re-reads it and prints
   * the dates. Without this the control would push a window and then go on
   * reading "Today", which is the one thing a public harness for it must not
   * do — it would hide exactly the bug it exists to catch.
   */
  const sp = await searchParams;
  const rangeParam = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  const activeRange = resolveRange(rangeParam || "today", HOUR_AGO).key;

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
        { key: "default", id: null, name: "Overview", href: "#", pos: "a1", kind: "groups" as const, isDefault: true },
        { key: "v2", id: "v2", name: "Group", href: "#", pos: "a2", kind: "groups" as const },
        { key: "v3", id: "v3", name: "Calendar", href: "#", pos: "a3", kind: "calendar" as const },
      ]}
      activeView={null}
      canEdit
      defaultHref="#"
    >
      {/* The "+" rides the strip as its last item rather than as a control
          appended to it — the frame draws it on the tabs' own gap. The
          dashboard's is `AddViewButton`, which owns a popover of templates;
          this is the same glyph without the machinery.
          `iconXs` RATHER THAN `icon`: a 32px square here is the tallest thing
          in a 43px band and stretches it to 49, which breaks the 149 the three
          bars have to sum to. Node 0:5 draws this glyph at 16 with no box. */}
      <Button variant="secondary" size="iconXs" aria-label="Add a view">
        <Plus />
      </Button>
    </ViewStrip>
  );

  return (
    /* THE PROVIDER WRAPS THE FRAME, exactly as the real board's does — the
       band is chrome now, so the tabs inside it render within `AppFrame` and
       need the context from above it. See `dashboard/page.tsx`. */
    <BoardControls>
    <AppFrame
      /* THE BAND IS CHROME, SO THE HARNESS HANDS IT OVER TOO.
         It was rendered inside `PageContainer` here, which matched the real
         board while the band escaped the page's padding with `-m-6`. The band
         moved out of the scroll region on 11 Sep 2026 — it was bouncing on
         fast scrolls and being narrowed by the scrollbar while the bar above
         it was not — so a harness still drawing it in the page would be
         pixel-correct against a frame the real dashboard no longer matches,
         which is the one failure this page exists to prevent. */
      band={
        <PageHeader
          band
          /* NO `title`: the name is on its own tab with the options menu
             beside it, which is the one place node 49:5399 draws it. */
          tabs={viewStrip}
          actions={
            <>
              {/* WHITE, NOT LIME, AND THAT REVERSES `cd621bf`.
                  That commit filled the two adds-something verbs with the
                  brand, on the 8 September frame's own reading. Node 0:5
                  draws all four of these controls identically — white, with
                  an #E1E1E1 rim — so "Add" loses its fill along with the
                  argument for it. The Figma is explicit and the owner asked
                  for 1:1. */}
              <Button variant="white">
                <Plus />
                Add
              </Button>
              <RangeMenu
                activeRange={activeRange}
                /* THIS ROUTE'S OWN PATH, not "#". `new URL("#", base)` has an
                   empty pathname, so applying a window would push the harness
                   to the site root and there would be nothing left to
                   screenshot. */
                href="/design/overview"
                now={HOUR_AGO}
              />
              {/* WHITE, WHICH IS THE LOUDEST THING IN THIS ROW AFTER THE
                  LIME — and it is drawn that way (node 49:5439). It reads
                  against "quiet chrome", and it is followed rather than
                  corrected: the Figma is explicit, twice, on two adjacent
                  controls. See DESIGN.md, which owns the tension. */}
              {/* COMPARE TO — DRAWN, AND NOT WIRED.
                  The frame draws it between the period and the refresh, and
                  the control is chrome, so it is built here at the frame's
                  geometry. What it would open is a comparison SERIES the
                  product does not compute — DESIGN.md records the two-series
                  legend as unbuilt — so it ships disabled with a title that
                  says so rather than as a menu that opens onto nothing. */}
              <Button variant="white" disabled title="Comparison periods are not built yet">
                <ChartLine />
                Compare To
                <ChevronDown />
              </Button>
              <Button variant="white">
                <RefreshCw />
                Refresh All
              </Button>
            </>
          }
        />
      }
      views={[
        { id: null, name: "Overview", pos: "a", kind: "groups", isDefault: true },
        { id: "v2", name: "Group", pos: "b", kind: "groups" },
        { id: "v3", name: "Calendar", pos: "c", kind: "calendar" },
      ]}
      workspace="Personal Workspace"
      /* The name beside the avatar, as node 58:5930 draws it. The real shell
         passes profile.displayName; this page is the only public place the
         full bar can be seen, so it has to carry one too. */
      surface="overflow-y-auto bg-panel"
      account={{ initials: "EL", panel: <p className="text-sm text-muted-foreground">elias@namzilabs.co</p> }}
    >
      <PageContainer width="full">
        {/* BAR TWO'S LEFT HALF — the frame draws "Overview" at 24/700 and
            "Updated just now" at 13/400, and both are slots the page fills.
            `new Date()` rather than HOUR_AGO on purpose: the tiles below are an
            hour stale by design (they prove a formatted "1 hr ago" fits beside
            a delta chip), but the BOARD was rendered now, and "Updated just
            now" is the string node 0:5 draws. */}
        <TopBarTitle range="Sat, 1 Sep - Sat, 1 Sep">Overview</TopBarTitle>
        <TopBarFreshness at={new Date()} />

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
              {/* A LEGEND, NOT A DELTA — and this page had it backwards.
                  It passed a `delta` on every chart card "as the one tile shape
                  most likely to carry one", which was a guess about the design
                  rather than a reading of it. Both 8 September frames draw a
                  chart card as title, freshness, figure, mark, LEGEND — no chip
                  anywhere on it — and put the chip on the stat tiles below
                  instead. The real tiles agree and always did: `custom-tile`
                  only derives a delta when `chart === "number"`, so this page
                  was the ONLY place a chart card ever carried one. */}
              <ChartFrame
                title={c.title}
                headline={c.headline}
                /* "fresh" DRAWS NOTHING NOW, and the harness keeps passing it
                   on purpose: this page exists to be compared against the
                   frame, and a card that renders a mark for a healthy tile
                   would be the drift it is here to catch. The legend that sat
                   beside it went on 11 Sep 2026 — see `frame.tsx`. */
                status="fresh"
              >
                {c.shape === "bar" ? (
                  <BarsVertical series={SERIES} format={FMT[c.shape]} accent={accentOf()} />
                ) : (
                  <LineChart
                    series={SERIES}
                    compare={COMPARE}
                    format={FMT[c.shape]}
                    accent={accentOf()}
                    area={c.shape === "area"}
                  />
                )}
              </ChartFrame>
            </div>
          ))}

          {METRICS.map((r, i) => (
            <div key={`metric-${i}`} style={{ gridColumn: "span 3", gridRow: "span 3" }}>
              <FlowTile row={r} rangeKey="today" />
            </div>
          ))}
          {/* THE DERIVED WINDOW, beside the presets: twelve days summed out of
              the tile's own stored days, with no database and no flow run. */}
          <div style={{ gridColumn: "span 3", gridRow: "span 3" }}>
            <FlowTile row={DERIVED_ROW} rangeKey={DERIVED_KEY} />
          </div>
        </div>
      </PageContainer>
    </AppFrame>
    </BoardControls>
  );
}
