import { formatMetricValue } from "@/lib/format";
import type { ChartFormat, GroupRow } from "@/components/charts";

/**
 * ONE BAR PER GROUP — DELIBERATELY HTML, NOT SVG.
 *
 * This mark is a labelled list, and a list is what HTML is for: the labels
 * truncate with CSS, the values sit in a `tnum` column that lines up, and the
 * rows scroll. `GroupBars` in charts.tsx proved the form; what this adds is
 * FULL MODE — no four-row cap, because the tile's own height was chosen by
 * the person looking at it.
 *
 * Rows SCROLL rather than shrink. Thirty groups squeezed into six rows of
 * height is thirty unreadable slivers; thirty groups in a scroller is a list
 * you can read, inside a box you sized. The funnel branch already made this
 * call, and the tile's height is the contract either way.
 */
export function BarsHorizontal({
  groups,
  format,
  accent,
  sort = "stored",
  limit,
}: {
  groups: GroupRow[];
  format: ChartFormat;
  accent: string;
  sort?: "stored" | "value_desc" | "value_asc" | "label_asc";
  limit?: number;
}) {
  const ordered =
    sort === "stored"
      ? groups
      : [...groups].sort((a, b) =>
          sort === "value_desc"
            ? b.value - a.value
            : sort === "value_asc"
              ? a.value - b.value
              : a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }),
        );
  const shown = limit ? ordered.slice(0, limit) : ordered;
  const max = Math.max(1, ...shown.map((g) => g.value));

  return (
    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto quiet-scroll">
      {shown.map((g) => (
        <div key={g.label} className="flex items-center gap-2" data-tip={`${g.label} · ${formatMetricValue(g.value, format)}`}>
          <span className="min-w-0 max-w-24 flex-1 truncate text-tiny text-muted-foreground" title={g.label}>
            {g.label}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max((g.value / max) * 100, 2)}%`, background: accent }}
            />
          </span>
          <span className="tnum max-w-24 shrink-0 truncate text-right text-tiny text-foreground" title={formatMetricValue(g.value, format)}>
            {formatMetricValue(g.value, format)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What a limited list owes the reader — the sentence `GroupBars` already writes. */
export function groupsFooter(groups: GroupRow[], limit?: number, total?: number | null): string | null {
  if (!limit || groups.length <= limit) return null;
  return `Top ${limit} of ${groups.length}${total != null ? " — the number above counts them all" : ""}.`;
}
