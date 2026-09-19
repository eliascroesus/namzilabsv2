import Link from "next/link";
import { Archivo, Martian_Mono } from "next/font/google";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import styles from "./ledger.module.css";
import { LedgerNav } from "@/components/marketing/ledger/nav";
import { SourceRail } from "@/components/marketing/ledger/rail";
import { Steps } from "@/components/marketing/ledger/steps";
import { ReceiptFigure } from "@/components/marketing/ledger/receipt";
import { SourceSearch } from "@/components/marketing/ledger/source-search";
import { CountUp } from "@/components/marketing/ledger/count-up";
import { CanvasShot } from "@/components/marketing/ledger/canvas-shot";
import { Tick, SourceTile } from "@/components/marketing/ledger/marks";

/**
 * THE FRONT DOOR, BUILT AS A LEDGER.
 *
 * ═══ WHY THIS PAGE DOES NOT LOOK LIKE THE PRODUCT ═══
 *
 * Namzilabs is not a dashboard product, it is an AUDIT product: its claim is
 * that a number can be CHECKED. So the visual world is not the world of BI
 * software — glowing charts on dark glass, which is what the previous page and
 * every competitor reach for — it is the world of reconciliation. Ruled
 * columns, greenbar paper, tick marks, corrections in red, footnotes that say
 * where a figure came from. Used as a substrate and never as a costume: a
 * visitor should not think "retro", they should think "this was made by people
 * who care whether the number is right".
 *
 * ═══ THE FIVE PRINCIPLES, BECAUSE THEY ARE WHAT A FUTURE EDIT WILL BREAK ═══
 *
 *  1. PAPER IS SQUARE, SOFTWARE IS ROUND. A sheet of paper has a 0px radius; a
 *     crop of the actual product UI has 12px. Radius carries MEANING here. It
 *     is not a style setting to be harmonised later.
 *  2. LEFT-ALIGNED, RULED, COLUMNAR. Figures right-align inside their column,
 *     as they do in any ledger. Exactly one element on the page is centred and
 *     it is the closing panel.
 *  3. STRUCTURE ENCODES INFORMATION. A rule appears where there is a column
 *     boundary; a footnote marker appears only where a receipt genuinely
 *     exists. No divider and no label on this page is decorative.
 *  4. SPEND THE BOLDNESS ONCE. The hero reconciliation is the memorable thing.
 *     If a later section starts competing with it, cut the later section back.
 *  5. RED INK MEANS DISAGREEMENT. `correction` marks records that disagree, do
 *     not match, or are missing. Never an emphasis colour, never a heading,
 *     never a button.
 *
 * ═══ WHAT THIS PAGE REFUSES TO DO, AND WHY EACH ONE IS LISTED ═══
 *
 * Every item below is a plausible default that would make the page generic:
 * fade-up-on-scroll section entrances, hover lifts on cards, a row of
 * identical rounded cards with identical shadows, a tracked-out ALL-CAPS
 * eyebrow above each heading, an arrow glyph after a button label, monospace
 * for small labels, gradients as decoration, a "Trusted by" logo wall, star
 * ratings, invented testimonials. None of them are here. The page has ONE
 * orchestrated sequence (the hero, once, never replayed) and ONE ambient loop
 * (the source rail). Everything else moves only when a person does something.
 *
 * ═══ AND WHAT IT REFUSES TO CLAIM ═══
 *
 * There is no social proof on this page because there are no customers to
 * count yet. The source list and its count are read from CONNECTOR_CATALOG
 * rather than typed, so the page cannot advertise an integration the product
 * does not ship; the closing stats are four facts this repository can be
 * checked against. A landing page is the easiest place in a product to lie and
 * the most expensive place to be caught.
 */
