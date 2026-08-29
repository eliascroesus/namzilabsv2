/**
 * THE FLOW BUILDER, IN THE PROPOSED LANGUAGE.
 *
 * This screen exists to prove one claim from DESIGN.md that no dashboard can
 * make: DEPTH RUNS DOWNWARD. The canvas is not a dark panel floating on the
 * page — it is a near-black well MILLED INTO the bone paper, and the config
 * panel beside it is an ordinary white plate. Put a light plate and a dark
 * well on the same row and the elevation ladder stops being a table of tokens
 * and becomes something you can see: the page is level 0, the plate steps up
 * by getting lighter, the canvas steps down by getting darker. No shadow is
 * doing any of that work, because the system only owns one shadow and it is
 * spent on overlays.
 *
 * Three further laws are on display:
 *
 *   · The spine is the rule. A node's 3px leading spine and a provenance
 *     segment are the same physical object in the same taxonomy hue, which is
 *     why the panel's ruled figure and the canvas read as one machine seen
 *     from two ends. Those five hues appear nowhere else on the screen —
 *     notably NOT on the edges, which are all one grey so the canvas can
 *     never become coloured spaghetti.
 *
 *   · The face split holds. Every port name, row count, record id, timestamp
 *     and figure is Geist Mono; every sentence is Inter. Nothing on this
 *     screen is both.
 *
 *   · A decline and a disagreement are different facts. The panel shows the
 *     match's variance as (−14) in the variance ochre with a hatched rule and
 *     its conflict count — never in the red reserved for a genuine decrease.
 *
 * NODE CARD DESIGN IS OUT OF SCOPE HERE. The cards are the minimum that lets
 * the ground, the chrome and the spine be judged.
 */
import {
  ArrowRight,
  LayoutDashboard,
  Plug,
  Settings,
  Table2,
  Workflow,
} from "lucide-react";

import "../design-next.css";

export const metadata = { title: "Namzilabs — Flow builder (proposed)" };

/** The canvas is laid out on a fixed grid so the edges can be drawn exactly. */
const NODE_W = 236;
const NODE_H = 76;
const CANVAS_W = 568;
const CANVAS_H = 568;

type FlowNode = {
  id: string;
  title: string;
  ports: string;
  spine: string;
  status: string;
  x: number;
  y: number;
  selected?: boolean;
};

const NODES: FlowNode[] = [
  {
    id: "n_calendly",
    title: "Get data — Calendly",
    ports: "out:events · 1,284 · 14:22",
    spine: "var(--dn-source-calendly)",
    status: "var(--dn-well-up)",
    x: 32,
    y: 40,
  },
  {
    id: "n_sheets",
    title: "Get data — Sheets",
    ports: "out:rows · 3,006 · 14:22",
    spine: "var(--dn-source-sheets)",
    status: "var(--dn-well-up)",
    x: 300,
    y: 40,
  },
  {
    id: "n_match",
    title: "Match records",
    ports: "in:2 · out:matched · 1,190",
    spine: "var(--dn-source-crm)",
    status: "var(--dn-variance)",
    x: 166,
    y: 176,
    selected: true,
  },
  {
    id: "n_calc",
    title: "Calculate",
    ports: "in:matched · out:metrics · 6",
    spine: "var(--dn-source-webhook)",
    status: "var(--dn-well-up)",
    x: 166,
    y: 312,
  },
  {
    id: "n_output",
    title: "Output",
    ports: "in:metrics · 09:00 daily",
    spine: "var(--dn-source-telegram)",
    status: "var(--dn-stale)",
    x: 166,
    y: 448,
  },
];

/**
 * Orthogonal connectors with an 8px knee. 1.5px, one grey, no marker, no
 * hover state and no selected state — an edge is drawn, not operated.
 */
const EDGES = [
  "M150 116 V138 Q150 146 158 146 H276 Q284 146 284 154 V176",
  "M418 116 V138 Q418 146 410 146 H292 Q284 146 284 154 V176",
  "M284 252 V312",
  "M284 388 V448",
];

const NAV: { label: string; icon: typeof Workflow; active?: boolean }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Flows", icon: Workflow, active: true },
  { label: "Reconciliation", icon: Table2 },
  { label: "Sources", icon: Plug },
  { label: "Settings", icon: Settings },
];

