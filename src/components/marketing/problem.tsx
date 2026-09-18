import { Unlink } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { sourceStyle } from "@/components/flow/controls/source-style";
import { SourceMark } from "@/components/source-mark";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

/**
 * SIX TOOLS, EACH RIGHT, NONE OF THEM TOUCHING.
 *
 * ── WHY THIS WAS REBUILT ───────────────────────────────────────────────────
 *
 * It was six identical cards in a 3x2 grid: same width, same height, same
 * radius, same border, arriving all at once. The owner's word for the page
 * that shape produced was "boring", and a uniform grid is the purest form of
 * it — six equal rectangles tell you that all six items are equally important,
 * which is another way of saying none of them is.
 *
 * ── WHAT A BENTO BUYS THAT A GRID DOES NOT ─────────────────────────────────
 *
 * The section's argument has two halves: each tool is correct, AND there is
 * nowhere to stand between them. The old grid only ever made the first half —
 * the second lived in the paragraph above and nothing on screen carried it.
 *
 * Now the fragments occupy five cells and the sixth is the CONCLUSION, filling
 * the hole they leave: "and no way to add them up". It is the only tinted cell
 * in the block, it is the only one with no number on it, and it sits in the
 * middle of the others rather than after them — because that is where the
 * missing thing actually is.
 *
 * ── THE STAGGER IS 70ms AND IT MEANS SOMETHING ─────────────────────────────
 *
 * The cards arrive one after another, in reading order, which makes the block
 * assemble rather than appear. 70ms is under the threshold at which a sequence
 * stops reading as one gesture; at 200ms it would be a queue and the last card
 * would arrive after the eye had already left.
 */
const FRAGMENTS: Array<{ source: string; metric: string; value: string; note: string; wide?: boolean }> = [
  { source: "calendly", metric: "Meetings booked", value: "41", note: "…but not which ones showed up" },
  { source: "close", metric: "Deals created", value: "18", note: "…but not what they cost to get" },
  { source: "stripe", metric: "Revenue", value: "$48.2k", note: "…but not which campaign earned it" },
  { source: "instantly", metric: "Replies", value: "112", note: "…but not which became revenue" },
  { source: "aircall", metric: "Calls connected", value: "306", note: "…but not against how many leads" },
  { source: "gsheets", metric: "Rows, kept by hand", value: "2,130", note: "…but only until Friday" },
];

function Fragment({ source, metric, value, note }: (typeof FRAGMENTS)[number]) {
  const brand = sourceStyle(source);
  const entry = CONNECTOR_CATALOG.find((c) => c.source === source);
  return (
    <div className="card-hoverable lift-sm flex h-full min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <span className="flex min-w-0 items-center gap-2.5">
        {/* THE PRODUCT'S OWN MARK, not a second copy of it. This drew two
            letters and computed its own ink, which meant the landing page kept
            showing initials after the app started showing logos. */}
        <SourceMark source={source} size={28} className="stat-numeral" />
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{entry?.name ?? brand.label}</span>
      </span>

      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-muted-foreground">{metric}</span>
        <span className="stat-numeral shrink-0 text-display-xs leading-none text-foreground">{value}</span>
      </span>

      {/* The sentence is the point of the card. Each tool is RIGHT, and each
          one stops exactly where the question you actually have begins. */}
      <span className="mt-auto border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">{note}</span>
    </div>
  );
}

export function ProblemGrid() {
  return (
    /* SIX COLUMNS AT `lg`, so cells can be two or three wide and the row still
       divides evenly. A 3-col grid cannot express "this one is bigger" without
       leaving a hole. */
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
      {FRAGMENTS.slice(0, 3).map((f, i) => (
        <Reveal as="li" key={f.source} delay={i * 70} className="lg:col-span-2">
          <Fragment {...f} />
        </Reveal>
      ))}

      {/* ── the conclusion, sitting in the gap the others leave ────────── */}
      <Reveal as="li" delay={210} className="sm:col-span-2 lg:col-span-3">
        <div
          className={cn(
            "flex h-full min-w-0 flex-col justify-center gap-3 rounded-2xl p-6 sm:p-7",
            /* THE ONE COLOURED CELL IN THE BLOCK. Everything around it is a
               white card carrying a number; this carries no number at all,
               which is the entire point — the thing that is missing cannot be
               shown as a figure. */
            "border border-brand-soft-line bg-brand-soft",
          )}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-400/15">
            <Unlink aria-hidden className="size-4 text-brand-800" />
          </span>
          <p className="font-marketing text-display-xs font-bold leading-tight tracking-tight text-foreground">
            And no way to add them up.
          </p>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Six logins, six exports, six sets of names that nearly match. The question you actually have — what a
            meeting costs, which channel carried the month — lives in the space between them.
          </p>
        </div>
      </Reveal>

      {/* HALF-WIDTH FROM HERE DOWN, and the arithmetic is why: three cells of
          two plus a conclusion of three is nine columns in a six-column grid,
          which leaves the last row broken across a boundary. Three of two
          (row one), then conclusion-of-three beside one of three, then two of
          three — 6, 6, 6, and no cell orphaned. */}
      {FRAGMENTS.slice(3).map((f, i) => (
        <Reveal as="li" key={f.source} delay={280 + i * 70} className="lg:col-span-3">
          <Fragment {...f} />
        </Reveal>
      ))}
    </ul>
  );
}
