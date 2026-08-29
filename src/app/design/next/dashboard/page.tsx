/**
 * THE PROPOSED LANGUAGE, DOING A DAY'S WORK.
 *
 * The swatch board proves the tokens exist. This screen is the harder claim:
 * that "quiet chrome, loud numbers" survives a real sales-reconciliation
 * dashboard, where six tiles, a nav rail and a table all want attention at
 * once.
 *
 * What it is demonstrating, specifically:
 *
 *  · THE FACE SPLIT. Every figure, delta, target, timestamp and record count
 *    is Geist Mono; every sentence is Inter. Nothing on this page is bold —
 *    the numbers are loud because they are 40px, tabular and alone.
 *
 *  · THE RULE, IN ALL THREE STATES. Settled is one continuous hairline.
 *    Provenance is one segment per contributing source, in that source's hue,
 *    width proportional to its contribution. Variance is a hatched segment
 *    plus the conflict count at the rule's right end. The rule is always the
 *    exact width of the figure above it, which is why each figure sits in a
 *    shrink-to-fit wrapper rather than a fixed column.
 *
 *  · A DECLINE IS NOT A DISAGREEMENT. Show rate falling is `--dn-down`.
 *    Qualified rate being counted two different ways is `--dn-variance`, in
 *    parentheses, and never red.
 *
 *  · SCARCITY. There are exactly two blue things on this page — the brand
 *    mark and one inline link. The accent fills nothing. The five source hues
 *    appear only inside rule segments; they are not badges, buttons or text.
 *
 *  · CHROME AS PAGE. The sidebar and top bar are the bone canvas with a single
 *    hairline; the active nav row is a white plate, the same object as a card.
 *    Nothing here carries a shadow.
 */
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Blocks,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Workflow,
} from "lucide-react";

import "../design-next.css";

export const metadata = { title: "Namzilabs — Dashboard (proposed)" };

/* ── THE DATA ─────────────────────────────────────────────────────────────
   Static and inline on purpose: this route is a design specimen, not a
   surface of the product, and it must render identically forever. */

type Segment = {
  /** The source's share of the figure, in percent. Segments sum to 100. */
  share: number;
  /** A taxonomy hue, or the hatch. Nothing else is permitted here. */
  tone: string;
  hatched?: boolean;
};

type RuleState =
  | { kind: "settled" }
  | { kind: "provenance"; segments: Segment[] }
  | { kind: "variance"; segments: Segment[]; conflicts: number };

type Tone = "up" | "down" | "variance" | "neutral";

type Metric = {
  label: string;
  figure: string;
  rule: RuleState;
  delta: string;
  tone: Tone;
  /** Who contributed, spelled out. A machine string, so it is mono. */
  attribution: string;
  spark?: number[];
};

const TONE: Record<Tone, string> = {
  up: "var(--dn-up)",
  down: "var(--dn-down)",
  variance: "var(--dn-variance)",
  neutral: "var(--dn-ink-muted)",
};

