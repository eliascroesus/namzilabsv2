/**
 * ACTIVITY — the playful language carrying a dense screen.
 *
 * This is the surface where a colourful system usually collapses back into a
 * spreadsheet, so it is the honest test. Four moves keep it on the board:
 *
 *  1. COLOUR CLASSIFIES, BLACK ACTS. Every source owns one hue for the whole
 *     screen — Calendly is sky, Sheets is mint, HubSpot is peach, Stripe is
 *     lilac, Telegram is rose, Postgres is butter — and that hue appears on the
 *     row dot, the connection tile and the nav icon, so a source is legible
 *     before you read its name. Every primary action is black.
 *  2. THE NOTE CARD IS THE SIGNATURE. The day's summary is three whole-card
 *     pastel fills at 28px, not three white boxes with a border.
 *  3. SECTION RHYTHM. topbar white → band header → white table → band
 *     connections → the note wall → a tinted empty. Two whites never touch.
 *  4. VIOLET MARKS IDENTITY. The active nav row and the "Today" filter, and
 *     nothing else. Yellow appears exactly once, on the wordmark.
 */
import type { CSSProperties } from "react";
import {
  Activity,
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronDown,
  Download,
  Inbox,
  LayoutDashboard,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sheet,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

import "../design-next.css";

export const metadata = { title: "Namzilabs — Activity" };

/* ── THE TAXONOMY ─────────────────────────────────────────────────────────
   One hue per source, held for the whole screen. `mark` is the saturated twin
   (dots, icons); `note` is the pastel it pairs with (tiles, fills). */

type SourceName = "Calendly" | "Google Sheets" | "HubSpot" | "Stripe" | "Telegram" | "Postgres";

const SOURCE: Record<SourceName, { mark: string; note: string }> = {
  Calendly: { mark: "var(--dn-mark-sky)", note: "var(--dn-note-sky)" },
  "Google Sheets": { mark: "var(--dn-mark-mint)", note: "var(--dn-note-mint)" },
  HubSpot: { mark: "var(--dn-mark-peach)", note: "var(--dn-note-peach)" },
  Stripe: { mark: "var(--dn-mark-lilac)", note: "var(--dn-note-lilac)" },
  Telegram: { mark: "var(--dn-mark-rose)", note: "var(--dn-note-rose)" },
  Postgres: { mark: "var(--dn-mark-butter)", note: "var(--dn-note-butter)" },
};

/* Status is state, not taxonomy, so it uses the state washes rather than a
   source hue. Queued is the only one that stays neutral. */
type Status = "Synced" | "Conflict" | "Failed" | "Queued";

const STATUS: Record<Status, { fill: string; ink: string }> = {
  Synced: { fill: "var(--dn-up-wash)", ink: "var(--dn-up)" },
  Conflict: { fill: "var(--dn-warn-wash)", ink: "var(--dn-warn)" },
  Failed: { fill: "var(--dn-down-wash)", ink: "var(--dn-down)" },
  Queued: { fill: "var(--dn-sunken)", ink: "var(--dn-muted)" },
};

type Row = {
  time: string;
  source: SourceName;
  event: string;
  records: string;
  duration: string;
  status: Status;
};

/* Ragged digit counts on purpose — 0, 7, 42, 316, 1,204, 18,330, 24,118 — so
   the tabular alignment in `td.num` is visible rather than asserted. */
const ROWS: Row[] = [
  { time: "09:41:02", source: "Calendly", event: "Booking created", records: "7", duration: "0.42s", status: "Synced" },
  { time: "09:38:55", source: "Google Sheets", event: "Workbook rows imported", records: "1,204", duration: "12.40s", status: "Synced" },
  { time: "09:31:20", source: "HubSpot", event: "Contact records merged", records: "316", duration: "4.08s", status: "Conflict" },
  { time: "09:22:07", source: "Stripe", event: "Payment intent received", records: "1", duration: "0.19s", status: "Synced" },
  { time: "09:14:48", source: "Telegram", event: "Alert sent to #ops-alerts", records: "42", duration: "0.86s", status: "Synced" },
  { time: "08:59:31", source: "Google Sheets", event: "Full workbook backfill", records: "18,330", duration: "231.55s", status: "Synced" },
  { time: "08:47:12", source: "Calendly", event: "Invitee cancelled", records: "9", duration: "0.37s", status: "Synced" },
  { time: "08:40:00", source: "HubSpot", event: "Deal stages reconciled", records: "2,940", duration: "64.02s", status: "Conflict" },
  { time: "08:26:44", source: "Stripe", event: "Signature check failed", records: "0", duration: "1.03s", status: "Failed" },
  { time: "08:12:19", source: "Postgres", event: "Column mapping updated", records: "88", duration: "0.94s", status: "Synced" },
  { time: "07:55:03", source: "Calendly", event: "Availability window synced", records: "512", duration: "7.61s", status: "Queued" },
  { time: "07:31:57", source: "HubSpot", event: "Owner assignments imported", records: "24,118", duration: "118.27s", status: "Synced" },
];

type Connection = {
  source: SourceName;
  icon: typeof Activity;
  account: string;
  synced: string;
  state: Status;
};

const CONNECTIONS: Connection[] = [
  { source: "Calendly", icon: CalendarDays, account: "namzilabs / discovery-call", synced: "2026-08-29 09:41", state: "Synced" },
  { source: "Google Sheets", icon: Sheet, account: "Q3 pipeline workbook", synced: "2026-08-29 09:38", state: "Synced" },
  { source: "HubSpot", icon: Building2, account: "portal 4418822", synced: "2026-08-29 09:31", state: "Conflict" },
  { source: "Telegram", icon: Send, account: "#ops-alerts", synced: "2026-08-29 09:14", state: "Synced" },
];

/* The rail. Each icon tile wears its section's pastel, so the chrome is part of
   the colour system rather than a grey frame around it. */
const NAV: { label: string; icon: typeof Activity; note: string; mark: string; active?: boolean }[] = [
  { label: "Overview", icon: LayoutDashboard, note: "var(--dn-note-sky)", mark: "var(--dn-mark-sky)" },
  { label: "Flows", icon: Workflow, note: "var(--dn-note-mint)", mark: "var(--dn-mark-mint)" },
  { label: "Activity", icon: Activity, note: "var(--dn-violet)", mark: "var(--dn-on-dark)", active: true },
  { label: "People", icon: Users, note: "var(--dn-note-rose)", mark: "var(--dn-mark-rose)" },
  { label: "Connections", icon: Plug, note: "var(--dn-note-peach)", mark: "var(--dn-mark-peach)" },
  { label: "Settings", icon: Settings, note: "var(--dn-note-butter)", mark: "var(--dn-mark-butter)" },
];

/* Events per hour, 09:00 back to 21:00 — the last bar is "now" and the CSS
   gives it full ink automatically. */
const SPARK = [34, 52, 41, 68, 57, 74, 96, 83, 61, 45, 70, 88];

const SHELL: CSSProperties = { maxWidth: "1320px", margin: "0 auto", width: "100%" };
const PAD = "var(--dn-xxl) var(--dn-xl)";

export default function ActivityPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start" }}>
      {/* ── THE RAIL ──────────────────────────────────────────────────────── */}
      <aside
        className="sidebar"
        style={{
          flex: "none",
          alignSelf: "stretch",
          position: "sticky",
          top: 0,
          minHeight: "100vh",
          padding: "var(--dn-lg) var(--dn-md) 84px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--dn-xl)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 var(--dn-xs)" }}>
          {/* The one yellow on the screen — Miro's rule, kept to the wordmark. */}
          <span className="nav-icon" style={{ background: "var(--dn-yellow)", color: "var(--dn-ink)" }} aria-hidden>
            <Zap size={16} strokeWidth={2.4} fill="currentColor" />
          </span>
          <span className="t-sub">Namzilabs</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          {NAV.map(({ label, icon: Icon, note, mark, active }) => (
            <a
              key={label}
              href="#"
              className={active ? "nav-row nav-row-active" : "nav-row"}
              style={{ textDecoration: "none" }}
              aria-current={active ? "page" : undefined}
            >
              <span className="nav-icon" style={{ background: note, color: mark }} aria-hidden>
                <Icon size={15} strokeWidth={2.1} />
              </span>
              {label}
            </a>
          ))}
        </nav>

        <div className="note note-lilac" style={{ marginTop: "auto", padding: "var(--dn-md)" }}>
          <div className="t-label" style={{ color: "var(--dn-violet-ink)" }}>
            Next sync
          </div>
          <div className="t-figure-sm" style={{ marginTop: "var(--dn-xs)" }}>
            04:12
          </div>
          <div className="t-mono" style={{ marginTop: "var(--dn-xxs)", color: "var(--dn-violet-ink)" }}>
            every 15 min
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
        <header
          className="topbar"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--dn-md)",
            padding: "0 var(--dn-xl)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="t-body-sm" style={{ color: "var(--dn-ink)", fontWeight: 600 }}>
              Acme Growth
            </span>
            <span className="t-body-sm subtle">/</span>
            <span className="t-body-sm muted">Activity</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
            <span className="chip">
              <span className="dot" style={{ background: "var(--dn-up)" }} aria-hidden />
              Live
            </span>
            <a href="#" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
              <RefreshCw size={14} strokeWidth={2.1} aria-hidden />
              Sync now
            </a>
            <span
              className="t-mono"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "var(--dn-r-full)",
                background: "var(--dn-violet-wash)",
                color: "var(--dn-violet-ink)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
              }}
            >
              EC
            </span>
          </div>
        </header>

        <main style={{ display: "flex", flexDirection: "column" }}>
          {/* ── HEADER + FILTERS, on the band ─────────────────────────────── */}
          <section className="band" style={{ padding: PAD }}>
            <div style={{ ...SHELL, display: "flex", flexDirection: "column", gap: "var(--dn-xl)" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: "var(--dn-xl)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-sm)", minWidth: 0 }}>
                  <span className="t-label">Workspace</span>
                  <h1 className="t-display">Activity</h1>
                  <p className="t-body muted" style={{ maxWidth: "58ch" }}>
                    Every event the workspace ingested today, newest first. Each source keeps one colour across the whole
                    screen, so you can read the shape of a day without reading a word of it.
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
                  <a href="#" className="btn btn-secondary btn-lg" style={{ textDecoration: "none" }}>
                    <Plus size={17} strokeWidth={2.1} aria-hidden />
                    Add source
                  </a>
                  <a href="#" className="btn btn-primary btn-lg" style={{ textDecoration: "none" }}>
                    <Download size={17} strokeWidth={2.1} aria-hidden />
                    Export CSV
                  </a>
                </div>
              </div>

              {/* THE FILTER ROW */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)", flexWrap: "wrap" }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center", width: "340px", flex: "none" }}>
                  <Search
                    size={16}
                    strokeWidth={2.1}
                    aria-hidden
                    style={{ position: "absolute", left: "13px", color: "var(--dn-subtle)", pointerEvents: "none" }}
                  />
                  <input
                    className="input"
                    type="search"
                    placeholder="Search events, records, IDs"
                    aria-label="Search activity"
                    readOnly
                    style={{ paddingLeft: "38px" }}
                  />
                </div>

                <span className="chip chip-active">
                  All events
                  <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
                </span>
                <span className="chip chip-violet">
                  Today
                  <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
                </span>
                <span className="chip">
                  <span className="dot" style={{ background: "var(--dn-warn)" }} aria-hidden />
                  Conflicts
                </span>
                <span className="chip">
                  <span className="dot" style={{ background: "var(--dn-down)" }} aria-hidden />
                  Failures
                </span>
                <span className="chip chip-outline">6 sources</span>

                <span className="t-mono" style={{ marginLeft: "auto" }}>
                  12 of 1,204 events
                </span>
              </div>
            </div>
          </section>

          {/* ── THE TABLE, on white ───────────────────────────────────────── */}
          <section style={{ padding: PAD }}>
            <div style={SHELL}>
              <div className="card" style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: "112px" }}>
                        Time
                      </th>
                      <th scope="col" style={{ width: "200px" }}>
                        Source
                      </th>
                      <th scope="col">Event</th>
                      <th scope="col" style={{ width: "116px", textAlign: "right" }}>
                        Records
                      </th>
                      <th scope="col" style={{ width: "116px", textAlign: "right" }}>
                        Duration
                      </th>
                      <th scope="col" style={{ width: "152px" }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={`${row.time}-${row.event}`}>
                        <td className="t-mono">{row.time}</td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                            <span className="dot" style={{ background: SOURCE[row.source].mark }} aria-hidden />
                            {row.source}
                          </span>
                        </td>
                        <td style={{ color: "var(--dn-ink)" }}>{row.event}</td>
                        <td className="num">{row.records}</td>
                        <td className="num">{row.duration}</td>
                        <td>
                          <span
                            className="chip"
                            style={{ background: STATUS[row.status].fill, color: STATUS[row.status].ink }}
                          >
                            <span className="dot" style={{ background: STATUS[row.status].ink }} aria-hidden />
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── CONNECTIONS, on the band ──────────────────────────────────── */}
          <section className="band" style={{ padding: PAD }}>
            <div style={{ ...SHELL, display: "flex", flexDirection: "column", gap: "var(--dn-lg)" }}>
              <div
                style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--dn-md)" }}
              >
                <h2 className="t-title">Connections</h2>
                <span className="t-mono">4 connected · 1 needs review</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-sm)" }}>
                {CONNECTIONS.map(({ source, icon: Icon, account, synced, state }) => (
                  <div
                    key={source}
                    className="card"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--dn-md)",
                      padding: "var(--dn-md) var(--dn-lg)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "14px",
                        flex: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: SOURCE[source].note,
                        color: SOURCE[source].mark,
                      }}
                    >
                      <Icon size={20} strokeWidth={2.1} />
                    </span>

                    <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: "180px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                        <span className="dot" style={{ background: SOURCE[source].mark }} aria-hidden />
                        <span className="t-sub">{source}</span>
                      </span>
                      <span className="t-body-sm muted">{account}</span>
                    </span>

                    <span className="chip" style={{ background: STATUS[state].fill, color: STATUS[state].ink }}>
                      <span className="dot" style={{ background: STATUS[state].ink }} aria-hidden />
                      {state}
                    </span>

                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "3px",
                        width: "168px",
                      }}
                    >
                      <span className="t-label">Last synced</span>
                      <span className="t-mono">{synced}</span>
                    </span>

                    <a href="#" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                      Configure
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── THE NOTE WALL — the day in three fills ────────────────────── */}
          <section style={{ padding: PAD }}>
            <div style={{ ...SHELL, display: "flex", flexDirection: "column", gap: "var(--dn-lg)" }}>
              <h2 className="t-title">Today so far</h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "var(--dn-md)",
                }}
              >
                <div
                  className="note note-mint"
                  style={{ padding: "var(--dn-xl)", display: "flex", flexDirection: "column", gap: "var(--dn-md)" }}
                >
                  <span className="t-label" style={{ color: "var(--dn-ink)" }}>
                    Events
                  </span>
                  <span className="t-figure">1,204</span>
                  <span className="t-body-sm">+186 against the same hours yesterday</span>
                  <div className="spark" style={{ height: "56px", marginTop: "auto" }} aria-hidden>
                    {SPARK.map((h, i) => (
                      <i key={i} style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>

                <div
                  className="note note-peach"
                  style={{ padding: "var(--dn-xl)", display: "flex", flexDirection: "column", gap: "var(--dn-md)" }}
                >
                  <span className="t-label" style={{ color: "var(--dn-ink)" }}>
                    Conflicts
                  </span>
                  <span className="t-figure">17</span>
                  <span className="t-body-sm">
                    Calendly and HubSpot disagree on 17 booking owners. Nothing failed — two sources counted the same
                    thing two ways.
                  </span>
                  <a
                    href="#"
                    className="btn btn-primary btn-sm"
                    style={{ textDecoration: "none", alignSelf: "flex-start", marginTop: "auto" }}
                  >
                    Review conflicts
                  </a>
                </div>

                <div
                  className="note note-sky"
                  style={{ padding: "var(--dn-xl)", display: "flex", flexDirection: "column", gap: "var(--dn-md)" }}
                >
                  <span className="t-label" style={{ color: "var(--dn-ink)" }}>
                    Uptime
                  </span>
                  <span className="t-figure">99.97%</span>
                  <span className="t-body-sm">One failed webhook signature at 08:26, retried and settled.</span>
                  <span className="t-mono" style={{ color: "var(--dn-ink)", marginTop: "auto" }}>
                    30-day rolling · 1,412 syncs
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ── EMPTY — connected, waiting on its first delivery ──────────── */}
          <section style={{ padding: "0 var(--dn-xl) var(--dn-section)" }}>
            <div style={SHELL}>
              <div
                className="empty"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--dn-md)" }}
              >
                <span
                  aria-hidden
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "18px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--dn-note-lilac)",
                    color: "var(--dn-mark-lilac)",
                  }}
                >
                  <Inbox size={26} strokeWidth={2.1} />
                </span>
                <h3 className="t-heading">No events from stripe-staging yet</h3>
                <p className="t-body muted" style={{ maxWidth: "48ch" }}>
                  The webhook was verified four minutes ago and is waiting on its first delivery. Nothing is wrong —
                  there is simply nothing to reconcile until an event arrives.
                </p>
                <a
                  href="#"
                  className="btn btn-primary"
                  style={{ textDecoration: "none", marginTop: "var(--dn-xs)" }}
                >
                  Send a test event
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
          zIndex: 40,
          textDecoration: "none",
          boxShadow: "var(--dn-lift)",
        }}
      >
        <ArrowLeft size={14} strokeWidth={2.1} aria-hidden />
        Back to the language
      </a>
    </div>
  );
}
