import { formatMetricValue } from "@/lib/format";
import { funnelShape, multipleLabel } from "@/lib/board/scale";
import { stageFill } from "@/lib/board/tile-config";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * ONE METRIC THAT LEFT THE FUNNEL SIDEWAYS — an outcome, not a stage.
 *
 * "Unqualified", "No show", "Refunded": counts that belong to the same run but
 * are not a step ON the way anywhere, so putting them in the body would make the
 * sequence claim something false. They ride a strip under the mark instead,
 * which is where the reference design puts them and, more to the point, the only
 * place they can go without joining a progression they are not part of.
 */
export type FunnelExit = {
  label: string;
  /**
   * NULL IS "THIS TILE CANNOT ANSWER FOR THIS PERIOD", and it draws an em dash
   * rather than vanishing. Dropping the row would leave the reader with no way
   * to tell a missing outcome from one that never happened — and zero and
   * unknown are the exact pair `composeFunnel` refuses to let a STAGE conflate.
   * The strip is a footnote, so it discloses instead of refusing.
   */
  value: number | null;
};

/**
 * THE FUNNEL BODY — one connected ribbon, drawn once and arranged four ways.
 *
 * Two axes of choice, and they are independent. `align` centres the body into a
 * symmetric silhouette or anchors it to one edge; `flow` decides whether the
 * stages run DOWN (width carries the count) or ACROSS (height does). "Pipeline"
 * and "Funnel" differ only in `align`, and `flow` is the author's, from
 * `config.flow`.
 *
 * THE MARK IS A SMOOTH RIBBON, and the arithmetic under it did not move. Each
 * stage is still exactly as wide as its share of the largest; the only change
 * from the chamfered polygons this replaced is that the transition between two
 * stages is a cubic sigmoid, so consecutive bands meet without a corner. The
 * reference design this was rebuilt from draws its own stages as a gentle taper
 * whatever the counts do — an 11412 → 2952 fall rendered as a mild slope — and
 * that silhouette was refused on purpose. `tests/funnel-ribbon.test.ts` is where
 * the refusal is enforced rather than remembered.
 *
 * COLOUR IS A LADDER, NOT A PALETTE. Stages are a sequence — each one is the one
 * before it, minus the people who left — so they take a single hue deepening
 * along the flow (`stageFill`), never the pie's categorical order. The pale end
 * is mixed against the CARD rather than cut from a fixed hex, which is what lets
 * the same ladder recede on white and on #151515 instead of glowing on the dark
 * ground.
 *
 * WHERE THE LABELS GO IS A CONSEQUENCE OF THE FLOW, not a second preference.
 * Running DOWN, a label cannot sit above its own stage without cutting the body
 * in half, so names go in a lane beside it. Running ACROSS, every stage has the
 * full width of its own column overhead — so the name and the count sit in a
 * header row above the body, and the conversion rides the narrowing itself.
 *
 * Text is never laid over the fill in either: no single ink token is legible on
 * both the accent and the card in both themes, and the first attempt at this
 * printed a muted-grey ratio on a blue segment.
 */
