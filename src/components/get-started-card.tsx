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
 * spelled once and imported. It is also why the owner could ask for "the blue
 * thing on both the dashboard and the flow canvas" and get one edit.
 *
 * IT IS THE SKY NOW, and only it. The ask was explicit about the blast radius:
 * this card on both surfaces, and nothing else on either. That is also the
 * right place to stop — the sky works on the invite board because it is the ONE
 * loud object on a quiet page, and a dashboard of twelve blue tiles would be a
 * wall with the numbers fighting the ground they sit on. An empty board has
 * exactly one object, so it can be the loud one.
 *
 * `.sky-panel`, NOT `.sky-card`. The invite board's sky opens up to #3F73E6 at
 * its foot, which is right when the type sits in the top half — and this card's
 * type marches to the bottom edge, where white body copy on that blue measures
 * 4.36:1. The panel stays deep the whole way down. See globals.css.
 *
 * THE BRAND CAP IS GONE. It was 6px of `--primary` along the top, which said
 * "this card is the brand's" on a white surface. On a blue one it is a blue
 * stripe on blue: the card IS the colour now, and a cap would be a decoration
 * that used to be a signal.
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

/**
 * THE ACT'S CLASSES, EXPORTED, because the button belongs to the caller and the
 * ground belongs to the shell.
 *
 * Both callers passed `variant="accent"` — a #568CFF fill, which on this blue
 * is a shape you have to hunt for. It is the same call the landing page's CTA
 * and the invite board's make: white is the only fill with guaranteed contrast
 * against every stop of a brand gradient. Spelled here so the two callers
 * cannot drift into two different buttons on the same card.
 */
export const GET_STARTED_CTA = "border-transparent bg-white text-neutral-950 hover:bg-brand-50";

/** Prose a caller puts on this card — a refusal, a note — in the card's ink. */
export const GET_STARTED_NOTE = "text-white/80";

export function GetStartedCard({
  eyebrow,
  title,
  steps,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  /**
   * `detail` IS OPTIONAL, because the two callers describe different things.
   * The builder's steps each need a clarifying line — "from an app you've
   * connected" — while the dashboard's are the three presses themselves and a
   * second line under each would be padding. A step with no detail sets as one
   * line rather than one line and an empty box.
   */
  steps: ReadonlyArray<{ n: number; title: string; detail?: string }>;
  /** Sizing and placement — the caller's, not the shell's. */
  className?: string;
  /**
   * The act. One per card, and that is a rule about the CARD rather than about
   * the colour: this shell exists to say "there is nothing here yet, do this",
   * and a surface offering two next steps has chosen neither.
   */
  children: ReactNode;
}) {
  return (
    /* `overflow-hidden` is what clips the sky's ruled overlay to the radius —
       the gradient would paint to the corners on its own, the grid would not. */
    <div className={cn("sky-panel overflow-hidden rounded-frame sm:rounded-3xl", className)}>
      <div className="p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/80">{eyebrow}</p>
        {/* 24px. It is the only heading on the screen, and it was once set at
            the size a field label uses two panels away. */}
        <h2 className="mt-2 text-display-xs font-semibold tracking-tight text-white">{title}</h2>
        <ol className="mt-7 space-y-4">
          {steps.map((s) => (
            /* `items-center` when there is no detail, so a single line sits on
               the numeral's middle instead of hanging off its top. */
            <li key={s.n} className={cn("flex gap-3", s.detail ? "items-start" : "items-center")}>
              {/* A WHITE DISC WITH DARK INK — the same object the invite
                  board's earned pips are, and for the same reason: on a blue
                  ground the only numeral that reads at 28px is a filled white
                  one. It was a brand-filled disc, which is now the card. */}
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold tabular-nums text-neutral-950",
                  s.detail && "mt-0.5",
                )}
              >
                {s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-md font-semibold text-white">{s.title}</span>
                {s.detail && <span className="block text-sm leading-snug text-white/75">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        {children}
      </div>
    </div>
  );
}
