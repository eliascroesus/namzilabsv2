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
 *  - MIRO's top-left island runs wordmark → board title → ⋮ → upload →
 *    Upgrade. Identity AND the call to action, in ONE surface. Its view
 *    controls live in a separate pill at the far bottom corner.
 *  - MAKE puts every RUN and VIEW control in one horizontal bar pinned to the
 *    bottom centre: "Run once" as a filled primary, a divider, then quiet icon
 *    controls.
 *
 * So there are two surfaces, not four. Everything ABOUT the flow — where it
 * came from, what it is called, whether it saved, what you can do to it, and
 * shipping it — is one top island, because Publish alone in the far corner
 * read as an afterthought stranded across the screen. Everything you do to the
 * CANVAS — run, undo, zoom, fit — is one bottom bar under your hands, where
 * "Test flow" is a filled primary rather than the ghost button it was beside
 * Publish.
 *
 * Geometry is measured, not chosen: 7px island padding around 38px controls
 * gives a 52px-tall island, 16px from every viewport edge (top, left and
 * bottom all the same, which they were not), one hairline divider between
 * groups. Glyphs are 24px and near-black beside 14px text — Miro's toolbar
 * icons read as objects; 17px grey was a toolbar whispering.
 */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

/** One floating surface. Every island in the builder is this. */
function Island({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`pointer-events-auto flex items-center gap-1 rounded-card bg-white p-[7px] shadow-float ${className}`}>{children}</div>;
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
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-control text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:text-neutral-300 disabled:hover:bg-transparent [&_svg]:size-[24px] [&_svg]:stroke-[2]"
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;

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
  onToggleEnabled,
  togglingEnabled,
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
  onToggleEnabled: () => void;
  togglingEnabled: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** The right island and the bottom bar both step aside for the config panel. */
  const panelInset = panelOpen ? "calc(min(452px, 100vw - 2rem) + 1.75rem)" : "1rem";

  return (
    <>
      {/* ── Top-left: WHICH FLOW IS THIS ──────────────────────────────
          Three groups with air between them, not six controls in a row.
          It read as a jumble because "Saved" floated mid-island between the
          name and the ⋯, so the eye had no grouping to land on: back, name,
          status, menu and the primary all sat at one rhythm.

          Now: the back button, then the name as the island's own content with
          the save state as a quiet dot beside it, then a hairline, then the
          actions. And the save state is a WORD, not a dot —
          a dot needs a legend and a word does not; "Not saved" keeps its loud
          red chip on top of that, because that one can cost work. */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-[min(62vw,760px)] items-center">
        <Island className="min-w-0 gap-1">
          <Link
            href="/dashboard/flows"
            title="All flows"
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-control text-foreground transition-colors hover:bg-muted"
          >
            <ChevronLeft size={24} strokeWidth={2} />
          </Link>

          <span className="flex min-w-0 flex-1 items-center gap-2 pr-1">
            <input
              value={name}
              onChange={(e) => onRename(e.target.value)}
              aria-label="Flow name"
              placeholder="Untitled flow"
              className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-2.5 py-1.5 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted focus:border-ring focus:bg-white focus:outline-none focus:ring-4 focus:ring-ring/25"
            />
            <SaveChip state={saveState} onRetry={onRetrySave} />
          </span>

          <Divider />

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
                <Copy size={16} />
                Duplicate flow
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-small font-medium text-destructive transition-colors hover:bg-red-50"
              >
                <Trash2 size={16} />
                Delete flow
              </button>
            </div>
          </Popover>

          {/* The flow's own on/off switch, where Zapier puts a Zap's. It cannot
              be turned on before the flow has ever been published — there
              would be nothing to turn on — so it sits inactive until the first
              publish, which flips it on by itself. */}
          <FlowSwitch on={isPublished} disabled={publishedVersion == null || togglingEnabled} onChange={onToggleEnabled} />

          {isPublished && publishedVersion != null && (
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2 py-1 text-micro font-bold text-success-ink"
              title="This flow is live on your dashboard"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              v{publishedVersion}
            </span>
          )}

          <Button onClick={onReview} disabled={publishing} className="ml-1 h-[38px] shrink-0 gap-2 px-4 text-[14px]">
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
        style={{ left: "1rem", right: panelInset }}
      >
        <Island>
          {showTestAll && (
            <>
              <Button
                variant={runAll ? "secondary" : "default"}
                onClick={runAll ? onStopTestAll : onTestAll}
                title={runAll ? "Stop the run" : "Run every step, top to bottom"}
                className="h-[38px] gap-2 px-4 text-[14px]"
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
            className="min-w-[56px] rounded-control px-2 py-2 text-[14px] font-semibold tabular-nums text-foreground transition-colors hover:bg-muted"
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
 * sentence in a 52px island.
 */
function FlowSwitch({ on, disabled, onChange }: { on: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      title={disabled ? "Publish this flow before turning it on" : on ? "Turn off — removes its dashboard tiles" : "Turn on"}
      aria-label={on ? "Turn flow off" : "Turn flow on"}
      className={`relative mx-1 h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-neutral-200"} ${
        disabled ? "cursor-not-allowed opacity-45" : "hover:brightness-105"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ${on ? "left-[18px]" : "left-0.5"}`}
        style={{ transition: "left .22s cubic-bezier(.34,1.56,.64,1)" }}
        aria-hidden
      />
    </button>
  );
}

function SaveChip({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-micro font-bold text-destructive">
        Not saved
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className="shrink-0 whitespace-nowrap px-1 text-[14px] font-medium text-muted-foreground">
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Unsaved"}
    </span>
  );
}
