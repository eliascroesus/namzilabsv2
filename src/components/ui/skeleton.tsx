import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The loading shimmer. Size it with width/height utilities at the call site
 * so it holds the shape of what it is standing in for — a skeleton that
 * doesn't match its content just moves the jank later.
 *
 * AN ALPHA OF THE FOREGROUND, AND NOT `--muted` OR THE FIXED 200 THIS USED TO
 * BE.
 *
 * The sheet's page is OFF-WHITE (#f5f5f5), which is `neutral-100` — the exact
 * value `--muted` holds. So a muted shimmer on a page is invisible by
 * construction, and the 200 that replaced it measures 13 levels against that
 * page; `animate-pulse` then spends half its cycle at 50% opacity, which halves
 * even that. A bar nobody can see at the bottom of its own animation is not a
 * shimmer, it is the "did that click do anything?" these exist to answer.
 *
 * 15% of the near-black lands on #d4d4d4 over the page — one level off the
 * value `--canvas-dot` was tuned to, which is the same problem solved for the
 * same surface: visible against off-white, still a texture rather than a block.
 * On a white card it is #dddddd. Those two are the only surfaces a skeleton is
 * ever laid on in the light theme, and stating it as an ALPHA rather than as a
 * ramp step is what keeps it a shimmer in the dark one, where any fixed light
 * grey is a row of floodlights on a near-black page.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-foreground/15", className)} {...props} />;
}
