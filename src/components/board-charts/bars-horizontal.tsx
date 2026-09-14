import { formatMetricValue } from "@/lib/format";
import { niceTicks } from "@/lib/board/scale";
import { axisLabel } from "@/components/board-charts/cartesian";
import type { ChartFormat, GroupRow } from "@/components/charts";

/**
 * ONE BAR PER GROUP, RANKED, OVER A MEASURED AXIS — DELIBERATELY HTML, NOT SVG.
 *
 * This mark is a labelled list, and a list is what HTML is for: the labels
 * truncate with CSS, the values sit in a `tnum` column that lines up, and the
 * rows scroll. Rows SCROLL rather than shrink — thirty groups squeezed into six
 * rows of height is thirty unreadable slivers; thirty groups in a scroller is a
 * list you can read, inside a box you sized.
 *
 * ── WHAT CHANGED ON 13 SEP 2026 ────────────────────────────────────────────
 *
 * The owner asked for the ranked-bar form from D3's "hierarchical bar chart":
 * an axis across the top, bars ordered longest first, read by length against
 * real numbers. Not the DRILL-DOWN — our groups are `{label, value}` and there
 * is no hierarchy anywhere in the data to descend into, so a chart that
 * promised one would have been a chart with a disabled affordance. The look was
 * the ask, and the look is what a flat breakdown can honestly wear.
 *
 * It was a 6px pill on a grey track with no axis at all: a row of meters, where
 * the only readable quantity was the number printed beside each one and the ink
 * said nothing except "this one is longer". A bar wants a scale to be long
 * AGAINST.
 *
 * THE AXIS IS `niceTicks`, THE SAME ONE THE CARTESIAN MARKS USE, and it brackets
 * zero — a bar not anchored at zero lies about magnitude, which is the rule
 * `scale.ts` exists to keep. `axisLabel` is imported rather than reimplemented
 * so a DURATION breakdown reads "15m" here exactly as it does on a line chart;
 * writing a second formatter is how the two would have come to disagree.
 *
 * THE COLUMNS ARE FIXED WIDTHS and that is load-bearing rather than tidy. Every
 * row is its own grid, so the bar column can only line up with the axis above it
 * — and with the other rows — if the columns either side do not depend on their
 * own content. An `auto` value column would have made each row's bar start and
 * stop somewhere slightly different, which is a chart whose lengths cannot be
 * compared: the one thing a ranked bar chart is for.
 */

/**
 * BAR, THEN FIGURE — and the label moved INSIDE the bar on 14 Sep 2026, which
 * is what retired the third column.
 *
 * It was `5.5rem minmax(0,1fr) 3.5rem`: a fixed name column, then the plot,
 * then the value. The names were the reason it existed and 88px was never
 * enough for them — the old comment here argued they must WRAP rather than
 * truncate, because "Speed to Lead (Felix)" and "Speed to Lead (Rasmus)" both
 * become "Speed to Le…" in that width, on the chart whose entire job is telling
 * them apart. Wrapping solved the truncation and spent two lines of row height
 * on it.
 *
 * Inside the bar the name has the whole width of the plot to sit in, so it
 * neither truncates nor wraps in any realistic case, and the bars start at the
 * card's edge where they are longest and easiest to compare. The figure column
 * stays fixed for the reason it always was: an `auto` column would make each
 * row's bar start and stop somewhere slightly different, which is a chart whose
 * lengths cannot be compared.
 */
const COLUMNS = "minmax(0, 1fr) 3.5rem";
/** Three divisions — the count `cartesian.tsx` settled on, for the same reason. */
const TICK_COUNT = 3;

