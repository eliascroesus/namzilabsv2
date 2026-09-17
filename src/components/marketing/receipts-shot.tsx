import { Clock, MinusCircle, RefreshCw, Users } from "lucide-react";
import { SourceMark } from "@/components/source-mark";

/**
 * STEP THREE, DRAWN: a published metric with its working shown.
 *
 * THIS IS THE PRODUCT'S WHOLE CLAIM IN ONE CARD, and the reason it is the last
 * of the three: connecting a tool and building a metric are things every
 * competitor also does. Handing you the four lines underneath — when it ran,
 * what it read, what it matched, what it THREW AWAY and why — is the part that
 * makes the number arguable.
 *
 * THE EXCLUSION LINE IS NOT OPTIONAL. A receipts panel that only lists what
 * was counted is a receipts panel with the interesting half missing: "3
 * excluded — no email to match on" is the line somebody checks when they think
 * the figure looks low, and leaving it out of the drawing would sell a
 * transparency the product would then have to be caught not having.
 */
const READS = ["calendly", "close", "gsheets"];

const WORKING: Array<{ icon: typeof Clock; label: string }> = [
  { icon: RefreshCw, label: "Recomputed 2 minutes ago" },
  { icon: Users, label: "82 matched as the same person" },
  { icon: MinusCircle, label: "3 excluded — no email to match on" },
];

export function ReceiptsShot() {
  return (
    <div aria-hidden className="flex h-full flex-col gap-4 rounded-card bg-card p-4 sm:p-5">
      {/* ── the metric itself ──────────────────────────────────────────── */}
      <div className="rounded-card border border-border bg-background p-4">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">Meetings booked</span>
          <span className="text-xs text-muted-foreground">Last 7 days</span>
        </span>

        <span className="mt-2 flex items-baseline gap-2.5">
          <span className="stat-numeral text-display-md leading-none text-foreground">41</span>
          <span className="stat-numeral text-xs text-success">+12%</span>
        </span>

        {/* A seven-day sparkline, drawn as bars rather than a path: at this
            size a polyline is three pixels of slope and reads as noise. */}
        <span className="mt-3 flex h-10 items-end gap-1.5">
          {[34, 52, 78, 61, 44, 70, 58].map((v, i) => (
            <span
              key={i}
              className="min-w-0 flex-1 rounded-t-md bg-brand-400"
              style={{ height: `${Math.max(12, v)}%` }}
            />
          ))}
        </span>
      </div>

      {/* ── the working ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Read from</span>
          <span className="flex min-w-0 items-center gap-1">
            {READS.map((s) => (
              <SourceMark key={s} source={s} size={20} className="stat-numeral shrink-0" />
            ))}
          </span>
        </span>

        <ul className="flex flex-col gap-2">
          {WORKING.map((w) => (
            <li key={w.label} className="flex min-w-0 items-center gap-2">
              <w.icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs text-muted-foreground">{w.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
