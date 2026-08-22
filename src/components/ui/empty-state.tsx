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
        "flex flex-col items-center rounded-card border border-dashed border-border p-8 text-center",
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
