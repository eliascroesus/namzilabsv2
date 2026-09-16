import DashboardLoading from "@/app/dashboard/loading";

/**
 * THE DASHBOARD'S FIRST-LOAD SKELETON, ON A PUBLIC ROUTE.
 *
 * It exists because that mirror has now drifted from the page THREE times, and
 * every drift shipped green. `tests/page-width.test.ts` compares the two
 * class strings, which catches a changed spelling and cannot catch a changed
 * SHAPE — and shape is what went wrong each time: a fallback capped at
 * `max-w-6xl` in front of an uncapped board (249px sideways), 152px of header
 * shims for a heading that now lives in the top bar, and a three-column grid
 * of half-height blocks in front of a twelve-column canvas. The owner's words
 * for the result were that the tiles were "all collapsed into each other".
 *
 * None of that is visible from the source. It is visible here in one look, and
 * measurable by `scripts/geometry-check.mjs` against `/design/overview`, which
 * renders the settled board in the same frame.
 *
 * The component is imported rather than copied, so this cannot itself drift.
 */
export default function LoadingLab() {
  return <DashboardLoading />;
}
