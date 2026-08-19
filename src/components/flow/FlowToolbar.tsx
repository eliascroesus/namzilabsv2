"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Copy,
  Maximize2,
  MoreHorizontal,
  Play,
  Redo2,
  Rocket,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Popover } from "./controls/Popover";
import { Button } from "@/components/ui/button";

/**
 * THE BUILDER'S CHROME — islands grouped by JOB, not by corner.
 *
 * The previous version had two blobs: everything about the flow crammed into a
 * top-left pill, everything pressable in a top-right one. That is not what the
 * canvas tools it borrows from actually do. Measured off the two references:
 *
 *  - MIRO anchors board IDENTITY top-left, SHARING top-right, TOOLS to a
 *    vertical island on the left edge, and VIEW to a pill bottom-right. Four
 *    jobs, four surfaces — and the tool island is split again, with undo/redo
 *    as its own separate island below the tools.
 *  - MAKE puts identity top-left, sharing top-right, and — the move worth
 *    stealing — every RUN and VIEW control in one horizontal bar pinned to the
 *    bottom centre: "Run once" as a filled primary, a divider, then quiet icon
 *    controls.
 *
 * So: identity top-left, publish top-right, and everything you DO to the
 * canvas — run, undo, zoom, fit — in one bar under your hands. Undo and zoom
 * were in a cramped bottom-left cluster nobody would find, and "Test flow" was
 * a ghost button beside Publish, where it read as Publish's poor relation
 * rather than the control you press twenty times an hour.
 *
 * Geometry is measured, not chosen: 6px island padding, 36px controls, 8px
 * from the viewport edge, one hairline divider between groups.
 */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

/** One floating surface. Every island in the builder is this. */
function Island({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`pointer-events-auto flex items-center gap-0.5 rounded-card bg-white p-1.5 shadow-float ${className}`}>{children}</div>;
}

function IslandButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-neutral-600 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:text-neutral-300 disabled:hover:bg-transparent [&_svg]:size-[17px]"
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />;

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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  zoom,
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
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  zoom: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** The right island and the bottom bar both step aside for the config panel. */
  const panelInset = panelOpen ? "calc(min(452px, 100vw - 2rem) + 1.75rem)" : "0.5rem";

  return (
    <>
      {/* ── Top-left: WHICH FLOW IS THIS ────────────────────────────────── */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[min(44vw,460px)] items-center">
        <Island className="min-w-0">
          <Link
            href="/dashboard/flows"
            title="All flows"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-neutral-500 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft size={18} />
          </Link>

          <input
            value={name}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Flow name"
            placeholder="Untitled flow"
            className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-2 py-1.5 text-lead font-semibold text-foreground transition-colors hover:bg-muted focus:border-ring focus:bg-white focus:outline-none focus:ring-4 focus:ring-ring/25"
          />

          <SaveChip state={saveState} onRetry={onRetrySave} />

          <Popover
            open={menuOpen}
            setOpen={setMenuOpen}
            width={210}
            align="left"
            anchor={
              <IslandButton onClick={() => setMenuOpen(!menuOpen)} label="Flow actions">
                <MoreHorizontal />
              </IslandButton>
            }
          >
            <div className="p-1.5">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
                className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-small font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Copy size={15} />
                Duplicate flow
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-small font-medium text-destructive transition-colors hover:bg-red-50"
              >
                <Trash2 size={15} />
                Delete flow
              </button>
            </div>
          </Popover>
        </Island>
      </div>

      {/* ── Top-right: SHIP IT ──────────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute top-2 z-10 flex items-center transition-[right] duration-200 ease-out"
        style={{ right: panelInset }}
      >
        <Island>
          {isPublished && publishedVersion != null && (
            <>
              <span
                className="flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1.5 text-micro font-bold text-success-ink"
                title="This flow is live on your dashboard"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                Live · v{publishedVersion}
              </span>
              <Divider />
            </>
          )}
          <Button onClick={onReview} disabled={publishing} className="h-9">
            {isPublished ? <SlidersHorizontal /> : <Rocket />}
            {isPublished ? "Edit output" : "Review & publish"}
          </Button>
        </Island>
      </div>

      {/* ── Bottom centre: EVERYTHING YOU DO TO THE CANVAS ──────────────
          Make's bar. Run first as a filled primary, then the quiet controls
          behind a divider — under your hands, not tucked in a corner. */}
      <div
        className="pointer-events-none absolute bottom-4 z-10 flex justify-center transition-[right] duration-200 ease-out"
        style={{ left: "0.5rem", right: panelInset }}
      >
        <Island>
          {showTestAll && (
            <>
              <Button
                variant={runAll ? "secondary" : "success"}
                onClick={runAll ? onStopTestAll : onTestAll}
                title={runAll ? "Stop the run" : "Run every step, top to bottom"}
                className="h-9"
              >
                {runAll ? <Square className="fill-current" /> : <Play className="fill-current" />}
                {runAll ? `Stop · ${runAll.at}/${runAll.of}` : "Test flow"}
              </Button>
              <Divider />
            </>
          )}

          <IslandButton onClick={onUndo} disabled={!canUndo} label="Undo">
            <Undo2 />
          </IslandButton>
          <IslandButton onClick={onRedo} disabled={!canRedo} label="Redo">
            <Redo2 />
          </IslandButton>

          <Divider />

          <IslandButton onClick={onZoomOut} label="Zoom out">
            <ZoomOut />
          </IslandButton>
          {/* Miro puts the zoom READOUT between its controls and it earns the
              space: after a pinch you have no idea where you are. Clicking it
              fits the flow, which is the only thing anyone wants next. */}
          <button
            onClick={onFitView}
            title="Fit the whole flow on screen"
            className="min-w-[52px] rounded-control px-1 py-1.5 text-tiny font-semibold tabular-nums text-neutral-600 transition-colors hover:bg-muted hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IslandButton onClick={onZoomIn} label="Zoom in">
            <ZoomIn />
          </IslandButton>
          <IslandButton onClick={onFitView} label="Fit the whole flow on screen">
            <Maximize2 />
          </IslandButton>
        </Island>
      </div>

      {/* Deleting a flow is centred and modal. It was a popover hanging off a
          menu item that had already closed, which is a lot of consequence for
          a surface that small. */}
      {confirmingDelete && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm"
          onClick={() => setConfirmingDelete(false)}
        >
          <div className="w-full max-w-sm rounded-surface bg-white p-5 shadow-pop flow-pop-in" onClick={(e) => e.stopPropagation()}>
            <p className="text-title font-semibold text-foreground">Delete this flow?</p>
            <p className="mt-1.5 text-small text-muted-foreground">
              {isPublished ? "Its dashboard metrics are removed too. " : ""}This can’t be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete();
                }}
              >
                Delete flow
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The save state, as a chip inside the island.
 *
 * A failed save is the one thing here that can silently cost work, so it is
 * the only state that gets words and colour; the rest is a dot, because
 * "Saved" is the answer to a question nobody asked and does not deserve a
 * sentence in a 48px bar.
 */
function SaveChip({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1.5 text-micro font-bold text-destructive">
        Not saved
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 px-1.5 text-tiny font-medium text-neutral-400"
      title={state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : "Unsaved changes"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state === "saved" ? "bg-success" : "bg-warn"}`} aria-hidden />
      <span className="hidden sm:inline">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Unsaved"}</span>
    </span>
  );
}
