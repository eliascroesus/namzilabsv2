import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ArrowRight, Check } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { buttonVariants } from "@/components/ui/button";
import { AppWindow } from "@/components/marketing/app-window";
import { ToolMarquee } from "@/components/marketing/marquee";
import { PillNav } from "@/components/marketing/pill-nav";
import { cn } from "@/lib/utils";

/**
 * THE FRONT DOOR.
 *
 * THE HERO IS THE THESIS, NOT A DESCRIPTION OF IT. What this product does is
 * settle an argument — Calendly says 41 meetings, Close says 38, the sheet the
 * team keeps by hand says 44, and somebody has to walk into a Monday meeting
 * with ONE figure and a reason to trust it. So the headline is that claim and
 * the ledger further down is its proof, shown rather than asserted.
 *
 * WHAT THE 2026 REBUILD CHANGED, AND WHY. The page was correct and quiet: a
 * white ground, a 64px headline, a card. Quiet is right for the app — "quiet
 * chrome, loud numbers" is the kit's whole thesis — and it is the wrong
 * instruction for the one screen whose job is to be looked at by someone who
 * has not decided to care yet. So the hero, and ONLY the hero, gets a
 * full-bleed sky, a 120px headline and a picture of the product; everything
 * below the fold returns to the quiet page, which is also what keeps the hero
 * reading as a deliberate moment rather than as the house style.
 *
 * WHAT IT REFUSED TO COPY. The reference this was drawn from carries "Trusted
 * by 50K+ businesses", a wall of customer logos and "1M+ mailboxes set up".
 * We have no such numbers, so the page has none: the social-proof slot holds
 * the tools we READ instead, labelled "Reads from" and never "Trusted by",
 * and the stat band holds four facts about the product that are checkable from
 * this repository. A landing page is the easiest place in a product to lie and
 * the most expensive place to be caught.
 *
 * Every connector named below is read from CONNECTOR_CATALOG rather than typed
 * out, count included, so the page cannot claim an integration the product
 * does not ship — the copy two rewrites ago hard-coded four of the seven and
 * had already fallen behind.
 */
export const metadata = {
  title: "Namzilabs — one number, from every tool you already use",
  description:
    "Namzilabs reads Calendly, Close, Instantly, Google Sheets and more, reconciles the overlap between them, and gives you one figure you can defend — with the receipts for how it got there.",
};

/**
 * The hero ledger. Three sources, three answers, one resolution.
 *
 * The arithmetic is real and it adds up on purpose: 123 records arrive, 82 of
 * them are the same people seen twice, 41 remain. A demo whose numbers do not
 * reconcile is a demo of exactly the problem this product claims to fix.
 */
const LEDGER: Array<{ source: string; count: number; note: string }> = [
  { source: "Calendly", count: 41, note: "invitee-created events" },
  { source: "Close CRM", count: 38, note: "meetings logged to a lead" },
  { source: "Google Sheets", count: 44, note: "the sheet the team keeps by hand" },
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Connect your tools",
    body: "Sign in with Google, or paste an API key. New records start arriving within minutes and your history backfills behind you — you do not wait for it to finish before building anything.",
  },
  {
    title: "Build the metric",
    body: "Drag steps onto a canvas: pull records, keep the ones that count, match the same person across two sources, and total what is left. Test it against real rows before you publish it. No SQL, no warehouse.",
  },
  {
    title: "Watch it stay right",
    body: "A published metric recomputes on its own and shows its working: when it last ran, which sources it read, how many duplicates it matched, and what it left out and why.",
  },
];

/**
 * The stat band, and the reason each of these four is here rather than a
 * customer count: every one is a fact this repository can be checked against.
 * The integration count is COMPUTED, so it cannot fall behind the catalogue;
 * ten minutes is the sweep's real cadence (`materialize-stale`); the other two
 * are claims the product either honours or does not.
 */
const FACTS: Array<{ figure: string; label: string }> = [
  { figure: `${CONNECTOR_CATALOG.length}`, label: "Tools it reads" },
  { figure: "10 min", label: "Recompute cadence" },
  { figure: "0", label: "Lines of SQL" },
  { figure: "Read-only", label: "Access it asks for" },
];

