"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { CHARTS, type ChartId } from "@/lib/board/charts";
import type { CustomTileOption } from "@/lib/board/types";

/**
 * CHANGE WHICH METRIC A TILE POINTS AT.
 *
 * This used to be the two-step add flow — chart, then metric, in a modal — and
 * that flow is gone on purpose: adding now lands a chart immediately (Looker's
 * behaviour) and the metric question is asked LATER, by the person, on the
 * tile. What survives is the half that was always right: given a chart that is
 * staying, list only the metrics that can be drawn that way, so a repoint can
 * never leave a tile asking for a drawing its new metric cannot give.
 *
 * `options` is plain server-computed data — key, title, and the charts each
 * metric supports. `chartsFor` decided those lists on the server; this
 * component filters with them and never re-derives, because two definitions of
 * "can be drawn as" is exactly the gap this feature exists to close.
 */

/** Below this a search box is clutter; above it, the list is a wall. */
const SEARCH_AT = 8;

/**
 * THE LIST ITSELF, WITHOUT A MODAL AROUND IT.
 *
 * Two things ask "which metric?" — the repoint modal below, and the tile
 * config panel's Data tab, which asks it inline beside everything else about
 * the tile. They are one list: same eligibility rule, same search threshold,
 * same empty sentences. Extracting it was the alternative to a second copy
 * that would have answered the eligibility question its own way.
 */
export function MetricList({
  options,
  chart,
  busy,
  selected,
  onPick,
}: {
  options: CustomTileOption[];
  /** The tile's chart, which is staying — only the data under it moves. */
  chart: ChartId;
  busy: boolean;
  /** The tile's current metric, ticked so the list says where you already are. */
  selected?: string;
  onPick: (tileKey: string) => void;
}) {
  const [query, setQuery] = useState("");

  const label = (CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label.toLowerCase();
  const eligible = options.filter((o) => o.charts.includes(chart));
  const shown = query.trim()
    ? eligible.filter((o) => o.title.toLowerCase().includes(query.trim().toLowerCase()))
    : eligible;

  return (
    <>
      {eligible.length > SEARCH_AT && (
        <div className="mb-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search metrics"
            aria-label="Search metrics"
            className="h-8 w-full"
          />
        </div>
      )}
      <div className="max-h-80 overflow-y-auto">
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
              onClick={() => onPick(o.key)}
              aria-pressed={o.key === selected}
              className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
            >
              <Check
                size={13}
                strokeWidth={3}
                className={`shrink-0 ${o.key === selected ? "text-primary" : "invisible"}`}
                aria-hidden
              />
              <span className="truncate text-small font-medium text-foreground">{o.title}</span>
            </Button>
          ))
        )}
      </div>
    </>
  );
}

export function MetricPicker({
  options,
  chart,
  busy,
  onClose,
  onPick,
}: {
  options: CustomTileOption[];
  chart: ChartId;
  busy: boolean;
  onClose: () => void;
  onPick: (tileKey: string) => void;
}) {
  const label = (CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label.toLowerCase();
  return (
    <Modal onClose={onClose} size="lg">
      <ModalTitle>Choose a metric for this {label}</ModalTitle>
      <div className="mt-3">
        <MetricList options={options} chart={chart} busy={busy} onPick={onPick} />
      </div>
    </Modal>
  );
}
