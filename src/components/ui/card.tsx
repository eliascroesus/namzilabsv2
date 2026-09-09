import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * THE SURFACE. Every boxed thing that is not a button comes from here.
 *
 * THE BORDER IS NO LONGER TRIM, AND THAT IS THE ONE THING TO UNDERSTAND ABOUT
 * THIS FILE.
 *
 * On the old #f5f5f5 ground a card was a WHITE box: the fill did the work and
 * the hairline only tidied its edge, so a card that lost its border was a
 * slightly softer card. Here `--card` is #272426 on a #1b191a page, which is a
 * step of 1.11:1 — a difference that exists in the numbers and not in the eye.
 * A card without its border is not a flatter card, it is an invisible one.
 *
 * So `border border-border` is in the BASE rather than in the variants, and no
 * variant may drop it. The shadow is nearly irrelevant on this surface (black
 * at 10% over near-black moves about one count — see the elevation ladder in
 * globals.css); it keeps the corner from looking cut out and does nothing else.
 *
 * THE THREE VARIANTS COLLAPSED TO ONE RADIUS. `card` was 10px, `surface` and
 * `tile` were 16 — a panel, a card and a tile were three different objects on
 * one screen and nothing said which was which. The reference draws exactly one
 * radius on everything that contains something, so `--radius-surface` is now
 * `--radius-lg` and all three land on 10. The names survive because the
 * SHADOWS still differ and because 18 files import them; what has gone is the
 * shape difference nobody could have explained.
 */
const cardVariants = cva("border border-border bg-card", {
  variants: {
    variant: {
      card: "rounded-card shadow-card",
      surface: "rounded-surface shadow-card",
      /**
       * THE METRIC TILE — the one surface the product is actually FOR.
       *
       * Still explicitly NOT settled by this pass, and deliberately not derived
       * from the reference: the reference is an observability console with no
       * numbers on it at all, so there is nothing there to copy for the one
       * screen this product exists to draw. What it inherits is the surface and
       * the hairline; how a comparison series is drawn, whether a tile carries
       * its own controls, and how a mark fills a tall tile are all still open.
       *
       * The pointer response is here; the `lift` translate is NOT. The groups
       * board's tiles are read, so they rise a pixel under the cursor; the
       * canvas board's are DRAGGED, and a hover translate under a gesture that
       * also moves the box is one motion too many (it also shifts the bounding
       * boxes `scripts/canvas-check.mjs` measures overlap with).
       */
      /* NO SHADOW. Both 8 September frames draw a tile as a fill and a 1px
         rim and nothing else — node 58:6173 is `bg-white border border-[#e1e1e1]
         rounded-[8px]`, full stop. Two of the DARK frame's three chart cards do
         carry a `0 1px 2px` drop and the third does not, and the light frame has
         none at all: an inconsistency in the source rather than a design.
         Asked for directly ("remove all the backdrop shadow on all the charts"),
         and the light frame settles it. The border does the separating; on a
         #191919 card at 1.06:1 on the page it is the only thing that can. */
      tile: "rounded-surface transition-colors duration-(--duration-base) ease-(--ease-standard) hover:border-rule",
    },
    /**
     * 16px IS THE DEFAULT NOW, DOWN FROM 24.
     *
     * `p-6` was cut for a light app whose cards were islands with air around
     * them. The reference pads every card at 16 — header and body alike — and
     * the number matters more than it looks: a page gutter of 24, a grid gap of
     * 24 and a card pad of 16 is a rhythm; 24/24/24 is a page with no interior
     * at all, where the space inside a card and the space between two cards are
     * the same measurement and the cards stop reading as separate objects.
     */
    padding: {
      none: "",
      dense: "p-3",
      compact: "p-4",
      default: "p-4",
    },
  },
  defaultVariants: { variant: "card", padding: "default" },
});

export type CardProps = React.ComponentProps<"div"> & VariantProps<typeof cardVariants>;

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...props} />;
}

/**
 * THE CARD'S HEAD — AND THE RULE UNDER IT IS GONE.
 *
 * This block used to open "THE RULED HEAD — the reference's signature", and
 * described every card as two bands: a 16px header closed by a hairline, then
 * the content. That was read off an earlier reference and it is not what the
 * 6 Sep 2026 export draws. `node-id=14:4` sets the header's frame to
 * `border-0` on all four sides, and the rendered PNG confirms it — "Pickup
 * Rate" sits directly above "28.2%" on one uninterrupted surface, with no
 * seam anywhere between the card's top edge and its chart.
 *
 * The rule was carrying a real argument — it let a card's NAME separate from
 * its CONTENT without spending a size step or a weight — and the export
 * answers that argument a different way: the name is MUTED (`#7e7e7e`) and
 * the figure under it is full-ink white at 28px. Ink and scale do the
 * separating, so the hairline is redundant, and a redundant hairline on a
 * board of twelve tiles is twelve lines of furniture in a product whose whole
 * thesis is quiet chrome.
 *
 * So this is `px-4 pt-4` with no bottom padding: the header opens the 16px
 * box and the body below it closes it, which is the same split `MetricCard`
 * spells inline. `padding="none"` on the Card is still the pairing — the
 * header and the body bring their own padding, the card brings none.
 */
export function CardHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-4 pt-4", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * A card's name — 15px REGULAR, MUTED, which is the same recipe `MetricCard`
 * sets on its own h3 and the same one the export draws (`#7e7e7e`, 15px/22,
 * SF Pro Regular).
 *
 * It was `font-medium text-foreground` on the argument that the rule under it
 * was what made it a title. The rule is gone (see `CardHeader`), and the
 * export's answer is that the name does not need to be a title: it LABELS the
 * figure below it, and the figure is the loud thing. Full-ink medium was also
 * the exact disagreement that had a chart card and a metric card — two tiles
 * side by side in one grid — drawing their names two different ways.
 *
 * Set two steps up it would be a page heading inside a card, which is what
 * makes a board of ten cards read as ten pages.
 */
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("truncate text-sm font-normal text-muted-foreground", className)} {...props} />;
}

/** The line under it: 12px/400, one rung down the ink ramp at 6.78:1. */
export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs font-normal text-muted-foreground", className)} {...props} />;
}

export { cardVariants };
