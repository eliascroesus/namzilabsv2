/**
 * THE VIEW STRIP'S ORDER, AS THE ONLY THING THE STRIP OWNS.
 *
 * The tab strip is a client component for exactly one reason: the order is
 * draggable, and a server component cannot follow a pointer. Everything ELSE
 * about a tab — its name, its icon, and above all its `href` — is the server's
 * answer, recomputed on every render from the URL the board is standing on.
 *
 * ═══ THE BUG THIS EXISTS TO MAKE IMPOSSIBLE ═══
 *
 * The strip held `useState(views)` — the whole tab objects — and re-synced them
 * in an effect keyed on a signature of `key:pos`. That signature is a statement
 * about which views exist and in what order, and it is stable across exactly
 * the change that matters most: picking a date range rewrites every tab's
 * `href` and touches neither key nor pos. So the effect did not fire, the state
 * kept the tab objects captured on first load, and every tab in the strip went
 * on pointing at the window the board had when the page was opened.
 *
 * The result was the range silently resetting. Draw a two-week window on
 * Overview — the pill updates, the title updates, the numbers update, because
 * all three are rendered fresh — then press "Calls" and land on Last 7 days,
 * because that tab's frozen `href` had no `range=` in it at all. It looked
 * exactly like the range not being carried, and it was not: it was carried
 * correctly into an anchor nobody was re-rendering.
 *
 * ═══ WHY KEYS AND NOT OBJECTS ═══
 *
 * The strip's local state is now a list of KEYS. A key is the only part of a
 * tab a drag can legitimately reorder; resolving those keys against the live
 * `views` prop at render time means every other field is always the server's
 * current answer. A field added to a tab later cannot go stale here, because
 * nothing but the order is remembered.
 */

/** The shape this module needs. `StripView` in board-controls.tsx satisfies it. */
type Keyed = { key: string };

/**
 * WHEN THE SERVER'S ANSWER ABOUT ORDER HAS ACTUALLY CHANGED.
 *
 * Deliberately NOT a signature of the whole tab. The effect this feeds resets a
 * drag in progress, so it must fire when views are added, removed or reordered
 * — and must NOT fire because a link was rebuilt. Widening it to cover `href`
 * would fix the staleness by making the strip snap home mid-drag on any
 * navigation, which is the bug it was narrowed to avoid in the first place.
 *
 * `views` is rebuilt with `.map()` on every parent render, so a raw array
 * dependency fires constantly — that is what this string replaces.
 */
export function stripSignature(views: ReadonlyArray<Keyed & { pos: string }>): string {
  return views.map((v) => `${v.key}:${v.pos}`).join("|");
}

/**
 * The live tabs, in the order the strip is holding.
 *
 * ANY KEY THE ORDER DOES NOT KNOW ABOUT IS APPENDED rather than dropped. A view
 * created in another tab arrives through `router.refresh()`, and for the one
 * render between that arrival and the re-sync effect the order has no key for
 * it. Dropping it would flash the strip a tab short; appending shows it at the
 * end for a frame and then the effect puts it where `pos` says it goes.
 *
 * A key in the order with no matching view is dropped, which is what deleting a
 * view looks like from here.
 */
export function orderViews<T extends Keyed>(order: ReadonlyArray<string>, views: ReadonlyArray<T>): T[] {
  const byKey = new Map(views.map((v) => [v.key, v]));
  const known = new Set(order);
  const held: T[] = [];
  for (const key of order) {
    const v = byKey.get(key);
    if (v) held.push(v);
  }
  for (const v of views) if (!known.has(v.key)) held.push(v);
  return held;
}
