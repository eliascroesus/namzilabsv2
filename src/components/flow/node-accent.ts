import { sourceStyle } from "./controls/source-style";

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
 * Lightness is tuned per band and deliberately NOT constant: yellow-green at
 * the lightness that suits blue is unreadable under a white glyph. Every value
 * here clears 3:1 against white, which is the threshold for a mark this size.
 */
export const NODE_ACCENT: Record<string, string> = {
  app: "#248924", // 120° green — records come IN
  time_between: "#1D906A", // 160° — how long between two events
  unite: "#157AAC", // 200° — several steps onto one line
  filter: "#4747E1", // 240° — keep only what counts
  formula: "#9E39D0", // 280° — maths
  calculate: "#9E39D0", // 280° — maths (legacy)
  paths: "#CA2191", // 320° — split into branches
  output: "#D02525", // 0° — out to the dashboard
  time: "#B47B10", // 40° — a window of time
  group: "#698C21", // 80° — grouping (legacy)
};

/**
 * The colour a step wears, from the outside. A connected Get-data step takes
 * its app's brand mark, so its edge has to match the tile rather than the
 * type's own hue — otherwise the card is striped in two colours.
 */
export function nodeAccent(type: string, source?: string | null): string {
  if (type === "app" && source) return sourceStyle(source).color;
  return NODE_ACCENT[type] ?? "#64748B";
}
