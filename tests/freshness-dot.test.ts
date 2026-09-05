import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// flow-tile.tsx imports a "use server" action and next/link; the same
// boundary tests/custom-tile-render.test.ts already crosses to reach a
// named export from this file in a plain node render.
vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

const { Freshness } = await import("@/components/flow-tile");

/**
 * THE BLUE RETHEME (4 Sep 2026) — the healthy dot stops re-using
 * `--success` for its own colour. `--freshness-dot`/`--freshness-halo` are
 * new, separate tokens (globals.css) so a goal bar or a badge going
 * success-green some day cannot drag the freshness dot's hue along with it,
 * and this dot changing hue cannot dim what "goal met" means elsewhere.
 */
describe("Freshness, 4 Sep 2026 blue retheme", () => {
  it("draws the healthy dot in --freshness-dot inside the --freshness-halo, never --success", () => {
    const html = renderToStaticMarkup(createElement(Freshness, { status: "fresh" }));
    expect(html, "the halo wraps the dot in bg-freshness-halo").toMatch(/bg-freshness-halo/);
    expect(html, "the dot itself is bg-freshness-dot").toMatch(/bg-freshness-dot/);
    expect(html, "the old success re-use is gone from this mark").not.toContain("bg-success");
  });
});
