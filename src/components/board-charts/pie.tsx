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
/**
 * The same idea along the top and bottom edges, where labels crowd SIDEWAYS. A
 * label is wider than it is tall — a name over a figure runs to about 90px on a
 * 126px square — so the spacing that keeps two apart is correspondingly wider.
 */
const SPREAD_PCT = 70;

/**
 * THE SQUARE HAS TO BE SMALLER THAN THE BOX, because it throws labels outside
 * itself — and this is the bug the owner hit: "TikTok is out of bounds".
 *
 * A slice at the top of the circle anchors its label ABOVE the square's top edge
 * (`R_LABEL` is 55%, so 5% of the side beyond the halfway mark), and the label is
 * centred on that anchor — so half of it sits higher again. Sized at `100cqh`
 * the square filled the whole box, its top edge WAS the card's padding, and
 * everything above it was clipped: the name cut in half, the padding eaten.
 *
 * 80px of vertical reserve, split by `items-center` into 40px above and below.
 * Measured against the worst label: ~7px for the anchor's overshoot on a 140px
 * square, plus ~27px for half of a two-line name over its figure, is 34px — so
 * 40 clears it with the card's own 16px padding still intact.
 *
 * THE WIDTH NEEDS NO SUCH RESERVE: at 44% the gutters are 28% of the box each,
 * which is where the side labels were always going to live.
 *
 * The 88px floor is for a box too short to give 80px away — the square stops
 * shrinking rather than inverting, and a tile that small is below the `cols >= 4`
 * gate anyway.
 */
const SQUARE_SIDE = "max(88px, min(calc(100cqh - 80px), 44cqw))";

/**
 * WHICH EDGE OF THE LABEL FACES THE ARC — and getting this wrong is what made
 * the gaps uneven.
 *
 * A label is a rectangle placed at a point on a circle, and the distance a
 * reader sees is from the arc to the nearest EDGE of that rectangle, not to its
 * anchor. Anchoring every label by its left or right side and centring it
 * vertically is exactly right at 3 and 9 o'clock, where that side IS the near
 * edge — and wrong at 12 and 6, where the near edge is the bottom or the top.
 *
 * Measured on the owner's own pie: Facebook cleared the arc by 8px, Instagram by
 * 7, and TikTok — the slice pointing almost straight up — by MINUS 7. Its box
 * was overlapping the circle while its text read as floating far away, because
 * the part of the box nearest the arc was an empty corner.
 *
 * So the zone is chosen by which component of the angle dominates: past 45° the
 * label belongs above or below its slice, anchored by the edge that faces in.
 */
type Zone = "right" | "left" | "top" | "bottom";

type Placed = { slice: PieSlice; i: number; left: number; top: number; zone: Zone };

/** Which way the box is pinned so its near edge lands on the anchor. */
const TRANSFORM: Record<Zone, string> = {
  right: "translate(0, -50%)",
  left: "translate(-100%, -50%)",
  top: "translate(-50%, -100%)",
  bottom: "translate(-50%, 0)",
};

