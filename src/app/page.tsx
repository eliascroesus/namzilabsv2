import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ArrowRight } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { AppWindow } from "@/components/marketing/app-window";
import { Clouds, Pipes } from "@/components/marketing/pipes";
import { Reveal } from "@/components/marketing/reveal";
import { AiPanel } from "@/components/marketing/ai-panel";
import { PillNav } from "@/components/marketing/pill-nav";
import { BrandMark } from "@/components/marketing/brand-mark";
import { ProblemGrid } from "@/components/marketing/problem";
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
 * THE HERO'S PILL — NEAR-BLACK, because the sky under it is daylight again.
 *
 * It was white for exactly as long as the hero was a night sky, where a
 * near-black button would have been a hole. On a bright cloud photograph the
 * reverse holds and by a wider margin: white-on-white had the button
 * dissolving into the clouds. The closing card keeps the WHITE version, and
 * that is not an inconsistency — it sits on a deep blue card, which is the one
 * dark ground left on the page.
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
      className="lift-md group inline-flex h-13 items-center gap-2 rounded-full bg-neutral-950 pl-7 pr-2 text-button font-semibold text-white transition-transform duration-(--duration-fast) ease-(--ease-standard) hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {children}
      {/* The disc gives the pill an interior, so it reads as an object rather
          than as a lozenge of ink. The arrow nudges on hover — the one moving
          thing on the page that answers a pointer. */}
      <span className="flex size-9 items-center justify-center rounded-full bg-white/15">
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
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-medium text-brand-800">{eyebrow}</p>
      <h2 className="font-marketing mt-3 text-display-lg font-bold leading-[1.08] tracking-tight text-balance text-foreground">
        {title}
      </h2>
      {blurb && <p className="mt-5 text-md leading-relaxed text-muted-foreground">{blurb}</p>}
    </Reveal>
  );
}

