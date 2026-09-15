import { Bell, ChartLine, LayoutGrid, Plug, Radio, RefreshCw, Search, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE PRODUCT, DRAWN — the hero's one picture.
 *
 * WHY THIS IS NOT A SCREENSHOT, which is the obvious way to fill this slot and
 * the way the reference does it. Three reasons, in order of how much they cost:
 *
 *  1. `/design/overview` is a TEST FIXTURE. Its tiles are named "Total Leads
 *     (Arman)" three times and "Speed To Lead (Arman)" twice, because it exists
 *     to prove a grid reflows, not to be looked at. A landing page whose one
 *     product image repeats the same metric three times says the product has
 *     one metric.
 *  2. A PNG is fixed at one width and one density. This is the element that
 *     has to survive a 375px phone and a 2560px display, and cropping a
 *     screenshot to fit either is how a hero image ends up showing a sidebar
 *     and half a card.
 *  3. It would be a binary in a repo that currently has no `public/` directory
 *     at all, re-shot by hand every time the chrome changes.
 *
 * So it is a DRAWING, and the honesty bar for a drawing is that it must be a
 * drawing of the real thing: the rail, the view strip, the range pill and the
 * card grid below are the dashboard's own composition at the dashboard's own
 * proportions, in the kit's tokens, with the brand as the only colour. What is
 * invented is the CONTENT — plausible metrics for a company that is not real —
 * and content is the one part of a product shot nobody has ever taken to be a
 * promise.
 *
 * `aria-hidden`, and this one is not a shrug. Every word in here is decorative
 * duplicate: "Meetings booked / 41" is the hero's own argument restated as
 * furniture, and a screen reader that walked this would read forty numbers
 * belonging to a company that does not exist before reaching the sign-up link.
 * The figure carries one real caption instead.
 */

const SERIES = [8, 14, 11, 19, 26, 22, 31];
const BARS = [34, 52, 78, 61, 44, 70, 58];

/** One nav row in the drawn rail. */
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

/** A chart card: title, figure, drawing. The dashboard's tile, at hero scale. */
function TileCard({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-card border border-border bg-card p-3 shadow-card">
      <span className="truncate text-xs font-semibold text-foreground">{title}</span>
      <span className="stat-numeral mt-0.5 text-lg leading-tight text-foreground">{value}</span>
      <span className="mt-2 block h-14">{children}</span>
    </div>
  );
}

/** A scorecard: the tile with no chart, which is most of a real board. */
function Scorecard({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-card border border-border bg-card p-3 shadow-card">
      <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
      <span className="stat-numeral mt-1 truncate text-md leading-tight text-foreground">{value}</span>
    </div>
  );
}

/** The line and area drawings share one path; only the fill differs. */
function Spark({ filled }: { filled?: boolean }) {
  const max = Math.max(...SERIES);
  const pts = SERIES.map((v, i) => [(i / (SERIES.length - 1)) * 100, 100 - (v / max) * 92]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full">
      {filled && (
        <polygon points={`0,100 ${line} 100,100`} className="fill-brand-400" style={{ fillOpacity: 0.16 }} />
      )}
      {/* `vector-effect` keeps the stroke 1.5px after `preserveAspectRatio="none"`
          has stretched the 100x100 box into a wide rectangle — without it the
          horizontal runs draw thin and the verticals draw fat. */}
      <polyline
        points={line}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-brand-400"
      />
    </svg>
  );
}

function Bars() {
  const max = Math.max(...BARS);
  return (
    <span className="flex h-full items-end gap-1.5">
      {BARS.map((v, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 rounded-t-md bg-brand-400"
          style={{ height: `${Math.round((v / max) * 100)}%` }}
        />
      ))}
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
       * come from a shadow comes from a dark frame instead, which is what the
       * reference's own product image does: a near-black bezel reads as a
       * device, and a device reads as a thing sitting in front of the sky.
       */
      className="rounded-frame bg-neutral-950 p-1.5 sm:rounded-3xl sm:p-2.5"
    >
      <div className="flex overflow-hidden rounded-card bg-card sm:rounded-2xl">
        {/* --- the rail ------------------------------------------------------ */}
        <div className="hidden w-40 shrink-0 flex-col gap-3 border-r border-border bg-muted/40 p-3 sm:flex">
          <span className="flex items-center gap-2">
            <span className="stat-numeral flex size-6 items-center justify-center rounded-control bg-primary text-xs text-primary-foreground">
              N
            </span>
            <span className="truncate text-xs font-semibold text-foreground">Acme Sales</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-control border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground">
            <Search className="size-3" />
            Search
          </span>
          <span className="flex flex-col gap-0.5">
            <RailRow icon={LayoutGrid} label="Dashboard" active />
            <RailRow icon={Radio} label="Activity" />
            <RailRow icon={Workflow} label="Flows" />
            <RailRow icon={Plug} label="Apps" />
            <RailRow icon={Settings} label="Settings" />
          </span>
        </div>

        {/* --- the board ----------------------------------------------------- */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-semibold text-foreground">Overview</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">Last 7 days</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="hidden items-center gap-1 rounded-control border border-border px-2 py-1 text-xs text-muted-foreground sm:flex">
                <RefreshCw className="size-3" />
                Updated 2m ago
              </span>
              <span className="flex items-center gap-1 rounded-control border border-border px-2 py-1 text-xs text-muted-foreground">
                <ChartLine className="size-3" />
                Compare
              </span>
              <Bell className="size-3.5 text-muted-foreground" />
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 p-3 sm:gap-3 sm:p-4 lg:grid-cols-3">
            <TileCard title="Meetings booked" value="41">
              <Spark />
            </TileCard>
            <TileCard title="Pickup rate" value="28.2%">
              <Spark filled />
            </TileCard>
            {/* The third chart is the one a two-column phone cannot fit without
                the cards going narrower than their own numbers. */}
            <span className="hidden lg:block">
              <TileCard title="Leads by rep" value="78">
                <Bars />
              </TileCard>
            </span>

            <Scorecard title="Speed to lead" value="8m 39s" />
            <Scorecard title="Show-up rate" value="69%" />
            <span className="hidden lg:block">
              <Scorecard title="Close rate" value="20%" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
