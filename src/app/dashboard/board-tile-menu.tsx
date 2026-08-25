"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical } from "lucide-react";
import type { BoardTile } from "@/lib/board/types";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/flow/controls/Popover";

/**
 * ONE TILE, WITH A HANDLE ON IT.
 *
 * The handle is a control of its own rather than the card being draggable,
 * because a tile already contains a Refresh submit and two links: making the
 * whole card a drag source would swallow all three. It sits over the card's
 * top-left corner, absolutely positioned by this wrapper — so `flow-tile.tsx`
 * and the page's `MetricTile` need no changes at all to take part.
 *
 * PRESSING IT OPENS A MENU, and once dragging exists a press-and-move will
 * start a drag instead. That ordering is deliberate: the menu is the complete
 * path, not the consolation prize. Choosing a lane and then moving up or down
 * reaches every arrangement a drag can reach, it is the only path a keyboard
 * has, and it is the better path for anyone who dislikes dragging — which is
 * why it is being built first and the pointer engine second.
 *
 * Visible on hover and focus, and always on a coarse pointer, where hover never
 * fires and an invisible affordance is no affordance.
 */
export function TileSlot({
  tile,
  canEdit,
  laneId,
  index,
  count,
  lanes,
  onPlace,
}: {
  tile: BoardTile;
  canEdit: boolean;
  /** The group this tile currently sits in, or null for the ungrouped row. */
  laneId: string | null;
  index: number;
  count: number;
  lanes: Array<{ id: string; name: string }>;
  onPlace: (tileKey: string, groupId: string | null, index: number) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!canEdit) return <>{tile.node}</>;

  const move = (groupId: string | null, at: number) => {
    setOpen(false);
    onPlace(tile.key, groupId, at);
  };

  return (
    <div className="group/slot relative">
      <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity duration-(--duration-fast) focus-within:opacity-100 group-hover/slot:opacity-100 pointer-coarse:opacity-100">
        <Popover
          open={open}
          setOpen={setOpen}
          width={220}
          anchor={
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => setOpen((o) => !o)}
              aria-label={`Move ${tile.title}`}
              aria-haspopup="menu"
              aria-expanded={open}
              title="Move this metric"
              className="bg-card/90 backdrop-blur-sm"
            >
              <GripVertical />
            </Button>
          }
        >
          <div className="p-1.5">
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
              disabled={index === 0}
              onClick={() => move(laneId, index - 1)}
              className="w-full justify-start"
            >
              <ArrowUp />
              Move up
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={index >= count - 1}
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
