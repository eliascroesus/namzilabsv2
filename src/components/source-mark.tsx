import { sourceStyle } from "@/components/flow/controls/source-style";

/**
 * A connector's brand tile, at list scale.
 *
 * The flows list has carried these since it was built, and the dashboard's
 * activity feed did not — so the same six connectors were instantly scannable
 * on one screen and a column of grey words on the next. Rows are read by
 * shape before they are read by word.
 *
 * Server-safe: `sourceStyle` is a pure lookup, so this renders inside the
 * server-rendered dashboard without pulling the builder's client-side
 * `NodeIcon` (and its whole icon set) into the page's bundle.
 */
export function SourceMark({
  source,
  size = 20,
  className,
}: {
  source?: string | null;
  size?: number;
  /** Layout only — the mark's own colour, radius and type are not the caller's. */
  className?: string;
}) {
  const s = sourceStyle(source);
  return (
    <span
      aria-hidden
      title={s.label}
      className={`inline-flex shrink-0 items-center justify-center font-semibold text-white${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        // The same proportional corner the builder's NodeIcon uses, so one
        // connector wears the same mark at every size in the product.
        borderRadius: Math.max(4, Math.round(size * 0.3)),
        backgroundColor: s.color,
        fontSize: Math.max(9, Math.round(size * 0.42)),
      }}
    >
      {s.short}
    </span>
  );
}
