"use client";

import Link from "next/link";
import { ChevronDown, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GROUP_ACCENT, GROUP_COLOR_KEYS } from "@/components/flow/node-accent";
import { cn } from "@/lib/utils";

/**
 * A WORKSPACE'S OWN COLOUR, derived rather than stored.
 *
 * Miro's header is a grey utility bar with exactly one colourful thing in it —
 * the workspace avatar — and that single chip is most of why it does not read
 * as chrome. Ours had no equivalent, so the whole bar was greyscale.
 *
 * The hue comes from the name, through the palette the boards already use, so
 * two workspaces are reliably different colours and the same workspace is the
 * same colour on every device without a column to store it in.
 */
function workspaceAccent(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  // `grey` is the palette's "no colour" entry — skip it, or a third of
  // workspaces get a chip that looks like a disabled control.
  const keys = GROUP_COLOR_KEYS.filter((k) => k !== "grey");
  return GROUP_ACCENT[keys[h % keys.length]];
}

/**
 * THE TOP BAR — identity and the two things you start from.
 *
 * Miro's shape, and the reason it is the right one here: the workspace you are
 * in and the actions that CREATE things are the same class of decision, and
 * they were split across three places. The workspace switcher was at the foot
 * of a 124px rail behind an avatar; "New flow" was a page action on exactly one
 * of nineteen routes; inviting somebody was four clicks into Settings and
 * discoverable only if you already knew it was there.
 *
 * They live together now, above everything, on every route — so the answer to
 * "which workspace am I in" and "how do I add something" never depends on which
 * page you happen to be standing on.
 *
 * A 52px bar, not 64: this sits ABOVE a second bar on the board, and two tall
 * bars stacked eat a fifth of a laptop viewport before any content is drawn.
 */
export function TopBar({
  workspace,
  account,
}: {
  workspace: string;
  account?: { initials: string; panel: ReactNode };
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2 rounded-control px-1 py-1 transition-opacity hover:opacity-80"
        title="Namzilabs — dashboard"
      >
        <span className="flex size-7 items-center justify-center rounded-control bg-primary text-xs font-semibold text-primary-foreground">
          N
        </span>
        <span className="text-md font-semibold tracking-tight text-foreground">Namzilabs</span>
      </Link>

      {/* The workspace, beside the mark rather than under an avatar. It reads
          as "Namzilabs / this workspace", which is what it is. */}
      {account && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-1 min-w-0 gap-1.5 rounded-full border border-border bg-muted/60 pl-1 pr-2 font-medium text-foreground hover:bg-muted"
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-semibold text-white"
                style={{ background: workspaceAccent(workspace) }}
                aria-hidden
              >
                {workspace.slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate">{workspace}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {account.panel}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <span className="flex-1" />

      <Link
        href="/dashboard/settings"
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        title="Invite someone to this workspace"
      >
        <UserPlus />
        <span className="hidden sm:inline">Invite members</span>
      </Link>
      <Link href="/dashboard/flows" className={cn(buttonVariants({ size: "sm" }))}>
        <Plus />
        <span className="hidden sm:inline">New flow</span>
      </Link>
    </header>
  );
}

/**
 * THE SECOND BAR — what the page below is currently showing.
 *
 * Split from the first on purpose. The top bar answers "where am I and what can
 * I make", which is true on every route; this one answers "which period, whose
 * data", which is true only where there is data to filter. Putting them in one
 * row made a board's range pills look like application chrome, and made the
 * workspace switcher look like a filter.
 *
 * It replaces the floating card the filters used to sit in. A bar that spans
 * the page and is separated by a hairline reads as part of the frame; the same
 * controls inside a rounded, shadowed island read as content — a widget on the
 * board rather than the thing governing it.
 */
export function SubBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        /**
         * ONE ROW, ALWAYS. This wrapped, and the second line landed on top of
         * the view tabs below it — the bar is pulled flush by negative margins,
         * so anything that wraps escapes its own height and overlaps whatever
         * the page drew next. A horizontal scroller cannot do that.
         */
        "flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
