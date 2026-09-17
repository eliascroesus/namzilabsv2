import { SectionHeading } from "@/components/ui/page";
import { ChartFrame } from "@/components/board-charts/frame";
import { BarsVertical } from "@/components/board-charts/cartesian";
import { accentOf } from "@/lib/board/tile-config";
import type { GrowthSeries, GrowthTotals } from "@/lib/admin/growth";

/**
 * GROWTH, DRAWN THE WAY THE PRODUCT DRAWS EVERYTHING ELSE.
 *
 * The first version of this used `Sparkbars` — the 40px strip a metric tile
 * carries under a number. At three days of data that reads fine; at thirty it
 * is a row of hairlines in a pale field, with no axis, no scale and no dates.
 * It told you something had happened without letting you see WHEN or HOW MUCH,
 * which is the entire job of a growth chart.
 *
 * So this is `ChartFrame` + `BarsVertical`, which is exactly what a customer's
 * own dashboard renders for a bar metric: a real y-axis with chosen ticks, a
 * zero line, dated labels at the ends and middle, and the brand accent. The
 * admin panel is a dashboard; there was never a reason for it to have its own
 * weaker chart, and one fewer set of chart decisions in the codebase is worth
 * more than the couple of lines this saved.
 *
 * THE HEADLINE IS THE WINDOW, NOT TODAY. Three cards each reading "0" — which
 * is what "today" gives you most mornings — looks like a broken panel at a
 * glance, and it is the one reading a founder should never get by accident.
 * The thirty-day total is the number that says whether the thing is working;
 * today sits under the chart, where a zero is information rather than alarm.
 */

const fmt = new Intl.NumberFormat("en-GB");

/** Whole counts: no decimals on a chart of people and things. */
const COUNT = { format: "number" as const, precision: 0 };

function Growth({
  title,
  series,
  today,
  note,
}: {
  title: string;
  series: Array<{ bucket: string; value: number }>;
  today: number;
  note: string;
}) {
  const total = series.reduce((a, b) => a + b.value, 0);
  return (
    <div className="flex flex-col gap-2">
      {/* `h-64` because these are the only charts on the page and the page has
          the room — a tile on a customer's board is sized by its grid cell, and
          copying that constraint here would be inheriting a limit rather than a
          design. */}
      <div className="h-64">
        <ChartFrame title={title} headline={fmt.format(total)} status="fresh">
          {/* `unit="day"` is what makes the axis print dates instead of raw
              ISO strings, and what lets `padSeries` keep the spacing honest
              across a gap. */}
          <BarsVertical series={series} format={COUNT} accent={accentOf()} unit="day" />
        </ChartFrame>
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fmt.format(today)}</span> today · {note}
      </p>
    </div>
  );
}

export function GrowthSection({ series, totals }: { series: GrowthSeries; totals: GrowthTotals }) {
  return (
    <section className="mt-8">
      <SectionHeading>Growth · last {series.days} days</SectionHeading>
      <p className="mb-3 text-xs text-muted-foreground">
        {/* The reasoning lives in `growth.ts`; what survives here is the part an
            operator needs to read the number in front of them. */}
        Days are UTC · a new workspace means one that was created, not one whose owner record was filled in later
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Growth
          title="New workspaces"
          series={series.workspaces}
          today={totals.workspacesToday}
          note={`${fmt.format(totals.workspaces7d)} in the last 7 days`}
        />
        <Growth
          title="Apps connected"
          series={series.connections}
          today={totals.connectionsToday}
          note="somebody plugged a source in"
        />
        <Growth
          title="Flows built"
          series={series.flows}
          today={totals.flowsToday}
          note="the act the product exists for"
        />
      </div>
    </section>
  );
}
