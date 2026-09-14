"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomBoard, type CanvasActions, type CanvasTile } from "@/app/dashboard/custom-board";
import { TileConfigPanel } from "@/app/dashboard/tile-config-panel";
import type { TileConfig } from "@/lib/board/tile-config";
import type { CustomTileOption } from "@/lib/board/types";

/**
 * THE LIVE BOARD, WITH THE SERVER PLAYED BY THIS FILE.
 *
 * The crash that shipped to production lived on the SUCCESS path: a successful
 * add put a box in the board's layout, the `tiles` prop had not caught up, and
 * the render died reading fields off a tile that was not there. The specimen's
 * real actions can only FAIL here — there is no session — so the one path that
 * broke was the one path the harness could not reach.
 *
 * This wrapper closes that hole. It owns the `tiles` array and injects fake
 * actions that SUCCEED, exactly as the server would — and deliberately does NOT
 * add the new tile to `tiles`, because that lag is the real world: the prop
 * catches up on a later refresh, and the board must survive the window.
 *
 * The two "simulate" buttons are the other tab: a remote add appends to the
 * prop (the board must show it — membership reconciles), a remote delete
 * removes from it (the box must vanish rather than ghost — the ghost was what
 * bricked every subsequent move).
 */
export function CanvasHarness({
  tiles: initial,
  options,
  layoutFrozen = false,
  slotId = "canvas-add-chart",
}: {
  tiles: CanvasTile[];
  options: CustomTileOption[];
  /** Stands in for "this view holds a row your rank hides" — see `layoutFrozen`. */
  layoutFrozen?: boolean;
  /**
   * ONE ID PER HARNESS ON THIS PAGE, because this page mounts three of them and
   * an `id` is supposed to be unique in a document. All three used to render
   * `id="canvas-add-chart"`; `getElementById` answers the FIRST, so all three
   * boards portalled their "+ Add" into the topmost specimen's div and the live
   * board's own button rendered outside `[data-live-board]` — invisible to the
   * check written to press it.
   */
  slotId?: string;
}) {
  const [tiles, setTiles] = useState(initial);
  const minted = useRef(0);

  const actions = useMemo<Partial<CanvasActions>>(
    () => ({
      // Succeeds like the server, minting an id — and does NOT touch `tiles`,
      // which is precisely the window the production crash lived in.
      addTile: async (_viewId, tileKey, chart) => ({
        ok: true as const,
        tile: { id: `sim-added-${++minted.current}`, tileKey, chart, config: {}, x: 0, y: 99, w: 3, h: 4 },
      }),
      deleteTile: async () => ({ ok: true as const }),
      // Answers with the copy's real geometry, as the server does — the board
      // lands the box from that answer rather than waiting for a refresh.
      duplicateTile: async (id) => {
        const from = tiles.find((t) => t.id === id);
        return {
          ok: true as const,
          tile: {
            id: `sim-copy-${++minted.current}`,
            tileKey: from?.tileKey ?? "flow:demo:x",
            chart: from?.chart ?? "number",
            config: from?.config ?? {},
            // The server's own rule, mirrored: beside if the row has room,
            // directly below if it does not. A fake that places the copy
            // somewhere the real one never would tests nothing.
            x: from && from.x + from.w * 2 <= 12 ? from.x + from.w : (from?.x ?? 0),
            y: from && from.x + from.w * 2 <= 12 ? from.y : (from?.y ?? 0) + (from?.h ?? 4),
            w: from?.w ?? 3,
            h: from?.h ?? 4,
          },
        };
      },
      editTile: async () => ({ ok: true as const }),
      writeLayout: async () => ({ ok: true as const }),
    }),
    [tiles],
  );

  const remoteAdd = () => {
    const n = ++minted.current;
    setTiles((prev) => [
      ...prev,
      {
        id: `sim-remote-${n}`,
        tileKey: `flow:sim:${n}`,
        x: 0,
        y: 99,
        w: 3,
        h: 4,
        chart: "number",
        charts: ["number"],
        metricName: `Remote ${n}`,
        config: {},
        attention: 1,
        // A dead source — the card that says the metric is gone, which is what
        // a remote add of a metric this page cannot resolve looks like.
        data: null,
      },
    ]);
  };

  const remoteDelete = () => setTiles((prev) => prev.slice(0, -1));

  return (
    /* `data-canvas-harness` scopes the browser check to the LIVE board: the
       gallery above mounts panel specimens carrying the same `data-tile-panel`
       hook, and an unscoped locator matched all three. */
    <div {...{ "data-canvas-harness": "" }}>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={remoteAdd} {...{ "data-canvas-sim": "add" }}>
          Simulate remote add
        </Button>
        <Button variant="secondary" size="sm" onClick={remoteDelete} {...{ "data-canvas-sim": "remove" }}>
          Simulate remote delete
        </Button>
        {/* THE SAME PORTAL TARGET THE DASHBOARD'S HEADER OFFERS, AND FOR THE
            SAME REASON: `CustomBoard` looks up `#canvas-add-chart` by id and
            portals its own "+ Add" button and popover into it (see
            `custom-board.tsx`'s `Slot`). The dashboard page renders that div
            in its header actions; this harness has no header at all, so
            without a div of the same id here "+ Add" resolves its portal
            target to nothing and silently does not render — the gap this
            commit closes. `empty:hidden` matches the dashboard's own target:
            harmless on a canvas that can't edit (`canEdit` is hard-coded true
            above, so it never actually sits empty here, but the class keeps
            this specimen honest about what the real target does). */}
        <div id={slotId} className="flex items-center empty:hidden" />
      </div>
      <CustomBoard
        viewId="design"
        tiles={tiles}
        options={options}
        rangeKey="today"
        canEdit
        layoutFrozen={layoutFrozen}
        actions={actions}
        slotId={slotId}
      />
    </div>
  );
}