const METRICS: Metric[] = [
  {
    label: "Calls booked",
    figure: "1,284",
    rule: {
      kind: "provenance",
      segments: [
        { share: 62, tone: "var(--dn-source-calendly)" },
        { share: 38, tone: "var(--dn-source-sheets)" },
      ],
    },
    delta: "+8.4%  ·  30d prior",
    tone: "up",
    attribution: "CALENDLY 796  ·  SHEETS 488",
  },
  {
    label: "Speed to lead",
    figure: "4m 12s",
    rule: { kind: "settled" },
    delta: "−1m 06s  ·  30d prior",
    tone: "up",
    attribution: "3 SOURCES AGREE  ·  MEDIAN OF 1,284",
  },
  {
    label: "Qualified rate",
    figure: "41.6%",
    rule: {
      kind: "variance",
      segments: [
        { share: 44, tone: "var(--dn-source-crm)" },
        { share: 34, tone: "var(--dn-surface-sunken)", hatched: true },
        { share: 22, tone: "var(--dn-source-telegram)" },
      ],
      conflicts: 3,
    },
    delta: "(−14)  ·  UNRECONCILED",
    tone: "variance",
    attribution: "CRM 41.6%  ·  TELEGRAM 44.9%  ·  3 CONFLICTS",
  },
  {
    label: "Show rate",
    figure: "78.2%",
    rule: { kind: "settled" },
    delta: "−2.1pp  ·  30d prior",
    tone: "down",
    attribution: "2 SOURCES AGREE  ·  1,004 OF 1,284",
  },
  {
    label: "Pipeline created",
    figure: "$412,900",
    rule: {
      kind: "provenance",
      segments: [
        { share: 55, tone: "var(--dn-source-crm)" },
        { share: 27, tone: "var(--dn-source-webhook)" },
        { share: 18, tone: "var(--dn-source-sheets)" },
      ],
    },
    delta: "+$38,400  ·  30d prior",
    tone: "up",
    attribution: "CRM 55  ·  WEBHOOK 27  ·  SHEETS 18",
    spark: [42, 55, 38, 61, 49, 70, 58, 66, 52, 74, 81, 92],
  },
  {
    label: "Closed won",
    figure: "$128,400",
    rule: {
      kind: "provenance",
      segments: [
        { share: 68, tone: "var(--dn-source-crm)" },
        { share: 21, tone: "var(--dn-source-telegram)" },
        { share: 11, tone: "var(--dn-source-empty)" },
      ],
    },
    delta: "+4.9%  ·  30d prior",
    tone: "up",
    attribution: "CRM 68  ·  TELEGRAM 21  ·  UNATTRIBUTED 11",
  },
];

const NAV: { label: string; icon: typeof LayoutDashboard; active?: boolean }[] = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Calendar", icon: CalendarDays },
  { label: "Activity", icon: Activity },
  { label: "Flows", icon: Workflow },
  { label: "Apps", icon: Blocks },
  { label: "Settings", icon: Settings },
];

const SOURCES: { name: string; records: string }[] = [
  { name: "Calendly", records: "1,284" },
  { name: "HubSpot", records: "1,201" },
  { name: "Google Sheets", records: "488" },
  { name: "Webhook", records: "212" },
];

/* ── THE RULE ─────────────────────────────────────────────────────────────
   One object, three states, drawn at the exact width of the figure it sits
   under. The wrapper is what guarantees that: it shrinks to the number, and
   the rule fills the wrapper. */

function TheRule({ state }: { state: RuleState }) {
  if (state.kind === "settled") return <span className="rule rule-settled" />;
  return (
    <span className="rule">
      {state.segments.map((seg, i) => (
        <span
          key={i}
          className={seg.hatched ? "rule-seg rule-variance" : "rule-seg"}
          style={{
            width: `${seg.share}%`,
            background: seg.hatched ? undefined : seg.tone,
          }}
        />
      ))}
    </span>
  );
}

function RuledFigure({
  figure,
  state,
  className,
}: {
  figure: string;
  state: RuleState;
  className: string;
}) {
  return (
    <span style={{ display: "inline-block", position: "relative" }}>
      <span className={className} style={{ display: "block" }}>
        {figure}
      </span>
      <TheRule state={state} />
      {state.kind === "variance" ? (
        <span
          className="t-mono-sm"
          style={{
            position: "absolute",
            left: "100%",
            bottom: "-4px",
            marginLeft: "var(--dn-xs)",
            color: "var(--dn-variance)",
            whiteSpace: "nowrap",
          }}
        >
          {state.conflicts}
        </span>
      ) : null}
    </span>
  );
}

/* A bar sparkline: square bars, no axis, no dots, chart tokens only — never a
   taxonomy hue, which belongs to the rule alone. */
