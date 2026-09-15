/**
 * THE FIRST-RUN WALKTHROUGH — which steps exist, and when it is allowed to run.
 *
 * Pure and framework-free so the decisions that matter can be tested without a
 * browser. The rendering lives in `src/components/tour.tsx`; everything here is
 * a value.
 *
 * ═══ IT ORIENTS, IT DOES NOT INSTRUCT ═══
 *
 * `OnboardingChecklist` already tells a new workspace WHAT to do — connect,
 * build, publish — and ticks each step off real state, so it doubles as a
 * progress readout. Repeating that in a tour would be two systems saying the
 * same thing in different words, and the tour would be the one that goes stale.
 *
 * So this answers the other question: WHERE things are. Five pointers at the
 * chrome, ending by handing over to the checklist that is already on screen.
 * One line each — the product's standing rule is that explanation belongs
 * behind an ⓘ rather than on the surface, and a tour is the one place a
 * sentence is the point, so it gets exactly one.
 *
 * ═══ WHEN IT RUNS, AND WHY THAT NEEDED NO MIGRATION ═══
 *
 * A tour is only useful to somebody who has not done the thing yet, so
 * "new" is derived from the state that already exists: no connections and no
 * flows. That makes it SELF-LIMITING — the moment a workspace connects
 * anything it stops appearing, permanently, with nothing to remember. The
 * failure mode of a tour is nagging, and a condition that dissolves on first
 * success cannot nag.
 *
 * Dismissal is a browser key, which is the honest trade: dismiss on a laptop,
 * open on a phone while still empty, and it appears once more. The alternative
 * was a column and a migration, and per-device forgetfulness on a five-step
 * tour that already self-limits is not worth one.
 */

export type TourStep = {
  /** Stable id — the key React renders by, and what a test names. */
  id: string;
  /** The `data-tour` attribute the spotlight looks for. */
  anchor: string;
  title: string;
  body: string;
  /** Which side of the anchor the bubble prefers. Flipped at the viewport edge. */
  placement: "right" | "bottom" | "left";
};

/**
 * Bumped when the steps change materially, which re-shows the tour to people
 * who dismissed the old one. Not done lightly: a version bump is a decision to
 * interrupt everybody who is still empty, so it is for a tour that now says
 * something different, never for a copy tweak.
 */
export const TOUR_KEY = "nz_tour_v1";

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "apps",
    anchor: "nav-apps",
    title: "Start here",
    body: "Connect the tools your data already lives in.",
    placement: "right",
  },
  {
    id: "flows",
    anchor: "nav-flows",
    title: "Flows",
    body: "Turn that data into a number — filter, group, and test it on real records.",
    placement: "right",
  },
  {
    id: "dashboard",
    anchor: "nav-dashboard",
    title: "Your board",
    body: "Published numbers land here and keep themselves up to date.",
    placement: "right",
  },
  {
    id: "search",
    anchor: "rail-search",
    title: "Search",
    body: "Jump to any flow, app or view.",
    placement: "right",
  },
  {
    id: "alerts",
    anchor: "top-bell",
    title: "Alerts",
    body: "If a connection or flow breaks, it shows up here.",
    placement: "bottom",
  },
] as const;

/**
 * Should a brand-new workspace be offered the tour?
 *
 * Every condition is a reason NOT to show it, which is the safe direction: a
 * tour that fails to appear costs a little discoverability, and one that
 * appears over someone's real work costs their patience.
 */
export function shouldOfferTour(input: {
  hasConnection: boolean;
  hasFlow: boolean;
  /** The browser key, read by the caller — this stays pure. */
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  // Either one means they are past the part this explains.
  return !input.hasConnection && !input.hasFlow;
}

/**
 * The steps whose anchors are actually on the page.
 *
 * NOT cosmetic. The rail collapses into a drawer on a narrow viewport, so
 * `nav-apps` and `rail-search` genuinely are not in the document there, and a
 * spotlight with nothing to point at is a grey box in the middle of the screen
 * with an arrow into empty space. Missing anchors are dropped rather than
 * rendered, and a tour left with nothing to show does not open at all.
 */
export function visibleSteps(present: (anchor: string) => boolean, steps: readonly TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((s) => present(s.anchor));
}

/** Clamp a step index into range, so a stale index can never blank the tour. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, index), total - 1);
}
