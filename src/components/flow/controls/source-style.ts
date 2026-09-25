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
 * THE COLOUR A BARE LOGO IS DRAWN IN — the brand's own, darkened only when its
 * own is invisible.
 *
 * The marks used to sit on a tile of the brand's colour, which gave them a
 * guaranteed ground. Drawn bare on the page they inherit whatever surface they
 * land on, and measured against this product's light surface five of the ten
 * fail WCAG's 3:1 floor for a graphical object — Mailchimp at 1.19:1 and
 * Paddle at 1.22:1 are not "low contrast", they are a yellow smudge on white.
 *
 * SO THE HUE IS KEPT AND THE LIGHTNESS IS SPENT. Each channel is scaled toward
 * black until the colour clears 3:1 on the light surface, which leaves
 * Mailchimp unmistakably Mailchimp-yellow and merely darker. Six of the ten
 * are untouched because they already pass.
 *
 * ONE VALUE FOR BOTH THEMES, deliberately. Darkening raises contrast on a
 * light ground and lowers it on a dark one, so the question is whether the
 * adjusted colour still clears 3:1 on near-black — and it does, comfortably:
 * a colour at the light-surface threshold sits around 0.30 luminance, which is
 * better than 6:1 against `#121212`. A second per-theme value would buy
 * nothing and would have to be right on the `mix` theme, where the rail is
 * dark and the board is light at the same time.
 */
export function logoColor(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return color;
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lumOf = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  /** The product's light working surface. */
  const SURFACE = lin(0xf3) * 0.2126 + lin(0xf3) * 0.7152 + lin(0xf3) * 0.0722;
  const contrast = (l: number) => (Math.max(l, SURFACE) + 0.05) / (Math.min(l, SURFACE) + 0.05);

  if (contrast(lumOf(rgb)) >= 3) return color;
  /**
   * Scale toward black in small steps rather than solving for it: the transfer
   * curve is not linear, and stepping stops at the FIRST value that clears the
   * bar, which is the least the brand's colour has to be changed.
   */
  for (let k = 0.95; k > 0; k -= 0.05) {
    const scaled = rgb.map((c) => Math.round(c * k));
    if (contrast(lumOf(scaled)) >= 3) {
      return `#${scaled.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#000000";
}

/**
 * THE SAME ONE-COLOUR MARK ON A DARK GROUND — its own colour where that is
 * visible on the dark theme's `#121212`, white where it is not.
 *
 * `logoColor` answers for the light surface and argues one value can serve
 * both themes, which holds for every colour that is bright enough to need
 * darkening. It does not hold for a mark that is ALREADY near-black: Retell's
 * navy `#00122E` is 1.1:1 against `#121212`, a logo that is simply not there.
 * White is what vendors ship as their own reversed mark, so a silhouette that
 * fails 3:1 on the dark ground is drawn white there; one that passes keeps its
 * colour. Only ever applied to a mark known to be ONE colour (an uploaded SVG
 * whose paint the build read) — a multi-colour logo is never recoloured.
 */
export function logoColorOnDark(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return color;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const GROUND = lin(0x12);
  return (lum + 0.05) / (GROUND + 0.05) >= 3 ? color : "#ffffff";
}

