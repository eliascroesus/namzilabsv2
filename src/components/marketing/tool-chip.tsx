import { SOURCE_LOGOS } from "@/connectors/logos";
import { SourceMark } from "@/components/source-mark";

/**
 * A TOOL, NAMED OR MARKED — NEVER INITIALLED.
 *
 * ── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 *
 * Fourteen of the thirty-two connectors have no published logo, and the
 * product's shared `SourceMark` falls back to a two-letter tile: `Tf`, `Sl`,
 * `Wh`, `Ta`, `Le`, `Oh`. Inside the app that is right — a rail 48px wide has
 * room for a mark and not for "Typeform", and the user already knows what they
 * connected. On a landing page it is read as fourteen broken images, on the
 * one page whose argument is that this product reads other tools correctly.
 *
 * So the rule is by outcome, not by component: if a real mark exists, use it;
 * if it does not, print the full name and no glyph at all. A named chip looks
 * deliberate. A two-letter square looks like a failed load.
 *
 * ── WHY THE FALLBACK IS NOT FIXED IN `SourceMark` ──────────────────────────
 *
 * Because it is not broken there. `SourceMark` is used by seven files inside
 * the authenticated app, where the tile is the correct answer and the space
 * for a full name does not exist. Changing it globally to suit this page would
 * be fixing a marketing problem in product code.
 */
export function ToolChip({ source, name }: { source: string; name: string }) {
  const hasMark = Boolean(SOURCE_LOGOS[source]);

  return (
    <span className="tool-chip" data-marked={hasMark || undefined}>
      {hasMark && <SourceMark source={source} size={22} />}
      <span>{name}</span>
    </span>
  );
}
