"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomBoard, type CanvasActions, type CanvasTile } from "@/app/dashboard/custom-board";
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
export function CanvasHarness({ tiles: initial, options }: { tiles: CanvasTile[]; options: CustomTileOption[] }) {
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
      editTile: async () => ({ ok: true as const }),
      writeLayout: async () => ({ ok: true as const }),
    }),
    [],
  );

  const remoteAdd = () => {
    const n = ++minted.current;
    setTiles((prev) => [
      ...prev,
      {
        id: `sim-remote-${n}`,
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
    <div>
      <div className="mb-3 flex gap-2">
        <Button variant="secondary" size="sm" onClick={remoteAdd} {...{ "data-canvas-sim": "add" }}>
          Simulate remote add
        </Button>
        <Button variant="secondary" size="sm" onClick={remoteDelete} {...{ "data-canvas-sim": "remove" }}>
          Simulate remote delete
        </Button>
      </div>
      <CustomBoard viewId="design" tiles={tiles} options={options} rangeKey="today" canEdit actions={actions} />
    </div>
  );
}