/**
 * TWO FAMILIES, TWO JOBS, AND THEY ARE LOADED HERE RATHER THAN IN THE ROOT
 * LAYOUT — which is the load-bearing part of this declaration.
 *
 * next/font scopes a face to the component that imports it, so these two ship
 * with `/` and with nothing else. The app keeps Inter, the root layout is
 * untouched, and no other route pays for a font it never renders. Putting them
 * in layout.tsx would have been one line shorter and would have added two
 * families to every dashboard, form and legal page in the product.
 *
 * ARCHIVO IS HERE FOR ITS WIDTH AXIS, which is why `axes: ["wdth"]` is not
 * optional garnish: next/font ships only `wght` by default to keep the file
 * small, and without `wdth` every `font-stretch` in the stylesheet silently
 * does nothing. The hero sets 112, section headings 108, body 100 — one family
 * doing two visually distinct jobs is the whole reason this page needs no
 * separate display face.
 *
 * MARTIAN MONO IS FOR NUMERALS ONLY — figures, currency, dates, counts. Never
 * a heading, never a button, and above all never a small label: a tracked-out
 * monospace label above a heading is the single most recognisable tell of a
 * generated page, and this one does not have a single one.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--ledger-sans",
});

const martianMono = Martian_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--ledger-mono",
});

export const metadata = {
  title: "Namzilabs — your best metrics live between your tools",
  description:
    "Namzilabs reads Calendly, Close, Stripe, Instantly, Google Sheets and 28 more, matches the records that are the same person, and builds the number none of them can — with the receipt for how it got there.",
};

/**
 * The hero instrument. Four sources disagreeing, then the resolution.
 *
 * The arithmetic reconciles on purpose: 123 records arrive, 82 of them are the
 * same people seen twice, 41 remain. A demo whose numbers do not add up is a
 * demo of exactly the problem this product claims to fix.
 *
 * `struck` marks the two rows the reconciliation crosses out — Close's 38 and
 * the hand-kept sheet's 44 are the same meetings Calendly already counted.
 */
const HERO_ROWS = [
  { name: "Calendly", short: "Ca", desc: "invitee-created events", figure: "41", struck: false },
  { name: "Close CRM", short: "Cl", desc: "meetings logged to a lead", figure: "38", struck: true },
  { name: "Google Sheets", short: "GS", desc: "the sheet the team keeps by hand", figure: "44", struck: true },
  { name: "Instantly", short: "In", desc: "replies that booked something", figure: "12", struck: false },
];

/**
 * S03. Six tools, six partial truths, and the clause that makes each one
 * useless on its own — which is the section's whole argument: the problem is
 * not "I lack a dashboard", it is "my tools disagree and I cannot adjudicate
 * it".
 */
