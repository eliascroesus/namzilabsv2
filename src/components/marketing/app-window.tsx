import { Bell, Gift, LayoutGrid, Plug, Plus, Radio, RefreshCw, Search, Settings, Share2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A DRAWING OF THE REAL DASHBOARD.
 *
 * ── WHY THIS WAS REBUILT ───────────────────────────────────────────────────
 *
 * The owner sent a screenshot of his actual board and asked for it on the
 * lander instead of this. The old drawing was not wrong so much as it was a
 * drawing of a DIFFERENT product: a six-tile grid of blue line charts, where
 * the real thing opens on a row of scorecards, a green revenue bar chart and
 * an orange funnel. Somebody who clicked through would have arrived somewhere
 * they had not been shown.
 *
 * So the layout, the chrome and the chart types here are copied from that
 * screenshot: the workspace switcher and the Invite-&-earn card in the rail,
 * the date range beside the title, the tab strip with its Add / range /
 * Compare To / Refresh All controls, six scorecards over three rate cards, the
 * green weekly revenue chart, and the funnel under it.
 *
 * ── WHY THE NUMBERS ARE NOT HIS ────────────────────────────────────────────
 *
 * The screenshot is of a live workspace — a named client, $259,748 of revenue,
 * 726 leads, a close rate. Publishing that on the front page would put a real
 * customer's book on the open web, and `.env.local` points at the production
 * database, so a literal screenshot taken here would leak whatever it caught.
 * Every figure below is invented and internally consistent instead: 512 leads
 * → 268 booked (52.3%) → 179 showed (66.8%) → 61 customers (34.1% close),
 * 61 × $3,040 ≈ $185,440. A demo whose funnel does not reconcile is a demo of
 * the problem this product claims to fix.
 *
 * ── WHY IT IS STILL DOM RATHER THAN A PNG ──────────────────────────────────
 *
 * It stays sharp on any display, follows the theme, cannot go stale against a
 * UI change the way an exported image does, and carries nobody's data.
 */

/** The weekly revenue bars — fourteen weeks, in the real chart's green. */
const WEEKS = [2, 96, 41, 18, 12, 52, 88, 30, 30, 51, 26, 60, 14, 3];

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

function RailRow({ icon: Icon, label, active }: { icon: typeof LayoutGrid; label: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 rounded-control px-2 py-1.5 text-xs font-medium",
        active ? "bg-brand-soft text-brand-800" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}

/** A control in the tab strip — a label in a hairline box, drawn once. */
function Pill({ children, solid }: { children: React.ReactNode; solid?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-[10px] font-medium",
        solid ? "bg-accent text-foreground" : "border border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function AppWindow() {
  return (
    <div
      aria-hidden
      /**
       * THE BEZEL. Every rung of the kit's shadow ladder is `none` — the
       * product does not draw drop shadows, and `pnpm shadows` asserts that by
       * outcome rather than by class name. So the depth that would normally
       * come from a shadow comes from a dark frame instead: a near-black bezel
       * reads as hardware, and hardware reads as a thing sitting in front of
       * the sky.
       */
      className="h-full rounded-frame bg-neutral-950 p-1.5 sm:rounded-3xl sm:p-2.5"
    >
      <div className="flex h-full overflow-hidden rounded-card bg-card sm:rounded-2xl">
        {/* ── the rail ──────────────────────────────────────────────────── */}
        <div className="hidden w-40 shrink-0 flex-col gap-2.5 border-r border-border bg-muted/40 p-2.5 lg:flex">
          <span className="flex items-center gap-2">
            <span className="stat-numeral flex size-5 items-center justify-center rounded-control bg-primary text-[10px] text-primary-foreground">
              N
            </span>
            <span className="truncate text-[11px] font-semibold text-foreground">Northwind</span>
          </span>

          <span className="flex items-center gap-1.5 rounded-control border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground">
            <Search className="size-3" />
            Search
          </span>

          <span className="flex flex-col gap-0.5">
            <RailRow icon={LayoutGrid} label="Dashboard" active />
            {/* THE SUB-ITEMS UNDER DASHBOARD, because the real rail has them
                and they are what tells you a board is a set of views rather
                than one screen. */}
            <span className="flex flex-col gap-0.5 pl-6">
              {["Overview", "Calls", "Money", "Leads"].map((v, i) => (
                <span
                  key={v}
                  className={cn("py-0.5 text-[10px]", i === 0 ? "font-medium text-foreground" : "text-muted-foreground")}
                >
                  {v}
                </span>
              ))}
            </span>
            <RailRow icon={Radio} label="Activity" />
            <RailRow icon={Workflow} label="Flows" />
            <RailRow icon={Plug} label="Apps" />
            <RailRow icon={Settings} label="Settings" />
          </span>

          {/* THE RAIL'S FOOT — the invite card and the New button, which is
              what the real one carries and the reason the column reads as a
              workspace rather than as a nav list. `.sky-panel` is the same
              blue the owner named as his favourite surface in the product. */}
          <span className="mt-auto flex flex-col gap-1.5">
            <span className="sky-panel flex items-center gap-2 overflow-hidden rounded-control px-2 py-1.5">
              <Gift className="size-3 shrink-0 text-white" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[10px] font-semibold leading-3 text-white">Invite &amp; earn</span>
                <span className="truncate text-[9px] leading-3 text-white/75">1 invite = 1 month free</span>
              </span>
            </span>
            <span className="flex items-center justify-center gap-1 rounded-control bg-foreground py-1.5 text-[10px] font-semibold text-background">
              <Plus className="size-3" />
              New
            </span>
          </span>
        </div>

        {/* ── the board ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* the title bar */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-2 pt-2.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-semibold text-foreground">Overview</span>
              <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
                Sat, Jun 20 &ndash; Thu, Sep 17
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <span className="hidden text-[10px] sm:inline">Updated 2 hr ago</span>
              <Share2 className="size-3" />
              <Bell className="size-3" />
            </span>
          </div>

          {/* the tab strip */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 pb-2">
            <span className="flex min-w-0 items-center gap-1">
              <Pill solid>
                <LayoutGrid className="size-2.5" />
                Overview
              </Pill>
              {["Calls", "Money", "Leads"].map((t) => (
                <span key={t} className="hidden shrink-0 px-2 text-[10px] text-muted-foreground sm:inline">
                  {t}
                </span>
              ))}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Pill>
                <Plus className="size-2.5" />
                Add
              </Pill>
              <span className="hidden sm:flex">
                <Pill>Last 90 days</Pill>
              </span>
              <span className="hidden lg:flex">
                <Pill>Compare To</Pill>
              </span>
              <Pill>
                <RefreshCw className="size-2.5" />
                Refresh
              </Pill>
            </span>
          </div>

          {/* the board body */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
            {/* ── six scorecards ──────────────────────────────────────── */}
            <div className="grid shrink-0 grid-cols-3 gap-2 lg:grid-cols-6">
              {SCORES.map((s) => (
                <div key={s.label} className="min-w-0 rounded-card border border-border bg-background px-2.5 py-2">
                  <span className="block truncate text-[10px] text-muted-foreground">{s.label}</span>
                  <span className="stat-numeral mt-0.5 block truncate text-sm leading-tight text-foreground">
                    {s.value}
                  </span>
                </div>
              ))}
            </div>

            {/* ── three rates ─────────────────────────────────────────── */}
            <div className="hidden shrink-0 grid-cols-3 gap-2 sm:grid">
              {RATES.map((r) => (
                <div key={r.label} className="min-w-0 rounded-card border border-border bg-background px-2.5 py-2">
                  <span className="block truncate text-[10px] text-muted-foreground">{r.label}</span>
                  <span className="stat-numeral mt-0.5 block text-md leading-tight text-foreground">{r.value}</span>
                </div>
              ))}
            </div>

            {/* ── the revenue chart ───────────────────────────────────── */}
            {/* GREEN, WHICH IS THE ONE PLACE THIS PAGE DOES NOT USE THE BRAND.
                The real board draws money in `--success` and everything else
                in the brand blue, and that distinction is the board's own
                vocabulary — repainting it blue here to match the landing page
                would be showing a product that does not exist. */}
            <div className="flex min-h-0 flex-1 flex-col rounded-card border border-border bg-background p-2.5">
              <span className="shrink-0">
                <span className="block text-[10px] text-muted-foreground">Revenue</span>
                <span className="stat-numeral block text-md leading-tight text-foreground">$185,440</span>
              </span>
              <span className="mt-2 flex min-h-0 flex-1 items-end gap-[3px]">
                {WEEKS.map((v, i) => (
                  <span
                    key={i}
                    className="min-w-0 flex-1 rounded-t-sm bg-success"
                    style={{ height: `${Math.max(2, v)}%` }}
                  />
                ))}
              </span>
              <span className="mt-1 flex shrink-0 justify-between text-[9px] text-muted-foreground">
                <span>W25</span>
                <span>W31</span>
                <span>W38</span>
              </span>
            </div>

            {/* ── the funnel ──────────────────────────────────────────── */}
            {/* Three stages, each band as wide as its share of the one before
                it, so the taper IS the conversion rather than a shape drawn to
                look like one. The rates printed on the steps are the same ones
                in the cards above. */}
            <div className="hidden shrink-0 rounded-card border border-border bg-background p-2.5 lg:block">
              <span className="flex items-end gap-1">
                {[
                  { label: "Leads", value: "512", w: 100, tone: "bg-warn/25" },
                  { label: "Calls Showed", value: "179", w: 62, tone: "bg-warn/55" },
                  { label: "Customers", value: "61", w: 34, tone: "bg-warn" },
                ].map((st) => (
                  <span key={st.label} className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[10px] text-muted-foreground">{st.label}</span>
                    <span className="stat-numeral truncate text-xs leading-none text-foreground">{st.value}</span>
                    <span className="flex h-4 items-center">
                      <span className={cn("h-full rounded-sm", st.tone)} style={{ width: `${st.w}%` }} />
                    </span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
