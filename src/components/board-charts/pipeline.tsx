import { FunnelBody, type FunnelExit } from "@/components/board-charts/funnel-body";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE PIPELINE — the funnel body, centred into the classic silhouette.
 *
 * Everything about the mark lives in `FunnelBody`; this chooses the alignment
 * and nothing else. The two chart ids had drifted into near-identical marks
 * separated by a centring AND by a floor they disagreed about (2% here, 4%
 * there), which nothing could see because no page ever drew both.
 */
export function Pipeline({
  result,
  accent,
  composed,
  cols,
  flow,
  exits,
}: {
  result: FunnelResult;
  accent: string;
  composed?: boolean;
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
      align="center"
      flow={flow}
      exits={exits}
    />
  );
}
