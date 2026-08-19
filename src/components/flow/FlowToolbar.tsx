"use client";

import { Copy, Play, Rocket, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import { useState } from "react";
import { Popover } from "./controls/Popover";

/**
 * THE BUILDER'S CHROME: two floating islands over the canvas, Miro-style —
 * never an edge-to-edge bar.
 *
 * Left island is the FLOW: its name, its save state, and the two things you
 * do to a flow as a whole — duplicate it and delete it. Those were behind a
 * ⋮ menu; a menu with two items is a drawer in front of two buttons. App
 * navigation is not here at all any more: the icon rail beside the canvas
 * owns it, the way it does on every other screen.
 *
 * Right island is what you do to the flow's CONTENT: run it, see that it is
 * live, publish it. Undo/redo live in the bottom-left cluster with zoom —
 * canvas-level controls belong with the canvas controls (Miro puts them
 * there too).
 *
 * The right island SLIDES when the config panel opens. Both want the same
 * corner, and a Publish button hidden behind a panel is a Publish button
 * that does not exist.
 */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

export function FlowToolbar({
  name,
  onRename,
  saveState,
  onRetrySave,
  onDuplicate,
  onDelete,
  onTestAll,
  onStopTestAll,
  runAll,
  showTestAll,
  publishedVersion,
  isPublished,
  publishing,
  onReview,
  panelOpen,
}: {
  name: string;
  onRename: (v: string) => void;
  saveState: SaveState;
  onRetrySave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTestAll: () => void;
  onStopTestAll: () => void;
  runAll: { at: number; of: number } | null;
  showTestAll: boolean;
  publishedVersion: number | null;
  isPublished: boolean;
  publishing: boolean;
  onReview: () => void;
  panelOpen: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      {/* ---- Left island: the flow ---- */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(46vw,520px)] items-center">
        <div className="pointer-events-auto flex min-w-0 items-center gap-0.5 rounded-card bg-white p-1.5 flow-shadow">
          <input
            value={name}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Flow name"
            placeholder="Untitled flow"
            className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-2 py-1.5 text-base font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          />

          <SaveChip state={saveState} onRetry={onRetrySave} />

          <span className="mx-0.5 h-5 w-px shrink-0 bg-neutral-200" aria-hidden />

          <Button variant="ghost" size="icon" onClick={onDuplicate} title="Duplicate this flow" aria-label="Duplicate this flow">
            <Copy />
          </Button>

          <Popover
            open={confirmingDelete}
            setOpen={setConfirmingDelete}
            width={252}
            align="left"
            anchor={
              <Button
                variant="destructiveGhost"
                size="icon"
                onClick={() => setConfirmingDelete(!confirmingDelete)}
                title="Delete this flow"
                aria-label="Delete this flow"
              >
                <Trash2 />
              </Button>
            }
          >
            <div className="p-3">
              <p className="text-small font-semibold text-neutral-900">Delete this flow?</p>
              <p className="mt-1 text-tiny text-neutral-500">
                {isPublished ? "Its dashboard metrics are removed too. " : ""}This can’t be undone.
              </p>
              <div className="mt-2.5 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmingDelete(false);
                    onDelete();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Popover>
        </div>
      </div>

      {/* ---- Right island: run and publish ----
          It steps aside for the config panel rather than sitting under it. */}
      <div
        className="pointer-events-none absolute top-3 z-10 flex items-center transition-[right] duration-200 ease-out"
        style={{ right: panelOpen ? "calc(min(452px, 100vw - 2rem) + 1.75rem)" : "0.75rem" }}
      >
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-card bg-white p-1.5 flow-shadow">
          {showTestAll && (
            <Button
              variant="ghost"
              onClick={runAll ? onStopTestAll : onTestAll}
              title={runAll ? "Stop the run" : "Run every step, top to bottom"}
              className={runAll ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : ""}
            >
              {runAll ? <Square className="fill-current" /> : <Play className="fill-current" />}
              {runAll ? `${runAll.at}/${runAll.of} — Stop` : "Test flow"}
            </Button>
          )}

          {isPublished && publishedVersion != null && (
            <span className="rounded-control bg-green-50 px-2 py-1 text-micro font-semibold text-green-700" title="This flow is live on your dashboard">
              Live · v{publishedVersion}
            </span>
          )}

          <Button onClick={onReview} disabled={publishing}>
            {isPublished ? <SlidersHorizontal /> : <Rocket />}
            {isPublished ? "Edit output" : "Review & publish"}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * The save state, as a chip inside the island.
 *
 * A failed save is the one thing here that can silently cost work, so it is
 * the only state that gets words and colour; the rest is a dot, because
 * "Saved" is the answer to a question nobody asked and does not deserve a
 * sentence in a 44px bar.
 */
function SaveChip({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-control bg-red-50 px-2 py-1 text-micro font-medium text-red-700">
        Not saved
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 px-1.5 text-tiny text-neutral-400"
      title={state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : "Unsaved changes"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state === "saved" ? "bg-green-500" : "bg-amber-400"}`} aria-hidden />
      <span className="hidden sm:inline">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Unsaved"}</span>
    </span>
  );
}
