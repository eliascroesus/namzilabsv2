import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The loading shimmer. Size it with width/height utilities at the call site
 * so it holds the shape of what it is standing in for — a skeleton that
 * doesn't match its content just moves the jank later.
 *
 * `neutral-200`, NOT `--muted`. Muted is neutral-100, and the app's pages now
 * sit on the warm canvas (`#f1efec`) — three levels away from it. A shimmer
 * that measures three levels against its own background is not a shimmer, it
 * is a blank page with a faint rectangle nobody can see, which is exactly the
 * "did that click do anything" the skeletons exist to answer. 200 reads on the
 * canvas AND on a white card, which are the only two surfaces it ever lies on.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-neutral-200", className)} {...props} />;
}
