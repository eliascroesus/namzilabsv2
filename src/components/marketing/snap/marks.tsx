import { SourceMark } from "@/components/source-mark";
import styles from "@/app/snap.module.css";

/**
 * THE SOURCE MARKS ARE THE PRODUCT'S OWN, NOT THE LANDING PAGE'S.
 *
 * This file used to draw its own coloured squircles holding two letters, in a
 * five-colour palette invented for the marketing page. That made every app the
 * same object in a different colour — and the product already solves this
 * properly: eighteen of the thirty-three connectors ship a real mark (Simple
 * Icons and official files, committed by `scripts/fetch-logos.mjs`), drawn
 * BARE in the brand's own colour, and the other fifteen keep a brand-coloured
 * tile with their two letters because a glyph carries a silhouette and an
 * abbreviation does not.
 *
 * So the landing page now calls `SourceMark` — the same component the flows
 * list and the activity feed use. Calendly's blue C is recognised before any
 * label is read, which is the entire job this element has on a page whose
 * second question is "is my stack in there?". It also means a connector added
 * to the catalogue arrives on the marketing page with its real mark, with no
 * edit here at all.
 *
 * `radius` is opened for the rail's pills; everything else about the mark —
 * its colour, its glyph, its letters — is deliberately not this file's
 * business.
 */
export function Mark({
  source,
  size = 40,
  radius,
  className,
}: {
  source: string;
  size?: number;
  radius?: number | string;
  className?: string;
}) {
  return <SourceMark source={source} size={size} radius={radius} className={className} />;
}


/**
 * The tick. Drawn rather than imported, at 2.5px with round caps.
 *
 * It is never the sole carrier of a meaning: every matched state pairs it with
 * a word, so the state survives for a reader who cannot separate the green
 * from the ink.
 */
export function Tick({ size = 16, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg
      aria-hidden
      className={`${styles.tick} ${onDark ? styles.tickOnDark : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="M3.2 8.6 L6.4 11.8 L12.8 4.6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The logo mark: two dots that merge into one when the nav is hovered. Two
 * become one — the product, stated in a logo.
 */
export function LogoMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  /**
   * AN INLINE SVG WITH EXPLICIT WIDTH AND HEIGHT, never a glyph and never a
   * background image.
   *
   * It was three nested spans with absolutely-positioned dots, which depends
   * on the outer span keeping its 28px box. In a flex row with a wordmark
   * beside it that box could collapse, and what shipped was two stray dots
   * sitting on top of the "N" — the wordmark read as "꞉lamzilabs". An SVG with
   * real attributes cannot collapse, and `flex: none` says so twice.
   *
   * `onDark` is the deck's front card: the same mark, tile and dots inverted,
   * rather than the blank grey square that stood in for it while the fold was
   * being built. The hero's one piece of branding should be the brand.
   */
  return (
    <svg
      aria-hidden
      className={`${styles.navMark} ${onDark ? styles.navMarkOnDark : ""}`}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
    >
      <rect width="28" height="28" rx="10" fill="currentColor" />
      <circle className={styles.navDotA} cx="10.5" cy="14" r="3" />
      <circle className={styles.navDotB} cx="17.5" cy="14" r="3" />
    </svg>
  );
}
