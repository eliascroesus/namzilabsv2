/**
 * A STAND-IN MARK, AND IT SAYS SO.
 *
 * ═══ THIS IS NOT THE LOGO ═══
 *
 * The owner is sending a real one. Until it arrives there is no mark anywhere
 * in this repository — no `public/`, no favicon, no SVG — and the nav was the
 * word "Namzilabs" set in a font, which is the single biggest reason a page can
 * look unfinished however good the layout is. This fills that slot and is meant
 * to be deleted.
 *
 * WHEN THE REAL ONE ARRIVES: replace the contents of this file and nothing
 * else. Every caller passes only `className`, so a mark of any proportion can
 * take its place as long as it draws inside a square viewBox and paints with
 * `currentColor` where it wants to inherit ink.
 *
 * ═══ WHAT IT DRAWS, AND WHY THIS SHAPE ═══
 *
 * Four stars and the three lines that join them: the smallest constellation
 * that is unmistakably a constellation rather than a scatter. It is the hero's
 * own argument at 24px — scattered points somebody joined into one figure — so
 * the mark and the sky are saying the same thing, which is what a logo is for.
 *
 * The brightest star is the one at the end of the chain, because the product's
 * claim is that the LAST point is the one worth having: three sources and then
 * the figure they resolve to.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      {/* The joins, drawn under the stars so no line crosses a point. At 24px
          a stroke over its own node reads as a scratch. */}
      <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.25" strokeLinecap="round">
        <line x1="4.5" y1="17.5" x2="9.5" y2="8" />
        <line x1="9.5" y1="8" x2="15" y2="14.5" />
        <line x1="15" y1="14.5" x2="19.5" y2="5.5" />
      </g>

      {/* THE THREE SOURCES — same size, same ink, because none of them is more
          right than the others. That is the page's whole argument about
          Calendly, Close and a spreadsheet. */}
      <circle cx="4.5" cy="17.5" r="1.6" fill="currentColor" fillOpacity="0.75" />
      <circle cx="9.5" cy="8" r="1.6" fill="currentColor" fillOpacity="0.75" />
      <circle cx="15" cy="14.5" r="1.6" fill="currentColor" fillOpacity="0.75" />

      {/* THE RESOLVED FIGURE — bigger, fully opaque, and the only one with a
          halo. It is the number you walk into the meeting with. */}
      <circle cx="19.5" cy="5.5" r="4.4" fill="currentColor" fillOpacity="0.14" />
      <circle cx="19.5" cy="5.5" r="2.4" fill="currentColor" />
    </svg>
  );
}
