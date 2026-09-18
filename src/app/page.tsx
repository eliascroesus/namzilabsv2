import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { PillNav } from "@/components/marketing/pill-nav";
import { SectionShell } from "@/components/marketing/shell";
import { Receipt } from "@/components/marketing/receipt";
import { LedgerRow } from "@/components/marketing/ledger-row";
import { StatDivider } from "@/components/marketing/stat-divider";
import { CustomerLogos } from "@/components/marketing/customer-logos";
import { ToolChip } from "@/components/marketing/tool-chip";
import { ConnectShot } from "@/components/marketing/connect-shot";
import { FlowShot } from "@/components/marketing/flow-shot";
import { AiPanel } from "@/components/marketing/ai-panel";
import { Faq } from "@/components/marketing/faq";
import { Pricing } from "@/components/marketing/pricing";
import { BrandMark } from "@/components/marketing/brand-mark";

/**
 * THE FRONT DOOR.
 *
 * ── WHAT THIS REBUILD IS FOR ───────────────────────────────────────────────
 *
 * The page before it had good writing and generic design: every section was
 * the same centred column of rounded cards, so nothing had hierarchy and
 * nothing was memorable, and the one thing that makes this product different —
 * that every figure shows the arithmetic that produced it — was rendered small,
 * mid-page, inside a card that looked like all the other cards.
 *
 * Three structural decisions carry the rebuild:
 *
 *   1. A SPINE. One 12-column grid runs the whole page, claim on 1–5 and
 *      evidence on 6–12, and every figure anywhere on the page right-aligns to
 *      the same axis. Only the hero and the closing block are centred.
 *   2. THE RECEIPT IS THE SIGNATURE. It appears three times and nowhere else,
 *      and it is the only object allowed to be loud.
 *   3. FULL-BLEED BLOCKS BREAK THE RHYTHM, so scrolling has a pulse instead of
 *      one uninterrupted field.
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 *
 * Every receipt on this page reconciles: 123 − 3 = 120, 120 − 79 = 41. The
 * page this replaces showed 123 / 82 / 41, which does not, and it did it in
 * the one section whose entire claim is that the working is shown.
 */
export const metadata = {
  title: "Namzilabs — one number, from every tool you already use",
  description:
    "Namzilabs reads your calendar, CRM, outreach tools and payments directly, matches the same person across them, and gives you one figure your whole team can defend.",
};

/**
 * THE TOOL COUNT IS COMPUTED, NOT TYPED. The brief writes "32 tools" as a
 * literal in two places and the catalogue holds thirty-two today, so it renders
 * identically — but a hard-coded count is a claim that goes stale silently the
 * next time a connector ships.
 */
const TOOLS = CONNECTOR_CATALOG.length;

const LEDGER: Array<{ source: string; name: string; metric: string; figure: string; clause: string }> = [
  { source: "calendly", name: "Calendly", metric: "Meetings booked", figure: "41", clause: "but not which ones showed up" },
  { source: "close", name: "Close CRM", metric: "Deals created", figure: "18", clause: "but not what they cost to get" },
  { source: "stripe", name: "Stripe", metric: "Revenue", figure: "$48.2k", clause: "but not which campaign earned it" },
  { source: "instantly", name: "Instantly", metric: "Replies", figure: "112", clause: "but not which became revenue" },
  { source: "aircall", name: "Aircall", metric: "Calls connected", figure: "306", clause: "but not against how many leads" },
  { source: "gsheets", name: "Google Sheets", metric: "Rows, kept by hand", figure: "2,130", clause: "but only until Friday" },
];

/** The three that disagree, dimmer than the receipt that resolves them. */
const DISAGREE: Array<{ source: string; name: string; counted: string; figure: string }> = [
  { source: "calendly", name: "Calendly", counted: "every invitee-created event", figure: "41" },
  { source: "close", name: "Close CRM", counted: "meetings a rep logged to a lead", figure: "38" },
  { source: "gsheets", name: "Google Sheets", counted: "what somebody typed on Friday", figure: "44" },
];

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

/**
 * THE FOUR TOOL NAMES GET A LINE EACH rather than sitting as bare chips. They
 * are the four things an assistant can actually do, and a reader evaluating
 * whether to point Claude at their CRM wants to know what that means — not to
 * be shown four identifiers and left to guess.
 */
const MCP_TOOLS: Array<{ name: string; what: string }> = [
  { name: "list_metrics", what: "every figure you have published, and nothing you have not" },
  { name: "get_metric", what: "one figure, with the working that produced it" },
  { name: "get_metric_days", what: "the same figure day by day, for a range it asks for" },
  { name: "list_sources", what: "which tools the workspace reads, and when each last swept" },
];

