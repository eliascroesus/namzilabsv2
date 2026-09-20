import Link from "next/link";
import { Figtree } from "next/font/google";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import styles from "./snap.module.css";
import { SnapNav } from "@/components/marketing/snap/nav";
import { SourceRail } from "@/components/marketing/snap/rail";
import { ReceiptTabs, type Metric } from "@/components/marketing/snap/receipt-tabs";
import { SourceIndex } from "@/components/marketing/snap/source-index";
import { CountUp } from "@/components/marketing/snap/count-up";
import { CanvasShot } from "@/components/marketing/snap/canvas-shot";
import { Squircle, Tick, LogoMark } from "@/components/marketing/snap/marks";

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
 *   big · thin · dense · wide · medium · heavy · quiet · wide · thin · heavy
 *
 * No two neighbours match, and three rules enforce it:
 *
 *   1. ONLY S01 and S07 centre their heading. Everything else is left-aligned
 *      at the container's left edge.
 *   2. ONLY S06 and S10 are dark, and three light sections separate them.
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
 * ONE FAMILY, LOADED HERE RATHER THAN IN THE ROOT LAYOUT.
 *
 * next/font scopes a face to the component that imports it, so Figtree ships
 * with `/` and with nothing else: the app keeps Inter, layout.tsx is
 * untouched, and no dashboard, form or legal page pays for a font it never
 * renders. Putting it in the layout would be one line shorter and would add a
 * family to every route in the product.
 *
 * There is NO second face and no monospace. Figures are Figtree 800 with
 * tabular numerals — a wide mono on a figure is what made an earlier build
 * read as a tax form rather than as a product.
 */
const figtree = Figtree({ subsets: ["latin"], display: "swap", variable: "--snap-sans" });

export const metadata = {
  title: "Namzilabs — your best metrics live between your tools",
  description:
    "Namzilabs reads Calendly, Close, Stripe, Instantly, Google Sheets and 28 more, matches the records that are the same person, and builds the number none of them can — with the receipt for how it got there.",
};

/**
 * The hero's five chips. Positions, rotations and figures are all specified
 * rather than chosen: the tilts are small (2–4°) because anything larger
 * reads as decoration instead of as objects that have not been squared up
 * yet, and the arithmetic reconciles on purpose — 123 records in, 82 of them
 * the same people seen twice, 41 left. A demo whose numbers do not add up is
 * a demo of exactly the problem this product claims to fix.
 *
 * `drop` marks the two that leave at phone width: five chips in a single
 * column is a list, and three plus an answer is a story.
 */
const CHIPS = [
  { name: "Calendly", short: "Ca", desc: "invitee-created events", figure: "41", x: 24, y: 40, rot: -4, drop: false },
  { name: "Stripe", short: "St", desc: "payments matched to a meeting", figure: "29", x: 908, y: 16, rot: 3, drop: true },
  { name: "Google Sheets", short: "GS", desc: "the sheet kept by hand", figure: "44", x: 8, y: 300, rot: 3.5, drop: false },
  { name: "Close CRM", short: "Cl", desc: "meetings logged to a lead", figure: "38", x: 898, y: 272, rot: -3, drop: false },
  { name: "Instantly", short: "In", desc: "replies that booked something", figure: "12", x: 466, y: 352, rot: -2, drop: true },
];

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
  { name: "Calendly", short: "Ca", label: "Meetings booked", figure: "41", clause: "but not which ones showed up" },
  { name: "Close CRM", short: "Cl", label: "Deals created", figure: "18", clause: "but not what they cost to get" },
  { name: "Instantly", short: "In", label: "Replies", figure: "112", clause: "but not which became revenue" },
  { name: "Stripe", short: "St", label: "Revenue", figure: "$48.2k", clause: "but not which campaign earned it" },
  { name: "Google Sheets", short: "GS", label: "Rows, kept by hand", figure: "2,130", clause: "but not until Friday" },
  { name: "Aircall", short: "Ai", label: "Calls connected", figure: "306", clause: "but not against how many leads" },
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
    lines: [
      { key: "Sources read", value: "Calendly, Close CRM, Google Sheets" },
      { key: "Last computed", value: "2 minutes ago" },
      { key: "Records in", value: "123" },
      { key: "Matched as the same person", value: "82" },
      { key: "Excluded", value: "0" },
    ],
    note: "Three sources disagreed on the count. 82 records described the same 41 meetings, so each was counted once, on the earliest timestamp any source recorded for it.",
  },
  {
    tab: "Cost per held meeting",
    figure: "$86.40",
    value: 86.4,
    kind: "currency",
    lines: [
      { key: "Sources read", value: "Stripe, Instantly, Calendly" },
      { key: "Last computed", value: "2 minutes ago" },
      { key: "Records in", value: "418" },
      { key: "Matched as the same person", value: "129" },
      { key: "Excluded", value: "6" },
    ],
    note: "Spend divided by the meetings two sources agree actually happened. Six charges were left out — four refunds and two test payments — because counting them would have made the number look better than it is.",
  },
  {
    tab: "Speed to lead",
    figure: "8m 39s",
    value: 519,
    kind: "duration",
    lines: [
      { key: "Sources read", value: "Instantly, Close CRM" },
      { key: "Last computed", value: "9 minutes ago" },
      { key: "Records in", value: "312" },
      { key: "Matched as the same person", value: "0" },
      { key: "Excluded", value: "14" },
    ],
    note: "Nothing needed matching here — both sources key on the same lead. 14 replies are excluded because nobody has answered them yet, and counting an unanswered reply as instant would flatter the figure.",
  },
];

