import { Check, X } from "lucide-react";

/**
 * BEFORE AND AFTER — the reference's strongest section, rebuilt honestly.
 *
 * WHAT THE REFERENCE DOES THAT THIS DELIBERATELY DOES NOT. Its version puts
 * invented figures on both sides: a "without" column showing $44K collected
 * against a "with" column showing $118,000, plus booking rates that move from
 * 4% to 9%. Those are not measurements of anything — no product can promise
 * what a specific company's close rate will do — and a landing page is the
 * most expensive place to be caught making one up. The owner's standing
 * instruction on this page is that every claim be checkable from this
 * repository.
 *
 * So the two columns compare THE WORK, not the results. Everything in the left
 * column is what reconciling by hand actually involves; everything in the right
 * column is a thing this codebase does — read each tool's own API, match people
 * across sources, recompute on a sweep, show the working. Nobody is promised a
 * number. The contrast is still the sharpest on the page, because the honest
 * version of it is genuinely lopsided.
 */
const BY_HAND = [
  "Export a CSV from each tool, one at a time",
  "Hope the names and emails line up between them",
  "Dedupe by hand, and guess at the ones that are close",
  "Paste the total somewhere before the meeting",
  "Answer “where did that come from?” with an afternoon",
];

const WITH_US = [
  "Each tool read directly, through its own API",
  "The same person matched across sources automatically",
  "Recomputed on its own, every ten minutes",
  "One figure on a board your whole team is looking at",
  "Answer “where did that come from?” with a click",
];

export function Compare() {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:gap-5">
      {/* ── by hand ─────────────────────────────────────────────────────── */}
      {/* The quieter card of the two, and quieter on purpose: this is the
          column somebody recognises, not the one they are being sold. Loud
          red crosses would be the page shouting at the reader about their
          own current week. */}
      <div className="flex flex-col gap-5 rounded-card border border-border bg-card p-6 sm:p-7">
        <div>
          <p className="text-lg font-semibold text-foreground">Reconciling by hand</p>
          <p className="mt-1 text-sm text-muted-foreground">Every week, usually on a Friday</p>
        </div>

        <ul className="flex flex-col gap-3">
          {BY_HAND.map((line) => (
            <li key={line} className="flex min-w-0 items-start gap-2.5">
              <X aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 text-sm leading-relaxed text-muted-foreground">{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── with Namzilabs ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 rounded-card border border-brand-soft-line bg-brand-soft p-6 sm:p-7">
        <div>
          <p className="text-lg font-semibold text-foreground">With Namzilabs</p>
          <p className="mt-1 text-sm text-muted-foreground">Once, when you connect it</p>
        </div>

        <ul className="flex flex-col gap-3">
          {WITH_US.map((line) => (
            <li key={line} className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-success">
                <Check aria-hidden className="size-2.5 text-white" />
              </span>
              <span className="min-w-0 text-sm leading-relaxed text-foreground">{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
