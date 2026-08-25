"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, MoreHorizontal, Trash2 } from "lucide-react";
import type { BoardLane } from "@/lib/board/arrange";
import type { BoardGroup, GroupSortKey } from "@/lib/board/types";
import { GROUP_ACCENT, groupAccent, groupBadge, groupInk, groupWash } from "@/components/flow/node-accent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/page";
import { Popover } from "@/components/flow/controls/Popover";
import { DropGap, TileSlot } from "./board-tile-menu";
import { ACCEPTS_ATTR, AXIS_ATTR, LANE_ATTR, TILE_ATTR } from "./board-drag";
import { withGap } from "./board-layout";
import { COLUMN_W, LANE_GAP } from "./board-shape";

/**
 * THE WAYS A COLUMN CAN ORDER ITSELF.
 *
 * `manual` is first and is the default, because it is the only one that
 * preserves what somebody arranged by hand — every other entry is a VIEW over
 * that order, applied at render and never written back, so turning one off
 * restores the arrangement exactly.
 *
 * The blurbs are not decoration. "Value high→low" across a column holding a
 * duration, a percentage and a count cannot mean one ranking, so the menu says
 * what it actually does rather than letting the name imply something untrue.
 */
const SORTS: Array<{ key: GroupSortKey; label: string; blurb: string }> = [
  { key: "manual", label: "Manual", blurb: "The order you arranged by hand" },
  { key: "name_asc", label: "Name A\u2013Z", blurb: "Alphabetical, with numbers read as numbers" },
  { key: "name_desc", label: "Name Z\u2013A", blurb: "Reverse alphabetical" },
  { key: "value_desc", label: "Value high\u2192low", blurb: "Biggest first, currencies together, then counts, then rates" },
  { key: "attention", label: "Needs attention first", blurb: "Broken, then out of date, then the rest" },
];

/**
 * ONE GROUP, AS A COLUMN.
 *
 * Split out of `board-layout.tsx` from the outset rather than after the fact: a
 * header, a rename field, a colour grid and a delete confirmation is a
 * component's worth of state on its own, and retrofitting the split once the
 * drag engine lands is a much worse afternoon.
 *
 * Every control here is the `Button` primitive. A raw `<button>` under
 * `src/app/dashboard/` fails `check:ui`'s ninth rule — the allowlist covers
 * `components/ui`, `components/flow`, the sidebar and RanksPanel, and nothing
 * about this column is special enough to earn a fifth entry.
 */