function Sparkline({ values }: { values: number[] }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "3px",
        height: "40px",
        flex: "none",
      }}
      aria-hidden
    >
      {values.map((v, i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: "5px",
            height: `${v}%`,
            borderRadius: "var(--dn-r-none)",
            background:
              i === values.length - 1 ? "var(--dn-chart-1)" : "var(--dn-chart-2)",
          }}
        />
      ))}
    </span>
  );
}

function MetricTile({ metric }: { metric: Metric }) {
  return (
    <article
      className="plate"
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--dn-sm)",
      }}
    >
      <span className="t-eyebrow">{metric.label}</span>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "var(--dn-md)",
        }}
      >
        <RuledFigure
          figure={metric.figure}
          state={metric.rule}
          className="t-figure-lg"
        />
        {metric.spark ? <Sparkline values={metric.spark} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xxs)" }}>
        <span className="t-mono-sm" style={{ color: TONE[metric.tone] }}>
          {metric.delta}
        </span>
        <span className="t-mono-sm subtle">{metric.attribution}</span>
      </div>
    </article>
  );
}

export default function ProposedDashboardPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── TOP BAR — the page, not an object on it ───────────────────── */}
      <header
        className="topbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--dn-md)",
          padding: "0 var(--dn-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
          {/* The mark — one of the accent's four licensed uses. */}
          <span
            aria-hidden
            style={{
              width: "12px",
              height: "12px",
              background: "var(--dn-accent)",
              borderRadius: "var(--dn-r-none)",
              flex: "none",
            }}
          />
          <span className="t-subheading">Namzilabs</span>
          <span className="t-mono-sm subtle">ACME REVENUE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}>
          <button type="button" className="btn btn-ghost">
            Last 30 days
            <ChevronDown size={14} aria-hidden />
          </button>
          <button type="button" className="btn btn-primary">
            <RefreshCw size={14} aria-hidden />
            Reconcile
          </button>
        </div>
      </header>

      <div style={{ display: "flex", alignItems: "stretch", flex: 1, minHeight: 0 }}>
        {/* ── SIDEBAR — active row is a white plate, the same object as a card ── */}
        <nav
          className="sidebar"
          style={{
            flex: "none",
            padding: "var(--dn-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--dn-lg)",
            position: "sticky",
            top: "56px",
            alignSelf: "flex-start",
            height: "calc(100vh - 56px)",
          }}
        >
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            {NAV.map(({ label, icon: Icon, active }) => (
              <li key={label}>
                <span className={active ? "nav-row nav-row-active" : "nav-row"}>
                  <Icon size={15} aria-hidden />
                  {label}
                </span>
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xs)" }}>
            <span className="t-eyebrow" style={{ padding: "0 10px" }}>
              Connected
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {SOURCES.map((source) => (
                <li
                  key={source.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--dn-xs)",
                    padding: "5px 10px",
                  }}
                >
                  <span className="t-body-sm muted">{source.name}</span>
                  <span className="t-mono-sm subtle">{source.records}</span>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: "auto", padding: "0 10px" }}>
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-up)" }} />
              SYNCED 08:15
            </span>
          </div>
        </nav>

        {/* ── THE PAGE ──────────────────────────────────────────────────── */}
        <main style={{ flex: 1, minWidth: 0, padding: "var(--dn-xl) var(--dn-lg) var(--dn-section)" }}>
          <div
            style={{
              maxWidth: "1280px",
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--dn-xl)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: "var(--dn-lg)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xxs)" }}>
                <span className="t-eyebrow">01 Jul — 30 Jul 2026</span>
                <h1 className="t-title">Dashboard</h1>
                <p className="t-body muted" style={{ margin: 0, maxWidth: "56ch" }}>
                  Six sources, one answer. Where the sources disagree the figure is
                  held back and the rule beneath it is hatched.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                <span className="badge">
                  <span className="dot" style={{ background: "var(--dn-variance)" }} />
                  3 CONFLICTS
                </span>
                <span className="badge">LAST RUN 08:15:10</span>
              </div>
            </div>

            {/* ── SIX TILES ───────────────────────────────────────────── */}
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "var(--dn-md)",
              }}
            >
              {METRICS.map((metric) => (
                <MetricTile key={metric.label} metric={metric} />
              ))}
            </section>

            {/* ── RECONCILIATION ──────────────────────────────────────── */}
            <section className="plate" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: "var(--dn-md)",
                  padding: "20px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xxs)" }}>
                  <h2 className="t-heading" style={{ margin: 0 }}>
                    Reconciliation
                  </h2>
                  <p className="t-body-sm muted" style={{ margin: 0 }}>
                    Calls booked, 30 Jul. Three systems counted the same day.
                  </p>
                </div>
                <span className="badge">CALLS BOOKED · 30 JUL 2026</span>
              </div>

              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Records</th>
                    <th scope="col">Last sync</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Variance
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Calls booked
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Calendly</td>
                    <td className="num">1,284</td>
                    <td className="num">08:14:02</td>
                    <td className="num" style={{ color: "var(--dn-variance)" }}>
                      (+2)
                    </td>
                    <td className="num">84</td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                        HubSpot
                        <span className="badge">
                          <span className="dot" style={{ background: "var(--dn-stale)" }} />
                          STALE
                        </span>
                      </span>
                    </td>
                    <td className="num">1,201</td>
                    <td className="num">07:58:41</td>
                    <td className="num" style={{ color: "var(--dn-variance)" }}>
                      (−1)
                    </td>
                    <td className="num">81</td>
                  </tr>
                  {/* The totals row earns emphasis with a hairline above it and a
                      face-size switch — never with weight. */}
                  <tr>
                    <td style={{ borderTop: "1px solid var(--dn-hairline-strong)", verticalAlign: "bottom" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                        Namzilabs
                        <span className="badge">
                          <span className="dot" style={{ background: "var(--dn-up)" }} />
                          SETTLED
                        </span>
                      </span>
                    </td>
                    <td className="num" style={{ borderTop: "1px solid var(--dn-hairline-strong)", verticalAlign: "bottom" }}>
                      1,284
                    </td>
                    <td className="num" style={{ borderTop: "1px solid var(--dn-hairline-strong)", verticalAlign: "bottom" }}>
                      08:15:10
                    </td>
                    <td className="num" style={{ borderTop: "1px solid var(--dn-hairline-strong)", verticalAlign: "bottom" }}>
                      —
                    </td>
                    <td className="num" style={{ borderTop: "1px solid var(--dn-hairline-strong)", verticalAlign: "bottom" }}>
                      <RuledFigure figure="82" state={{ kind: "settled" }} className="t-figure-sm" />
                    </td>
                  </tr>
                </tbody>
              </table>

              <div
                style={{
                  padding: "var(--dn-md) 20px",
                  borderTop: "1px solid var(--dn-hairline)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--dn-md)",
                  flexWrap: "wrap",
                }}
              >
                <p className="t-body-sm muted" style={{ margin: 0, maxWidth: "72ch" }}>
                  Calendly counted two bookings twice and HubSpot missed one webhook
                  retry, so 82 is accepted and the rule beneath it closes.{" "}
                  <Link
                    href="/design/next"
                    style={{ color: "var(--dn-accent)", textDecoration: "underline" }}
                  >
                    Read the reconciliation log
                  </Link>
                </p>
                <span className="t-mono-sm subtle">RUN 8f2c14 · 412ms · 3 SOURCES</span>
              </div>
            </section>
          </div>
        </main>
      </div>

      <Link
        href="/design/next"
        className="btn btn-secondary"
        style={{
          position: "fixed",
          right: "var(--dn-lg)",
          bottom: "var(--dn-lg)",
          zIndex: 3,
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={14} aria-hidden />
        Design language
      </Link>
    </div>
  );
}
