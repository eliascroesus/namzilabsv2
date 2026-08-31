import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The guided path a brand-new workspace sees instead of a bare "No metrics
 * yet." — three steps, each checked off from REAL state (connection count,
 * flow count, published-tile count), so it doubles as a progress readout: a
 * user who connected yesterday and stalled sees exactly where they stopped.
 *
 * Deliberately NOT a wizard and NOT sample data. The canonical `events` table
 * is what the single-writer pipeline protects, and every downstream system —
 * metrics compute, the field registry the pickers read, flow Test sampling,
 * the invariant scan's empty-mirror check — treats its rows as truth. Sample
 * rows would need a synthetic connection, would register fake fields in every
 * picker, and would need purge logic to un-lie four subsystems. Three real
 * steps are cheaper than that, and the first one takes about a minute.
 */
export function OnboardingChecklist({
  hasConnection,
  hasFlow,
  hasPublished,
}: {
  hasConnection: boolean;
  hasFlow: boolean;
  hasPublished: boolean;
}) {
  const steps: Array<{ done: boolean; title: string; detail: string; href: string; cta: string }> = [
    {
      done: hasConnection,
      title: "Connect an integration",
      detail: "Close, Calendly, Google Sheets, a custom webhook — anywhere your data already lives.",
      href: "/integrations",
      cta: "Connect",
    },
    {
      done: hasFlow,
      title: "Build your first flow",
      detail: "Pick the data, filter and group it visually, and Test it on real records as you go.",
      href: "/dashboard/flows",
      cta: "New flow",
    },
    {
      done: hasPublished,
      title: "Publish it",
      detail: "Publishing puts the number on this dashboard and keeps it updating by itself.",
      href: "/dashboard/flows",
      cta: "Open flows",
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    // A REAL SURFACE now, not a dashed outline on the page: this is the first
    // thing a new workspace sees, and on the warm canvas an unfilled box reads
    // as a placeholder that failed to load rather than as an invitation.
    <div className="mt-6 rounded-surface border border-border bg-card p-8 shadow-card">
      <h2 className="font-display text-lg font-semibold text-foreground">Get your first metric live</h2>
      <p className="mt-1 text-sm text-muted-foreground">Three steps — the first takes about a minute.</p>
      <ol className="mt-5 space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            {step.done ? (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-ink">
                <Check size={14} strokeWidth={2.25} />
              </span>
            ) : (
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  // The step you are on is a FILLED marker, which is the shape
                  // the brand is for: a yellow disc carrying near-black at
                  // 11.24:1. The steps behind and ahead of it are outlines, and
                  // an outline is a line — it takes the hairline, never the
                  // yellow, which measures 1.55:1 as a stroke on this card.
                  i === next ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
            )}
            <div>
              <p className={cn("font-medium", step.done ? "text-muted-foreground line-through" : "text-foreground")}>
                {step.title}
              </p>
              {!step.done && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {step.detail}{" "}
                  {/* A link is TEXT, so it is the marker's ink step and never
                      the brand: `text-primary` here was 1.55:1 on the card, a
                      call to action nobody could read. The 700 is 6.79:1,
                      which is what body copy owes. */}
                  {i === next && (
                    <Link href={step.href} className="whitespace-nowrap font-medium text-marker hover:underline">
                      {step.cta}
                    </Link>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