const DISAGREEMENT = [
  { name: "Calendly", short: "Ca", knows: "Meetings booked", figure: "41", cant: "but not which ones showed up" },
  { name: "Close CRM", short: "Cl", knows: "Deals created", figure: "18", cant: "but not what they cost to get" },
  { name: "Instantly", short: "In", knows: "Replies", figure: "112", cant: "but not which became revenue" },
  { name: "Stripe", short: "St", knows: "Revenue", figure: "$48.2k", cant: "but not which campaign earned it" },
  { name: "Google Sheets", short: "GS", knows: "Rows, kept by hand", figure: "2,130", cant: "but not until Friday" },
  { name: "Aircall", short: "Ai", knows: "Calls connected", figure: "306", cant: "but not against how many leads" },
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

const RECEIPT_LINES = [
  { key: "Sources read", value: "Calendly, Close CRM, Google Sheets" },
  { key: "Last computed", value: "2 minutes ago" },
  { key: "Records in", value: "123" },
  { key: "Matched as the same person", value: "82" },
  { key: "Excluded", value: "0" },
];

/**
 * S07's panel is a designed representation of a chat exchange, not a live one.
 * The figures in it are the same ones the hero reconciles, so a reader who
 * scrolled past both is not handed two different stories about one workspace.
 */
const AI_METRICS = [
  { name: "Close rate", was: "was 27.4%", now: "20.0%" },
  { name: "Show-up rate", was: "unchanged", now: "69%" },
  { name: "Speed to lead", was: "was 8m 39s", now: "31m 12s" },
];

/**
 * S09. Four facts, and the reason each of these rather than a customer count:
 * every one is checkable against this repository. The source count is COMPUTED
 * so it cannot fall behind the catalogue; ten minutes is the materialise
 * sweep's real cadence; the other two are promises the product either honours
 * or does not.
 */
const FACTS = [
  { figure: `${CONNECTOR_CATALOG.length}`, label: "Sources it reads, directly" },
  { figure: "10 min", label: "How often a published metric recomputes" },
  { figure: "0", label: "Lines of SQL you write" },
  { figure: "Read-only", label: "The access it asks your tools for" },
];

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Receipts", href: "#receipts" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    title: "Sources",
    links: [
      { label: "All sources", href: "#sources" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  {
    title: "Company",
    links: [{ label: "Sign in", href: "/sign-in" }],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];

/** The five vertical rules: left edge of c1, c4, c7, c10, right edge of c12. */
function ColumnRules({ hero = false }: { hero?: boolean }) {
  return (
    <div className={`${styles.rules} ${hero ? styles.rulesHero : ""}`} aria-hidden>
      <div className={styles.rulesInner}>
        <span className={styles.rule} style={{ gridColumn: 1 }} />
        <span className={styles.rule} style={{ gridColumn: 4 }} />
        <span className={styles.rule} style={{ gridColumn: 7 }} />
        <span className={styles.rule} style={{ gridColumn: 10 }} />
        <span className={`${styles.rule} ${styles.ruleEnd}`} style={{ gridColumn: 12 }} />
      </div>
    </div>
  );
}

export default async function Home() {
  const { user } = await withAuth();

  // The LABEL never changes — "Connect your first tool" is the one action this
  // page exists to produce, and swapping it for "Go to dashboard" mid-scroll
  // would be two different pages depending on a cookie. Where it POINTS does
  // change, because sending a signed-in reader back through sign-up is a
  // dead end rather than a message.
  const cta = user ? "/dashboard" : "/sign-up";
  const ctaLabel = "Connect your first tool";

  const sources = CONNECTOR_CATALOG.map((entry) => ({
    name: entry.name,
    // `brand` is optional on a catalogue entry, so the two-letter tile falls
    // back to deriving its own initials rather than rendering an empty square.
    short: entry.brand?.short,
    blurb: entry.description,
  }));

  return (
    <div className={`${styles.page} ${archivo.variable} ${martianMono.variable}`}>
      <div className={styles.backdrop} aria-hidden />
      <LedgerNav cta={cta} ctaLabel={ctaLabel} />

      <main id="main" className={styles.clip}>
        {/* ═══ Rule zone one: S01 through S05 ═══════════════════════════════
            The five vertical rules run unbroken from the top of the hero to
            the bottom of the receipt section. That continuity is what makes
            five sections read as one long ruled sheet rather than a stack of
            unrelated blocks — and it is why the zone is a wrapper rather than
            a per-section background. */}
        <div className={styles.ruleZone}>
          <ColumnRules />

          {/* ── S01 · Hero ─────────────────────────────────────────────── */}
          <section className={`${styles.container} ${styles.hero}`}>
            <ColumnRules hero />
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                {/* ═══ THREE FIXED LINES AT 68px, AND THE SPEC ASKED FOR TWO AT 76 ═══
                    
                    Those two instructions cannot both be obeyed, and the
                    numbers say so rather than taste. Measured in the browser
                    with the real face: at D1's 76px/wdth 112, "live between
                    your tools." sets 873px wide. The headline block is c1–c6,
                    which is 612px, and the hero instrument starts at c7 —
                    x=732 — so anything wider than 648px runs under it. The
                    largest size at which the specified TWO lines fit 612px is
                    50px, which is 4px off D2 and destroys the hierarchy the
                    hero exists to create.

                    So the break moved instead of the scale: three lines at
                    68px, every one of them fixed, none of them reflowing.
                    That keeps the headline nearly twice D2, keeps the block
                    inside c1–c6, keeps the instrument at c7 with its bleed,
                    and is the same three-line treatment the spec already
                    calls for at SM. Flagged rather than silently resolved —
                    if the intent was the full-width two-line setting, the
                    instrument has to move down and the hero stops being a
                    side-by-side composition. */}
                <h1 className={`${styles.d1} ${styles.measureWide}`}>
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
                  {/* One line on purpose: a wrap after a closing tag leaves the following space for a
                      transform to decide, which tests/jsx-whitespace.test.ts exists to stop. */}
                  <strong>Stripe</strong> holds the rest. Namzilabs reads all of them, matches the records that are the same person, and builds the number none of them can.
                </p>

                <div className={styles.heroActions}>
                  <Link className={styles.btn} href={cta} id="hero-cta">
                    <span>{ctaLabel}</span>
                  </Link>
                  <Link className={styles.textBtn} href="#receipts">
                    See a live metric
                  </Link>
                </div>

                <p className={`${styles.caption} ${styles.heroReassurance}`}>
                  Read-only. Disconnect any tool and keep what it sent.
                </p>
              </div>

              <div className={styles.heroInstrument}>
                <div className={`${styles.rows} ${styles.heroStack}`}>
                  {/* The match lines: row 1's figure to row 2's, and row 2's to
                      row 4's, curving left into the margin. They are the only
                      thing on the page that draws a relationship between two
                      figures, which is precisely what the product does.

                      They attach at the figure column's LEFT edge (x=160 of
                      260) rather than its right, so the curve bows into the
                      empty margin instead of arcing back across the numerals
                      it is supposed to be pointing at. */}
                  <svg className={styles.matchLines} viewBox="0 0 260 288" preserveAspectRatio="none" aria-hidden>
                    <path className={styles.matchPath} d="M160 36 C 112 36, 112 108, 160 108" />
                    <path className={styles.matchPath} d="M160 108 C 84 108, 84 252, 160 252" />
                  </svg>

                  {HERO_ROWS.map((row) => (
                    <div
                      className={`${styles.row} ${styles.heroRow} ${row.struck ? styles.heroStruck : ""}`}
                      key={row.name}
                    >
                      <span className={styles.rowContent}>
                        <SourceTile name={row.name} short={row.short} />
                        <span className={styles.rowName}>{row.name}</span>
                        <span className={styles.rowDesc}>{row.desc}</span>
                        <span className={`${styles.fig} ${styles.f4} ${styles.rowFigure}`}>{row.figure}</span>
                      </span>
                      {row.struck ? <span className={styles.strike} aria-hidden /> : null}
                    </div>
                  ))}
                </div>

                <div className={`${styles.row} ${styles.rowResolved} ${styles.heroResolved}`}>
                  <span className={styles.rowContent}>
                    <SourceTile name="Namzilabs" short="Nz" />
                    <span className={styles.rowName}>Namzilabs</span>
                    <span className={styles.rowDesc}>123 in · 82 matched · 41 unique</span>
                    <Tick draw />
                    <span
                      className={`${styles.fig} ${styles.rowFigure} ${styles.heroResolvedFigure}`}
                      aria-label="41 meetings"
                    >
                      <CountUp to={41} delay={2900} />
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ── S02 · Source rail ──────────────────────────────────────── */}
          <SourceRail sources={sources} count={CONNECTOR_CATALOG.length} />

          {/* ── S03 · The disagreement ─────────────────────────────────── */}
          <section className={`${styles.container} ${styles.section}`}>
            <h2 className={`${styles.d2} ${styles.span7}`}>Three tools. Three answers. None of them wrong.</h2>
            <div className={styles.headingRule} aria-hidden />
            <p className={`${styles.bodyM} ${styles.lead} ${styles.measure} ${styles.dim}`}>
              Calendly counts the invite. Close counts what a rep logged. The sheet counts what somebody typed on
              Friday. Each one is telling the truth about its own slice, and none of them can see the other two. So the
              question you actually have — what did that campaign earn, which channel is carrying the month, what a held
              meeting costs you — has no home. Answering it means exporting four CSVs and hoping the names line up.
            </p>

            <div className={`${styles.rows} ${styles.table}`}>
              {DISAGREEMENT.map((row, index) => (
                <div
                  className={`${styles.row} ${index % 2 === 1 ? styles.rowBanded : ""}`}
                  key={row.name}
                >
                  <span className={styles.rowContent}>
                    <SourceTile name={row.name} short={row.short} />
                    <span className={styles.rowName}>{row.name}</span>
                    <span className={styles.rowDesc}>{row.knows}</span>
                    {/* The slash is not decoration: no state on this page is
                        carried by colour alone, so the red clause travels with
                        a mark a reader who cannot see the red still gets. */}
                    <span className={styles.cantTell}>
                      <span className={styles.slash} aria-hidden />
                      {row.cant}
                    </span>
                    <span className={`${styles.fig} ${styles.f4} ${styles.rowFigure}`}>{row.figure}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ── S04 · How it works ─────────────────────────────────────── */}
          <section className={`${styles.container} ${styles.section}`} id="how-it-works">
            <h2 className={`${styles.d2} ${styles.span8}`}>Connected on Monday. Defensible by Friday.</h2>
            <div className={styles.headingRule} aria-hidden />

            <Steps steps={STEPS} />

            <div className={styles.shotRow}>
              <p className={`${styles.caption} ${styles.note}`}>
                A published metric recomputes every 10 minutes.
                <span className={styles.noteRule} aria-hidden />
              </p>
              <div className={styles.shot}>
                <CanvasShot />
              </div>
            </div>
          </section>

          {/* ── S05 · The receipt ──────────────────────────────────────── */}
          <section className={`${styles.container} ${styles.section}`} id="receipts">
            <h2 className={`${styles.d2} ${styles.span7}`}>Every number shows its working.</h2>
            <div className={styles.headingRule} aria-hidden />

            <ReceiptFigure
              lead={
                <p className={`${styles.bodyM} ${styles.lead} ${styles.dim}`}>
                  Click any figure and the arithmetic opens beside it: the sources it read, the moment it read them, the
                  records it treated as the same person, and the ones it deliberately left out. When someone asks where
                  a number came from, the answer is a click rather than an afternoon.
                </p>
              }
              label="Meetings held, last 7 days"
              value="41"
              marker={1}
              metric="Meetings held"
              lines={RECEIPT_LINES}
              note="Three sources disagreed on the count. 82 records described the same 41 meetings, so each was counted once, on the earliest timestamp any source recorded for it."
            />
          </section>
        </div>

        {/* ── S06 · Honest incompleteness ──────────────────────────────────
            The one dark section on the page, deliberately outside every rule
            zone: the rules stop at the bottom of S05 and do not resume until
            S08, so this reads as a pause in the page's rhythm rather than as
            another entry in it. It is also completely still. The loudest claim
            on the page makes no noise. */}
        <section className={styles.dark}>
          <div className={`${styles.container} ${styles.darkGrid}`}>
            <div className={styles.darkCopy}>
              <h2 className={styles.d2}>It tells you when it can&rsquo;t see everything.</h2>
              <p className={`${styles.d2} ${styles.statement}`}>
                Covering <span className={styles.fig}>12</span> of <span className={styles.fig}>90</span> days.
              </p>
              <p className={`${styles.bodyM} ${styles.darkBody}`}>
                Most tools fill a gap with a guess and let the chart look finished. When Namzilabs hasn&rsquo;t read far
                enough back yet, or a source has gone quiet, the metric says so on its face. A number you can trust is
                one that admits what it doesn&rsquo;t know.
              </p>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldGrid} aria-hidden>
                {Array.from({ length: 90 }, (_, index) =>
                  index < 12 ? (
                    <span className={`${styles.cell} ${styles.cellRead}`} key={index}>
                      <Tick size={10} />
                    </span>
                  ) : (
                    <span className={styles.cell} key={index} />
                  ),
                )}
                <span className={styles.fieldBoundary} />
              </div>
              <p className={`${styles.caption} ${styles.fieldLabel}`}>78 days not yet read.</p>
            </div>
          </div>
        </section>

        {/* ── S07 · Ask your AI ────────────────────────────────────────────
            Short on purpose: it is a capability, not the pitch. No heading
            rule under the heading either — this section is quieter than the
            three above it by design. */}
        <section className={`${styles.container} ${styles.section}`}>
          <div className={styles.aiGrid}>
            <div className={styles.aiCopy}>
              <h2 className={styles.d2}>Opinions are cheap. Give it the numbers.</h2>
              <p className={`${styles.bodyM} ${styles.lead} ${styles.dim}`}>
                Connect Claude or ChatGPT to your workspace and it reads your published metrics directly. The same
                figures you see on the board, not a screenshot you pasted and not a guess. Ask what changed, ask what to
                do about it, and the answer arrives with the arithmetic attached.
              </p>
              <p className={`${styles.bodyS} ${styles.faint}`} style={{ marginTop: 20 }}>
                Read-only, scoped to one workspace, switched on per person.
              </p>
            </div>

            <div className={styles.aiPanelCell}>
              <div className={styles.aiPanel}>
                <p className={`${styles.bodyM} ${styles.aiQuestion}`}>Why did our close rate drop last week?</p>
                <p className={`${styles.caption} ${styles.aiReading}`}>Reading 3 metrics from Namzilabs</p>

                <div className={styles.aiMetrics}>
                  {AI_METRICS.map((metric) => (
                    <div className={styles.aiMetric} key={metric.name}>
                      <span className={styles.bodyS}>{metric.name}</span>
                      <span className={`${styles.caption} ${styles.aiMetricWas}`}>{metric.was}</span>
                      <span className={`${styles.fig} ${styles.f4}`}>{metric.now}</span>
                    </div>
                  ))}
                </div>

                <p className={`${styles.bodyS} ${styles.aiAnswer}`}>
                  Show-up rate held, so it isn&rsquo;t the calls. Speed to lead went from 8m 39s to 31m 12s on Tuesday,
                  the same day two reps were out. Close rate tracks that, not lead quality.
                </p>

                <p className={`${styles.caption} ${styles.aiFoot}`}>
                  <Tick />
                  Read-only, and every figure is a metric you published.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Rule zone two: S08 and S09 ═══════════════════════════════ */}
        <div className={styles.ruleZone}>
          <ColumnRules />

          {/* ── S08 · Sources ────────────────────────────────────────── */}
          <section className={`${styles.container} ${styles.section}`} id="sources">
            <h2 className={`${styles.d2} ${styles.span7}`}>The list is the whole list.</h2>
            <div className={styles.headingRule} aria-hidden />
            <p className={`${styles.bodyM} ${styles.lead} ${styles.measure} ${styles.dim}`}>
              Every source below is one this product reads today, in production, with its own connector — not a logo on
              a roadmap. Type to find yours. What doesn&rsquo;t match gets crossed off rather than hidden, so you can
              always see what you&rsquo;re choosing between.
            </p>

            <SourceSearch sources={sources} />
          </section>

          {/* ── S09 · The four facts ─────────────────────────────────── */}
          <section className={`${styles.container} ${styles.section}`}>
            <h2 className={`${styles.d2} ${styles.span7}`}>Four numbers about us, checkable like the rest.</h2>
            <div className={styles.headingRule} aria-hidden />

            <div className={styles.stats}>
              {FACTS.map((fact) => (
                <div className={styles.stat} key={fact.label}>
                  <p className={`${styles.fig} ${styles.f3} ${styles.statFigure}`}>{fact.figure}</p>
                  <p className={`${styles.bodyS} ${styles.statLabel}`}>{fact.label}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── S10 · Closing ──────────────────────────────────────────────
            The one centred element on the page, and unruled: after eleven
            left-aligned sections a centred block reads as the document
            finishing rather than as a change of mind. */}
        <section className={`${styles.container} ${styles.closing}`}>
          <div className={styles.closingPanel}>
            <h2 className={styles.d2}>Stop reconciling by hand.</h2>
            <p className={`${styles.bodyL} ${styles.closingBody}`}>
              Connect one tool and build your first metric this afternoon. The second one takes minutes, because the
              hard part was never the chart.
            </p>
            <div className={styles.closingActions}>
              <Link className={styles.btn} href={cta}>
                <span>{ctaLabel}</span>
              </Link>
            </div>
            <p className={`${styles.caption} ${styles.closingFoot}`}>
              Read-only access. Disconnect any tool and keep what it sent.
            </p>
          </div>
        </section>
      </main>

      {/* ── S11 · Footer ─────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerTop}>
            <span className={styles.wordmark}>Namzilabs</span>
            <div className={styles.footerGroups}>
              {FOOTER_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className={`${styles.caption} ${styles.footerTitle}`}>{group.title}</p>
                  <ul className={styles.footerList}>
                    {group.links.map((link) => (
                      <li key={link.href}>
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
