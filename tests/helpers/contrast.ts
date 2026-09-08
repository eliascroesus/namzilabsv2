/**
 * sRGB RELATIVE LUMINANCE AND CONTRAST RATIO, WCAG 2.x.
 *
 * One home for the arithmetic, for the same reason `node-accent.ts` is the one
 * home for a hex: the kit's design documents are built almost entirely on
 * measured ratios — "#828282 is 4.58:1 on a card", "the lime is 15.53:1 on the
 * page" — and a number each test re-derives is a number that drifts away from
 * the prose defending it.
 *
 * The transfer curve is the part worth stating. A naive implementation averages
 * the three channels and reports mid-grey at 0.5 luminance; the real answer is
 * 0.216, because sRGB is gamma-encoded and green carries 71% of the weight.
 * Every ratio in the kit is wrong by a wide margin if this is done casually,
 * and wrong in the flattering direction — a naive contrast reads HIGHER than
 * the truth, so it passes bars the real colour fails.
 */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an `#rrggbb` colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two `#rrggbb` colours, 1:1 to 21:1.
 *
 * Order-independent: the brighter of the two is always the numerator, so
 * `contrast(ink, ground)` and `contrast(ground, ink)` agree. That matters
 * because half the call sites in this repo read naturally one way and half the
 * other, and a direction-sensitive helper would silently return the reciprocal.
 */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
