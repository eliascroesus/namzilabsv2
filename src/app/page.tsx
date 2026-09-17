import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ArrowRight } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { AppWindow } from "@/components/marketing/app-window";
import { ToolMarquee } from "@/components/marketing/marquee";
import { AiPanel } from "@/components/marketing/ai-panel";
import { PillNav } from "@/components/marketing/pill-nav";
import { ProblemGrid } from "@/components/marketing/problem";
import { NightSky } from "@/components/marketing/night-sky";
import { Pricing } from "@/components/marketing/pricing";
import { FeatureRow } from "@/components/marketing/feature-row";
import { ConnectShot } from "@/components/marketing/connect-shot";
import { FlowShot } from "@/components/marketing/flow-shot";
import { ReceiptsShot } from "@/components/marketing/receipts-shot";
import { Reconcile } from "@/components/marketing/reconcile";
import { Compare } from "@/components/marketing/compare";
import { Faq } from "@/components/marketing/faq";
import { ToolGrid } from "@/components/marketing/tool-grid";

/**
 * THE FRONT DOOR.
 *
 * ── WHY THIS IS THE SECOND REBUILD IN A WEEK ───────────────────────────────
 *
 * The first one fixed the page's structure and kept the app's clothes, and the
 * owner's verdict was that it "looks like an AI website". That is a fair
 * reading and it is worth writing down exactly what was wrong, because every
 * individual decision in it was defensible:
 *
 *   - ONE TYPEFACE. Inter at three weights, separated only by size. Correct
 *     for a dashboard, and the reason a marketing page reads as generated:
 *     size is the only typographic idea a page has when nobody chose a face.
 *   - A SATURATED BLUE HERO WITH WHITE TYPE ON IT. The most-generated hero on
 *     the web.
 *   - EVERYTHING LEFT-FLUSH, EVERY HEADLINE A CLEVER TWO-PART SENTENCE.
 *     "Three tools. Three answers. One you can defend." is four of those in a
 *     row, and the rhythm is unmistakable.
 *   - EVERY OBJECT THE SAME CARD. One radius, one border, no shadow, pictures
 *     shrunk into equal thirds.
 *
 * ── WHAT THIS ONE DOES INSTEAD ─────────────────────────────────────────────
 *
 * The brief was the reference the owner sent (themochi.app), and the four
 * things that actually carry it:
 *
 *   1. A DISPLAY FACE. Outfit at 700 — geometric, single-storey `g`, straight
 *      tail on the `y` — against Inter for everything that is read rather than
 *      looked at. Two families, obviously different, which is the oldest trick
 *      there is and the one the previous version refused.
 *   2. DAYLIGHT, NOT A BLUE FILL. A bright sky with drawn cumulus and the
 *      headline in NEAR-BLACK on top of it. Higher contrast than white-on-navy
 *      and far less common.
 *   3. SHORT, CENTRED HEADLINES. "Your tools disagree. This settles it." is
 *      six words. The old hero's supporting paragraph alone was sixty.
 *   4. PICTURES THAT RUN OFF THE EDGE. Each feature row puts its screenshot at
 *      128% of its column, past the margin — a window onto the product rather
 *      than an illustration of it, and legible because it is large.
 *
 * ── WHAT IT STILL REFUSES ──────────────────────────────────────────────────
 *
 * The reference carries a testimonial wall, client quotes, a "trusted by" row
 * of real customer avatars, and a before/after table whose figures ($44K
 * becoming $118,000) are invented. We have no customers to quote and no right
 * to promise anybody a close rate. So the social-proof slot holds the tools we
 * READ, labelled as such; the comparison contrasts the WORK rather than the
 * results; the FAQ answers only what this repository can be checked against;
 * and the connector count is computed from CONNECTOR_CATALOG so the page
 * cannot claim an integration the product does not ship.
 */
export const metadata = {
  title: "Namzilabs — one number, from every tool you already use",
  description:
    "Namzilabs reads Calendly, Close, Instantly, Google Sheets and more, reconciles the overlap between them, and gives you one figure you can defend — with the receipts for how it got there.",
};

