/**
 * ACTIVITY & CONNECTIONS — the proposed language under load.
 *
 * This is the densest surface the product has, and it is here because density
 * is where a design language either holds or falls apart. Four things are on
 * trial:
 *
 *  1. THE FACE SPLIT. Every machine-emitted string — timestamps, record
 *     counts, durations, sync stamps, conflict counts, status words — is Geist
 *     Mono at 450. Every human sentence is Inter. Scan the table: you can tell
 *     what the product measured from what a person wrote without reading a
 *     word of either.
 *  2. THE DECIMAL SPINE. Records runs 0 · 7 · 42 · 1,204 · 18,330 · 24,118 and
 *     the columns still stack, because the figures are tabular and
 *     right-aligned rather than because a layout is propping them up.
 *  3. THE RULE. Three states, one object: settled (a continuous hairline),
 *     provenance (a segment per contributing source, width proportional), and
 *     variance (a hatched segment with the conflict count at its right end).
 *  4. THE TWO KINDS OF BAD NEWS. A failed webhook is `--dn-down`; sources
 *     disagreeing is `--dn-variance` and is additionally set in parentheses,
 *     (−14), accounting-style. A decline and a disagreement never share ink.
 *
 * The whole screen carries exactly one accent element (the brand mark), no
 * shadow, no fill above `--dn-surface-1`, and no weight above 500.
 */
import Link from "next/link";
import {
  Activity,
  CalendarRange,
  Cable,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Users,
  Workflow,
} from "lucide-react";

import "../design-next.css";

export const metadata = { title: "Namzilabs — Activity & connections (proposed)" };

type SourceName = "Calendly" | "Google Sheets" | "CRM" | "Webhook" | "Telegram";

/** The taxonomy. These five hues are the only chroma the screen is allowed. */
const SOURCE_HUE: Record<SourceName, string> = {
  Calendly: "var(--dn-source-calendly)",
  "Google Sheets": "var(--dn-source-sheets)",
  CRM: "var(--dn-source-crm)",
  Webhook: "var(--dn-source-webhook)",
  Telegram: "var(--dn-source-telegram)",
};

type Status = "settled" | "variance" | "failed" | "stale";

const STATUS_HUE: Record<Status, string> = {
  settled: "var(--dn-up)",
  variance: "var(--dn-variance)",
  failed: "var(--dn-down)",
  stale: "var(--dn-stale)",
};

type Row = {
  time: string;
  source: SourceName;
  event: string;
  records: string;
  duration: string;
  status: Status;
  /** Conflict count, already parenthesised. Only ever set on `variance`. */
  conflicts?: string;
};

const ROWS: Row[] = [
  { time: "09:41:02", source: "Calendly", event: "Booking created", records: "7", duration: "0.42s", status: "settled" },
  { time: "09:38:55", source: "Google Sheets", event: "Sheet rows imported", records: "1,204", duration: "12.40s", status: "settled" },
  { time: "09:31:20", source: "CRM", event: "Contact records merged", records: "316", duration: "4.08s", status: "variance", conflicts: "(−14)" },
  { time: "09:22:07", source: "Webhook", event: "Payment intent received", records: "1", duration: "0.19s", status: "settled" },
  { time: "09:14:48", source: "Telegram", event: "Alert dispatched to ops channel", records: "42", duration: "0.86s", status: "settled" },
  { time: "08:59:31", source: "Google Sheets", event: "Full workbook backfill", records: "18,330", duration: "231.55s", status: "settled" },
  { time: "08:47:12", source: "Calendly", event: "Invitee cancelled", records: "9", duration: "0.37s", status: "settled" },
  { time: "08:40:00", source: "CRM", event: "Deal stages reconciled", records: "2,940", duration: "64.02s", status: "variance", conflicts: "(−3)" },
  { time: "08:26:44", source: "Webhook", event: "Signature check failed", records: "0", duration: "1.03s", status: "failed" },
  { time: "08:12:19", source: "Google Sheets", event: "Column mapping updated", records: "88", duration: "0.94s", status: "settled" },
  { time: "07:55:03", source: "Calendly", event: "Availability window synced", records: "512", duration: "7.61s", status: "stale" },
  { time: "07:31:57", source: "CRM", event: "Owner assignments imported", records: "24,118", duration: "118.27s", status: "settled" },
];

type Connection = {
  source: SourceName;
  name: string;
  account: string;
  synced: string;
  action: string;
  conflicts?: string;
};

const CONNECTIONS: Connection[] = [
  { source: "Calendly", name: "Calendly", account: "namzilabs / discovery-call", synced: "2026-08-29 09:41", action: "Configure" },
  { source: "Google Sheets", name: "Google Sheets", account: "Q3 pipeline workbook", synced: "2026-08-29 09:38", action: "Configure" },
  { source: "CRM", name: "HubSpot", account: "production portal 4418822", synced: "2026-08-29 09:31", action: "Resolve", conflicts: "(−17)" },
  { source: "Telegram", name: "Telegram", account: "#ops-alerts", synced: "2026-08-29 09:14", action: "Configure" },
];

