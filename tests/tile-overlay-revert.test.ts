import { describe, it, expect } from "vitest";

/**
 * TWO EDITS IN FLIGHT, AND WHAT A FAILURE IS ALLOWED TO PUT BACK.
 *
 * Nothing disables the settings panel while a write is out, so a colour and a
 * toggle two hundred milliseconds apart are both in flight against the same
 * tile. `useSettle`'s own note states the rule this creates — "puts back only
 * what this write touched, never a whole snapshot, because a neighbouring
 * gesture may be in flight" — and the first version of the config overlay
 * broke it by restoring the whole prior entry.
 *
 * It broke in two directions, and both are here:
 *
 *   A FAILED WRITE DISCARDED A NEIGHBOUR THAT SUCCEEDED. The value vanished
 *   from the screen and nothing brought it back: a config write moves neither
 *   `resultsVersion` (so `FreshnessPoller` never fires) nor the router, so the
 *   `tiles` prop stayed stale until a reload.
 *
 *   A FAILED WRITE REINSTATED ANOTHER FAILED WRITE'S VALUE, from the snapshot
 *   the later edit had captured. That leaves an overlay key the server will
 *   never agree with, so the retire effect can never delete it — the tile is
 *   wrong permanently.
 *
 * The reducer is reproduced here rather than driven through React, because
 * what is being asserted is the ARITHMETIC of merge-and-revert, and this suite
 * runs in node with no DOM. It is kept honest by the source pin at the bottom.
 */

type Entry = { chart?: string; config?: Record<string, unknown> };
type Patch = { chart?: string; config?: Record<string, unknown>; clear?: string[] };

/** The overlay exactly as `editTile` maintains it. */
function makeOverlay() {
  let m = new Map<string, Entry>();

  /** Apply optimistically; returns the revert this write is entitled to run. */
  function apply(id: string, patch: Patch): () => void {
    const prev = m.get(id);
    const cleared = Object.fromEntries((patch.clear ?? []).map((k) => [k, undefined]));
    const touched = [...Object.keys(patch.config ?? {}), ...(patch.clear ?? [])];
    const next = new Map(m);
    next.set(id, {
      ...prev,
      ...(patch.chart !== undefined ? { chart: patch.chart } : {}),
      ...(patch.config || patch.clear ? { config: { ...prev?.config, ...patch.config, ...cleared } } : {}),
    });
    m = next;

    return () => {
      const cur = m.get(id);
      if (!cur) return;
      const config: Record<string, unknown> = { ...cur.config };
      for (const k of touched) {
        if (prev?.config && k in prev.config) config[k] = prev.config[k];
        else delete config[k];
      }
      const chart = patch.chart !== undefined ? prev?.chart : cur.chart;
      const out = new Map(m);
      if (chart === undefined && Object.keys(config).length === 0) out.delete(id);
      else
        out.set(id, {
          ...(chart !== undefined ? { chart } : {}),
          ...(Object.keys(config).length > 0 ? { config } : {}),
        });
      m = out;
    };
  }

  return { apply, get: () => m };
}

describe("a failed config write reverts only its own keys", () => {
  it("leaves a concurrent write that SUCCEEDED on screen", () => {
    const o = makeOverlay();
    const revertA = o.apply("t1", { config: { color: "blue" } });
    o.apply("t1", { config: { precision: 2 } }); // B — reaches the server fine
    revertA(); // A rejects

    // B's value survives. Restoring A's whole snapshot used to delete the entry
    // outright, taking precision with it — and no refresh would bring it back.
    expect(o.get().get("t1")).toEqual({ config: { precision: 2 } });
  });

  it("never leaves a key the server will not agree with", () => {
    /**
     * The permanent-wrongness case. Both writes fail, A settles first. The old
     * revert deleted the entry for A, then B's revert re-set the snapshot B had
     * captured — which still contained A's colour. The server stored neither,
     * so `configCaught` was false on every subsequent render and the entry
     * never retired.
     */
    const o = makeOverlay();
    const revertA = o.apply("t1", { config: { color: "blue" } });
    const revertB = o.apply("t1", { config: { showGoal: true } });
    revertA();
    revertB();
    expect(o.get().has("t1")).toBe(false);
  });

  it("holds whichever order the failures settle in", () => {
    const o = makeOverlay();
    const revertA = o.apply("t1", { config: { color: "blue" } });
    const revertB = o.apply("t1", { config: { showGoal: true } });
    revertB();
    revertA();
    expect(o.get().has("t1")).toBe(false);
  });

  it("puts a cleared key back as cleared, not as absent", () => {
    // An overlay carries a cleared key as an explicit `undefined`, because it
    // is spread OVER the server's bag. Reverting a later write must restore
    // that undefined rather than delete the key and un-hide the stored value.
    const o = makeOverlay();
    o.apply("t1", { clear: ["target"] });
    const revertB = o.apply("t1", { config: { target: 40 } });
    revertB();
    const entry = o.get().get("t1")!;
    expect("target" in entry.config!).toBe(true);
    expect(entry.config!.target).toBeUndefined();
  });

  it("reverts a chart change without touching the config keys beside it", () => {
    const o = makeOverlay();
    o.apply("t1", { config: { color: "blue" } });
    const revertChart = o.apply("t1", { chart: "pie" });
    revertChart();
    expect(o.get().get("t1")).toEqual({ config: { color: "blue" } });
  });
});

describe("the board runs this same arithmetic", () => {
  it("is not a model that drifted from the component", async () => {
    /**
     * The pin. This file reproduces `editTile`'s reducer, so it is only worth
     * anything while the component still does what it models — the three moves
     * that make the revert key-scoped rather than wholesale.
     */
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/app/dashboard/custom-board.tsx"), "utf8");
    expect(src).toContain("const touched: Array<keyof TileConfig>");
    expect(src).toContain("k in prev.config");
    // Sabotage: put back `if (prev) next.set(id, prev); else next.delete(id)`
    // and this fails — that is the whole-snapshot revert returning.
    expect(src).not.toContain("if (prev) next.set(id, prev);");
  });
});
