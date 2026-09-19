import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { brandNeedsDarkInk, sourceStyle } from "@/components/flow/controls/source-style";
import { cn } from "@/lib/utils";

/**
 * THE PROBLEM, DRAWN AS THE THING IT ACTUALLY LOOKS LIKE.
 *
 * Every one of these tools ships a dashboard, and every one of those dashboards
 * is right. Calendly knows how many meetings were booked; Stripe knows what
 * came in; Instantly knows how many people replied. None of them knows what a
 * reply was worth, because the answer to that lives in two of them at once and
 * neither can see the other.
 *
 * So the drawing is SIX CORRECT ANSWERS TO SIX DIFFERENT QUESTIONS, laid out as
 * the six separate browser tabs they really are. Not six wrong numbers — that
 * would be the reconciliation argument, which the ledger section further down
 * makes properly, and making it twice would flatten both. This one is about
 * there being no single place to stand.
 *
 * The tools and their marks come from `CONNECTOR_CATALOG`, so the illustration
 * of the problem cannot name an integration the product does not ship — the
 * same rule the rest of this page follows. The FIGURES are invented, as they
 * are in any product shot.
 */

const FRAGMENTS: Array<{ source: string; metric: string; value: string; note: string }> = [
  { source: "calendly", metric: "Meetings booked", value: "41", note: "…but not which ones showed up" },
  { source: "close", metric: "Deals created", value: "18", note: "…but not what they cost to get" },
  { source: "instantly", metric: "Replies", value: "112", note: "…but not which became revenue" },
  { source: "stripe", metric: "Revenue", value: "$48.2k", note: "…but not which campaign earned it" },
  { source: "gsheets", metric: "Rows, kept by hand", value: "2,130", note: "…but only until Friday" },
  { source: "aircall", metric: "Calls connected", value: "306", note: "…but not against how many leads" },
];

function Fragment({ source, metric, value, note }: (typeof FRAGMENTS)[number]) {
  const brand = sourceStyle(source);
  const entry = CONNECTOR_CATALOG.find((c) => c.source === source);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-background p-5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "stat-numeral flex size-7 shrink-0 items-center justify-center rounded-control text-xs",
            brandNeedsDarkInk(brand.color) ? "text-neutral-950" : "text-white",
          )}
          style={{ background: brand.color }}
        >
          {brand.short}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{entry?.name ?? brand.label}</span>
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-muted-foreground">{metric}</span>
        <span className="stat-numeral shrink-0 text-display-xs leading-none text-foreground">{value}</span>
      </span>
      {/* The sentence is the point of the whole card. Each tool is RIGHT, and
          each one stops exactly where the question you actually have begins. */}
      <span className="border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">{note}</span>
    </li>
  );
}

export function ProblemGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FRAGMENTS.map((f) => (
        <Fragment key={f.source} {...f} />
      ))}
    </ul>
  );
}