export function FunnelBody({
  result,
  accent,
  composed,
  cols = 6,
  align,
  flow = "down",
  exits = [],
}: {
  result: FunnelResult;
  accent: string;
  /**
   * The stages were assembled by `composeFunnel` out of separate published
   * metrics rather than computed as one sequenced run. It buys two things: the
   * ratio stops calling itself a conversion, and no drop-off may be CLAIMED.
   */
  composed?: boolean;
  /** The tile's width in grid columns — the header row sizes its counts by it. */
  cols?: number;
  align: "center" | "left";
  flow?: "down" | "across";
  /** Outcomes beside the funnel rather than steps along it. Empty draws no strip. */
  exits?: FunnelExit[];
}) {
  const counts = result.stages.map((s) => s.count);
  const bands = funnelShape(counts, { align, flow });
  const fmt = { format: "number" as const };
  const n = result.stages.length;

  /**
   * HOW BIG THE STAGE COUNTS GET — the kit's own steps, chosen by how much
   * column each stage actually has.
   *
   * A funnel is the one chart with NO headline: `custom-tile` passes
   * `headline={undefined}` for funnel and pipeline because there is no single
   * figure to head the card. These counts are what stands in for it, so they
   * take `.stat-numeral` — the tabular figures, 600 weight and -0.0386em
   * tracking that every other card's number already uses. They were `tnum
   * font-semibold`, which is the same idea spelled by hand and half of it
   * missing.
   *
   * THE SIZE IS A FUNCTION OF COLS AND STAGES, not of cols alone. Running
   * across, n figures share one row, so the room per stage is what decides
   * whether a display step fits — three stages on a wide tile have a column
   * each and can carry the 24px figure the rest of the product leads with;
   * five on a four-column tile have about 70px, where "11,412" at 24px would
   * not fit at all. Rungs only, no arbitrary sizes: the ratio picks between
   * `text-display-xs` (24), `text-lg` (18) and `text-sm` (14).
   */
  /**
   * 28px — `--text-display-md`, THE TILE'S HEADLINE NUMBER, and this is the same
   * figure wearing the same clothes rather than a lookalike.
   *
   * `custom-tile` passes `headline={undefined}` for a funnel and a pipeline
   * because there is no single number to head the card; these counts are what
   * stands in for it, so they take exactly what `ChartFrame` and `MetricCard`
   * give theirs — `stat-numeral text-display-md text-heading`. An earlier pass
   * had them on a ladder topping out at 26px, and the owner's verdict on the
   * 18px rung it actually picked was that a funnel's numbers should read like
   * every other metric on the board. They should; they are the same kind of
   * thing.
   *
   * THE ONE STEP DOWN IS ABOUT FITTING, NOT ABOUT TASTE. A truncated number is
   * a WRONG number — "11,412" ellipsised to "11,4…" is worse than the same
   * figure set smaller — so a cell too narrow for the display step drops to
   * 18px rather than clipping.
   *
   * The width estimate is deliberately crude and deliberately written down: a
   * board column is a twelfth of the canvas, near 95px at the sizes this product
   * is used at, and a stage gets the tile's width split n ways. Nothing in this
   * file can measure a box, so the estimate is tuned to fail SAFE — too small is
   * legible, too large is CLIPPED, and a clipped number is a wrong one.
   *
   * THE RUNGS WERE SET BY THE BROWSER, NOT BY ARITHMETIC. The first pass put the
   * floor at 100px with 18px beneath it, and `composed-check` immediately caught
   * the five-stage specimen rendering "11,412…" — the ellipsis turning a real
   * count into a smaller wrong one. That check measures a laid-out box and this
   * cannot, which is exactly the division of labour the repo's standing note
   * describes; the thresholds below are where it stopped complaining.
   */
  const cellPx = (cols * 95 - 16) / Math.max(1, n);
  const countSize = cellPx >= 110 ? "text-display-md" : cellPx >= 85 ? "text-lg" : "text-sm";

  /**
   * THE BOTTLENECK IS NAMED IN THE RATIO, NOT PAINTED ON THE BODY.
   *
   * It used to fill the worst stage in danger red and stamp a "Biggest drop-off"
   * badge beside it. Both are gone: red on one segment of a blue ladder reads as
   * a different KIND of thing rather than as the same thing going badly, and the
   * badge spent a whole row of a short tile restating what the figure beneath it
   * already said. The worst conversion's own pill takes danger INK instead —
   * findable when you look for it, silent when you are not.
   *
   * A composed funnel never has one: its stages are independent metrics, so a
   * fall between two of them is not a drop-off anybody can claim.
   */
  const worstDrop = (i: number) => !composed && result.bottleneckIndex === i;

  /**
   * A RATIO NEEDS A DENOMINATOR THAT EXISTS. `funnelFromCounts` guards its
   * division and answers 0 when the previous stage was empty, which is right for
   * the arithmetic and wrong on screen: the owner's card printed "0%" beside a
   * count of 12, because the stage above it was zero. Going from nothing to
   * twelve is not a nought per cent of anything.
   */
  const ratioAt = (i: number): string | null => {
    /**
     * BOUNDS FIRST, because the ACROSS flow asks about the stage AFTER a band
     * and the last band has none. Reading `stages[n].conversionFromPrev` threw
     * and blanked the whole tile — past every source check and every unit test,
     * since none of them render this arrangement. The caller also stops at
     * `n - 1`; this is the guard that does not depend on the caller remembering.
     */
    const stage = result.stages[i];
    if (!stage) return null;
    const prev = i > 0 ? result.stages[i - 1].count : null;
    if (prev == null || prev === 0) return null;
    const share = formatMetricValue(stage.conversionFromPrev * 100, { format: "percent", precision: 0 });
    /**
     * A COMPOSED STAGE'S RATIO IS NOT A CONVERSION, and above 1 it is not even a
     * share: 3.3 printed as "330%" is a number that cannot be a proportion inside
     * a phrase that promises one. `multipleLabel` answers null whenever the
     * percentage is still the true spelling.
     */
    return composed ? (multipleLabel(stage.conversionFromPrev) ?? share) : share;
  };

  /**
   * THE CONVERSION PILL — the figure, an arrow, and nothing else.
   *
   * It used to read "26% vs prev", and the owner's instruction was to take the
   * comparison language off these charts entirely. The arrow does that work
   * without a word: a pill sitting in the narrowing between two stages, pointing
   * the way the funnel runs, cannot be read as anything but the passage between
   * them. No shadow — the kit's shadow ladder is `none` at every rung and
   * `scripts/shadow-check.mjs` renders both themes to prove it — so the pill is
   * lifted off the body by its own card ground and a hairline instead.
   */
  const pill = (text: string, worst: boolean) => (
    <span
      /* 13px, THE SAME STEP AS THE STAGE NAMES IT SITS BETWEEN — the owner's
         12 Sep note. It was `text-2xs` (12px), the size an AXIS label takes,
         which made the one figure a reader looks for when hunting a drop-off
         the smallest text on the card. A conversion is not chrome. */
      className={`tnum inline-flex items-center gap-1 whitespace-nowrap rounded-control border border-border bg-card px-1.5 py-0.5 text-xs ${
        worst ? "text-danger" : "text-muted-foreground"
      }`}
    >
      {text}
      <span aria-hidden>{flow === "down" ? "↓" : "→"}</span>
    </span>
  );

  const marks = (
    <>
      {bands.map((b, i) =>
        b.path === "" ? (
          /**
           * A ZERO STAGE STILL HAS TO BE SOMETHING. Its body is the point the
           * ribbon comes to, so `funnelShape` hands back an empty path rather
           * than a degenerate shape that would still paint a hairline of accent
           * and read as "a few". A dashed rule on the band's own axis says "this
           * stage is here and it is empty" without manufacturing the width the
           * old 4% floor used to invent.
           */
          <line
            key={i}
            x1={flow === "down" ? b.cx : (b.y0 + b.y1) / 2}
            x2={flow === "down" ? b.cx : (b.y0 + b.y1) / 2}
            y1={flow === "down" ? b.y0 : 0}
            y2={flow === "down" ? b.y1 : 100}
            stroke="var(--color-muted-foreground)"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          /**
           * NO SEAM STROKE ANY MORE. The polygons needed a card-coloured hairline
           * between them to read as separate stages in one flat accent; the
           * ladder does that job with colour, and a stroke across a smooth
           * junction would put back exactly the visible joint the curve exists to
           * remove.
           */
          /* `data-funnel-band` is for the harness, and it earns its place: the
             body used to be `<polygon>`, which no other mark drew, so a check
             could find a stage by tag name alone. As a `<path>` it is
             indistinguishable from a pie's arcs, and `composed-check` counts
             both on the same card. */
          <path key={i} data-funnel-band d={b.path} fill={stageFill(i, n, accent)} />
        ),
      )}
      {/**
       * THE HIT TARGETS, PAINTED LAST AND INVISIBLE. The body is the largest
       * thing on the card and carried no hover at all — and a zero stage had no
       * geometry to hover even in principle. A transparent rect per band is
       * hit-testable, the same move `cartesian.tsx` makes for its columns.
       */}
      {bands.map((b, i) => (
        <rect
          key={`hit${i}`}
          x={flow === "down" ? 0 : b.y0}
          y={flow === "down" ? b.y0 : 0}
          width={flow === "down" ? 100 : Math.round((b.y1 - b.y0) * 10) / 10}
          height={flow === "down" ? Math.round((b.y1 - b.y0) * 10) / 10 : 100}
          fill="transparent"
          data-tip={`${result.stages[i].label} · ${formatMetricValue(result.stages[i].count, fmt)}`}
        />
      ))}
    </>
  );

  /**
   * `preserveAspectRatio="none"` and a 0..100 box on both axes — the
   * `cartesian.tsx` idiom rather than the pie's aspect lock, and the difference
   * is load-bearing. A pie locks its aspect because ANGLE is its encoding and a
   * squeezed circle lies about it. Here the encoding is one length, so
   * stretching the box to whatever shape the tile happens to be preserves every
   * ratio exactly.
   */
  const svgProps = {
    className: "h-full w-full overflow-visible",
    viewBox: "0 0 100 100",
    preserveAspectRatio: "none" as const,
    "aria-hidden": true,
  };

  /**
   * OUTCOMES, UNDER A RULE, IN THE ORDER THE AUTHOR NAMED THEM.
   *
   * Divided by hairlines rather than set in their own boxes: these are a
   * footnote to the mark, and giving each one a card would make three
   * afterthoughts look like three more stages.
   */
  const exitStrip = exits.length > 0 && (
    <div
      data-funnel-exits
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2"
    >
      {exits.map((exit, i) => (
        <span
          key={`${exit.label}-${i}`}
          /* 13px like the stage names and the conversion pills — one step for
             every label on this card, rather than a third size for the row that
             happens to be last. */
          className={`flex min-w-0 items-baseline gap-1.5 text-xs ${i > 0 ? "border-l border-border pl-3" : ""}`}
          data-tip={`${exit.label} · ${exit.value == null ? "no number this period" : formatMetricValue(exit.value, fmt)}`}
        >
          <span className="truncate text-muted-foreground" title={exit.label}>
            {exit.label}
          </span>
          <span
            className={`stat-numeral shrink-0 ${exit.value == null ? "text-muted-foreground" : "text-foreground"}`}
          >
            {exit.value == null ? "—" : formatMetricValue(exit.value, fmt)}
          </span>
        </span>
      ))}
    </div>
  );

  if (flow === "across") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {/**
         * THE HEADER ROW — a name, a key to its own segment, and the count.
         *
         * Each stage owns the full width of its column here, which is the
         * arrangement the DOWN flow cannot offer without cutting the body in
         * half. The dot is not decoration: it is painted with that stage's own
         * ladder fill, so the row is a legend for the ribbon beneath it and the
         * reader never has to count segments to find which one a number belongs
         * to.
         */}
        <div
          className="grid shrink-0 border-b border-border pb-2"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {result.stages.map((stage, i) => (
            <div
              key={i}
              /* THE LAST CELL KEEPS THE KEBAB'S LANE. With the card's title row
                 gone this header is the top of the card, and the board floats a
                 tile menu over its right corner on hover. `pr-6` is the same
                 24px `ChartFrame`'s own status line reserves, for the same
                 reason and against the same invisible component. */
              className={`flex min-w-0 flex-col gap-0.5 ${i > 0 ? "border-l border-border pl-2" : ""} ${
                i < n - 1 ? "pr-2" : "pr-6"
              }`}
            >
              <span className="flex min-w-0 items-center">
                {/* NO COLOUR KEY IN THIS ROW, and it was tried. A dot painted
                    with the stage's own ladder fill looked like the reference's
                    coloured icons and was wrong twice over: the header cell sits
                    in the same grid column as the segment beneath it, so
                    POSITION already keys the two together — and a dot is the
                    vocabulary of a CATEGORICAL legend, which says the stages are
                    a set of unrelated things when the ladder exists to say they
                    are one sequence. It also cost about 16px of an 85px cell,
                    measured on a four-stage tile, which the name needs more.

                    TRUNCATION HERE IS THE DESIGN, not a defect, and it is marked so
                    the harness can tell the two apart. A stage name running ACROSS
                    shares the card with n-1 siblings — four stages on a
                    four-column tile is about 110px each — so there is nowhere else
                    for a long name to go, and the full string stays in `title`.
                    That is a different thing from the DOWN flow's name lane, where
                    "Booked Leads" once rendered "Booke…" because a pill took room
                    the name could have had. One is arithmetic; the other was a bug. */}
                {/* 13px, the step `bars-horizontal` gives its own category
                    names — this row is that same question ("which thing is this
                    figure for"), so it gets that same answer rather than the
                    12px an AXIS uses. */}
                <span data-stage-name className="truncate text-xs text-muted-foreground" title={stage.label}>
                  {stage.label}
                </span>
              </span>
              {/* THE COUNT IS THE LOUD THING ON THIS CARD — "quiet chrome, loud
                  numbers", and this row is where a funnel gets to spend it,
                  because the card has no headline for it to compete with. */}
              <span
                /* `text-heading`, not `text-foreground` — the ink the headline
                   takes on every other card. In dark they resolve alike; in
                   light the headline is #313131 against a plain black, which is
                   the difference the metric card spells out at its own numeral. */
                className={`stat-numeral truncate ${countSize} ${
                  stage.count === 0 ? "text-muted-foreground" : "text-heading"
                }`}
              >
                {formatMetricValue(stage.count, fmt)}
              </span>
            </div>
          ))}
        </div>

        {/* THE BODY, WITH THE CONVERSIONS ON THE NARROWINGS THEMSELVES. Each pill
            is centred on the band's `waist` — where the taper actually happens —
            rather than on the band boundary, which is where the taper finishes
            and so reads as belonging to the stage after it. */}
        <div className="relative min-h-0 flex-1">
          <svg {...svgProps}>{marks}</svg>
          {bands.map((b, i) => {
            if (i >= n - 1) return null;
            const r = ratioAt(i + 1);
            if (!r) return null;
            return (
              <span
                key={i}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${b.waist}%` }}
              >
                {pill(r, worstDrop(i + 1))}
              </span>
            );
          })}
        </div>

        {exitStrip}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className="grid min-h-0 flex-1 items-stretch gap-x-3"
        style={{
          // The body takes a fixed share of the width so it stays a recognisable
          // shape on a narrow tile; the name lane absorbs whatever is left.
          gridTemplateColumns: "minmax(0,1fr) 38% auto",
          gridTemplateRows: `repeat(${n}, minmax(0, 1fr))`,
        }}
      >
        {/* ONE SVG SPANNING EVERY ROW, so the body is continuous across the band
            boundaries instead of being cut into one element per stage. */}
        <svg {...svgProps} style={{ gridColumn: 2, gridRow: `1 / ${n + 1}` }}>
          {marks}
        </svg>

        {result.stages.map((stage, i) => {
          const r = ratioAt(i);
          // Keyed by index: two stages may legitimately share a label, and
          // `computeFunnel` does not dedupe them. Position IS identity here.
          return (
            <div key={i} className="contents">
              <span
                className="flex min-w-0 items-center justify-end overflow-hidden"
                style={{ gridColumn: 1, gridRow: i + 1 }}
              >
                {/* No colour key here either — same reasoning as the across
                    flow's header: the lane's row IS the band's row. */}
                <span className="truncate text-xs text-foreground" title={stage.label}>
                  {stage.label}
                </span>
              </span>
              <span className="flex shrink-0 items-center" style={{ gridColumn: 3, gridRow: i + 1 }}>
                {/* THE RATIO IS THE POINT OF THE CHART, so it is never the thing
                    that stands down. It was briefly gated on tile width alongside
                    a pill that no longer exists, which hid the drop-off figure on
                    exactly the size most boards use. Stacked under the count: two
                    short lines fit a narrow column where one long row does not.

                    RUNNING DOWN, THE PILL STAYS IN ITS COLUMN rather than riding
                    the body the way it does running across. The body is 38% of a
                    tile that is often four columns wide — around 90px — and a
                    pill centred on it overhangs both edges of the ribbon. */}
                <span className="flex flex-col items-end gap-0.5 leading-tight">
                  <span
                    /* Running DOWN the count sits in a narrow column beside its
                       own pill, so it keeps the 13px step rather than taking the
                       across flow's display size — but it takes the numeral
                       treatment, which is what makes it the same KIND of figure
                       as every other number in the product. */
                    className={`stat-numeral text-xs ${stage.count === 0 ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {formatMetricValue(stage.count, fmt)}
                  </span>
                  {r && pill(r, worstDrop(i))}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {exitStrip}
    </div>
  );
}
