import { Check } from "lucide-react";
import { SourceMark } from "@/components/source-mark";

/**
 * THREE ANSWERS, ONE RESOLUTION — the page's centrepiece.
 *
 * WHAT THIS REPLACES, AND WHY IT GREW. The same argument used to live in a
 * 460px card in the right-hand column: three rows of grey numerals, a rule,
 * and a 28px total. It was correct and nobody looked at it, because the most
 * important claim on the page was typeset smaller than the paragraph beside
 * it. Scale IS hierarchy on a landing page; an argument the eye skips has not
 * been made.
 *
 * THE ARITHMETIC IS REAL AND IT RECONCILES: 41 + 38 + 44 = 123 rows arrive,
 * 82 of them are the same people seen twice or three times, 41 unique remain —
 * which is also, and not coincidentally, what Calendly said. That last part is
 * the honest shape of this problem: the reconciled figure often AGREES with
 * one of the sources, and the value is knowing which one and why, not
 * producing a fourth number nobody has seen before.
 *
 * NOT `aria-hidden`, unlike the drawings on either side of it. The numbers ARE
 * the argument here rather than an illustration of one, so they are read out;
 * what is hidden is the connector between the two halves, which is a piece of
 * punctuation rather than a piece of content.
 */
const SOURCES: Array<{ source: string; name: string; count: number; counts: string }> = [
  { source: "calendly", name: "Calendly", count: 41, counts: "every invitee-created event" },
  { source: "close", name: "Close CRM", count: 38, counts: "meetings a rep logged to a lead" },
  { source: "gsheets", name: "Google Sheets", count: 44, counts: "what somebody typed on Friday" },
];

export function Reconcile() {
  return (
    <figure className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5">
      {/* ── the three that disagree ─────────────────────────────────────── */}
      <ul className="flex min-w-0 flex-1 flex-col gap-3">
        {SOURCES.map((s) => (
          <li
            key={s.source}
            className="lift-sm flex min-w-0 flex-1 items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5"
          >
            <SourceMark source={s.source} size={36} className="stat-numeral shrink-0" />

            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">{s.name}</span>
              {/* WHAT EACH TOOL IS COUNTING, in its own terms. Without this
                  line the card says three tools disagree; with it, it says
                  they are each answering a slightly different question — which
                  is the actual reason the numbers differ and the reason none of
                  them is wrong. */}
              <span className="truncate text-xs text-muted-foreground">{s.counts}</span>
            </span>

            {/* Muted ink: these are evidence, not the answer, and setting them
                as loudly as the result would be the figure arguing with
                itself. */}
            <span className="stat-numeral shrink-0 text-display-xs leading-none text-muted-foreground">{s.count}</span>
          </li>
        ))}
      </ul>

      {/* ── the join ────────────────────────────────────────────────────── */}
      {/* A brace rather than an arrow. An arrow says "then"; a brace says
          "all of these, together" — which is what reconciliation is, and the
          drop from three boxes to one is the whole gesture. */}
      <div aria-hidden className="flex shrink-0 items-center justify-center lg:w-8">
        <span className="h-px w-full bg-border lg:h-2/3 lg:w-px" />
      </div>

      {/* ── the one that resolves them ──────────────────────────────────── */}
      <div className="lift-md flex min-w-0 flex-col justify-between gap-6 rounded-2xl border border-brand-soft-line bg-brand-soft p-5 sm:p-6 lg:w-[19rem] lg:shrink-0">
        <span className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success">
            <Check className="size-3.5 text-white" />
          </span>
          <span className="text-sm font-semibold text-foreground">Namzilabs</span>
        </span>

        <span className="flex flex-col">
          <span className="stat-numeral text-display-lg leading-none text-foreground">41</span>
          <span className="mt-2 text-sm text-muted-foreground">unique people who booked</span>
        </span>

        {/* THE WORKING, ON THE FACE OF THE CARD. The number is only worth more
            than the three beside it because this line is under it — take it
            off and this is a fourth opinion. */}
        <span className="flex flex-col gap-1 border-t border-brand-soft-line pt-4">
          {[
            ["123", "records arrived"],
            ["82", "matched as the same person"],
            ["3", "excluded — no email to match on"],
          ].map(([n, what]) => (
            <span key={what} className="flex min-w-0 items-baseline gap-2">
              <span className="stat-numeral shrink-0 text-xs font-semibold text-foreground">{n}</span>
              <span className="min-w-0 text-xs text-muted-foreground">{what}</span>
            </span>
          ))}
        </span>
      </div>
    </figure>
  );
}
