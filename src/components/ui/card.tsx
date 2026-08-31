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
 * slightly softer card. Here `--card` is #1a1b1e on a #0f1011 page, which is a
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
      tile: "rounded-surface shadow-card transition-colors duration-(--duration-base) ease-(--ease-standard) hover:border-rule",
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
 * THE RULED HEAD — the reference's signature, and the shape this kit did not
 * have.
 *
 * Every card in the reference is two bands: a 16px header closed by a hairline,
 * then the content. That rule is doing something the old card had no way to
 * express — it separates a card's NAME from a card's CONTENT without spending
 * a size step or a weight on it, which is what let the reference set every card
 * title at the same 14px/500 as its body text and still have them read as
 * titles.
 *
 * Before this, a card that wanted a heading spelled one at its call site, and
 * eleven of them did, in about six ways.
 *
 * `padding="none"` ON THE CARD IS THE PAIRING. A `CardHeader` inside a padded
 * Card draws its rule 16px short of the card's own edge, which reads as a
 * mistake rather than as a band. The header and the body bring their own
 * padding; the card brings none.
 */
export function CardHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border p-4", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * A card's name. 14px/500 in the body ink — the SAME size and weight as the
 * text below it, because the rule under it is what makes it a title. Set two
 * steps up it would be a page heading inside a card, which is the thing that
 * makes a board of ten cards read as ten pages.
 */
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("truncate text-sm font-medium text-foreground", className)} {...props} />;
}

/** The line under it: 12px/400, one rung down the ink ramp at 6.78:1. */
export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs font-normal text-muted-foreground", className)} {...props} />;
}

/** The band below the rule. Same 16px, so the two are one object. */
export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

export { cardVariants };
