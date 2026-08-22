import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The loading shimmer. Size it with width/height utilities at the call site
 * so it holds the shape of what it is standing in for — a skeleton that
 * doesn't match its content just moves the jank later.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-muted", className)} {...props} />;
}
