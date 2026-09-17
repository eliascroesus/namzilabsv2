import { Filter, Sigma, Users } from "lucide-react";
import { SourceMark } from "@/components/source-mark";

/**
 * STEP TWO, DRAWN: the flow builder — the most distinctive screen in this
 * product, and until now the one thing the landing page never showed.
 *
 * THE FOUR NODES ARE THE FOUR REAL STEP KINDS, in the order somebody actually
 * builds them: pull records, keep the ones that count, match the same person
 * across sources, total what is left. Inventing a fifth to fill the column
 * would be drawing a product we do not ship.
 *
 * THE ARITHMETIC RUNS DOWN THE COLUMN and it is the same arithmetic as the
 * hero ledger: 123 records in, 82 matched away as duplicates, 41 out. A
 * picture of a pipeline whose numbers do not survive the trip through it is a
 * picture of exactly the problem this product claims to fix — so the counts on
 * the edges are load-bearing, not decoration.
 */
const STEPS: Array<{ icon: typeof Filter; kind: string; detail: string; source?: string }> = [
  { icon: Filter, kind: "Pull records", detail: "Calendly · invitee.created", source: "calendly" },
  { icon: Filter, kind: "Keep the ones that count", detail: "status is active" },
  { icon: Users, kind: "Match the same person", detail: "email, then phone" },
  { icon: Sigma, kind: "Total what is left", detail: "count of unique people" },
];

/** The count riding each edge, so the drop from 123 to 41 is visible. */
const EDGES = ["123 records", "104 kept", "41 unique"];

export function FlowShot() {
  return (
    /* THE DOTTED GROUND IS THE CANVAS ITSELF, not a texture chosen to look
       technical: the builder draws its nodes on a dot grid, and a drawing of
       it on a plain white card would be a drawing of a form. */
    <div
      aria-hidden
      className="flex h-full flex-col justify-center rounded-card bg-card p-4 sm:p-5"
      style={{
        backgroundImage: "radial-gradient(color-mix(in oklab, var(--color-border) 90%, transparent) 1px, transparent 0)",
        backgroundSize: "14px 14px",
      }}
    >
      <ol className="flex flex-col items-stretch">
        {STEPS.map((step, i) => (
          <li key={step.kind} className="flex flex-col">
            <div className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-background px-3 py-2.5">
              {/* The node's own mark: a source step wears the tool's logo, and
                  the three that operate on rows wear their verb's glyph. That
                  difference is how the builder itself distinguishes a step
                  that READS from a step that COMPUTES. */}
              {step.source ? (
                <SourceMark source={step.source} size={26} className="stat-numeral shrink-0" />
              ) : (
                <span className="flex size-[26px] shrink-0 items-center justify-center rounded-control bg-brand-soft">
                  <step.icon className="size-3.5 text-brand-800" />
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{step.kind}</span>
                <span className="truncate text-xs text-muted-foreground">{step.detail}</span>
              </span>
            </div>

            {/* THE EDGE, AND ITS COUNT. A 20px stem with the running total
                beside it — the builder shows this on every connection, and it
                is the reason the canvas is legible at a glance rather than a
                diagram you have to execute in your head. */}
            {i < EDGES.length && (
              <span className="flex items-center gap-2 pl-[25px]">
                <span className="h-5 w-px shrink-0 bg-border" />
                <span className="stat-numeral text-[11px] leading-none text-muted-foreground">{EDGES[i]}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
