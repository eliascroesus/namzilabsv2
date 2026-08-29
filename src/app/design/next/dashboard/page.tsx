/**
 * THE BOARD, DOING A DAY'S WORK.
 *
 * The swatch page proves the tokens exist. This screen is the harder claim:
 * that a real sales-reconciliation dashboard — six metrics, a nav rail, a
 * source table and a promo band — comes out of this language looking like Miro
 * or Figma rather than an accounting export.
 *
 * The four moves, on one page:
 *
 *  · COLOUR CLASSIFIES, BLACK ACTS. Every metric family owns a pastel and
 *    keeps it everywhere it appears: calls booked is lilac in the tile, lilac
 *    in its sparkbars, lilac on its source dot. The only saturated buttons on
 *    the page are one yellow hero and one black CTA.
 *  · THE NOTE CARD IS THE SIGNATURE. All six tiles are whole-card pastel fills
 *    at 28px, no border. The metric grid is a wall of colour — that is the
 *    point of it, not a decoration on top of it.
 *  · SECTION RHYTHM. notes → .band (sources) → white (conflicts) → .band-dark.
 *    No two whites touch.
 *  · VIOLET IS IDENTITY. The wordmark chip, the active nav row, the focus ring.
 *    It is never used to mean "good" or "primary".
 *
 * Static data, no imports from the app: this route is a specimen and must
 * render identically forever.
 */
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  Plus,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";

import "../design-next.css";

export const metadata = { title: "Namzilabs — Dashboard" };

/* ── THE DATA ─────────────────────────────────────────────────────────── */

type Metric = {
  label: string;
  figure: string;
  note: string;
  /** The saturated twin of `note` — sparkbars, delta glyph tint, source dot. */
  mark: string;
  delta: string;
  against: string;
  direction: "up" | "down";
  /** Bar heights, 0–100. Present on exactly two tiles. */
  spark?: number[];
};

const METRICS: Metric[] = [
  {
    label: "Calls booked",
    figure: "1,284",
    note: "var(--dn-note-lilac)",
    mark: "var(--dn-mark-lilac)",
    delta: "+8.4%",
    against: "vs. 1,184 prior 30d",
    direction: "up",
    spark: [38, 52, 44, 61, 49, 58, 71, 64, 78, 69, 86, 100],
  },
  {
    label: "Speed to lead",
    figure: "4m 12s",
    note: "var(--dn-note-mint)",
    mark: "var(--dn-mark-mint)",
    delta: "−1m 06s",
    against: "median first touch",
    direction: "up",
  },
  {
    label: "Qualified rate",
    figure: "41.6%",
    note: "var(--dn-note-peach)",
    mark: "var(--dn-mark-peach)",
    delta: "+2.3pp",
    against: "534 of 1,284 calls",
    direction: "up",
  },
  {
    label: "Show rate",
    figure: "78.2%",
    note: "var(--dn-note-rose)",
    mark: "var(--dn-mark-rose)",
    delta: "−2.1pp",
    against: "1,004 of 1,284 held",
    direction: "down",
  },
  {
    label: "Pipeline created",
    figure: "$412,900",
    note: "var(--dn-note-sky)",
    mark: "var(--dn-mark-sky)",
    delta: "+$38,400",
    against: "vs. $374,500 prior 30d",
    direction: "up",
    spark: [44, 39, 57, 51, 66, 60, 72, 55, 81, 74, 88, 100],
  },
  {
    label: "Closed won",
    figure: "$128,400",
    note: "var(--dn-note-butter)",
    mark: "var(--dn-mark-butter)",
    delta: "+4.9%",
    against: "17 deals · $7,553 avg",
    direction: "up",
  },
];

const NAV: {
  label: string;
  icon: typeof LayoutDashboard;
  tint: string;
  ink: string;
  active?: boolean;
}[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    tint: "var(--dn-note-lilac)",
    ink: "var(--dn-mark-lilac)",
    active: true,
  },
  {
    label: "Calendar",
    icon: CalendarDays,
    tint: "var(--dn-note-sky)",
    ink: "var(--dn-mark-sky)",
  },
  {
    label: "Activity",
    icon: Activity,
    tint: "var(--dn-note-mint)",
    ink: "var(--dn-mark-mint)",
  },
  {
    label: "Flows",
    icon: Workflow,
    tint: "var(--dn-note-peach)",
    ink: "var(--dn-mark-peach)",
  },
  {
    label: "Apps",
    icon: Blocks,
    tint: "var(--dn-note-rose)",
    ink: "var(--dn-mark-rose)",
  },
  {
    label: "Settings",
    icon: Settings,
    tint: "var(--dn-note-butter)",
    ink: "var(--dn-mark-butter)",
  },
];

