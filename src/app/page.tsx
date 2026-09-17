import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ArrowRight } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { buttonVariants } from "@/components/ui/button";
import { AppWindow } from "@/components/marketing/app-window";
import { ToolMarquee } from "@/components/marketing/marquee";
import { AiPanel } from "@/components/marketing/ai-panel";
import { PillNav } from "@/components/marketing/pill-nav";
import { ProblemGrid } from "@/components/marketing/problem";
import { ConnectShot } from "@/components/marketing/connect-shot";
import { FlowShot } from "@/components/marketing/flow-shot";
import { ReceiptsShot } from "@/components/marketing/receipts-shot";
import { Reconcile } from "@/components/marketing/reconcile";
import { Compare } from "@/components/marketing/compare";
import { Faq } from "@/components/marketing/faq";
import { ToolGrid } from "@/components/marketing/tool-grid";
import { cn } from "@/lib/utils";

/**
 * THE FRONT DOOR.
 *
 * THE HERO IS THE THESIS, NOT A DESCRIPTION OF IT. What this product does is
 * settle an argument — Calendly says 41 meetings, Close says 38, the sheet the
 * team keeps by hand says 44, and somebody has to walk into a Monday meeting
 * with ONE figure and a reason to trust it. So the headline is that claim and
 * the rest of the page is its proof, shown rather than asserted.
 *
 * ── WHAT THE SEPTEMBER REBUILD CHANGED ─────────────────────────────────────
 *
 * The page before this one had a strong hero and then four thousand pixels of
 * document. Every section under the fold had the identical shape — a tracked-
 * out capitalised eyebrow, a left-flush heading, a paragraph, a grid of
 * hairline boxes — so nothing on it was louder than anything else and the eye
 * had nowhere to stop. It also contained, after the hero, exactly ZERO
 * pictures of the product it was selling.
 *
 * Three things fix that, and all three came from the reference the owner
 * handed over (themochi.app):
 *
 *   1. GROUND COLOUR AS RHYTHM. The blue returns four times — the hero, the
 *      facts, the three steps, the assistant — with quiet white between each
 *      pair. A loud surface is only loud next to a quiet one, which is why the
 *      answer to "make it look better" was not "more blue everywhere".
 *   2. A PICTURE PER CLAIM. Connecting a tool, building a metric and reading
 *      its receipts are now drawn rather than described. They are DOM, not
 *      screenshots: sharp at any density, correct in both themes, incapable of
 *      going stale, and carrying no customer's data — which a screenshot taken
 *      against this repo's `.env.local` would ([[env-local-mixes-test-workos-
 *      with-prod-db]] is not a hypothetical).
 *   3. GLASS ON THE BLUE. White, translucent, blurred, rimmed — the reference's
 *      signature material, and the reason its page reads as expensive. Ours
 *      carries no drop shadow, because the owner retired the shadow ladder in
 *      September; the rim does the edge and the blur does the depth.
 *
 * ── WHAT IT STILL REFUSES TO DO ────────────────────────────────────────────
 *
 * The reference carries a wall of customer testimonials, "what our clients are
 * saying", and a before/after table whose numbers ($44K becoming $118,000) are
 * invented. We have no customers to quote and no right to promise a close
 * rate, so: no logos-as-customers, no usage counts, no testimonials, and a
 * comparison section that contrasts THE WORK rather than the results. The
 * stat band holds four facts checkable from this repository and the connector
 * count is computed from CONNECTOR_CATALOG, so the page cannot claim an
 * integration the product does not ship.
 *
 * A landing page is the cheapest place in a product to lie and the most
 * expensive place to be caught.
 */
export const metadata = {
  title: "Namzilabs — one number, from every tool you already use",
  description:
    "Namzilabs reads Calendly, Close, Instantly, Google Sheets and more, reconciles the overlap between them, and gives you one figure you can defend — with the receipts for how it got there.",
};

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

