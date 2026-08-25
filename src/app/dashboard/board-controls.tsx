"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { BOARD_GRID } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { COLUMN_W, LANE_GAP } from "./board-shape";

/**
 * THE BOARD'S FILTERS, ANSWERING IMMEDIATELY.
 *
 * The range and the source live in the URL, which is right — a board someone
 * shares should open on what they were looking at. But they were plain links,
 * and a link to a `force-dynamic` page that recomputes classic metrics is one
 * to two seconds of NOTHING: the pill you pressed stayed grey, the old numbers
 * sat there looking current, and the only feedback was the browser's own
 * loading bar. Pressed twice, which is how a slow interface teaches people to
 * distrust it.
 *
 * Nothing here makes the server faster. What it changes is who waits for it:
 *
 *   - the pill you pressed goes active on the press, before anything is sent;
 *   - the tiles become skeletons at the same instant, so the numbers underneath
 *     stop claiming to answer a question nobody asked any more;
 *   - the URL still updates, so the back button and a shared link both work.
 *
 * `useTransition` is what makes that safe rather than a lie: React keeps the
 * old screen mounted while the next one is fetched, so the optimistic pill is
 * only ever shown for exactly as long as `isPending`. The moment the server's
 * answer lands, the server's own `activeRange` takes over — there is no local
 * copy of the truth to drift.
 */
type BoardCtx = { pending: boolean; go: (href: string, rangeKey?: string) => void; picked: string | null };

const Ctx = createContext<BoardCtx | null>(null);

function useBoard(): BoardCtx {
  const ctx = useContext(Ctx);
  // A hard error rather than a silent no-op: the pills and the tile area only
  // work as a pair, and a stray one outside the provider would render as an
  // ordinary link that never shows a pending state — a regression nobody sees.
  if (!ctx) throw new Error("Board controls must be rendered inside <BoardControls>.");
  return ctx;
}

export function BoardControls({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);

  const go = (href: string, rangeKey?: string) => {
    if (rangeKey) setPicked(rangeKey);
    startTransition(() => {
      // `scroll: false`: this is a filter, not a navigation. Jumping to the top
      // of the page after changing the range loses the reader's place on a
      // board they were half-way down.
      router.push(href, { scroll: false });
    });
  };

  return <Ctx.Provider value={{ pending, go, picked }}>{children}</Ctx.Provider>;
}

/**
 * One range pill. It is still an `<a>` with a real `href` — middle-click,
 * copy-link and "open in new tab" all keep working, and a viewer with no
 * JavaScript gets the plain navigation this replaces.
 */
export function RangeLink({
  href,
  rangeKey,
  activeRange,
  className,
  activeClassName,
  idleClassName,
  children,
}: {
  href: string;
  rangeKey: string;
  /** The range the SERVER rendered — the truth, once the transition settles. */
  activeRange: string;
  className: string;
  activeClassName: string;
  idleClassName: string;
  children: ReactNode;
}) {
  const { pending, go, picked } = useBoard();
  // The optimistic answer is only trusted WHILE the transition is in flight.
  // Once it settles, the server's value is the only one on screen — so a failed
  // or redirected navigation cannot leave a pill lit for a range nobody is
  // looking at.
  const active = (pending && picked ? picked : activeRange) === rangeKey;
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      onClick={(e) => {
        // Let the browser handle every click that means "somewhere else":
        // new tab, new window, download, or a non-primary button.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        go(href, rangeKey);
      }}
      className={cn(className, active ? activeClassName : idleClassName)}
    >
      {children}
    </a>
  );
}

/**
 * A link inside the source menu. Same transition, and it closes the `<details>`
 * it was chosen from — the menu is a disclosure, and one left hanging open over
 * a board that is already reloading reads as a click that missed.
 */
export function SourceLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { go } = useBoard();
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        go(href);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * The tiles, or their shape while the next set is on its way.
 *
 * SKELETONS RATHER THAN A DIMMED COPY. Fading the old numbers keeps them
 * legible, and a legible number under a pill that now says "Today" is a WRONG
 * number being shown confidently — the one failure this whole file exists to
 * prevent. Cards of the same size, in the same grid, say "this is being
 * answered" without answering it.
 *
 * `count` is how many tiles the board is currently showing, so the page does
 * not change height while it waits and the scroll position stays put.
 *
 * `columns` is how many the board is ARRANGED into. A dashboard with groups is
 * a set of columns, not a three-up grid, so a grid of skeletons over it would
 * reshape the page for half a second and reshape it back — which is the jump
 * the count is there to prevent, arriving by the other door. Absent (or zero)
 * means no groups, and the grid is right.
 */
export function TileArea({ count, columns, children }: { count: number; columns?: number; children: ReactNode }) {
  const { pending } = useBoard();
  if (!pending) return <>{children}</>;
  if (columns && columns > 0) {
    return (
      <div className={`mt-4 flex items-start ${LANE_GAP} overflow-hidden`} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading metrics…</span>
        {Array.from({ length: columns }, (_, c) => (
          <div key={c} className={`${COLUMN_W} shrink-0`}>
            {/* The header the real column wears: a dot, a name, a count. */}
            <div className="mb-3 flex h-8 items-center gap-2 px-0.5">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className={`flex flex-col ${LANE_GAP}`}>
              {Array.from({ length: Math.max(1, Math.round(count / columns)) }, (_, i) => (
                <TileSkeleton key={i} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`mt-4 items-start ${BOARD_GRID}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading metrics…</span>
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        // The tile's own anatomy: a title line, the numeral, a mark, a footer.
        // A plain grey block is a placeholder for "something"; this is a
        // placeholder for a tile, so nothing moves when the real one lands.
        <TileSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * The tile's own anatomy: a title line, the numeral, a mark, a footer.
 *
 * A plain grey block is a placeholder for "something"; this is a placeholder
 * for a TILE, so nothing moves when the real one lands. One spelling, used by
 * both shapes above, or the grid and the board would drift apart in the one
 * state nobody looks at twice.
 */
function TileSkeleton() {
  return (
    <div className="rounded-surface border border-border bg-card p-5 shadow-card">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="mt-3 h-9 w-1/2" />
      <Skeleton className="mt-3 h-10 w-full" />
      <Skeleton className="mt-3 h-3 w-1/3" />
    </div>
  );
}

/**
 * The board's quiet caption — hidden while the numbers behind it are moving.
 *
 * It states how many metrics are on the board and when the newest was true;
 * both are answers to the range being replaced, so it fades out with the tiles
 * rather than sitting there being subtly wrong. `opacity-0` and not `hidden`:
 * the line keeps its height, so nothing below it moves for the half-second.
 *
 * It renders the `<p>` ITSELF rather than wrapping one — the caption is a flex
 * row of spans, and an extra element between the row and its children would
 * collapse that layout into one item.
 */
export function MetaLine({ className, children }: { className?: string; children: ReactNode }) {
  const { pending } = useBoard();
  return <p className={cn(className, "transition-opacity", pending && "opacity-0")}>{children}</p>;
}
