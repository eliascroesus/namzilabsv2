import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * "THERE IS NOTHING HERE YET" — one card, said one way.
 *
 * The flow builder's empty canvas and the dashboard's empty board are the same
 * moment in two places: a surface with nothing on it, three lines explaining
 * what would go there, and a single act. They were also, briefly, the same
 * markup written twice — the second copy carrying a comment saying it was
 * "deliberately the same shell", which is the exact form a drift takes before it
 * happens. Nothing keeps a copy the same.
 *
 * This is the shell those two share, and it is the same discipline as
 * `BOARD_GRID`, `COLUMN_W` and `viewStrip`: the thing that must not differ is
 * spelled once and imported.
 *
 * NO `"use client"` DIRECTIVE, and that absence is load-bearing — see the header
 * of `lib/board/types.ts` for the full argument. `EmptyCanvas` is a client
 * component and `/design` renders this through a server one; a client module's
 * exports become throwing stubs on the server. Plain props and `children` keep
 * it usable from both.
 *
 * PLACEMENT IS THE CALLER'S, and it is the one honest difference between the
 * two. The builder floats this over a `pointer-events-none` canvas, so its card
 * needs `pointer-events-auto`; the dashboard puts it in ordinary flow. Passing
 * that in as `className` keeps the seam visible instead of teaching the shell
 * about canvases.
 */
export function GetStartedCard({
  eyebrow,
  title,
  steps,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  steps: ReadonlyArray<{ n: number; title: string; detail: string }>;
  /** Sizing and placement — the caller's, not the shell's. */
  className?: string;
  /** The act. One per card: see the yellow's ratio rule. */
  children: ReactNode;
}) {
  return (
    /*
      The cap reads as the card's own top edge because the shell CLIPS it —
      `overflow-hidden` is what gives it the corner radius, not a second radius
      of its own.

      `shadow-surface`, not `shadow-panel`: that heavier rung is sized for a
      modal over a dimmed backdrop, and this is a surface sitting on a page.
      One height for everything that floats.
    */
    <div className={cn("overflow-hidden rounded-surface border border-border bg-card shadow-surface", className)}>
      <div aria-hidden className="h-1.5 bg-primary" />
      <div className="p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        {/* 24px. It is the only heading on the screen, and it was once set at
            the size a field label uses two panels away. */}
        <h2 className="mt-1 text-display-xs font-semibold tracking-tight text-foreground">{title}</h2>
        <ol className="mt-6 space-y-4">
          {steps.map((s) => (
            <li key={s.n} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground">
                {s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-md font-semibold text-foreground">{s.title}</span>
                <span className="block text-sm leading-snug text-muted-foreground">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {children}
      </div>
    </div>
  );
}
