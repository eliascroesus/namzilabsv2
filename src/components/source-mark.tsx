import { brandNeedsDarkInk, sourceStyle } from "@/components/flow/controls/source-style";
import { BrandLogo } from "@/components/brand-logo";
import { SOURCE_LOGOS } from "@/connectors/logos";

/**
 * A connector's brand tile, at list scale.
 *
 * The flows list has carried these since it was built, and the dashboard's
 * activity feed did not — so the same six connectors were instantly scannable
 * on one screen and a column of grey words on the next. Rows are read by
 * shape before they are read by word.
 *
 * Server-safe: `sourceStyle` is a pure lookup and `SOURCE_LOGOS` is a frozen
 * map of path strings, so this renders inside the server-rendered dashboard
 * without pulling the builder's client-side `NodeIcon` (and its whole icon set)
 * into the page's bundle.
 *
 * ═══ TWO SHAPES, AND WHICH ONE DEPENDS ON WHETHER A MARK EXISTS ═══
 *
 * Ten of the catalogue's connectors have a real logo (Simple Icons, CC0-1.0,
 * committed by `scripts/fetch-logos.mjs`). Those are drawn BARE, at full size,
 * in the brand's own colour — the thing a person recognises before reading any
 * label. The other twenty-one have no redistributable mark and keep the
 * brand-coloured tile with two letters, because a glyph carries its own
 * silhouette and an abbreviation does not.
 *
 * ═══ THE INK ON THAT TILE IS COMPUTED, AND IT USED NOT TO BE ═══
 *
 * This said `text-white` unconditionally. `brandNeedsDarkInk` has existed the
 * whole time — its threshold the exact luminance where white and black are
 * equally legible — and only the two MARKETING components ever called it. So
 * Mailchimp's `#FFE01B` tile rendered white on yellow at 1.26:1 inside the
 * product: a blank yellow dot that reads as a failed image.
 */
export function SourceMark({
  source,
  size = 20,
  radius,
  className,
}: {
  source?: string | null;
  size?: number;
  /**
   * Corner, for the one caller that needs a circle.
   *
   * The landing marquee draws these as pills and the rest of the product draws
   * them as squircles — the same mark in two frames. Everything else about the
   * tile stays this component's business; opening the radius is what let the
   * marketing pages stop keeping their own copy of it.
   */
  radius?: number | string;
  /** Layout only — the mark's own colour and type are not the caller's. */
  className?: string;
}) {
  const s = sourceStyle(source);
  const logo = source ? SOURCE_LOGOS[source] : undefined;
  /**
   * A LOGO IS DRAWN BARE, IN THE BRAND'S OWN COLOUR. The tile is for letters.
   *
   * The mark used to be a brand-coloured square with a white glyph knocked out
   * of it, which made every app the same object in a different colour. A real
   * logo IS the recognisable thing — Calendly's blue C is recognised before any
   * label is read — so it gets the space the square was taking and the colour
   * the square was wearing.
   *
   * THE TWO LETTERS KEEP THEIR TILE, and that is not an inconsistency left by
   * accident. A glyph carries its own silhouette; two letters floating on a
   * page are just small text, and the twenty-one connectors with no published
   * mark would go from a recognisable chip to an unreadable abbreviation. The
   * tile is what makes them a mark at all.
   */
  if (logo) return <BrandLogo source={source} size={size} className={className} />;

  const ink = brandNeedsDarkInk(s.color) ? "text-neutral-950" : "text-white";
  return (
    <span
      aria-hidden
      title={s.label}
      className={`inline-flex shrink-0 items-center justify-center font-semibold ${ink}${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        // The same proportional corner the builder's NodeIcon uses, so one
        // connector wears the same mark at every size in the product.
        borderRadius: radius ?? Math.max(4, Math.round(size * 0.3)),
        backgroundColor: s.color,
        fontSize: Math.max(9, Math.round(size * 0.42)),
      }}
    >
      {s.short}
    </span>
  );
}
