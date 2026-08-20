/**
 * THE STEP PALETTE, IN A PLAIN MODULE.
 *
 * Deliberately NOT in icons.tsx: that file is a client component and the design
 * page is a server one, so calling into it threw "Attempted to call
 * nodeAccent() from the server". Colour is data, not behaviour.
 *
 * SPACED BY WHAT IS ACTUALLY ON SCREEN. The picker offers seven steps, so those
 * seven are what the wheel is divided between — an even split across ten keys
 * would have spent three of its gaps on legacy types nobody can add, and left
 * Summarize and Calculate a shade apart because they happen to share a node
 * type. They are keyed by VARIANT where a type has two jobs.
 *
 * Saturation is pushed near the top of the gamut and lightness is then solved
 * down to the highest value that still clears 3.05:1 against white. That order
 * matters: vividness is what reads as bright, not luminance.
 */
export const NODE_ACCENT: Record<string, string> = {
  formula_compare: "#F66700", // 25° orange — Calculate
  time_between: "#F2C200", // 50° yellow — how long between two events
  app: "#0EAB0E", // 120° green — records come IN
  unite: "#009ED3", // 195° blue — several steps onto one line
  filter: "#8176F9", // 245° indigo — keep only what counts
  formula: "#D95FF2", // 290° violet — Summarize
  paths: "#F856A7", // 330° pink — split into branches
  // Retired types, kept so an existing flow still draws. Off the wheel above.
  calculate: "#F66700",
  time: "#C88600",
  group: "#71A20D",
  output: "#F76262",
};

/** Relative luminance, sRGB. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}

/**
 * THE GLYPH IS WHITE UNLESS WHITE CANNOT BE READ.
 *
 * Every tile carried a white glyph, which quietly capped how bright any of them
 * could be: real yellow under white is about 2:1, so "make Time between yellow"
 * could only ever produce olive. Rather than compromise the colour, the rule is
 * stated — a hue that cannot hold white gets its own dark end instead, and the
 * tile gets to be the colour it was asked to be.
 *
 * One rule, applied by measurement, so the next bright hue added here does the
 * right thing without anyone remembering this.
 */
export function glyphInk(accent: string): string {
  const contrast = 1.05 / (luminance(accent) + 0.05);
  return contrast >= 3 ? "#ffffff" : `color-mix(in srgb, ${accent} 26%, #1a1400)`;
}

/** The colour a step wears. `variant` wins where one node type has two jobs. */
export function nodeAccent(type: string, variant?: string | null): string {
  return (variant && NODE_ACCENT[variant]) || NODE_ACCENT[type] || "#64748B";
}
