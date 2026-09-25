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
export function Tick({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      className={styles.tick}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="M3.2 8.6 L6.4 11.8 L12.8 4.6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
