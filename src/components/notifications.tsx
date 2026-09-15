"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Clock, Plug, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { NOTICE_LIMIT, type Notice } from "@/lib/notices";
import { cn } from "@/lib/utils";

/**
 * THE BELL, AND THE COLUMN BEHIND IT.
 *
 * WHAT WAS HERE BEFORE: a `<Button>` with a `<Bell>` in it, no handler, and a
 * badge driven by `unread = 1` — a DEFAULT that nobody ever passed. Every
 * workspace in the product carried a permanent blue "1" over a control that did
 * nothing when pressed. That is worse than no bell: a badge which is always on
 * trains the one habit a notification exists to break.
 *
 * SO THE BADGE IS A COUNT OF REAL THINGS and the button opens a real panel.
 * What the panel holds is narrow on purpose — broken connections and failed
 * metrics, the two states in this product that cost somebody a number they
 * expected to have. It is not a feed. There is nothing to mark as read, no
 * announcements, and no "your import finished": see `lib/notices.ts` for what
 * is deliberately excluded and why.
 *
 * IT IS THE LEFT RAIL'S COLUMN, ON THE RIGHT, which is what was asked for and
 * is also the right call: this is a second navigation column — every row in it
 * is a destination — so it takes the rail's own vocabulary. The rail's tokens
 * (`--rail`, `--rail-border`, `--rail-foreground`, `--rail-muted`,
 * `--rail-control`) are theme-aware and already solved against each other, so
 * borrowing them is one class list rather than a second palette to keep in
 * step. `SheetContent`'s default `bg-card` is overridden for exactly that
 * reason.
 *
 * A CLIENT COMPONENT HOLDING NO DATA. The notices are read on the server, in
 * the shell, and handed down as props — this owns the open/closed state and
 * nothing else. A panel that fetched its own list would be a second reader of
 * facts the shell has already read on the way past.
 */

/** The row's mark: what kind of thing broke, and how badly. */
function NoticeIcon({ notice }: { notice: Notice }) {
  const Glyph = notice.severity === "warn" ? Clock : notice.kind === "connection" ? Plug : Workflow;
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-control [&_svg]:size-4",
        // The trios, not a hue picked here: `danger` for broken now, `warn` for
        // degraded-and-retrying. Same pair the tiles use for the same two facts.
        notice.severity === "error" ? "bg-danger-soft text-danger-ink" : "bg-warn-soft text-warn-ink",
      )}
    >
      <Glyph />
    </span>
  );
}

function NoticeRow({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  return (
    <li>
      <Link
        href={notice.href}
        onClick={onNavigate}
        /* THE EDGE RAISES, NOT THE FILL — the rail's one rule, restated here
           because this column borrows the rail's tokens and would otherwise
           grow a second hover language beside it. */
        className="flex items-start gap-3 rounded-card border border-rail-border bg-rail-control p-3 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-rail-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marker"
      >
        <NoticeIcon notice={notice} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold leading-5 text-rail-foreground">{notice.title}</span>
          {/* Three lines at most. A provider's error text is already trimmed to
              140 characters in `notices.ts`; this is the second bound, for the
              one that is 139 characters of no line breaks. */}
          <span className="line-clamp-3 text-xs leading-4 text-rail-muted">{notice.detail}</span>
        </span>
      </Link>
    </li>
  );
}

export function NotificationBell({ notices }: { notices: Notice[] }) {
  const [open, setOpen] = useState(false);
  const count = notices.length;
  const shown = notices.slice(0, NOTICE_LIMIT);
  const hidden = count - shown.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* NOT `SheetTrigger asChild`. The bar's bell is a `Button` with its own
          bar-specific classes, and wrapping it in a trigger that clones props
          onto it worked but put two components in charge of one element's
          `aria-expanded`. One `onClick` is the smaller thing. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Notifications — ${count} needing attention` : "Notifications — nothing needs attention"}
        className="relative size-8 shrink-0 rounded-control text-topbar-foreground hover:bg-topbar-control active:bg-topbar-control [&_svg]:size-4"
      >
        <Bell />
        {count > 0 && (
          /* THE BADGE IS `danger`, NOT THE BRAND. It counts things that are
             BROKEN, and the brand fill is what this product uses for the thing
             you should press next — a blue dot over a bell reads as "new", which
             is the one thing none of these are. */
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-topbar bg-destructive text-2xs font-semibold leading-none text-destructive-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>

      <SheetContent
        side="right"
        className="gap-0 border-rail-border bg-rail p-0 sm:max-w-sm"
        aria-describedby={undefined}
      >
        {/* `pr-14`, NOT `p-4`. `SheetContent` puts its close button at
            `top-4 right-4` at `size-8`, so 48px of this header's own right
            edge is already spoken for — the description wrapped to within a
            few pixels of the X and read as though it were colliding with it.
            56px clears the button and leaves a gutter beside it. */}
        <SheetHeader className="gap-1 border-b border-rail-border p-4 pr-14">
          <SheetTitle className="text-md font-semibold text-rail-foreground">Needs attention</SheetTitle>
          <SheetDescription className="text-xs leading-4 text-rail-muted">
            {count > 0
              ? "Connections and metrics that are not working right now."
              : "Connections and metrics report themselves here when they stop working."}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {count === 0 ? (
            /* THE EMPTY STATE IS THE POINT OF THE FEATURE, not an afterthought:
               most of the time this panel is empty, and "nothing is broken" is
               a thing somebody opened it hoping to be told. */
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <CheckCircle2 aria-hidden className="size-6 text-success" />
              <p className="text-sm font-semibold text-rail-foreground">Everything is running</p>
              <p className="text-xs leading-4 text-rail-muted">
                No connection is erroring and no published metric has failed to recompute.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((n) => (
                <NoticeRow key={n.id} notice={n} onNavigate={() => setOpen(false)} />
              ))}
            </ul>
          )}

          {hidden > 0 && (
            /* An honest tail rather than a silent truncation. `listNotices`
               reads one row over the limit for exactly this sentence. */
            <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-rail-muted">
              <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
              and more beyond the first {NOTICE_LIMIT}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