export function BoardColumn({
  lane,
  canEdit,
  busy,
  lanes,
  onRename,
  onRecolour,
  onDelete,
  onPlace,
  onSort,
  onMoveColumn,
  columnIndex,
  columnCount,
  gapIndex,
  heldKey,
  onGrab,
  swallowClick,
}: {
  lane: BoardLane & { group: BoardGroup };
  canEdit: boolean;
  busy: boolean;
  lanes: Array<{ id: string; name: string }>;
  onRename: (id: string, name: string) => void;
  onRecolour: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onPlace: (tileKey: string, groupId: string | null, index: number) => void;
  onSort: (id: string, sortKey: GroupSortKey) => void;
  onMoveColumn: (id: string, index: number) => void;
  columnIndex: number;
  columnCount: number;
  /** Where the held tile would land in THIS column, or null if not here. */
  gapIndex: number | null;
  heldKey: string | null;
  onGrab: (e: React.PointerEvent<HTMLElement>, item: { key: string; title: string; accent: string; kind: "tile" | "column" }) => void;
  swallowClick: () => boolean;
}) {
  const g = lane.group;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(g.name);
  const [confirming, setConfirming] = useState(false);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name is a column with no handle. Snapping back to what it was
    // says nothing happened, which is true, rather than raising an error about
    // a field the customer has already left.
    if (next && next !== g.name) onRename(g.id, next);
    else setDraft(g.name);
  };

  /**
   * A SORTED COLUMN CANNOT BE REORDERED BY HAND, and saying so is the point.
   *
   * Dropping a tile at an index the sort would override on the next render is a
   * lie the interface tells once and is never trusted about again — so the
   * handle explains itself instead. Dragging a tile INTO a sorted column is
   * still fine (it appends to the hidden manual order and the sort places it),
   * and dragging one OUT always is. This is the one expression that decides it.
   */
  const sortedBy = g.sortKey === "manual" ? null : SORTS.find((s) => s.key === g.sortKey)?.label;

  return (
    <section
      {...{ [TILE_ATTR]: g.id }}
      className={`${COLUMN_W} shrink-0 transition-opacity duration-(--duration-fast) ${heldKey === g.id ? "opacity-40" : ""}`}
      aria-label={g.name}
    >
      {/* A ROW, NOT A CARD. A header inside a card inside a column is three
          boxes drawn for one label, and the column's tiles are already cards.
          It is also the column's own drag handle — the whole header, because a
          separate grip beside a name that is already a button would be three
          controls in a row for two jobs. */}
      <div
        className={`mb-3 flex h-8 items-center gap-2 px-0.5 ${canEdit && !editing ? "cursor-grab [touch-action:none]" : ""}`}
        onPointerDown={(e) => {
          // Only the bare header starts a drag. A press that lands on the name,
          // the kebab or the rename field belongs to that control.
          if (!canEdit || editing) return;
          if ((e.target as HTMLElement).closest("button, input")) return;
          onGrab(e, { key: g.id, title: g.name, accent: groupAccent(g.color), kind: "column" });
        }}
      >
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              // Escape abandons the edit rather than saving it — the one thing
              // a customer expects of a field they opened by accident.
              if (e.key === "Escape") {
                setDraft(g.name);
                setEditing(false);
              }
            }}
            aria-label={`Rename ${g.name}`}
            className="h-7 min-w-0 flex-1 px-2 py-0.5 text-small font-semibold"
          />
        ) : (
          /* THE NAME AS A COLOURED BADGE — a dot and a label on a wash of the
             group's own hue, which is how a board says "these belong together"
             before anybody reads a word of it. The ink is solved against that
             wash rather than being the accent itself: these hues clear 3.05:1
             on white, which is the rule for a 4px mark and nowhere near enough
             for 13px text. See groupInk. */
          <span
            className="flex min-w-0 items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5"
            style={{ background: groupBadge(g.color) }}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: groupAccent(g.color) }} aria-hidden />
            {canEdit ? (
              // It IS a button: pressing it opens the editor. The whole
              // affordance is that the name is the thing you press to change.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                title="Rename this group"
                className="h-auto min-w-0 justify-start truncate p-0 text-small font-semibold hover:bg-transparent"
                style={{ color: groupInk(g.color) }}
              >
                <span className="truncate">{g.name}</span>
              </Button>
            ) : (
              <h3 className="min-w-0 truncate text-small font-semibold" style={{ color: groupInk(g.color) }}>
                {g.name}
              </h3>
            )}
          </span>
        )}

        {/* Computed in JS from rows already in hand — never a count(*) per
            group, which would multiply the board's cost by its column count on
            every twelve-second poll. */}
        <span className="tnum shrink-0 text-tiny text-muted-foreground">{lane.tiles.length}</span>
        <span className="flex-1" />

        {canEdit && (
          <Popover
            open={menuOpen}
            setOpen={(o) => {
              setMenuOpen(o);
              if (!o) setConfirming(false);
            }}
            align="right"
            width={224}
            anchor={
              <Button
                variant="ghost"
                size="iconSm"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={`Options for ${g.name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal />
              </Button>
            }
          >
            <div className="p-1.5">
              {/* THE COLOURS, as a grid of the thing being chosen. A list of
                  names would be ten rows to say what ten dots say at a glance. */}
              <div className="grid grid-cols-5 gap-1 p-1">
                {Object.keys(GROUP_ACCENT).map((key) => (
                  <Button
                    key={key}
                    variant="ghost"
                    size="iconSm"
                    onClick={() => onRecolour(g.id, key)}
                    aria-label={key}
                    aria-pressed={g.color === key}
                    title={key}
                    className="flex items-center justify-center"
                  >
                    <span
                      className="flex size-4 items-center justify-center rounded-full"
                      style={{ background: groupAccent(key) }}
                    >
                      {/* White reads on every hue in this palette — each one is
                          solved to clear 3.05:1 against white, so its own
                          contrast against white ink is the same measurement. */}
                      {g.color === key && <Check size={11} strokeWidth={3.5} className="text-white" />}
                    </span>
                  </Button>
                ))}
              </div>

              <div className="my-1.5 h-px bg-border" />

              {/* SectionHeading is the app's one eyebrow recipe — the same
                  small-caps label Settings uses above a group of controls. */}
              <SectionHeading className="mb-0.5 px-2 pt-1">Sort</SectionHeading>
              {SORTS.map((s) => (
                <Button
                  key={s.key}
                  variant="ghost"
                  size="sm"
                  onClick={() => onSort(g.id, s.key)}
                  aria-current={g.sortKey === s.key ? "true" : undefined}
                  title={s.blurb}
                  className="w-full justify-start"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {g.sortKey === s.key && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 truncate">{s.label}</span>
                </Button>
              ))}

              <div className="my-1.5 h-px bg-border" />

              {/* The keyboard's way to reorder a column, and the mouse's way for
                  anyone who would rather not drag one. Between them they reach
                  every order a drag can. */}
              <Button
                variant="ghost"
                size="sm"
                disabled={columnIndex === 0}
                onClick={() => onMoveColumn(g.id, columnIndex - 1)}
                className="w-full justify-start"
              >
                <ArrowLeft />
                Move left
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={columnIndex >= columnCount - 1}
                // +2 rather than +1: the column is taken out of the row before
                // the index is applied, so passing its right-hand neighbour
                // means landing one place beyond where it is now.
                onClick={() => onMoveColumn(g.id, columnIndex + 2)}
                className="w-full justify-start"
              >
                <ArrowRight />
                Move right
              </Button>

              <div className="my-1.5 h-px bg-border" />

              {confirming ? (
                /* INLINE, not a modal — the RanksPanel precedent. The sentence
                   says what happens to the metrics, because "delete group" one
                   inch from a column full of numbers reads like it might take
                   them with it. It never does. */
                <div className="px-1.5 py-1">
                  <p className="text-tiny text-muted-foreground">
                    Delete this group? Its {lane.tiles.length} metric{lane.tiles.length === 1 ? "" : "s"} move back to the
                    row above.
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => onDelete(g.id)}>
                      Delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="destructiveGhost"
                  size="sm"
                  onClick={() => setConfirming(true)}
                  className="w-full justify-start"
                >
                  <Trash2 />
                  Delete group
                </Button>
              )}
            </div>
          </Popover>
        )}
      </div>

      {/* THE LANE ITSELF — the box the drag hit-tests against, and the wash
          that says which column you are looking down.

          `ACCEPTS_ATTR` is load-bearing rather than decorative: a group's lane
          and the row of columns both contain the pointer when you hover a
          column, and without this the row won a document-order tie every single
          time — which is precisely why metrics could not be dropped into groups.

          It stays in the tree even when the column is empty, so an empty group
          is still somewhere a tile can land. `min-h` keeps that target big
          enough to aim at. */}
      <div
        {...{ [LANE_ATTR]: g.id, [AXIS_ATTR]: "y", [ACCEPTS_ATTR]: "tile" }}
        className={`flex min-h-[140px] flex-col rounded-card p-2 ${LANE_GAP}`}
        style={{ background: groupWash(g.color) }}
      >
        {lane.tiles.length === 0 && gapIndex == null ? (
          /* An empty column is a header over nothing, which reads as a tile
             that failed to load. Saying what the space is for turns it into a
             target rather than a rendering fault. */
          <div className="flex flex-1 items-center justify-center rounded-surface border border-dashed border-border/80 px-4 text-center text-tiny text-muted-foreground">
            Drop a metric here
          </div>
        ) : (
          withGap(lane.tiles, gapIndex, heldKey).map((slot) =>
            slot === null ? (
              <DropGap key="gap" accent={groupAccent(g.color)} />
            ) : (
              <TileSlot
                key={slot.key}
                tile={slot}
                canEdit={canEdit}
                laneId={g.id}
                index={lane.tiles.indexOf(slot)}
                count={lane.tiles.length}
                lanes={lanes}
                onPlace={onPlace}
                accent={groupAccent(g.color)}
                held={heldKey === slot.key}
                onGrab={onGrab}
                swallowClick={swallowClick}
                sortedBy={sortedBy}
              />
            ),
          )
        )}
      </div>
    </section>
  );
}
