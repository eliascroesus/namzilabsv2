import Link from "next/link";
import "./design-next.css";

/**
 * THE PROPOSED LANGUAGE, RENDERED.
 *
 * /DESIGN.md is the authority; this page is what it looks like at full size.
 * Every value here is read from the scoped custom properties in
 * design-next.css, which were copied from that document — so if the two ever
 * disagree, this page is the bug.
 *
 * IT IS A SECOND SYSTEM, DELIBERATELY QUARANTINED. `/design` still renders the
 * kit the product ships today. This route renders the replacement, in its own
 * stylesheet, under its own `.dn` scope, importing nothing from
 * `@/components/ui`. Two tabs, two systems, no memory required — which is the
 * only honest way to choose between them.
 *
 * The three example screens under this route are where the argument is
 * actually settled: a language is judged on a wall of metric tiles and a dense
 * table, not on a swatch board.
 */
export const metadata = { title: "Namzilabs — proposed design language" };

const CORE: Array<{ name: string; hex: string; token: string; use: string }> = [
  { name: "canvas", hex: "#f7f6f3", token: "--dn-canvas", use: "The page, the sidebar, the top bar" },
  { name: "surface-1", hex: "#ffffff", token: "--dn-surface-1", use: "Every card, tile, panel, table" },
  { name: "surface-2", hex: "#fbfaf8", token: "--dn-surface-2", use: "Table headers, empty grounds" },
  { name: "surface-sunken", hex: "#f2f0ec", token: "--dn-surface-sunken", use: "Badges, recessed trays" },
  { name: "hairline", hex: "#e6e3dd", token: "--dn-hairline", use: "Card and table borders" },
  { name: "hairline-strong", hex: "#d5d1c9", token: "--dn-hairline-strong", use: "Inputs, the settled rule" },
];

const INK: Array<{ name: string; hex: string; ratio: string; use: string }> = [
  { name: "ink", hex: "#14161a", ratio: "18.11:1", use: "Figures, headings, primary text" },
  { name: "body", hex: "#2b2f36", ratio: "13.44:1", use: "Body prose, table cells" },
  { name: "ink-muted", hex: "#4d525b", ratio: "7.85:1", use: "Secondary text, deltas" },
  { name: "ink-subtle", hex: "#686d77", ratio: "5.19:1", use: "Eyebrows, captions, placeholders" },
];

const SOURCES: Array<{ name: string; hex: string; token: string }> = [
  { name: "Calendly", hex: "#0d6e73", token: "--dn-source-calendly" },
  { name: "Google Sheets", hex: "#31693c", token: "--dn-source-sheets" },
  { name: "CRM", hex: "#6b3fae", token: "--dn-source-crm" },
  { name: "Webhook", hex: "#8f5d06", token: "--dn-source-webhook" },
  { name: "Telegram", hex: "#ab2f63", token: "--dn-source-telegram" },
  { name: "Contributed nothing", hex: "#d5d1c9", token: "--dn-source-empty" },
];

const TYPE: Array<{ token: string; cls: string; spec: string; sample: string }> = [
  { token: "display-lg", cls: "t-display-lg", spec: "Inter 56 / 450 / −1.68px", sample: "Numbers you can defend" },
  { token: "display-md", cls: "t-display-md", spec: "Inter 40 / 450 / −1.2px", sample: "Numbers you can defend" },
  { token: "title", cls: "t-title", spec: "Inter 28 / 500 / −0.84px", sample: "Speed to lead" },
  { token: "heading", cls: "t-heading", spec: "Inter 20 / 500 / −0.4px", sample: "Speed to lead" },
  { token: "subheading", cls: "t-subheading", spec: "Inter 16 / 500 / −0.16px", sample: "Speed to lead" },
  { token: "body", cls: "t-body", spec: "Inter 15 / 400 / 1.55", sample: "Six tools disagree; this is the answer." },
  { token: "body-sm", cls: "t-body-sm", spec: "Inter 13 / 400 / 1.50", sample: "Six tools disagree; this is the answer." },
  { token: "eyebrow", cls: "t-eyebrow", spec: "Geist Mono 11 / 500 / +0.88px", sample: "Calls booked" },
  { token: "figure-lg", cls: "t-figure-lg", spec: "Geist Mono 40 / 450 / tabular", sample: "1,204" },
  { token: "figure-md", cls: "t-figure-md", spec: "Geist Mono 28 / 450 / tabular", sample: "1,204" },
  { token: "figure-sm", cls: "t-figure-sm", spec: "Geist Mono 18 / 450 / tabular", sample: "1,204" },
  { token: "mono", cls: "t-mono", spec: "Geist Mono 13 / 450", sample: "evt_8f21c04b · 18,330ms" },
];

