import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * NOTHING HERE YET, SAID WELL. An empty screen is the product's first
 * impression of every feature; the app had four different dashed boxes and
 * one section that simply vanished when it had nothing to say.
 */
export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        // A REAL SURFACE, dashed. It used to be a transparent dashed box, which
        // works on a white page and reads as an unpainted hole on the warm one
        // — the app's pages are a canvas now and everything with content in it
        // is an island. The border stays dashed: that is what says "this is
        // where something will BE", rather than "this is a thing".
        "flex flex-col items-center rounded-surface border border-dashed border-border bg-card p-8 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-control bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-lead font-semibold text-foreground">{title}</p>
      {description && <div className="mt-1 max-w-sm text-base text-muted-foreground">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
