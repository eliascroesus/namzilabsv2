/**
 * THE STEP PALETTE, IN A PLAIN MODULE.
 *
 * Deliberately NOT in icons.tsx: that file is a client component and the design
 * page is a server one, so calling into it threw "Attempted to call
 * nodeAccent() from the server". Colour is data, not behaviour.
 *
 * SPACED BY WHAT IS ACTUALLY ON SCREEN. The picker offers seven steps, so those
 * are what the wheel is divided between — an even split across ten keys would
 * have spent three of its gaps on legacy types nobody can add. Keyed by VARIANT
 * where a type has two jobs, which is what lets Summarize and Calculate be
 * addressed separately even though they are one type; today they are set to the
 * same value, and the mechanism is what makes that a decision rather than a
 * limitation.
 *
 * Saturation is pushed near the top of the gamut and lightness is then solved
 * down to the highest value that still clears 3.05:1 against white. That order
 * matters: vividness is what reads as bright, not luminance.
 */
export const NODE_ACCENT: Record<string, string> = {
  time_between: "#F66700", // 25° orange — how long between two events
  app: "#0EAB0E", // 120° green — records come IN
  unite: "#009ED3", // 195° blue — several steps onto one line
  filter: "#8176F9", // 245° indigo — keep only what counts
  // Summarize and Calculate SHARE a colour, on purpose and on request. They are
  // one node type whose operator decides its job — pick a dataset operator and
  // it is a Summarize, pick a two-number one and it is a Calculate — so one
  // colour says "same step, different question" and the glyph says which.
  formula: "#D95FF2", // 290° violet — Summarize
  formula_compare: "#D95FF2", // 290° violet — Calculate
  paths: "#F856A7", // 330° pink — split into branches
  // Retired types, kept so an existing flow still draws. Off the wheel above.
  calculate: "#D95FF2",
  time: "#C88600",
  group: "#71A20D",
  output: "#F76262",
};

/**
 * THE BOARD-GROUP PALETTE — a second vocabulary, in the same file on purpose.
 *
 * A step's colour is IDENTITY: a Filter is always indigo, and the map above is
 * a lookup, not a choice. A group's colour is a LABEL the customer picked for a
 * column they named. Two different jobs, so two different maps — kept in one
 * home because a hex with two homes is exactly the drift this file's check-ui
 * allowlist entry exists to prevent, and because `luminance` is right here.
 *
 * They are a separate const rather than extra keys in NODE_ACCENT because
 * `nodeAccent()` falls through that map by type name: a group hue that happened
 * to answer a node-type lookup is a coincidence waiting to be a bug.
 *
 * TEN HUES, SPACED BY WHAT THE EYE CAN SEPARATE AT DOT SIZE — which is a much
 * stricter test than a swatch. Two hues 15° apart are obviously different at
 * 40px and identical at the 8px dot a column header wears, which is why real
 * yellow (40°) is absent: beside orange (25°) it read as one colour twice.
 *
 * Eight are the step palette's own values, restated rather than re-picked —
 * one green in this product, not two. Only `grey` and `teal` are new, and both
 * are solved the same way everything above is: saturation near the top of the
 * gamut, then lightness down to the highest value still clearing 3.05:1 against
 * white. Teal sits at 168° rather than the 172° that first suggested itself,
 * because 27° of separation from blue survives at dot size and 21° does not.
 *
 * `grey` is the exception to the solve, and deliberately: it is the "no colour"
 * default, so it comes from the kit's own warm neutral ramp
 * (`--color-neutral-500`, the same value `--muted-foreground` uses) rather than
 * being pushed to the contrast edge. A neutral has no vividness to preserve,
 * and the edge-solved version was a washed-out beige that read as a rendering
 * fault next to nine confident hues.
 */
export const GROUP_ACCENT: Record<string, string> = {
  grey: "#6b6660", //  --color-neutral-500, the kit's own warm grey
  red: "#F76262", //   0°
  orange: "#F66700", //  25°
  olive: "#71A20D", //  75°
  green: "#0EAB0E", // 120°
  teal: "#00A786", // 168° — the one real gap in the wheel
  blue: "#009ED3", // 195°
  indigo: "#8176F9", // 245°
  violet: "#D95FF2", // 290°
  pink: "#F856A7", // 330°
};

/** The order the picker offers them in — round the wheel, grey first. */
export const GROUP_COLOR_KEYS = Object.keys(GROUP_ACCENT);

/**
 * The colour a group wears.
 *
 * An unknown key reads as grey and never throws, which is what lets the column
 * store a KEY instead of a hex: re-solving a hue changes every board at once
 * with no backfill, and a key this map has since dropped degrades to the
 * default rather than rendering `undefined` into a style attribute.
 */
export function groupAccent(key: string): string {
  return GROUP_ACCENT[key] ?? GROUP_ACCENT.grey;
}

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
