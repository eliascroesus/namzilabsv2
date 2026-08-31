"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Maximize2,
  MoreVertical,
  Redo2,
  Rocket,
  SlidersHorizontal,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Popover } from "./controls/Popover";
import { Button } from "@/components/ui/button";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

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
/**
 * THE BUILDER'S TOOLBAR, RENDERED INTO THE APP'S TOP BAR.
 *
 * It floated over the canvas in a rounded island — which meant the editor had
 * two top bars stacked, and the upper one covered the thing being edited. The
 * controls belong to the flow, so they belong in the bar that already carries
 * the workspace and the create actions.
 *
 * A portal, not a prop, because these controls sit deep inside the canvas's own
 * client tree and read its undo stack, its save state and its publish
 * fingerprint. Lifting them into the frame would mean lifting all of that with
 * them; portalling moves the DOM and leaves the state where it belongs.
 *
 * `mounted` gates the first render: the slot is created by the frame, so on the
 * server (and on the very first client pass) `getElementById` is null. Render
 * nothing rather than crash, then fill it in on mount.
 */
/**
 * THE FLOW'S NAME — extracted so it can be LOOKED AT.
 *
 * It lived inline in a toolbar that only renders behind WorkOS, which meant its
 * box was judged from class names, which is how it shipped twice at the wrong
 * width. It mounts on /design/board beside the page title for the same reason
 * that one does: a control nobody can screenshot is a control that gets fixed
 * by guessing.
 */
export function FlowNameField({ name, onRename }: { name: string; onRename?: (v: string) => void }) {
  /**
   * `onRename` IS OPTIONAL SO THIS CAN MOUNT ON A SERVER PAGE.
   *
   * /design/board is a server component, and React refuses to pass a function
   * across that boundary — so a harness cannot hand it a no-op. Defaulting here,
   * inside the client component, lets the specimen render read-only while the
   * builder passes the real handler. The alternative is not rendering it on a
   * public route at all, which is how it got fixed by guessing twice.
   */
  const rename = onRename ?? (() => {});
  return (
    <span className="-mx-1.5 flex min-w-0 items-center">
                {/* AN INPUT CANNOT SIZE ITSELF, so a sizer does it.
                    This carried `style={{ width: `${…}ch` }}` — a FIXED width
                    computed from the character COUNT. `ch` is the width of "0",
                    and the interface is set in a proportional face, so the box
                    was never the width of the words: "Untitled flow" and
                    "IIIIIIIIIIIII" are thirteen characters and nowhere near the
                    same size. That is the fixed width behind the box that
                    refused to hug its text.
                    The fix is the standard one: an invisible span holding the
                    same string, in the same font, stacked in the SAME grid cell
                    as the input. The cell sizes to the span — real, measured
                    text — and the input fills it. It hugs by construction, at
                    every length, with no arithmetic to be wrong. */}
                <span className="inline-grid min-w-0 max-w-full items-center">
                  <span
                    aria-hidden
                    /* ONE PIXEL WIDER EITHER SIDE THAN THE INPUT'S OWN PADDING.
                       Sized to the text EXACTLY, the content box equals the
                       string's width and the last glyph clips on the sub-pixel:
                       "Untitled flow" rendered with half a w. An input clips,
                       where a span would simply overflow, so the sizer has to
                       ask for slightly more than it measures. */
                    className="invisible col-start-1 row-start-1 whitespace-pre px-[7px] text-sm font-semibold"
                  >
                    {name || "Untitled flow"}
                  </span>
                  <input
                    value={name}
                    onChange={(e) => rename(e.target.value)}
                    aria-label="Flow name"
                    placeholder="Untitled flow"
                    title={name}
                    /**
                     * `size={1}` IS WHAT MAKES THE SIZER WIN.
                     *
                     * A grid column takes the MAX-CONTENT of every item in the
                     * cell, and an `<input>` has an intrinsic width of about
                     * twenty characters whatever CSS says — so the cell sized to
                     * the input, not to the invisible span, and the box stayed
                     * wider than the words exactly as it had with the `ch`
                     * arithmetic. `w-full` cannot help: it resolves against a
                     * column the input is itself inflating.
                     * One character of intrinsic width puts the span back in
                     * charge, and `w-full` then fills whatever the span asked
                     * for.
                     */
                    size={1}
                    className="col-start-1 row-start-1 h-9 w-full min-w-0 rounded-control border border-transparent bg-transparent px-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none"
                  />
                </span>
    </span>
  );
}

function TopBarPortal({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("topbar-slot")), []);
  return slot ? createPortal(children, slot) : null;
}

