import { catalogEntry } from "@/connectors/catalog";

/**
 * Brand styling for data sources, used by the rebuilt control system (pills,
 * data browser, node cards). The colours live on the catalog entry now, so a
 * new connector registers its mark in the same place as everything else;
 * unknown sources fall back to a neutral badge derived from the key.
 */
export type SourceStyle = { label: string; color: string; short: string };

export function sourceStyle(source?: string | null): SourceStyle {
  const entry = source ? catalogEntry(source) : undefined;
  if (entry?.brand) return { label: entry.brand.label ?? entry.name, color: entry.brand.color, short: entry.brand.short };
  const key = (source ?? "").trim();
  return { label: key || "App", color: "#64748B", short: (key || "ap").slice(0, 2).replace(/^\w/, (c) => c.toUpperCase()) };
}

/**
 * WHETHER A BRAND MARK NEEDS DARK INK ON IT.
 *
 * Thirty-one connectors carry the vendor's own colour on a 24px disc holding
 * two letters, and white initials are not always the answer: Mailchimp's
 * #FFE01B measures 1.26:1 against white — a blank yellow dot, which reads as a
 * loading state rather than as a mark.
 *
 * THE THRESHOLD IS THE CROSSOVER, 0.179, and not a number chosen by eye. That
 * is the luminance at which white and black are EXACTLY as legible on a colour
 * (both 4.58:1), so picking the lighter side of it guarantees at least 4.58:1
 * on any colour whatsoever — including the connector nobody has added yet.
 * `tests/brand-ink.test.ts` asserts that as an invariant over the whole
 * catalogue rather than as a list of known-bad hexes, because a list is what
 * falls behind when connector thirty-two arrives in a pale orange.
 *
 * The first version of this used 0.45, reasoning that a mark which merely
 * PASSES reads as murky at 24px. It was solving the wrong problem: ten marks —
 * Close's #1E88E5, Whop's #FF6243, Aircall's #00B388 among them — sat between
 * the two numbers, and every one of them got white ink at 2.7-3.7:1 when black
 * would have given 5.7-8.0:1. Comfort is not worth choosing the worse of two
 * inks.
 */
export function brandNeedsDarkInk(color: string): boolean {
  const hex = color.replace("#", "");
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.179;
}

/**
 * THE SAME QUESTION FOR A LOGO, WHICH HAS A DIFFERENT ANSWER.
 *
 * `brandNeedsDarkInk` above is about TWO LETTERS — small text, so the bar is
 * WCAG's 4.5:1 and the threshold is the crossover where white and black are
 * equally legible (0.179). That is the right rule for type and the wrong one
 * for a glyph: it turns fourteen of thirty-one tiles dark, including Shopify,
 * Google Calendar and Google Sheets, whose marks everyone recognises as white
 * on their own colour.
 *
 * A LOGO IS NOT TEXT. WCAG's floor for a graphical object is 3:1, and white
 * clears that on every tile up to a luminance of 0.30 — measured across the
 * whole catalogue, that is twenty-five of them. The six that genuinely cannot
 * take white are Whop (2.97:1), Aircall (2.69), ThriveCart (2.03), Airtable
 * (1.80), Paddle (1.35) and Mailchimp (1.32), and those are the pale ones
 * anybody would expect to be an exception.
 *
 * So: white unless white would fall below 3:1. Derived, not chosen —
 * `1.05 / (L + 0.05) >= 3` solves to `L <= 0.30`.
 */
export function glyphNeedsDarkInk(color: string): boolean {
  const hex = color.replace("#", "");
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.3;
}
