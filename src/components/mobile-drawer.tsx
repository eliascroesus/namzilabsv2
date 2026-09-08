"use client";

import { Menu } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { RailContent } from "@/components/sidebar";
import type { BoardView } from "@/lib/board/types";

/**
 * THE PHONE'S NAVIGATION — the rail's own tree, in a drawer.
 *
 * THE RAIL CANNOT SURVIVE A PHONE — for a NEW reason since 8 Sep 2026, landing
 * in the same place. It used to be 56px of unlabelled glyphs whose every name
 * was `hover:` or `focus-within:`, so on a touch screen it was a column you
 * could not read and could not open. It is now always open and always 260px,
 * which on a 390px screen is two thirds of the viewport. Below `md` it is not
 * rendered either way (see `Sidebar`) and this stands in: the bar grows a menu
 * button, and pressing it slides the same rows in from the left.
 *
 * THE SAME COMPONENT TREE, NOT A COPY. `RailContent` is one export rendered
 * in two frames. A hand-built drawer is the obvious alternative and it is
 * wrong in a way that only shows up months later — two nav lists, two search
 * rows, two active-row rules, and a change to one of them landing on half the
 * product.
 *
 * THERE IS NOTHING LEFT TO OPEN. This wrapper carried `data-pinned="true"` on
 * a `group/rail`, because every label in that tree rode `REVEAL` — which faded
 * on hover, on focus-within, or on a pinned rail. There is no hover on a touch
 * screen, so the drawer claimed the third state: a drawer IS a rail held open,
 * which is what the attribute already meant. The rail has one width now and
 * reveals nothing, so the attribute selects a state that does not exist and
 * the group has no variant reading it. Both are gone; what remains is an
 * ordinary scroll container.
 *
 * IT CLOSES ON NAVIGATION, INCLUDING A CHANGE OF VIEW. `usePathname` alone
 * would leave it standing over the board it just switched, because the
 * dashboard's views are `?view=` on one path. `sidebar.tsx` already calls
 * `useSearchParams()` in this same tree, so reading it here costs nothing
 * that was not already being paid.
 */
export function MobileDrawer({
  hide,
  views = [],
  workspace,
  account,
}: {
  hide?: string[];
  views?: BoardView[];
  workspace?: string;
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    setOpen(false);
  }, [pathname, search]);
  /**
   * CLOSES ITSELF AT THE BREAKPOINT, RATHER THAN JUST HIDING THE PANEL.
   *
   * `md:hidden` on `SheetContent` used to be the only guard here, and it
   * guarded the wrong thing: it hides the PANEL, but Radix's own dialog
   * machinery — the overlay, the scroll lock, the focus trap — all read
   * `open`, not a media query. A phone rotated to landscape (or a window
   * dragged wider) past 768px with the drawer open left that machinery fully
   * attached to a panel CSS had made invisible: body scroll still locked,
   * focus still trapped, nothing on screen to say why or how to get out.
   *
   * A `matchMedia` listener that actually calls `setOpen(false)` tears the
   * whole dialog down instead of painting over it — which is what lets
   * `SheetContent` below drop `md:hidden` entirely: once this fires, Radix
   * does not render the content at all, so there is nothing left for a class
   * to hide.
   */
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const closeAboveMd = () => {
      if (query.matches) setOpen(false);
    };
    closeAboveMd();
    query.addEventListener("change", closeAboveMd);
    return () => query.removeEventListener("change", closeAboveMd);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* 32px on the avatar circle, which is what the bell and the account
            chip beside it wear — three round objects at one size, so the bar
            reads as one row rather than as a button and two blobs. It is the
            only control on this bar that is not there above `md`. */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open the navigation"
          className="shrink-0 rounded-full border border-input bg-avatar text-foreground hover:bg-accent active:bg-accent md:hidden"
        >
          <Menu />
        </Button>
      </SheetTrigger>
      {/* NO `md:hidden` HERE ANY MORE — see the breakpoint effect above. The
          panel used to hide itself in CSS while staying "open" as far as
          Radix was concerned; now it actually CLOSES at the breakpoint, so
          there is nothing left here for a class to hide.

          280px, `--chrome`, `--border` — the export's own drawer. `p-0` and
          `gap-0` because the sheet's padded, gapped default is for a form and
          this is a navigation column that brings its own gutter. The close X
          is off: at `top-4 right-4` it lands exactly on the workspace
          switcher's chevron, and the drawer already closes on the overlay, on
          Escape, and on any navigation. */}
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[280px] gap-0 border-border bg-chrome p-0"
      >
        {/* Radix names the dialog from this; the drawer's own head is the
            workspace switcher, which is a name for the WORKSPACE rather than
            for the panel. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
          <RailContent hide={hide} views={views} workspace={workspace} account={account} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
