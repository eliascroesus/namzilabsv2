import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_ZOOM, MIN_ZOOM, MAX_ZOOM, zoomPercent } from "@/components/flow/graph-utils";

/**
 * "100%" IS A PROMISE ABOUT THE RESTING SIZE.
 *
 * 1:1 is not the resting size of this canvas — 1.3 is. So a flow opens at 1.3,
 * "fit" returns to 1.3, and the readout calls 1.3 "100%". That only holds while
 * all three read the SAME constant: cap the fit at one number and scale the
 * readout by another and the badge starts lying, which is worse than the 130%
 * it replaced because nothing on screen would look wrong.
 *
 * The percentage is a real conversion, not a relabelled 1.0 — zooming in and
 * out has to keep producing sensible numbers on either side of it.
 */
const canvas = readFileSync(join(__dirname, "../src/components/flow/flow-canvas.tsx"), "utf8");

describe("the zoom scale", () => {
  it("calls the resting size 100%", () => {
    expect(zoomPercent(BASE_ZOOM)).toBe(100);
  });

  it("reads as a real percentage on both sides of it", () => {
    expect(zoomPercent(MIN_ZOOM)).toBe(50);
    expect(zoomPercent(MAX_ZOOM)).toBe(200);
    expect(zoomPercent(BASE_ZOOM * 0.75)).toBe(75);
    expect(zoomPercent(BASE_ZOOM * 1.5)).toBe(150);
    // 1:1 is now a zoomed-OUT view, and says so.
    expect(zoomPercent(1)).toBe(77);
  });

  it("bounds the canvas at half and double the resting size", () => {
    expect(MIN_ZOOM).toBeCloseTo(BASE_ZOOM / 2);
    expect(MAX_ZOOM).toBeCloseTo(BASE_ZOOM * 2);
  });

  it("is the same constant the canvas opens, fits and bounds with", () => {
    // No literal 1.3 anywhere — every use resolves to BASE_ZOOM, or the badge
    // and the viewport can drift apart with nothing to show for it.
    expect(canvas).toMatch(/fitViewOptions=\{\{\s*maxZoom:\s*BASE_ZOOM\s*\}\}/);
    expect(canvas).toMatch(/fitView\(\{[^}]*maxZoom:\s*BASE_ZOOM[^}]*\}\)/);
    expect(canvas).toMatch(/minZoom=\{MIN_ZOOM\}/);
    expect(canvas).toMatch(/maxZoom=\{MAX_ZOOM\}/);
    expect(canvas).toMatch(/zoomPct=\{zoomPercent\(zoom\)\}/);
    expect(canvas).not.toMatch(/[Zz]oom:\s*1\.3\b/);
  });
});
