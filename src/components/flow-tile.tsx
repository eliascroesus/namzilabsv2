import Link from "next/link";
import { refreshFlowAction } from "@/app/dashboard/flows/actions";

type Tile = {
  name?: string;
  description?: string;
  viz?: string;
  format?: "number" | "percent" | "currency";
  unit?: string;
  currency?: string;
  precision?: number;
  target?: number | null;
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  groups?: Array<{ label: string; value: number }>;
};

export type FlowResultRow = {
  flowId: string;
  outputNodeId: string;
  tile: unknown;
  status: string;
  computedAt: Date | null;
};

function fmt(value: number | undefined, t: Tile): string {
  if (value == null) return "—";
  const p = t.precision ?? 0;
  if (t.format === "percent") return `${value.toFixed(p)}%`;
  if (t.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: t.currency || "USD",
      maximumFractionDigits: p,
    }).format(value);
  }
  const n = value.toLocaleString(undefined, { maximumFractionDigits: p });
  return t.unit ? `${n} ${t.unit}` : n;
}

/** Renders one materialized flow Output as a dashboard tile. */
export function FlowTile({ row }: { row: FlowResultRow }) {
  const t = (row.tile ?? {}) as Tile;
  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-neutral-800">{t.name ?? "Metric"}</h3>
        <div className="flex items-center gap-2">
          <Freshness status={row.status} />
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={row.flowId} />
            <button
              type="submit"
              className="text-xs text-neutral-500 hover:text-neutral-800 hover:underline"
              title="Recompute this tile now"
            >
              Refresh
            </button>
          </form>
          <Link href={`/dashboard/flows/${row.flowId}`} className="text-xs text-blue-600 hover:underline">
            Open →
          </Link>
        </div>
      </div>

      {t.series && t.series.length > 0 ? (
        <Sparkbars series={t.series} label={fmt(t.value, t)} />
      ) : t.groups && t.groups.length > 0 ? (
        <GroupBars groups={t.groups} tile={t} />
      ) : (
        <>
          <p className="mt-2 text-4xl font-semibold">{fmt(t.value, t)}</p>
          {t.target != null && <TargetBar value={t.value ?? 0} target={t.target} />}
        </>
      )}

      {row.computedAt && (
        <p className="mt-3 text-xs text-neutral-400">Updated {new Date(row.computedAt).toLocaleString()}</p>
      )}
    </div>
  );
}

function Freshness({ status }: { status: string }) {
  const map: Record<string, string> = {
    fresh: "bg-green-100 text-green-700",
    stale: "bg-amber-100 text-amber-700",
    computing: "bg-blue-100 text-blue-700",
    error: "bg-red-100 text-red-700",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${map[status] ?? "bg-neutral-100 text-neutral-600"}`}>{status}</span>;
}

function TargetBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-neutral-500">
        <span>Goal: {target}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-100">
        <div className={`h-full ${pct >= 100 ? "bg-green-500" : "bg-neutral-800"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

function Sparkbars({ series, label }: { series: Array<{ bucket: string; value: number }>; label: string }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    <>
      <p className="mt-2 text-2xl font-semibold">{label}</p>
      <div className="mt-3 flex h-16 items-end gap-1">
        {series.map((s) => (
          <div
            key={s.bucket}
            title={`${s.bucket}: ${s.value}`}
            className="flex-1 rounded-t bg-neutral-800"
            style={{ height: `${Math.max((s.value / max) * 100, 4)}%` }}
          />
        ))}
      </div>
    </>
  );
}

function GroupBars({ groups, tile }: { groups: Array<{ label: string; value: number }>; tile: Tile }) {
  const max = Math.max(1, ...groups.map((g) => g.value));
  return (
    <div className="mt-3 space-y-1.5">
      {groups.slice(0, 6).map((g) => (
        <div key={g.label}>
          <div className="mb-0.5 flex justify-between text-sm">
            <span className="text-neutral-700">{g.label}</span>
            <span className="text-neutral-500">{fmt(g.value, tile)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-neutral-100">
            <div className="h-full bg-neutral-800" style={{ width: `${Math.max((g.value / max) * 100, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
