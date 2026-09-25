import type * as React from "react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { PlanDescription } from "@/lib/billing/describe";
import { cn } from "@/lib/utils";

/**
 * THE TOP OF PLAN & BILLING — where the workspace stands, in one sentence, and
 * what it is using against what its plan includes. Drawn from props so the
 * design fixture renders it with no database.
 */

const TONE = { neutral: "pending", positive: "success", warning: "warn", danger: "danger" } as const;

/** `overNote` says what happens to what is past the limit — paused, locked or shut out, never deleted. */
export type Usage = { label: string; used: number; limit: number; unlimited?: boolean; overNote?: string };

export function PlanStatus({
  description,
  usage,
  actions,
  className,
}: {
  description: PlanDescription;
  usage: Usage[];
  /** Manage billing, when there is a Stripe customer to manage. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card variant="surface" padding="none" className={cn("overflow-hidden", className)}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{description.title}</h2>
            {description.badge ? <StatusPill tone={TONE[description.tone]}>{description.badge}</StatusPill> : null}
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description.detail}</p>
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-3">
        {usage.map((u) => (
          <UsageMeter key={u.label} {...u} />
        ))}
      </div>
    </Card>
  );
}

function UsageMeter({ label, used, limit, unlimited, overNote }: Usage) {
  const over = used > limit;
  const pct = Math.min(100, limit > 0 ? (used / limit) * 100 : 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tnum font-medium", over ? "text-danger-ink" : "text-foreground")}>
          {unlimited ? `${used}` : `${used} of ${limit}`}
        </span>
      </div>
      {/* No bar against a limit the plan does not advertise — "fair use" is a promise, not a gauge. */}
      {unlimited ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Unlimited — fair use</p>
      ) : (
        <Progress
          value={pct}
          className={cn("mt-2", over && "[&_[data-slot=progress-indicator]]:bg-danger")}
          aria-label={`${label}: ${used} of ${limit}`}
        />
      )}
      {over && overNote ? <p className="mt-1.5 text-xs text-danger-ink">{overNote}</p> : null}
    </div>
  );
}
