import { StatusPill } from "@/components/ui/badge";
import { formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunnelResult } from "@/lib/metrics/compute";

/** Horizontal funnel: each stage's distinct count, conversion bar, and the bottleneck flagged. */
export function FunnelView({ result }: { result: FunnelResult }) {
  const first = result.stages[0]?.count ?? 0;
  return (
    <div className="space-y-2">
      {result.stages.map((stage, i) => {
        const pct = first > 0 ? Math.round((stage.count / first) * 100) : 0;
        const isBottleneck = result.bottleneckIndex === i;
        return (
          <div key={i}>
            <div className="mb-1 flex items-center justify-between text-base">
              <span className="font-medium text-foreground">
                {stage.label}
                {isBottleneck && (
                  <StatusPill tone="danger" className="ml-2">
                    Biggest drop-off
                  </StatusPill>
                )}
              </span>
              {/* tnum on the row, so the counts sit in columns as ranges flip. */}
              <span className="tnum text-muted-foreground">
                {formatMetricValue(stage.count, { format: "number" })}
                {i > 0 && (
                  <span className="ml-2 text-tiny text-muted-foreground">
                    {Math.round(stage.conversionFromPrev * 100)}% from prev
                  </span>
                )}
              </span>
            </div>
            <div className="h-6 w-full overflow-hidden rounded-control bg-muted">
              <div
                className={cn("h-full", isBottleneck ? "bg-danger" : "bg-brand-600")}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
