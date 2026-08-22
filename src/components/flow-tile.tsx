import Link from "next/link";
import { formatDateTime, formatMetricValue, relativeTime } from "@/lib/format";
import { refreshFlowAction } from "@/app/dashboard/flows/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill, type StatusPillProps } from "@/components/ui/badge";
import { GroupBars, ImportProgress, Sparkbars, TargetBar } from "@/components/charts";
import type { ImportCoverage } from "@/connectors/types";

/**
 * The stored tile, as this component reads it. Kept in step with `TileSpec`
 * in lib/flow/types — this used to omit "duration" from `format` and omit
 * `durationDisplay` entirely, which cost nothing at runtime (the row is cast
 * from `unknown` and the fields ride through the spread into
 * `formatMetricValue`) and was a type that disagreed with its own data: the
 * next person to build a Tile literal would have dropped both, and a
 * speed-to-lead would have published as a bare number again.
 */
type Tile = {
  name?: string;
  description?: string;
  viz?: string;
  format?: "number" | "percent" | "currency" | "duration";
  unit?: string;
  durationDisplay?: string;
  currency?: string;
  precision?: number;
  target?: number | null;
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  groups?: Array<{ label: string; value: number }>;
  byRange?: Record<
    string,
    {
      value?: number;
      series?: Array<{ bucket: string; value: number }>;
      groups?: Array<{ label: string; value: number }>;
      unavailable?: string;
      undated?: number;
    }
  >;
};

export type FlowResultRow = {
  flowId: string;
  outputNodeId: string;
  tile: unknown;
  status: string;
  /**
   * What broke, when status is "error" — materializeFlow stores the failing
   * node's message on the row. A tile that shows a red pill and nothing else
   * tells the customer their number is broken while withholding the one fact
   * they could act on.
   */
  error: string | null;
  computedAt: Date | null;
  /**
   * Phase 8 — set when a stream this number was computed from is still reaching
   * backwards through history. Joined at render time, never stored on the row,
   * so every flow on one importing stream says the same thing.
   */
  importing?: ImportCoverage;
};

function fmt(value: number | undefined, t: Tile): string {
  return formatMetricValue(value, t);
}

