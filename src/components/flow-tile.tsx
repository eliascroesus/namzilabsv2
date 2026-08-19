import Link from "next/link";
import { formatMetricValue, relativeTime } from "@/lib/format";
import { refreshFlowAction } from "@/app/dashboard/flows/actions";
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
      <div className="rounded-lg border border-neutral-200 p-5">
        <div className="flex items-start justify-between">
          <h3 className="font-medium text-foreground">{stored.name ?? `Output ${row.outputNodeId.slice(0, 8)}`}</h3>
          <Link href={`/dashboard/flows/${row.flowId}`} className="text-xs text-blue-600 hover:underline">
            Open →
          </Link>
        </div>
        {/* An em-dash, not a 0: "no answer for this period" and "the answer is
            zero" are different facts, and the tile that conflates them is the
            one nobody can trust. */}
        <p className="mt-2 text-4xl font-semibold text-neutral-300">—</p>
        <p className="mt-2 text-sm text-neutral-500">No data for this period.</p>
        <p className="mt-1 text-xs text-neutral-400" title={unavailable}>
          {unavailable.length > 120 ? `${unavailable.slice(0, 120)}…` : unavailable}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-start justify-between">
        {/* A row whose tile jsonb is null has never computed successfully, so
            there is no stored name — the output id is the only honest handle. */}
        <h3 className="font-medium text-foreground">{t.name ?? `Output ${row.outputNodeId.slice(0, 8)}`}</h3>
        <div className="flex items-center gap-2">
          <Freshness status={row.status} />
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={row.flowId} />
            <button
              type="submit"
              className="text-xs text-neutral-500 hover:text-foreground hover:underline"
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
        <Sparkbars series={t.series} label={fmt(t.value, t)} tile={t} />
      ) : t.groups && t.groups.length > 0 ? (
        <GroupBars groups={t.groups} tile={t} />
      ) : (
        <>
          <p className="tnum mt-2 text-4xl font-semibold">{fmt(t.value, t)}</p>
          {t.target != null && <TargetBar value={t.value ?? 0} target={t.target} tile={t} />}
        </>
      )}

      {/* The red pill alone says "broken" while withholding WHY. The stored
          message names the failing node's error — truncated here, complete in
          the title attribute (the same trick the timestamp below uses). */}
      {row.status === "error" && row.error && (
        <p className="mt-2 text-sm text-red-700" title={row.error}>
          {row.error.length > 200 ? `${row.error.slice(0, 200)}…` : row.error}{" "}
          <Link href={`/dashboard/flows/${row.flowId}`} className="underline">
            Fix in the editor →
          </Link>
        </p>
      )}

      {/* A record with no date in this metric's time reference belongs to no
          period, so it is in "All time" and in none of the pills. Saying so is
          the same rule the import bar follows: a number that leaves data out
          has to admit it, or the gap reads as an answer. */}
      {windowed?.undated ? (
        <p className="mt-2 text-xs text-amber-700">
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
        <p className="mt-3 text-xs text-neutral-400" title={new Date(row.computedAt).toLocaleString()}>
          Updated {relativeTime(new Date(row.computedAt))}
        </p>
      )}
    </div>
  );
}

function Freshness({ status }: { status: string }) {
  // Plain English, not internal states — "stale" reads as broken to a
  // customer when it means "a refresh is on its way".
  const meta: Record<string, { cls: string; label: string }> = {
    fresh: { cls: "bg-green-100 text-green-700", label: "Up to date" },
    stale: { cls: "bg-amber-100 text-amber-700", label: "Refreshing soon" },
    computing: { cls: "bg-blue-100 text-blue-700", label: "Computing…" },
    error: { cls: "bg-red-100 text-red-700", label: "Error" },
  };
  const m = meta[status] ?? { cls: "bg-neutral-100 text-neutral-600", label: status };
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

function TargetBar({ value, target, tile }: { value: number; target: number; tile: Tile }) {
  const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-neutral-500">
        {/* The goal is shown in the metric's own format ("Goal: 90%", "Goal: $1,500"). */}
        <span>Goal: {fmt(target, tile)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-100">
        <div className={`h-full ${pct >= 100 ? "bg-green-500" : "bg-neutral-800"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

function Sparkbars({ series, label, tile }: { series: Array<{ bucket: string; value: number }>; label: string; tile: Tile }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    <>
      <p className="tnum mt-2 text-2xl font-semibold">{label}</p>
      <div className="mt-3 flex h-16 items-end gap-1">
        {series.map((s) => (
          <div
            key={s.bucket}
            // The bar's own value, in the tile's own format. A raw number here
            // contradicted the headline directly above it — "4h 44m" over bars
            // whose tooltips read "284.6", the same quantity said two ways.
            title={`${s.bucket}: ${fmt(s.value, tile)}`}
            className="flex-1 rounded-t bg-neutral-800"
            style={{ height: `${Math.max((s.value / max) * 100, 4)}%` }}
          />
        ))}
      </div>
    </>
  );
}

function GroupBars({ groups, tile }: { groups: Array<{ label: string; value: number }>; tile: Tile }) {
  const SHOW = 6;
  const shown = groups.slice(0, SHOW);
  const max = Math.max(1, ...shown.map((g) => g.value));
  return (
    <>
      {/* The metric over EVERY record. Bars alone read as "these six are the
          whole number", and the cut-note below needs a visible total to be
          about. */}
      {tile.value != null && <p className="tnum mt-2 text-2xl font-semibold">{fmt(tile.value, tile)}</p>}
      <div className="mt-3 space-y-1.5">
        {shown.map((g) => (
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
        {/* A cut the tile makes is a cut the tile has to admit — six bars read
            as "all of them" when there were eleven. */}
        {groups.length > shown.length && (
          <p className="text-xs text-neutral-400">
            Showing the {shown.length} largest of {groups.length} groups{tile.value != null ? " — the number above includes them all" : ""}.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * "Still importing — covering 12 of 90 days."
 *
 * Days rather than a percentage of records, for the reason the plan gives: the
 * denominator of a record count is how many exist in the window, which is
 * unknowable until the import finishes. Days covered is a number we actually
 * have.
 *
 * The bar is clamped to the target so a stream that reached further than asked
 * cannot render past its own end.
 */
function ImportProgress({ importing }: { importing: ImportCoverage }) {
  const day = 86_400_000;
  const target = Math.max(1, Math.round(importing.targetMs / day));
  // Floored, like the Test note: rounding the numerator renders a 100%-full bar
  // captioned "still importing", which is a contradiction the user has to
  // resolve, and they resolve it by believing the bar.
  const covered = Math.min(target, Math.max(0, Math.floor(importing.coveredMs / day)));
  // The bar itself is capped below full for the same reason — an import that is
  // still running has not finished, whatever the rounding says.
  const pct = Math.min(99, Math.max(0, Math.round((covered / target) * 100)));
  return (
    <div className="mt-3">
      <div className="h-1 w-full overflow-hidden rounded-full bg-amber-100">
        <div className="h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-amber-700">
        Still importing — covering {covered} of {target} days. This number can still grow.
      </p>
    </div>
  );
}
