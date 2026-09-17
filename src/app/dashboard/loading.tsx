import { ShellSkeleton } from "@/components/shell-skeleton";
import { TilePlaceholder } from "@/components/tile-placeholder";
import { canvasCells } from "@/lib/board/grid";
import { REPORT_PRESET } from "@/lib/board/presets";

/**
 * The board's own recipe, so content lands where the shimmer stood rather than
 * jumping when the real page arrives. That is the whole job of a skeleton and
 * the only way it can fail.
 *
 * ═══ IT WAS FAILING IN THREE DIRECTIONS AT ONCE ═══
 *
 * All three were measured in a browser at 1920 wide, because none of them is
 * visible from the source: every check in this repo greps text, and a skeleton
 * that is the wrong SHAPE passes every one of them.
 *
 * SIDEWAYS, 249px. `ShellSkeleton` had no `full` width while the page renders
 * `<PageContainer width="full">`, so the mirror was capped at `max-w-6xl` in
 * front of the one page in the product that is uncapped — fallback column
 * x=510 w=1152, settled `<main>` x=261 w=1650.
 *
 * DOWNWARD, 152px. The dashboard's title portals into the top bar now, and the
 * on-page filter island became the chrome band. This still shimmered a page
 * heading (32) + mt-6 (24) + a 56px island + mt-3 (12) + a 12px subtitle +
 * mt-4 (16), none of which has a counterpart any more. Fallback grid top
 * y=298, settled y=146.
 *
 * AND THE GRID ITSELF. This drew `BOARD_GRID` — three equal columns, a 24px
 * gutter, six uniform 176px blocks — in front of a board that is a TWELVE
 * column canvas on a 24px row unit with a 16px gutter, whose chart cards
 * measure 523×384 and whose stat cards measure 388×104. Six half-height boxes
 * crammed into two tight rows, where the board puts three full-height cards in
 * one. That is the "collapsed into each other" the owner reported.
 *
 * ═══ WHY THE PRESET ═══
 *
 * A first-load skeleton cannot know the customer's stored layout — that is the
 * very thing still being fetched — so it reserves the product's own canonical
 * footprint instead of inventing one: `REPORT_PRESET` is what the "+" button
 * lays down, it fills all twelve columns exactly (pinned by the preset tests),
 * and it is a footprint rather than a prediction. The 24px row unit and the
 * 16px gutter come from `.board-canvas` in globals.css rather than from a
 * second hand-typed copy, so the rhythm cannot drift from the board's again.
 *
 * Note this is the FIRST-LOAD skeleton only. Switching range or source no
 * longer comes through here — `TileArea` swaps in tile-shaped placeholders in
 * place, without unmounting the page (see board-controls.tsx).
 */
export default function DashboardLoading() {
  return (
    /* `width="full"` and `title={false}`: the two facts about THIS page that
       the generic mirror cannot know — the board is uncapped, and its heading
       is not in the body. */
    <ShellSkeleton width="full" title={false}>
      {/* NO `mt-4`, exactly as the real canvas dropped it — the chrome band
          above already owns that 16px, and a skeleton that keeps it puts the
          shimmer 16px below where the board lands. */}
      <div className="board-canvas" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading metrics…</span>
        {canvasCells(REPORT_PRESET.tiles.map((t, i) => ({ id: String(i), ...t }))).map(({ tile, vars }) => (
          <div key={tile.id} className="board-cell" style={vars as React.CSSProperties}>
            {/* One placeholder, shared with the other three surfaces that draw
                one — see `tile-placeholder.tsx` for what four copies cost. */}
            <TilePlaceholder />
          </div>
        ))}
      </div>
    </ShellSkeleton>
  );
}