export default async function Home() {
  const { user } = await withAuth();
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = user ? "Go to dashboard" : "Start free";

  return (
    <div className="lander flex min-h-dvh flex-col bg-background">
      <PillNav signedIn={Boolean(user)} />

      <main id="main" className="flex-1">
        {/* ==== Hero ======================================================= */}
        {/**
         * THE COMPOSITION, AND WHY IT IS BUILT IN THIS ORDER.
         *
         * Three layers, back to front: the sky, the PIPES, and the dashboard.
         * The pipes run down behind the window and stop at it, which is the
         * whole idea — the connector marks fall out of the sky, down the
         * tubes, and arrive in the board. The reference this came from
         * (wissly.framer.website) runs app icons down a bamboo chute because
         * bamboo suits an education brand; this page has a literal version of
         * that picture available to it, so it uses the literal one.
         *
         * THE WINDOW HAS TO OVERLAP THE PIPES, not sit under them. If the
         * tubes ended above the card the field reads as a decorative border
         * and the card as an unrelated object; ending BEHIND it is what makes
         * the two one picture. `-mt-*` on the figure and `z-10` do that, and
         * the pipes' own heights are cut so none of them pokes out below.
         */}
        <section className="cloud-sky relative overflow-x-clip px-5 pb-16 pt-24 sm:px-8 sm:pb-20 sm:pt-28 lg:pt-32">
          <div className="mx-auto w-full max-w-6xl">
            <div className="text-center">
              {/**
               * NEAR-BLACK ON A BRIGHT SKY, and pinned rather than tokenised.
               * The sky is a photograph — the same picture for everybody — so
               * `--foreground` would render this headline white on white the
               * moment a dark-theme visitor arrived. It is the same rule the
               * connector chips follow and the opposite of the one the rest of
               * the page follows, because the rest of the page sits on a
               * ground that does follow the theme.
               */}
              <h1 className="font-marketing text-balance text-[clamp(2.75rem,7.6vw,6.75rem)] font-bold leading-[0.95] tracking-[-0.03em] text-neutral-950">
                <span className="sm:block">Analyze all your data</span>{" "}
                <span className="sm:block">in one place.</span>
              </h1>

              <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-neutral-800">
                Build any metric you can describe — like Zapier, but for your data — and find every bottleneck in your
                business.
              </p>

              <div className="mt-10 flex justify-center">
                <Cta href={cta}>{ctaLabel}</Cta>
              </div>
            </div>

            {/* ---- the board, and the pipes running into it ------------- */}
            {/**
             * THE PIPES LIVE INSIDE THE FIGURE, not in a box above it, and
             * that is what makes the composition one object. Positioned
             * against the figure, `top: 36%` is 36% of the DASHBOARD's height —
             * so the runs enter its sides at a fixed point on the card however
             * tall the card gets, instead of at a guessed distance from
             * something else. They reach 12vw past the figure's edges, which
             * clears the viewport on a centred `max-w-6xl`; the section clips
             * the overflow.
             */}
            <div className="relative mt-12 sm:mt-14">
              {/* `max-w-5xl`, NOT the container's `max-w-6xl`. The chutes hang
                  off this box's edges, so its width decides whether there is
                  anywhere for them to be: at 72rem on a 1440 laptop there were
                  144px outside it and the whole field rendered behind the card.
                  64rem leaves 208, which is a chute's mouth plus the gap its
                  marks fly across. */}
              <figure className="relative mx-auto max-w-5xl -mb-40 sm:-mb-48">
                {/* Behind the chutes, then the chutes, then in front of them —
                    the front layer is the one that puts the pipes in a scene
                    rather than on a backdrop. */}
                <Clouds layer="behind" />
                <Pipes />
                <Clouds layer="front" />

                {/**
                 * THE OVERLAP, AND THE ARITHMETIC BEHIND IT.
                 *
                 * How far the window hangs below the sky is `|mb| - section
                 * pb`, and the section's bottom padding is what makes that
                 * subtraction happen at all: with `pb-0` the figure's negative
                 * bottom margin COLLAPSES THROUGH the section and becomes the
                 * section's own margin, so the sky ends level with the window
                 * and the overlap this composition is built on silently does
                 * nothing. Correct in the source, absent in the browser —
                 * which is why `pnpm landing` asserts the gap in pixels.
                 */}
                {/* `data-product-window` is what `landing-check` measures the
                    ratio of. It used to find this by taking the figure's FIRST
                    CHILD, which was true until the pipes became the first child
                    and the check started measuring a 7rem strip — correctly
                    failing, but for a reason that had nothing to do with the
                    window. A hook that depends on sibling order is a hook that
                    breaks the day the composition changes. */}
                {/* `product-shot` paints `/dashboard.png` over the drawn board
                    through an `::after`. Missing file, nothing painted, drawing
                    shows — see the note in globals.css. `AppWindow` stays in
                    the markup on purpose: it IS the fallback. */}
                <div
                  data-product-window
                  className="product-shot lift-lg relative z-10 aspect-[4/3] w-full overflow-hidden rounded-3xl bg-neutral-950 sm:aspect-video"
                >
                  <AppWindow />
                </div>

                <figcaption className="sr-only">
                  The Namzilabs dashboard: leads, booked leads, calls showed, customers, revenue and average order
                  value, over a weekly revenue chart and a conversion funnel — each figure recomputed from the tools it
                  reads.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ==== The facts were here, and the owner took them out ========= */}
        {/* A row of four figures — 32 tools / 10 min / 0 SQL / read-only — used
            to sit between the hero and the problem. They were true and
            checkable, and they were also the fourth thing on the page making a
            claim before anybody had been told what the product does. The three
            worth keeping are now said where they mean something: the tool count
            in the marquee and in the integrations heading, the access model
            under the button and in the FAQ, and the recompute cadence inside
            step three, where it is a feature rather than a statistic. */}

        {/* ==== The problem ================================================ */}
        {/**
         * THE SECTION EVERYTHING AFTER IT DEPENDS ON. "One number you can
         * defend" only lands on somebody who already feels the disagreement;
         * for everybody else the page opened with an answer to a question they
         * had not been asked.
         */}
        {/* THE TOP PADDING PAYS FOR THE PRODUCT WINDOW hanging into this
            section — 112px of overlap plus a section's worth of air. It moved
            here from the stat band when that came out; without it the window
            lands on this section's heading, and `pnpm landing` measures that
            gap in pixels precisely because the source cannot show it. */}
        <section id="problem" className="scroll-mt-28 px-5 pb-20 pt-44 sm:px-8 sm:pb-28 sm:pt-56">
          <div className="mx-auto w-full max-w-6xl">
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
        <section id="proof" className="glow-top mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="The receipts"
            title="Three tools. Three answers. One you can defend."
            blurb="None of them are lying — they are counting different things. The only useful answer is the one that shows how it was resolved."
          />
          <Reveal className="mt-14" delay={80}>
            <Reconcile />
          </Reveal>
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
        <section id="how" className="lander-band scroll-mt-28 overflow-x-clip">
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
          <Reveal className="mt-14" delay={80}>
            <Compare />
          </Reveal>
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
        <section id="integrations" className="lander-band scroll-mt-28">
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
        <section id="pricing" className="glow-top mx-auto w-full max-w-6xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="Pricing"
            title="Priced on tools, not on people"
            blurb="What costs us money is sweeping other companies' APIs, not the number of people looking at the answer — so the seats are generous and the ladder is built on how much you connect."
          />
          <Reveal className="mt-14" delay={80}>
            <Pricing cta={cta} />
          </Reveal>
        </section>

        {/* ==== Questions ================================================== */}
        <section id="faq" className="mx-auto w-full max-w-4xl scroll-mt-28 px-5 py-20 sm:px-8 sm:py-28">
          <Head
            eyebrow="Questions"
            title="Before you connect a CRM"
            blurb="The questions worth asking of anything you are about to give read access to."
          />
          <Reveal className="mt-14" delay={80}>
            <Faq />
          </Reveal>
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

      {/* ==== Footer ===================================================== */}
      {/**
       * A REAL FOOTER, which this page did not have. It was one line — a
       * copyright and three links — and a one-line footer is the clearest
       * signal a site can send that nobody finished it. The reference closes on
       * a proper set of columns, and it costs nothing but the links that
       * already exist elsewhere on the page.
       *
       * EVERY LINK HERE GOES SOMEWHERE THAT EXISTS. No "Careers", no "Press",
       * no "Changelog" — a footer padded with dead anchors is worse than a
       * short one, and the `/docs`, `/terms` and `/privacy` routes plus this
       * page's own sections are the honest inventory.
       */}
      <footer className="lander-band border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] lg:gap-8">
            <div className="max-w-xs">
              <span className="font-marketing flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
                <BrandMark className="size-6 shrink-0" />
                Namzilabs
              </span>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                One number, from every tool you already use — with the arithmetic shown underneath it.
              </p>
            </div>

            {[
              {
                title: "Product",
                links: [
                  { href: "#how", label: "How it works" },
                  { href: "#ai", label: "Ask your AI" },
                  { href: "#integrations", label: "Integrations" },
                  { href: "#pricing", label: "Pricing" },
                ],
              },
              {
                title: "Learn",
                links: [
                  { href: "#problem", label: "The problem" },
                  { href: "#proof", label: "The receipts" },
                  { href: "#faq", label: "Questions" },
                  { href: "/docs", label: "Docs" },
                ],
              },
              {
                title: "Legal",
                links: [
                  { href: "/terms", label: "Terms" },
                  { href: "/privacy", label: "Privacy" },
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <p className="text-sm font-semibold text-foreground">{col.title}</p>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="inline-flex min-h-6 items-center rounded-control text-sm text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground">
            <span>&copy; {new Date().getFullYear()} Namzilabs</span>
            <span>Read-only access to every tool it reads.</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
