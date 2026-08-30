"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, Plus } from "lucide-react";
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
 * A MONTH, AT A TWENTIETH OF ITS SIZE — seven columns and a heat ramp, which is
 * what makes this card unmistakable beside the other two at a glance.
 *
 * The leading blanks are drawn, not trimmed, for the same reason `monthGrid`
 * emits them: a calendar whose 1st sits under the wrong weekday is not a
 * picture of a calendar. The tinted squares fade the way the real ramp does, so
 * the thumbnail says "heat map" rather than merely "grid".
 *
 * Orange, where the other two are violet and neutral — it is the calendar
 * kind's identity tint, and the board you land on wears the same colour on the
 * chip beside its metric picker.
 */
function CalendarPreview() {
  /* Two leading blanks, then a month of squares whose weight rises and falls —
     hand-picked rather than random so the thumbnail is the same every render
     (and because `Math.random()` in a component is a hydration mismatch). */
  const heat = [0, 0, 15, 30, 55, 20, 10, 40, 75, 35, 60, 25, 90, 45, 15, 70, 30, 55, 20, 80, 40];
  return (
    <div className="grid h-full grid-cols-7 gap-1 p-3">
      {heat.map((h, i) => (
        <span
          key={i}
          aria-hidden
          className="rounded-xs"
          style={
            h === 0
              ? undefined
              : { background: `color-mix(in srgb, var(--color-accent-orange) ${h}%, var(--color-card))` }
          }
        />
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
  {
    /**
     * THE THIRD KIND, AND THE ONE THAT ASKS A SECOND QUESTION.
     *
     * It was a page of its own with a row in the rail, which said the calendar
     * was a separate part of the product. It is not: `materializeFlow` computes
     * the range pills, the chart buckets and every calendar day in ONE pass and
     * stores them side by side, so a calendar is a third way of drawing numbers
     * the board already has. That is a view.
     *
     * Unlike the other two it cannot be created blind — a calendar is a
     * breakdown OF something, so `needsMetric` sends this card to a second step
     * instead of straight to the server.
     */
    kind: "calendar",
    label: "Calendar",
    blurb: "One metric, broken down day by day, with the busy days shaded. Two months at a time.",
    Preview: CalendarPreview,
    needsMetric: true,
  },
] as const;

/** One published metric this picker may point a calendar at. */
export type CalendarOption = { key: string; name: string; hint?: string };

export function ViewTemplatePicker({
  onClose,
  rangeKey,
  source,
  calendarOptions = [],
}: {
  onClose: () => void;
  /** Carried through so a new view opens on the period you were already reading. */
  rangeKey: string;
  source: string | null;
  /**
   * THE METRICS A CALENDAR COULD BE OF — derived on the server from the flow
   * tiles the board already holds, so offering this choice costs NO NEW QUERY.
   *
   * Empty is a real answer, not a missing prop: a workspace with nothing
   * published has nothing to break down by day, and step two says so rather
   * than creating a calendar that can only report its own emptiness.
   */
  calendarOptions?: CalendarOption[];
}) {
  /**
   * WHICH KIND IS MID-CHOICE. `null` is step one.
   *
   * Only the calendar ever sets it — the other two post on the first press,
   * which is the behaviour that was already there and worth not spending.
   */
  const [picking, setPicking] = useState<string | null>(null);

  if (picking === "calendar") {
    return (
      <Modal onClose={onClose} size="lg">
        <ModalTitle>Which metric?</ModalTitle>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A calendar breaks one metric down day by day. You can change it later, and the view will remember.
        </p>
        {calendarOptions.length === 0 ? (
          /* NOTHING TO OFFER, SAID PLAINLY. The alternative — create the view
             anyway and let it explain itself — spends a view and a click to
             deliver the same sentence. */
          <div className="mt-5 rounded-surface border border-border bg-ground p-6 text-center">
            <p className="text-md font-semibold text-foreground">No published metrics yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              A calendar needs a published metric to break down. Build a flow and publish it, then this view will have
              something to show.
            </p>
            <Button asChild variant="yellow" className="mt-4">
              <Link href="/dashboard/flows">Go to flows</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-5 max-h-80 space-y-2 overflow-y-auto">
            {calendarOptions.map((o) => (
              /* One form per row, for the reason the cards below use one each:
                 the choice is a SUBMIT, so the existing server action and its
                 redirect are untouched. `label` names the view after the metric
                 so the tab says which calendar it is. */
              <form key={o.key} action={addViewAction}>
                <input type="hidden" name="range" value={rangeKey} />
                <input type="hidden" name="source" value={source ?? ""} />
                <input type="hidden" name="kind" value="calendar" />
                <input type="hidden" name="tileKey" value={o.key} />
                <input type="hidden" name="label" value={o.name} />
                <SubmitButton
                  variant="ghost"
                  pendingLabel="Creating…"
                  className="h-auto w-full justify-start whitespace-normal rounded-card border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-card"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-orange text-white"
                    >
                      <CalendarDays className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-md font-semibold text-foreground">{o.name}</span>
                      {o.hint && <span className="block truncate text-sm font-normal text-muted-foreground">{o.hint}</span>}
                    </span>
                  </span>
                </SubmitButton>
              </form>
            ))}
          </div>
        )}
        {/* BACK, NOT CANCEL. A second step with only a way out is a dead end;
            this returns to the three cards, which is where a reader who came
            here by mistake wants to be. */}
        <div className="mt-5 flex justify-start">
          <Button variant="ghost" onClick={() => setPicking(null)}>
            <ChevronLeft />
            Back
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} size="lg">
      <ModalTitle>Choose a layout</ModalTitle>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A view is one arrangement of your metrics. The numbers are the same in every one — what changes is how they
        are laid out. You can add more later.
      </p>

      {/* THREE CARDS, THREE COLUMNS — which is `BOARD_GRID`'s own ceiling
          rather than a number picked for this modal. It was two while there
          were two kinds. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {TEMPLATES.map((t) => {
          /* THE WHOLE CARD IS THE CONTROL, and this is the one place that is
             right. The connector catalogue's rule — a card is not a button,
             every action on it is a real control — exists because those cards
             carry SEVERAL acts and a clickable surface swallows them. A
             template card has exactly one: choose this. Making the reader aim
             at a small button under a large picture of the thing they are
             choosing is the worse interface, and it is not what Miro or Notion
             do either.

             `whitespace-normal` because `buttonVariants`' base is a one-line
             pill; `rounded-[var(--radius-surface)]` because the arbitrary
             spelling is the one that beats that pill — the named class loses to
             it in `cn()`.

             `h-full` RATHER THAN `h-auto`, and `justify-start` rather than the
             base's `justify-center`. Both were measured rather than guessed:
             with `h-auto` the Custom card came out 251px inside a 270px grid
             cell — a short card with a hairline floating clear of its
             neighbours — because the `<form>` stretches and the button inside
             it does not. And once a card DOES fill its cell, the base's
             `justify-center` centres the spare space, which pushed the Calendar
             card's heading 10px below the other two. Three cards whose titles
             sit on three different lines is the kind of thing that reads as
             sloppiness without ever being noticed as a bug. */
          const shell =
            "group/tpl h-full w-full flex-col items-stretch justify-start gap-0 whitespace-normal rounded-[var(--radius-surface)] border border-border bg-card p-0 text-left transition-colors hover:border-primary hover:bg-card";
          const face = (
            <>
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
            </>
          );

          /* A CALENDAR IS A VIEW OF SOMETHING, so its card opens the second
             step rather than posting. The other two carry everything the server
             needs already, and sending them through a step that asks nothing
             would be ceremony. */
          return "needsMetric" in t && t.needsMetric ? (
            <Button key={t.kind} variant="ghost" className={shell} onClick={() => setPicking(t.kind)}>
              {face}
            </Button>
          ) : (
            /* A submit rather than a click handler, so the existing server
               action and its redirect are untouched. */
            /* `h-full` on the FORM too: it is the grid item, so it is what the
               row stretches, and the button's own `h-full` resolves against it. */
            <form key={t.kind} action={addViewAction} className="h-full">
              <input type="hidden" name="range" value={rangeKey} />
              <input type="hidden" name="source" value={source ?? ""} />
              <input type="hidden" name="kind" value={t.kind} />
              <SubmitButton variant="ghost" pendingLabel="Creating…" className={shell}>
                {face}
              </SubmitButton>
            </form>
          );
        })}
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
export function AddViewButton({
  rangeKey,
  source,
  calendarOptions,
}: {
  rangeKey: string;
  source: string | null;
  /** Passed straight through — see the picker's own note. */
  calendarOptions?: CalendarOption[];
}) {
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
      {open && (
        <ViewTemplatePicker
          onClose={() => setOpen(false)}
          rangeKey={rangeKey}
          source={source}
          calendarOptions={calendarOptions}
        />
      )}
    </>
  );
}
