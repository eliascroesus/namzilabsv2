"use client";

import { useState } from "react";
import { Check, MoreHorizontal, Trash2 } from "lucide-react";
import type { BoardLane } from "@/lib/board/arrange";
import type { BoardGroup } from "@/lib/board/types";
import { GROUP_ACCENT, groupAccent } from "@/components/flow/node-accent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/flow/controls/Popover";
import { TileSlot } from "./board-tile-menu";
import { COLUMN_W, LANE_GAP } from "./board-shape";

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
}: {
  lane: BoardLane & { group: BoardGroup };
  canEdit: boolean;
  busy: boolean;
  lanes: Array<{ id: string; name: string }>;
  onRename: (id: string, name: string) => void;
  onRecolour: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onPlace: (tileKey: string, groupId: string | null, index: number) => void;
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

  return (
    <section className={`${COLUMN_W} shrink-0`} aria-label={g.name}>
      {/* A ROW, NOT A CARD. A header inside a card inside a column is three
          boxes drawn for one label, and the column's tiles are already cards. */}
      <div className="mb-3 flex h-8 items-center gap-2 px-0.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: groupAccent(g.color) }} aria-hidden />

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
            className="h-8 min-w-0 flex-1 px-2 py-1 text-base font-semibold"
          />
        ) : canEdit ? (
          // It IS a button: pressing it opens the editor. Styled to read as the
          // heading it also is, which is not a disguise — the whole affordance
          // is that the name is the thing you press to change the name.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            title="Rename this group"
            className="h-auto min-w-0 flex-1 justify-start truncate px-1 py-0.5 text-base font-semibold text-foreground"
          >
            <span className="truncate">{g.name}</span>
          </Button>
        ) : (
          <h3 className="min-w-0 flex-1 truncate px-1 text-base font-semibold text-foreground">{g.name}</h3>
        )}

        {/* Computed in JS from rows already in hand — never a count(*) per
            group, which would multiply the board's cost by its column count on
            every twelve-second poll. */}
        <span className="tnum shrink-0 text-tiny text-muted-foreground">{lane.tiles.length}</span>

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

      {lane.tiles.length === 0 ? (
        /* An empty column is a header over nothing, which reads as a tile that
           failed to load. Saying what the space is for turns it into a target. */
        <div className="flex min-h-[120px] items-center justify-center rounded-surface border-2 border-dashed border-border px-4 text-center text-tiny text-muted-foreground">
          Nothing in this group yet
        </div>
      ) : (
        <div className={`flex flex-col ${LANE_GAP}`}>
          {lane.tiles.map((t, i) => (
            <TileSlot
              key={t.key}
              tile={t}
              canEdit={canEdit}
              laneId={g.id}
              index={i}
              count={lane.tiles.length}
              lanes={lanes}
              onPlace={onPlace}
            />
          ))}
        </div>
      )}
    </section>
  );
}
