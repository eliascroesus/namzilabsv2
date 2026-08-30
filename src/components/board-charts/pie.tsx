import { formatMetricValue } from "@/lib/format";
import { arcPath, pieSlices } from "@/lib/board/scale";
import { sliceAccent } from "@/lib/board/tile-config";
import type { ChartFormat, GroupRow } from "@/components/charts";

/**
 * SHARES OF A WHOLE — the one aspect-locked mark in the kit.
 *
 * Every other chart stretches to its box: a line squeezed vertically is still
 * that line, read against its own axis. A squeezed CIRCLE is an ellipse, and
 * an ellipse encodes angle dishonestly — the same 25% looks larger at the
 * equator than at the pole. So this one keeps `xMidYMid meet` and letterboxes,
 * which is the correct trade for the one shape whose geometry IS the claim.
 *
 * NO TEXT IN THE SVG. The legend is HTML beside or beneath the circle, which
 * is also what lets a long group name truncate rather than overflow the box.
 *
 * COLOUR IS NEVER THE ONLY ENCODING: every slice carries a 2px card-coloured
 * gap and a legend row with its own name and figure, so the chart survives
 * being read by someone who cannot separate two of the hues.
 */
export function PieChart({
  groups,
  format,
  donut = false,
  limit = 6,
  legend = "right",
}: {
  groups: GroupRow[];
  format: ChartFormat;
  donut?: boolean;
  limit?: number;
  legend?: "right" | "bottom" | "none";
}) {
  const { slices, total } = pieSlices(groups, limit);
  if (slices.length === 0) return null;

  const pct = (share: number) => formatMetricValue(share * 100, { format: "percent", precision: 0 });

  return (
    <div className={`flex min-h-0 flex-1 gap-3 ${legend === "bottom" ? "flex-col" : "items-center"}`}>
      <svg
        className={legend === "bottom" ? "h-full min-h-0 w-full" : "h-full w-auto shrink-0"}
        viewBox="-52 -52 104 104"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {slices.map((s, i) => (
          <path
            key={s.label}
            d={arcPath(50, s.a0, s.a1)}
            fill={sliceAccent(i, s.label)}
            /* The gap is a second encoding, not decoration — it keeps two
               adjacent hues separable for a reader who cannot tell them apart. */
            stroke="var(--color-card)"
            strokeWidth="2"
            data-tip={`${s.label} · ${formatMetricValue(s.value, format)} (${pct(s.share)})`}
          />
        ))}
        {donut && <circle r="24" fill="var(--color-card)" />}
      </svg>

      {legend !== "none" && (
        <div className="min-h-0 min-w-0 flex-1 space-y-1 overflow-y-auto quiet-scroll">
          {slices.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: sliceAccent(i, s.label) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={s.label}>
                {s.label}
              </span>
              <span className="tnum shrink-0 text-xs text-foreground">{formatMetricValue(s.value, format)}</span>
              <span className="tnum w-8 shrink-0 text-right text-xs text-muted-foreground">{pct(s.share)}</span>
            </div>
          ))}
        </div>
      )}
      <span className="sr-only">
        {slices.map((s) => `${s.label}: ${formatMetricValue(s.value, format)} (${pct(s.share)})`).join(", ")}. Total{" "}
        {formatMetricValue(total, format)}.
      </span>
    </div>
  );
}

/** What a pie owes the reader when it could not draw everything it was given. */
export function pieFooter(groups: GroupRow[], limit = 6): string | null {
  const { other, excluded } = pieSlices(groups, limit);
  const parts: string[] = [];
  if (other) parts.push(`${other.count} smaller groups rolled into Other`);
  // Never silent: a share of a whole cannot be negative, and a pie that
  // quietly ate a refund column is a chart lying by omission.
  if (excluded > 0) parts.push(`${excluded} at or below zero can’t be drawn as a share`);
  return parts.length ? `${parts.join(" · ")}.` : null;
}
