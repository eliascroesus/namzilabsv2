import Link from "next/link";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import styles from "./snap.module.css";
import { SnapNav } from "@/components/marketing/snap/nav";
import { SourceRail } from "@/components/marketing/snap/rail";
import { ReceiptTabs, type Metric } from "@/components/marketing/snap/receipt-tabs";
import { SourceIndex } from "@/components/marketing/snap/source-index";
import { AiPanel } from "@/components/marketing/snap/ai-panel";
import { INDEX_SOURCES } from "@/components/marketing/snap/source-taxonomy";
import { BoardShot } from "@/components/marketing/snap/board-shot";
import { StartButtons } from "@/components/marketing/snap/start-buttons";
import { MetricRail } from "@/components/marketing/snap/metric-rail";
import { CanvasShot } from "@/components/marketing/snap/canvas-shot";
import { Mark, Tick, LogoMark } from "@/components/marketing/snap/marks";

/**
 * THE FRONT DOOR — "Snap".
 *
 * ═══ THE CONCEPT, IN ONE SENTENCE ═══
 *
 * Five tools each hold a piece of an answer; they snap together into one.
 * Scattered and colourful resolves into single and certain. Every source owns
 * a bright colour and they float, separate; the thing that reconciles them is
 * ink. A SOURCE colour is the problem and INK IS THE ANSWER — which is why a
 * source colour may never fill a button and a resolved figure may never be
 * anything but ink.
 *
 * The BRAND's blue is not a source colour, and since the atmosphere went cool
 * it is what fills the buttons. Ink held them while the page's wash was peach
 * and lilac and a pale blue pill disappeared into it; with a board, two dark
 * panels and an ink answer tile all on screen, a fourth black rectangle that
 * was supposed to be the action was the one nobody could pick out.
 *
 * ═══ THE SCROLL RHYTHM, WHICH IS THE PART A FUTURE EDIT WILL BREAK ═══
 *
 * A landing page is read as one continuous experience. If every section is a
 * centred heading over a grid of cards, it reads as generated no matter how
 * good the palette is. So density, alignment and weight change as you scroll:
 *
 *   big · thin · dense · wide · thin · medium · heavy · wide · thin · heavy
 *
 * S06 was cut; the numbering keeps its gap on purpose, as a marker that a
 * section was deliberately removed rather than lost. Its claim survives inside
 * S05's receipt, attached to a real number, which is where it was strongest.
 *
 * No two neighbours match, and three rules enforce it:
 *
 *   1. NO LIGHT SECTION centres its heading. The fold spends the page's last
 *      centred moment on a two-column layout; S07's went left when it became
 *      the dark section.
 *   2. ONLY S07 and S10 are dark, separated by two light sections.
 *   3. THREE BANDS break the container to full bleed, and a band is never a
 *      section: S02 (the tools), S04b (the metrics those tools make) and S08
 *      (the index). The two marquees run in OPPOSITE directions — same way
 *      round and they read as one belt the whole page is sitting on.
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
 * TWO FACES, AND THE SECOND ONE IS THE WHOLE IDENTITY.
 *
 * A heavy tightly-tracked grotesk carries the line and exactly one word breaks
 * into a high-contrast italic serif. That contrast is what makes a composition
 * read as designed rather than generated, and it costs one font file.
 *
 * ═══ SWITZER IS SELF-HOSTED, NOT FETCHED ═══
 *
 * It is a Fontshare face, so `next/font/google` cannot reach it. The variable
 * roman is committed at `src/app/fonts/` — 43KB — and `next/font/local` fingers
 * it into the build, so there is no runtime request to a third party and no
 * chance of the headline rendering in a fallback because a CDN was slow.
 *
 * ═══ BOTH ARE METRIC-MATCHED, WHICH IS NOT OPTIONAL HERE ═══
 *
 * The hero headline CONTAINS the serif word. If either face arrives late and
 * the fallback has different metrics, the headline reflows in front of the
 * visitor — the most noticeable load defect this page could have. Arial backs
 * the grotesk and Times backs the serif, both with the overrides `next/font`
 * generates, so the swap is a change of shape rather than of layout.
 */
