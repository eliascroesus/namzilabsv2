"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Copy,
  Maximize2,
  MoreVertical,
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
 * So the top splits along the seam between IDENTITY and ACTION, with the
 * canvas showing through the gap. On the LEFT: where you came from and what
 * this is called — the way back, then "Flows / <name>" as a breadcrumb, the
 * name itself still the editable thing it always was. On the RIGHT: whether it
 * saved, what you can do to it, and shipping it. One island holding all of
 * that had the primary action reading as one more item in a list of six;
 * pushed to its own corner it reads as the end of the sentence.
 *
 * Everything you do to the CANVAS — run, undo, zoom, fit — is the bottom bar
 * under your hands, where "Test flow" is a filled primary rather than the
 * ghost button it was beside Publish.
 *
 * Geometry is measured, not chosen: 7px island padding plus a 1px border
 * around 42px controls gives a 58px-tall island, 24px from every viewport edge
 * (top, left, right and bottom all the same, which they were not), one
 * hairline divider between groups. Glyphs are 26px and near-black beside 15px
 * text — Miro's toolbar icons read as objects; 17px grey was a toolbar
 * whispering.
 *
 * Nothing here moves. The right island and the bottom bar used to slide left
 * whenever the config panel opened, because the panel ran the full height of
 * the viewport and would otherwise have covered the primary action. The panel
 * now stops at `--spacing-chrome-band` — the 58px island plus its insets, top
 * and bottom — so the chrome can hold still and the eye keeps the primary
 * action and "Test flow" exactly where it left them.
 */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

/**
 * One floating surface. Every island in the builder is this.
 *
 * A floating surface is a hairline border AND a shadow — the shadow alone
 * dissolves against a light canvas, which is why shadcn draws both. The border
 * is paid for out of the padding rather than added to the outside, because the
 * 58px island height is measured against everything else on screen:
 * 1 + 7 + 42 (control) + 7 + 1 = 58. p-[7px] is not a typo for p-[8px].
 *
 * The elevation is `shadow-surface` — the ONE shadow every floating thing in
 * the builder uses, so the bar, the step cards, the config panel and the step
 * picker all sit at the same height. It is ring-free on purpose: this box
 * draws a real border, and a ringed shadow under one is two hairlines of
 * different hue, a 2px dirty rim instead of a crisp edge.
 */