export default function BuilderPage() {
  return (
    <div
      className="dn"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── TOP BAR — the mark, the workspace, two actions. Chrome is the
          page: canvas ground, one hairline, no shadow. ─────────────────── */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--dn-xs)" }}>
          {/* The brand mark is one of the accent's four licensed uses. */}
          <span
            aria-hidden="true"
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "var(--dn-r-sm)",
              background: "var(--dn-accent)",
              display: "inline-block",
            }}
          />
          <span className="t-subheading">Namzilabs</span>
        </div>

        <span
          aria-hidden="true"
          style={{
            width: "1px",
            height: "20px",
            background: "var(--dn-hairline-strong)",
          }}
        />

        <span className="t-body-sm muted">Ridgeline Partners</span>

        <span style={{ flex: 1 }} />

        <span className="t-mono-sm subtle">saved 14:22 · v18</span>
        <a className="btn btn-secondary" href="/design/next/builder">
          Test run
        </a>
        <a className="btn btn-primary" href="/design/next/builder">
          Publish
        </a>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── SIDEBAR — active row is a white PLATE, the same object as a
            card, so "where I am" reuses the vocabulary. ────────────────── */}
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
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xxs)" }}>
            <span className="t-eyebrow" style={{ padding: "0 10px var(--dn-xxs)" }}>
              Workspace
            </span>
            {NAV.map(({ label, icon: Icon, active }) => (
              <span
                key={label}
                className={active ? "nav-row nav-row-active" : "nav-row"}
              >
                <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--dn-xxs)" }}>
            <span className="t-eyebrow" style={{ padding: "0 10px var(--dn-xxs)" }}>
              Connected
            </span>
            {/* No taxonomy hue on this list. The five source hues are licensed to
                provenance segments and node spines; a dot in the rail would be a
                third home for them, and the rail is chrome. */}
            {[
              { label: "Calendly", meta: "14:22" },
              { label: "Google Sheets", meta: "14:22" },
              { label: "CRM", meta: "14:19" },
              { label: "Telegram", meta: "09:00" },
            ].map((s) => (
              <span key={s.label} className="nav-row">
                <span style={{ flex: 1 }}>{s.label}</span>
                <span className="t-mono-sm subtle">{s.meta}</span>
              </span>
            ))}
          </div>
        </nav>

        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: "var(--dn-lg)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--dn-md)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "var(--dn-md)",
              flexWrap: "wrap",
            }}
          >
            <div>
              <span className="t-eyebrow">Flow</span>
              <h1 className="t-title" style={{ marginTop: "var(--dn-xxs)" }}>
                Speed to lead
              </h1>
            </div>
            <span style={{ flex: 1 }} />
            <span className="badge">
              <span className="dot" style={{ background: "var(--dn-up)" }} />
              running
            </span>
            <span className="badge">flw_8ac31d</span>
          </div>

          <div
            style={{
              display: "flex",
              gap: "var(--dn-lg)",
              flex: 1,
              minHeight: 0,
              alignItems: "stretch",
            }}
          >
            {/* ── THE WELL — the product's only dark surface, and the whole
                point of this screen. Recessed, radius lg, no shadow. ───── */}
            <section
              className="well"
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: "628px",
                position: "relative",
                overflow: "auto",
                padding: "var(--dn-lg)",
              }}
            >
              <span
                className="t-eyebrow"
                style={{
                  position: "absolute",
                  top: "var(--dn-md)",
                  left: "var(--dn-lg)",
                  color: "var(--dn-well-ink-muted)",
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
                {/* Edges sit UNDER the cards, one grey, never a taxonomy hue. */}
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
                      stroke="var(--dn-well-edge)"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </svg>

                {NODES.map((n) => (
                  <div
                    key={n.id}
                    className={n.selected ? "node node-selected" : "node"}
                    style={
                      {
                        "--dn-spine": n.spine,
                        position: "absolute",
                        left: `${n.x}px`,
                        top: `${n.y}px`,
                        width: `${NODE_W}px`,
                        height: `${NODE_H}px`,
                      } as React.CSSProperties
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--dn-xs)",
                      }}
                    >
                      <span
                        className="t-subheading"
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
                      <span className="dot" style={{ background: n.status }} />
                    </div>
                    <div className="t-mono-sm" style={{ marginTop: "var(--dn-xxs)" }}>
                      {n.ports}
                    </div>
                  </div>
                ))}
              </div>

              <span
                className="t-mono-sm"
                style={{
                  position: "absolute",
                  bottom: "var(--dn-md)",
                  left: "var(--dn-lg)",
                  color: "var(--dn-well-ink-muted)",
                }}
              >
                5 nodes · 4 edges · 100%
              </span>
            </section>

            {/* ── CONFIG PANEL — 360px, a LIGHT plate beside a DARK well. ── */}
            <aside
              className="plate"
              style={{
                width: "360px",
                flex: "none",
                display: "flex",
                flexDirection: "column",
                alignSelf: "flex-start",
              }}
            >
              <div
                style={{
                  padding: "20px",
                  borderBottom: "1px solid var(--dn-hairline)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--dn-xs)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="t-eyebrow">Step 3 of 5</span>
                  <div className="t-heading" style={{ marginTop: "var(--dn-xxs)" }}>
                    Match records
                  </div>
                  <div className="t-mono-sm subtle" style={{ marginTop: "var(--dn-xxs)" }}>
                    n_match · crm
                  </div>
                </div>
                {/* The spine hue, restated as the panel's only chroma. */}
                <span
                  aria-hidden="true"
                  style={{
                    width: "3px",
                    height: "44px",
                    background: "var(--dn-source-crm)",
                    flex: "none",
                  }}
                />
              </div>

              <div
                style={{
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--dn-md)",
                  borderBottom: "1px solid var(--dn-hairline)",
                }}
              >
                <label style={{ display: "block" }}>
                  <span className="t-eyebrow">Match key</span>
                  <input
                    className="input"
                    style={{ marginTop: "var(--dn-xs)" }}
                    defaultValue="attendee.email"
                  />
                </label>

                <label style={{ display: "block" }}>
                  <span className="t-eyebrow">Tolerance window</span>
                  <input
                    className="input"
                    style={{ marginTop: "var(--dn-xs)" }}
                    defaultValue="30 minutes"
                  />
                  <span
                    className="t-body-sm subtle"
                    style={{ display: "block", marginTop: "var(--dn-xs)" }}
                  >
                    Two records inside this window are the same booking.
                  </span>
                </label>

                <div>
                  <span className="t-eyebrow">Field path</span>
                  <div
                    style={{
                      marginTop: "var(--dn-xs)",
                      background: "var(--dn-surface-sunken)",
                      border: "1px solid var(--dn-hairline)",
                      borderRadius: "var(--dn-r-sm)",
                      padding: "var(--dn-xs) var(--dn-sm)",
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--dn-xs)",
                    }}
                  >
                    <span className="t-mono" style={{ color: "var(--dn-ink)" }}>
                      events[].invitee.email
                    </span>
                    <ArrowRight
                      size={13}
                      strokeWidth={1.5}
                      aria-hidden="true"
                      style={{ flex: "none", color: "var(--dn-ink-subtle)" }}
                    />
                    <span className="t-mono" style={{ color: "var(--dn-ink)" }}>
                      rows[].email
                    </span>
                  </div>
                </div>
              </div>

              {/* The rule, drawn twice: settled provenance on the left, the
                  disagreement on the right. Same object, two states. */}
              <div
                style={{
                  padding: "20px",
                  display: "flex",
                  gap: "var(--dn-lg)",
                  borderBottom: "1px solid var(--dn-hairline)",
                }}
              >
                <div>
                  <span className="t-eyebrow">Matched</span>
                  <div style={{ width: "max-content", marginTop: "var(--dn-xs)" }}>
                    <div className="t-figure-md">1,190</div>
                    <div className="rule">
                      <span
                        className="rule-seg"
                        style={{ width: "52%", background: "var(--dn-source-calendly)" }}
                      />
                      <span
                        className="rule-seg"
                        style={{ width: "34%", background: "var(--dn-source-sheets)" }}
                      />
                      <span
                        className="rule-seg"
                        style={{ width: "14%", background: "var(--dn-source-crm)" }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <span className="t-eyebrow">Unmatched</span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: "var(--dn-xs)",
                      marginTop: "var(--dn-xs)",
                    }}
                  >
                    <div style={{ width: "max-content" }}>
                      <div className="t-figure-md" style={{ color: "var(--dn-variance)" }}>
                        (−14)
                      </div>
                      <div className="rule">
                        <span className="rule-seg rule-variance" style={{ width: "100%" }} />
                      </div>
                    </div>
                    <span
                      className="t-mono-sm"
                      style={{ color: "var(--dn-variance)", paddingBottom: "3px" }}
                    >
                      3 conflicts
                    </span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "20px",
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
                <span className="t-mono-sm subtle">edited 14:20</span>
              </div>
            </aside>
          </div>

          <p className="t-body-sm subtle" style={{ maxWidth: "72ch" }}>
            Node card design is out of scope on this screen — the cards here are
            the minimum that lets the ground and the chrome be judged. What is
            being shown is the recessed well against the light plate, the 3px
            spine carrying the source taxonomy into the canvas, and the one grey
            every edge is drawn in.
          </p>
        </main>
      </div>

      <a
        className="btn btn-secondary"
        href="/design/next"
        style={{
          position: "fixed",
          left: "var(--dn-lg)",
          bottom: "var(--dn-lg)",
          zIndex: 20,
        }}
      >
        Back to the language
      </a>
    </div>
  );
}