export default async function Home() {
  const { user } = await withAuth();
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = user ? "Go to dashboard" : "Start free";

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PillNav signedIn={Boolean(user)} />

      <main id="main" className="flex-1">
        {/* ==== Hero ======================================================= */}
        {/**
         * `pb-0` and a product window that hangs out of the bottom: the card
         * is pulled down into the section below it with a negative margin, so
         * the seam between the sky and the page runs BEHIND it. That overlap
         * is the whole reason the shot reads as sitting in front of the page
         * rather than as another block stacked on it.
         */}
        {/* NO `overflow-hidden` HERE, and it is worth a line because putting it
             back is the obvious tidy-up. The product window hangs out of the
             bottom of this section on purpose — that overlap is what makes it
             read as sitting in FRONT of the page rather than as another block
             stacked on it — and `overflow-hidden` cut it off at the seam. It
             was guarding nothing: a background paints inside its own box, and
             the grid overlay is `inset-0`. */}
        <section className="hero-sky relative px-5 pb-16 pt-28 sm:px-8 sm:pb-20 sm:pt-32 lg:pt-40">
          <div className="mx-auto w-full max-w-6xl">
            {/**
             * THE HEADLINE IS ONE SENTENCE SET AS TWO BLOCKS, one flush left
             * and one flush right, which is the reference's signature move and
             * the reason a five-word line can hold a whole screen: the eye
             * travels the full width of the page to finish reading it.
             *
             * It is written in sentence case and CAPITALISED IN CSS. Typing it
             * in capitals would put "ONE NUMBER" into the accessibility tree
             * and into every search result, where some screen readers spell
             * capitalised words out letter by letter; `uppercase` is a
             * rendering instruction and leaves the text itself alone.
             */}
            <h1 className="font-display text-banner font-semibold uppercase leading-none text-white">
              <span className="block">One number</span>
              <span className="mt-1 block text-right sm:mt-2">you can defend</span>
            </h1>

            {/**
             * THE INTERLOCK THE REFERENCE HAS AND THIS PAGE DOES NOT.
             *
             * There, the supporting paragraph rises into the band of the
             * second headline line and sits in the gap its right-alignment
             * opens on the left. Tried, and taken out: "AT SCALE" is eight
             * characters and leaves half a page of gap, while "you can defend"
             * is fourteen and starts at about 20% of the container — so the
             * paragraph and the headline overlapped for 300px and the first
             * line of copy read through the leg of a Y.
             *
             * The choices were a shorter second line or no interlock, and the
             * headline is the more important of the two: "one number you can
             * defend" is the product's claim, and "one number you trust" is a
             * weaker sentence bought to buy a layout trick. So the row simply
             * follows the headline, and the asymmetry the page gets is the one
             * that survives the copy — text left, action right.
             */}
            <div className="mt-12 flex flex-col gap-10 sm:mt-14 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
              <p className="max-w-md text-md leading-relaxed text-white/90 sm:text-lg">
                Calendly says 41. Close says 38. The spreadsheet says 44. Namzilabs reads all three, works out which
                records are the same person seen twice, and gives you one figure — with the arithmetic shown
                underneath it.
              </p>

              <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                <a
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "lg" }),
                    "gap-2 rounded-full border-transparent bg-white text-neutral-950 hover:bg-brand-50",
                  )}
                  href={cta}
                >
                  {ctaLabel}
                  {/* The arrow in its own disc — the reference's tell, and it
                      earns its place: it gives a white pill on a blue ground
                      an interior, so the button reads as an object rather than
                      as a gap in the sky. */}
                  <span className="-mr-2 flex size-7 items-center justify-center rounded-full bg-neutral-950">
                    <ArrowRight className="size-4 text-white" aria-hidden />
                  </span>
                </a>
                <p className="text-sm text-white/85">
                  Read-only access. Disconnect any tool and keep what it sent.
                </p>
              </div>
            </div>

            {/* ---- Reads from: the honest logo wall ---------------------- */}
            <div className="mt-14 sm:mt-16">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
                Reads from {CONNECTOR_CATALOG.length} tools, including
              </p>
              <div className="mt-4">
                <ToolMarquee />
              </div>
            </div>

            {/* ---- The product ------------------------------------------- */}
            {/**
             * THE OVERLAP, AND THE ARITHMETIC BEHIND IT.
             *
             * How far the window hangs below the sky is `|mb| - section pb`,
             * and the section's bottom padding is what makes that subtraction
             * happen at all: with `pb-0` the figure's negative bottom margin
             * COLLAPSES THROUGH the section and becomes the section's own
             * margin, so the sky simply ended level with the window and the
             * overlap this whole composition is built on silently did nothing.
             * It measured right in the source and wrong in the browser, which
             * is the failure this repo keeps a screenshot pass for.
             *
             * So: pb-16/-mb-40 = 96px of overlap on a phone, pb-20/-mb-48 =
             * 112px from `sm` up. The section below reserves pt-44/pt-56 for
             * it, which is the overlap plus a section's worth of air.
             */}
            <figure className="relative z-10 mt-14 -mb-40 sm:mt-16 sm:-mb-48">
              <AppWindow />
              {/* The one caption a screen reader gets, because `AppWindow`
                  itself is `aria-hidden`: forty decorative numbers belonging
                  to a company that does not exist, read out before the visitor
                  reaches the sign-up link, is worse than no picture at all. */}
              <figcaption className="sr-only">
                The Namzilabs dashboard: a board of metric tiles — meetings booked, pickup rate, speed to lead —
                each recomputed from the tools it reads.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ==== The facts ================================================== */}
        {/* The top padding pays for the window hanging into this section:
            112px of overlap plus a section's worth of air above the heading. */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-44 sm:px-8 sm:pb-24 sm:pt-56">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-center lg:gap-16">
            <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
              Built to be
              <br />
              argued with.
            </h2>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4">
              {FACTS.map((f) => (
                <div key={f.label}>
                  <dt className="sr-only">{f.label}</dt>
                  <dd>
                    {/* `text-nowrap`: "Read-only" is the one figure here that
                        is a word rather than a number, and a hyphen is a
                        break opportunity — it split into "Read-" / "only"
                        the first time this row was measured. */}
                    <span className="stat-numeral block text-nowrap text-display-md leading-none text-foreground">
                      {f.figure}
                    </span>
                    <span className="mt-2 block text-sm text-muted-foreground">{f.label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ==== The receipts =============================================== */}
        <section id="proof" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-20">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-marker">The receipts</p>
                <h2 className="font-display mt-4 text-display-lg font-semibold leading-tight text-foreground">
                  Three tools.
                  <br />
                  Three answers.
                </h2>
                <p className="mt-6 max-w-lg text-md leading-relaxed text-muted-foreground">
                  None of them are lying. Calendly counts the invite, Close counts what a rep logged, the sheet counts
                  what somebody typed on Friday. The disagreement is real, and the only useful answer is the one that
                  shows how it was resolved.
                </p>
                <p className="mt-4 max-w-lg text-md leading-relaxed text-muted-foreground">
                  Every published metric carries its working: when it last ran, which sources it read, how many
                  records it matched as the same person, and what it left out and why.
                </p>
              </div>
              <HeroLedger />
            </div>
          </div>
        </section>

        {/* ==== How it works =============================================== */}
        <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-16 sm:px-8 sm:py-24">
          <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
            Connected on Monday. Defensible by Friday.
          </h2>
          {/* NUMBERED, because this genuinely is a sequence: you cannot build a
              metric before connecting a tool, and the order is the thing a
              first-time reader most needs. Numbering something that is not a
              sequence is decoration; this is not that. */}
          <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-t border-border pt-6">
                {/* Violet again, and this one is worth stating: the brand sheet
                    draws its step numerals in yellow, but it draws them as
                    filled discs carrying near-black ink. This numeral is bare
                    glyph on the ground with nothing behind it, so it is a
                    stroke and it takes the marker. */}
                <span className="stat-numeral block text-display-xs leading-none text-marker">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">{step.title}</h3>
                {/* 16px, not the app's 14 — reading copy, not chrome. See the
                    note in ui/legal.tsx: `leading-relaxed` is the tell. */}
                <p className="mt-2 text-md leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ==== Integrations =============================================== */}
        <section id="integrations" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
              {CONNECTOR_CATALOG.length} tools, read directly.
            </h2>
            <p className="mt-4 max-w-2xl text-md leading-relaxed text-muted-foreground">
              No warehouse in between, no nightly export to babysit. Namzilabs talks to each tool&rsquo;s own API and
              keeps its copy current.
            </p>
            <ul className="mt-12 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {CONNECTOR_CATALOG.map((entry) => (
                <li key={entry.source} className="border-t border-border pt-4">
                  <p className="text-md font-semibold text-foreground">{entry.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{entry.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ==== Closing ==================================================== */}
        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          {/* The sky again, this time as an object rather than as a ground —
              the page opened on it and closes on it, and in between it is a
              quiet white document. */}
          <div className="sky-card overflow-hidden rounded-frame px-6 py-16 text-center sm:rounded-3xl sm:px-10 sm:py-20">
            <h2 className="font-display mx-auto max-w-2xl text-display-lg font-semibold leading-tight text-white">
              Stop reconciling by hand.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-md leading-relaxed text-white/85 sm:text-lg">
              Connect one tool and build your first metric in an afternoon.
            </p>
            <div className="mt-9 flex justify-center">
              <a
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "gap-2 rounded-full border-transparent bg-white text-neutral-950 hover:bg-brand-50",
                )}
                href={cta}
              >
                {ctaLabel}
                <span className="-mr-2 flex size-7 items-center justify-center rounded-full bg-neutral-950">
                  <ArrowRight className="size-4 text-white" aria-hidden />
                </span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-muted-foreground sm:px-8">
          <span>&copy; {new Date().getFullYear()} Namzilabs</span>
          <nav className="flex gap-5">
            <Link className="inline-flex min-h-6 items-center rounded-control transition-colors hover:text-foreground" href="/docs">
              Docs
            </Link>
            <Link className="inline-flex min-h-6 items-center rounded-control transition-colors hover:text-foreground" href="/terms">
              Terms
            </Link>
            <Link className="inline-flex min-h-6 items-center rounded-control transition-colors hover:text-foreground" href="/privacy">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * Three sources, three answers, one resolution — the product's whole claim in
 * one card.
 *
 * Presentational and static: it is a drawing of a real tile, not a live one,
 * and it says so by being on the marketing page rather than pretending to be
 * data. `aria-hidden` is deliberately NOT used — the numbers are the argument,
 * so they are read out; what IS hidden is the decorative rule between them.
 */
function HeroLedger() {
  return (
    <figure className="rounded-surface border border-border bg-background p-6 sm:p-7">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-md font-semibold text-foreground">Meetings booked</span>
        <span className="text-xs text-muted-foreground">Last 7 days</span>
      </figcaption>

      <ul className="mt-5 space-y-3">
        {LEDGER.map((row) => (
          <li key={row.source} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{row.source}</span>
              <span className="block truncate text-xs text-muted-foreground">{row.note}</span>
            </span>
            {/* The disagreeing numbers sit in muted ink: they are evidence,
                not the answer, and typesetting them as loudly as the result
                would be the card arguing with itself. */}
            <span className="tnum shrink-0 text-lg font-semibold text-muted-foreground">{row.count}</span>
          </li>
        ))}
      </ul>

      <div aria-hidden className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-end justify-between gap-4">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Check aria-hidden className="size-4 shrink-0 text-success" />
            Namzilabs
          </span>
          {/* Shortened from "123 records in · 82 matched as the same person ·
              41 unique", which wrapped with the word "unique" alone on a third
              line beside a 28px figure — the arithmetic has to read as one
              line of working, not as a paragraph. */}
          <span className="mt-1 block text-xs text-muted-foreground">123 in · 82 matched · 41 unique</span>
        </span>
        <span className="stat-numeral shrink-0 text-display-md leading-none text-foreground">41</span>
      </div>
    </figure>
  );
}
