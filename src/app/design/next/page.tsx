import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Database,
  Filter,
  LayoutGrid,
  Search,
  Send,
  Sparkles,
  Table2,
  Zap,
} from "lucide-react";
import "./design-next.css";

/**
 * THE BOARD — the language, rendered at full size.
 *
 * The first attempt at this route was a ledger: bone paper, mono figures, 4px
 * corners, nothing heavier than 500. It was internally consistent and it was
 * lifeless. This is the replacement, and it is the playful camp — Miro, Figma,
 * Notion, Framer, Clay, Webflow — which is loud in one specific way:
 *
 *   COLOUR CLASSIFIES, BLACK ACTS. Every primary button on this page is black.
 *   The entire chromatic budget goes into whole-card pastel fills, one hue per
 *   metric family, at a 28px radius with no border. That note card is the
 *   signature; a dashboard in this language is a wall of colour, not a grid of
 *   white boxes.
 *
 *   SECTION RHYTHM. white → band → white → band → dark. Two whites in a row and
 *   the page collapses into a typography blog.
 *
 * Everything below reads from the scoped custom properties in design-next.css,
 * which were copied out of /DESIGN.md. If this page and that document ever
 * disagree, the document wins and this page is the bug.
 *
 * Quarantined under `.dn` and importing nothing from `@/components/ui`, so it
 * cannot re-theme the shipping product just by being opened.
 */
export const metadata = { title: "Namzilabs — design language" };

const PAGE = { maxWidth: 1180, margin: "0 auto", padding: "0 var(--dn-lg)" } as const;

/* ── 01 ─────────────────────────────────────────────────────────────────── */
const NOTES: Array<{
  cls: string;
  mark: string;
  family: string;
  figure: string;
  caption: string;
  spark?: number[];
}> = [
  {
    cls: "note-lilac",
    mark: "var(--dn-mark-lilac)",
    family: "Pipeline",
    figure: "1,204",
    caption: "Calls booked across Calendly, HubSpot and the inbound form — deduplicated once.",
    spark: [38, 44, 41, 52, 49, 61, 58, 72],
  },
  {
    cls: "note-mint",
    mark: "var(--dn-mark-mint)",
    family: "Conversion",
    figure: "38.4%",
    caption: "Qualified rate over the last 30 days, up from 34.1% in the 30 before it.",
  },
  {
    cls: "note-peach",
    mark: "var(--dn-mark-peach)",
    family: "Speed",
    figure: "4m 12s",
    caption: "Median speed to lead. The slowest decile still sits above forty minutes.",
  },
  {
    cls: "note-rose",
    mark: "var(--dn-mark-rose)",
    family: "Revenue",
    figure: "$284k",
    caption: "Closed-won attributed to a booked call, net of the two duplicate deals.",
  },
  {
    cls: "note-sky",
    mark: "var(--dn-mark-sky)",
    family: "Volume",
    figure: "18,330",
    caption: "Events reconciled this week across six connected sources.",
    spark: [26, 31, 29, 40, 36, 47, 55, 64],
  },
  {
    cls: "note-butter",
    mark: "var(--dn-mark-butter)",
    family: "Health",
    figure: "99.94%",
    caption: "Sync uptime. One Sheets poll retried; nothing was lost and nobody was paged.",
  },
];

/* ── 02 ─────────────────────────────────────────────────────────────────── */
const GROUND: Array<{ name: string; token: string; hex: string; use: string }> = [
  { name: "canvas", token: "--dn-canvas", hex: "#ffffff", use: "The page, the cards, the chrome" },
  { name: "band", token: "--dn-band", hex: "#f6f5f3", use: "Every other section, table headers" },
  { name: "sunken", token: "--dn-sunken", hex: "#efedea", use: "Chips, trays, recessed rows" },
  { name: "hairline", token: "--dn-hairline", hex: "#e7e4e0", use: "Card and table borders" },
  { name: "hairline-strong", token: "--dn-hairline-strong", hex: "#d6d2cc", use: "Inputs, secondary buttons" },
  { name: "dark", token: "--dn-dark", hex: "#17161c", use: "The canvas well, the inverse band" },
];

