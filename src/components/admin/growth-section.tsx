import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/page";
import { Sparkbars } from "@/components/charts";
import type { GrowthSeries, GrowthTotals } from "@/lib/admin/growth";

/**
 * GROWTH, DRAWN.
 *
 * Three series that answer three different questions, in the order a founder
 * actually asks them: did anyone show up, did they plug anything in, did they
 * build the thing they came for. A single "signups" line would answer the first
 * and hide the two that say whether the product worked.
 *
 * `Sparkbars` rather than a new chart: it is already zero-anchored, already
 * theme-aware, already draws its own axis and field, and is already the mark
 * every metric tile in the product uses. A second bar chart written for this
 * page would be a second set of decisions about the same picture.
 */

const fmt = new Intl.NumberFormat("en-GB");

/**
 * One row of the growth block: the headline, then the shape behind it.
 *
 * The number and the chart come from ONE series — see `totalsFrom` — so the
 * figure above the bars is by construction the last bar. Two counts of the same
 * thing taken at two moments eventually disagree, and a panel whose tile says 4
 * over a chart showing 3 is a panel nobody believes again.
 */
function Series({
  label,
  today,
  series,
  sub,
}: {
  label: string;
  today: number;
  series: Array<{ bucket: string; value: number }>;
  sub: string;
}) {
  const window = series.reduce((a, b) => a + b.value, 0);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{fmt.format(today)}</span>
        <span className="text-xs text-muted-foreground">
          today · {fmt.format(window)} in {series.length} days
        </span>
      </div>
      <Sparkbars series={series} format={{ format: "number", precision: 0 }} className="h-12" />
      <span className="text-xs text-muted-foreground">{sub}</span>
    </Card>
  );
}

export function GrowthSection({ series, totals }: { series: GrowthSeries; totals: GrowthTotals }) {
  return (
    <section className="mt-8">
      <SectionHeading>Growth</SectionHeading>
      <p className="mb-3 text-xs text-muted-foreground">
        {/**
         * THE TIMEZONE IS STATED, not assumed. A founder checking at 9pm in
         * Stockholm is looking at a UTC day that closed two hours ago, and the
         * difference between "today is quiet" and "today ended" is the whole
         * value of the figure.
         *
         * AND WHAT A "NEW WORKSPACE" IS. `workspace_owners` carries a second
         * kind of row — an owner claimed for an OLD workspace the first time
         * its ranks are read — which is dated the moment it is claimed rather
         * than the moment the workspace was made. Those are excluded here, and
         * were NOT excluded from this page's 30-day figure until 17 Sep 2026.
         */}
        Days are UTC. A new workspace is one that was created, not one whose owner record was filled in later — see{" "}
        <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">src/lib/admin/growth.ts</code>.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Series
          label="New workspaces"
          today={totals.workspacesToday}
          series={series.workspaces}
          sub={`${fmt.format(totals.workspaces7d)} in 7 days · ${fmt.format(totals.workspaces30d)} in 30`}
        />
        <Series
          label="Apps connected"
          today={totals.connectionsToday}
          series={series.connections}
          sub="Somebody plugged a source in"
        />
        <Series
          label="Flows built"
          today={totals.flowsToday}
          series={series.flows}
          sub="The act the product exists for"
        />
      </div>
    </section>
  );
}
