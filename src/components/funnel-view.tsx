import { FunnelBody, type FunnelExit } from "@/components/board-charts/funnel-body";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE FUNNEL — the same body, anchored at the left edge instead of centred.
 *
 * IT WAS A ROW OF BARS with a label line above each, and the owner rejected
 * that mark on the Pipeline in the same words it deserved here: it reads as a
 * table. Keeping one chart as a table and calling the difference "a choice"
 * would only have meant half the board still looked wrong, so both are the
 * connected body now and the alignment is the whole distinction — centred reads
 * as a narrowing at a glance, left-anchored lets two stages be compared by
 * length against a shared origin.
 *
 * `accent` defaults to the marker rather than the brand, which is what its bars
 * resolved to before: a stage body carries no ink of its own, so its only
 * contrast is its edge against the card, and the brand is solved for ink ON a
 * fill rather than for being one.
 *
 * THREE CLASSIC CALLERS pass nothing but a result — the metric page, the funnel
 * builder and the dashboard's own funnel row — so every added prop is optional
 * and the default is what they were already getting.
 */
export function FunnelView({
  result,
  composed,
  accent = "var(--color-marker)",
  cols,
  flow,
  exits,
}: {
  result: FunnelResult;
  /**
   * The stages came from `composeFunnel` — separate published metrics counted
   * over one window — rather than from a single sequenced run. It changes what
   * the ratio may call itself and withholds any drop-off CLAIM; `Pipeline`
   * spends it identically, because the two marks must not disagree about what a
   * number means.
   */
  composed?: boolean;
  accent?: string;
  cols?: number;
  /** Which way the stages run — the author's choice, from `config.flow`. */
  flow?: "down" | "across";
  /** Outcomes beside the funnel rather than steps along it — the strip under the mark. */
  exits?: FunnelExit[];
}) {
  return (
    <FunnelBody
      result={result}
      accent={accent}
      composed={composed}
      cols={cols}
      align="left"
      flow={flow}
      exits={exits}
    />
  );
}