/** One documented specimen. */
function Row({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--dn-lg)" }}>
      <p className="t-mono-sm subtle">{label}</p>
      {note && (
        <p className="t-body-sm subtle" style={{ marginTop: 2, maxWidth: "62ch" }}>
          {note}
        </p>
      )}
      <div style={{ marginTop: "var(--dn-sm)", display: "flex", flexWrap: "wrap", gap: "var(--dn-sm)", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

function Section({ n, title, note, children }: { n: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: "var(--dn-section)" }}>
      <p className="t-eyebrow">{n}</p>
      <h2 className="t-title" style={{ marginTop: "var(--dn-xs)" }}>
        {title}
      </h2>
      <p className="t-body muted" style={{ marginTop: "var(--dn-xs)", maxWidth: "68ch" }}>
        {note}
      </p>
      <div style={{ marginTop: "var(--dn-lg)" }}>{children}</div>
    </section>
  );
}

/**
 * THE RULE, drawn three ways. This is the one component the whole language
 * turns on, so it is specified here rather than described.
 */
function Rule({ mode }: { mode: "settled" | "provenance" | "variance" }) {
  if (mode === "settled") return <div className="rule rule-settled" />;
  if (mode === "provenance")
    return (
      <div className="rule">
        <div className="rule-seg" style={{ width: "58%", background: "var(--dn-source-calendly)" }} />
        <div className="rule-seg" style={{ width: "31%", background: "var(--dn-source-sheets)" }} />
        <div className="rule-seg" style={{ width: "11%", background: "var(--dn-source-empty)" }} />
      </div>
    );
  return (
    <div className="rule">
      <div className="rule-seg" style={{ width: "46%", background: "var(--dn-source-calendly)" }} />
      <div className="rule-seg rule-variance" style={{ width: "54%" }} />
    </div>
  );
}

function Tile({
  label,
  figure,
  delta,
  tone,
  mode,
  caption,
}: {
  label: string;
  figure: string;
  delta: string;
  tone?: "up" | "down" | "variance";
  mode: "settled" | "provenance" | "variance";
  caption: string;
}) {
  const colour = tone === "up" ? "var(--dn-up)" : tone === "down" ? "var(--dn-down)" : tone === "variance" ? "var(--dn-variance)" : "var(--dn-ink-muted)";
  return (
    <div className="plate" style={{ padding: 20 }}>
      <p className="t-eyebrow">{label}</p>
      <div style={{ marginTop: "var(--dn-sm)", display: "inline-block" }}>
        <p className="t-figure-lg">{figure}</p>
        <Rule mode={mode} />
      </div>
      <p className="t-mono-sm" style={{ marginTop: "var(--dn-xs)", color: colour }}>
        {delta}
      </p>
      <p className="t-body-sm subtle" style={{ marginTop: "var(--dn-xs)" }}>
        {caption}
      </p>
    </div>
  );
}

export default function DesignNextPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--dn-section) var(--dn-lg)" }}>
        <p className="t-eyebrow">Proposal · DESIGN.md</p>
        <h1 className="t-display-md" style={{ marginTop: "var(--dn-sm)", maxWidth: "18ch" }}>
          A reconciliation instrument, typeset like a statement
        </h1>
        <p className="t-body muted" style={{ marginTop: "var(--dn-md)", maxWidth: "68ch" }}>
          Derived from all 74 files in the awesome-design-md corpus, not from anything this product looks like today.
          Bone paper carrying white plates, a near-black that does every job a brand colour usually does, one ledger
          blue that never fills anything, and every figure set in a monospace so a machine&rsquo;s answer is never
          confusable with a human&rsquo;s sentence.
        </p>

        {/* ── THE EXAMPLE SCREENS ─────────────────────────────────────── */}
        <div style={{ marginTop: "var(--dn-xl)", display: "flex", flexWrap: "wrap", gap: "var(--dn-sm)" }}>
          <Link href="/design/next/dashboard" className="btn btn-primary">
            Dashboard example
          </Link>
          <Link href="/design/next/builder" className="btn btn-secondary">
            Flow builder example
          </Link>
          <Link href="/design/next/activity" className="btn btn-secondary">
            Activity &amp; table example
          </Link>
          <Link href="/design" className="btn btn-ghost">
            Compare: the kit shipping today
          </Link>
        </div>

        {/* ── 01 THE RULE ─────────────────────────────────────────────── */}
        <Section
          n="01"
          title="The rule"
          note="The system's one signature, and the only thing in it that is decorative in form and semantic in function. A 2px line the exact width of the figure above it. It is the same physical object as the 3px leading spine on a flow node, so the dashboard and the canvas read as one machine seen from two ends."
        >
          <div style={{ display: "grid", gap: "var(--dn-md)", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div className="plate" style={{ padding: 20 }}>
              <p className="t-eyebrow">Settled</p>
              <div style={{ marginTop: "var(--dn-sm)", display: "inline-block" }}>
                <p className="t-figure-md">82</p>
                <Rule mode="settled" />
              </div>
              <p className="t-body-sm subtle" style={{ marginTop: "var(--dn-sm)" }}>
                Every connected source agrees. One continuous hairline — the way a statement rules off a column before
                its total.
              </p>
            </div>
            <div className="plate" style={{ padding: 20 }}>
              <p className="t-eyebrow">Provenance</p>
              <div style={{ marginTop: "var(--dn-sm)", display: "inline-block" }}>
                <p className="t-figure-md">1,204</p>
                <Rule mode="provenance" />
              </div>
              <p className="t-body-sm subtle" style={{ marginTop: "var(--dn-sm)" }}>
                Segmented by contributing source, width proportional to contribution. Where the number came from, at a
                glance instead of a click.
              </p>
            </div>
            <div className="plate" style={{ padding: 20 }}>
              <p className="t-eyebrow">Variance</p>
              <div style={{ marginTop: "var(--dn-sm)", display: "inline-block" }}>
                <p className="t-figure-md">
                  84 <span className="t-mono-sm subtle">(−3)</span>
                </p>
                <Rule mode="variance" />
              </div>
              <p className="t-body-sm subtle" style={{ marginTop: "var(--dn-sm)" }}>
                Sources disagree. Hatched, never red — a number going down is news; a number nobody agrees on is a bug,
                and the two must not share a colour.
              </p>
            </div>
          </div>
        </Section>

        {/* ── 02 COLOUR ───────────────────────────────────────────────── */}
        <Section
          n="02"
          title="Colour"
          note="Surfaces lift by going lighter than the page, which deletes the card-shadow question entirely. The primary action colour is the ink itself — 31 of the corpus's 64 modern systems ship an achromatic primary, and it keeps the whole chromatic budget free for data."
        >
          <p className="t-mono-sm subtle">Surface ladder</p>
          <div
            style={{
              marginTop: "var(--dn-sm)",
              display: "grid",
              gap: "var(--dn-sm)",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            }}
          >
            {CORE.map((c) => (
              <div key={c.name}>
                <div className="swatch" style={{ background: `var(${c.token})` }} />
                <p className="t-mono-sm" style={{ marginTop: 6 }}>
                  {c.name}
                </p>
                <p className="t-mono-sm subtle">{c.hex}</p>
                <p className="t-body-sm subtle" style={{ marginTop: 2 }}>
                  {c.use}
                </p>
              </div>
            ))}
          </div>

          <p className="t-mono-sm subtle" style={{ marginTop: "var(--dn-xl)" }}>
            Ink — contrast measured on #ffffff
          </p>
          <div className="plate" style={{ marginTop: "var(--dn-sm)", overflow: "hidden" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Hex</th>
                  <th style={{ textAlign: "right" }}>Contrast</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                {INK.map((i) => (
                  <tr key={i.name}>
                    <td>
                      <span className="t-mono" style={{ color: i.hex }}>
                        {i.name}
                      </span>
                    </td>
                    <td className="num">{i.hex}</td>
                    <td className="num">{i.ratio}</td>
                    <td>{i.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="t-mono-sm subtle" style={{ marginTop: "var(--dn-xl)" }}>
            The accent — #1e3f9c, 9.35:1 on white
          </p>
          <p className="t-body-sm muted" style={{ marginTop: 4, maxWidth: "68ch" }}>
            Licensed to exactly four things: the focus ring, an inline{" "}
            <span style={{ color: "var(--dn-accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>text link</span>, the
            active segment of a provenance rule, and the brand mark. Forbidden as a button fill, a card background, a
            chart series, a badge or a nav highlight. The ban list is longer than the allow list, which is the corpus&rsquo;s
            single most repeated premium signal.
          </p>

          <p className="t-mono-sm subtle" style={{ marginTop: "var(--dn-xl)" }}>
            Source taxonomy — rule segments and node spines only
          </p>
          <div style={{ marginTop: "var(--dn-sm)", display: "flex", flexWrap: "wrap", gap: "var(--dn-md)" }}>
            {SOURCES.map((s) => (
              <div key={s.name} style={{ minWidth: 132 }}>
                <div style={{ height: 4, borderRadius: 0, background: `var(${s.token})` }} />
                <p className="t-body-sm" style={{ marginTop: 6 }}>
                  {s.name}
                </p>
                <p className="t-mono-sm subtle">{s.hex}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 03 TYPE ─────────────────────────────────────────────────── */}
        <Section
          n="03"
          title="Type"
          note="Two open-licensed faces with no overlap in their jobs. Inter carries every word a human wrote; Geist Mono carries every string a machine produced. There is no weight above 500 anywhere — emphasis comes from a face switch, a size step or a surface change, never from font-weight."
        >
          <div className="plate" style={{ overflow: "hidden" }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Token</th>
                  <th style={{ width: 230 }}>Spec</th>
                  <th>Sample</th>
                </tr>
              </thead>
              <tbody>
                {TYPE.map((t) => (
                  <tr key={t.token}>
                    <td>
                      <span className="t-mono-sm">{t.token}</span>
                    </td>
                    <td>
                      <span className="t-mono-sm subtle">{t.spec}</span>
                    </td>
                    <td>
                      <span className={t.cls}>{t.sample}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-body-sm subtle" style={{ marginTop: "var(--dn-sm)", maxWidth: "68ch" }}>
            Tracking is computed as −3% of size above 28px, easing to 0 by 14px, and flipping positive on the eyebrow —
            the corpus computes it rather than picking it, and 48 of 74 files carry negative display tracking.
          </p>
        </Section>

        {/* ── 04 TILES ────────────────────────────────────────────────── */}
        <Section
          n="04"
          title="The tile"
          note="The product. An uppercase mono eyebrow, a tabular figure, the rule, and a delta that is only ever coloured when it is a genuine direction. Six of these are a dashboard, and none of them shouts."
        >
          <div style={{ display: "grid", gap: "var(--dn-md)", gridTemplateColumns: "repeat(auto-fit, minmax(232px, 1fr))" }}>
            <Tile label="Calls booked" figure="1,204" delta="+8.2% vs last 30d" tone="up" mode="provenance" caption="Calendly 58% · Sheets 31%" />
            <Tile label="Speed to lead" figure="4m 12s" delta="−31s vs last 30d" tone="up" mode="settled" caption="All sources agree" />
            <Tile label="Qualified rate" figure="38.4%" delta="−2.1% vs last 30d" tone="down" mode="settled" caption="All sources agree" />
            <Tile label="Show rate" figure="84 (−3)" delta="2 sources disagree" tone="variance" mode="variance" caption="Calendly 84 · HubSpot 81" />
          </div>
        </Section>

        {/* ── 05 CONTROLS ─────────────────────────────────────────────── */}
        <Section
          n="05"
          title="Controls"
          note="Nothing is a pill except avatars and status dots — a pill reads consumer, and this product's claim is that its numbers are auditable. There is exactly one filled button in the system and its fill is the ink."
        >
          <Row label="button" note="One filled button, and the fill is #14161a. The accent never fills.">
            <button type="button" className="btn btn-primary">
              Publish flow
            </button>
            <button type="button" className="btn btn-secondary">
              Save draft
            </button>
            <button type="button" className="btn btn-ghost">
              Cancel
            </button>
            <button type="button" className="btn btn-destructive">
              Delete
            </button>
            <button type="button" className="btn btn-primary" disabled>
              Disabled
            </button>
          </Row>

          <Row label="input" note="4px radius — the gap between 4 and 12 is what keeps controls and containers distinguishable.">
            <div style={{ maxWidth: 280, width: "100%" }}>
              <input className="input" placeholder="Search events…" aria-label="Search events" />
            </div>
          </Row>

          <Row label="badge" note="The badge is always neutral; only its dot carries the semantic colour.">
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-up)" }} /> LIVE
            </span>
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-stale)" }} /> PAUSED
            </span>
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-down)" }} /> FAILED
            </span>
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-variance)" }} /> VARIANCE
            </span>
          </Row>

          <Row label="nav-row" note="The active row is a white plate — the same object as a card, so “where I am” reuses the system's existing vocabulary instead of inventing a colour.">
            <div style={{ width: 240, background: "var(--dn-canvas)", padding: "var(--dn-xs)", borderRadius: "var(--dn-r-md)" }}>
              <div className="nav-row nav-row-active">Dashboard</div>
              <div className="nav-row">Calendar</div>
              <div className="nav-row">Activity</div>
            </div>
          </Row>

          <Row label="empty" note="One line of instruction, one action, no illustration.">
            <div className="empty" style={{ maxWidth: 420, width: "100%" }}>
              <p className="t-subheading">No events yet</p>
              <p className="t-body-sm subtle" style={{ marginTop: 6 }}>
                Connect a source and its events will appear here within a minute.
              </p>
              <button type="button" className="btn btn-primary" style={{ marginTop: "var(--dn-md)" }}>
                Connect a source
              </button>
            </div>
          </Row>
        </Section>

        {/* ── 06 THE WELL ─────────────────────────────────────────────── */}
        <Section
          n="06"
          title="The well"
          note="Depth runs downward. The flow canvas is the product's only dark surface, and it is dark because it is recessed — milled into the bone page rather than floating above it. Recession is directionally identical whichever theme you are in, so the physics never inverts."
        >
          <div className="well" style={{ padding: "var(--dn-xl)", display: "flex", gap: "var(--dn-lg)", flexWrap: "wrap" }}>
            <div className="node" style={{ width: 220, "--dn-spine": "var(--dn-source-calendly)" } as React.CSSProperties}>
              <p className="t-subheading">Get data</p>
              <p className="t-mono-sm" style={{ marginTop: 4 }}>
                calendly · invitee.created
              </p>
            </div>
            <div
              className="node node-selected"
              style={{ width: 220, "--dn-spine": "var(--dn-source-crm)" } as React.CSSProperties}
            >
              <p className="t-subheading">Match records</p>
              <p className="t-mono-sm" style={{ marginTop: 4 }}>
                on email · 1,204 matched
              </p>
            </div>
            <div className="node" style={{ width: 220, "--dn-spine": "var(--dn-source-telegram)" } as React.CSSProperties}>
              <p className="t-subheading">Output</p>
              <p className="t-mono-sm" style={{ marginTop: 4 }}>
                telegram · #revenue
              </p>
            </div>
          </div>
          <p className="t-body-sm subtle" style={{ marginTop: "var(--dn-sm)", maxWidth: "68ch" }}>
            The node card&rsquo;s own design is out of scope — this shows the ground, the spine and the chrome only. The
            3px spine is the same object as a provenance segment, in the same hue vocabulary.
          </p>
        </Section>

        {/* ── 07 DENSITY ──────────────────────────────────────────────── */}
        <Section
          n="07"
          title="Density"
          note="Every numeric cell is mono, right-aligned and tabular; every text cell is sans and left-aligned. There is no third alignment, and no zebra striping — the hairline does that job. This is the screen where the mono figures stop being a stylistic choice and start being load-bearing."
        >
          <div className="plate" style={{ overflow: "hidden" }}>
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
                {[
                  { s: "Calendly", t: "var(--dn-source-calendly)", e: "invitee.created", r: "7", d: "412ms" },
                  { s: "Google Sheets", t: "var(--dn-source-sheets)", e: "sheet.sync", r: "1,204", d: "18,330ms" },
                  { s: "CRM", t: "var(--dn-source-crm)", e: "deal.updated", r: "42", d: "1,006ms" },
                  { s: "Webhook", t: "var(--dn-source-webhook)", e: "inbound.post", r: "18,330", d: "94ms" },
                ].map((r) => (
                  <tr key={r.e}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span className="dot" style={{ background: r.t }} />
                        {r.s}
                      </span>
                    </td>
                    <td>
                      <span className="t-mono">{r.e}</span>
                    </td>
                    <td className="num">{r.r}</td>
                    <td className="num">{r.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div style={{ marginTop: "var(--dn-section)", paddingTop: "var(--dn-lg)", borderTop: "1px solid var(--dn-hairline)" }}>
          <p className="t-body-sm subtle">
            The full specification is in <span className="t-mono">/DESIGN.md</span>. When that document and this page
            disagree, the document wins and this page is the bug.
          </p>
        </div>
      </div>
    </div>
  );
}
