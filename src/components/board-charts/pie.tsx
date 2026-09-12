import { formatMetricValue } from "@/lib/format";
import { arcPath, pieSlices } from "@/lib/board/scale";
import { sliceAccent } from "@/lib/board/tile-config";
import type { ChartFormat, GroupRow } from "@/components/charts";

/**
 * SHARES OF A WHOLE — the one aspect-locked mark in the kit.
 *
 * Every other chart stretches to its box: a line squeezed vertically is still
 * that line, read against its own axis. A squeezed CIRCLE is an ellipse, and
 * an ellipse encodes angle dishonestly — the same 25% looks larger at the
 * equator than at the pole. So this one keeps `xMidYMid meet` and letterboxes,
 * which is the correct trade for the one shape whose geometry IS the claim.
 *
 * NO TEXT IN THE SVG. The legend is HTML beside or beneath the circle, which
 * is also what lets a long group name truncate rather than overflow the box.
 *
 * COLOUR IS NEVER THE ONLY ENCODING: every slice carries a 2px card-coloured
 * gap and a legend row with its own name and figure, so the chart survives
 * being read by someone who cannot separate two of the hues.
 */
export function PieChart({
  groups,
  format,
  donut = false,
  limit = 6,
  legend = "right",
}: {
  groups: GroupRow[];
  format: ChartFormat;
  donut?: boolean;
  limit?: number;
  legend?: "right" | "bottom" | "none";
}) {
  const { slices, total } = pieSlices(groups, limit);
  if (slices.length === 0) return null;

  const pct = (share: number) => formatMetricValue(share * 100, { format: "percent", precision: 0 });

  return (
    <div className={`flex min-h-0 flex-1 gap-3 ${legend === "bottom" ? "flex-col" : "items-center"}`}>
      {/**
       * `flex-1`, NOT `h-full`, WHEN THE LEGEND IS BENEATH — and this was eating
       * the legend whole.
       *
       * `h-full` inside a flex COLUMN means 100% of the container, so the circle
       * claimed the entire card and the legend — a `flex-1` sibling — was left
       * with nothing. Measured on a six-row tile: svg 126px, legend 0px, its own
       * `overflow-y-auto` quietly scrolling three rows of text nobody could see.
       * Every share on the card was in the DOM and none of it was on screen,
       * which is why no source check and no screenshot review caught it.
       *
       * `min-h-0 flex-1` makes the two share instead: the circle takes what is
       * left after the legend has asked for its rows, and `xMidYMid meet` keeps
       * it round in whatever that turns out to be. Beside the legend (`right`)
       * `h-full` is still correct — there the two are in a ROW and the height is
       * not being divided.
       */}
      <svg
        className={legend === "bottom" ? "min-h-0 w-full flex-1" : "h-full w-auto shrink-0"}
        viewBox="-52 -52 104 104"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {slices.map((s, i) => (
          <path
            key={s.label}
            d={arcPath(50, s.a0, s.a1)}
            fill={sliceAccent(i, s.label)}
            /* The gap is a second encoding, not decoration — it keeps two
               adjacent hues separable for a reader who cannot tell them apart. */
            stroke="var(--color-card)"
            strokeWidth="2"
            data-tip={`${s.label} · ${formatMetricValue(s.value, format)} (${pct(s.share)})`}
          />
        ))}
        {donut && <circle r="24" fill="var(--color-card)" />}
      </svg>
      {/**
       * THE DONUT'S HOLE STAYS EMPTY, and that was a decision rather than an
       * oversight. Putting the total in it is the obvious move and it was built,
       * photographed and removed: every tile that draws a pie already prints
       * that same figure as its HEADLINE, two lines above the circle, so the
       * centre restated a number the eye had just read. A five-figure total also
       * has to be truncated to clear a hole that is 48% of the mark's diameter,
       * which means the redundant copy is the one at risk of being the unreadable
       * one.
       */}

      {/* BENEATH the circle the legend asks for its own rows and the circle takes
          what is left (`shrink-0`, capped so a nine-slice legend cannot swallow
          the mark it describes); BESIDE it, the two are in a row and `flex-1` is
          what makes a long label truncate rather than push the circle off the
          card.

          THIS NOTE SITS ABOVE THE BRANCH because a branch is a single EXPRESSION
          and a JSX comment is a CHILD — one inside `&&` is a syntax error, not a
          comment. `custom-board.tsx` has the same note over its own ternary. */}
      {legend !== "none" && (
        <div
          className={`min-w-0 space-y-1 overflow-y-auto quiet-scroll ${
            legend === "bottom" ? "max-h-[55%] shrink-0" : "min-h-0 flex-1"
          }`}
        >
          {slices.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: sliceAccent(i, s.label) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={s.label}>
                {s.label}
              </span>
              {/* THE FIGURE IS THE LOUD THING IN THE ROW, matching the funnel's
                  header counts. It sat at the same weight as its own label, so a
                  legend read as four columns of equal text and the reader had to
                  find the numbers before comparing them. */}
              <span className="tnum shrink-0 text-xs font-semibold text-foreground">
                {formatMetricValue(s.value, format)}
              </span>
              <span className="tnum w-8 shrink-0 text-right text-xs text-muted-foreground">{pct(s.share)}</span>
            </div>
          ))}
        </div>
      )}
      <span className="sr-only">
        {slices.map((s) => `${s.label}: ${formatMetricValue(s.value, format)} (${pct(s.share)})`).join(", ")}. Total{" "}
        {formatMetricValue(total, format)}.
      </span>
    </div>
  );
}

/** What a pie owes the reader when it could not draw everything it was given. */
export function pieFooter(groups: GroupRow[], limit = 6): string | null {
  const { other, excluded } = pieSlices(groups, limit);
  const parts: string[] = [];
  if (other) parts.push(`${other.count} smaller groups rolled into Other`);
  // Never silent: a share of a whole cannot be negative, and a pie that
  // quietly ate a refund column is a chart lying by omission.
  if (excluded > 0) parts.push(`${excluded} at or below zero can’t be drawn as a share`);
  return parts.length ? `${parts.join(" · ")}.` : null;
}
