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
 * A HOVER RAIL CANNOT SURVIVE A TOUCH SCREEN. Its 56px state is unlabelled
 * glyphs and everything that names them is `hover:` or `focus-within:`, so on
 * a phone it is a column you cannot read and cannot open. Below `md` the rail
 * is not rendered (see `Sidebar`) and this stands in: the bar grows a menu
 * button, and pressing it slides the same rows in from the left.
 *
 * THE SAME COMPONENT TREE, NOT A COPY. `RailContent` is one export rendered
 * in two frames. A hand-built drawer is the obvious alternative and it is
 * wrong in a way that only shows up months later — two nav lists, two search
 * rows, two active-row rules, and a change to one of them landing on half the
 * product.
 *
 * `data-pinned="true"` ON A `group/rail` IS WHAT OPENS IT. Every label in
 * that tree rides `REVEAL`, which fades on hover, focus-within, or a pinned
 * rail. There is no hover here, so the wrapper claims the third: a drawer IS
 * a rail held open, which is what the attribute already means.
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
          className="shrink-0 rounded-full bg-avatar text-foreground hover:bg-accent active:bg-accent md:hidden"
        >
          <Menu />
        </Button>
      </SheetTrigger>
      {/* `md:hidden` HERE TOO, and it is not belt-and-braces: a drawer left
          open while the window widens past 768px would otherwise sit over the
          page beside the rail it stands in for.

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
        className="w-[280px] gap-0 border-border bg-chrome p-0 md:hidden"
      >
        {/* Radix names the dialog from this; the drawer's own head is the
            workspace switcher, which is a name for the WORKSPACE rather than
            for the panel. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="group/rail flex h-full min-h-0 flex-col overflow-y-auto" data-pinned="true">
          <RailContent hide={hide} views={views} workspace={workspace} account={account} invite />
        </div>
      </SheetContent>
    </Sheet>
  );
}
