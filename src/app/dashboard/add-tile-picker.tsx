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
 * THREE things ask "which metric?" — the repoint modal below; the tile config
 * panel's Data tab, which asks it inline beside everything else about the tile;
 * and that panel's stages/parts editor, which asks it once per member of a
 * composed funnel or pie. They are one list: same eligibility rule, same search
 * threshold, same empty sentences. Extracting it was the alternative to a
 * second copy that would have answered the eligibility question its own way —
 * and the third caller is the proof, because it asks for a DIFFERENT chart's
 * eligibility (`slot`) and still gets this file's one answer rather than its own.
 */
export function MetricList({
  options,
  chart,
  slot,
  exclude,
  busy,
  selected,
  onPick,
}: {
  options: CustomTileOption[];
  /** The tile's chart, which is staying — only the data under it moves. */
  chart: ChartId;
  /**
   * WHICH CHART THE PICKED METRIC HAS TO BE LEGAL FOR, when that is not the
   * tile's own.
   *
   * A composed funnel or pie asks this list a different question from the
   * repoint that built it, and the ANSWER changed once — so this says the
   * current one rather than the first one.
   *
   * "A metric that gives one number" was the obvious reading, and the parts
   * picker passed `"number"` for a day. Every metric gives one number, so the
   * stage list offered durations and rates and `compose.ts` refused them a
   * press later, under a hint promising only eligible metrics were listed. The
   * parts picker now passes the COMPOSING CHART (`slot={chart}`), which routes
   * the question through `tileOptions` — where a metric whose facts say it is
   * not a tally has already had the composed charts subtracted. The anchor list
   * and the stage list then agree by construction rather than by being filtered
   * the same way in two places.
   *
   * Defaults to `chart`, so every caller that predates composition keeps
   * exactly the behaviour it had.
   */
  slot?: ChartId;
  /**
   * TILE KEYS ALREADY SPOKEN FOR — the anchor, and the parts already chosen.
   *
   * A metric cannot be its own stage twice: in a funnel that is a 100%
   * conversion nobody measured, and in a pie it double-counts itself against
   * the whole. The SCHEMA is what actually enforces it (`tile-config.ts`
   * dedupes `parts`, because every export of a "use server" module is a public
   * endpoint); this is the courtesy that stops the author picking a refusal.
   */
  exclude?: string[];
  busy: boolean;
  /** The tile's current metric, ticked so the list says where you already are. */
  selected?: string;
  onPick: (tileKey: string) => void;
}) {
  const [query, setQuery] = useState("");

  const need = slot ?? chart;
  const label = (CHARTS.find((c) => c.id === need) ?? CHARTS[0]).label.toLowerCase();
  /**
   * DRAWABLE AND ELIGIBLE ARE TWO DIFFERENT LISTS, and only the first of them
   * may choose the empty sentence.
   *
   * "Nothing here can be drawn as a single number yet" is a claim about the
   * METRICS, and it is false the moment `exclude` is what emptied the list: a
   * funnel on a board of three metrics can use all three while the cap is still
   * seven, so the picker opens onto nothing and would tell the author their
   * board holds nothing countable while pointing at three. Choosing the
   * sentence from the pre-exclusion list keeps both readings true — a board
   * with nothing countable still reads "Nothing here can be drawn…", and a
   * board whose countable metrics are all in use reads "No metric matches
   * that", which is exactly what has happened to the list.
   */
  const drawable = options.filter((o) => o.charts.includes(need));
  const taken = new Set(exclude ?? []);
  const eligible = taken.size > 0 ? drawable.filter((o) => !taken.has(o.key)) : drawable;
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
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {/* THREE STATES, NOT TWO, because `exclude` invented a third.
                "No metric matches that" asserts a search — and when exclusion
                is what emptied the list (three metrics, all already stages, cap
                still seven) the search box is not even rendered, so the reader
                is told to fix a query they never typed and cannot see. The
                first two sentences are the originals, verbatim. */}
            {drawable.length === 0
              ? `Nothing here can be drawn as a ${label} yet.`
              : query.trim()
                ? "No metric matches that."
                : "Every metric here is already in this chart."}
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
              {/* A tick is a COLOURED GLYPH — three strokes and nothing
                  filled — so it is the marker's, not the brand's. `text-primary`
                  is the yellow, which measures 1.55:1 on this white panel: the
                  one state the menu has to communicate, drawn in a colour that
                  is not there. `marker-ink` is the step that survives at 13px. */}
              <Check
                size={13}
                strokeWidth={3}
                className={`shrink-0 ${o.key === selected ? "text-marker" : "invisible"}`}
                aria-hidden
              />
              <span className="truncate text-sm font-medium text-foreground">{o.title}</span>
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
