import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * THE BUTTON. Every clickable thing in the product comes from here.
 *
 * Before this there were roughly a dozen hand-written button class strings —
 * `.btn-brand`, three variations of a bordered secondary, two greys, a red,
 * and an icon button re-declared in five files. They drifted (different radii,
 * different disabled treatments, three different focus behaviours) because
 * nothing forced them together, and drifted class strings are most of what
 * "looks unfinished" actually is.
 *
 * `cva` makes the variants data rather than prose, so a new one is a line in a
 * table instead of a new string somewhere. Deliberately NOT a client
 * component: it holds no state and calls no hooks, so it renders inside server
 * components too — which is where half the app's buttons live (forms posting
 * to server actions).
 */
const buttonVariants = cva(
  // Shared: the focus ring is on `focus-visible` only, so keyboard users get
  // it and mouse users never see a ring they did not ask for.
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-semibold transition-all outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-110 active:brightness-95",
        secondary: "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:brightness-110",
        // A destructive action that is not the point of the screen: quiet
        // until hovered, then unmistakable.
        destructiveGhost: "text-neutral-400 hover:bg-red-50 hover:text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-2.5 text-small [&_svg]:size-3.5",
        default: "h-9 px-4 text-base [&_svg]:size-4",
        lg: "h-10 px-5 text-lead [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
        iconSm: "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