/**
 * THE SAVE STATE GOES TO THE BAR'S RIGHT EDGE, not to the toolbar's.
 *
 * It is a fact about the editing SESSION rather than a control on the flow, so
 * it belongs with the things that are about you — Invite, New flow, the bell —
 * and not among the acts. `#topbar-status` is its own slot for that reason;
 * routes with nothing to report leave it empty and it collapses.
 */
function TopBarStatusPortal({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("topbar-status")), []);
  return slot ? createPortal(children, slot) : null;
}

function Island({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    /* `p-1` and `rounded-card`, on the kit's own grid. `p-[7px]` was an
       arbitrary value chosen to centre 42px buttons in a 56px island; the
       buttons are 32px now and 4px of inset is what every other padded shell in
       the product uses. `shadow-card` rather than `shadow-surface`: this floats
       over the canvas, but the float rung is for modals and it made a six-button
       column read as a panel hovering an inch off the page. */
    <div className={`pointer-events-auto flex items-center gap-0.5 rounded-card border border-border bg-card p-1 shadow-card ${className}`}>
      {children}
    </div>
  );
}

function IslandButton({
  onClick,
  disabled,
  label,
  /**
   * THE TOP BAR'S RUNG, NOT THE CANVAS ISLAND'S.
   *
   * This component serves two places: the floating zoom island ON the canvas,
   * and undo/redo/kebab in the top bar. They want different sizes and it took a
   * regression to notice — resizing the shared default to match the bar shrank
   * the canvas island's buttons with it, leaving them mismatched against the
   * zoom readout they sit either side of.
   *
   * BOTH RUNGS CAME DOWN TO THE KIT'S. The canvas island kept 42px around a
   * 26px glyph on the argument that it is a floating island over a drawing
   * surface, pressed while dragging. It was also the only control in the
   * product drawn to no rung of the ladder at all: a 26px icon is larger than
   * anything else on screen, in the corner furthest from where the eye is, and
   * six of them stacked made the canvas look like it had a toolbar bolted on.
   *
   * The island is now `icon` (32px / 18px glyph) and the bar is `iconSm`
   * (28px / 16px), which are the two rungs every other icon button in the app
   * stands on. The island stays the LARGER of the two, which is what the
   * original note was actually protecting — it is still the thing you press
   * mid-drag.
   */
  compact,
  className = "",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex shrink-0 items-center justify-center rounded-control text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
        compact ? "size-7 [&_svg]:size-4" : "size-8 [&_svg]:size-[18px]"
      } ${className}`}
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
  publishedVersion,
  isPublished,
  unpublished,
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
  publishedVersion: number | null;
  isPublished: boolean;
  /**
   * The draft on screen would not produce what the dashboard is showing —
   * content-compared, so a drag or a Test does not claim it. For a flow that
   * has never been published it is simply true (nothing is live), which is why
   * the wording below asks `publishedVersion` and not this.
   */
  unpublished: boolean;
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

  /**
   * WHAT THIS BUTTON IS FOR, RIGHT NOW.
   *
   * It read "Edit output" for any published flow — including one whose steps
   * had been rewritten since, which is the exact case where the only thing
   * that matters is shipping them. "Edit output" is a settled word; it told a
   * customer their work was done while the dashboard served three-day-old
   * filters. So: anything unshipped puts the rocket and the shipping words
   * back, and the button stays the one saturated control in the bar.
   */
  const shipping = !isPublished || unpublished;

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
      <TopBarPortal>
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {/* WHAT YOU DO WITH THE FLOW. Ship, run, on/off — the three acts,
                together at the reading edge; the name stays centred by the grid
                regardless.
                THE BACK ARROW IS GONE. It pointed at /dashboard/flows, which is
                one row down in the rail and reachable from every screen in the
                product — so it was a fourth control in a group of three acts,
                the only one that navigated rather than did something, and the
                first thing your eye met on a page you had just chosen to be on.
                Leaving a route is what the rail is for; the browser's own back
                gesture covers the rest.
                `gap-4` — the exact spacing between "Invite members" and "New
                flow" on the other end of this bar, so every group in the top bar
                is spaced the same way. */}
            <span className="flex min-w-0 items-center gap-4">
              <Button
                onClick={onReview}
                disabled={publishing}
                title={
                  unpublished && publishedVersion != null
                    ? "Your edits are not on the dashboard yet — publish to make them live"
                    : undefined
                }
                /* `size="sm"` — the SAME rung "Invite members" and "New flow"
                   take one row up. This was `h-[42px] px-[18px] text-md`: 42px
                   tall against their 36, 18px of padding against 14, and a 16px
                   label against their 14. Three near-misses, so the builder's
                   primary act and the chrome's primary acts read as two
                   different button systems sharing a bar. No `ml-1` either —
                   the row's own `gap-2` is the spacing. */
                size="sm"
                className="shrink-0"
              >
                {shipping ? <Rocket /> : <SlidersHorizontal />}
                {shipping ? "Review & publish" : "Edit output"}
              </Button>
              <Switch
                checked={isPublished}
                disabled={publishedVersion == null || togglingEnabled}
                onClick={onToggleEnabled}
                title={
                  publishedVersion == null
                    ? "Publish this flow before turning it on"
                    : isPublished
                      ? "Turn off — removes its dashboard tiles"
                      : "Turn on"
                }
                aria-label={isPublished ? "Turn flow off" : "Turn flow on"}
              />

              {/* No "Flows /" crumb. The back arrow beside it already goes there
                  and already says so on hover; a breadcrumb whose only parent is
                  the button next to it is a word for its own sake. */}

            </span>

            {/* THE NAME, DEAD CENTRE. It is the one thing on this bar that is
                about the flow rather than about what you can do to it, and the
                grid's auto column keeps it centred no matter how long it gets
                or what appears either side of it. */}
            <span className="flex min-w-0 items-center justify-center">
              <FlowNameField name={name} onRename={onRename} />
            </span>

            {/* QUIET STATE AND HISTORY. The acts moved to the left edge with
                the back arrow; what stays here is what you rarely touch —
                whether it saved, undo/redo, and the step menu at the far
                corner. */}
            <span className="flex items-center justify-end gap-4">
              {/* SAVED IS NOT LIVE, AND THE BAR HAS TO SAY WHICH IT MEANS.
                  Deliberately AFTER "Saved", because it corrects it: the word
                  beside it answers a different question — the draft reached the
                  server — and a customer read it as "the dashboard has this",
                  edited two filters, pressed Test, and watched the old number
                  sit on their dashboard for three days. This is the only thing
                  in the bar that can be wrong about the PRODUCT rather than
                  about the editing session, so it is the only thing here
                  wearing a tone. */}
              {/* UNDO AND REDO ARE ON THE CANVAS ISLAND, NOT UP HERE.
                  They belong with the other things you do TO THE DRAWING —
                  zoom, fit — rather than with the things you do to the FLOW.
                  Moving them also empties this corner down to what it should
                  always have been: whether it saved, and the step menu. */}
              <Popover
                open={menuOpen}
                setOpen={setMenuOpen}
                width={210}
                align="left"
                anchor={
                  <IslandButton compact className="-mx-1.5" onClick={() => setMenuOpen(!menuOpen)} label="Flow actions">
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
                    className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    <Copy size={16} />
                    Duplicate flow
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmingDelete(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-danger-soft/60"
                  >
                    <Trash2 size={16} />
                    Delete flow
                  </button>
                </div>
              </Popover>
              {/* Words, no dot. The reference this island copies has a green dot,
                  and it is deliberately not here: a dot needs a legend and a word
                  does not. Do not "restore" it. */}

              {/* The flow's own on/off switch, where Zapier puts a Zap's. It cannot
                  be turned on before the flow has ever been published — there
                  would be nothing to turn on — so it sits inactive until the
                  first publish, which flips it on by itself. It lives beside
                  the name and the save state because all three answer the same
                  question: what IS this flow right now. */}

              {/* 18px, not the Button's shared 16px: a 26px standalone glyph sits one
                  control away, and 16 beside it read as two different icon sets. */}
              {unpublished && (
                <StatusPill
                  tone="warn"
                  className="shrink-0"
                  title={
                    publishedVersion == null
                      ? "Nothing from this flow is on the dashboard yet"
                      : "The dashboard is still showing the last published version of this flow"
                  }
                >
                  {publishedVersion == null ? "Not published" : "Changes not live"}
                </StatusPill>
              )}

            </span>
          </div>
        </TopBarPortal>
      {/* At the bar's right edge, first in the chrome's own group. */}
      <TopBarStatusPortal>
        <SaveChip state={saveState} onRetry={onRetrySave} />
      </TopBarStatusPortal>

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
            className="tnum size-8 rounded-control text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            {zoomPct}%
          </button>
          <IslandButton onClick={onZoomIn} label="Zoom in">
            <ZoomIn />
          </IslandButton>
          <IslandButton onClick={onUndo} disabled={!canUndo} label="Undo">
            <Undo2 />
          </IslandButton>
          <IslandButton onClick={onRedo} disabled={!canRedo} label="Redo">
            <Redo2 />
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
        <Modal onClose={() => setConfirmingDelete(false)}>
          <ModalTitle>Delete this flow?</ModalTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
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
        </Modal>
      )}
    </>
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
      <StatusPill tone="danger">
        Not saved
        <button
          type="button"
          onClick={onRetry}
          className="rounded-control underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      </StatusPill>
    );
  }
  return (
    <span className="shrink-0 whitespace-nowrap text-sm font-medium text-muted-foreground">
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Unsaved"}
    </span>
  );
}