const SOURCES: {
  name: string;
  kind: string;
  records: string;
  synced: string;
  mark: string;
  status: string;
  chip: string;
}[] = [
  {
    name: "Calendly",
    kind: "Bookings",
    records: "1,284",
    synced: "08:15:10",
    mark: "var(--dn-mark-lilac)",
    status: "Synced",
    chip: "chip",
  },
  {
    name: "HubSpot",
    kind: "Deals · contacts",
    records: "1,201",
    synced: "08:14:02",
    mark: "var(--dn-mark-sky)",
    status: "Synced",
    chip: "chip",
  },
  {
    name: "Google Sheets",
    kind: "Manual log",
    records: "488",
    synced: "08:12:44",
    mark: "var(--dn-mark-mint)",
    status: "Synced",
    chip: "chip",
  },
  {
    name: "Twilio",
    kind: "Call records",
    records: "2,940",
    synced: "08:15:08",
    mark: "var(--dn-mark-peach)",
    status: "Syncing",
    chip: "chip chip-violet",
  },
  {
    name: "Stripe",
    kind: "Payments",
    records: "342",
    synced: "07:41:19",
    mark: "var(--dn-mark-butter)",
    status: "Stale · 34m",
    chip: "chip chip-yellow",
  },
  {
    name: "Inbound webhook",
    kind: "Raw events",
    records: "212",
    synced: "—",
    mark: "var(--dn-mark-rose)",
    status: "Paused",
    chip: "chip chip-outline",
  },
];

const CONFLICTS: { title: string; detail: string; note: string }[] = [
  {
    title: "Calendly counted 2 bookings twice",
    detail: "30 Jul · webhook retry after a 502, same event id",
    note: "var(--dn-note-lilac)",
  },
  {
    title: "HubSpot is missing 1 call",
    detail: "30 Jul · created in Twilio at 16:41, never reached the deal",
    note: "var(--dn-note-peach)",
  },
  {
    title: "Qualified rate counted two ways",
    detail: "CRM says 41.6%, the manual log says 44.9%",
    note: "var(--dn-note-mint)",
  },
];

/* ── PIECES ───────────────────────────────────────────────────────────── */

function Spark({ values, mark }: { values: number[]; mark: string }) {
  return (
    <span className="spark" style={{ height: "44px" }} aria-hidden>
      {values.map((v, i) => (
        <i
          key={i}
          style={{
            height: `${v}%`,
            background: mark,
            opacity: i === values.length - 1 ? 1 : 0.42,
          }}
        />
      ))}
    </span>
  );
}

function MetricTile({ metric }: { metric: Metric }) {
  const Arrow = metric.direction === "up" ? ArrowUpRight : ArrowDownRight;
  /* The delta stands on a PASTEL, so up takes its note-ground twin: plain
     --dn-up is under AA on five of the six fills (4.29:1 on rose). Down is
     4.55:1 at worst and needs no twin. */
  const deltaInk =
    metric.direction === "up" ? "var(--dn-up-on-note)" : "var(--dn-down)";

  return (
    <article
      className="note"
      style={{
        background: metric.note,
        padding: "var(--dn-lg)",
        minHeight: "216px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--dn-md)",
        boxShadow: "var(--dn-lift)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--dn-sm)",
        }}
      >
        <span className="t-label" style={{ color: "var(--dn-ink)" }}>
          {metric.label}
        </span>
        <span
          aria-hidden
          className="dot"
          style={{ background: metric.mark, width: "11px", height: "11px" }}
        />
      </div>

      <div style={{ marginTop: "auto" }}>
        <span className="t-figure" style={{ display: "block" }}>
          {metric.figure}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "var(--dn-md)",
        }}
      >
        <span
          style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}
        >
          <span
            className="t-sub"
            style={{
              color: deltaInk,
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--dn-xxs)",
            }}
          >
            <Arrow size={16} aria-hidden />
            {metric.delta}
          </span>
          <span className="t-body-sm" style={{ color: "var(--dn-body)" }}>
            {metric.against}
          </span>
        </span>
        {metric.spark ? <Spark values={metric.spark} mark={metric.mark} /> : null}
      </div>
    </article>
  );
}

/* ── THE SCREEN ───────────────────────────────────────────────────────── */