/**
 * THE TILE SETTINGS PANEL, SHOWN IN PLACE RATHER THAN OVER EVERYTHING.
 *
 * The panel is `fixed` — correct on the dashboard, where it is an overlay
 * pinned to the viewport — and that would make a gallery specimen hover over
 * the whole design page forever. The wrapper below has a transform on it, and
 * a transformed ancestor becomes the containing block for its fixed
 * descendants, so the real component with its real classes lays out inside the
 * box instead. Nothing about the panel is changed to be photographable, which
 * is the only way a specimen stays honest.
 *
 * Both tabs are mounted side by side because a screenshot cannot click.
 */
export function PanelSpecimen({ options }: { options: CustomTileOption[] }) {
  const [config, setConfig] = useState<TileConfig>({ color: "teal" });
  const apply = (set: TileConfig, clear?: Array<keyof TileConfig>) =>
    setConfig((c) => {
      const next: Record<string, unknown> = { ...c, ...set };
      for (const k of clear ?? []) delete next[k];
      return next as TileConfig;
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["data", "style"] as const).map((tab) => (
        <div key={tab} className="relative h-[600px] overflow-hidden rounded-surface [transform:translateZ(0)]">
          <TileConfigPanel
            chart="bar"
            charts={["number", "line", "area", "bar", "category", "table"]}
            config={config}
            metricName="Booked Leads"
            tileKey="flow:demo:t1"
            metricTarget={20}
            isFlow
            boardRange="7d"
            options={options}
            busy={false}
            initialTab={tab}
            onClose={() => {}}
            onChart={() => {}}
            onMetric={() => {}}
            onOrder={() => {}}
            onConfig={apply}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * THE COMPOSED DATA TAB, WHICH NOTHING IN THIS REPO HAD EVER RENDERED.
 *
 * `PanelSpecimen` above mounts a BAR chart with no parts, so the stages editor
 * — the counter heading, the anchor chip, the part chips and their reorder
 * controls, the Add button at its cap, the below-the-floor hint — existed only
 * in source. Every claim anyone makes about this panel's HEIGHT, and every
 * claim about what sits above the fold, is a claim no grep and no unit test in
 * this repo can see. That is the documented way a layout bug ships green here.
 *
 * TWO SPECIMENS, because the tidy case is not the one that goes wrong:
 *
 *   A SETTLED PIPELINE, with one part key deliberately absent from `options`
 *   so the "This metric isn't published any more" chip is photographed too —
 *   it is the state a reader reaches by unpublishing a flow, and it is the one
 *   chip whose only job is to stay removable.
 *
 *   A PIE OVER ITS CAP, holding six parts against a ceiling of five. It is
 *   reachable in one press — changing a composed funnel to a pie carries the
 *   parts across — and the heading reading "Parts (6 of 5)" beside a disabled
 *   Add button is the only thing on screen that explains the tile's refusal.
 */
/** Which metric the panel is FOR. Most cases use the board's own first tile. */
const anchorOf = (c: { anchor?: string }) => c.anchor ?? "flow:demo:t1";

export function ComposedPanelSpecimen({ options }: { options: CustomTileOption[] }) {
  const CASES: Array<{ label: string; chart: "pipeline" | "pie" | "ranked"; anchor?: string; parts: string[] }> = [
    {
      label: "A pipeline, one stage unpublished",
      chart: "pipeline" as const,
      parts: ["flow:demo:t2", "flow:demo:gone", "flow:demo:t3"],
    },
    {
      label: "A pie carried past its cap by a chart switch",
      chart: "pie" as const,
      parts: ["flow:demo:t2", "flow:demo:t3", "flow:demo:t4", "flow:demo:t5", "flow:demo:t6", "flow:demo:t7"],
    },
    /**
     * RANKED BARS ANCHORED ON A RATE — the state no source test can see.
     *
     * Two rules meet here and both used to be invisible until you pressed
     * something: a percentage may anchor a ranked chart (it may not anchor a
     * funnel or a pie, which divide their members), and the parts list may then
     * offer only the other percentages, because bars share an axis. Rendering
     * it here is how the list's contents can actually be read.
     */
    {
      label: "Ranked bars on a rate — only rates may join",
      chart: "ranked" as const,
      anchor: "flow:demo:p1",
      parts: ["flow:demo:p2"],
    },
    /**
     * THE FOURTH EMPTY STATE, which units invented. Every rate on this board is
     * already a bar while eight counts and a currency sit unused, so the list
     * is empty and "every metric here is already in this chart" would be
     * plainly false. The sentence has to name the real reason.
     */
    {
      label: "Ranked bars with every compatible metric used",
      chart: "ranked" as const,
      anchor: "flow:demo:p1",
      parts: ["flow:demo:p2", "flow:demo:p3"],
    },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-composed-panel>
      {CASES.map((c) => (
        <div key={c.label} className="relative h-[600px] overflow-hidden rounded-surface [transform:translateZ(0)]">
          <TileConfigPanel
            chart={c.chart}
            charts={["number", "pie", "funnel", "pipeline", "ranked"]}
            config={{ parts: c.parts }}
            metricName={options.find((o) => o.key === anchorOf(c))?.title ?? "Total Leads"}
            /* The ANCHOR, which is the tile's own metric — per case now, so a
               chart anchored on a rate can stand beside one anchored on a
               count. Its units are what the parts list filters by. */
            tileKey={anchorOf(c)}
            metricTarget={null}
            isFlow
            boardRange="7d"
            options={options}
            busy={false}
            initialTab="data"
            onClose={() => {}}
            onChart={() => {}}
            onMetric={() => {}}
            onOrder={() => {}}
            onConfig={() => {}}
          />
        </div>
      ))}
    </div>
  );
}