const BRAND: Array<{ name: string; token: string; hex: string; rule: string; note: string }> = [
  {
    name: "primary",
    token: "--dn-primary",
    hex: "#1a1a1a",
    rule: "Black acts",
    note: "Every primary CTA in the product is this. Nothing else fills a button by default, which is precisely what frees the rest of the palette to mean something.",
  },
  {
    name: "violet",
    token: "--dn-violet",
    hex: "#7c4dff",
    rule: "Violet marks",
    note: "Identity and selection only: the wordmark, the active nav row, the focus ring, a selected node. Never a workhorse, never a fill for ordinary UI.",
  },
  {
    name: "yellow",
    token: "--dn-yellow",
    hex: "#ffd94a",
    rule: "Yellow is the hero",
    note: "At most once on a screen — on this page it is spent on the single button in section 05. Strong enough to carry ink, so ink is what it carries.",
  },
];

const PAIRS: Array<{ name: string; note: string; noteHex: string; mark: string; markHex: string }> = [
  { name: "lilac", note: "--dn-note-lilac", noteHex: "#ece7ff", mark: "--dn-mark-lilac", markHex: "#7c4dff" },
  { name: "mint", note: "--dn-note-mint", noteHex: "#d6f2e3", mark: "--dn-mark-mint", markHex: "#12a06a" },
  { name: "peach", note: "--dn-note-peach", noteHex: "#ffe4d1", mark: "--dn-mark-peach", markHex: "#f2761f" },
  { name: "rose", note: "--dn-note-rose", noteHex: "#ffe0ec", mark: "--dn-mark-rose", markHex: "#e0417c" },
  { name: "sky", note: "--dn-note-sky", noteHex: "#ddebff", mark: "--dn-mark-sky", markHex: "#2563eb" },
  { name: "butter", note: "--dn-note-butter", noteHex: "#fff2c2", mark: "--dn-mark-butter", markHex: "#d19c00" },
];

/* ── 03 ─────────────────────────────────────────────────────────────────── */
const TYPE: Array<{ cls: string; spec: string; sample: string; job: string }> = [
  { cls: "t-hero", spec: "68 / 700 / −0.035em", sample: "One number", job: "The hero line, once per page" },
  { cls: "t-display", spec: "46 / 700 / −0.032em", sample: "Six tools disagree", job: "Section openers" },
  { cls: "t-title", spec: "30 / 650 / −0.028em", sample: "Speed to lead", job: "Panel and screen titles" },
  { cls: "t-heading", spec: "21 / 600 / −0.022em", sample: "Speed to lead", job: "Card headings" },
  { cls: "t-sub", spec: "16 / 600 / −0.014em", sample: "Match records on email", job: "Node titles, list rows" },
  { cls: "t-body", spec: "16 / 400 / 1.6", sample: "Six tools disagree; this is the answer.", job: "Prose and ledes" },
  { cls: "t-body-sm", spec: "14 / 400 / 1.55", sample: "Six tools disagree; this is the answer.", job: "Captions under a figure" },
  { cls: "t-label", spec: "12 / 600 / uppercase", sample: "Calls booked", job: "Eyebrows and column heads" },
  { cls: "t-mono", spec: "12 / 500 / mono", sample: "evt_8f21c04b · 412ms", job: "Machine strings only" },
  { cls: "t-figure", spec: "52 / 680 / tabular sans", sample: "1,204", job: "The number on a note card" },
  { cls: "t-figure-sm", spec: "32 / 680 / tabular sans", sample: "1,204", job: "The number in a dense tile" },
];

/* ── 04 ─────────────────────────────────────────────────────────────────── */
const SHAPE: Array<{ token: string; px: string; fill: string; use: string; signature?: boolean }> = [
  { token: "--dn-r-sm", px: "10px", fill: "var(--dn-note-sky)", use: "Inputs, chips, menu rows" },
  { token: "--dn-r-md", px: "16px", fill: "var(--dn-note-mint)", use: "Ordinary cards, panels, node cards" },
  { token: "--dn-r-lg", px: "28px", fill: "var(--dn-note-lilac)", use: "The note cards. The signature.", signature: true },
  { token: "--dn-r-xl", px: "36px", fill: "var(--dn-note-peach)", use: "Hero panels, the canvas well" },
];

