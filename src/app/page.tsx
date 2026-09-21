import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import styles from "./snap.module.css";
import { SnapNav } from "@/components/marketing/snap/nav";
import { SourceRail } from "@/components/marketing/snap/rail";
import { ReceiptTabs, type Metric } from "@/components/marketing/snap/receipt-tabs";
import { SourceIndex } from "@/components/marketing/snap/source-index";
import { AiPanel } from "@/components/marketing/snap/ai-panel";
import { INDEX_SOURCES } from "@/components/marketing/snap/source-taxonomy";
import { JoinCard } from "@/components/marketing/snap/join-card";
import { CanvasShot } from "@/components/marketing/snap/canvas-shot";
import { Mark, Tick, LogoMark } from "@/components/marketing/snap/marks";

/**
 * THE FRONT DOOR — "Snap".
 *
 * ═══ THE CONCEPT, IN ONE SENTENCE ═══
 *
 * Five tools each hold a piece of an answer; they snap together into one.
 * Scattered and colourful resolves into single and certain. Every source owns
 * a bright colour and they float, tilted, separate; the thing that reconciles
 * them is a solid ink-black card holding one number. COLOUR IS THE PROBLEM.
 * INK IS THE ANSWER. That is not a skin over the argument, it IS the argument,
 * which is why a source colour may never fill a button and a resolved figure
 * may never be anything but ink.
 *
 * ═══ THE SCROLL RHYTHM, WHICH IS THE PART A FUTURE EDIT WILL BREAK ═══
 *
 * A landing page is read as one continuous experience. If every section is a
 * centred heading over a grid of cards, it reads as generated no matter how
 * good the palette is. So density, alignment and weight change as you scroll:
 *
 *   big · thin · dense · wide · medium · heavy · wide · thin · heavy
 *
 * S06 was cut; the numbering keeps its gap on purpose, as a marker that a
 * section was deliberately removed rather than lost. Its claim survives inside
 * S05's receipt, attached to a real number, which is where it was strongest.
 *
 * No two neighbours match, and three rules enforce it:
 *
 *   1. ONLY S01 centres its heading. S07's moved left when it became the dark
 *      section, which makes the fold the single centred moment on the page.
 *   2. ONLY S07 and S10 are dark, separated by two light sections.
 *   3. ONLY S02 and S08 break the container to full bleed, and they sit at
 *      opposite ends of the page.
 *
 * Section padding is per-section rather than a global constant for the same
 * reason. Adding a fourth centred heading, a third dark panel or a uniform
 * `py-32` would undo more of this design than changing the palette would.
 *
 * ═══ WHAT IS DELIBERATELY ABSENT ═══
 *
 * No fade-up-on-scroll entrance on any section — sections are simply present
 * when reached, and that single rule does more to separate a designed page
 * from a generated one than anything else here. No parallax. No glassmorphism
 * beyond the nav pill. No linear top-to-bottom gradient; atmosphere is radial
 * blooms. No emoji, mascot, 3D render, stock photo, star rating, press badge
 * or testimonial — there are no customers to count yet, so the page counts
 * none. The source list and its count are read from CONNECTOR_CATALOG rather
 * than typed, so the page cannot advertise an integration that does not ship.
 */

/**
 * THE APP'S OWN FACE, INHERITED RATHER THAN LOADED.
 *
 * This page shipped with Figtree of its own, on the argument that a marketing
 * page should not wear the product's chrome. The owner's call went the other
 * way: the landing page should read as the same product, so it takes
 * `--font-sans` — Inter, already self-hosted by next/font in the root layout —
 * by simply not declaring a family of its own.
 *
 * That is one fewer webfont on the page's critical path, and the hero headline
 * is the LCP element, so it is also the cheapest performance win available
 * here. Figures keep `tabular-nums`, which is the kit's own rule for numerals.
 */

export const metadata = {
  title: "Namzilabs — your best metrics live between your tools",
  description:
    "Namzilabs reads Calendly, Close, Stripe, Instantly, Google Sheets and 28 more, matches the records that are the same person, and builds the number none of them can — with the receipt for how it got there.",
};


/**
 * S03. Six tools, six partial truths.
 *
 * The clause is a neutral line with a small dot rather than a red strike
 * through the row, and the reason is in the heading directly above it: these
 * tools are not WRONG, they are partial. A strike reads as an error and would
 * contradict the sentence the reader just finished. The dot marks an absence
 * without accusing anyone.
 */
