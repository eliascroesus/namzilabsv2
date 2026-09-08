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
 * ELEVEN HUES ROUND THE WHEEL PLUS A NEUTRAL, spaced evenly rather than picked.
 * It began as the step palette's own seven, which cluster where a FLOW needed
 * them and leave the rainbow lopsided — two blues, no yellow at all. These are
 * every ~30° from red to pink, so the picker reads as a spectrum.
 *
 * EVERY ONE IS SOLVED, NOT CHOSEN — AND THE GROUND THEY ARE SOLVED AGAINST
 * INVERTED ON 8 SEPTEMBER 2026. These used to be the most vivid version of each
 * hue that still cleared 3.05:1 against WHITE, because a group dot and a tile
 * accent sat on a white card. They now sit on #191919.
 *
 * That is not a cosmetic difference, it reverses the direction of the whole
 * solve. On white the bar capped how LIGHT a hue could be, so the rule darkened
 * anything too pale; on near-black it caps how DARK it can be, so the rule
 * lightens anything too deep. Run the old values against the new ground and
 * they technically pass — every one clears 3:1 — but they cluster just above
 * the floor (grey at 3.09:1), which on white was the BRIGHT end of the legal
 * range and here is the dim one. They read as mud.
 *
 * So each hue is taken to the most saturated version that clears the bar with
 * MARGIN rather than the least. Measured on #191919: grey 5.09, red 6.32,
 * orange 7.50, amber 7.75, olive 8.78, green 8.25, teal 8.31, cyan 8.04,
 * blue 7.48, indigo 7.38, violet 7.21, pink 6.89.
 *
 * `amber` stops being the honest cost of the rule, and it is worth recording
 * why. On white, real yellow measures about 1.1:1, so the brightest yellow that
 * could also be an 8px dot was a gold — and naming it amber was more truthful
 * than shipping a yellow nobody could see. On near-black that constraint simply
 * does not exist: yellow is one of the EASIEST hues to clear a dark ground
 * with. The name is kept because a stored key may never change, but the value
 * is no longer apologising for anything.
 *
 * NO KEY IS EVER REMOVED, only added. A group stores the key, so dropping one
 * would silently reset every column wearing it to grey.
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
 * `grey` is the exception to the solve, and deliberately: it is the "no colour"
 * default, so it is a plain neutral rather than a hue pushed to the contrast
 * edge. A neutral has no vividness to preserve, and the edge-solved version was
 * a washed-out beige that read as a rendering fault next to eleven confident
 * hues. It is re-cut for the dark card like everything else here (#8A8A8A,
 * 5.09:1) — the old #6b6660 was a WARM grey solved for white, and on #191919 it
 * was both the dimmest value in the map and the only one with a colour cast.
 */
export const GROUP_ACCENT: Record<string, string> = {
  grey: "#8A8A8A", //      the "no colour" default, re-cut for the dark card
  red: "#FF6B66", //   2°
  orange: "#FF8A3D", //  28°
  amber: "#D9A400", //  45°
  olive: "#9BC61F", //  75°
  green: "#2ECC4A", // 128°
  teal: "#1FC9A0", // 166°
  cyan: "#22BEE8", // 192°
  blue: "#5AAEFF", // 210°
  indigo: "#A99BFF", // 248°
  violet: "#E27DFF", // 288°
  pink: "#FF6FBA", // 330°
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

/**
 * A GROUP'S THREE SURFACES, SOLVED RATHER THAN EYEBALLED.
 *
 * A column wears its colour the way Notion's do — a tinted badge around the
 * name and a wash behind the cards — and the moment a colour becomes a
 * BACKGROUND, the thing on top of it has to be legible on EVERY hue, not on
 * the two somebody happened to check.
 *
 * The numbers are measured (see the ratios below), not chosen:
 *
 *   · `groupWash` — 6% over the canvas. Enough to tell two columns apart down
 *     the page, far too little to compete with a white tile sitting on it. The
 *     tiles are the loud thing on this screen; the column is furniture.
 *   · `groupBadge` — 16% over white, the pill behind the name.
 *   · `groupInk`  — 60% accent into near-black. On its own badge that measures
 *     5.29:1 at the worst hue (red) and better on the other eleven, so the
 *     name clears AA at the small size it is set in. The accent ITSELF would
 *     not: these hues are solved to 3.05:1 on white, which is a rule for a
 *     4px mark and nowhere near enough for 13px text.
 */
/**
 * MIXED BY CSS, NOT BY JAVASCRIPT — because the surface being mixed INTO is
 * now a different colour in each theme.
 *
 * These three used to `blend()` against the literals `#f1efec` (the canvas),
 * `#ffffff` (a card) and a near-black ink, all resolved at render time on the
 * server. That is fine while there is one theme and fatal the moment there are
 * two: the server cannot know which one the browser will paint, so a dark board
 * got pale pink and pale blue columns with dark cards sitting on them.
 *
 * `color-mix()` defers the same arithmetic to the browser, where the token has
 * already resolved to the right value for the active theme. The RESULT in light
 * mode is what it always was — same hues, same percentages, same three
 * surfaces — and the dark theme now gets its own washes for free.
 *
 * The hand-rolled `blend()` these used to share is gone with them — nothing
 * else mixed colours, and `GROUP_ACCENT` itself is a fixed palette that was
 * never blended.
 */
export function groupWash(key: string): string {
  // 6% over the working surface. Enough to tell two columns apart down the
  // page, far too little to compete with a tile sitting on it.
  return `color-mix(in srgb, ${groupAccent(key)} 6%, var(--color-canvas-bg))`;
}

export function groupBadge(key: string): string {
  // 16% over a card — the pill behind the group's name.
  return `color-mix(in srgb, ${groupAccent(key)} 16%, var(--color-card))`;
}

export function groupInk(key: string): string {
  // 60% accent into the theme's far end: near-black on a light badge, near-white
  // on a dark one. The accents themselves are solved to 3.05:1 on white, which
  // is a rule for a 4px mark and nowhere near enough for 13px text — the mix is
  // what carries the name.
  return `color-mix(in srgb, ${groupAccent(key)} 60%, var(--group-ink-end))`;
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