/* ── 06 ─────────────────────────────────────────────────────────────────── */
const NODES: Array<{ title: string; meta: string; mark: string; icon: React.ReactNode; selected?: boolean }> = [
  {
    title: "Get data",
    meta: "calendly · invitee.created",
    mark: "var(--dn-mark-sky)",
    icon: <Database size={16} color="var(--dn-on-dark)" aria-hidden />,
  },
  {
    title: "Match records",
    meta: "on email · 1,204 matched",
    mark: "var(--dn-mark-lilac)",
    icon: <Filter size={16} color="var(--dn-on-dark)" aria-hidden />,
    selected: true,
  },
  {
    title: "Send output",
    meta: "telegram · #revenue",
    mark: "var(--dn-mark-rose)",
    icon: <Send size={16} color="var(--dn-on-dark)" aria-hidden />,
  },
];

/* ── 07 ─────────────────────────────────────────────────────────────────── */
const ROWS: Array<{ source: string; mark: string; event: string; records: string; duration: string }> = [
  { source: "Calendly", mark: "var(--dn-mark-sky)", event: "invitee.created", records: "7", duration: "412ms" },
  { source: "Google Sheets", mark: "var(--dn-mark-mint)", event: "sheet.sync", records: "1,204", duration: "18,330ms" },
  { source: "HubSpot", mark: "var(--dn-mark-lilac)", event: "deal.updated", records: "42", duration: "1,006ms" },
  { source: "Webhook", mark: "var(--dn-mark-peach)", event: "inbound.post", records: "18,330", duration: "94ms" },
  { source: "Telegram", mark: "var(--dn-mark-rose)", event: "message.sent", records: "3", duration: "221ms" },
];