/**
 * The three steps, each with its own drawing.
 *
 * NUMBERED, because this genuinely is a sequence — you cannot build a metric
 * before connecting a tool — and numbering something that is not a sequence is
 * decoration.
 */
const STEPS: Array<{ title: string; body: string; shot: () => React.ReactNode }> = [
  {
    title: "Connect your tools",
    body: "Sign in with Google, or paste an API key. New records arrive within minutes and your history backfills behind you.",
    shot: ConnectShot,
  },
  {
    title: "Build the metric",
    body: "Drag steps onto a canvas: pull records, keep the ones that count, match the same person, total what is left.",
    shot: FlowShot,
  },
  {
    title: "Watch it stay right",
    body: "It recomputes on its own and shows its working — when it ran, what it read, what it matched, what it left out.",
    shot: ReceiptsShot,
  },
];

export default async function Home() {
  const { user } = await withAuth();
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = user ? "Go to dashboard" : "Start free";

  /* The page's one action, drawn twice — top and bottom. WHITE, NOT THE BRAND
     FILL: a #568CFF button on a deep blue ground is a shape you have to hunt
     for. The arrow in its own dark disc gives the white pill an interior, so
     it reads as an object rather than as a gap in the sky. */
  const heroCta = (
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
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PillNav signedIn={Boolean(user)} />

      <main id="main" className="flex-1">
        {/* ==== Hero ======================================================= */}
        {/* NO `overflow-hidden` HERE, and it is worth a line because putting it
             back is the obvious tidy-up. The product window hangs out of the
             bottom of this section on purpose — that overlap is what makes it
             read as sitting in FRONT of the page rather than as another block
             stacked on it — and `overflow-hidden` cut it off at the seam. */}
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
              <span className="block">See all your data</span>
              <span className="mt-1 block text-right sm:mt-2">in one place</span>
            </h1>

            <div className="mt-12 flex flex-col gap-10 sm:mt-14 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
              <p className="max-w-md text-md leading-relaxed text-white/90 sm:text-lg">
                Your calendar, your CRM, your outreach tool and your payment processor each answer a different half of
                the same question. Namzilabs reads all of them, matches the records that are the same person twice
                over, and builds the metric none of them can — with the arithmetic shown underneath it.
              </p>

              <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                {heroCta}
                <p className="text-sm text-white">Read-only access. Disconnect any tool and keep what it sent.</p>
              </div>
            </div>

            {/* ---- Reads from: the honest logo wall ---------------------- */}
            <div className="mt-14 sm:mt-16">
              {/* SENTENCE CASE, NOT TRACKED-OUT CAPITALS. A capitalised eyebrow
                  over every heading is the single commonest tell of a page
                  nobody art-directed, and this page had five of them. The
                  reference uses plain sentence-case labels; so does this now.

                  FULL WHITE, not /80, and that part is measured rather than
                  chosen: at /80 this line sits at 3.89:1 on the brightened sky
                  where 4.5 is the bar. `data-hero-label` is what
                  `landing-check` samples, so the hook cannot be lost to a
                  restyle the way a `.uppercase.tracking-widest` selector
                  silently would be. */}
              <p data-hero-label className="text-sm font-medium text-white">
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
             * It measured right in the source and wrong in the browser.
             */}
            <figure className="relative z-10 mt-14 -mb-40 sm:mt-16 sm:-mb-48">
              <div className="aspect-[4/3] w-full sm:aspect-video">
                <AppWindow />
              </div>
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
          {/* THE BAND SPANS THE PAGE RATHER THAN SHARING THE ROW, and the
              reason is a wrap. Beside a 24rem heading column it had about
              640px for four columns — 145px each — and "Recompute cadence"
              broke onto a second line while its three neighbours stayed on
              one, so the row of labels ran ragged and the figures above them
              stopped sitting on a line. Full width gives each fact ~270px,
              which fits the longest label twice over and makes the one loud
              row on this half of the page actually loud. */}
          <div className="grid gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end lg:gap-x-16">
            <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
              Built to be argued with.
            </h2>
            <p className="text-md leading-relaxed text-muted-foreground">
              Every figure shows its working, so the answer to &ldquo;where did that come from?&rdquo; is a click
              rather than an afternoon.
            </p>
          </div>

          <div className="mt-10">
            {/**
             * THE FACTS, ON THE SKY — the first time the blue comes back, and
             * early enough that the page reads as having a colour rather than
             * as a white document with a blue hat.
             *
             * `.sky-panel`, NOT `.sky-card`, and the difference is measured.
             * `.sky-card` opens out to #3F73E6 at its foot, where white sits at
             * 4.36:1 — fine for the closing call to action, whose type is all
             * in the top half over the deep end, and wrong here, where a row of
             * 14px labels runs along the bottom edge. The panel never opens
             * past #2B53AE, where the same ink is 7.1:1.
             */}
            <dl className="sky-panel grid grid-cols-2 gap-x-8 gap-y-10 overflow-hidden rounded-frame p-8 sm:grid-cols-4 sm:rounded-3xl sm:p-10">
              {FACTS.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="sr-only">{f.label}</dt>
                  <dd>
                    {/* `text-nowrap`: "Read-only" is the one figure here that
                        is a word rather than a number, and a hyphen is a break
                        opportunity — it split into "Read-" / "only" the first
                        time this row was measured. */}
                    <span className="stat-numeral block text-nowrap text-display-lg leading-none text-white">
                      {f.figure}
                    </span>
                    <span className="mt-2 block text-sm text-white/85">{f.label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ==== The problem ================================================ */}
        {/**
         * THE SECTION EVERYTHING AFTER IT DEPENDS ON. "One number you can
         * defend" only lands on somebody who already feels the disagreement;
         * for everybody else the page opened with an answer to a question they
         * had not been asked.
         *
         * It is deliberately NOT the reconciliation argument — that is the
         * section below, and making it twice would flatten both. This is about
         * there being nowhere to stand: ten tools, ten correct answers, ten
         * separate logins, and no way to put two of them in one sentence.
         */}
        <section id="problem" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            {/* THE HEADING AND ITS PARAGRAPH NOW SIT SIDE BY SIDE, which is the
                one change this section needed: the heading column was 60% of a
                1152px page and the right-hand 40% held nothing at all, so the
                section opened with half a screen of empty white. */}
            {/* THE HEADING COLUMN WAS TOO NARROW FOR ITS OWN COPY. At 29rem
                for the paragraph the heading had ~624px, and "No way to put
                them in one sentence." needs about 860 at 48px — so the line
                that was written as one broke after "in", and the `<br />`
                above it produced a four-line heading with two ragged
                fragments. Shorter copy AND a wider column, because either one
                alone leaves it a word away from breaking again. */}
            <div className="grid gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-end lg:gap-x-12">
              <h2 className="font-display text-balance text-display-lg font-semibold leading-tight text-foreground">
                Ten tools. Ten dashboards.
                <br />
                No way to add them up.
              </h2>
              <p className="text-md leading-relaxed text-muted-foreground">
                Whether you are a company or one person with an audience, the work runs on about ten pieces of
                software, and every one of them ships analytics for its own slice. They are all correct. None of them
                can see the others — so answering what a campaign earned, or what a meeting costs, means exporting
                four CSVs and hoping the names line up.
              </p>
            </div>
            <div className="mt-12">
              <ProblemGrid />
            </div>
          </div>
        </section>

        {/* ==== The receipts =============================================== */}
        <section id="proof" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-3xl">
            <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
              Three tools. Three answers.
              <br />
              One you can defend.
            </h2>
            <p className="mt-6 text-md leading-relaxed text-muted-foreground">
              None of them are lying. Calendly counts the invite, Close counts what a rep logged, the sheet counts
              what somebody typed on Friday. The disagreement is real, and the only useful answer is the one that
              shows how it was resolved.
            </p>
          </div>

          {/* THE ARGUMENT AT FULL WIDTH. It used to be a 460px card in the
              right-hand column — the most important claim on the page, typeset
              smaller than the paragraph beside it. */}
          <div className="mt-12">
            <Reconcile />
          </div>
        </section>

        {/* ==== How it works =============================================== */}
        {/**
         * THE SECOND BLUE ANCHOR, and the one that earns it: three pictures of
         * the product, which is what this section was missing entirely. Each
         * card is an opaque white face rather than a translucent one — a
         * drawing of the app inside a 10%-white pane is a drawing of the app
         * with a blue wash over it, since every border in there is `--border`
         * and every tile is `--card`.
         */}
        <section id="how" className="sky-panel scroll-mt-28 overflow-hidden">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="max-w-3xl">
              <h2 className="font-display text-display-lg font-semibold leading-tight text-white">
                Connected on Monday.
                <br />
                Defensible by Friday.
              </h2>
              <p className="mt-6 text-md leading-relaxed text-white/85">
                Three steps, and none of them involve a warehouse, a nightly export or a line of SQL.
              </p>
            </div>

            {/**
             * SUBGRID, AND THE MISALIGNMENT IT FIXES.
             *
             * Each card is words over a picture, and the three sets of words
             * wrap to different depths while the three pictures have different
             * natural heights. Laid out as three independent flex columns the
             * cards ended up the same height — the grid stretches them — but
             * the WELLS inside them started at three different y positions,
             * about 30px apart, which reads as three cards that were each
             * nudged by hand.
             *
             * `grid-rows-subgrid` makes all three cards share the SAME two row
             * tracks: the text row is as tall as the deepest paragraph and the
             * well row takes what is left, so every heading, every paragraph
             * and every picture starts on the same line across the row. The
             * alternative — a hand-tuned `min-h` on the paragraph — is a number
             * that is right at one breakpoint and wrong at the next.
             */}
            <ol className="mt-12 grid gap-5 md:grid-cols-3 md:grid-rows-[auto_1fr]">
              {STEPS.map((step, i) => {
                const Shot = step.shot;
                return (
                  <li
                    key={step.title}
                    className="glass-solid flex flex-col overflow-hidden rounded-frame sm:rounded-3xl md:row-span-2 md:grid md:grid-rows-subgrid"
                  >
                    <div className="flex flex-col gap-2 p-5 sm:p-6">
                      <span className="flex items-center gap-2.5">
                        {/* `--foreground` ON `--background`, not a pinned
                            near-black disc: on the dark card that was a black
                            circle on a nearly black face, so all anybody saw
                            was a floating numeral. The disc has to invert with
                            the card it is printed on. */}
                        <span className="stat-numeral flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs leading-none text-background">
                          {i + 1}
                        </span>
                        <h3 className="text-lg font-semibold tracking-tight text-foreground">{step.title}</h3>
                      </span>
                      {/* THE TOKENS, NOT PINNED NEUTRALS. These were
                          `text-neutral-950` and `text-neutral-700` on the
                          reasoning that the card never follows the theme — and
                          the card turned out to be the one blue-ground object
                          that has to, because it carries a picture of the
                          product. See `.dark .glass-solid`. */}
                      <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                    </div>

                    {/* The drawing sits in a well below the words — inset,
                        clipped, and bottom-bleeding, so each card reads as a
                        caption over a window rather than as text above a
                        picture. `min-h-0` because a grid track will not let a
                        child shrink below its content otherwise, which is how
                        the tallest drawing pushes the row past the card. */}
                    <div className="min-h-0 px-3 pb-3 sm:px-4 sm:pb-4">
                      <Shot />
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* ==== By hand, or not ============================================ */}
        <section id="compare" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
              The same question, two ways.
            </h2>
            <p className="mt-6 text-md leading-relaxed text-muted-foreground">
              Nobody is promised a close rate here — no software can honestly do that. What changes is the work
              between the question and the answer.
            </p>
          </div>
          <div className="mt-12">
            <Compare />
          </div>
        </section>

        {/* ==== Ask your AI ================================================ */}
        {/**
         * NOT A ROADMAP. Namzilabs ships an MCP server at `/api/mcp` with six
         * tools and a `use_ai_assistants` permission deciding who in a
         * workspace may point an assistant at it, so every claim here is about
         * something that works today.
         *
         * The argument is narrow on purpose: an assistant with no numbers
         * answers "why did close rate drop" with seasonality and lead quality —
         * fluent, unfalsifiable, useless. The same assistant with read access
         * to your published metrics answers it with the two figures that moved
         * and the one that did not.
         */}
        <section id="ai" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="sky-panel overflow-hidden rounded-frame p-7 sm:rounded-3xl sm:p-10 lg:p-12">
              <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16">
                <div>
                  <h2 className="font-display text-display-lg font-semibold leading-tight text-white">
                    Opinions are cheap.
                    <br />
                    Give it the numbers.
                  </h2>
                  <p className="mt-6 max-w-lg text-md leading-relaxed text-white/85">
                    Connect Claude or ChatGPT to your workspace over MCP and it reads your published metrics
                    directly — the same figures on the same board, not a screenshot you pasted and not a guess. Ask
                    it what changed, and the answer arrives with the arithmetic attached.
                  </p>
                  <p className="mt-4 max-w-lg text-md leading-relaxed text-white/85">
                    Read-only, scoped to one workspace, and switched on per person — so an assistant can analyse
                    everything it is shown and change nothing.
                  </p>
                  <ul className="mt-8 flex flex-wrap gap-2">
                    {["list_metrics", "get_metric", "get_metric_days", "list_sources"].map((t) => (
                      /* The real tool names, because somebody evaluating this
                         will want to know exactly what an assistant can call —
                         and because naming them is a claim this repo can be
                         checked against (`src/lib/mcp/tools`). */
                      <li
                        key={t}
                        className="glass-card stat-numeral rounded-full px-3 py-1.5 text-xs text-white"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* The panel keeps its own opaque ground for the same reason
                    the step cards do: it is a drawing of a conversation inside
                    the product, and the product is not translucent. */}
                <div className="glass-solid overflow-hidden rounded-frame p-3 sm:rounded-3xl sm:p-4">
                  <AiPanel />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ==== Integrations =============================================== */}
        <section id="integrations" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,29rem)] lg:items-end lg:gap-x-16">
            <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
              {CONNECTOR_CATALOG.length} tools, read directly.
            </h2>
            <p className="text-md leading-relaxed text-muted-foreground">
              No warehouse in between, no nightly export to babysit. Namzilabs talks to each tool&rsquo;s own API and
              keeps its copy current. Missing one? A custom webhook takes events from anything that can POST.
            </p>
          </div>
          <div className="mt-12">
            <ToolGrid />
          </div>
        </section>

        {/* ==== Questions ================================================== */}
        <section id="faq" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="grid gap-y-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-x-16">
              <div>
                <h2 className="font-display text-display-lg font-semibold leading-tight text-foreground">
                  Before you
                  <br />
                  connect a CRM.
                </h2>
                <p className="mt-5 text-md leading-relaxed text-muted-foreground">
                  The questions worth asking of anything you are about to give read access to.
                </p>
              </div>
              <Faq />
            </div>
          </div>
        </section>

        {/* ==== Closing ==================================================== */}
        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          {/* The sky again, this time as an object rather than as a ground.
              `.sky-card` here rather than `.sky-panel` because the type is all
              in the top half — this is the one place the brighter foot is
              right, since nothing but air sits on it. */}
          <div className="sky-card overflow-hidden rounded-frame px-6 py-16 text-center sm:rounded-3xl sm:px-10 sm:py-20">
            <h2 className="font-display mx-auto max-w-2xl text-display-lg font-semibold leading-tight text-white">
              Stop reconciling by hand.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-md leading-relaxed text-white/85 sm:text-lg">
              Connect one tool and build your first metric in an afternoon.
            </p>
            <div className="mt-9 flex justify-center">{heroCta}</div>
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