export default function DesignNextDashboardPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh" }}>
      {/* ── TOP BAR ─────────────────────────────────────────────────── */}
      <header
        className="topbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--dn-md)",
          padding: "0 var(--dn-lg)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "var(--dn-md)" }}
        >
          <span
            style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}
          >
            {/* The mark. Violet is identity, and this is the first of its
                three appearances on the page. */}
            <span
              aria-hidden
              style={{
                width: "26px",
                height: "26px",
                borderRadius: "9px",
                background: "var(--dn-violet)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <Sparkles size={15} color="var(--dn-on-dark)" aria-hidden />
            </span>
            <span className="t-sub" style={{ fontSize: "17px" }}>
              Namzilabs
            </span>
          </span>
          <span className="chip chip-violet">
            Acme Revenue
            <ChevronDown size={14} aria-hidden />
          </span>
        </div>

        <div
          style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}
        >
          <a href="/design/next" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
            Last 30 days
            <ChevronDown size={14} aria-hidden />
          </a>
          {/* THE HERO. Exactly one yellow on this screen. */}
          <a href="/design/next" className="btn btn-yellow" style={{ textDecoration: "none" }}>
            <Plus size={16} aria-hidden />
            New flow
          </a>
        </div>
      </header>

      <div style={{ display: "flex", alignItems: "stretch" }}>
        {/* ── SIDEBAR ──────────────────────────────────────────────── */}
        <nav
          className="sidebar"
          style={{
            flex: "none",
            padding: "var(--dn-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--dn-lg)",
            position: "sticky",
            top: "64px",
            alignSelf: "flex-start",
            height: "calc(100vh - 64px)",
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
            {NAV.map(({ label, icon: Icon, tint, ink, active }) => (
              <li key={label}>
                <a
                  href="/design/next"
                  className={active ? "nav-row nav-row-active" : "nav-row"}
                  style={{ textDecoration: "none" }}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="nav-icon" style={{ background: tint }}>
                    <Icon size={15} color={ink} aria-hidden />
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ul>

          {/* A note card in the rail, so the colour does not stop at the
              content edge. */}
          <div
            className="note note-mint"
            style={{
              marginTop: "auto",
              padding: "var(--dn-md)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--dn-xs)",
            }}
          >
            <span className="t-label" style={{ color: "var(--dn-ink)" }}>
              Reconciled
            </span>
            <span className="t-figure-sm">08:15</span>
            <span className="t-body-sm" style={{ color: "var(--dn-body)" }}>
              6 sources · 412ms · run 8f2c14
            </span>
            <a
              href="/design/next"
              className="btn btn-primary btn-sm"
              style={{ marginTop: "var(--dn-xxs)", textDecoration: "none", alignSelf: "flex-start" }}
            >
              Run again
            </a>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>
          {/* ── WHITE: TITLE + THE WALL OF COLOUR ─────────────────── */}
          <section
            style={{
              padding: "var(--dn-xxl) var(--dn-xl) var(--dn-section)",
            }}
          >
            <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: "var(--dn-lg)",
                  flexWrap: "wrap",
                  marginBottom: "var(--dn-lg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--dn-xs)",
                  }}
                >
                  <span className="t-label">01 Jul — 30 Jul 2026</span>
                  <h1 className="t-display" style={{ margin: 0 }}>
                    Good morning, Elias
                  </h1>
                  <p
                    className="t-body muted"
                    style={{ margin: 0, maxWidth: "54ch" }}
                  >
                    Six systems counted last month. Namzilabs settled all but
                    three of the disagreements before you woke up.
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--dn-xs)",
                  }}
                >
                  <a
                    href="/design/next"
                    className="btn btn-secondary"
                    style={{ textDecoration: "none" }}
                  >
                    Export
                  </a>
                  <a
                    href="/design/next"
                    className="btn btn-primary"
                    style={{ textDecoration: "none" }}
                  >
                    Reconcile now
                    <ArrowRight size={16} aria-hidden />
                  </a>
                </div>
              </div>

              {/* Filters */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--dn-xs)",
                  flexWrap: "wrap",
                  marginBottom: "var(--dn-xl)",
                }}
              >
                <span className="chip chip-active">All sources</span>
                <span className="chip">Calendly</span>
                <span className="chip">HubSpot</span>
                <span className="chip">Twilio</span>
                <span className="chip chip-violet">3 unreconciled</span>
                <span className="chip chip-outline">
                  <Plus size={13} aria-hidden />
                  Add filter
                </span>
              </div>

              {/* SIX NOTES */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "var(--dn-md)",
                }}
              >
                {METRICS.map((metric) => (
                  <MetricTile key={metric.label} metric={metric} />
                ))}
              </div>
            </div>
          </section>

          {/* ── BAND: SOURCES ─────────────────────────────────────── */}
          <section
            className="band"
            style={{ padding: "var(--dn-section) var(--dn-xl)" }}
          >
            <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: "var(--dn-lg)",
                  flexWrap: "wrap",
                  marginBottom: "var(--dn-lg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--dn-xxs)",
                  }}
                >
                  <h2 className="t-title" style={{ margin: 0 }}>
                    Sources
                  </h2>
                  <p className="t-body muted" style={{ margin: 0 }}>
                    Every figure above is traceable to one of these six.
                  </p>
                </div>
                <a
                  href="/design/next"
                  className="btn btn-secondary"
                  style={{ textDecoration: "none" }}
                >
                  <Blocks size={16} aria-hidden />
                  Connect a source
                </a>
              </div>

              <div
                className="card"
                style={{ overflow: "hidden", padding: 0 }}
              >
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Feeds</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Records
                      </th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Last sync
                      </th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {SOURCES.map((source) => (
                      <tr key={source.name}>
                        <td>
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--dn-sm)",
                            }}
                          >
                            <span
                              aria-hidden
                              className="dot"
                              style={{ background: source.mark }}
                            />
                            <span className="t-sub">{source.name}</span>
                          </span>
                        </td>
                        <td className="muted">{source.kind}</td>
                        <td className="num">{source.records}</td>
                        <td className="t-mono" style={{ textAlign: "right" }}>
                          {source.synced}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className={source.chip}>{source.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── WHITE: THE THREE CONFLICTS ────────────────────────── */}
          <section style={{ padding: "var(--dn-section) var(--dn-xl)" }}>
            <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)",
                  gap: "var(--dn-xl)",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--dn-md)",
                  }}
                >
                  <h2 className="t-title" style={{ margin: 0 }}>
                    Needs a decision
                  </h2>
                  <p className="t-body muted" style={{ margin: 0 }}>
                    Three counts still disagree. Pick a winner once and the rule
                    is remembered for every run after this one.
                  </p>
                  <a
                    href="/design/next"
                    className="btn btn-primary btn-lg"
                    style={{ textDecoration: "none", alignSelf: "flex-start" }}
                  >
                    Review conflicts
                    <ArrowRight size={17} aria-hidden />
                  </a>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--dn-sm)",
                  }}
                >
                  {CONFLICTS.map((conflict, i) => (
                    <article
                      key={conflict.title}
                      className="note"
                      style={{
                        background: conflict.note,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--dn-lg)",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--dn-xxs)",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--dn-xs)",
                          }}
                        >
                          <span className="t-mono" style={{ color: "var(--dn-ink)" }}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="t-heading">{conflict.title}</span>
                        </span>
                        <span
                          className="t-body-sm"
                          style={{ color: "var(--dn-body)" }}
                        >
                          {conflict.detail}
                        </span>
                      </span>
                      <a
                        href="/design/next"
                        className="btn btn-secondary btn-sm"
                        style={{ textDecoration: "none", flex: "none" }}
                      >
                        Resolve
                      </a>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── DARK BAND: THE RHYTHM PAYOFF ──────────────────────── */}
          <section
            className="band-dark"
            style={{ padding: "var(--dn-section) var(--dn-xl)" }}
          >
            <div
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: "var(--dn-xl)",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--dn-md)",
                  maxWidth: "40ch",
                }}
              >
                <span
                  className="t-label"
                  style={{ color: "var(--dn-mark-butter)" }}
                >
                  Automate it
                </span>
                <h2
                  className="t-display"
                  style={{ margin: 0, color: "var(--dn-on-dark)" }}
                >
                  Stop counting calls twice.
                </h2>
                <p
                  className="t-body"
                  style={{ margin: 0, color: "var(--dn-on-dark)", opacity: 0.72 }}
                >
                  A flow can settle these three conflicts the moment they appear,
                  every morning, before anyone opens a spreadsheet.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--dn-sm)",
                }}
              >
                <a
                  href="/design/next"
                  className="btn btn-secondary btn-lg"
                  style={{ textDecoration: "none", borderColor: "var(--dn-dark-edge)" }}
                >
                  Build a flow
                  <ArrowRight size={17} aria-hidden />
                </a>
                <a
                  href="/design/next"
                  className="btn btn-ghost btn-lg"
                  style={{ textDecoration: "none", color: "var(--dn-on-dark)" }}
                >
                  See an example
                </a>
              </div>
            </div>
          </section>
        </main>
      </div>

      <a
        href="/design/next"
        className="btn btn-secondary btn-sm"
        style={{
          position: "fixed",
          left: "var(--dn-lg)",
          bottom: "var(--dn-lg)",
          zIndex: 9,
          textDecoration: "none",
          boxShadow: "var(--dn-lift)",
        }}
      >
        <ArrowLeft size={14} aria-hidden />
        Design language
      </a>
    </div>
  );
}