function Section({
  n,
  kicker,
  title,
  lede,
  tone,
  children,
}: {
  n: string;
  kicker: string;
  title: string;
  lede: string;
  tone: "white" | "band";
  children: React.ReactNode;
}) {
  return (
    <section className={tone === "band" ? "band" : undefined}>
      <div style={{ ...PAGE, paddingTop: "var(--dn-section)", paddingBottom: "var(--dn-section)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
          <span className="chip chip-active">{n}</span>
          <span className="t-label">{kicker}</span>
        </div>
        <h2 className="t-display" style={{ marginTop: "var(--dn-md)", maxWidth: "22ch" }}>
          {title}
        </h2>
        <p className="t-body muted" style={{ marginTop: "var(--dn-md)", maxWidth: "70ch" }}>
          {lede}
        </p>
        <div style={{ marginTop: "var(--dn-xxl)" }}>{children}</div>
      </div>
    </section>
  );
}

function Spark({ bars, colour }: { bars: number[]; colour: string }) {
  return (
    <div className="spark" style={{ height: 44 }}>
      {bars.map((b, i) => (
        <i key={i} style={{ height: `${b}%`, background: colour }} />
      ))}
    </div>
  );
}

export default function DesignNextPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh" }}>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <header>
        <div
          style={{
            ...PAGE,
            paddingTop: "var(--dn-section)",
            paddingBottom: "var(--dn-section)",
            display: "grid",
            gap: "var(--dn-xxl)",
            gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
            alignItems: "center",
          }}
        >
          <div>
            <span className="chip chip-violet">
              <Sparkles size={14} aria-hidden />
              Design language · v2
            </span>

            <h1 className="t-hero" style={{ marginTop: "var(--dn-lg)", maxWidth: "13ch" }}>
              One number the six tools stop arguing about.
            </h1>

            <p className="t-body muted" style={{ marginTop: "var(--dn-lg)", maxWidth: "56ch" }}>
              Calendly says 84. HubSpot says 81. The sheet somebody maintains by hand says 79. Namzilabs reconciles all
              six and puts the settled figure on a card you can read across the room. This is the language that card is
              built in: black does the acting, colour does the classifying, and every metric family gets a hue it keeps
              forever.
            </p>

            <div style={{ marginTop: "var(--dn-xl)", display: "flex", flexWrap: "wrap", gap: "var(--dn-sm)" }}>
              <a href="/design/next/dashboard" className="btn btn-primary btn-lg">
                Dashboard example
                <ArrowRight size={17} aria-hidden />
              </a>
              <a href="/design/next/builder" className="btn btn-secondary btn-lg">
                Flow builder
              </a>
              <a href="/design/next/activity" className="btn btn-secondary btn-lg">
                Activity &amp; table
              </a>
              <a href="/design" className="btn btn-ghost btn-lg">
                The kit shipping today
              </a>
            </div>
          </div>

          {/* The product is the illustration: the wall of colour, in miniature. */}
          <div
            style={{
              display: "grid",
              gap: "var(--dn-md)",
              gridTemplateColumns: "1fr 1fr",
              padding: "var(--dn-lg)",
              background: "var(--dn-band)",
              borderRadius: "var(--dn-r-xl)",
            }}
          >
            <div className="note note-lilac" style={{ transform: "rotate(-1.2deg)", boxShadow: "var(--dn-lift)" }}>
              <p className="t-label" style={{ color: "var(--dn-ink)" }}>
                Calls booked
              </p>
              <p className="t-figure-sm" style={{ marginTop: "var(--dn-sm)" }}>
                1,204
              </p>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
                +8.2% vs last 30d
              </p>
            </div>
            <div className="note note-mint" style={{ transform: "rotate(1deg)", boxShadow: "var(--dn-lift)" }}>
              <p className="t-label" style={{ color: "var(--dn-ink)" }}>
                Qualified
              </p>
              <p className="t-figure-sm" style={{ marginTop: "var(--dn-sm)" }}>
                38.4%
              </p>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
                up from 34.1%
              </p>
            </div>
            <div className="note note-peach" style={{ transform: "rotate(0.8deg)", boxShadow: "var(--dn-lift)" }}>
              <p className="t-label" style={{ color: "var(--dn-ink)" }}>
                Speed to lead
              </p>
              <p className="t-figure-sm" style={{ marginTop: "var(--dn-sm)" }}>
                4m 12s
              </p>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
                −31s vs last 30d
              </p>
            </div>
            <div className="note note-sky" style={{ transform: "rotate(-0.6deg)", boxShadow: "var(--dn-lift)" }}>
              <p className="t-label" style={{ color: "var(--dn-ink)" }}>
                Events
              </p>
              <div style={{ marginTop: "var(--dn-sm)" }}>
                <Spark bars={[30, 38, 34, 46, 52, 44, 63, 78]} colour="var(--dn-mark-sky)" />
              </div>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xs)" }}>
                18,330 this week
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ── 01 THE NOTE CARDS ────────────────────────────────────────────── */}
      <Section
        n="01"
        kicker="The signature"
        tone="band"
        title="The note card, and the wall it builds"
        lede="A whole-card pastel fill at 28px with no border — the object the entire system is organised around. One hue per metric family, held for the life of the account, so a person learns where revenue lives the way they learn where a light switch is. Six of these side by side are a dashboard, and the colour is doing the classifying that a legend would otherwise have to do."
      >
        <div style={{ display: "grid", gap: "var(--dn-lg)", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {NOTES.map((note) => (
            <div key={note.family} className={`note ${note.cls}`} style={{ padding: "var(--dn-xl)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                <span className="dot" style={{ background: note.mark }} />
                <span className="t-label" style={{ color: "var(--dn-ink)" }}>
                  {note.family}
                </span>
              </div>
              <p className="t-figure" style={{ marginTop: "var(--dn-lg)" }}>
                {note.figure}
              </p>
              {note.spark && (
                <div style={{ marginTop: "var(--dn-md)" }}>
                  <Spark bars={note.spark} colour={note.mark} />
                </div>
              )}
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-md)" }}>
                {note.caption}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "var(--dn-xl)",
            display: "grid",
            gap: "var(--dn-lg)",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <div>
            <p className="t-sub">Hue means family, never severity</p>
            <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
              Rose is revenue whether revenue is up or down. Direction is carried by the delta text in{" "}
              <span style={{ color: "var(--dn-up)", fontWeight: 600 }}>up</span> or{" "}
              <span style={{ color: "var(--dn-down)", fontWeight: 600 }}>down</span>, never by repainting the card.
            </p>
          </div>
          <div>
            <p className="t-sub">The figure is sans, not mono</p>
            <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
              52px at weight 680, tabular so it does not twitch when it refreshes. Mono figures were the last system&rsquo;s
              tell, and they made a product look like a log viewer.
            </p>
          </div>
          <div>
            <p className="t-sub">No border, ever</p>
            <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
              A sticky note does not have one. The fill separates the card from the band; adding a hairline on top of it
              is the move that turns a board back into a spreadsheet.
            </p>
          </div>
        </div>
      </Section>

      {/* ── 02 COLOUR ────────────────────────────────────────────────────── */}
      <Section
        n="02"
        kicker="Colour"
        tone="white"
        title="Three that carry the brand, twelve that carry the data"
        lede="The ground is warm neutral and almost invisible. The brand is three colours with three separate jobs and no overlap. The working palette is six pastel fills and their six saturated twins — the pastel fills a card, the twin never does; it is a dot, a spine, a sparkline bar, a chart series."
      >
        <p className="t-label">Ground</p>
        <div
          style={{
            marginTop: "var(--dn-md)",
            display: "grid",
            gap: "var(--dn-md)",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          }}
        >
          {GROUND.map((g) => (
            <div key={g.name}>
              <div
                className="swatch"
                style={{ background: `var(${g.token})`, border: "1px solid var(--dn-hairline)" }}
              />
              <p className="t-sub" style={{ marginTop: "var(--dn-xs)" }}>
                {g.name}
              </p>
              <p className="t-mono">{g.hex}</p>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
                {g.use}
              </p>
            </div>
          ))}
        </div>

        <p className="t-label" style={{ marginTop: "var(--dn-xxl)" }}>
          The three that carry the brand
        </p>
        <div
          style={{
            marginTop: "var(--dn-md)",
            display: "grid",
            gap: "var(--dn-lg)",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          {BRAND.map((b) => (
            <div key={b.name} className="card" style={{ padding: "var(--dn-lg)" }}>
              <div
                className="swatch"
                style={{ background: `var(${b.token})`, height: 104, borderRadius: "var(--dn-r-lg)" }}
              />
              <p className="t-heading" style={{ marginTop: "var(--dn-md)" }}>
                {b.rule}
              </p>
              <p className="t-mono" style={{ marginTop: "var(--dn-xxs)" }}>
                {b.token} · {b.hex}
              </p>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xs)" }}>
                {b.note}
              </p>
            </div>
          ))}
        </div>

        <p className="t-label" style={{ marginTop: "var(--dn-xxl)" }}>
          The note family and its saturated twins
        </p>
        <div
          style={{
            marginTop: "var(--dn-md)",
            display: "grid",
            gap: "var(--dn-md)",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          }}
        >
          {PAIRS.map((p) => (
            <div key={p.name}>
              <div
                className="swatch"
                style={{
                  background: `var(${p.note})`,
                  height: 104,
                  borderRadius: "var(--dn-r-lg)",
                  display: "flex",
                  alignItems: "flex-end",
                  padding: "var(--dn-sm)",
                  gap: 6,
                }}
              >
                <span style={{ width: 26, height: 26, borderRadius: "var(--dn-r-full)", background: `var(${p.mark})` }} />
                <span style={{ width: 10, height: 26, borderRadius: 4, background: `var(${p.mark})` }} />
                <span style={{ width: 10, height: 16, borderRadius: 4, background: `var(${p.mark})`, opacity: 0.45 }} />
              </div>
              <p className="t-sub" style={{ marginTop: "var(--dn-xs)" }}>
                {p.name}
              </p>
              <p className="t-mono">
                {p.noteHex} · {p.markHex}
              </p>
            </div>
          ))}
        </div>

        <p className="t-body-sm muted" style={{ marginTop: "var(--dn-lg)", maxWidth: "70ch" }}>
          State colours sit outside all of this and are used only on words:{" "}
          <span style={{ color: "var(--dn-up)", fontWeight: 600 }}>--dn-up</span>,{" "}
          <span style={{ color: "var(--dn-down)", fontWeight: 600 }}>--dn-down</span>,{" "}
          <span style={{ color: "var(--dn-warn)", fontWeight: 600 }}>--dn-warn</span>, each with a wash for the rare
          banner that needs one, and --dn-up-on-note for the delta that has to sit on a pastel.
        </p>
      </Section>

      {/* ── 03 TYPE ──────────────────────────────────────────────────────── */}
      <Section
        n="03"
        kicker="Type"
        tone="band"
        title="One face, real weight, and a mono that only machines are allowed to use"
        lede="Inter carries everything a human wrote, up to 700 at the top of the scale — capping the last system at 500 was most of why it read as furniture. The mono is reserved for strings a machine produced: event ids, durations, tokens. Figures are sans, because a figure is the answer, not a readout."
      >
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Class</th>
                <th style={{ width: 200 }}>Spec</th>
                <th>Sample</th>
                <th style={{ width: 230 }}>Job</th>
              </tr>
            </thead>
            <tbody>
              {TYPE.map((t) => (
                <tr key={t.cls}>
                  <td className="t-mono">.{t.cls}</td>
                  <td className="t-mono">{t.spec}</td>
                  <td>
                    <span className={t.cls}>{t.sample}</span>
                  </td>
                  <td>{t.job}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="t-body-sm muted" style={{ marginTop: "var(--dn-md)", maxWidth: "70ch" }}>
          Tracking tightens as size grows — −0.035em at the hero, easing to zero by the time it reaches the mono — and
          the label is the only thing in the system that tracks positive.
        </p>
      </Section>

      {/* ── 04 SHAPE ─────────────────────────────────────────────────────── */}
      <Section
        n="04"
        kicker="Shape"
        tone="white"
        title="Four radii, and the big one is the whole point"
        lede="A single small radius everywhere is what makes an interface read as a form. The gap between the 10px control and the 28px note card is doing real work: it tells you instantly whether you are looking at something you operate or something you read."
      >
        <div style={{ display: "grid", gap: "var(--dn-lg)", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          {SHAPE.map((s) => (
            <div key={s.token}>
              <div
                style={{
                  height: 170,
                  background: s.fill,
                  borderRadius: `var(${s.token})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: s.signature ? "var(--dn-lift-hover)" : "none",
                }}
              >
                <span className="t-figure-sm">{s.px}</span>
              </div>
              <p className="t-mono" style={{ marginTop: "var(--dn-sm)" }}>
                {s.token}
              </p>
              <p className={s.signature ? "t-sub" : "t-body-sm muted"} style={{ marginTop: "var(--dn-xxs)" }}>
                {s.use}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "var(--dn-xl)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--dn-md)",
          }}
        >
          <div
            style={{
              height: 48,
              width: 190,
              borderRadius: "var(--dn-r-full)",
              background: "var(--dn-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--dn-on-dark)",
            }}
          >
            <span className="t-sub" style={{ color: "var(--dn-on-dark)" }}>
              --dn-r-full
            </span>
          </div>
          <p className="t-body-sm muted" style={{ maxWidth: "52ch" }}>
            Buttons, chips, avatars and dots are fully round. Nothing else is — a pill container would compete with the
            controls, and the controls have to win.
          </p>
        </div>
      </Section>

      {/* ── 05 CONTROLS ──────────────────────────────────────────────────── */}
      <Section
        n="05"
        kicker="Controls"
        tone="band"
        title="Pills that act, chips that classify"
        lede="Every button is a pill, and the filled black one is the action on the screen. Violet appears on a control only where the control is about identity or selection. The yellow button below is the single hero on this page; spending it twice is the fastest way to make the system look like a toy."
      >
        <div style={{ display: "grid", gap: "var(--dn-lg)", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div className="card" style={{ padding: "var(--dn-lg)" }}>
            <p className="t-label">Buttons · variants</p>
            <div style={{ marginTop: "var(--dn-md)", display: "flex", flexWrap: "wrap", gap: "var(--dn-sm)" }}>
              <a href="/design/next/dashboard" className="btn btn-primary">
                Publish flow
              </a>
              <a href="/design/next/builder" className="btn btn-secondary">
                Save draft
              </a>
              <a href="/design/next/builder" className="btn btn-violet">
                Invite teammate
              </a>
              <a href="/design/next/dashboard" className="btn btn-yellow">
                <Zap size={16} aria-hidden />
                Run now
              </a>
              <a href="/design" className="btn btn-ghost">
                Cancel
              </a>
            </div>

            <p className="t-label" style={{ marginTop: "var(--dn-xl)" }}>
              Buttons · sizes
            </p>
            <div
              style={{ marginTop: "var(--dn-md)", display: "flex", flexWrap: "wrap", gap: "var(--dn-sm)", alignItems: "center" }}
            >
              <a href="/design/next/dashboard" className="btn btn-primary btn-lg">
                Large
              </a>
              <a href="/design/next/dashboard" className="btn btn-primary">
                Default
              </a>
              <a href="/design/next/dashboard" className="btn btn-primary btn-sm">
                Small
              </a>
              <a href="/design/next/activity" className="btn btn-secondary btn-sm">
                Small secondary
                <ArrowUpRight size={15} aria-hidden />
              </a>
            </div>

            <p className="t-label" style={{ marginTop: "var(--dn-xl)" }}>
              Input
            </p>
            <div style={{ marginTop: "var(--dn-md)", maxWidth: 340, position: "relative" }}>
              <input className="input" placeholder="Search events, sources, flows" aria-label="Search" />
            </div>
            <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xs)" }}>
              10px radius, 1.5px rule, and a violet focus ring — the only place violet touches an ordinary control.
            </p>
          </div>

          <div className="card" style={{ padding: "var(--dn-lg)" }}>
            <p className="t-label">Chips</p>
            <div style={{ marginTop: "var(--dn-md)", display: "flex", flexWrap: "wrap", gap: "var(--dn-xs)" }}>
              <span className="chip">All sources</span>
              <span className="chip chip-active">Last 30 days</span>
              <span className="chip chip-violet">
                <Sparkles size={13} aria-hidden />
                Reconciled
              </span>
              <span className="chip chip-yellow">Beta</span>
              <span className="chip chip-outline">Add filter</span>
            </div>

            <p className="t-label" style={{ marginTop: "var(--dn-xl)" }}>
              Dots · the mark colours doing their real job
            </p>
            <div style={{ marginTop: "var(--dn-md)", display: "flex", flexWrap: "wrap", gap: "var(--dn-md)" }}>
              {PAIRS.map((p) => (
                <span key={p.name} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span className="dot" style={{ background: `var(${p.mark})` }} />
                  <span className="t-body-sm">{p.name}</span>
                </span>
              ))}
            </div>

            <p className="t-label" style={{ marginTop: "var(--dn-xl)" }}>
              Nav rows
            </p>
            <div
              style={{
                marginTop: "var(--dn-md)",
                maxWidth: 280,
                background: "var(--dn-surface)",
                borderRadius: "var(--dn-r-md)",
                padding: "var(--dn-xxs)",
              }}
            >
              <div className="nav-row nav-row-active">
                <span className="nav-icon" style={{ background: "var(--dn-violet)" }}>
                  <LayoutGrid size={15} color="var(--dn-on-dark)" aria-hidden />
                </span>
                Dashboard
              </div>
              <div className="nav-row">
                <span className="nav-icon" style={{ background: "var(--dn-note-sky)" }}>
                  <CalendarDays size={15} color="var(--dn-mark-sky)" aria-hidden />
                </span>
                Calendar
              </div>
              <div className="nav-row">
                <span className="nav-icon" style={{ background: "var(--dn-note-peach)" }}>
                  <Bell size={15} color="var(--dn-mark-peach)" aria-hidden />
                </span>
                Alerts
              </div>
            </div>

            <p className="t-label" style={{ marginTop: "var(--dn-xl)" }}>
              Empty
            </p>
            <div className="empty" style={{ marginTop: "var(--dn-md)", padding: "var(--dn-xl)" }}>
              <p className="t-heading">No events yet</p>
              <p className="t-body-sm muted" style={{ marginTop: "var(--dn-xxs)" }}>
                Connect a source and its events appear here within a minute.
              </p>
              <a href="/design/next/builder" className="btn btn-primary" style={{ marginTop: "var(--dn-md)" }}>
                Connect a source
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 06 THE CANVAS ────────────────────────────────────────────────── */}
      <Section
        n="06"
        kicker="The canvas"
        tone="white"
        title="One dark surface, and it is the board"
        lede="The flow builder is the only dark thing in the product, because it is a workspace rather than a document — a dotted well at 36px, cards floating on it, and the same hue vocabulary marking each step kind that marks each metric family on the light side. Selection is violet, exactly as it is in the nav."
      >
        <div
          className="well"
          style={{
            padding: "var(--dn-xxl)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--dn-md)",
          }}
        >
          {NODES.map((node, i) => (
            <div key={node.title} style={{ display: "flex", alignItems: "center", gap: "var(--dn-md)" }}>
              <div className={node.selected ? "node node-selected" : "node"} style={{ width: 230 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
                  <span className="node-mark" style={{ background: node.mark }}>
                    {node.icon}
                  </span>
                  <div>
                    <p className="t-sub">{node.title}</p>
                    <p className="t-mono" style={{ marginTop: 2 }}>
                      {node.meta}
                    </p>
                  </div>
                </div>
              </div>
              {i < NODES.length - 1 && <ArrowRight size={18} color="var(--dn-dark-edge)" aria-hidden />}
            </div>
          ))}
        </div>
        <p className="t-body-sm muted" style={{ marginTop: "var(--dn-md)", maxWidth: "70ch" }}>
          The node&rsquo;s own anatomy is out of scope here — this shows the ground, the step mark and the selected state
          only. The mark is a filled square at a 9px radius in the step&rsquo;s colour, which is the same trick the note
          card plays, one size down.
        </p>
      </Section>

      {/* ── 07 DENSITY ───────────────────────────────────────────────────── */}
      <Section
        n="07"
        kicker="Density"
        tone="band"
        title="Where the colour stops and the hairline takes over"
        lede="A table is the one place the wall of colour would be noise, so the pastels retreat to a single dot per row and every numeric cell goes tabular and right-aligned. No zebra striping — the hairline already does that job, and stripes plus dots plus figures is three systems fighting for the same row."
      >
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Source</th>
                <th>Event</th>
                <th style={{ textAlign: "right" }}>Records</th>
                <th style={{ textAlign: "right" }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.event}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                      <span className="dot" style={{ background: r.mark }} />
                      {r.source}
                    </span>
                  </td>
                  <td className="t-mono">{r.event}</td>
                  <td className="num">{r.records}</td>
                  <td className="num">{r.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: "var(--dn-xl)",
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--dn-md)",
            alignItems: "center",
          }}
        >
          <span className="chip chip-outline">
            <Table2 size={14} aria-hidden />
            18,330 rows
          </span>
          <span className="chip">
            <Search size={14} aria-hidden />
            Filtered to 6 sources
          </span>
          <span className="chip chip-violet">Reconciled 2 minutes ago</span>
        </div>
      </Section>

      {/* ── CLOSER ───────────────────────────────────────────────────────── */}
      <footer className="band-dark">
        <div style={{ ...PAGE, paddingTop: "var(--dn-section)", paddingBottom: "var(--dn-section)" }}>
          <h2 className="t-title" style={{ maxWidth: "22ch" }}>
            The document is the authority. This page is the bug.
          </h2>
          <p className="t-body" style={{ marginTop: "var(--dn-md)", maxWidth: "68ch", color: "var(--dn-on-dark)", opacity: 0.74 }}>
            The full specification lives in <span className="t-mono" style={{ color: "var(--dn-on-dark)" }}>/DESIGN.md</span>. Every
            token on this page is read from it. When the two disagree, the document wins and this page gets fixed —
            never the other way round.
          </p>
          <div style={{ marginTop: "var(--dn-xl)", display: "flex", flexWrap: "wrap", gap: "var(--dn-sm)" }}>
            <a href="/design/next/dashboard" className="btn btn-secondary">
              Dashboard example
            </a>
            <a href="/design/next/builder" className="btn btn-secondary">
              Flow builder
            </a>
            <a href="/design/next/activity" className="btn btn-secondary">
              Activity &amp; table
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