/**
 * The stat band. Every one of these four is a fact this repository can be
 * checked against rather than a customer count: the integration total is
 * COMPUTED so it cannot fall behind the catalogue, ten minutes is the sweep's
 * real cadence (`materialize-stale`), and the other two are claims the product
 * either honours or does not.
 */
const FACTS: Array<{ figure: string; label: string }> = [
  { figure: `${CONNECTOR_CATALOG.length}`, label: "Tools it reads" },
  { figure: "10 min", label: "Recompute cadence" },
  { figure: "0", label: "Lines of SQL" },
  { figure: "Read-only", label: "Access it asks for" },
];

/**
 * THE HERO'S PILL — WHITE, because the sky under it is night.
 *
 * It was near-black for exactly as long as the hero was daylight. On a #070B18
 * sky a near-black button is a hole, and white is the only fill with a
 * guaranteed contrast against every stop the button could land on.
 *
 * NOT `buttonVariants`. The kit's `lg` button is a 40px control built for a
 * form row, and this is a 52px marketing pill with a disc on the end of it —
 * borrowing the app's control and then overriding its height, radius, padding
 * and every colour is how a component ends up with a variant that exists for
 * one caller. The reference uses the same shape in six places and so does
 * this page.
 */
function Cta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="lift-md group inline-flex h-13 items-center gap-2 rounded-full bg-white pl-7 pr-2 text-button font-semibold text-neutral-950 transition-transform duration-(--duration-fast) ease-(--ease-standard) hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {children}
      {/* The disc gives the pill an interior, so it reads as an object rather
          than as a lozenge of ink. The arrow nudges on hover — the one moving
          thing on the page that answers a pointer. */}
      <span className="flex size-9 items-center justify-center rounded-full bg-neutral-950/10">
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-(--duration-fast) ease-(--ease-standard) group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </a>
  );
}

/** A centred section head — the reference's shape, and the page's default. */
function Head({ eyebrow, title, blurb }: { eyebrow: string; title: React.ReactNode; blurb?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-medium text-brand-800">{eyebrow}</p>
      <h2 className="font-marketing mt-3 text-display-lg font-bold leading-[1.08] tracking-tight text-balance text-foreground">
        {title}
      </h2>
      {blurb && <p className="mt-5 text-md leading-relaxed text-muted-foreground">{blurb}</p>}
    </div>
  );
}

