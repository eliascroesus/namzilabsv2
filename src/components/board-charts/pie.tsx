import { formatMetricValue } from "@/lib/format";
import { arcPath, pieSlices, type PieSlice } from "@/lib/board/scale";
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
 * NO TEXT IN THE SVG. Every label is HTML, which is what lets a long group name
 * wrap or truncate rather than run out across the arcs — SVG text can do
 * neither.
 *
 * COLOUR IS NEVER THE ONLY ENCODING: every slice carries a 2px card-coloured
 * gap and a label of its own with name and figure, so the chart survives being
 * read by someone who cannot separate two of the hues.
 *
 * ── THE LABELS SIT AT THEIR OWN SLICE ──────────────────────────────────────
 *
 * The owner's ask on 12 Sep 2026: "make the pie actually bigger and place the
 * actual data around the actual placements of the pie". It was a stacked legend
 * under a small circle — a list you matched to the mark by colour, one swatch at
 * a time, with the circle squeezed into whatever the list left over.
 *
 * A label's place is polar: `centre + R·(cos θ, sin θ)`. The obvious way to get
 * that is to measure the box in pixels, and the first version of this did, with
 * a `ResizeObserver` — which `tests/board-chart-marks.test.ts` rejected, and was
 * right to: every mark in this directory renders on either side of the client
 * boundary and `table.tsx` is the single documented exception.
 *
 * SO THE GEOMETRY IS DONE IN A SQUARE, WHICH NEEDS NO MEASUREMENT. A percentage
 * `left` resolves against the container's WIDTH and a percentage `top` against
 * its HEIGHT — the same fraction is a different distance on each axis, so polar
 * placement in a non-square box comes out an ellipse. Inside a box that
 * `aspect-square` has made square, the two are equal by construction and the
 * arithmetic below is ordinary trigonometry in percent. Labels overflow that
 * square into the card's own gutters, which is exactly where they belong.
 */

/** The circle's radius as a share of the square's side: 50 of the 104 viewBox. */
const R_CIRCLE = (50 / 104) * 100;
/**
 * Where a label anchors, in the same units. `+4` put it 2.8px outside the arc on
 * a 140px square and the figures grazed the wedges; `+7` clears it at every size
 * the square takes, and costs the labels about 4px of a gutter that has 84.
 */
const R_LABEL = R_CIRCLE + 7;
/**
 * Two labels closer than this on one side would collide, as a share of the
 * square. Sized for the WORST case — a name wrapped to two lines over its
 * figure, about 44px on the ~210px square a six-row tile gives — because
 * spacing for the one-line case would let a wrapped label sit on its neighbour.
 * Nothing is pushed unless it would actually have overlapped.
 */
const STACK_PCT = 21;

type Placed = { slice: PieSlice; i: number; left: number; top: number; right: boolean };

/**
 * WHERE EACH LABEL GOES, AND THE DE-COLLISION THAT MAKES IT USABLE.
 *
 * Two adjacent thin slices put their labels within a few pixels of each other
 * and the text overlaps into mush — the thing that makes hand-rolled pie
 * labelling look amateur. Labels are pushed apart along their own side after
 * placement: sorted by position, then walked once, each forced at least
 * `STACK_PCT` below the last. Sorting first is what keeps their order matching
 * the slices, so a nudged label still reads against the right wedge.
 */
function placeLabels(slices: PieSlice[]): Placed[] {
  const placed: Placed[] = slices.map((slice, i) => {
    // Degrees clockwise from 12 o'clock — `arcPath`'s own convention.
    const rad = (((slice.a0 + slice.a1) / 2 - 90) * Math.PI) / 180;
    const cos = Math.cos(rad);
    return {
      slice,
      i,
      left: 50 + R_LABEL * cos,
      top: 50 + R_LABEL * Math.sin(rad),
      right: cos >= -0.02,
    };
  });

  for (const side of [true, false]) {
    const mine = placed.filter((p) => p.right === side).sort((a, b) => a.top - b.top);
    for (let k = 1; k < mine.length; k++) {
      if (mine[k].top - mine[k - 1].top < STACK_PCT) mine[k].top = mine[k - 1].top + STACK_PCT;
    }
    /* Pushing down can walk the last one past the bottom; lift the whole side
       back rather than letting the card clip it. */
    const overshoot = (mine.at(-1)?.top ?? 0) - 100;
    if (overshoot > 0) for (const p of mine) p.top -= overshoot;
  }
  return placed;
}

