"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, MoreHorizontal, Plus } from "lucide-react";
import type { BoardTile } from "@/lib/board/types";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/flow/controls/Popover";
import { TILE_ATTR } from "./board-drag";

/**
 * THE GAP THAT OPENS WHERE A HELD TILE WOULD LAND.
 *
 * Written HERE rather than beside `DropSlotNode` in `flow/drop-slot.tsx`, and
 * that is not a stylistic choice: `tests/drag-rules.test.ts` reads the FIRST
 * `h-[Npx]` in that file to prove the canvas's `SLOT_H` still matches its
 * placeholder. A second component with its own pixel height in there fails an
 * unrelated test with a message about the flow builder.
 *
 * It borrows the SHAPE from the builder's — dashed, a filled `+` in the middle
 * — because that is what a drop target means everywhere else in this product.
 * The COLOUR is the column's own: the builder's gap says "a step may go here",
 * while a board's has to say "this metric is joining THIS group", which is the
 * only question anyone is asking while something is in the air.
 */
export function DropGap({ accent, height }: { accent?: string; height?: number }) {
  /**
   * NO ACCENT MEANS THE UNGROUPED ROW, and it wears the brand rather than a
   * colour of its own. Passing it grey — the "no colour" group default — was
   * the obvious thing and looked broken: a dashed grey box with a grey disc in
   * it reads as a disabled region, not as the one place a card is about to go.
   * Ungrouped is not a group, so it borrows the affordance every other target
   * in this product uses.
   */
  const brand = accent == null;
  return (
    <div
      className={`pointer-events-none flex w-full items-center justify-center rounded-surface border-2 border-dashed ${
        brand ? "border-primary bg-accent/40" : ""
      }`}
      style={{
        // The hole is exactly the size of the card going into it, so nothing
        // below it jumps on the drop. 112 is only the fallback for the frame
        // before the measurement lands.
        height: height && height > 0 ? height : 112,
        // `1f` is 12% alpha — enough to read as a lit target on the column's
        // own wash, too little to compete with the real tiles either side.
        ...(brand ? {} : { borderColor: accent, background: `${accent}1f` }),
      }}
    >
      <span
        className={`flex size-7 items-center justify-center rounded-full ${brand ? "bg-primary text-primary-foreground" : "text-white"}`}
        style={brand ? undefined : { background: accent }}
      >
        <Plus size={16} strokeWidth={2.5} />
      </span>
    </div>
  );
}

/**
 * ONE TILE, GRABBABLE ANYWHERE, WITH A MENU IN ITS CORNER.
 *
 * This wrapper is what lets a SERVER-RENDERED card take part in the board:
 * `flow-tile.tsx` and the page's `MetricTile` need no changes at all.
 *
 * TWO PATHS TO THE SAME PLACE, and neither is the consolation prize. The drag
 * is the obvious one. The menu — choose a lane, then nudge up or down — reaches
 * every arrangement the drag can, is the only path a keyboard has, and is the
 * better one for anyone who would rather not drag a card across a scrolling
 * board. It was also built FIRST, deliberately, so the hardest part of this
 * feature stayed optional rather than load-bearing.
 *
 * The menu's trigger shows on hover and focus, and always on a coarse pointer,
 * where hover never fires and an invisible affordance is no affordance at all.
 */