export default async function Home() {
  const { user } = await withAuth();
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = user ? "Go to dashboard" : "Start free";

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PillNav signedIn={Boolean(user)} />

      <main id="main" className="flex-1">
        {/* ==== Hero ======================================================= */}
        {/* NO `overflow-hidden` ON THE SECTION. The product window hangs out of
            the bottom on purpose — that overlap is what makes it read as
            sitting in FRONT of the page rather than as another block stacked
            on it. The clouds do their own clipping from the inside. */}
        <section className="night-sky relative px-5 pb-16 pt-32 sm:px-8 sm:pb-20 sm:pt-36 lg:pt-44">
          <NightSky />

          <div className="mx-auto w-full max-w-5xl text-center">
            {/**
             * SIX WORDS, TWO LINES, CENTRED.
             *
             * The line that was here ran "SEE ALL YOUR DATA / IN ONE PLACE" in
             * capitals across the full width, with a sixty-word paragraph under
             * it. It said nothing a competitor could not say.
             *
             * This one states the problem and the fix in the smallest number of
             * words either fits in: the tools disagree — everybody with more
             * than three of them knows this — and here is the thing that ends
             * the argument. Written in sentence case, because it is a sentence.
             */}
            {/* THE SPANS ONLY BREAK FROM `sm` UP, and that is a phone bug
                rather than a preference. `text-banner` bottoms out at 44px, and
                "Your tools disagree." set at 44px in Outfit Bold is about
                460px wide — on a 390px screen with 40px of gutter it pushed the
                document to 414px and the whole page scrolled sideways, which
                `pnpm landing` catches and no source check could. Forced as
                blocks the line cannot wrap out of trouble; allowed to flow, it
                sets itself in three or four and `text-balance` keeps them even. */}
            {/* WHITE, NOT `--foreground`. Every word in this hero sits in the
                top half of a sunrise, which is near-black at the top and brand
                blue by the time the last line of it lands — a ground that does
                NOT follow the theme. `--foreground` would render this headline
                in near-black on near-black for a light-theme visitor. */}
            <h1 className="font-marketing text-balance text-banner font-bold leading-[0.95] tracking-[-0.03em] text-white">
              <span className="sm:block">Your tools disagree.</span>{" "}
              <span className="sm:block">This settles it.</span>
            </h1>

            <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-white/80">
              Namzilabs reads every tool you already use, matches the records that are the same person twice over, and
              gives you one figure with the arithmetic attached.
            </p>

            <div className="mt-9 flex flex-col items-center gap-4">
              <Cta href={cta}>{ctaLabel}</Cta>
              {/* The three objections somebody has before connecting a CRM,
                  answered before they are asked and in six words. */}
              <p className="text-sm font-medium text-white">
                Read-only access · No warehouse · No SQL
              </p>
            </div>

            {/* ---- Reads from: the honest logo wall ---------------------- */}
            <div className="mt-16 sm:mt-20">
              {/* `data-hero-label` is the hook `landing-check` samples. It is a
                  data attribute rather than a class selector because the
                  previous one — `.uppercase.tracking-widest` — described how
                  the thing looked, and stopped matching the moment the
                  tracked-out capitals came off. */}
              <p data-hero-label className="text-sm font-medium text-white">
                Reads from {CONNECTOR_CATALOG.length} tools, including
              </p>
              <div className="mt-5">
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
             * margin, so the sky ends level with the window and the overlap
             * this whole composition is built on silently does nothing. It
             * measured right in the source and wrong in the browser, which is
             * why `pnpm landing` asserts the gap in pixels.
             */}
            <figure className="relative z-10 mt-14 -mb-40 sm:mt-16 sm:-mb-48">
              <div className="lift-lg aspect-[4/3] w-full overflow-hidden rounded-3xl sm:aspect-video">
                <AppWindow />
              </div>
              <figcaption className="sr-only">
                The Namzilabs dashboard: a board of metric tiles — meetings booked, pickup rate, speed to lead — each
                recomputed from the tools it reads.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ==== The facts ================================================== */}
        {/* The top padding pays for the window hanging into this section:
            112px of overlap plus a section's worth of air above the heading. */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-44 sm:px-8 sm:pb-28 sm:pt-56">
          <h2 className="sr-only">Namzilabs in four numbers</h2>
          {/* A PLAIN ROW, NOT FOUR CARDS. Boxing each figure would make this
              the fourth grid of bordered rectangles on the page; hairlines
              between them say the same thing for a tenth of the ink. */}
          <dl className="grid grid-cols-2 gap-y-10 sm:grid-cols-4 sm:divide-x sm:divide-border">
            {FACTS.map((f, i) => (
              <div key={f.label} className={i === 0 ? "sm:pr-6" : "sm:px-6"}>
                <dt className="sr-only">{f.label}</dt>
                <dd>
                  {/* `text-nowrap`: "Read-only" is the one figure here that is
                      a word rather than a number, and a hyphen is a break
                      opportunity — it split into "Read-" / "only" the first
                      time this row was measured. */}
                  {/* `text-nowrap` keeps "Read-only" whole — a hyphen is a
                      break opportunity and it split into "Read-" / "only" the
                      first time this row was measured. Which is exactly why it
                      has to step DOWN on a phone: 48px unbreakable in a 175px
                      half-column overflowed the page by 4px. */}
                  <span className="font-marketing block text-nowrap text-display-md font-bold leading-none tracking-tight text-foreground lg:text-display-lg">
                    {f.figure}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">{f.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ==== The problem ================================================ */}
        {/**
         * THE SECTION EVERYTHING AFTER IT DEPENDS ON. "One number you can
         * defend" only lands on somebody who already feels the disagreement;
         * for everybody else the page opened with an answer to a question they
         * had not been asked.
         */}
        <section id="problem" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Head
              eyebrow="The problem"
              title="Ten tools. Ten dashboards. No way to add them up."
              blurb="Every one of them ships analytics for its own slice, and every one of them is correct. None of them can see the others."
            />
            <div className="mt-14">
              <ProblemGrid />
            </div>
          </div>
        </section>

        {/* ==== The receipts =============================================== */}
        <section id="proof" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="The receipts"
            title="Three tools. Three answers. One you can defend."
            blurb="None of them are lying — they are counting different things. The only useful answer is the one that shows how it was resolved."
          />
          <div className="mt-14">
            <Reconcile />
          </div>
        </section>

        {/* ==== How it works =============================================== */}
        {/**
         * THREE ROWS, NOT THREE CARDS, and the flow builder finally appears on
         * the landing page. It is the most distinctive screen this product has
         * and the previous four versions of this page never showed it.
         */}
        {/* THE CLIP LIVES ON THE SECTION, NOT ON THE CONTAINER, and the
            difference is the whole effect. Clipped at `max-w-6xl` the
            screenshots stopped 144px short of the screen with white either
            side, which reads as a card that overflowed its box by accident.
            Clipped at the section they run off the EDGE OF THE PAGE, which is
            the reference's move and the thing that makes them read as windows
            onto something larger.

            `overflow-x-clip` rather than `overflow-hidden`: the latter makes
            the section a scroll container, which silently kills the
            `position: sticky` nav for the whole time it is on screen. */}
        <section id="how" className="scroll-mt-28 overflow-x-clip border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Head eyebrow="How it works" title="Connected on Monday. Defensible by Friday." />

            <div className="mt-16 flex flex-col gap-20 sm:gap-28">
              <FeatureRow
                label="Step one — connect"
                title="Sign in, and the records start arriving"
                body="Connect with Google or paste an API key. New records land within minutes and your history backfills behind you, so you are building the moment it is connected —"
                accent="you never wait for a backfill to finish."
                side="right"
              >
                <ConnectShot />
              </FeatureRow>

              <FeatureRow
                label="Step two — build"
                title="Drag four steps onto a canvas"
                body="Pull records, keep the ones that count, match the same person across two sources, total what is left. Test it against real rows before you publish it —"
                accent="no SQL, and no warehouse in between."
                side="left"
              >
                <FlowShot />
              </FeatureRow>

              <FeatureRow
                label="Step three — defend"
                title="Every figure carries its working"
                body="A published metric recomputes on its own and shows what it did: when it last ran, which sources it read, how many records it matched as the same person, and"
                accent="what it left out, and why."
                side="right"
              >
                <ReceiptsShot />
              </FeatureRow>
            </div>
          </div>
        </section>

        {/* ==== By hand, or not ============================================ */}
        <section id="compare" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="What changes"
            title="The same question, two ways"
            blurb="Nobody is promised a close rate here — no software can honestly do that. What changes is the work between the question and the answer."
          />
          <div className="mt-14">
            <Compare />
          </div>
        </section>

        {/* ==== Ask your AI ================================================ */}
        {/**
         * THE ONE DEEP-BLUE SURFACE LEFT ON THE PAGE, and it is here because
         * the owner asked for the invite board's card specifically — "the blue
         * card on invite & earn, I really like that design". The rest of the
         * page went bright to match the reference; this keeps the thing he
         * named, and being the only one of its kind is what makes it land.
         *
         * NOT A ROADMAP: Namzilabs ships an MCP server at `/api/mcp` with six
         * tools and a `use_ai_assistants` permission deciding who may point an
         * assistant at it, so every claim here is about something that works
         * today.
         */}
        <section id="ai" className="scroll-mt-28 px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="sky-panel mx-auto w-full max-w-6xl overflow-hidden rounded-3xl p-8 sm:p-12 lg:p-16">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16">
              <div>
                <p className="text-sm font-medium text-white/80">Ask your AI</p>
                <h2 className="font-marketing mt-3 text-display-lg font-bold leading-[1.08] tracking-tight text-white">
                  Opinions are cheap. Give it the numbers.
                </h2>
                <p className="mt-6 max-w-lg text-md leading-relaxed text-white/85">
                  Connect Claude or ChatGPT to your workspace over MCP and it reads your published metrics directly —
                  the same figures on the same board, not a screenshot you pasted and not a guess. Read-only, scoped to
                  one workspace, and switched on per person.
                </p>
                <ul className="mt-8 flex flex-wrap gap-2">
                  {["list_metrics", "get_metric", "get_metric_days", "list_sources"].map((t) => (
                    /* The real tool names, because somebody evaluating this
                       will want to know exactly what an assistant can call —
                       and because naming them is a claim this repo can be
                       checked against (`src/lib/mcp/tools`). */
                    <li key={t} className="glass-card stat-numeral rounded-full px-3 py-1.5 text-xs text-white">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {/* The panel keeps an opaque ground: it is a drawing of a
                  conversation inside the product, and the product is not
                  translucent. */}
              <div className="glass-solid overflow-hidden rounded-3xl p-3 sm:p-4">
                <AiPanel />
              </div>
            </div>
          </div>
        </section>

        {/* ==== Integrations =============================================== */}
        <section id="integrations" className="scroll-mt-28 border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Head
              eyebrow="Integrations"
              title={`${CONNECTOR_CATALOG.length} tools, read directly`}
              blurb="No warehouse in between, no nightly export to babysit. Missing one? A custom webhook takes events from anything that can POST."
            />
            <div className="mt-14">
              <ToolGrid />
            </div>
          </div>
        </section>

        {/* ==== Pricing ==================================================== */}
        {/**
         * THE NUMBERS IN HERE ARE A PROPOSAL AND NEED THE OWNER'S SIGN-OFF.
         * He asked for a pricing section and did not give prices; the ladder,
         * the three figures and the tool caps were chosen in `pricing.tsx` by
         * reading what this product costs to run, and every one of them is a
         * commercial decision rather than a design one. They live in a single
         * array for exactly that reason.
         */}
        <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="Pricing"
            title="Priced on tools, not on people"
            blurb="What costs us money is sweeping other companies' APIs, not the number of people looking at the answer — so the seats are generous and the ladder is built on how much you connect."
          />
          <div className="mt-14">
            <Pricing cta={cta} />
          </div>
        </section>

        {/* ==== Questions ================================================== */}
        <section id="faq" className="mx-auto w-full max-w-4xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="Questions"
            title="Before you connect a CRM"
            blurb="The questions worth asking of anything you are about to give read access to."
          />
          <div className="mt-14">
            <Faq />
          </div>
        </section>

        {/* ==== Closing ==================================================== */}
        <section className="px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="sky-card mx-auto w-full max-w-6xl overflow-hidden rounded-3xl px-6 py-20 text-center sm:px-10 sm:py-24">
            <h2 className="font-marketing mx-auto max-w-2xl text-display-lg font-bold leading-[1.08] tracking-tight text-white">
              Stop reconciling by hand.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-md leading-relaxed text-white/85 sm:text-lg">
              Connect one tool and build your first metric in an afternoon.
            </p>
            {/* WHITE ON THE BLUE, inverting the page's dark pill: a near-black
                button on a deep blue ground is a shape you have to hunt for. */}
            <div className="mt-10 flex justify-center">
              <a
                href={cta}
                className="lift-md group inline-flex h-13 items-center gap-2 rounded-full bg-white pl-7 pr-2 text-button font-semibold text-neutral-950 transition-transform duration-(--duration-fast) ease-(--ease-standard) hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {ctaLabel}
                <span className="flex size-9 items-center justify-center rounded-full bg-neutral-950/10">
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform duration-(--duration-fast) ease-(--ease-standard) group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:px-8">
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
