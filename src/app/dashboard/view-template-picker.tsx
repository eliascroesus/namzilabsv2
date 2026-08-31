"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { addViewAction } from "./board-actions";
import { PRESET_COLS, REPORT_PRESET, presetRows } from "@/lib/board/presets";

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
  /* Three lanes with coloured caps and tiles inside them — what
     `board-column.tsx` draws, at a fifth of the size rather than a twelfth.
     Each tile carries a HEADLINE BAR and a fainter second line, because that is
     what a metric card actually looks like and it is the difference between a
     picture of the board and a grey pattern. The lanes hold different numbers of
     tiles, which is the one thing a columns board always does. */
  const lanes = [
    { cap: "bg-success", tiles: 3 },
    { cap: "bg-accent-peri", tiles: 2 },
    { cap: "bg-accent-pink", tiles: 3 },
  ];
  return (
    <div className="flex h-full gap-2 p-4">
      {lanes.map(({ cap, tiles }) => (
        <div key={cap} className="flex flex-1 flex-col gap-1.5 overflow-hidden rounded-card bg-foreground/5 p-1.5">
          <span aria-hidden className={`h-1.5 w-full shrink-0 rounded-full ${cap}`} />
          {Array.from({ length: tiles }).map((_, i) => (
            <span key={i} aria-hidden className="flex flex-col gap-1 rounded-sm bg-card p-1.5 shadow-xs">
              <span className="h-1.5 w-3/5 rounded-full bg-foreground/25" />
              <span className="h-1 w-2/5 rounded-full bg-foreground/10" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomPreview() {
  /* A twelve-column grid with boxes of different sizes — the one thing a canvas
     can do that columns cannot. The big one carries a CHART (bars rising off a
     baseline) rather than being an empty rectangle, because "place and size
     charts on a grid" was the sentence this picture now has to say by itself. */
  return (
    <div className="grid h-full grid-cols-12 grid-rows-6 gap-2 p-4">
      <span aria-hidden className="col-span-7 row-span-4 flex flex-col justify-end gap-1 rounded-card bg-card p-2 shadow-xs">
        <span className="h-1.5 w-2/5 rounded-full bg-foreground/25" />
        {/* The bars, at hand-picked heights so the thumbnail is identical on
            every render — `Math.random()` in a component is a hydration
            mismatch, and a chart that reshuffles is not a picture of anything.
            IN THE MARKER, because that is what the real bars are drawn in: a
            mark is one measure with no ink on it, so all it has is its edge
            against the card, and the brand yellow is 1.55:1 there. A preview
            that used a colour the board does not is the drift this whole file
            argues against. */}
        <span className="flex flex-1 items-end gap-1">
          {[45, 70, 35, 90, 60, 80].map((h, i) => (
            <span key={i} className="flex-1 rounded-xs bg-marker/70" style={{ height: `${h}%` }} />
          ))}
        </span>
      </span>
      <span aria-hidden className="col-span-5 row-span-2 flex flex-col gap-1 rounded-card bg-card p-2 shadow-xs">
        <span className="h-1.5 w-1/2 rounded-full bg-foreground/25" />
        <span className="h-3 w-2/3 rounded-xs bg-foreground/15" />
      </span>
      <span aria-hidden className="col-span-5 row-span-2 flex flex-col gap-1 rounded-card bg-card p-2 shadow-xs">
        <span className="h-1.5 w-2/5 rounded-full bg-foreground/25" />
        <span className="h-3 w-1/2 rounded-xs bg-foreground/15" />
      </span>
      <span aria-hidden className="col-span-4 row-span-2 rounded-card bg-card shadow-xs" />
      <span aria-hidden className="col-span-8 row-span-2 rounded-card bg-card shadow-xs" />
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
 * Orange, where the previews beside it draw their marks in the marker and
 * everything else in neutrals — it is the calendar kind's identity tint, and the
 * board you land on wears the same colour on the chip beside its metric picker.
 */
function CalendarPreview() {
  /* Two leading blanks, then a month of squares whose weight rises and falls —
     hand-picked rather than random so the thumbnail is the same every render
     (and because `Math.random()` in a component is a hydration mismatch).
     A WEEKDAY HEADER ROW, which is what makes this read as a CALENDAR rather
     than as a heat grid: seven ticks above seven columns is the shape everyone
     recognises before they have read anything. */
  const heat = [0, 0, 15, 30, 55, 20, 10, 40, 75, 35, 60, 25, 90, 45, 15, 70, 30, 55, 20, 80, 40, 50, 25, 65, 35, 10, 45, 30];
  return (
    <div className="flex h-full flex-col gap-1.5 p-4">
      <div className="grid shrink-0 grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} aria-hidden className="h-1 rounded-full bg-foreground/15" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 gap-1.5">
        {heat.map((h, i) => (
          <span
            key={i}
            aria-hidden
            className="rounded-sm"
            style={
              h === 0
                ? { background: "var(--color-card)" }
                : { background: `color-mix(in srgb, var(--color-accent-orange) ${h}%, var(--color-card))` }
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * THE PRESET, DRAWN FROM THE PRESET.
 *
 * Every other preview here is a hand-made impression of a board. This one is
 * the actual layout: same twelve columns, same boxes, same rows, read straight
 * off `REPORT_PRESET`. So the card cannot promise an arrangement the template
 * does not create — which is the same argument the file already makes for
 * drawing previews from tokens instead of shipping screenshots, taken one step
 * further. A picture and the thing it depicts drift the moment they are two
 * objects; here they are one.
 *
 * The two plots carry bars and the four numbers carry a label-and-figure, so
 * the shape reads as "charts over headline numbers" rather than as six grey
 * rectangles — the same reason `CustomPreview` grew its bars.
 */
function ReportPreview() {
  const rows = presetRows(REPORT_PRESET);
  return (
    <div
      className="grid h-full gap-1.5 p-4"
      style={{ gridTemplateColumns: `repeat(${PRESET_COLS}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {REPORT_PRESET.tiles.map((t, i) => (
        <span
          key={i}
          aria-hidden
          className="flex flex-col gap-1 overflow-hidden rounded-card bg-card p-1.5 shadow-xs"
          style={{ gridColumn: `${t.x + 1} / span ${t.w}`, gridRow: `${t.y + 1} / span ${t.h}` }}
        >
          <span className="h-1 w-1/2 shrink-0 rounded-full bg-foreground/25" />
          {t.chart === "number" ? (
            <span className="h-2.5 w-2/3 rounded-xs bg-foreground/15" />
          ) : (
            <span className="flex flex-1 items-end gap-1">
              {[50, 75, 40, 90, 60].map((h, b) => (
                <span key={b} className="flex-1 rounded-xs bg-marker/70" style={{ height: `${h}%` }} />
              ))}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * The kinds, and the one place they are described.
 */
const TEMPLATES = [
  {
    /**
     * `id` IS NOT `kind`, and that distinction arrived with the Report preset.
     * Two cards are now `kind: "custom"` — the blank canvas and the preset —
     * so keying React on the kind silently collided: "Encountered two children
     * with the same key". React is then free to drop or duplicate one of them,
     * which is a bug that renders correctly right up until it does not.
     */
    id: "groups",
    kind: "groups",
    label: "Columns",
    Preview: ColumnsPreview,
  },
  {
    id: "custom",
    kind: "custom",
    label: "Custom",
    Preview: CustomPreview,
  },
  {
    /**
     * A CUSTOM VIEW THAT ARRIVES WITH ITS BOXES PLACED. Same kind, same board,
     * same everything you can do to it afterwards — the only difference is that
     * it starts as a shape instead of as an empty canvas. `preset` is what says
     * so on the post; `addViewAction` lands the tiles in the same statement as
     * the view, so a template is never half-created.
     *
     * NONE OF ITS TILES POINT AT A METRIC, and that is the property that makes
     * a template possible at all: an arrangement travels between workspaces and
     * the metrics in it never do. Each box opens the metric picker when pressed,
     * exactly as a hand-added chart now does.
     */
    id: REPORT_PRESET.id,
    kind: "custom",
    preset: REPORT_PRESET.id,
    label: REPORT_PRESET.label,
    Preview: ReportPreview,
  },
  {
    /**
     * THE THIRD KIND, CREATED IN ONE PRESS LIKE THE OTHER TWO.
     *
     * It was a page of its own with a row in the rail, which said the calendar
     * was a separate part of the product. It is not: `materializeFlow` computes
     * the range pills, the chart buckets and every calendar day in ONE pass and
     * stores them side by side, so a calendar is a third way of drawing numbers
     * the board already has. That is a view.
     *
     * IT BRIEFLY ASKED WHICH METRIC FIRST, as a second step in this modal, and
     * that was a question with nowhere good to put the answer. The board already
     * carries a metric dropdown — switching is one press, right where you are
     * looking — so the modal was charging a decision up front for something the
     * view lets you change instantly and then remembers. It opens on the first
     * metric and you change it there.
     *
     * Named plainly "Calendar" rather than after that first metric, because the
     * metric is not what the view IS: name a tab "Bookings" and then switch it
     * to Revenue and the strip is lying. The tab is renameable like any other.
     */
    id: "calendar",
    kind: "calendar",
    label: "Calendar",
    Preview: CalendarPreview,
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
  return (
    <Modal onClose={onClose} size="lg">
      <ModalTitle>Choose a layout</ModalTitle>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A view is one arrangement of your metrics. The numbers are the same in every one — what changes is how they
        are laid out. You can add more later.
      </p>

      {/* TWO PER ROW, WHICH IS WHAT MAKES THE PICTURES BIG ENOUGH TO WORK.
          Three columns fitted the three kinds neatly and made each thumbnail
          ~150px wide — at that size a twelve-column grid and a month of squares
          are both "a small grey pattern", which is the failure a thumbnail
          picker exists to avoid. Miro and Notion both run two or three LARGE
          tiles and let the row wrap; the picture is the control, so the picture
          gets the width.
          `items-start` so a wrapped third card does not stretch to the height of
          the two above it. */}
      <div className="mt-5 grid items-start gap-4 sm:grid-cols-2">
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
             sloppiness without ever being noticed as a bug.

             THE HOVER EDGE IS THE MARKER'S. A border is a line, and the brand
             yellow measures 1.55:1 as a stroke on white — the card would answer
             the pointer by appearing to lose its edge rather than to gain one.
             Violet is what draws in this product, and at 4.41:1 a 1px rim is
             unmistakably there. */
          const shell =
            "group/tpl h-full w-full flex-col items-stretch justify-start gap-0 whitespace-normal rounded-[var(--radius-surface)] border border-border bg-card p-0 text-left transition-colors hover:border-marker hover:bg-card";
          const face = (
            <>
              {/* THE THUMBNAIL IS THE CARD NOW, and the sentence under it is
                  gone. Three descriptions in a chooser is a paragraph asking to
                  be read before a decision that a picture already makes — and
                  the pictures are drawn from the real thing, so they are more
                  accurate than the prose was. What survives is the NAME, which
                  is what you say to somebody else afterwards.
                  `aspect-[4/3]` rather than a fixed height: the tile grows with
                  the column instead of staying 112px while the card gets wider,
                  which is what let the previews read as small grey patterns.
                  On the page's own ground rather than the card's surface — a
                  layout is a thing that sits ON a board, and drawing it on the
                  card's own colour leaves its tiles nothing to be seen against. */}
              <span className="block aspect-[4/3] w-full overflow-hidden rounded-t-[calc(var(--radius-surface)-1px)] border-b border-border bg-background">
                <t.Preview />
              </span>
              <span className="block px-4 py-3 text-md font-semibold text-foreground">{t.label}</span>
            </>
          );

          /* ALL THREE POST ON THE FIRST PRESS. A submit rather than a click
             handler, so the existing server action and its redirect are
             untouched.
             `h-full` on the FORM too: it is the grid item, so it is what the
             row stretches, and the button's own `h-full` resolves against it. */
          return (
            <form key={t.id} action={addViewAction} className="h-full">
              <input type="hidden" name="range" value={rangeKey} />
              <input type="hidden" name="source" value={source ?? ""} />
              <input type="hidden" name="kind" value={t.kind} />
              {"preset" in t && <input type="hidden" name="preset" value={t.preset} />}
              {t.kind === "calendar" && (
                <>
                  {/* THE FIRST METRIC, CHOSEN HERE SO NOBODY IS ASKED. The list
                      is already sorted by name, so "first" is stable rather than
                      whichever row the database happened to return. An empty
                      value is fine and deliberate: `addViewAction` stores no
                      placement, and the board opens on its "nothing published
                      yet" state — which is the truth, and better than a modal
                      refusing to create anything. */}
                  <input type="hidden" name="tileKey" value={calendarOptions[0]?.key ?? ""} />
                  {/* Named for what it IS, not for the metric it opens on —
                      see the note on the template. */}
                  <input type="hidden" name="label" value="Calendar" />
                </>
              )}
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
