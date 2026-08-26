"use client";

import { useState } from "react";
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

export function MetricPicker({
  options,
  chart,
  busy,
  onClose,
  onPick,
}: {
  options: CustomTileOption[];
  /** The tile's chart, which is staying — only the data under it moves. */
  chart: ChartId;
  busy: boolean;
  onClose: () => void;
  onPick: (tileKey: string) => void;
}) {
  const [query, setQuery] = useState("");

  const label = (CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label.toLowerCase();
  const eligible = options.filter((o) => o.charts.includes(chart));
  const shown = query.trim()
    ? eligible.filter((o) => o.title.toLowerCase().includes(query.trim().toLowerCase()))
    : eligible;

  return (
    <Modal onClose={onClose} size="lg">
      <ModalTitle>Choose a metric for this {label}</ModalTitle>
      {eligible.length > SEARCH_AT && (
        <div className="mt-3">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search metrics"
            aria-label="Search metrics"
            className="h-8 w-full"
          />
        </div>
      )}

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
              onClick={() => onPick(o.key)}
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