const DISAGREEMENT = [
  { source: "calendly", name: "Calendly", label: "Meetings booked", figure: "41", clause: "but not which ones showed up" },
  { source: "close", name: "Close CRM", label: "Deals created", figure: "18", clause: "but not what they cost to get" },
  { source: "instantly", name: "Instantly", label: "Replies", figure: "112", clause: "but not which became revenue" },
  { source: "stripe", name: "Stripe", label: "Revenue", figure: "$48.2k", clause: "but not which campaign earned it" },
  { source: "gsheets", name: "Google Sheets", label: "Rows, kept by hand", figure: "2,130", clause: "but not until Friday" },
  { source: "aircall", name: "Aircall", label: "Calls connected", figure: "306", clause: "but not against how many leads" },
];

const STEPS = [
  {
    title: "Connect your tools",
    body: "Sign in with Google, or paste an API key. New records start arriving within minutes and your history backfills behind you. You don't wait for it to finish before you start building.",
  },
  {
    title: "Build the metric",
    body: "Drag steps onto a canvas: pull records, keep the ones that count, match the same person across two sources, total what's left. Test it against real rows before you publish. No SQL, no warehouse.",
  },
  {
    title: "Watch it stay right",
    body: "A published metric recomputes on its own and shows its working: when it last ran, which sources it read, how many duplicates it matched, and what it left out and why.",
  },
];

const METRICS: Metric[] = [
  {
    tab: "Meetings held",
    figure: "41",
    value: 41,
    kind: "count",
    sources: [
      { source: "calendly", name: "Calendly" },
      { source: "close", name: "Close CRM" },
      { source: "gsheets", name: "Google Sheets" },
    ],
    records: "123 records",
    lines: [
      { key: "Sources read", value: "Calendly, Close CRM, Google Sheets" },
      { key: "Last computed", value: "2 minutes ago" },
      { key: "Records in", value: "123" },
      { key: "Matched as the same person", value: "82" },
      { key: "Excluded", value: "0", excluded: true },
    ],
    note: "Three sources disagreed on the count. 82 records described the same 41 meetings, so each was counted once, on the earliest timestamp any source recorded for it.",
  },
  {
    tab: "Cost per held meeting",
    figure: "$86.40",
    value: 86.4,
    kind: "currency",
    sources: [
      { source: "stripe", name: "Stripe" },
      { source: "instantly", name: "Instantly" },
      { source: "calendly", name: "Calendly" },
    ],
    records: "418 records",
    lines: [
      { key: "Sources read", value: "Stripe, Instantly, Calendly" },
      { key: "Last computed", value: "2 minutes ago" },
      { key: "Records in", value: "418" },
      { key: "Matched as the same person", value: "129" },
      { key: "Excluded", value: "6", excluded: true },
    ],
    note: "Spend divided by the meetings two sources agree actually happened. Six charges were left out — four refunds and two test payments — because counting them would have made the number look better than it is.",
  },
  {
    tab: "Speed to lead",
    figure: "8m 39s",
    value: 519,
    kind: "duration",
    sources: [
      { source: "instantly", name: "Instantly" },
      { source: "close", name: "Close CRM" },
    ],
    records: "312 records",
    lines: [
      { key: "Sources read", value: "Instantly, Close CRM" },
      { key: "Last computed", value: "9 minutes ago" },
      { key: "Records in", value: "312" },
      { key: "Matched as the same person", value: "0" },
      { key: "Excluded", value: "14", excluded: true },
    ],
    note: "Nothing needed matching here — both sources key on the same lead. 14 replies are excluded because nobody has answered them yet, and counting an unanswered reply as instant would flatter the figure.",
  },
];

/**
 * S09. Four objections, answered immediately before the call to action and
 * without a heading — this is a footnote to the whole page, not a new claim,
 * and giving it a `D2` would make it one.
 */
const ASKS = [
  { title: "Read-only", body: "It reads. It never writes, never edits, never deletes. The access it asks for cannot change anything inside your tools." },
  { title: "No warehouse", body: "Nothing to provision and nothing to pay for by the query. Connect a tool and the records start arriving." },
  { title: "No SQL", body: "Build a metric by dragging steps onto a canvas, and test it against real rows before you publish it." },
  { title: "Leave anytime", body: "Disconnect a tool and keep every figure it already produced. Nothing you built is held hostage." },
];

/**
 * The eight most recognisable marks, all of which ship a real logo. Instantly
 * is named in the spec but has no redistributable mark, and its lettered tile
 * forced white would be a blank square in a row of logos — so Mailchimp takes
 * the slot. The trailing count is derived, so it cannot fall behind the
 * catalogue.
 */
