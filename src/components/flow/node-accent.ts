/**
 * THE STEP PALETTE, IN A PLAIN MODULE.
 *
 * Deliberately NOT in icons.tsx: that file is a client component, and the
 * design page is a server one — calling `nodeAccent()` from there threw
 * "Attempted to call nodeAccent() from the server but nodeAccent is on the
 * client". Colour is data, not behaviour, so it belongs somewhere either side
 * can read.
 */
/**
 * THE RAINBOW, EVENLY SPLIT.
 *
 * Nine step types, forty degrees apart, all the way round — so no two marks
 * are a shade of each other and the hue alone tells you which kind of step you
 * are looking at from across the canvas.
 *
 * Saturation is pushed near the top of the gamut and lightness is then taken
 * to the highest value that still clears 3.05:1 against white — the threshold
 * for a mark this size. Doing it in that order matters: VIVIDNESS is what reads
 * as bright, not luminance, and a first pass that held lightness constant came
 * back as "too mundane and boring and dark". Each value was solved for, not
 * picked; yellow-green and blue land on very different lightnesses because a
 * white glyph demands it.
 */
export const NODE_ACCENT: Record<string, string> = {
  app: "#0EAB0E", // 120° green — records come IN
  time_between: "#07A873", // 160° — how long between two events
  unite: "#009BE9", // 200° — several steps onto one line
  filter: "#6C6CF9", // 240° — keep only what counts
  formula: "#C66DF3", // 280° — maths
  calculate: "#C66DF3", // 280° — maths (legacy)
  paths: "#F84FC0", // 320° — split into branches
  output: "#F76262", // 0° — out to the dashboard
  time: "#C88600", // 40° — a window of time
  group: "#71A20D", // 80° — grouping (legacy)
};