function Island({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`pointer-events-auto flex items-center gap-1 rounded-surface border border-border bg-white p-[7px] shadow-surface ${className}`}>
      {children}
    </div>
  );
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
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-control text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:text-neutral-300 disabled:hover:bg-transparent [&_svg]:size-[26px] [&_svg]:stroke-[2]"
    >
      {children}
    </button>
  );
}

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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  zoomPct,
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
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** Already scaled against BASE_ZOOM — the toolbar shows it verbatim. */
  zoomPct: number;
  onToggleEnabled: () => void;
  togglingEnabled: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      {/* ── ONE BAR, THREE JOBS ────────────────────────────────────────
          It stretches the full width and holds three groups, each a different
          KIND of thing, in a grid so the middle is dead-centre rather than
          wherever the ends happen to leave it:

            LEFT   what this flow is and what state it is in
            CENTRE what you do to the VIEW — undo, redo, zoom
            RIGHT  what you do with the flow — run it, ship it

          It was three separate surfaces (identity, actions, canvas controls)
          and then one bar that hugged its content, leaving the right half of
          the canvas empty while the actions sat mid-screen.

          The config panel opens in the band BELOW it, so nothing ever has to
          move out of anything's way. */}
      <div className="pointer-events-none absolute inset-x-6 top-6 z-10">
        <Island className="w-full">
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            {/* WHAT THIS FLOW IS, AND HOW IT IS DOING */}
            <span className="flex min-w-0 items-center gap-1">
              <Link
                href="/dashboard/flows"
                title="All flows"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-control text-foreground transition-colors hover:bg-muted"
              >
                <ChevronLeft size={26} strokeWidth={2} />
              </Link>

              {/* No "Flows /" crumb. The back arrow beside it already goes there
                  and already says so on hover; a breadcrumb whose only parent is
                  the button next to it is a word for its own sake. */}

              <Popover
                open={menuOpen}
                setOpen={setMenuOpen}
                width={210}
                align="left"
                anchor={
                  <IslandButton onClick={() => setMenuOpen(!menuOpen)} label="Flow actions">
                    <MoreVertical />
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

            </span>

            {/* THE NAME, DEAD CENTRE. It is the one thing on this bar that is
                about the flow rather than about what you can do to it, and the
                grid's auto column keeps it centred no matter how long it gets
                or what appears either side of it. */}
            <span className="flex min-w-0 items-center justify-center">
              <span className="flex min-w-0 items-center gap-1 pr-1">
                {/* Sized to its VALUE, not to an <input>'s intrinsic 20 characters.
                    At the old fixed width a long name was cut mid-glyph, hard against
                    the padding with no ellipsis — while 87px of empty canvas sat to
                    its right and the wrapper's own max-width was never reached. The
                    floor keeps an empty field clickable; the ceiling keeps this
                    island clear of the one on the right. */}
                <input
                  value={name}
                  onChange={(e) => onRename(e.target.value)}
                  aria-label="Flow name"
                  placeholder="Untitled flow"
                  title={name}
                  style={{ width: `${Math.min(Math.max((name || "Untitled flow").length + 2, 13), 34)}ch` }}
                  className="min-w-0 max-w-full rounded-control border border-transparent bg-transparent px-2.5 py-2 text-lead font-semibold text-foreground transition-colors hover:bg-muted focus:border-ring focus:bg-white focus:outline-none focus:ring-4 focus:ring-ring/25"
                />
              </span>
            </span>

            {/* WHAT YOU DO WITH THE FLOW. Run and ship, side by side, because
                they are the same kind of act at two different stages. */}
            <span className="flex items-center justify-end gap-2">
              {/* Words, no dot. The reference this island copies has a green dot,
                  and it is deliberately not here: a dot needs a legend and a word
                  does not. Do not "restore" it. */}
              <SaveChip state={saveState} onRetry={onRetrySave} />

              {/* The flow's own on/off switch, where Zapier puts a Zap's. It cannot
                  be turned on before the flow has ever been published — there
                  would be nothing to turn on — so it sits inactive until the
                  first publish, which flips it on by itself. It lives beside
                  the name and the save state because all three answer the same
                  question: what IS this flow right now. */}
              <FlowSwitch on={isPublished} disabled={publishedVersion == null || togglingEnabled} onChange={onToggleEnabled} />

              <IslandButton onClick={onUndo} disabled={!canUndo} label="Undo">
                <Undo2 />
              </IslandButton>
              <IslandButton onClick={onRedo} disabled={!canRedo} label="Redo">
                <Redo2 />
              </IslandButton>

              {showTestAll && (
                <Button
                  variant="secondary"
                  onClick={runAll ? onStopTestAll : onTestAll}
                  title={runAll ? "Stop the run" : "Run every step, top to bottom"}
                  aria-label={runAll ? "Stop the run" : "Test flow"}
                  className={`h-[42px] shrink-0 text-lead [&_svg]:size-[18px] ${runAll ? "gap-2 px-[18px]" : "w-[42px] px-0"}`}
                >
                  {runAll ? <Square className="fill-current" /> : <Play className="fill-current" />}
                  {/* Icon only at rest — the play glyph IS the word. Quiet grey
                      rather than a colour: a test run is a rehearsal, and the one
                      saturated thing in this bar should be the act that actually
                      ships. While a run is going it earns its words back:
                      "Stop · 2/6" is a receipt, and dropping the count to stay
                      square would be hiding progress to keep a shape. */}
                  {runAll ? `Stop · ${runAll.at}/${runAll.of}` : null}
                </Button>
              )}

              {/* 18px, not the Button's shared 16px: a 26px standalone glyph sits one
                  control away, and 16 beside it read as two different icon sets. */}
              <Button onClick={onReview} disabled={publishing} className="ml-1 h-[42px] shrink-0 gap-2 px-[18px] text-lead [&_svg]:size-[18px]">
                {isPublished ? <SlidersHorizontal /> : <Rocket />}
                {isPublished ? "Edit output" : "Review & publish"}
              </Button>
            </span>
          </div>
        </Island>
      </div>

      {/* ── THE VIEW, ITS OWN LITTLE BAR ───────────────────────────────
          Zoom and fit are the only controls here that are about looking rather
          than about the flow, so they sit apart from it — bottom-left, out of
          the way of both the top bar and the config panel, stacked because a
          column of four is a smaller target area to skip over than a row. */}
      <div className="pointer-events-none absolute bottom-6 left-6 z-10">
        <Island className="flex-col">
          <IslandButton onClick={onZoomOut} label="Zoom out">
            <ZoomOut />
          </IslandButton>
          {/* Miro puts the zoom READOUT between its controls and it earns the
              space: after a pinch you have no idea where you are. Clicking it
              fits the flow, which is the only thing anyone wants next. */}
          <button
            onClick={onFitView}
            title="Fit the whole flow on screen"
            className="h-[42px] w-[42px] rounded-control text-base font-semibold tabular-nums text-foreground transition-colors hover:bg-muted"
          >
            {zoomPct}%
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
      className={`relative mx-1 h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-neutral-200"} ${
        disabled ? "cursor-not-allowed opacity-45" : "hover:brightness-105"
      }`}
    >
      {/* 18px = 40px track − 20px knob − the 2px inset it rests in when off. */}
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ${on ? "left-[18px]" : "left-0.5"}`}
        style={{ transition: "left .22s cubic-bezier(.34,1.56,.64,1)" }}
        aria-hidden
      />
    </button>
  );
}

/**
 * The save state, in words — no dot, no chip, no colour.
 *
 * A failed save is the one thing here that can silently cost work, so it is
 * the only state that gets a chip and a colour, and a Retry to go with it.
 * Everything else is one quiet word: a status light needs a legend and
 * "Saved" does not.
 */
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
    <span className="shrink-0 whitespace-nowrap px-1 text-lead font-medium text-muted-foreground">
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Unsaved"}
    </span>
  );
}