const switzer = localFont({
  src: "./fonts/switzer-variable.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--v4-sans",
  adjustFontFallback: "Arial",
  preload: true,
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
  variable: "--v4-serif",
  preload: true,
});

/**
 * THE APP'S OWN FACE — no longer used by this page, kept for reference.
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
    said: [
      { source: "calendly", name: "Calendly", value: "41" },
      { source: "close", name: "Close CRM", value: "38" },
      { source: "gsheets", name: "Google Sheets", value: "44" },
    ],
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
    said: [
      { source: "instantly", name: "Instantly · spend", value: "$3,542" },
      { source: "calendly", name: "Calendly · held", value: "41" },
      { name: "Excluded, no spend", value: "6" },
    ],
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
    said: [
      { source: "instantly", name: "Instantly · replies", value: "312" },
      { source: "close", name: "Close CRM · first calls", value: "298" },
      { name: "Never called", value: "14" },
    ],
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

  /**
   * ONE FORK, READ ONCE AND PASSED DOWN.
   *
   * Every call to action on this page is the same `StartButtons`, and what it
   * offers depends on this single boolean: two ways to start for a visitor,
   * one way back to work for somebody who already has an account. Sending a
   * signed-in reader through sign-up is a dead end rather than a message, and
   * offering them `Start free` is worse than a dead end — it is wrong.
   *
   * `cta` survives for the nav's own button and for S08's request cell, which
   * are links rather than the page's action.
   */
  const signedIn = Boolean(user);
  const cta = signedIn ? "/dashboard" : "/signup";
  const ctaLabel = signedIn ? "Go to your dashboard" : "Start free";

  return (
    <div className={`${styles.page} ${switzer.variable} ${instrumentSerif.variable}`}>
      <div className={styles.backdrop} aria-hidden />
      <div className={styles.bloom} aria-hidden />
      <div className={styles.grain} aria-hidden />

      <SnapNav cta={cta} ctaLabel={ctaLabel} revealAfter="#rail" />

      <main id="main" className={styles.clip}>
        {/* ══ THE FOLD ═══════════════════════════════════════════════════
            The hero, the board and the source rail are wrapped together
            because on a narrow screen they have to REORDER: §5.7 puts the
            rail directly under the reassurance line and the board below the
            rail, so that the rail — the proof that 33 tools are being read —
            is still in the first screen at 375 × 812.

            That is only expressible if the board and the rail are siblings,
            so the board sits OUTSIDE the hero section and is positioned back
            over it at XL. It stays second in the document, between the copy
            it belongs beside and the rail it precedes, so the reading order
            is right at every width and no element is rendered twice. */}
        <div className={styles.fold}>
        {/* ══ S01 · Hero — the editorial stagger ═══════════════════════════
            Height is the viewport minus the rail, so the two together are
            exactly one screen. See §5.1 for why the ban on viewport heights
            does not apply: the frame is sized to its content plus the rail. */}
        <section className={`${styles.container} ${styles.s01}`}>
          {/* EDITORIAL STAGGER, NOT A CENTRED STACK. A centred headline uses
              the full width for text, so the visual has to go underneath it
              and there is no vertical room left for the rail. Off-centre, the
              copy column ends where the board begins, and the board runs on
              past the edge of the screen — which is what lets the headline,
              the call to action and the source rail share one screen. */}
          <div className={styles.foldGrid}>
            <div className={styles.foldCopy}>
              {/* THE STATUS PILL IS GONE, at the owner's ask, and it was the
                  right thing to lose: it claimed `last sweep 2 min ago` on a
                  page with no workspace behind it, and the rail six inches
                  below already says how many sources are read — in a band that
                  shows them rather than counting them. The headline now owns
                  the top of the fold outright. */}
              <h1 className={styles.d0}>
                <span className={styles.heroLine}>
                  <span>Your best metrics</span>
                </span>
                <span className={styles.heroLine}>
                  <span>
                    live <span className={`${styles.accent} ${styles.accentHero}`}>between</span>
                  </span>
                </span>
                <span className={styles.heroLine}>
                  <span>your tools.</span>
                </span>
              </h1>

              {/* "reads all 33" assumed a first-time visitor knows what the 33
                  are. Naming the categories tells them in one breath. */}
              <p className={`${styles.bodyL} ${styles.heroSub}`}>
                Namzilabs reads your calendar, CRM, outreach and payments together, matches the records that are the
                same person, and builds the number none of them can.
              </p>

              <StartButtons signedIn={signedIn} className={styles.heroActions} />

              <p className={`${styles.caption} ${styles.heroReassurance}`}>
                Free to start, no card. Read-only — disconnect anytime.
              </p>
            </div>

          </div>
        </section>

        {/* Absolutely positioned over the hero at XL — see `.foldShot`. */}
        <div className={styles.foldShot}>
          <div className={styles.foldShotInner}>
            <BoardShot />
          </div>
        </div>

        {/* The rail is the bottom edge of the first screen — it is flush
            against the hero and starts scrolling at t=0, before anything else
            on the page animates. */}
        <SourceRail sources={INDEX_SOURCES} count={CONNECTOR_CATALOG.length} id="rail" />
        </div>

        {/* Everything from the rail down sits on the masked bloom. */}
        <div className={styles.belowFold}>
          {/* ══ S03 · The disagreement — sticky column, one tall stack ═════
              The densest section on the page, directly after the airiest. */}
          <section className={`${styles.container} ${styles.s03}`}>
            <div className={styles.splitGrid}>
              <div className={styles.stickyCol}>
                <h2 className={styles.d2}>Ten tools. Ten dashboards. One number, built from <span className={styles.accent}>all</span> of them.</h2>
                <p className={`${styles.bodyM} ${styles.stickyLead}`}>
                  Each one tells the truth about its own slice and cannot see the other nine. Namzilabs reads them
                  together.
                </p>

                {/* The call sits in the STICKY column, so it is on screen for
                    the whole scroll of the six rows beside it — which is the
                    minute the reader spends recognising their own stack. */}
                <StartButtons signedIn={signedIn} className={styles.sectionCta} />
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
            <h2 className={styles.d2}>Connected on Monday. Defensible by <span className={styles.accent}>Friday</span>.</h2>

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

          {/* ══ S04b · The second band — what the building is FOR ══════════
              S02 says what gets read; this says what comes out, and it sits
              exactly between the metric being assembled and that metric's
              receipt. It is the same object as the source rail on purpose —
              a reader has met this band before and knows not to stop for it —
              running the other way so the two do not read as one belt. */}
          <MetricRail />

          {/* ══ S05 · The receipt — off-centre pair, tabbed ════════════════ */}
          <section className={`${styles.container} ${styles.s05}`} id="receipts">
            {/* Heading left, body right on a shared top edge — an editorial
                device that appears nowhere else on this page, so it earns the
                section a shape of its own and fills the top-right, which used
                to be empty in a section about density. */}
            <div className={styles.receiptHeadRow}>
              <h2 className={`${styles.d2} ${styles.receiptHeading}`}>Every number shows its <span className={styles.accent}>working</span>.</h2>
              <p className={`${styles.bodyM} ${styles.receiptLeadCell} ${styles.dim}`}>
                The arithmetic sits beside the number, always: which sources it read, when it read them, what it
                matched, and what it deliberately left out.
              </p>
            </div>

            <ReceiptTabs metrics={METRICS} />

            <StartButtons signedIn={signedIn} className={styles.sectionCta} />
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
                  <h2 className={styles.d2}>Your AI can only see what you paste. Give it the <span className={styles.accent}>whole</span> business.</h2>
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

              <StartButtons signedIn={signedIn} align="centre" className={styles.sectionCta} />
            </div>
          </section>

          {/* ══ S09 · What it asks of you — ONE card, split internally ═════
              It was four columns floating on the page with hairlines between
              them, which is the shape of a comparison table and read as one:
              four things being weighed against each other rather than four
              halves of a single reassurance. S05 solved exactly this a
              section earlier — one surface, divided inside — and there is
              nothing left to connect once it is one object.

              The claims also got their weight back. `Read-only` is the last
              thing a reader is told before being asked to sign in, and it was
              set two points smaller than the body copy explaining it. */}
          <section className={`${styles.container} ${styles.s09}`}>
            <div className={styles.asks}>
              {ASKS.map((ask) => (
                <div className={styles.ask} key={ask.title}>
                  <h3 className={styles.askTitle}>
                    <Tick size={20} />
                    {ask.title}
                  </h3>
                  <p className={`${styles.bodyS} ${styles.askBody}`}>{ask.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ══ S10 · Final CTA — dark panel, centred ══════════════════════
              THE MARKS ARE THE BRANDS' OWN NOW, ON WHITE CHIPS.

              This row has been wrong twice for the same reason. First it was
              five drifting dots at 22%, which read as dust. Then it was eight
              real marks flattened to white silhouettes at 34% — which is not
              a row of logos, it is a row of grey smudges, and a reader cannot
              name one of them. Both failures are the same one: decoration too
              faint to be understood is indistinguishable from a defect.

              A brand mark is drawn to sit on white, so each one gets a white
              disc and its own colour, overlapping into a single object. That
              is also the page's argument in its last inch — eight colours
              gathered into one thing, on ink. */}
          <section className={`${styles.container} ${styles.s10}`}>
            <div className={`${styles.darkPanel} ${styles.s10Panel}`}>
              <div className={styles.panelBlooms} aria-hidden>
                <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} />
                <div className={`${styles.panelBloom} ${styles.panelBloomSteel}`} />
              </div>

              {/* Eight real marks at 34% — legible as marks, unlike the dots
                  they replace, and they restate the page's promise one last
                  time before the ask. Mailchimp stands in for Instantly, which
                  ships no redistributable logo; a lettered tile forced white
                  would have been a blank square in a row of marks. */}
              <div className={styles.proofRow}>
                <span className={styles.proofStack}>
                  {PROOF_LOGOS.map((source) => (
                    <span className={styles.proofLogo} key={source}>
                      <Mark source={source} size={22} radius="50%" />
                    </span>
                  ))}
                </span>
                {/* Three labels, one shown per breakpoint, because the row
                    drops logos as it narrows and a count that did not follow
                    would be a number the page could be caught on. */}
                <span className={`${styles.caption} ${styles.proofMore}`}>
                  <span className={styles.moreXL}>+{CONNECTOR_CATALOG.length - 8} more</span>
                  <span className={styles.moreMD}>+{CONNECTOR_CATALOG.length - 6} more</span>
                  <span className={styles.moreSM}>+{CONNECTOR_CATALOG.length - 4} more</span>
                </span>
              </div>

              <h2 className={`${styles.d1} ${styles.s10Heading}`}>Stop reconciling by <span className={styles.accent}>hand</span>.</h2>
              <p className={`${styles.bodyL} ${styles.s10Sub}`}>
                Connect one tool and build your first metric this afternoon.
              </p>
              <StartButtons signedIn={signedIn} tone="dark" align="centre" className={styles.s10Actions} />
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
                tips right again, which is the thing being fixed.

                `.footerBrand` HAD NO RULE IN THE STYLESHEET — it was written
                here and in the nav, and only the nav's own `display: flex`
                was making it lay out. CSS Modules resolve a missing class to
                `undefined`, so this span rendered `class="undefined"`, and
                the reset's `svg { display: block }` then put the mark on its
                own line with the wordmark under it. Silent in every check the
                repo has: the markup is right, the class name is spelled
                right, and the only tell is a logo stacked on a word. */}
            <div className={styles.footerBrandCol}>
              <span className={styles.footerBrand}>
                <LogoMark size={26} />
                <span className={styles.wordmark}>Namzilabs</span>
              </span>
              <p className={`${styles.bodyS} ${styles.footerDescriptor}`}>
                The number none of your tools can build alone.
              </p>
              <span className={`${styles.caption} ${styles.footerPill}`}>
                <span className={styles.liveDot} aria-hidden />
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
