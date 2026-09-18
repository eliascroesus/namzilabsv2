import { SourceMark } from "@/components/source-mark";
import { cn } from "@/lib/utils";

/**
 * THE RECEIPT — the page's signature, and the only place it spends any
 * boldness.
 *
 * A figure stated large, with the working revealed underneath it in a fixed,
 * repeating form: what arrived, what was thrown away and why, what was left to
 * consider, how much of it was the same person, and what remains. It appears
 * three times — the hero, the centrepiece of the proof block, step three of
 * how-it-works — and nowhere else.
 *
 * ── IT IS NOT A CARD, AND THAT IS THE MAIN DECISION ────────────────────────
 *
 * The obvious build is a rounded panel with a border and a soft shadow, which
 * is what every other block on a SaaS page looks like — and it would make the
 * one memorable object on this page indistinguishable from the furniture. So
 * there is no card: a rule above, a rule below, and the working set on bare
 * paper. A printed statement rather than a UI panel.
 *
 * ── THE ARITHMETIC RECONCILES, AND THAT IS THE WHOLE POINT ─────────────────
 *
 * The page this replaces showed "123 in · 82 matched · 41 unique" with 3
 * excluded mentioned elsewhere, which does not add up — a reader with a
 * calculator gets 38. On the one section whose entire claim is that the
 * working is shown, the working has to survive being checked. These five lines
 * do: 123 − 3 = 120, and 120 − 79 = 41.
 *
 * ── WHY THE NUMBERS ARE MONO AND THE WORDS ARE NOT ─────────────────────────
 *
 * Mono on this page means "a machine produced this and you can check it".
 * Tabular figures are load-bearing rather than decorative: the working is a
 * subtraction read vertically, and proportional digits put the 1s and the 7s
 * in different places down the column, which breaks the one thing the layout
 * exists to show.
 */

/** The five lines, in the order a reader would do the sum. */
export type WorkingLine = { n: string; label: string; excluded?: boolean; total?: boolean };

export const BOOKED_WORKING: WorkingLine[] = [
  { n: "123", label: "records arrived" },
  { n: "3", label: "excluded — no email to match on", excluded: true },
  { n: "120", label: "considered" },
  { n: "79", label: "matched to someone already counted" },
  { n: "41", label: "unique people", total: true },
];

export const BOOKED_SOURCES = ["calendly", "close", "gsheets"];

export function Receipt({
  size = "md",
  brand = "Namzilabs",
  label = "Meetings booked",
  figure = "41",
  caption = "unique people who booked",
  sources = BOOKED_SOURCES,
  working = BOOKED_WORKING,
  /**
   * The one orchestrated moment on the page: the working lines arrive in
   * sequence, once, after the figure lands. Only the hero asks for it.
   * `prefers-reduced-motion` renders the final state immediately — handled in
   * CSS, so there is no client component and nothing to hydrate.
   */
  reveal = false,
  className,
}: {
  size?: "sm" | "md" | "xl";
  brand?: string;
  label?: string;
  figure?: string;
  caption?: string;
  sources?: string[];
  working?: WorkingLine[];
  reveal?: boolean;
  className?: string;
}) {
  return (
    <figure className={cn("receipt", className)} data-size={size} data-reveal={reveal || undefined}>
      {/* ── the head: what this is, and what it read ──────────────────── */}
      <figcaption className="receipt-head">
        <span className="receipt-brand">{brand}</span>
        <span className="receipt-sources">
          {sources.map((s) => (
            <SourceMark key={s} source={s} size={size === "xl" ? 24 : 20} />
          ))}
        </span>
      </figcaption>

      <p className="receipt-label">{label}</p>

      <p className="receipt-figure t-num">{figure}</p>
      <p className="receipt-caption">{caption}</p>

      {/* ── the working ───────────────────────────────────────────────── */}
      {/* A `<dl>` rather than a list of rows: each line genuinely is a term
          and its value, and it lets a screen reader read "123, records
          arrived" as one pair instead of two orphaned fragments. */}
      <dl className="receipt-working t-working">
        {working.map((w, i) => (
          <div
            key={w.label}
            className="receipt-line"
            data-excluded={w.excluded || undefined}
            data-total={w.total || undefined}
            /* The stagger is the page's whole motion budget. Index-driven so
               a longer or shorter working set still arrives in order. */
            style={reveal ? ({ "--i": i } as React.CSSProperties) : undefined}
          >
            <dt className="receipt-n t-num">{w.n}</dt>
            <dd className="receipt-what">
              {w.excluded && <span aria-hidden className="receipt-mark" />}
              {w.label}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
