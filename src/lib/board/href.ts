/**
 * A LINK TO THE BOARD, AND WHAT RIDES ALONG ON IT.
 *
 * The board's state lives in the URL — the window in `?range=`, the connection
 * filter in `?source=`, the view in `?view=` — because that is what makes back
 * and forward work and what makes a link pasted into Slack open on the numbers
 * the sender was looking at. Every link BETWEEN parts of the board therefore
 * has to carry the parts it is not changing.
 *
 * WHY THIS IS A MODULE RATHER THAN A CLOSURE ON THE PAGE. It was a closure on
 * the page — `qs()` in `dashboard/page.tsx`, which gets it right — and the
 * rail spelled the same rule again by hand as `/dashboard?view=${v.id}`,
 * carrying neither the range nor the source. The result was a board where
 * switching view from the tab strip kept your window and switching to the SAME
 * view from the rail two inches to its left threw you back to "Last 7 days".
 * Nothing was broken in either place; there were simply two copies of one rule
 * and only one of them had been maintained. So there is one now, and both call
 * it.
 *
 * IT TAKES FINAL VALUES, NOT OVERRIDES. `qs()` keeps its own merge-over-current
 * behaviour on top of this, because the page is the only caller that has a
 * "current" to merge against; the rail reads its values off the URL it is
 * standing on. Splitting it this way keeps the part worth testing pure.
 */
export function boardHref(params: { range?: string | null; source?: string | null; view?: string | null }): string {
  const p = new URLSearchParams();
  /**
   * ABSENT, NOT EMPTY. An empty `view=` is how the page spells the DEFAULT
   * board, so writing it would be harmless but noisy; an empty `source=` is
   * not harmless at all — it reads as a filter to a connection with no id.
   * Both are simply left out, which is also what makes `boardHref({})` the
   * bare board, the right answer for a rail link pressed from a page that has
   * no window in its URL to preserve.
   */
  if (params.range) p.set("range", params.range);
  if (params.source) p.set("source", params.source);
  if (params.view) p.set("view", params.view);
  const q = p.toString();
  return q ? `/dashboard?${q}` : "/dashboard";
}
