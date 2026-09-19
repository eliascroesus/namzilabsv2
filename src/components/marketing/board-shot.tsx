/**
 * THE DASHBOARD, DRAWN — the hero's product shot.
 *
 * ── WHY IT IS NOT THE OWNER'S SCREENSHOT ───────────────────────────────────
 *
 * `public/dashboard.png` is his real board and it is the obvious thing to put
 * here. Two facts rule it out, and both were raised rather than worked around:
 *
 *   1. "THERE IS NO GREEN ON THIS PAGE." The real board draws money in green
 *      and its funnel in orange, because that is the product's own vocabulary.
 *      A screenshot of it is a green screenshot; the two instructions cannot
 *      both hold.
 *   2. IT IS A LIVE WORKSPACE. A named client, real revenue, real lead counts,
 *      on the open web, permanently, the moment it is committed.
 *
 * Drawn instead: the same composition and the same chrome, in the page's own
 * palette, at a size where every figure is legible — which was the actual
 * complaint about the old hero. It also stays sharp at any density, follows
 * the theme, and cannot go stale against a UI change the way an export does.
 *
 * THE NUMBERS ARE INVENTED AND THEY RECONCILE: 512 leads → 268 booked (52.3%)
 * → 179 showed (66.8%) → 61 customers (34.1%), and 61 × $3,040 ≈ $185,440. A
 * demo whose funnel does not reconcile is a demo of the problem this product
 * claims to fix.
 */
const WEEKS = [34, 96, 52, 26, 18, 61, 88, 40, 44, 58, 31, 70, 22, 12];

const SCORES: Array<{ label: string; value: string }> = [
  { label: "Leads", value: "512" },
  { label: "Booked Leads", value: "268" },
  { label: "Calls Showed", value: "179" },
  { label: "Customers", value: "61" },
  { label: "Revenue", value: "$185,440" },
  { label: "AOV", value: "$3,040" },
];

const RATES: Array<{ label: string; value: string }> = [
  { label: "Booking rate", value: "52.3%" },
  { label: "Show up rate", value: "66.8%" },
  { label: "Close rate", value: "34.1%" },
];

export function BoardShot() {
  return (
    <div aria-hidden className="board">
      {/* ── the bar ───────────────────────────────────────────────────── */}
      <div className="board-bar">
        <span className="board-title">Overview</span>
        <span className="board-range">Sat, Jun 20 — Thu, Sep 17</span>
        <span className="board-bar-right">Updated 2 hr ago</span>
      </div>

      <div className="board-tabs">
        <span className="board-tab" data-on>
          Overview
        </span>
        {["Calls", "Money", "Leads"].map((t) => (
          <span key={t} className="board-tab">
            {t}
          </span>
        ))}
        <span className="board-tabs-right">Last 90 days</span>
      </div>

      <div className="board-body">
        {/* ── six scorecards ──────────────────────────────────────────── */}
        <div className="board-scores">
          {SCORES.map((s) => (
            <div key={s.label} className="board-cell">
              <span className="board-cell-label">{s.label}</span>
              <span className="board-cell-value t-num">{s.value}</span>
            </div>
          ))}
        </div>

        {/* ── three rates ─────────────────────────────────────────────── */}
        <div className="board-rates">
          {RATES.map((r) => (
            <div key={r.label} className="board-cell">
              <span className="board-cell-label">{r.label}</span>
              <span className="board-cell-value t-num">{r.value}</span>
            </div>
          ))}
        </div>

        {/* ── the revenue chart ───────────────────────────────────────── */}
        {/* BLUE BARS, NOT GREEN. The real board draws money in green and the
            page forbids it; this is the one place the two collide, and the
            page wins because it is the page. */}
        <div className="board-chart">
          <span className="board-cell-label">Revenue</span>
          <span className="board-chart-figure t-num">$185,440</span>
          <span className="board-bars">
            {WEEKS.map((v, i) => (
              <span key={i} className="board-bar-col" style={{ height: `${v}%` }} />
            ))}
          </span>
          <span className="board-axis">
            <span>W25</span>
            <span>W31</span>
            <span>W38</span>
          </span>
        </div>
      </div>
    </div>
  );
}