/** Text alignment follows the anchoring: side labels hug their edge, vertical ones centre. */
const ALIGN: Record<Zone, string> = {
  right: "items-start text-left",
  left: "items-end text-right",
  top: "items-center text-center",
  bottom: "items-center text-center",
};

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
    const sin = Math.sin(rad);
    const zone: Zone = Math.abs(sin) > Math.abs(cos) ? (sin < 0 ? "top" : "bottom") : cos >= 0 ? "right" : "left";
    /**
     * ANCHORED TO A BOX AROUND THE CIRCLE, NOT TO A BIGGER CIRCLE — and that is
     * what finally made the gaps equal.
     *
     * Placing every label at `R_LABEL` along its own radius sounds even and is
     * not: the label's near edge faces one axis, so the gap a reader sees is the
     * component of that radius along THAT axis — `R_LABEL·|sin|` for a label
     * above the mark, `R_LABEL·|cos|` for one beside it. Only a slice pointing at
     * exactly 12 or 3 o'clock gets the full distance; everything in between is
     * short by however far its angle is from the axis it is anchored to.
     * Measured: 8px for Facebook (|cos| 0.99) against 4px for TikTok (|sin|
     * 0.95), on the same chart, from the same constant.
     *
     * Pinning the ANCHORED axis to `R_LABEL` and letting the other follow the
     * slice makes the gap exactly `R_LABEL − R_CIRCLE` for every label, whatever
     * its angle, while each still sits over the wedge it names.
     */
    return {
      slice,
      i,
      left: zone === "right" ? 50 + R_LABEL : zone === "left" ? 50 - R_LABEL : 50 + R_CIRCLE * cos,
      top: zone === "bottom" ? 50 + R_LABEL : zone === "top" ? 50 - R_LABEL : 50 + R_CIRCLE * sin,
      zone,
    };
  });

  /**
   * DE-COLLISION IS A SIDE-LABEL PROBLEM. Only `left` and `right` stack down a
   * column and can land on each other; a `top` and a `bottom` label are half a
   * circle apart by definition, and nudging them vertically would push them
   * straight off the mark they are pointing at.
   */
  for (const side of ["right", "left"] as const) {
    const mine = placed.filter((p) => p.zone === side).sort((a, b) => a.top - b.top);
    for (let k = 1; k < mine.length; k++) {
      if (mine[k].top - mine[k - 1].top < STACK_PCT) mine[k].top = mine[k - 1].top + STACK_PCT;
    }
    /* Pushing down can walk the last one past the bottom; lift the whole side
       back rather than letting the card clip it. */
    const overshoot = (mine.at(-1)?.top ?? 0) - 100;
    if (overshoot > 0) for (const p of mine) p.top -= overshoot;
  }

  /**
   * AND THE SAME ALONG THE OTHER AXIS, which the zones made necessary.
   *
   * While every label hung off its own radius, two slices near 12 o'clock got
   * two different positions on the arc and the side de-collision above was the
   * only crowding to worry about. Anchored to a BOX, two such slices both sit on
   * the top edge at `50 + R_CIRCLE·cos` — and near the top `cos` is near zero for
   * both, so their labels land on the same spot and overlap. The vertical fix
   * would have introduced a horizontal bug.
   *
   * Wider spacing than `STACK_PCT` because labels are wider than they are tall:
   * a name over a figure is ~44px and 90-odd wide.
   */
  for (const end of ["top", "bottom"] as const) {
    const mine = placed.filter((p) => p.zone === end).sort((a, b) => a.left - b.left);
    for (let k = 1; k < mine.length; k++) {
      if (mine[k].left - mine[k - 1].left < SPREAD_PCT) mine[k].left = mine[k - 1].left + SPREAD_PCT;
    }
    const over = (mine.at(-1)?.left ?? 0) - 100;
    if (over > 0) for (const p of mine) p.left -= over;
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
          style={{ width: SQUARE_SIDE, height: SQUARE_SIDE }}
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
              /* `data-pie-label` is for the harness: `composed-check` measures
                 each one against the card's 16px padding, because the way these
                 fail is by leaving the card entirely and being clipped — which
                 no source check can see and no screenshot review reliably
                 catches either. */
              data-pie-label
              className={`absolute flex flex-col leading-tight ${ALIGN[p.zone]}`}
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                /* A SHARE OF THE SQUARE, SET INLINE beside the other two
                   percentages it has to agree with. As a utility class it
                   resolved to 60px rather than 60% of the 140px box, so every
                   name wrapped at two thirds of the room it actually had. */
                /**
                 * `max-content` IS WHAT LETS THE LABEL LEAVE THE SQUARE, and
                 * without it nothing else here could work.
                 *
                 * An absolutely positioned box with `left` set and no `right`
                 * shrink-to-fits against its containing block MINUS that left —
                 * so a right-hand label anchored at 55% of a 140px square had
                 * 63px to live in, whatever `max-width` said, and "Facebook"
                 * wrapped mid-word inside it. The label is meant to overflow the
                 * square into the card's gutter; `max-content` is how it asks for
                 * its natural width first and lets `max-width` do the capping.
                 */
                width: "max-content",
                /**
                 * CAPPED BY THE GUTTER, NOT BY THE SQUARE — which is the same
                 * quantity only by accident, and they move in OPPOSITE
                 * directions.
                 *
                 * `60%` of the square was calibrated when the square was 140px.
                 * Adding the vertical reserve shrank it to 126, so the cap fell
                 * to 76px — while the room beside it GREW, because the gutter is
                 * what the square gives up. "Total Leads" started wrapping in
                 * 97px of clear space. Every future change to the square's size
                 * would have mis-tuned this the same way.
                 *
                 * The gutter is `(container − square) / 2`, and 12px covers the
                 * label's own overshoot past the square's edge plus a margin.
                 */
                maxWidth: `calc((100cqw - ${SQUARE_SIDE}) / 2 - 12px)`,
                transform: TRANSFORM[p.zone],
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
                  /**
                   * `break-word`, NOT `anywhere` — and the difference is the
                   * whole bug. "Facebook" rendered as "Faceb / ook".
                   *
                   * `overflow-wrap: anywhere` sets the element's MIN-CONTENT
                   * width to zero, which is the point of it. So this flex column
                   * sized itself to its other child — the "24 55%" row, about
                   * 48px — and then the name obligingly wrapped to fit a width
                   * nothing had asked it to fit, mid-word, with 40px of gutter
                   * going spare beside it.
                   *
                   * `break-word` leaves min-content at the longest WORD, so the
                   * column is at least wide enough for it (up to the max-width
                   * above) and a break only happens where a single word genuinely
                   * cannot fit. Long names still wrap; words stop being sawn in
                   * half.
                   */
                  /**
                   * NO `line-clamp-2`, and it was the second half of the same
                   * bug. Clamping sets `display: -webkit-box`, which collapses
                   * the element's MAX-content contribution — so the flex column
                   * sized itself to the "420 53%" row (60px) and the name wrapped
                   * into that, with 45px of its own max-width unused. Between
                   * them, `anywhere` and the clamp meant the name could never ask
                   * for the room it had.
                   *
                   * Unclamped, a very long name wraps to a third line rather than
                   * being cut — which the de-collision above already leaves space
                   * for, and which is the better failure anyway: a pie label that
                   * runs on is legible, one that ends in an ellipsis is not a
                   * name.
                   */
                  className="min-w-0 text-xs text-muted-foreground [overflow-wrap:break-word]"
                  title={p.slice.label}
                >
                  {p.slice.label}
                </span>
              </span>
              {/* 14px FIGURE OVER A 13px NAME — one step apart, which is what
                  makes the number lead its own label without either shouting.
                  They were 13 over 12, the axis-label step, which read as two
                  captions rather than as a figure and its name. */}
              <span className="flex items-baseline gap-1">
                <span className="stat-numeral text-sm text-heading">{formatMetricValue(p.slice.value, format)}</span>
                <span className="tnum text-xs text-muted-foreground">{pct(p.slice.share)}</span>
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