export function BarsHorizontal({
  groups,
  format,
  accent,
  sort = "value_desc",
  limit,
}: {
  groups: GroupRow[];
  format: ChartFormat;
  accent: string;
  /**
   * DEFAULTS TO RANKED SINCE 13 SEP 2026, where it used to default to the
   * materializer's own order. "Longest first" is what makes a bar chart
   * scannable, and it is what the owner asked for; an author who wants the
   * stored order still has `sort` in the tile's settings and it is still
   * honoured exactly.
   */
  sort?: "stored" | "value_desc" | "value_asc" | "label_asc" | "label_desc";
  limit?: number;
}) {
  const ordered =
    sort === "stored"
      ? groups
      : [...groups].sort((a, b) =>
          sort === "value_desc"
            ? b.value - a.value
            : sort === "value_asc"
              ? a.value - b.value
              : /**
                 * ONE COMPARISON, READ BACKWARDS FOR Z–A. `numeric` so "Hour 2"
                 * precedes "Hour 10", and `sensitivity: "base"` so case does not
                 * sort — without it every capitalised label stacks above every
                 * lower-case one, which reads as no order at all.
                 */
                (sort === "label_desc" ? -1 : 1) *
                a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }),
        );
  const shown = limit ? ordered.slice(0, limit) : ordered;
  /**
   * THE AXIS SPANS ZERO TO A ROUND NUMBER ABOVE THE LONGEST BAR, never to the
   * longest bar itself. Scaling to the max makes the top bar full width on every
   * chart ever drawn, so the mark says the same thing about 12 as about 12,000 —
   * `niceTicks` brackets the data with a step a reader can count in.
   */
  const { ticks, hi } = niceTicks(0, Math.max(...shown.map((g) => g.value), 0), TICK_COUNT);
  const width = (v: number) => (hi <= 0 ? 0 : Math.max((v / hi) * 100, 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {/* THE AXIS, OVER THE BAR COLUMN AND NOTHING ELSE. Its cells match the
          rows' template exactly, which is the whole reason a tick sits above the
          length it measures. */}
      <div className="grid shrink-0 items-end gap-2" style={{ gridTemplateColumns: COLUMNS }}>
        <span className="relative block h-3">
          {ticks.map((t) => (
            <span
              key={t}
              /* Anchored by its own edge at the ends and centred between them —
                 a centred "0" hangs off the left of the plot and the last label
                 hangs off the right, which is how an axis ends up wider than the
                 chart it belongs to. */
              className="tnum absolute whitespace-nowrap text-2xs leading-none text-muted-foreground"
              style={{
                left: `${width(t)}%`,
                transform: t === ticks[0] ? "none" : t === ticks.at(-1) ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {axisLabel(t, format, ticks)}
            </span>
          ))}
        </span>
        <span />
      </div>

      {/* THE PLOT — guides behind, rows in front, both on the same column
          template so a guide stands exactly where its tick says it does. */}
      <div className="relative min-h-0 flex-1">
        {/* THE TICK GUIDES, and they are what makes the axis do its job.
            `niceTicks` was added on 13 Sep so a bar could be read AGAINST a
            scale rather than against its neighbours — but the numbers sat alone
            at the top, so reading a bar's length still meant estimating across
            open space. One hairline per tick is the same ink `cartesian.tsx`
            spends on its horizontal grid, for the same reason.

            ZERO GETS NO LINE: every bar starts there, so the bars' own left
            edge already draws it and a second one would only thicken it. The
            last tick is pulled back by its own width so it lands INSIDE the
            plot rather than a pixel past its right edge. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid gap-2" style={{ gridTemplateColumns: COLUMNS }}>
          <span className="relative block">
            {ticks.slice(1).map((t) => (
              <span
                key={t}
                className="absolute inset-y-0 w-px bg-border"
                style={{ left: `${width(t)}%`, transform: t === ticks.at(-1) ? "translateX(-1px)" : "none" }}
              />
            ))}
          </span>
          <span />
        </div>

        {/* ROWS SHARE THE CARD'S HEIGHT rather than stacking at its top.
            Measured before this: a four-bar tile on a 240px card ended its ink
            at 117px and left 123px of white — 51% of the card — while the
            pipeline beside it ended at 263px of 280px and the area chart at
            203px of 240px. The mark was the only one on the board not filling
            its tile, which is what "it doesn't look like the others" was.

            `flex-1` with a MINIMUM is what keeps both halves true: few rows
            grow into the space, and thirty rows hold their floor and scroll —
            the rule this chart has had since it was written, since thirty
            slivers is not a list anybody can read. */}
        <div className="relative flex h-full flex-col gap-1.5 overflow-y-auto quiet-scroll">
          {shown.map((g) => (
            <div
              key={g.label}
              className="grid min-h-8 flex-1 items-stretch gap-2"
              style={{ gridTemplateColumns: COLUMNS }}
              data-tip={`${g.label} · ${formatMetricValue(g.value, format)}`}
            >
              {/* THE NAME RIDES ON THE BAR, and it is drawn TWICE to do it.
                  Both copies sit at the same x; the bar is opaque and paints
                  over the first, and the second is clipped to the bar's own
                  box. So a label shorter than its bar reads as dark ink ON the
                  colour, a label longer than its bar continues past the end in
                  the ordinary muted grey, and one that straddles the edge
                  changes colour exactly where the bar stops.

                  WHY NOT MEASURE AND PICK ONE. Whether a name fits inside its
                  bar depends on the text, the font and the tile's width, none
                  of which the server knows and all of which change when the
                  board is resized. Every version of that is a measurement that
                  can be wrong for a frame; this is right at every width without
                  asking anything.

                  THE INK IS `primary-foreground`, WHICH IS DARK IN BOTH THEMES
                  — deliberately, and the palette says why in as many words:
                  #568CFF is "3.18:1 on white — a line, not text", while #1f1f1f
                  on it is 5.18:1. White-on-brand would have been the obvious
                  copy of the reference and would have failed to read. Every
                  accent in `GROUP_ACCENT` is a mid-tone for the same reason, so
                  the one dark ink serves all twelve. */}
              <span className="relative flex h-full items-center py-1">
                {/* THIS is the copy a screen reader reads: it spans the whole
                    plot and is never clipped by anything but the card. The one
                    inside the bar is the decoration — it is cut off by design
                    whenever the bar is shorter than the name, and marking THAT
                    one as the accessible text would hand assistive tech
                    "Speed to Lea" and nothing else. */}
                <span className="pointer-events-none absolute inset-x-3 truncate text-xs text-muted-foreground">
                  {g.label}
                </span>
                {/* THE TRACK IS THE FULL SCALE, so an empty stretch to the right
                    of a short bar is the distance to the axis top rather than
                    dead space. No grey fill behind it: the row's own baseline is
                    the measure, and a track that paints itself competes with the
                    bars for the ink.

                    `relative` so it paints ABOVE the label behind it — two
                    positioned siblings, and the later one wins. THE BAR THICKENS
                    WITH THE ROW between a floor and a ceiling: `min-h-6` is the
                    24px a 13px name needs to sit in, and `max-h-8` stops a
                    two-bar tile becoming two slabs. */}
                <span
                  className="relative block h-full min-h-6 max-h-8 overflow-hidden rounded-md"
                  style={{ width: `${width(g.value)}%`, background: accent }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-3 flex items-center whitespace-nowrap text-xs text-primary-foreground"
                  >
                    {g.label}
                  </span>
                </span>
              </span>
              <span
                className="stat-numeral self-center truncate text-right text-xs text-heading"
                title={formatMetricValue(g.value, format)}
              >
                {formatMetricValue(g.value, format)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** What a limited list owes the reader — the sentence `GroupBars` already writes. */
export function groupsFooter(groups: GroupRow[], limit?: number, total?: number | null): string | null {
  if (!limit || groups.length <= limit) return null;
  return `Top ${limit} of ${groups.length}${total != null ? " — the number above counts them all" : ""}.`;
}
