"use client";

import Link from "next/link";
import { ChevronDown, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2 rounded-control px-1 py-1 transition-opacity hover:opacity-80"
        title="Namzilabs — dashboard"
      >
        <span className="flex size-6 items-center justify-center rounded-control bg-primary text-micro font-semibold text-primary-foreground">
          N
        </span>
        <span className="text-base font-semibold tracking-tight text-foreground">Namzilabs</span>
      </Link>

      {/* The workspace, beside the mark rather than under an avatar. It reads
          as "Namzilabs / this workspace", which is what it is. */}
      {account && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 gap-1 font-medium text-muted-foreground">
              <span className="truncate">{workspace}</span>
              <ChevronDown className="size-3.5 shrink-0" />
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
        "flex h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
