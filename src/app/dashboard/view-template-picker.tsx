"use client";

import { useState } from "react";
import { Columns3, LayoutGrid, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
 * The two kinds, and the one place they are described.
 *
 * The tints are IDENTITY, NEVER STATE — which is the whole licence the accent
 * four have. These two need telling apart at a glance rather than ranking, so
 * they get a chip each out of the sheet's decorative range; success/warn/danger
 * keep their monopoly on meaning something.
 */
const TEMPLATES = [
  {
    kind: "groups",
    label: "Columns",
    blurb: "Group your metrics into named, coloured columns. The board most teams read every morning.",
    Icon: Columns3,
    tint: "bg-accent-peri/30",
  },
  {
    kind: "custom",
    label: "Custom",
    blurb: "Place and size charts on a grid. One metric can appear several times, drawn several ways.",
    Icon: LayoutGrid,
    tint: "bg-accent-pink/35",
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
          /* THE CARD IS NOT A BUTTON. Every action on it is a real control —
             the house rule the connector catalogue states outright, and the
             reason the CTA below is a submit rather than the whole tile being
             clickable. `h-full` + `mt-auto` on the footer so both cards' buttons
             land on one line however long the blurbs run. */
          <Card key={t.kind} variant="surface" padding="compact" className="flex h-full flex-col">
            <span
              aria-hidden
              className={`flex size-11 shrink-0 items-center justify-center rounded-control text-foreground ${t.tint}`}
            >
              <t.Icon size={20} />
            </span>
            <h3 className="mt-3 text-md font-semibold text-foreground">{t.label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
            <div className="mt-auto pt-4">
              {/* The SAME server action the `+` has always posted to, with the
                  same three hidden fields. `addViewAction` validates the cap,
                  inserts the row and redirects onto the new view — so nothing
                  here has to know where it lands. */}
              <form action={addViewAction}>
                <input type="hidden" name="range" value={rangeKey} />
                <input type="hidden" name="source" value={source ?? ""} />
                <input type="hidden" name="kind" value={t.kind} />
                <SubmitButton variant="secondary" pendingLabel="Creating…" className="w-full">
                  Use {t.label}
                </SubmitButton>
              </form>
            </div>
          </Card>
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
