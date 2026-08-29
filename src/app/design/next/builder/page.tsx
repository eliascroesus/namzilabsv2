/**
 * THE FLOW BUILDER, IN THE BOARD LANGUAGE.
 *
 * The dashboard proves the note wall. This screen proves the other half of the
 * system: that the SAME classifying colour survives being carried onto a dark
 * canvas, and that the chrome does not change shape when the work does.
 *
 * Three things are on show, and nothing else:
 *
 *   · THE GROUND. A dotted near-black well milled into white paper at the big
 *     36px radius. It is the only dark surface on the screen, and the config
 *     panel sitting beside it is an ordinary white card — light plate, dark
 *     well, one row, no shadow doing the work.
 *
 *   · THE MARKS. Every step wears a filled rounded square in its family's
 *     saturated hue — sky for a source, peach for a transform, rose for a
 *     delivery. Those same six hues fill the note cards in the strip below at
 *     their pastel weight, so the legend and the canvas are literally the same
 *     palette seen at two saturations. Colour classifies; black acts, which is
 *     why Publish and Apply are both plain near-black pills.
 *
 *   · THE CHROME. Identical to the dashboard: 260px rail, 64px bar, Flows
 *     active in the violet wash. Violet is identity and selection and nothing
 *     else on this page — the active nav row, and the ring around the selected
 *     node. Yellow appears exactly once, on the brand mark.
 *
 * NODE CARD DESIGN IS OUT OF SCOPE. The cards on the canvas are the minimum
 * that lets the ground, the marks and the chrome be judged.
 */
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  GitMerge,
  LayoutDashboard,
  Play,
  Plug,
  Plus,
  Settings,
  Sheet,
  Sigma,
  Table2,
  Workflow,
} from "lucide-react";

import "../design-next.css";

export const metadata = { title: "Namzilabs — Flow builder" };

/* ── THE DATA ─────────────────────────────────────────────────────────────
   Static and inline. This route is a design specimen, not a product surface,
   and it must render identically forever. */

const NAV: { label: string; icon: typeof Workflow; active?: boolean }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Flows", icon: Workflow, active: true },
  { label: "Reconciliation", icon: Table2 },
  { label: "Sources", icon: Plug },
  { label: "Settings", icon: Settings },
];

/** The canvas is laid out on a fixed grid so the edges can be drawn exactly. */
const NODE_W = 230;
const NODE_H = 78;
const CANVAS_W = 560;
const CANVAS_H = 568;

type FlowNode = {
  id: string;
  title: string;
  ports: string;
  /** A saturated mark hue. One per step family — this is the classification. */
  mark: string;
  icon: typeof Workflow;
  x: number;
  y: number;
  selected?: boolean;
};

const NODES: FlowNode[] = [
  {
    id: "n_calendly",
    title: "Calendly",
    ports: "out: events · 1,284",
    mark: "var(--dn-mark-sky)",
    icon: CalendarDays,
    x: 20,
    y: 32,
  },
  {
    id: "n_sheets",
    title: "Google Sheets",
    ports: "out: rows · 3,006",
    mark: "var(--dn-mark-mint)",
    icon: Sheet,
    x: 310,
    y: 32,
  },
  {
    id: "n_match",
    title: "Match records",
    ports: "in: 2 · out: matched · 1,190",
    mark: "var(--dn-mark-lilac)",
    icon: GitMerge,
    x: 165,
    y: 190,
    selected: true,
  },
  {
    id: "n_calc",
    title: "Calculate",
    ports: "in: matched · out: metrics · 6",
    mark: "var(--dn-mark-peach)",
    icon: Sigma,
    x: 165,
    y: 330,
  },
  {
    id: "n_digest",
    title: "Send digest",
    ports: "in: metrics · 09:00 daily",
    mark: "var(--dn-mark-rose)",
    icon: Bell,
    x: 165,
    y: 470,
  },
];

/** Orthogonal connectors with an 8px knee, drawn under the cards. */
const EDGES = [
  "M135 110 V142 Q135 150 143 150 H272 Q280 150 280 158 V190",
  "M425 110 V142 Q425 150 417 150 H288 Q280 150 280 158 V190",
  "M280 268 V330",
  "M280 408 V470",
];