export function PieChart({
  groups,
  format,
  donut = false,
  limit = 6,
  legend,
  cols = 6,
}: {
  groups: GroupRow[];
  format: ChartFormat;
  donut?: boolean;
  limit?: number;
  /**
   * UNSET MEANS "AROUND THE MARK", the default since 12 Sep 2026. `right`,
   * `bottom` and `none` stay exactly what they were and are still what the
   * settings panel stores — this only changes what an author who never chose
   * gets, and what they got was the stacked list.
   */
  legend?: "right" | "bottom" | "none";
  /**
   * The tile's width in grid columns, which is how this decides whether there is
   * room for radial labels. The same question the legend default used to answer
   * with `cols >= 5`, asked by the same means — a mark that may not hold state
   * cannot measure its own box, and guessing from nothing would put labels over
   * the mark on a three-column tile.
   */
  cols?: number;
}) {
  const { slices, total } = pieSlices(groups, limit);
  if (slices.length === 0) return null;

  const pct = (share: number) => formatMetricValue(share * 100, { format: "percent", precision: 0 });
  const tip = (s: PieSlice) => `${s.label} · ${formatMetricValue(s.value, format)} (${pct(s.share)})`;
  /**
   * FOUR COLUMNS, NOT FIVE. The legend default this replaces switched at `cols
   * >= 5`, and inheriting that number would have left the commonest pie tile on
   * a board — four columns, about 350px — on the old stacked list, which is the
   * layout the owner asked to be rid of. Measured at that width: a 140px circle
   * with 90px of gutter either side, which is the shape these labels were tuned
   * against. Three columns really has nowhere to put them.
   */
  const around = legend === undefined && cols >= 4;

  const marks = (
    <>
      {slices.map((s, i) => (
        <path
          key={s.label}
          d={arcPath(50, s.a0, s.a1)}
          fill={sliceAccent(i, s.label)}
          /* The gap is a second encoding, not decoration — it keeps two
             adjacent hues separable for a reader who cannot tell them apart. */
          stroke="var(--color-card)"
          strokeWidth="2"
          data-tip={tip(s)}
        />
      ))}
      {donut && <circle r="24" fill="var(--color-card)" />}
    </>
  );

  const readout = (
    <span className="sr-only">
      {slices.map((s) => `${s.label}: ${formatMetricValue(s.value, format)} (${pct(s.share)})`).join(", ")}. Total{" "}
      {formatMetricValue(total, format)}.
    </span>
  );

  if (around) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" style={{ containerType: "size" }}>
        {/**
         * THE SQUARE IS THE COORDINATE SYSTEM, AND IT HAS TO ACTUALLY BE SQUARE.
         *
         * `aspect-square h-full max-w-[44%]` looks like it says "square, sized by
         * height, never wider than 44%" and does not: `h-full` makes the height
         * definite, `max-width` then clamps the width, and the ratio simply
         * loses. Measured on a gallery card it produced a 140×206 box — so a
         * percentage `left` ran against 140 and `top` against 206, and the ring
         * of labels came out an ELLIPSE. That is the exact failure this square
         * exists to prevent, reintroduced by the shorthand meant to create it.
         *
         * `min(100cqh, 44cqw)` on BOTH axes says it once and means it: the side
         * is the lesser of the card's height and 44% of its width, and both
         * dimensions are that same length. The parent carries `container-type:
         * size` so `cqh`/`cqw` resolve against it — it is flex-sized, so its box
         * never depends on this content and the containment is safe.
         */}
        <div
          className="relative"
          style={{ width: "min(100cqh, 44cqw)", height: "min(100cqh, 44cqw)" }}
        >
          <svg className="h-full w-full" viewBox="-52 -52 104 104" preserveAspectRatio="xMidYMid meet" aria-hidden>
            {marks}
          </svg>

          {placeLabels(slices).map((p) => (
            <span
              key={p.slice.label}
              /**
               * `max-w-[60%]` IS OF THE SQUARE, AND IT SCALES BECAUSE OF THAT.
               *
               * A fixed pixel cap cannot be right at two sizes: 88px let "Total
               * Leads" wrap on the ~168px square of a gallery card, and would
               * have overhung the card on the ~140px square of a real four-column
               * tile. The gutter is what is left of the container after the
               * square takes its 44%, so the room from a label's anchor to the
               * card edge is about 0.6 of the square's own side — a share, not a
               * number, and the one that stays true as the tile resizes.
               */
              className={`absolute flex flex-col leading-tight ${p.right ? "items-start" : "items-end"}`}
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                /* A SHARE OF THE SQUARE, SET INLINE beside the other two
                   percentages it has to agree with. As a utility class it
                   resolved to 60px rather than 60% of the 140px box, so every
                   name wrapped at two thirds of the room it actually had. */
                maxWidth: "60%",
                transform: `translate(${p.right ? "0" : "-100%"}, -50%)`,
              }}
              data-tip={tip(p.slice)}
            >
              {/* NO `w-full` HERE. It stretched the name row to the column's own
                  width and, with `overflow-wrap:anywhere` making the name's
                  min-content width zero, let the text shrink and wrap inside room
                  it did not need — "Total Leads" broke across two lines with 28px
                  to spare. Sized to its content, the name wraps only when the
                  column's `max-width` genuinely runs out. */}
              <span className="flex min-w-0 items-center gap-1">
                {/* THE SWATCH STAYS even though the label is already at its slice.
                    Position ties them for a reader taking in the whole card; the
                    dot is what ties them for one read at a time, and for a label
                    the de-collision above has nudged away from its own wedge. */}
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: sliceAccent(p.i, p.slice.label) }}
                  aria-hidden
                />
                {/* WRAPS, RATHER THAN TRUNCATING — and `composed-check` settled it.
                    "Organic Leads" needs about 80px at 12px and the gutter beside
                    a circle this size is 76, so `truncate` rendered "Organic L…"
                    and the clipped-text rule flagged it, correctly. The funnel's
                    stage names are exempt from that rule because a row shared by n
                    siblings has nowhere else to go; a radial label has somewhere
                    else to go, which is down. */}
                <span
                  className="min-w-0 text-2xs text-muted-foreground [overflow-wrap:anywhere] line-clamp-2"
                  title={p.slice.label}
                >
                  {p.slice.label}
                </span>
              </span>
              <span className="flex items-baseline gap-1">
                <span className="stat-numeral text-xs text-heading">{formatMetricValue(p.slice.value, format)}</span>
                <span className="tnum text-2xs text-muted-foreground">{pct(p.slice.share)}</span>
              </span>
            </span>
          ))}
        </div>
        {readout}
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 gap-3 ${legend === "bottom" || !legend ? "flex-col" : "items-center"}`}>
      {/**
       * `flex-1`, NOT `h-full`, WHEN THE LEGEND IS BENEATH — and this was eating
       * the legend whole.
       *
       * `h-full` inside a flex COLUMN means 100% of the container, so the circle
       * claimed the entire card and the legend — a `flex-1` sibling — was left
       * with nothing. Measured on a six-row tile: svg 126px, legend 0px, its own
       * `overflow-y-auto` quietly scrolling three rows of text nobody could see.
       */}
      <svg
        className={legend === "right" ? "h-full w-auto shrink-0" : "min-h-0 w-full flex-1"}
        viewBox="-52 -52 104 104"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {marks}
      </svg>

      {/* THIS NOTE SITS ABOVE THE BRANCH because a branch is a single EXPRESSION
          and a JSX comment is a CHILD — one inside `&&` is a syntax error, not a
          comment. `custom-board.tsx` has the same note over its own ternary. */}
      {legend !== "none" && (
        <div
          className={`min-w-0 space-y-1 overflow-y-auto quiet-scroll ${
            legend === "right" ? "min-h-0 flex-1" : "max-h-[55%] shrink-0"
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
              <span className="stat-numeral shrink-0 text-xs text-heading">{formatMetricValue(s.value, format)}</span>
              <span className="tnum w-8 shrink-0 text-right text-xs text-muted-foreground">{pct(s.share)}</span>
            </div>
          ))}
        </div>
      )}
      {readout}
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