const PROOF_LOGOS = ["stripe", "calendly", "close", "gsheets", "notion", "shopify", "mailchimp", "airtable"];

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Receipts", href: "#receipts" },
      { label: "Ask your AI", href: "#ask-your-ai" },
    ],
  },
  {
    title: "Sources",
    links: [
      { label: "All sources", href: "#sources" },
      { label: "Request a source", href: "/docs" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Integrations", href: "/integrations" },
      { label: "Log in", href: "/sign-in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];



export default async function Home() {
  const { user } = await withAuth();

  // The LABEL never changes — "Connect your first tool" is the one action this
  // page exists to produce, and swapping it for "Go to dashboard" mid-scroll
  // makes it two different pages depending on a cookie. Where it POINTS does
  // change, because sending a signed-in reader back through sign-up is a dead
  // end rather than a message.
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = "Connect your first tool";

  const sources = CONNECTOR_CATALOG.map((entry) => ({
    source: entry.source,
    name: entry.name,
    blurb: entry.description,
  }));

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden />
      <div className={styles.bloom} aria-hidden />
      <div className={styles.grain} aria-hidden />

      <SnapNav cta={cta} ctaLabel={ctaLabel} revealAfter="#rail" />

      <main id="main" className={styles.clip}>
        {/* ══ S01 · Hero — centred, floating, full bloom ═══════════════════
            Height is AUTO. A viewport-fraction height is what produced 700px
            of dead canvas in an earlier build: the section is as tall as the
            headline, the stage and the air between them, and no taller. */}
        <section className={`${styles.container} ${styles.s01}`}>
          <div className={`${styles.narrowBlock} ${styles.centre}`}>
            {/* TWO fixed lines at 88px, down from three at 104. The object
                below has to reach the fold: three lines of 104 pushed the
                stage 700px down the page, so on a 900px viewport the first
                screen was entirely text. */}
            <h1 className={styles.d0}>
              <span className={styles.heroLine}>
                <span>Your best metrics</span>
              </span>
              <span className={styles.heroLine}>
                <span>live between your tools.</span>
              </span>
            </h1>

            {/* ONE sentence, and no word inside it is weighted differently.
                The bold on the three tool names existed to trigger
                recognition; the chips below now do that with actual logos and
                colour, so removing it also removes the page's last
                inline-emphasis exception. */}
            <p className={`${styles.bodyL} ${styles.heroSub}`}>
              Namzilabs reads all {CONNECTOR_CATALOG.length}, matches the records that are the same person, and builds
              the number none of them can.
            </p>

            <div className={styles.heroActions}>
              {/* A TWO-PART PILL, and hero-only. It reads as a product control
                  rather than a template button, and it carries a second piece
                  of information without a second line of text. Repeating the
                  construction in the nav and in S10 would turn a signature
                  into a pattern, so those keep the plain 56px button. */}
              <Link className={`${styles.btn} ${styles.btnHero}`} href={cta}>
                <span className={styles.btnHeroLabel}>{ctaLabel}</span>
                <span className={styles.btnHeroDivider} aria-hidden />
                <span className={styles.btnHeroNote}>No card required</span>
              </Link>
              <Link className={styles.ghostPill} href="#receipts">
                See a live metric
              </Link>
            </div>

            <p className={`${styles.caption} ${styles.heroReassurance}`}>Read-only. Disconnect anytime.</p>
          </div>

          <JoinCard />
        </section>

        {/* Everything from the rail down sits on the masked bloom. */}
        <div className={styles.belowFold}>
          {/* ══ S02 · Source rail — full bleed, thin, flush ════════════════ */}
          <SourceRail sources={sources} count={CONNECTOR_CATALOG.length} id="rail" />

          {/* ══ S03 · The disagreement — sticky column, one tall stack ═════
              The densest section on the page, directly after the airiest. */}
          <section className={`${styles.container} ${styles.s03}`}>
            <div className={styles.splitGrid}>
              <div className={styles.stickyCol}>
                <h2 className={styles.d2}>Ten tools. Ten dashboards. One number, built from all of them.</h2>
                <p className={`${styles.bodyM} ${styles.stickyLead}`}>
                  Each one tells the truth about its own slice and cannot see the other nine. Namzilabs reads them
                  together.
                </p>
              </div>

              <div className={styles.stack}>
                {DISAGREEMENT.map((row) => (
                  <div className={styles.srcRow} key={row.name}>
                    <Mark source={row.source} size={44} className={styles.mark} />
                    <span>
                      <span className={`${styles.h4} ${styles.srcName}`}>{row.name}</span>
                      <span className={`${styles.bodyS} ${styles.srcLabel}`}>{row.label}</span>
                    </span>
                    <span className={`${styles.f3} ${styles.srcFigure}`}>{row.figure}</span>
                    <span className={`${styles.bodyS} ${styles.srcClause}`}>
                      <span className={styles.flagDot} aria-hidden />
                      {row.clause}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ══ S04 · How it works — one horizontal track ══════════════════ */}
          <section className={`${styles.container} ${styles.s04}`} id="how-it-works">
            <h2 className={styles.d2}>Connected on Monday. Defensible by Friday.</h2>

            <div className={styles.track}>
              {/* The line fades at both ends, so it reads as a continuing
                  process rather than as a bounded progress bar. It does NOT
                  draw on scroll — that is an entrance animation wearing a
                  progress indicator's clothes. */}
              <div className={styles.trackLine} aria-hidden />
              <ol className={styles.nodes}>
                {STEPS.map((step, i) => (
                  <li className={styles.step} key={step.title}>
                    <span className={styles.node} aria-hidden>
                      {i + 1}
                    </span>
                    <h3 className={`${styles.d3} ${styles.stepTitle}`}>{step.title}</h3>
                    <p className={`${styles.bodyS} ${styles.stepBody}`}>{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>

            <figure className={styles.shot}>
              <CanvasShot />
            </figure>
            <p className={`${styles.caption} ${styles.shotNote}`}>A published metric recomputes every 10 minutes.</p>
          </section>

          {/* ══ S05 · The receipt — off-centre pair, tabbed ════════════════ */}
          <section className={`${styles.container} ${styles.s05}`} id="receipts">
            {/* Heading left, body right on a shared top edge — an editorial
                device that appears nowhere else on this page, so it earns the
                section a shape of its own and fills the top-right, which used
                to be empty in a section about density. */}
            <div className={styles.receiptHeadRow}>
              <h2 className={`${styles.d2} ${styles.receiptHeading}`}>Every number shows its working.</h2>
              <p className={`${styles.bodyM} ${styles.receiptLeadCell} ${styles.dim}`}>
                The arithmetic sits beside the number, always: which sources it read, when it read them, what it
                matched, and what it deliberately left out.
              </p>
            </div>

            <ReceiptTabs metrics={METRICS} />
          </section>

          {/* ══ S07 · Give your AI the numbers — THE dark section ═════════
              It inherits S06's slot in the rhythm. Deleting the incompleteness
              panel would otherwise have left S10 as the only dark moment and
              the middle of the page flat — and this section was the one that
              most needed the weight, because an AI integration rendered as
              another white card on a white background undersells itself.

              The angle changed with it. The old headline sold a fact-check —
              a clever line about an AI being wrong. What a buyer is short of is
              a DIAGNOSIS, and the specificity is the sell: anyone can say "AI
              insights", almost nobody can say the join across every tool
              already exists, because they built it. */}
          <section className={`${styles.container} ${styles.s07}`} id="ask-your-ai">
            <div className={`${styles.darkPanel} ${styles.s07Panel}`}>
              <div className={styles.panelBlooms} aria-hidden>
                <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} />
                <div className={`${styles.panelBloom} ${styles.panelBloomMint}`} />
              </div>

              <div className={styles.s07Grid}>
                <div className={styles.s07Copy}>
                  <h2 className={styles.d2}>Your AI can only see what you paste. Give it the whole business.</h2>
                  <p className={`${styles.bodyM} ${styles.s07Lead}`}>
                    Connect Claude or ChatGPT to your workspace and it reads every metric you have published, live. Not
                    a screenshot, not a CSV, not last month. Ask where the month went and it works across all your
                    sources at once — the one place that can, because it is the only place they have ever been joined —
                    and it comes back with the step that actually broke and the arithmetic behind it.
                  </p>
                  <p className={`${styles.bodyS} ${styles.s07Note}`}>
                    Read-only, scoped to one workspace, switched on per person.
                  </p>

                  {/* Not buttons: there is nothing to click here, and a hover
                      lift on a label is how somebody finds that out the hard
                      way. */}
                  <div className={styles.connChips}>
                    {["Claude", "ChatGPT", "Any MCP client"].map((label) => (
                      <span className={styles.connChip} key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* The card bleeds past the panel's right edge — the thing the
                    AI is reading sticks out of the box. It is the section's one
                    structural idea and the reason the panel has no right
                    padding. */}
                <div className={styles.aiCardCell}>
                  <AiPanel />
                </div>
              </div>
            </div>
          </section>

          {/* ══ S08 · The 33 sources — full-bleed plate, flat index ════════ */}
          <section className={styles.plate} id="sources">
            <div className={`${styles.container} ${styles.s08}`}>
              <SourceIndex sources={INDEX_SOURCES} cta={cta} />
            </div>
          </section>

          {/* ══ S09 · What it asks of you — one inline row, no heading ═════ */}
          <section className={`${styles.container} ${styles.s09}`}>
            <div className={styles.asksRule} aria-hidden />
            <div className={styles.asks}>
              {ASKS.map((ask) => (
                <div className={styles.ask} key={ask.title}>
                  <div className={styles.askTop}>
                    <Tick />
                    <h3 className={styles.h4}>{ask.title}</h3>
                  </div>
                  <p className={`${styles.bodyS} ${styles.askBody}`}>{ask.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ══ S10 · Final CTA — dark panel, centred ══════════════════════
              The five drifting dots are GONE. Ten pixels at 22% on a large
              black panel read as dust on the screen, which is the same failure
              as the hero's ambient chips: decoration too faint to be
              understood is indistinguishable from a defect. What replaces them
              carries real information — the marks of eight sources the product
              actually reads, legible at 34%. */}
          <section className={`${styles.container} ${styles.s10}`}>
            <div className={`${styles.darkPanel} ${styles.s10Panel}`}>
              <div className={styles.panelBlooms} aria-hidden>
                <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} />
                <div className={`${styles.panelBloom} ${styles.panelBloomPeach}`} />
              </div>

              {/* Eight real marks at 34% — legible as marks, unlike the dots
                  they replace, and they restate the page's promise one last
                  time before the ask. Mailchimp stands in for Instantly, which
                  ships no redistributable logo; a lettered tile forced white
                  would have been a blank square in a row of marks. */}
              <div className={styles.proofRow}>
                {PROOF_LOGOS.map((source) => (
                  <span className={styles.proofLogo} key={source}>
                    <Mark source={source} size={26} />
                  </span>
                ))}
                {/* Three labels, one shown per breakpoint, because the row
                    drops logos as it narrows and a count that did not follow
                    would be a number the page could be caught on. */}
                <span className={`${styles.caption} ${styles.proofMore}`}>
                  <span className={styles.moreXL}>+{CONNECTOR_CATALOG.length - 8} more</span>
                  <span className={styles.moreMD}>+{CONNECTOR_CATALOG.length - 6} more</span>
                  <span className={styles.moreSM}>+{CONNECTOR_CATALOG.length - 4} more</span>
                </span>
              </div>

              <h2 className={`${styles.d1} ${styles.s10Heading}`}>Stop reconciling by hand.</h2>
              <p className={`${styles.bodyL} ${styles.s10Sub}`}>
                Connect one tool and build your first metric this afternoon.
              </p>
              <div className={styles.s10Actions}>
                <Link className={`${styles.btn} ${styles.btnOnDark} ${styles.btnLarge}`} href={cta}>
                  {ctaLabel}
                </Link>
              </div>
              <p className={`${styles.caption} ${styles.s10Foot}`}>Read-only. No card required.</p>
            </div>
          </section>
        </div>
      </main>

      {/* ══ S11 · Footer ════════════════════════════════════════════════ */}
      <footer className={`${styles.belowFold} ${styles.footer}`}>
        <div className={styles.container}>
          <div className={styles.footerGrid}>
            {/* The descriptor and the static pill are what fill this column.
                Without them the brand column is one word and the whole layout
                tips right again, which is the thing being fixed. */}
            <div className={styles.footerBrandCol}>
              <span className={styles.footerBrand}>
                <LogoMark />
                <span className={styles.wordmark}>Namzilabs</span>
              </span>
              <p className={`${styles.bodyS} ${styles.footerDescriptor}`}>
                The number none of your tools can build alone.
              </p>
              <span className={`${styles.caption} ${styles.footerPill}`}>
                <span className={styles.footerDot} aria-hidden />
                Reading {CONNECTOR_CATALOG.length} sources
              </span>
            </div>

            {FOOTER_GROUPS.map((group) => (
              <div className={styles.footerGroup} key={group.title}>
                <p className={`${styles.caption} ${styles.footerTitle}`}>{group.title}</p>
                <ul className={styles.footerList}>
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link className={styles.footerLink} href={link.href}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className={`${styles.caption} ${styles.footerBottom}`}>
            <span>&copy; {new Date().getFullYear()} Namzilabs</span>
            <span>Read-only access. Disconnect any tool and keep what it sent.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