const STEP_KINDS = [
  {
    kind: "note note-sky",
    mark: "var(--dn-mark-sky)",
    icon: Plug,
    title: "Get data",
    body: "Pulls rows out of a connected tool on a schedule and hands them on untouched. Never writes anywhere.",
    meta: "4 in this flow",
  },
  {
    kind: "note note-peach",
    mark: "var(--dn-mark-peach)",
    icon: Sigma,
    title: "Transform",
    body: "Matches, filters, joins and calculates. Every transform is pure — same rows in, same numbers out, every run.",
    meta: "2 in this flow",
  },
  {
    kind: "note note-rose",
    mark: "var(--dn-mark-rose)",
    icon: Bell,
    title: "Deliver",
    body: "Posts the finished figures to Slack, Telegram or a sheet. The only step kind allowed to leave the workspace.",
    meta: "1 in this flow",
  },
];

const labelStyle: CSSProperties = { display: "block", marginBottom: "var(--dn-xs)" };

export default function BuilderPage() {
  return (
    <div className="dn" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <header
        className="topbar"
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: "var(--dn-md)",
          padding: "0 var(--dn-lg)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
          {/* The one yellow on the screen. */}
          <span
            aria-hidden="true"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "9px",
              background: "var(--dn-yellow)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Workflow size={16} strokeWidth={2.25} color="var(--dn-ink)" />
          </span>
          <span className="t-sub">Namzilabs</span>
        </span>

        <span
          aria-hidden="true"
          style={{ width: "1px", height: "22px", background: "var(--dn-hairline)" }}
        />

        <span className="t-body-sm muted">Ridgeline Partners</span>

        <span style={{ flex: 1 }} />

        <span className="chip chip-violet">
          <span className="dot" style={{ background: "var(--dn-violet)" }} />
          Draft · v18
        </span>
        <span className="t-mono">saved 14:22</span>
        <a className="btn btn-secondary btn-sm" href="/design/next/builder">
          <Play size={14} strokeWidth={2} aria-hidden="true" />
          Test run
        </a>
        <a className="btn btn-primary btn-sm" href="/design/next/builder">
          Publish
        </a>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
        <nav
          className="sidebar"
          style={{
            flex: "none",
            padding: "var(--dn-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--dn-lg)",
          }}
        >
          <a
            className="btn btn-primary"
            href="/design/next/builder"
            style={{ justifyContent: "center" }}
          >
            <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
            New flow
          </a>

          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span className="t-label" style={{ padding: "0 12px var(--dn-xs)" }}>
              Workspace
            </span>
            {NAV.map(({ label, icon: Icon, active }) => {
              return (
                <span key={label} className={active ? "nav-row nav-row-active" : "nav-row"}>
                  <span
                    className="nav-icon"
                    aria-hidden="true"
                    style={{
                      background: active ? "var(--dn-violet)" : "var(--dn-sunken)",
                      color: active ? "var(--dn-on-dark)" : "var(--dn-muted)",
                    }}
                  >
                    <Icon size={15} strokeWidth={2} />
                  </span>
                  {label}
                </span>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span className="t-label" style={{ padding: "0 12px var(--dn-xs)" }}>
              This flow
            </span>
            {NODES.map((n) => (
              <span
                key={n.id}
                className={n.selected ? "nav-row nav-row-active" : "nav-row"}
                style={{ fontSize: "14px" }}
              >
                <span className="dot" style={{ background: n.mark }} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {n.title}
                </span>
              </span>
            ))}
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* ── TITLE ROW ───────────────────────────────────────────────── */}
          <div
            style={{
              padding: "var(--dn-xl) var(--dn-xl) 0",
              display: "flex",
              alignItems: "flex-end",
              gap: "var(--dn-md)",
              flexWrap: "wrap",
            }}
          >
            <div>
              <span className="t-label">Flow</span>
              <h1 className="t-title" style={{ marginTop: "6px" }}>
                Speed to lead
              </h1>
            </div>
            <span style={{ flex: 1 }} />
            <span className="chip">
              <span className="dot" style={{ background: "var(--dn-up)" }} />
              Running
            </span>
            <span className="chip chip-outline t-mono" style={{ letterSpacing: 0 }}>
              flw_8ac31d
            </span>
          </div>

          {/* ── THE WELL + THE PANEL ────────────────────────────────────── */}
          <div
            style={{
              padding: "var(--dn-lg) var(--dn-xl) var(--dn-xxl)",
              display: "flex",
              gap: "var(--dn-lg)",
              alignItems: "stretch",
              flexWrap: "wrap",
            }}
          >
            <section
              className="well"
              style={{
                flex: "1 1 640px",
                minWidth: 0,
                minHeight: "672px",
                position: "relative",
                overflow: "auto",
                padding: "var(--dn-xl) var(--dn-lg)",
              }}
            >
              <span
                className="t-label"
                style={{
                  position: "absolute",
                  top: "var(--dn-lg)",
                  left: "var(--dn-lg)",
                  color: "var(--dn-dark-mono)",
                }}
              >
                Canvas
              </span>

              <div
                style={{
                  position: "relative",
                  width: `${CANVAS_W}px`,
                  height: `${CANVAS_H}px`,
                  margin: "0 auto",
                }}
              >
                {/* Edges sit UNDER the cards, in one grey — never a mark hue,
                    or the canvas becomes coloured spaghetti. */}
                <svg
                  aria-hidden="true"
                  width={CANVAS_W}
                  height={CANVAS_H}
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  style={{ position: "absolute", inset: 0 }}
                >
                  {EDGES.map((d) => (
                    <path
                      key={d}
                      d={d}
                      fill="none"
                      stroke="var(--dn-dark-edge)"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </svg>

                {NODES.map(({ id, title, ports, mark, icon: Icon, x, y, selected }) => (
                  <div
                    key={id}
                    className={selected ? "node node-selected" : "node"}
                    style={{
                      position: "absolute",
                      left: `${x}px`,
                      top: `${y}px`,
                      width: `${NODE_W}px`,
                      height: `${NODE_H}px`,
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--dn-sm)",
                    }}
                  >
                    <span className="node-mark" aria-hidden="true" style={{ background: mark }}>
                      <Icon size={17} strokeWidth={2.25} color="var(--dn-on-dark)" />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        className="t-sub"
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {title}
                      </span>
                      <span className="t-mono" style={{ display: "block", marginTop: "3px" }}>
                        {ports}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <span
                className="t-mono"
                style={{
                  position: "absolute",
                  bottom: "var(--dn-lg)",
                  left: "var(--dn-lg)",
                  color: "var(--dn-dark-mono)",
                }}
              >
                5 steps · 4 links · 100%
              </span>
            </section>

            {/* ── CONFIG PANEL — a light plate against the dark well. ────── */}
            <aside
              className="card"
              style={{
                width: "380px",
                flex: "none",
                display: "flex",
                flexDirection: "column",
                alignSelf: "flex-start",
              }}
            >
              <div
                style={{
                  padding: "var(--dn-lg)",
                  borderBottom: "1px solid var(--dn-hairline)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--dn-sm)",
                }}
              >
                <span
                  className="node-mark"
                  aria-hidden="true"
                  style={{
                    background: "var(--dn-mark-lilac)",
                    width: "40px",
                    height: "40px",
                    borderRadius: "12px",
                  }}
                >
                  <GitMerge size={20} strokeWidth={2.25} color="var(--dn-on-dark)" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t-heading" style={{ display: "block" }}>
                    Match records
                  </span>
                  <span className="t-mono" style={{ display: "block", marginTop: "3px" }}>
                    n_match · step 3 of 5
                  </span>
                </span>
              </div>

              <div
                style={{
                  padding: "var(--dn-lg)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--dn-lg)",
                  borderBottom: "1px solid var(--dn-hairline)",
                }}
              >
                <label>
                  <span className="t-label" style={labelStyle}>
                    Match key
                  </span>
                  <input className="input" defaultValue="attendee.email" />
                </label>

                <label>
                  <span className="t-label" style={labelStyle}>
                    Tolerance window
                  </span>
                  <input className="input" defaultValue="30 minutes" />
                  <span
                    className="t-body-sm muted"
                    style={{ display: "block", marginTop: "var(--dn-xs)" }}
                  >
                    Two records inside this window are the same booking.
                  </span>
                </label>

                <div>
                  <span className="t-label" style={labelStyle}>
                    When two rows disagree
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--dn-xs)" }}>
                    <span className="chip chip-active">Keep newest</span>
                    <span className="chip">Keep source of truth</span>
                    <span className="chip chip-outline">Flag for review</span>
                    <span className="chip chip-outline">Skip</span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "var(--dn-lg)",
                  display: "flex",
                  gap: "var(--dn-xl)",
                  borderBottom: "1px solid var(--dn-hairline)",
                }}
              >
                <div>
                  <span className="t-label" style={labelStyle}>
                    Matched
                  </span>
                  <span className="t-figure-sm" style={{ display: "block" }}>
                    1,190
                  </span>
                </div>
                <div>
                  <span className="t-label" style={labelStyle}>
                    Unmatched
                  </span>
                  <span
                    className="t-figure-sm"
                    style={{ display: "block", color: "var(--dn-warn)" }}
                  >
                    14
                  </span>
                </div>
                <span style={{ flex: 1 }} />
                <span className="spark" style={{ height: "48px" }}>
                  <i style={{ height: "40%" }} />
                  <i style={{ height: "55%" }} />
                  <i style={{ height: "48%" }} />
                  <i style={{ height: "70%" }} />
                  <i style={{ height: "62%" }} />
                  <i style={{ height: "88%" }} />
                </span>
              </div>

              <div
                style={{
                  padding: "var(--dn-lg)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--dn-xs)",
                }}
              >
                <a className="btn btn-primary" href="/design/next/builder">
                  Apply
                </a>
                <a className="btn btn-secondary" href="/design/next/builder">
                  Revert
                </a>
                <span style={{ flex: 1 }} />
                <span className="t-mono">14:20</span>
              </div>
            </aside>
          </div>

          {/* ── THE STRIP — band, three notes, one per step kind. ───────── */}
          <section
            className="band"
            style={{
              padding: "var(--dn-xxl) var(--dn-xl)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--dn-lg)",
            }}
          >
            <div>
              <span className="t-label">The vocabulary</span>
              <h2 className="t-heading" style={{ marginTop: "6px" }}>
                Every flow is built from three kinds of step
              </h2>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "var(--dn-md)",
              }}
            >
              {STEP_KINDS.map(({ kind, mark, icon: Icon, title, body, meta }) => (
                <div
                  key={title}
                  className={kind}
                  style={{ display: "flex", flexDirection: "column", gap: "var(--dn-sm)" }}
                >
                  <span className="node-mark" aria-hidden="true" style={{ background: mark }}>
                    <Icon size={17} strokeWidth={2.25} color="var(--dn-on-dark)" />
                  </span>
                  <span className="t-heading">{title}</span>
                  <span className="t-body-sm" style={{ flex: 1 }}>
                    {body}
                  </span>
                  {/* --dn-body, not ink-at-0.6: the composite measured 4.26:1
                      on peach, sky and rose. This is 8.86:1 at worst. */}
                  <span className="t-mono" style={{ color: "var(--dn-body)" }}>
                    {meta}
                  </span>
                </div>
              ))}
            </div>

            <p className="t-body-sm muted" style={{ maxWidth: "76ch" }}>
              Node card design is out of scope on this screen — the cards on the canvas are the
              minimum that lets the rest be judged. What is being shown is the dotted well against
              the white plate, the step marks carrying one hue per family from the canvas into the
              notes above, and the chrome, which is the dashboard&rsquo;s chrome unchanged.
            </p>
          </section>
        </main>
      </div>

      <a
        className="btn btn-secondary btn-sm"
        href="/design/next"
        style={{
          position: "fixed",
          left: "var(--dn-lg)",
          bottom: "var(--dn-lg)",
          zIndex: 20,
          boxShadow: "var(--dn-lift)",
        }}
      >
        <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
        Back to the language
      </a>
    </div>
  );
}
