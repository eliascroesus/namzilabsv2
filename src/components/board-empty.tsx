"use client";

import { useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GetStartedCard } from "@/components/get-started-card";
import { ViewTemplatePicker } from "@/app/dashboard/view-template-picker";

/**
 * A DASHBOARD WITH NOTHING ON IT — one card, one act, and no furniture.
 *
 * The board could not be empty before: `viewStrip` synthesised a "Dashboard" tab
 * for any workspace with no view row, so a brand-new account arrived at a page
 * title, a six-pill period track, a tab strip and an action row arranged around
 * nothing at all. Furniture before content, and a first screen that asks you to
 * read four controls before it tells you what the product is for.
 *
 * The flow builder already answers this properly, so this is its answer applied
 * to the other canvas — and it is literally its shell, `GetStartedCard`, not a
 * copy of it. The two are the same moment in two places, and a product with two
 * ways of saying "there is nothing here yet" has told you something about
 * itself; a copy carrying a comment promising to stay the same is how that
 * happens anyway.
 *
 * WHAT IT DOES NOT SAY. It does not repeat the builder's three moves — those are
 * about making a metric, and by the time you are here you may already have
 * several. What is missing is somewhere to PUT them, so the steps describe a
 * view: pick a shape, your published metrics arrive on it, add more views for
 * other readings of the same numbers.
 *
 * It owns its own modal state and takes no callback, which is what lets `/design`
 * render it directly. `EmptyCanvas` needed a `-preview` wrapper for exactly the
 * opposite reason: it takes an `onStart`, and a server component cannot hand a
 * client component a function.
 */

const STEPS = [
  { n: 1, title: "Pick a layout", detail: "columns to group by, or a grid to arrange freely" },
  { n: 2, title: "Your metrics appear on it", detail: "everything published, ready to place" },
  { n: 3, title: "Add more views", detail: "the same numbers, read a different way" },
];

export function EmptyBoard({
  rangeKey,
  source,
  canCreate,
}: {
  rangeKey: string;
  source: string | null;
  /**
   * WHETHER THIS VIEWER MAY MAKE ONE — the same permission the `+` is gated on.
   *
   * Without it a rank-restricted member got a yellow button, pressed it, chose a
   * layout, and `addViewAction` refused with a redirect carrying `?error=rank`
   * that this page does not read — landing them back on the same card with
   * nothing said. `ViewTab` already states the rule this breaks: a disabled
   * control advertising something the interface will refuse is worse than one
   * that is not there yet.
   */
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    /* Centred in a generous block rather than absolutely positioned: the builder
       floats this over a canvas that fills the viewport, and the dashboard has no
       canvas — it has a page that would otherwise collapse to the height of the
       card and leave it pinned under the chrome that is no longer there. */
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      {/* The same shell the flow builder's empty canvas uses — see
          `GetStartedCard`. Sharing it is the point: two ways of saying "there is
          nothing here yet" is a product telling you something about itself. */}
      <GetStartedCard eyebrow="New dashboard" title="Start with a view" steps={STEPS} className="w-full max-w-md">
        {/* The one yellow on the screen, which is the whole ratio rule: this is
            the single act the page exists for right now — when there is one. A
            viewer who may not create says so in a sentence instead, rather than
            being offered a button that will refuse. */}
        {canCreate ? (
          <Button onClick={() => setOpen(true)} variant="yellow" size="lg" className="mt-8 w-full">
            <LayoutDashboard />
            Get started
          </Button>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">
            Nobody has set this workspace&rsquo;s dashboard up yet. Someone who can build metrics needs to add the first
            view.
          </p>
        )}
      </GetStartedCard>
      {canCreate && open && <ViewTemplatePicker onClose={() => setOpen(false)} rangeKey={rangeKey} source={source} />}
    </div>
  );
}
