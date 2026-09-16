import { brandNeedsDarkInk, glyphNeedsDarkInk, sourceStyle } from "@/components/flow/controls/source-style";
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
 * ═══ THE GLYPH WHERE THERE IS ONE, THE INITIALS WHERE THERE IS NOT ═══
 *
 * Thirteen of the catalogue's connectors have a real mark (Simple Icons,
 * CC0-1.0, committed by `scripts/fetch-logos.mjs`); the rest are not published
 * anywhere redistributable and keep their two letters. Both wear the SAME
 * brand-coloured tile at the same radius, so a grid of thirty-one apps reads as
 * one set rather than as two designs — which is the whole reason the glyph is
 * drawn in `currentColor` on the tile instead of as a full-colour logo on
 * white.
 *
 * ═══ THE INK IS COMPUTED, AND IT USED NOT TO BE ═══
 *
 * This said `text-white` unconditionally. `brandNeedsDarkInk` has existed the
 * whole time — with a threshold derived as the exact luminance where white and
 * black are equally legible — but only the two MARKETING components called it.
 * So Mailchimp's `#FFE01B` tile rendered white on yellow at 1.26:1 inside the
 * product: a blank yellow dot that reads as a loading state. Now the same rule
 * decides the ink everywhere, and it covers the glyph as well as the letters.
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
   * THE LETTERS AND THE GLYPH ASK DIFFERENT QUESTIONS.
   *
   * Two letters are small TEXT, so they take the 4.5:1 bar and its crossover
   * threshold. A logo is a graphical object, whose floor is 3:1 — which white
   * clears on twenty-five of the thirty-one tiles, including Shopify and the
   * two Google marks that everyone recognises as white on their own colour.
   * Using the text rule for both is what turned half the grid black.
   */
  const dark = logo ? glyphNeedsDarkInk(s.color) : brandNeedsDarkInk(s.color);
  const ink = dark ? "text-neutral-950" : "text-white";
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
      {logo ? (
        /*
          58% of the tile. A brand glyph drawn edge to edge inside a rounded
          square looks crowded next to a two-letter mark that has its own
          sidebearings, and the two have to sit in the same grid — so the
          optical weight is matched rather than the box.
        */
        <svg
          viewBox="0 0 24 24"
          width={Math.round(size * 0.58)}
          height={Math.round(size * 0.58)}
          fill="currentColor"
          focusable="false"
          aria-hidden
        >
          <path d={logo} />
        </svg>
      ) : (
        s.short
      )}
    </span>
  );
}
