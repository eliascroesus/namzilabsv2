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

/** Label, bar, figure. Fixed either side so every bar shares one scale. */
const COLUMNS = "5.5rem minmax(0, 1fr) 3.5rem";
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
  sort?: "stored" | "value_desc" | "value_asc" | "label_asc";
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
              : a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }),
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
        <span />
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

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto quiet-scroll">
        {shown.map((g) => (
          <div
            key={g.label}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: COLUMNS }}
            data-tip={`${g.label} · ${formatMetricValue(g.value, format)}`}
          >
            {/* WRAPS RATHER THAN TRUNCATING, and on this chart that is not a
                nicety. Composed ranked bars are named by their METRICS, and
                "Speed to Lead (Felix)" beside "Speed to Lead (Rasmus)" both
                truncate to "Speed to Le…" in a 5.5rem column — two bars a reader
                can no longer tell apart, on the chart whose entire job is telling
                them apart. The row grows a line instead; the grid keeps the bars
                aligned either way. */}
            <span className="text-xs text-muted-foreground [overflow-wrap:break-word]" title={g.label}>
              {g.label}
            </span>
            {/* THE TRACK IS THE FULL SCALE, so an empty stretch to the right of a
                short bar is the distance to the axis top rather than dead space.
                No grey fill behind it: the row's own baseline is the measure, and
                a track that paints itself competes with the bars for the ink. */}
            <span className="block h-4">
              <span
                className="block h-full rounded-xs"
                style={{ width: `${width(g.value)}%`, background: accent }}
              />
            </span>
            <span
              className="stat-numeral truncate text-right text-xs text-heading"
              title={formatMetricValue(g.value, format)}
            >
              {formatMetricValue(g.value, format)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What a limited list owes the reader — the sentence `GroupBars` already writes. */
export function groupsFooter(groups: GroupRow[], limit?: number, total?: number | null): string | null {
  if (!limit || groups.length <= limit) return null;
  return `Top ${limit} of ${groups.length}${total != null ? " — the number above counts them all" : ""}.`;
}
