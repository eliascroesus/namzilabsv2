import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOUR_KEY, TOUR_STEPS, clampStep, shouldOfferTour, visibleSteps } from "@/lib/tour";

/**
 * THE FIRST-RUN TOUR.
 *
 * The failure mode of a walkthrough is not that it looks wrong — it is that it
 * appears to somebody who has been using the product for a month, or points at
 * an element that is not on the screen. Both are decisions, both are pure, and
 * both are below.
 */

describe("when the tour is allowed to run", () => {
  const fresh = { hasConnection: false, hasFlow: false, dismissed: false };

  it("offers itself to a workspace that has done nothing yet", () => {
    expect(shouldOfferTour(fresh)).toBe(true);
  });

  it("never appears again once the workspace has connected anything", () => {
    /**
     * THE PROPERTY THAT REPLACED A MIGRATION. "New" is derived from state that
     * already exists, so the condition dissolves on first success — which is
     * what makes it impossible for this to nag, with nothing stored anywhere.
     */
    expect(shouldOfferTour({ ...fresh, hasConnection: true })).toBe(false);
    expect(shouldOfferTour({ ...fresh, hasFlow: true })).toBe(false);
    expect(shouldOfferTour({ hasConnection: true, hasFlow: true, dismissed: false })).toBe(false);
  });

  it("respects a dismissal even on an empty workspace", () => {
    expect(shouldOfferTour({ ...fresh, dismissed: true })).toBe(false);
  });

  it("treats every reason as a reason NOT to show", () => {
    // The safe direction: a tour that fails to appear costs a little
    // discoverability; one that appears over real work costs patience.
    const combos = [true, false].flatMap((hasConnection) =>
      [true, false].flatMap((hasFlow) => [true, false].map((dismissed) => ({ hasConnection, hasFlow, dismissed }))),
    );
    const shown = combos.filter(shouldOfferTour);
    expect(shown).toEqual([{ hasConnection: false, hasFlow: false, dismissed: false }]);
  });
});

describe("the steps", () => {
  it("points at an anchor that exists in the rail or the top bar", () => {
    /**
     * A step whose anchor nothing renders is a spotlight on empty space. This
     * reads the actual components rather than a list kept in step by hand — the
     * whole point is to fail when somebody renames a nav item.
     */
    const sidebar = readFileSync(join(process.cwd(), "src/components/sidebar.tsx"), "utf8");
    const notifications = readFileSync(join(process.cwd(), "src/components/notifications.tsx"), "utf8");

    // The rail derives its anchors from the nav labels, so the NAV array is
    // what has to contain them.
    const navLabels = [...sidebar.matchAll(/\{ label: "([^"]+)", href:/g)].map((m) => m[1].toLowerCase());
    expect(navLabels.length, "no NAV labels parsed — this check would pass vacuously").toBeGreaterThan(3);

    for (const step of TOUR_STEPS) {
      const fromNav = step.anchor.startsWith("nav-") && navLabels.includes(step.anchor.slice(4));
      const literal = sidebar.includes(`data-tour="${step.anchor}"`) || notifications.includes(`data-tour="${step.anchor}"`);
      expect(fromNav || literal, `nothing renders data-tour="${step.anchor}" for step ${step.id}`).toBe(true);
    }
  });

  it("says one thing per step", () => {
    // The product's standing rule is that explanation lives behind an ⓘ. A tour
    // is the one place a sentence IS the surface, so it gets exactly one.
    for (const step of TOUR_STEPS) {
      expect(step.title.length, `${step.id} title`).toBeLessThan(24);
      expect(step.body.split(". ").length, `${step.id} body is more than one sentence`).toBeLessThanOrEqual(1);
      expect(step.body.length, `${step.id} body`).toBeLessThan(90);
    }
  });

  it("ends on the step that asks for something", () => {
    /**
     * The order walks the rail as the product works and finishes on the only
     * step that is blocking — nothing else does anything until data is coming
     * in. A tour that ends on "Done" has told somebody five things and left
     * them where it found them.
     */
    const lastStep = TOUR_STEPS[TOUR_STEPS.length - 1];
    expect(lastStep.id).toBe("apps");
    expect(lastStep.href, "the last step must go somewhere").toBe("/integrations");
    expect(lastStep.cta, "and its button must say so").toBeTruthy();
    // Only the last one. A mid-tour step that navigated would abandon the rest.
    for (const s of TOUR_STEPS.slice(0, -1)) {
      expect(s.href, `${s.id} must not navigate mid-tour`).toBeUndefined();
    }
  });

  it("has stable, unique ids and anchors", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    expect(new Set(TOUR_STEPS.map((s) => s.anchor)).size).toBe(TOUR_STEPS.length);
  });

  it("carries a version in its storage key", () => {
    // Changing the steps materially means re-showing the tour, and that is a
    // deliberate act: bumping a version, not editing copy.
    expect(TOUR_KEY).toMatch(/_v\d+$/);
  });
});

describe("steps with no anchor on screen are dropped, not rendered", () => {
  it("keeps only what is present", () => {
    /**
     * NOT COSMETIC. The rail collapses into a drawer on a narrow viewport, so
     * `nav-apps` and `rail-search` genuinely are not in the document there, and
     * a spotlight with nothing to point at is a grey box with an arrow into
     * empty space.
     */
    const present = (a: string) => a === "nav-apps" || a === "top-bell";
    const kept = visibleSteps(present);
    // Declared order, not the order asked for — alerts sits before Apps now
    // that Apps is the closing step.
    expect(kept.map((s) => s.anchor)).toEqual(["top-bell", "nav-apps"]);
  });

  it("returns nothing when the page has none of them", () => {
    // The component treats an empty list as "do not open".
    expect(visibleSteps(() => false)).toEqual([]);
  });

  it("keeps the declared order", () => {
    const kept = visibleSteps(() => true);
    expect(kept.map((s) => s.id)).toEqual(TOUR_STEPS.map((s) => s.id));
  });
});

describe("clampStep", () => {
  it("cannot leave the index outside the steps", () => {
    expect(clampStep(-3, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(2, 5)).toBe(2);
  });

  it("survives an empty step list", () => {
    // A stale index against a list that shrank must not produce -1 and blank
    // the bubble.
    expect(clampStep(4, 0)).toBe(0);
  });
});