/** Nav rows for the rail. `Activity` is the one we are standing on. */
const NAV: { label: string; icon: typeof Activity; active?: boolean }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Flows", icon: Workflow },
  { label: "Activity", icon: Activity, active: true },
  { label: "People", icon: Users },
  { label: "Connections", icon: Cable },
  { label: "Settings", icon: Settings },
];

/** The provenance rule's segments for the "records synced" figure. */
const PROVENANCE: { source: SourceName; share: number }[] = [
  { source: "Google Sheets", share: 46 },
  { source: "CRM", share: 26 },
  { source: "Calendly", share: 16 },
  { source: "Webhook", share: 8 },
  { source: "Telegram", share: 4 },
];

export default function ActivityPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start" }}>
      {/* ── THE RAIL. Chrome is the page: same bone, one hairline. ───────── */}
      <aside
        className="sidebar"
        style={{
          flex: "none",
          alignSelf: "stretch",
          position: "sticky",
          top: 0,
          minHeight: "100vh",
          padding: "var(--dn-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--dn-xl)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)", padding: "0 var(--dn-xxs)" }}>
          {/* The brand mark — one of the four things allowed to be accent. */}
          <span
            aria-hidden
            style={{ width: "10px", height: "10px", background: "var(--dn-accent)", borderRadius: "var(--dn-r-none)" }}
          />
          <span className="t-subheading">Namzilabs</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV.map(({ label, icon: Icon, active }) => (
            <span key={label} className={active ? "nav-row nav-row-active" : "nav-row"}>
              <Icon size={15} strokeWidth={1.6} aria-hidden />
              {label}
            </span>
          ))}
        </nav>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--dn-xs)" }}>
          <span className="t-eyebrow">Next sync</span>
          <div style={{ display: "inline-block" }}>
            <span className="t-figure-sm">04:12</span>
            <div className="rule rule-settled" />
          </div>
          <span className="t-mono-sm subtle">every 15 min</span>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── TOP BAR. The mark lives on the rail, so this holds place + 2. ── */}
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
            padding: "0 var(--dn-lg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
            <span className="t-body-sm" style={{ color: "var(--dn-ink)" }}>
              Acme Growth
            </span>
            <span className="t-mono-sm subtle">/</span>
            <span className="t-body-sm muted">Activity</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-up)" }} aria-hidden />
              live
            </span>
            <button type="button" className="btn btn-secondary">
              <RefreshCw size={14} strokeWidth={1.6} aria-hidden />
              Sync now
            </button>
            {/* An avatar is one of exactly two things allowed to be a pill. */}
            <span
              className="t-mono-sm"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "var(--dn-r-full)",
                background: "var(--dn-surface-sunken)",
                color: "var(--dn-ink-muted)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              EC
            </span>
          </div>
        </header>

        <main
          style={{
            maxWidth: "1280px",
            margin: "0 auto",
            padding: "var(--dn-xl) var(--dn-lg) var(--dn-section)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--dn-xl)",
          }}
        >
          {/* ── PAGE HEADER ────────────────────────────────────────────────── */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--dn-lg)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xs)" }}>
              <span className="t-eyebrow">Workspace</span>
              <h1 className="t-title">Activity &amp; connections</h1>
              <p className="t-body muted" style={{ maxWidth: "62ch" }}>
                Every event the workspace ingested, in the order it arrived. Where two sources disagree the row is
                marked as a variance rather than an error — a number nobody agrees on is a different fact from a number
                that went down.
              </p>
            </div>

            {/* THE RULE, all three states, sitting on top of real figures. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--dn-md)" }}>
              <div className="plate" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "var(--dn-sm)" }}>
                <span className="t-eyebrow">Events today</span>
                <div style={{ display: "inline-block" }}>
                  <div className="t-figure-lg">1,204</div>
                  {/* Settled — every connected source agrees. */}
                  <div className="rule rule-settled" />
                </div>
                <span className="t-mono-sm muted">+186 vs. yesterday</span>
              </div>

              <div className="plate" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "var(--dn-sm)" }}>
                <span className="t-eyebrow">Records synced</span>
                <div style={{ display: "inline-block" }}>
                  <div className="t-figure-lg">18,330</div>
                  {/* Provenance — one segment per source, width ∝ contribution. */}
                  <div className="rule">
                    {PROVENANCE.map(({ source, share }) => (
                      <span
                        key={source}
                        className="rule-seg"
                        style={{ width: `${share}%`, background: SOURCE_HUE[source] }}
                      />
                    ))}
                  </div>
                </div>
                <span className="t-mono-sm muted">5 sources contributing</span>
              </div>

              <div className="plate" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "var(--dn-sm)" }}>
                <span className="t-eyebrow">Reconciled bookings</span>
                <div style={{ display: "inline-block" }}>
                  <div className="t-figure-lg">316</div>
                  {/* Variance — hatched, with the conflict count at the right end. */}
                  <div className="rule rule-variance" style={{ width: "100%" }} />
                  <div
                    className="t-mono-sm"
                    style={{ marginTop: "var(--dn-xxs)", textAlign: "right", color: "var(--dn-variance)" }}
                  >
                    (−14)
                  </div>
                </div>
                <span className="t-mono-sm muted">calendly vs. crm</span>
              </div>
            </div>
          </section>

          {/* ── FILTER ROW ─────────────────────────────────────────────────── */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--dn-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-sm)" }}>
              <div style={{ position: "relative", flex: 1, maxWidth: "360px", display: "flex", alignItems: "center" }}>
                <Search
                  size={14}
                  strokeWidth={1.6}
                  aria-hidden
                  style={{ position: "absolute", left: "10px", color: "var(--dn-ink-subtle)" }}
                />
                <input
                  className="input"
                  type="search"
                  placeholder="Search events, records, IDs"
                  defaultValue=""
                  readOnly
                  style={{ paddingLeft: "30px" }}
                  aria-label="Search activity"
                />
              </div>
              <button type="button" className="btn btn-secondary">
                <SlidersHorizontal size={14} strokeWidth={1.6} aria-hidden />
                All sources
              </button>
              <button type="button" className="btn btn-secondary">
                <CalendarRange size={14} strokeWidth={1.6} aria-hidden />
                Today
              </button>
              <span className="t-mono-sm subtle" style={{ marginLeft: "auto" }}>
                12 of 1,204
              </span>
            </div>

            {/* ── THE TABLE ────────────────────────────────────────────────── */}
            <div className="plate" style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: "104px" }}>
                      Time
                    </th>
                    <th scope="col" style={{ width: "168px" }}>
                      Source
                    </th>
                    <th scope="col">Event</th>
                    <th scope="col" style={{ textAlign: "right", width: "112px" }}>
                      Records
                    </th>
                    <th scope="col" style={{ textAlign: "right", width: "112px" }}>
                      Duration
                    </th>
                    <th scope="col" style={{ width: "168px" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={`${row.time}-${row.event}`}>
                      <td>
                        <span className="t-mono muted">{row.time}</span>
                      </td>
                      {/* No taxonomy hue here. The five source hues are licensed to
                          provenance segments and node spines only — a dot per row
                          would put them on a third object. The name does the work. */}
                      <td>{row.source}</td>
                      <td style={{ color: "var(--dn-ink)" }}>{row.event}</td>
                      <td className="num">{row.records}</td>
                      <td className="num">{row.duration}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                          <span className="badge">
                            <span className="dot" style={{ background: STATUS_HUE[row.status] }} aria-hidden />
                            {row.status}
                          </span>
                          {row.conflicts ? (
                            <span className="t-mono-sm" style={{ color: "var(--dn-variance)" }}>
                              {row.conflicts}
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── CONNECTIONS ────────────────────────────────────────────────── */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--dn-md)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--dn-md)" }}>
              <h2 className="t-heading">Connections</h2>
              <span className="t-mono-sm subtle">4 connected · 1 disagreeing</span>
            </div>

            <div className="plate">
              {CONNECTIONS.map((connection, i) => (
                <div
                  key={connection.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--dn-md)",
                    padding: "var(--dn-md) 20px",
                    borderTop: i === 0 ? "0" : "1px solid var(--dn-hairline)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                    <span className="t-subheading">{connection.name}</span>
                    <span className="t-body-sm muted">{connection.account}</span>
                  </div>

                  {connection.conflicts ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--dn-xs)" }}>
                      <span className="badge">
                        <span className="dot" style={{ background: "var(--dn-variance)" }} aria-hidden />
                        variance
                      </span>
                      <span className="t-mono-sm" style={{ color: "var(--dn-variance)" }}>
                        {connection.conflicts}
                      </span>
                    </span>
                  ) : (
                    <span className="badge">
                      <span className="dot" style={{ background: "var(--dn-up)" }} aria-hidden />
                      settled
                    </span>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", width: "156px" }}>
                    <span className="t-eyebrow">Last synced</span>
                    <span className="t-mono">{connection.synced}</span>
                  </div>

                  <button type="button" className="btn btn-ghost">
                    {connection.action}
                  </button>
                </div>
              ))}
            </div>

            {/* ── EMPTY STATE — connected, but nothing has arrived yet.
                One subheading, one body-sm, one primary button. No illustration,
                and no taxonomy hue: the webhook's hue belongs to the rule. ──── */}
            <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--dn-sm)" }}>
              <span className="t-subheading">No events from stripe-staging yet</span>
              <p className="t-body-sm muted" style={{ maxWidth: "46ch" }}>
                The webhook was verified 4 minutes ago and is waiting on its first delivery. Nothing is wrong — there is
                simply nothing to reconcile until an event arrives.
              </p>
              <button type="button" className="btn btn-primary" style={{ marginTop: "var(--dn-xs)" }}>
                Send a test event
              </button>
            </div>
          </section>
        </main>
      </div>

      {/* Navigation between the proposal's pages. */}
      <Link
        href="/design/next"
        className="btn btn-secondary"
        style={{ position: "fixed", right: "var(--dn-lg)", bottom: "var(--dn-lg)", zIndex: 40, textDecoration: "none" }}
      >
        Back to the language
      </Link>
    </div>
  );
}
