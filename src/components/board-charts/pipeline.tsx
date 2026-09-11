import { FunnelBody } from "@/components/board-charts/funnel-body";
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
}: {
  result: FunnelResult;
  accent: string;
  composed?: boolean;
  cols?: number;
}) {
  return <FunnelBody result={result} accent={accent} composed={composed} cols={cols} align="center" />;
}
