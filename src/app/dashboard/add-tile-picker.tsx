"use client";

import { useState } from "react";
import { BarChart3, Filter, Hash, Rows3, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { CHARTS, type ChartId } from "@/lib/board/charts";
import type { CustomTileOption } from "@/lib/board/types";

/**
 * ADD A CHART — chart first, then metric.
 *
 * CHART FIRST IS THE USEFUL ORDER, and not merely the one specified. Picking
 * the chart lets step two list only the metrics that can actually be drawn that
 * way, which is a filter that removes wrong answers. Metric first would leave
 * step two showing every chart with most of them disabled, which is a list of
 * things you cannot have.
 *
 * A chart no metric on this board can draw is shown DISABLED with the reason,
 * rather than hidden. "Breakdown" missing entirely reads as a product that does
 * not do breakdowns; "Breakdown — no metric here has one" reads as a fact about
 * this workspace's data, which is what it is.
 *
 * `options` is plain server-computed data — key, title, and the charts each
 * metric supports — so it crosses the RSC boundary the same way `BoardTile`
 * does. `chartsFor` decided those lists on the server; this component filters
 * with them and never re-derives, because two definitions of "can be drawn as"
 * is exactly the gap this feature exists to close.
 */

const ICONS: Record<ChartId, typeof Hash> = {
  number: Hash,
  bar: BarChart3,
  category: Rows3,
  progress: Target,
  funnel: Filter,
};

/** Below this a search box is clutter; above it, the list is a wall. */
const SEARCH_AT = 8;

export function AddTilePicker({
  options,
  busy,
  onClose,
  onAdd,
}: {
  options: CustomTileOption[];
  busy: boolean;
  onClose: () => void;
  onAdd: (tileKey: string, chart: ChartId) => void;
}) {
  const [chart, setChart] = useState<ChartId | null>(null);
  const [query, setQuery] = useState("");

  const countFor = (id: ChartId) => options.filter((o) => o.charts.includes(id)).length;

  if (!chart) {
    return (
      <Modal onClose={onClose} size="lg">
        <ModalTitle>Add a chart</ModalTitle>
        <p className="mt-1 text-small text-muted-foreground">
          Pick how you want it drawn. The same metric can appear more than once, drawn a different way each time.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {CHARTS.map((c) => {
            const n = countFor(c.id);
            const Icon = ICONS[c.id];
            return (
              <Button
                key={c.id}
                variant="secondary"
                disabled={n === 0}
                onClick={() => setChart(c.id)}
                className="h-auto w-full items-start justify-start gap-3 p-3 text-left"
                title={n === 0 ? `No metric on this board can be drawn as a ${c.label.toLowerCase()}` : undefined}
              >
                <Icon className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-small font-semibold text-foreground">{c.label}</span>
                  <span className="text-tiny font-normal text-muted-foreground">
                    {/* The blurb when it can be drawn; the REASON when it cannot.
                        A disabled control that does not say why is a dead end. */}
                    {n === 0 ? "No metric here can be drawn this way yet." : c.blurb}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </Modal>
    );
  }

  const label = CHARTS.find((c) => c.id === chart)!.label.toLowerCase();
  const eligible = options.filter((o) => o.charts.includes(chart));
  const shown = query.trim()
    ? eligible.filter((o) => o.title.toLowerCase().includes(query.trim().toLowerCase()))
    : eligible;

  return (
    <Modal onClose={onClose} size="lg">
      {/* The title changes with the step, so `aria-labelledby` stays truthful
          rather than announcing "Add a chart" over a list of metrics. */}
      <ModalTitle>Choose a metric for this {label}</ModalTitle>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="link" size="sm" onClick={() => setChart(null)} className="px-0">
          ← Back to charts
        </Button>
        {eligible.length > SEARCH_AT && (
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search metrics"
            aria-label="Search metrics"
            className="h-8 flex-1"
          />
        )}
      </div>

      <div className="mt-2 max-h-80 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-small text-muted-foreground">
            {eligible.length === 0 ? `Nothing here can be drawn as a ${label} yet.` : "No metric matches that."}
          </p>
        ) : (
          shown.map((o) => (
            <Button
              key={o.key}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onAdd(o.key, chart)}
              className="h-auto w-full justify-start px-2 py-2 text-left"
            >
              <span className="truncate text-small font-medium text-foreground">{o.title}</span>
            </Button>
          ))
        )}
      </div>
    </Modal>
  );
}