const AI_METRICS = [
  { name: "Close rate", was: "was 27.4%", now: "20.0%" },
  { name: "Show-up rate", was: "unchanged", now: "69%" },
  { name: "Speed to lead", was: "was 8m 39s", now: "31m 12s" },
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
      { label: "Log in", href: "/login" },
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

/** The five connectors, chip edge to the card's nearest edge. */
const CONNECTORS = [
  "M292 86 C 340 86, 340 160, 380 160",
  "M908 62 C 860 62, 860 160, 820 160",
  "M276 346 C 330 346, 330 272, 380 272",
  "M898 318 C 860 318, 860 272, 820 272",
  "M600 352 L600 300",
];

const CTA_DOTS = [
  { token: "--src-coral", left: "16%", top: "20%", delay: "0ms" },
  { token: "--src-lemon", left: "31%", top: "13%", delay: "800ms" },
  { token: "--src-mint", left: "62%", top: "16%", delay: "1600ms" },
  { token: "--src-sky", left: "78%", top: "25%", delay: "2400ms" },
  { token: "--src-lilac", left: "47%", top: "10%", delay: "3200ms" },
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
    name: entry.name,
    short: entry.brand?.short,
    blurb: entry.description,
  }));

  return (
    <div className={`${styles.page} ${figtree.variable}`}>
      <div className={styles.backdrop} aria-hidden />
      <div className={styles.bloom} aria-hidden />
      <div className={styles.grain} aria-hidden />

      <SnapNav cta={cta} ctaLabel={ctaLabel} />

      <main id="main" className={styles.clip}>
        {/* ══ S01 · Hero — centred, floating, full bloom ═══════════════════
            Height is AUTO. A viewport-fraction height is what produced 700px
            of dead canvas in an earlier build: the section is as tall as the
            headline, the stage and the air between them, and no taller. */}
        <section className={`${styles.container} ${styles.s01}`}>
          <div className={`${styles.narrowBlock} ${styles.centre}`}>
            {/* Three fixed lines. Letting this reflow puts a single word on
                its own line at some widths, which reads as a typesetting
                accident rather than as a sentence. */}
            <h1 className={styles.d0}>
              <span className={styles.heroLine}>
                <span>Your best metrics</span>
              </span>
              <span className={styles.heroLine}>
                <span>live between</span>
              </span>
              <span className={styles.heroLine}>
                <span>your tools.</span>
              </span>
            </h1>

            <p className={`${styles.bodyL} ${styles.heroSub}`}>
              <strong>Calendly</strong> holds part of the answer. <strong>Close</strong> holds another part.{" "}
              <strong>Stripe</strong> holds the rest. Namzilabs reads all of them, matches the records that are the same person, and builds the number none of them can.
            </p>

            <div className={styles.heroActions}>
              <Link className={styles.btn} href={cta}>
                {ctaLabel}
              </Link>
              <Link className={styles.textBtn} href="#receipts">
                <span>See a live metric</span>
              </Link>
            </div>

            <p className={`${styles.caption} ${styles.heroReassurance}`}>
              Read-only. Disconnect any tool and keep what it sent.
            </p>
          </div>

          <div className={styles.stage}>
            <svg className={styles.connectors} viewBox="0 0 1200 460" fill="none" aria-hidden>
              {CONNECTORS.map((d) => (
                <path key={d} className={styles.connector} d={d} />
              ))}
            </svg>

            {CHIPS.map((chip, i) => (
              <div
                key={chip.name}
                className={`${styles.chip} ${styles.chipRest} ${chip.drop ? styles.chipDrop : ""}`}
                style={
                  {
                    left: chip.x,
                    top: chip.y,
                    "--rot-base": `${chip.rot}deg`,
                    animationDelay: `${980 + i * 100}ms, 3000ms, ${3400 + i * 800}ms`,
                    boxShadow: `var(--sh-md), 0 8px 24px color-mix(in srgb, var(--src-${
                      ["coral", "mint", "lemon", "sky", "lilac"][i]
                    }) 26%, transparent)`,
                  } as React.CSSProperties
                }
              >
                <Squircle name={chip.name} short={chip.short} size={40} />
                {/* Name and figure share a row so the figure sits on the
                    source's own baseline; the description wraps beneath both
                    rather than shoving the figure off-centre when it runs to
                    two lines. */}
                <span className={styles.chipBody}>
                  <span className={styles.chipHead}>
                    <span className={styles.h4}>{chip.name}</span>
                    <span className={styles.f4}>{chip.figure}</span>
                  </span>
                  <span className={`${styles.caption} ${styles.chipDesc}`}>{chip.desc}</span>
                </span>
              </div>
            ))}

            {/* The one still, certain object in a field of moving ones. */}
            <div className={styles.resolved}>
              <div className={styles.resolvedTop}>
                <span className={styles.resolvedMark} aria-hidden />
                <span className={styles.resolvedName}>Namzilabs</span>
                <span className={styles.resolvedTick}>
                  <Tick size={20} onDark />
                </span>
              </div>
              <div className={styles.resolvedFigure}>
                <span className={styles.f2}>
                  <CountUp to={41} from={0} delay={2480} />
                </span>
                <span className={`${styles.bodyS} ${styles.resolvedUnit}`}>meetings held</span>
              </div>
              <p className={`${styles.caption} ${styles.resolvedSub}`}>123 in · 82 matched · 41 unique</p>
            </div>

            <span className={styles.pulse} aria-hidden />
          </div>
        </section>

        <div className={styles.belowFold}>
          {/* ══ S02 · Source rail — full bleed, thin, flush ════════════════ */}
          <SourceRail sources={sources} count={CONNECTOR_CATALOG.length} />

          {/* ══ S03 · The disagreement — sticky column, one tall stack ═════
              The densest section on the page, directly after the airiest. */}
          <section className={`${styles.container} ${styles.s03}`}>
            <div className={styles.splitGrid}>
              <div className={styles.stickyCol}>
                <h2 className={styles.d2}>Three tools. Three answers. None of them wrong.</h2>
                <p className={`${styles.bodyM} ${styles.stickyLead}`}>
                  Each one is telling the truth about its own slice. None of them can see the other two.
                </p>
              </div>

              <div className={styles.stack}>
                {DISAGREEMENT.map((row) => (
                  <div className={styles.srcRow} key={row.name}>
                    <Squircle name={row.name} short={row.short} size={44} />
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
            <h2 className={styles.d2}>Every number shows its working.</h2>
            <p className={`${styles.bodyM} ${styles.measure}`} style={{ marginTop: 20, color: "var(--ink-60)" }}>
              The arithmetic sits beside the number, always: which sources it read, when it read them, what it matched,
              and what it deliberately left out.
            </p>

            <ReceiptTabs metrics={METRICS} />
          </section>

          {/* ══ S06 · Honest incompleteness — dark panel, split ════════════
              The first of exactly two dark sections, and completely still.
              The loudest claim on the page makes no noise, and the contrast
              against the animated hero is the point. */}
          <section className={`${styles.container} ${styles.s06}`}>
            <div className={`${styles.darkPanel} ${styles.s06Panel}`}>
              <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} aria-hidden />
              <div className={styles.s06Grid}>
                <div className={styles.s06Copy}>
                  <h2 className={styles.d2}>It tells you when it can&rsquo;t see everything.</h2>
                  <p className={`${styles.d2} ${styles.statement}`}>
                    Covering <span className={styles.f1}>12</span> of <span className={styles.f1}>90</span> days.
                  </p>
                  <p className={`${styles.bodyM} ${styles.s06Body}`}>
                    Most tools fill a gap with a guess and let the chart look finished. When Namzilabs hasn&rsquo;t read
                    far enough back yet, or a source has gone quiet, the metric says so on its face. A number you can
                    trust is one that admits what it doesn&rsquo;t know.
                  </p>
                </div>

                <div className={styles.field}>
                  {/* One element with one description: ninety individually
                      announced dots is noise, and the sentence carries the
                      same information the grid does. */}
                  <div
                    className={styles.fieldGrid}
                    role="img"
                    aria-label="12 of 90 days read, 78 days not yet read"
                  >
                    {Array.from({ length: 90 }, (_, i) =>
                      i < 12 ? (
                        <span className={`${styles.dot} ${styles.dotRead}`} key={i}>
                          <Tick size={12} />
                        </span>
                      ) : (
                        <span className={styles.dot} key={i} />
                      ),
                    )}
                    <span className={styles.fieldBoundary} aria-hidden />
                  </div>
                  <p className={`${styles.caption} ${styles.fieldLabel}`}>78 days not yet read.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ══ S07 · Ask your AI — quiet centre, maximum air ══════════════
              The page's exhale after the dark panel, and the only section
              besides the hero with a centred heading. */}
          <section className={`${styles.container} ${styles.s07}`} id="ask-your-ai">
            <div className={`${styles.narrowBlock} ${styles.centre}`}>
              <h2 className={styles.d2}>Opinions are cheap. Give it the numbers.</h2>
              <p className={`${styles.bodyM} ${styles.dim}`} style={{ maxWidth: 640, margin: "20px auto 0" }}>
                Connect Claude or ChatGPT to your workspace and it reads your published metrics directly. The same
                figures you see on the board, not a screenshot you pasted and not a guess.
              </p>
              <p className={`${styles.bodyS} ${styles.aiNote}`}>
                Read-only, scoped to one workspace, switched on per person.
              </p>
            </div>

            {/* A still image of a conversation. A typewriter effect would
                undercut the one claim this section makes — that these are
                real published figures rather than a performance. */}
            <div className={styles.aiPanel}>
              <p className={`${styles.bodyS} ${styles.bubble}`}>Why did our close rate drop last week?</p>

              <p className={`${styles.caption} ${styles.aiReading}`}>
                <span className={styles.goodDot} aria-hidden />
                Reading 3 metrics from Namzilabs
              </p>

              <div className={styles.aiMetrics}>
                {AI_METRICS.map((metric) => (
                  <div className={styles.aiMetric} key={metric.name}>
                    <span className={`${styles.bodyS} ${styles.aiMetricName}`}>{metric.name}</span>
                    <span className={`${styles.bodyS} ${styles.aiMetricWas}`}>{metric.was}</span>
                    <span className={styles.f4}>{metric.now}</span>
                  </div>
                ))}
              </div>

              <p className={`${styles.bodyS} ${styles.aiAnswer}`}>
                Show-up rate held, so it isn&rsquo;t the calls. Speed to lead went from 8m 39s to 31m 12s on Tuesday,
                the same day two reps were out. Close rate tracks that, not lead quality.
              </p>

              <span className={`${styles.badge} ${styles.aiFoot}`}>
                <Tick size={14} />
                Read-only, and every figure is a metric you published.
              </span>
            </div>
          </section>

          {/* ══ S08 · The 33 sources — full-bleed plate, flat index ════════ */}
          <section className={styles.plate} id="sources">
            <div className={`${styles.container} ${styles.s08}`}>
              <SourceIndex sources={sources} cta={cta} ctaLabel={ctaLabel} />
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
              The page closes on the image it opened with: five source-coloured
              dots, drifting on the same loop as the hero chips, reduced to
              their essence. This is the only decoration approved anywhere. */}
          <section className={`${styles.container} ${styles.s10}`}>
            <div className={`${styles.darkPanel} ${styles.s10Panel}`}>
              <div className={`${styles.panelBloom} ${styles.panelBloomPeach}`} aria-hidden />
              {CTA_DOTS.map((dot) => (
                <span
                  key={dot.token}
                  className={styles.ctaDot}
                  aria-hidden
                  style={{ left: dot.left, top: dot.top, background: `var(${dot.token})`, animationDelay: dot.delay }}
                />
              ))}

              <h2 className={`${styles.d1} ${styles.s10Heading}`}>Stop reconciling by hand.</h2>
              <p className={`${styles.bodyL} ${styles.s10Sub}`}>
                Connect one tool and build your first metric this afternoon.
              </p>
              <div className={styles.s10Actions}>
                <Link className={`${styles.btn} ${styles.btnOnDark} ${styles.btnLarge}`} href={cta}>
                  {ctaLabel}
                </Link>
              </div>
              <p className={`${styles.caption} ${styles.s10Foot}`}>
                Read-only access. Disconnect any tool and keep what it sent.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* ══ S11 · Footer ════════════════════════════════════════════════ */}
      <footer className={`${styles.belowFold} ${styles.footer}`}>
        <div className={styles.container}>
          <div className={styles.footerTop}>
            <span className={styles.footerBrand}>
              <LogoMark />
              <span className={styles.wordmark}>Namzilabs</span>
            </span>
            <div className={styles.footerGroups}>
              {FOOTER_GROUPS.map((group) => (
                <div key={group.title}>
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
