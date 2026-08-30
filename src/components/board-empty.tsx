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

/**
 * THE THREE PRESSES, NOT THREE CONCEPTS. Each is a thing the reader is about to
 * do, in the order they will do it — which is why none carries a second line:
 * "Select a template" needs no gloss, and one under each would be padding
 * dressed as guidance. The flow builder's steps DO carry details, because those
 * describe a metric rather than a sequence of clicks.
 */
const STEPS = [
  { n: 1, title: "Get started" },
  { n: 2, title: "Select a template" },
  { n: 3, title: "Add your metrics" },
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
    /* THE TITLE TRAVELS WITH THE CARD, in one block, rather than being a page
       heading that happens to sit above it. That is what the comp shows and it
       is the more honest arrangement: on this screen the heading is not the
       PAGE's title — there is no page yet — it is the first line of the one
       thing on it. Keeping them together also means they centre as a unit
       instead of the heading pinning to the top-left while the card floats in
       the middle, which is what it did.
       `max-w-md` matches the card, so the heading's left edge is the card's. */
    <div className="w-full max-w-md">
      {/* The same shell the flow builder's empty canvas uses — see
          `GetStartedCard`. Sharing it is the point: two ways of saying "there is
          nothing here yet" is a product telling you something about itself. */}
      {/* `PageHeader`'s own h1 recipe rather than a second spelling of it — but
          not `PageHeader` itself: that component's right slot is where the
          period track lives, and the period track is exactly the furniture
          there is nothing here to filter. */}
      <h1 className="mb-4 font-display text-display-sm font-semibold text-ground-ink">Build your dashboard</h1>
      <GetStartedCard eyebrow="New dashboard" title="Build a dashboard in three clicks" steps={STEPS}>
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
