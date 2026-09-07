/**
 * WHAT THE RAIL'S SEARCH CAN FIND — assembled as data, so it can be tested
 * without a DOM.
 *
 * The rail is the product's whole navigation, and until now its search row was
 * a button with no handler: `aria-keyshortcuts="Meta+K"` announced a shortcut
 * that nothing implemented, and the comment beside it promised a command
 * palette that was never wired. The owner asked the obvious question — "why is
 * the search a button and not an input field? it should be able to search like
 * the different nav things or like theme light and dark etc."
 *
 * THE ENTRIES ARE DERIVED, NEVER RE-TYPED. A second hand-written list of
 * destinations is a list that drifts from the rail beside it, and one of the
 * five is RANK-GATED (`hide` carries "Apps" for a member without
 * `view_integrations`) — a palette with its own copy would happily offer a
 * page the column deliberately does not show. So this takes the SAME arrays
 * the rail renders: the filtered `items` and the sorted `views`.
 *
 * NO REACT AND NO ICONS HERE. An entry says what it IS; the component picks
 * the glyph. That keeps this module pure enough to test as a table and stops a
 * lucide import leaking into `src/lib`.
 */

/** One thing the rail's search can offer. */
export type RailSearchEntry =
  | { kind: "page"; label: string; href: string }
  | { kind: "view"; label: string; href: string }
  /** Not a destination — it sets the theme in place. See `ThemeChoice`. */
  | { kind: "theme"; label: string; theme: "light" | "dark" | "system" };

/** The group each entry is listed under, in the order the panel draws them. */
export const RAIL_SEARCH_GROUPS = ["Pages", "Views", "Theme"] as const;

/**
 * THE VIEW'S HREF RULE, COPIED FROM THE RAIL'S OWN NESTED LIST.
 *
 * The default board has no `?view=` in the URL — it has no row until it is
 * adopted — so it and an adopted view that happens to be the default both
 * resolve to bare `/dashboard`. Getting this wrong sends someone to a view id
 * that does not exist, which renders the default board with the wrong tab lit.
 */
export function viewHref(view: { id: string | null; isDefault?: boolean }): string {
  return view.id && !view.isDefault ? `/dashboard?view=${view.id}` : "/dashboard";
}

export function railSearchEntries(opts: {
  /** The rail's OWN filtered nav rows — already through the `hide` gate. */
  items: Array<{ label: string; href: string }>;
  /** The workspace's views, already sorted by `viewStrip`. */
  views: Array<{ id: string | null; name: string; isDefault?: boolean }>;
  /** The theme trio, from `theme.tsx` — passed in rather than imported, so this stays free of React. */
  themes: ReadonlyArray<{ value: "light" | "dark" | "system"; label: string }>;
}): RailSearchEntry[] {
  return [
    ...opts.items.map(({ label, href }): RailSearchEntry => ({ kind: "page", label, href })),
    ...opts.views.map((v): RailSearchEntry => ({ kind: "view", label: v.name, href: viewHref(v) })),
    /**
     * "Theme: Dark" rather than "Dark", because the words someone types are
     * "theme" or "dark" and only one of those is in a bare label. It also stops
     * a view called "Light" being indistinguishable from the theme beside it.
     */
    ...opts.themes.map(({ value, label }): RailSearchEntry => ({ kind: "theme", label: `Theme: ${label}`, theme: value })),
  ];
}
