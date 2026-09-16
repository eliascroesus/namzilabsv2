import { logoColor, sourceStyle } from "@/components/flow/controls/source-style";
import { SOURCE_LOGOS } from "@/connectors/logos";

/**
 * A CONNECTOR'S REAL MARK, DRAWN ONCE.
 *
 * `SourceMark` and the flow builder's `NodeIcon` both used to spell this out —
 * the same `viewBox="0 0 24 24"`, the same `fill={logoColor(...)}`, the same
 * single `<path>` — because they need the same glyph with DIFFERENT fallbacks:
 * the mark falls back to the brand's two letters, a node falls back to the
 * step's green tile. Sharing the fallback was impossible, so the glyph got
 * copied, and then the multi-colour change would have had to be made twice.
 *
 * It returns `null` when a brand has no mark, so each caller keeps its own
 * fallback and neither has to know how a logo is stored.
 *
 * ═══ MONOCHROME AND OFFICIAL ARE DIFFERENT THINGS ═══
 *
 * A Simple Icons glyph is a silhouette: one path, no colour of its own, meant
 * to be painted. Those carry `currentColor` and take the brand's colour from
 * the catalogue — darkened by `logoColor` only as far as it takes to stay
 * visible on a light card, which is why Mailchimp's yellow is still yellow.
 *
 * AN OFFICIAL MARK IS NOT PAINTABLE. Google Calendar is a white page inside a
 * blue, green, yellow and red frame; Google Sheets is a green page with a white
 * grid knocked out of it. Those colours are the logo. Running them through
 * `logoColor` — or through any single-fill render — collapses four colours into
 * one, which is exactly what made the owner say "the google calendar thing is
 * not correct colors ... keep the logos 1:1 to what they are normally". So a
 * path that shipped with a fill KEEPS it, untouched, and only `currentColor`
 * paths are painted.
 *
 * ═══ THE BOX IS SQUARE; THE MARK NEED NOT BE ═══
 *
 * Every mark used to be assumed 24×24. Whop's is `0 0 383.2 196.4` — twice as
 * wide as it is tall — and forcing that into a square viewport would shear it.
 * `preserveAspectRatio` (the default, spelled out because this is the one place
 * it is load-bearing) fits the mark inside the square and centres it, so a wide
 * logo is drawn wide and short rather than squashed.
 */
export function BrandLogo({
  source,
  size = 20,
  className,
}: {
  source?: string | null;
  /** The square the mark is fitted into. A wide mark fills the width. */
  size?: number;
  className?: string;
}) {
  const logo = source ? SOURCE_LOGOS[source] : undefined;
  if (!logo) return null;
  const s = sourceStyle(source);
  /** Only ever reaches a `currentColor` path — see the note above. */
  const ink = logoColor(s.color);
  return (
    <svg
      viewBox={logo.viewBox}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      className={`inline-block shrink-0${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={s.label}
      focusable="false"
    >
      <title>{s.label}</title>
      {logo.paths.map((p, i) => (
        // Index keys: this list is a fixed, ordered drawing, never reordered or
        // filtered — the paint order IS the mark.
        <path key={i} d={p.d} fill={p.fill === "currentColor" ? ink : p.fill} />
      ))}
    </svg>
  );
}
