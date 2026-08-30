"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { addViewAction } from "./board-actions";

/**
 * PICKING A LAYOUT — one modal, reached from both places a view can be created.
 *
 * There were two: a `<details>` dropdown behind the `+`, and nothing at all for
 * a workspace with no views (which could not happen, because the board always
 * synthesised a default tab). Now the empty board offers "Get started" and the
 * `+` offers the same choice, and they open the same component — so the two
 * cannot drift into describing the two kinds of view differently.
 *
 * IT COSTS THE `+` ITS NO-JAVASCRIPT PATH, and that was a real property: the
 * dropdown was a `<details>` holding two plain form posts specifically so it
 * worked with none. It is given up deliberately rather than overlooked. Keeping
 * it would mean rendering this choice twice — once as a dropdown, once as a
 * modal — and holding the two in step forever, which is the drift this file
 * exists to remove. Everything else on this board (the drag, the filters, the
 * tabs) already requires JavaScript.
 */

/**
 * A PICTURE OF THE LAYOUT, NOT AN ICON OF IT.
 *
 * The two options were a 44px glyph, a name and a sentence — which is a menu
 * row wearing a card, and it asks somebody who has never seen either board to
 * choose between two abstractions. Miro and Notion both lead their template
 * pickers with a THUMBNAIL for the same reason: the fastest way to say what an
 * arrangement looks like is to show a small one.
 *
 * Drawn in divs from the kit's own tokens rather than shipped as images. It
 * costs nothing to load, it re-themes with everything else, and — the actual
 * argument — a screenshot goes stale the first time the board changes and
 * nobody notices, whereas this is built from the same border, radius and accent
 * the real thing is.
 *
 * The tints are the two the `+` menu already used for these kinds: IDENTITY,
 * never state. success/warn/danger keep their monopoly on meaning something.
 */
function ColumnsPreview() {
  return (
    /* Three lanes, each a tinted column with a coloured cap and two tiles —
       which is exactly what `board-column.tsx` draws, at a twelfth the size. */
    <div className="flex h-full gap-1.5 p-3">
      {["bg-success", "bg-accent-peri", "bg-accent-pink"].map((cap, lane) => (
        <div key={cap} className="flex flex-1 flex-col gap-1 overflow-hidden rounded-sm bg-foreground/5 p-1">
          <span aria-hidden className={`h-1 w-full shrink-0 rounded-full ${cap}`} />
          {Array.from({ length: lane === 1 ? 1 : 2 }).map((_, i) => (
            <span key={i} aria-hidden className="h-3.5 w-full shrink-0 rounded-sm bg-card shadow-xs" />
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomPreview() {
  /* A twelve-column grid with boxes of different sizes and one full-width row,
     which is the one thing a canvas can do that columns cannot. */
  const boxes = [
    "col-span-7 row-span-2",
    "col-span-5",
    "col-span-5",
    "col-span-4",
    "col-span-8",
  ];
  return (
    <div className="grid h-full grid-cols-12 grid-rows-3 gap-1.5 p-3">
      {boxes.map((box, i) => (
        <span key={i} aria-hidden className={`rounded-sm bg-card shadow-xs ${box}`} />
      ))}
    </div>
  );
}

/**
 * The two kinds, and the one place they are described.
 */
const TEMPLATES = [
  {
    kind: "groups",
    label: "Columns",
    blurb: "Group your metrics into named, coloured columns. The board most teams read every morning.",
    Preview: ColumnsPreview,
  },
  {
    kind: "custom",
    label: "Custom",
    blurb: "Place and size charts on a grid. One metric can appear several times, drawn several ways.",
    Preview: CustomPreview,
  },
] as const;

export function ViewTemplatePicker({
  onClose,
  rangeKey,
  source,
}: {
  onClose: () => void;
  /** Carried through so a new view opens on the period you were already reading. */
  rangeKey: string;
  source: string | null;
}) {
  return (
    <Modal onClose={onClose} size="lg">
      <ModalTitle>Choose a layout</ModalTitle>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A view is one arrangement of your metrics. The numbers are the same in every one — what changes is how they
        are laid out. You can add more later.
      </p>

      {/* Two cards, so two columns. `BOARD_GRID`'s third rung would leave a gap
          at this width, and the kit's own note says three is a ceiling rather
          than a target. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {TEMPLATES.map((t) => (
          /* THE WHOLE CARD IS THE CONTROL, and this is the one place that is
             right. The connector catalogue's rule — a card is not a button,
             every action on it is a real control — exists because those cards
             carry SEVERAL acts and a clickable surface swallows them. A
             template card has exactly one: choose this. Making the reader aim
             at a small button under a large picture of the thing they are
             choosing is the worse interface, and it is not what Miro or Notion
             do either.
             It is a submit rather than a click handler, so the existing server
             action and its redirect are untouched. */
          <form key={t.kind} action={addViewAction}>
            <input type="hidden" name="range" value={rangeKey} />
            <input type="hidden" name="source" value={source ?? ""} />
            <input type="hidden" name="kind" value={t.kind} />
            <SubmitButton
              variant="ghost"
              pendingLabel="Creating…"
              /* `h-auto` and `whitespace-normal` because `buttonVariants`' base
                 is a one-line pill; `rounded-[var(--radius-surface)]` because
                 the arbitrary spelling is the one that beats that pill — the
                 named class loses to it in `cn()`. */
              className="group/tpl h-auto w-full flex-col items-stretch gap-0 whitespace-normal rounded-[var(--radius-surface)] border border-border bg-card p-0 text-left transition-colors hover:border-primary hover:bg-card"
            >
              {/* THE THUMBNAIL, on the page's own ground rather than the card's
                  white — a layout is a thing that sits ON a board, and drawing
                  it on the same surface as the card would leave its tiles with
                  nothing to be seen against. */}
              <span className="block h-28 w-full overflow-hidden rounded-t-[calc(var(--radius-surface)-1px)] border-b border-border bg-ground">
                <t.Preview />
              </span>
              <span className="block p-4">
                <span className="block text-md font-semibold text-foreground">{t.label}</span>
                <span className="mt-1 block text-sm font-normal leading-snug text-muted-foreground">{t.blurb}</span>
              </span>
            </SubmitButton>
          </form>
        ))}
      </div>
    </Modal>
  );
}

/**
 * THE `+` BESIDE THE VIEW TABS.
 *
 * Same 28px square and the same violet hover the `<details>` summary wore, so
 * the row it sits in does not move — it is what the control OPENS that changed.
 * A `Button` rather than a raw element because `check:ui` bans hand-rolled
 * buttons outside the primitives and the builder's own chrome, and this file is
 * neither.
 */
export function AddViewButton({ rangeKey, source }: { rangeKey: string; source: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Add a view"
        aria-haspopup="dialog"
        className="size-7 shrink-0 rounded-control p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Plus size={15} />
        <span className="sr-only">Add a view</span>
      </Button>
      {/* `Modal` has no `open` prop — the caller mounts it. */}
      {open && <ViewTemplatePicker onClose={() => setOpen(false)} rangeKey={rangeKey} source={source} />}
    </>
  );
}