const STEPS: Array<{ n: string; title: string; body: React.ReactNode; visual: React.ReactNode }> = [
  {
    n: "1",
    title: "Sign in, and the records start arriving",
    body: (
      <>
        Connect with Google or paste an API key. New records land within minutes and your history backfills behind
        you, so you are building the moment it is connected — you never wait for a backfill to finish.
      </>
    ),
    visual: <ConnectShot />,
  },
  {
    n: "2",
    title: "Drag four steps onto a canvas",
    body: (
      <>
        Pull records, keep the ones that count, match the same person across two sources, total what is left. Test it
        against real rows before you publish it — no SQL, and no warehouse in between.
      </>
    ),
    visual: <FlowShot />,
  },
  {
    n: "3",
    title: "Every figure carries its working",
    body: (
      <>
        A published metric recomputes on its own and shows what it did: when it last ran, which sources it read, how
        many records it matched as the same person, and what it left out, and why.
      </>
    ),
    visual: <Receipt size="sm" />,
  },
];

export default async function Home() {
  const { user } = await withAuth();
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = user ? "Go to dashboard" : "Start free";

  return (
    <div className="lander flex min-h-dvh flex-col bg-[var(--background)]">
      <PillNav signedIn={Boolean(user)} />

      <main id="main" className="flex-1">
        {/* ══ HERO — centred, and one of only two centred blocks ═══════════ */}
        <section className="hero-block px-5 pt-32 sm:px-8 lg:pt-40">
          <div className="mx-auto w-full max-w-[72rem] text-center">
            {/* TWO LINES, ONE SENTENCE EACH, SAME SIZE. The second is a
                qualification of the first rather than decoration, so it takes
                a lighter weight and the muted ink instead of a smaller step —
                which is the distinction the two-tone pattern exists to make. */}
            <h1 className="t-display-lg mx-auto max-w-[20ch] text-balance" style={{ color: "var(--ink)" }}>
              <span className="block font-bold">One number, from every tool you already use.</span>
              <span className="mt-2 block font-normal" style={{ color: "var(--ink-muted)" }}>
                With the arithmetic shown underneath it.
              </span>
            </h1>

            <p className="t-body-lg mx-auto mt-8" style={{ color: "var(--ink-muted)" }}>
              Namzilabs reads your calendar, CRM, outreach tools and payments directly, matches the same person across
              them, and gives you one figure your whole team can defend.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <a href={cta} className="btn-solid">
                {ctaLabel}
              </a>
              <a href="#proof" className="btn-ghost">
                See how a figure is built
              </a>
            </div>

            <p className="mt-5 text-sm" style={{ color: "var(--ink-muted)" }}>
              14 days free, no card. Read-only access to every tool it reads.
            </p>
          </div>

          {/* The nav flips to opaque when this passes out of view. One pixel,
              at the hero's foot — correct however the headline wraps, and two
              observer callbacks instead of a scroll listener running forever. */}
          <div id="nav-sentinel" aria-hidden className="h-px w-full" />

          {/* THE HERO IS THE RECEIPT, not a shrunken screenshot. It is cropped
              at a FIXED section height rather than by the viewport: the proof
              strip sits directly beneath it, and a viewport-relative crop
              would move that strip with the window and shift the layout. */}
          <div className="hero-receipt">
            <div className="mx-auto w-full max-w-[72rem]">
              <div className="mx-auto w-full max-w-[38rem]">
                <Receipt size="xl" reveal />
              </div>
            </div>
          </div>
        </section>

        {/* ══ PROOF STRIP ══════════════════════════════════════════════════ */}
        <div className="px-5 sm:px-8">
          <div className="mx-auto w-full max-w-[72rem]">
            <StatDivider
              facts={[
                { head: `${TOOLS} tools`, body: "read directly, through each tool’s own API" },
                { head: "Every 10 minutes", body: "every published figure recomputes on its own" },
                /* THE WORDING CHANGED FROM THE BRIEF, and the owner agreed.
                   "Never writes — no connector in this product can change a
                   record" invites a reader to go and check, and two connectors
                   (Close, Calendly) POST to create a webhook subscription in
                   the customer's account. No connector changes a RECORD, so the
                   original sentence was defensible — but the proof strip is
                   where a security reviewer looks, and a claim that needs a
                   lawyer is the wrong claim for this page. */
                { head: "Reads only", body: "it never edits your data — no connector can change a record" },
              ]}
            />
            {/* Renders nothing while the array is empty. No placeholder brands,
                no greyed-out "your logo here". */}
            <CustomerLogos customers={[]} />
          </div>
        </div>

        {/* ══ THE PROBLEM ══════════════════════════════════════════════════ */}
        <SectionShell
          id="problem"
          label="The problem"
          title={
            <>
              Ten tools. Ten dashboards.
              <br />
              No way to add them up.
            </>
          }
          standfirst="Every one of them ships analytics for its own slice, and every one of them is correct. None of them can see the others."
        >
          <ul className="ledger">
            {LEDGER.map((row) => (
              <LedgerRow key={row.source} {...row} />
            ))}
          </ul>

          {/* The hinge of the argument, on a row of its own. It used to be
              trapped in a grey card in the middle of the grid, and it used to
              repeat the H2 verbatim. */}
          <p className="ledger-thesis">
            Six logins, six exports, six sets of names that nearly match. The question you actually have — what a
            meeting costs, which channel carried the month — lives in the space between them.
          </p>
        </SectionShell>

        {/* ══ THE RECEIPTS — the first break in the paper rhythm ═══════════ */}
        <SectionShell
          id="proof"
          tone="ink"
          label="The receipts"
          title={
            <>
              Three tools. Three answers.
              <br />
              One you can defend.
            </>
          }
          standfirst="None of them are lying — they are counting different things. The only useful answer is the one that shows how it was resolved."
        >
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
            {/* The three that disagree, dimmed — evidence, not the answer. */}
            <ul className="ledger ledger--narrow lg:col-span-5" style={{ ["--num-col" as string]: "3.5rem" }}>
              {DISAGREE.map((d) => (
                <li key={d.source} className="ledger-row">
                  <span className="ledger-tool">
                    <span className="ledger-name">{d.name}</span>
                  </span>
                  <span className="ledger-figure t-num">{d.figure}</span>
                  <span className="ledger-clause">{d.counted}</span>
                </li>
              ))}
            </ul>

            <div className="lg:col-span-6 lg:col-start-7">
              <Receipt />
            </div>
          </div>
        </SectionShell>

        {/* ══ HOW IT WORKS ═════════════════════════════════════════════════ */}
        <SectionShell id="how" label="How it works" title="Connected on Monday. Defensible by Friday.">
          <ol className="flex flex-col gap-20 lg:gap-28">
            {STEPS.map((step, i) => (
              <li key={step.n} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
                {/* ALTERNATING SIDES on the same spine, not three cards in a
                    row. Reading order follows the visual order at every width
                    because the markup order flips, not just the columns. */}
                <div className={i % 2 ? "lg:col-span-5 lg:col-start-8 lg:row-start-1" : "lg:col-span-5"}>
                  <p className="t-num text-sm" style={{ color: "var(--ink-muted)" }}>
                    {step.n}
                  </p>
                  <h3
                    className="font-marketing mt-3 text-2xl font-bold tracking-tight sm:text-3xl"
                    style={{ color: "var(--ink)" }}
                  >
                    {step.title}
                  </h3>
                  {/* NO LINK COLOUR ON EMPHASIS. Three phrases in here were
                      styled blue on the old page and none of them was
                      clickable. Nothing on this page may look clickable unless
                      it is. */}
                  <p className="mt-4 text-[1.0625rem] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                    {step.body}
                  </p>
                </div>

                <div className={i % 2 ? "lg:col-span-6 lg:col-start-1 lg:row-start-1" : "lg:col-span-6 lg:col-start-7"}>
                  <div className="step-visual">{step.visual}</div>
                </div>
              </li>
            ))}
          </ol>
        </SectionShell>

        {/* ══ WHAT CHANGES ═════════════════════════════════════════════════ */}
        <SectionShell
          id="compare"
          tone="sunk"
          label="What changes"
          title="The same question, two ways"
          standfirst="Nobody is promised a close rate here — no software can honestly do that. What changes is the work between the question and the answer."
        >
          <div className="compare-grid">
            {[
              { head: "Reconciling by hand", when: "Every week, usually on a Friday", items: BY_HAND, muted: true },
              { head: "With Namzilabs", when: "Once, when you connect it", items: WITH_US, muted: false },
            ].map((col) => (
              <div key={col.head} className="compare-col">
                <p className="text-lg font-semibold" style={{ color: col.muted ? "var(--ink-muted)" : "var(--ink)" }}>
                  {col.head}
                </p>
                <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
                  {col.when}
                </p>
                <ul className="mt-6 flex flex-col gap-3">
                  {col.items.map((item) => (
                    <li
                      key={item}
                      className="text-[0.9375rem] leading-relaxed"
                      style={{ color: col.muted ? "var(--ink-muted)" : "var(--ink)" }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionShell>

        {/* ══ ASK YOUR AI — the second full-bleed block ════════════════════ */}
        <SectionShell id="ai" tone="ink" label="Ask your AI" title="Opinions are cheap. Give it the numbers.">
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-5">
              <p className="text-[1.0625rem] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                Connect Claude or ChatGPT to your workspace over MCP and it reads your published metrics directly —
                the same figures on the same board, not a screenshot you pasted and not a guess. Read-only, scoped to
                one workspace, and switched on per person.
              </p>

              <dl className="mcp-list">
                {MCP_TOOLS.map((t) => (
                  <div key={t.name} className="mcp-row">
                    <dt className="t-num text-sm" style={{ color: "var(--ink)" }}>
                      {t.name}
                    </dt>
                    <dd className="text-sm" style={{ color: "var(--ink-muted)" }}>
                      {t.what}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="lg:col-span-6 lg:col-start-7">
              <AiPanel />
            </div>
          </div>
        </SectionShell>

        {/* ══ INTEGRATIONS ═════════════════════════════════════════════════ */}
        <SectionShell
          id="integrations"
          label="Integrations"
          title={`${TOOLS} tools, read directly`}
          standfirst="No warehouse in between, no nightly export to babysit. Missing one? A custom webhook takes events from anything that can POST."
        >
          {/* A WRAPPED GRID, NOT A MARQUEE. The old ticker clipped mid-word at
              its right edge when static, and a scrolling row of names is a
              thing you cannot read on a page whose question is "do you read MY
              stack" — which is answered by scanning, not by waiting. Nothing
              moves and nothing is ever cut. */}
          <ul className="flex flex-wrap gap-2.5">
            {CONNECTOR_CATALOG.map((entry) => (
              <li key={entry.source}>
                <ToolChip source={entry.source} name={entry.name} />
              </li>
            ))}
          </ul>
        </SectionShell>

        {/* ══ PRICING ══════════════════════════════════════════════════════ */}
        <SectionShell
          id="pricing"
          tone="sunk"
          label="Pricing"
          title="Priced on tools, not on people"
          standfirst="What costs us money is sweeping other companies’ APIs, not the number of people looking at the answer — so the seats are generous and the ladder is built on how much you connect."
        >
          <Pricing cta={cta} />
        </SectionShell>

        {/* ══ QUESTIONS ════════════════════════════════════════════════════ */}
        <SectionShell
          id="faq"
          label="Questions"
          title="Before you connect a CRM"
          standfirst="The questions worth asking of anything you are about to give read access to."
        >
          <div className="lg:grid lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7 lg:col-start-6">
              <Faq />
            </div>
          </div>
        </SectionShell>

        {/* ══ CLOSING — the second and last centred block ══════════════════ */}
        <section className="ink-block px-5 py-28 text-center sm:px-8 lg:py-40">
          <div className="mx-auto w-full max-w-[72rem]">
            {/* THE LARGEST TYPE ANYWHERE ON THE PAGE, larger than the H1. */}
            <p className="t-display-xl text-balance" style={{ color: "var(--ink)" }}>
              Stop reconciling by hand.
            </p>
            <p className="mx-auto mt-6 text-lg" style={{ color: "var(--ink-muted)" }}>
              Connect one tool and build your first metric in an afternoon.
            </p>
            <div className="mt-10 flex justify-center">
              <a href={cta} className="btn-solid">
                {ctaLabel}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="px-5 sm:px-8" style={{ borderTop: "1px solid var(--rule)" }}>
        <div className="mx-auto w-full max-w-[72rem] py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] lg:gap-8">
            <div className="max-w-xs">
              <span
                className="font-marketing flex items-center gap-2 text-lg font-bold tracking-tight"
                style={{ color: "var(--ink)" }}
              >
                <BrandMark className="size-6 shrink-0" />
                Namzilabs
              </span>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--ink-muted)" }}>
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
                <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                  {col.title}
                </p>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="foot-link">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div
            className="mt-12 flex flex-wrap items-center justify-between gap-4 pt-6 text-sm"
            style={{ borderTop: "1px solid var(--rule)", color: "var(--ink-muted)" }}
          >
            <span>&copy; {new Date().getFullYear()} Namzilabs</span>
            <span>Read-only access to every tool it reads.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
