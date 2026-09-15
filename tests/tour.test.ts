import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLOW_TOUR_KEY,
  FLOW_TOUR_STEPS,
  TOUR_KEY,
  TOUR_STEPS,
  clampStep,
  shouldOfferFlowTour,
  shouldOfferTour,
  visibleSteps,
} from "@/lib/tour";

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


/**
 * THE BUILDER'S OWN TOUR — a second, shorter one, on the surface the owner
 * called hard.
 *
 * Its risk is different from the board's. That one points at a rail which is
 * always there; this lives over a canvas where almost every control is
 * CONDITIONAL — "Add next step" belongs to a terminal node, the Configure/Test
 * panel exists only once something is selected, and the nodes themselves pan
 * and re-lay-out under a drag. Pointing at something usually absent is the bug
 * this feature has already shipped twice, so what is tested here is that both
 * anchors are unconditional.
 */
describe("the flow builder's walkthrough", () => {
  it("only offers itself while this is their first flow", () => {
    expect(shouldOfferFlowTour({ flowCount: 0, dismissed: false })).toBe(true);
    expect(shouldOfferFlowTour({ flowCount: 1, dismissed: false })).toBe(true);
    // Two means they have built one. An explanation of the canvas is now an
    // interruption rather than help.
    expect(shouldOfferFlowTour({ flowCount: 2, dismissed: false })).toBe(false);
    expect(shouldOfferFlowTour({ flowCount: 9, dismissed: false })).toBe(false);
  });

  it("respects a dismissal", () => {
    expect(shouldOfferFlowTour({ flowCount: 1, dismissed: true })).toBe(false);
  });

  it("anchors only on elements that are always rendered", () => {
    /**
     * Read from the components rather than a list kept in step by hand. The
     * canvas step points at the CONTAINER and the publish step at the
     * toolbar's button — the two things on that screen that do not come and go.
     */
    const canvas = readFileSync(join(process.cwd(), "src/components/flow/flow-canvas.tsx"), "utf8");
    const toolbar = readFileSync(join(process.cwd(), "src/components/flow/FlowToolbar.tsx"), "utf8");
    for (const step of FLOW_TOUR_STEPS) {
      const rendered = canvas.includes(`data-tour="${step.anchor}"`) || toolbar.includes(`data-tour="${step.anchor}"`);
      expect(rendered, `nothing renders data-tour="${step.anchor}" for flow step ${step.id}`).toBe(true);
    }
  });

  it("reaches the DOM — the component holding it must forward attributes", () => {
    /**
     * THE HOLE THE OTHER ANCHOR TEST HAS, and it let a broken anchor through.
     *
     * Checking that a call site CONTAINS `data-tour="x"` proves the string was
     * typed, not that it renders. `GetStartedCard` took a closed prop list and
     * rendered `<div className={...}>`, so the attribute was dropped on the
     * floor — and TypeScript says nothing, because it does not type-check
     * hyphenated `data-*` on a custom component.
     *
     * So for any anchor placed on a CUSTOM component (capitalised tag) rather
     * than a plain element, the receiving component has to spread its rest
     * props. That is checkable from here; the DOM is not.
     */
    const files = [
      "src/components/flow/flow-canvas.tsx",
      "src/components/flow/FlowToolbar.tsx",
      "src/components/sidebar.tsx",
      "src/components/notifications.tsx",
    ];
    let checked = 0;
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      // The opening tag that carries each anchor.
      for (const m of src.matchAll(/<([A-Za-z][\w.]*)\b[^>]*?data-tour=/gs)) {
        const tag = m[1];
        if (!/^[A-Z]/.test(tag)) continue; // a plain element always renders it
        checked++;
        /**
         * Mapped by hand on purpose: anchoring a NEW component fails this
         * until somebody adds it here, which is the moment to check that it
         * forwards. An automatic import-resolver would quietly cover the next
         * one without anybody looking.
         */
        const known: Record<string, string> = {
          GetStartedCard: "src/components/get-started-card.tsx",
          Button: "src/components/ui/button.tsx",
        };
        /**
         * Components whose forwarding is a documented contract rather than
         * something readable in this repo. Each needs a reason, because
         * "assume it works" is how the dropped anchor happened.
         */
        const byContract: Record<string, string> = {
          Link: "next/link passes unknown props through to the <a> it renders",
        };
        if (byContract[tag]) continue;
        const compFile = known[tag] ?? null;
        expect(compFile, `${rel} puts a tour anchor on <${tag}>, which this test does not know how to verify`).not.toBeNull();
        const comp = readFileSync(join(process.cwd(), compFile), "utf8");
        expect(comp, `<${tag}> must spread its rest props or the anchor never renders`).toMatch(/\{\.\.\.(rest|props)\}/);
      }
    }
    // Would pass vacuously if every anchor moved onto plain elements — which is
    // fine, but say so rather than claiming to have checked something.
    expect(checked, "no anchors sit on custom components right now").toBeGreaterThan(0);
  });

  it("does not anchor on a node, which moves under a drag", () => {
    // A spotlight fixed to a node would chase it around the canvas and
    // re-measure on every frame of a pan.
    const nodeCard = readFileSync(join(process.cwd(), "src/components/flow/FlowNodeCard.tsx"), "utf8");
    expect(nodeCard, "FlowNodeCard must carry no tour anchor").not.toContain("data-tour");
  });

  it("stays short, and keeps its own storage key", () => {
    // A tour over a working surface is an interruption; the board's five steps
    // are affordable on an empty dashboard and would not be here.
    expect(FLOW_TOUR_STEPS.length).toBeLessThanOrEqual(3);
    expect(FLOW_TOUR_KEY).not.toBe(TOUR_KEY);
    expect(FLOW_TOUR_KEY).toMatch(/_v\d+$/);
    for (const step of FLOW_TOUR_STEPS) {
      expect(step.body.split(". ").length, `${step.id} body is more than one sentence`).toBeLessThanOrEqual(1);
    }
  });
});