export function TileSlot({
  tile,
  canEdit,
  laneId,
  index,
  count,
  lanes,
  onPlace,
  held,
  onGrab,
  swallowClick,
  accent,
  sortedBy,
}: {
  tile: BoardTile;
  canEdit: boolean;
  /** The group this tile currently sits in, or null for the ungrouped row. */
  laneId: string | null;
  index: number;
  count: number;
  lanes: Array<{ id: string; name: string }>;
  onPlace: (tileKey: string, groupId: string | null, index: number) => void;
  /** True while this is the tile in the customer's hand. */
  held?: boolean;
  onGrab?: (
    e: React.PointerEvent<HTMLElement>,
    item: { key: string; title: string; accent: string; kind: "tile" | "column" },
  ) => void;
  swallowClick?: () => boolean;
  /** The colour of the lane it sits in — the mark the ghost carries. */
  accent?: string;
  /**
   * The name of the sort this lane is under, when it is under one.
   *
   * A SORTED LANE CANNOT BE REORDERED BY HAND — but it can be dragged out of,
   * and into. Dropping a tile at an index the sort would override on the very
   * next render is a lie the interface tells once and is never trusted about
   * again; refusing to let the card be PICKED UP is a different and much worse
   * thing, and is what this prop used to do.
   *
   * All that is left here is what the tile says about itself, and the two
   * nudges that would reorder this lane. The refusal itself lives in the drag,
   * which is the only place that knows which lane a drop is aimed at.
   */
  sortedBy?: string | null;
}) {
  const [open, setOpen] = useState(false);

  // A member who may not rearrange gets the card and nothing else — not a
  // disabled control advertising something it will refuse. The identifying
  // attribute goes too: nothing here can be a drop target for anyone.
  if (!canEdit) return <>{tile.node}</>;

  const move = (groupId: string | null, at: number) => {
    setOpen(false);
    onPlace(tile.key, groupId, at);
  };

  return (
    <div
      {...{ [TILE_ATTR]: tile.key }}
      /**
       * THE CARD IS THE DRAG SOURCE — grab it anywhere, the way a Notion card
       * works.
       *
       * It started as a grip in the corner, on the reasoning that a tile
       * contains a Refresh submit and two links and making the whole thing
       * draggable would swallow them. Both halves of that were wrong. The
       * controls are protected by four words — `closest("button, a, input")`,
       * exactly what the column header already does — and the grip cost far
       * more than it saved: it had to be hunted for on hover, and it sat on top
       * of the metric's own NAME, so hovering the card you meant to move hid
       * which card it was.
       *
       * What remains in the corner is the MENU's trigger, not the drag's, and
       * it has moved to the far side where the only thing beneath it is a 6px
       * freshness dot.
       */
      onPointerDown={(e) => {
        // NO `sortedBy` GUARD HERE, deliberately — it used to sit on this line
        // and stopped a tile in a sorted group being picked up at all. The rule
        // is about which POSITION may be chosen, not about whether the card can
        // be carried, so it lives in the drag's `resolve` where it can tell the
        // difference. See SORTED_ATTR.
        if ((e.target as HTMLElement).closest("button, a, input")) return;
        onGrab?.(e, { key: tile.key, title: tile.title, accent: accent ?? "", kind: "tile" });
      }}
      // A CONTROL THAT DOES NOTHING MUST SAY WHY. The card is what someone
      // tries to drag, so the card is where "this column is sorted, so
      // hand-ordering is off" belongs — a silently immovable tile reads as a
      // broken drag rather than as a rule.
      title={sortedBy ? `Sorted by ${sortedBy} — drag it to another group, or switch to Manual to reorder here` : undefined}
      className={`group/slot relative cursor-grab transition-opacity duration-(--duration-fast) [touch-action:none] ${
        held ? "opacity-40" : ""
      }`}
    >
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-(--duration-fast) focus-within:opacity-100 group-hover/slot:opacity-100 pointer-coarse:opacity-100">
        <Popover
          open={open}
          setOpen={setOpen}
          /**
           * FIXED, for the reason the column's own menu is: the lane this tile
           * sits in is inside an `overflow-x-auto` scroller, and a container
           * that scrolls on one axis clips on both. An absolute menu on the
           * last tile in a column was cut off at the fold.
           */
          fixed
          align="right"
          width={232}
          anchor={
            <Button
              variant="ghost"
              size="iconSm"
              // The MENU's trigger, and only that — the card starts the drag
              // now. It still asks `swallowClick`, because a drag that began on
              // the card and happened to end over this corner is reported here
              // as a click, and every drop would otherwise open the menu.
              onClick={() => {
                if (swallowClick?.()) return;
                setOpen((o) => !o);
              }}
              aria-label={`Move ${tile.title}`}
              aria-haspopup="menu"
              aria-expanded={open}
              title="Move this metric"
              className="bg-card/90 shadow-card backdrop-blur-sm"
            >
              <MoreHorizontal />
            </Button>
          }
        >
          <div className="overflow-y-auto p-1.5">
            <p className="px-2 py-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Move to</p>

            {/* A tile lands at the END of the lane it is sent to. That is the
                predictable answer and the one Notion's own "Move to" gives —
                anywhere else would be a position nobody chose. */}
            <LaneOption label="Ungrouped" current={laneId === null} onSelect={() => move(null, Number.MAX_SAFE_INTEGER)} />
            {lanes.map((l) => (
              <LaneOption
                key={l.id}
                label={l.name}
                current={laneId === l.id}
                onSelect={() => move(l.id, Number.MAX_SAFE_INTEGER)}
              />
            ))}

            <div className="my-1.5 h-px bg-border" />

            {/* Lane plus repeated up/down reaches every arrangement, which is
                what makes this a complete path rather than a partial one. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={index === 0 || sortedBy != null}
              title={sortedBy ? `Sorted by ${sortedBy}` : undefined}
              onClick={() => move(laneId, index - 1)}
              className="w-full justify-start"
            >
              <ArrowUp />
              Move up
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={index >= count - 1 || sortedBy != null}
              title={sortedBy ? `Sorted by ${sortedBy}` : undefined}
              // +2 rather than +1: the tile is removed from the lane before the
              // index is applied, so passing the neighbour below means landing
              // one place beyond where it currently is.
              onClick={() => move(laneId, index + 2)}
              className="w-full justify-start"
            >
              <ArrowDown />
              Move down
            </Button>
          </div>
        </Popover>
      </div>
      {tile.node}
    </div>
  );
}

function LaneOption({ label, current, onSelect }: { label: string; current: boolean; onSelect: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onSelect}
      disabled={current}
      aria-current={current ? "true" : undefined}
      className="w-full justify-start"
    >
      <span className="flex size-3.5 items-center justify-center">{current && <Check size={13} strokeWidth={3} />}</span>
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}