/** Renders one materialized flow Output as a dashboard tile. */
export function FlowTile({ row, rangeKey }: { row: FlowResultRow; rangeKey?: string }) {
  const stored = (row.tile ?? {}) as Tile;
  /**
   * The dashboard's range, applied. Every range was derived from the run the
   * materializer already did (see `tileByRange`), so switching pills is a
   * lookup rather than a recompute.
   *
   * THREE STATES, AND THEY MUST STAY DISTINGUISHABLE. A tile written before
   * ranges existed has no `byRange` at all and keeps rendering what it always
   * did. A range that was answered renders its own number. A range that could
   * not be answered — a percentage with nothing in its denominator this
   * morning, most often — renders nothing and says why. Collapsing the last two
   * is what put the all-time figure under the "Today" pill behind a green
   * "Up to date" badge.
   */
  const windowed = rangeKey ? stored.byRange?.[rangeKey] : undefined;
  const missing = rangeKey != null && stored.byRange != null && windowed == null;
  const unavailable = windowed?.unavailable ?? (missing ? "This range has not been computed yet." : undefined);
  const t: Tile = windowed && !unavailable ? { ...stored, value: windowed.value, series: windowed.series, groups: windowed.groups } : stored;
  if (unavailable) {
    return (
      <Card variant="card" className="lift">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-semibold text-foreground">{stored.name ?? `Output ${row.outputNodeId.slice(0, 8)}`}</h3>
          <Link href={`/dashboard/flows/${row.flowId}`} className="text-tiny text-primary hover:underline">
            Open
          </Link>
        </div>
        {/* An em-dash, not a 0: "no answer for this period" and "the answer is
            zero" are different facts, and the tile that conflates them is the
            one nobody can trust. Same stat size as a real number, so switching
            ranges never makes the tile jump. */}
        <p className="tnum mt-2 text-stat font-semibold text-muted-foreground/50">—</p>
        <p className="mt-2 text-base text-muted-foreground">No data for this period.</p>
        <p className="mt-1 text-tiny text-muted-foreground" title={unavailable}>
          {unavailable.length > 120 ? `${unavailable.slice(0, 120)}…` : unavailable}
        </p>
      </Card>
    );
  }
  return (
    <Card variant="card" className="lift">
      <div className="flex items-start justify-between">
        {/* A row whose tile jsonb is null has never computed successfully, so
            there is no stored name — the output id is the only honest handle. */}
        <h3 className="text-base font-semibold text-foreground">{t.name ?? `Output ${row.outputNodeId.slice(0, 8)}`}</h3>
        <div className="flex items-center gap-2">
          <Freshness status={row.status} />
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={row.flowId} />
            {/* The Button's `link` variant, sized down to sit level with the
                "Open" link beside it — a submit, so it stays a real button. */}
            <Button
              type="submit"
              variant="link"
              size="sm"
              className="h-auto p-0 text-tiny"
              title="Recompute this tile now"
            >
              Refresh
            </Button>
          </form>
          <Link href={`/dashboard/flows/${row.flowId}`} className="text-tiny text-primary hover:underline">
            Open
          </Link>
        </div>
      </div>

      {t.series && t.series.length > 0 ? (
        <Sparkbars series={t.series} label={fmt(t.value, t)} format={t} />
      ) : t.groups && t.groups.length > 0 ? (
        <GroupBars groups={t.groups} total={t.value} format={t} />
      ) : (
        <>
          <p className="tnum mt-2 text-stat font-semibold">{fmt(t.value, t)}</p>
          {t.target != null && <TargetBar value={t.value ?? 0} target={t.target} format={t} />}
        </>
      )}

      {/* The red pill alone says "broken" while withholding WHY. The stored
          message names the failing node's error — truncated here, complete in
          the title attribute (the same trick the timestamp below uses). */}
      {row.status === "error" && row.error && (
        <p className="mt-2 text-base text-danger-ink" title={row.error}>
          {row.error.length > 200 ? `${row.error.slice(0, 200)}…` : row.error}{" "}
          <Link href={`/dashboard/flows/${row.flowId}`} className="underline">
            Fix in the editor
          </Link>
        </p>
      )}

      {/* A record with no date in this metric's time reference belongs to no
          period, so it is in "All time" and in none of the pills. Saying so is
          the same rule the import bar follows: a number that leaves data out
          has to admit it, or the gap reads as an answer. */}
      {windowed?.undated ? (
        <p className="mt-2 text-tiny text-warn-ink">
          {windowed.undated} record{windowed.undated === 1 ? "" : "s"} carry no date, so they are counted only in All time.
        </p>
      ) : null}

      {/* Phase 8 — a number computed over an import that is still running is
          accurate and INCOMPLETE, and "Data as of <now>" says only the first
          half. This says the second: a freshly computed tile can cover twelve
          days of a ninety-day window, and without this the timestamp actively
          misleads. */}
      {row.importing && <ImportProgress importing={row.importing} />}

      {/* The honesty marker (G.3): every materialized number says WHEN it was
          true. A stale tile's timestamp shows exactly how far behind it is. */}
      {row.computedAt && (
        <p className="mt-3 text-tiny text-muted-foreground" title={formatDateTime(new Date(row.computedAt))}>
          Updated {relativeTime(new Date(row.computedAt))}
        </p>
      )}
    </Card>
  );
}

function Freshness({ status }: { status: string }) {
  // Plain English, not internal states — "stale" reads as broken to a
  // customer when it means "a refresh is on its way". Transient states are
  // `pending` (neutral), never blue.
  const meta: Record<string, { tone: StatusPillProps["tone"]; label: string }> = {
    fresh: { tone: "success", label: "Up to date" },
    stale: { tone: "warn", label: "Refreshing soon" },
    computing: { tone: "pending", label: "Computing…" },
    error: { tone: "danger", label: "Error" },
  };
  const m = meta[status] ?? { tone: "pending", label: status };
  return <StatusPill tone={m.tone}>{m.label}</StatusPill>;
}
