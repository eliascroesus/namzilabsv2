import type { ChartId } from "@/lib/board/charts";
import type { CustomTileOption } from "@/lib/board/types";

/**
 * WHICH METRICS A PICKER MAY OFFER — pure, so the rule can be asserted without
 * a DOM.
 *
 * `MetricList` is a React component in a suite with no DOM, so every rule that
 * lived inside it was a rule no test could reach. The list's own argument for
 * existing is that "a list that offers what it will then reject is worse than a
 * shorter list", and that promise is only as good as the filtering behind it.
 * So the filtering is here.
 *
 * TWO QUESTIONS, ASKED IN ORDER, because they fail for different reasons and
 * the component says different things about each:
 *
 *   LEGAL — can this metric be drawn as the chart being built at all? That is
 *           `o.charts`, computed server-side from the tile's shape and its
 *           facts. A board with nothing legal earns "nothing here can be drawn
 *           as…", a claim about the metrics.
 *   FREE + ALIKE — is it already spoken for, and is it measured the same way as
 *           what is already on the chart? Both of these empty the list without
 *           saying anything about the board, so the component keeps the
 *           pre-exclusion list to choose its sentence from.
 */
export function partsOnOffer(
  options: CustomTileOption[],
  {
    need,
    exclude,
    units,
  }: {
    /** The chart being built — the metric has to be legal for THIS, not for the tile's own. */
    need: ChartId;
    /** Tile keys already spoken for: the anchor, and the parts already chosen. */
    exclude?: string[];
    /**
     * WHAT THE CHART IS ALREADY MEASURED IN, from `unitsKey`.
     *
     * Bars share an axis, so `composeRanked` refuses a chart mixing dollars
     * with counts — which used to be discoverable only by hitting it. Given
     * here, the list simply never offers the mismatch.
     *
     * OMITTED MEANS DO NOT ASK. Every caller that predates composition passes
     * nothing and keeps exactly the behaviour it had; an option carrying no
     * units of its own can then still be offered, which is what keeps a
     * fixture-built list (the design harness) from emptying itself.
     */
    units?: string;
  },
): CustomTileOption[] {
  const legal = options.filter((o) => o.charts.includes(need));
  const taken = new Set(exclude ?? []);
  const free = taken.size > 0 ? legal.filter((o) => !taken.has(o.key)) : legal;
  return units == null ? free : free.filter((o) => o.units == null || o.units === units);
}
