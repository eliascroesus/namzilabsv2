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
                  <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-tiny font-medium text-red-700">
                    biggest drop-off
                  </span>
                )}
              </span>
              {/* tnum on the row, so the counts sit in columns as ranges flip. */}
              <span className="tnum text-muted-foreground">
                {stage.count}
                {i > 0 && (
                  <span className="ml-2 text-tiny text-neutral-400">
                    {Math.round(stage.conversionFromPrev * 100)}% from prev
                  </span>
                )}
              </span>
            </div>
            <div className="h-6 w-full overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${isBottleneck ? "bg-red-400" : "bg-neutral-800"}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
