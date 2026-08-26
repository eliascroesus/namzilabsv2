/**
 * /design already renders preview copies of chrome, and a copy that drifts is
 * worse than none — a screenshot of the kit once showed a fix that did not
 * exist in the product. These exist so the panel's shell has ONE definition.
 */

/**
 * The panel's surface, and nothing about where it sits.
 *
 * What the canvas adds on top of this (`absolute right-6 top-chrome-band
 * bottom-chrome-band z-20` and the width clamped against that inset) is a fact
 * about the canvas, not about the panel — a kit page has neither a toolbar to
 * be inset from nor a chrome band to stop short of. What is left
 * here is the panel itself: ONE white plane, a real hairline, and an elevation
 * with no ring in it, because a ring under a border is two hairlines of
 * different hue reading as a 2px dirty rim (see `--shadow-panel`).
 *
 * No `"use client"` on this file on purpose: the directive would turn even
 * this string into a client reference, and /design is a server component that
 * needs to read it as a string.
 */
export const PANEL_SHELL ="flex flex-col overflow-hidden rounded-surface border border-border bg-card shadow-surface";

/**
 * Set the step up, then run it. A step that cannot be run offers only the first.
 *
 * This is the FLOW BUILDER's tab vocabulary, and it stays named here because it
 * is a fact about a step panel — not about tab rows in general. `PanelTabs`
 * below is generic over its ids, so the dashboard's tile panel brings its own
 * two words without either side learning the other's.
 */
export type PanelTab = "configure" | "test";

/**
 * The tab row. `data-config-tabs` is load-bearing — the field browser measures
 * it to know where the panel's scrolling body starts.
 *
 * The active underline is `primary`. It was brand-500, one step off the
 * product's own accent — and this is the single accent moment in the panel,
 * which is the one place two almost-identical blues cannot be afforded.
 *
 * GENERIC OVER ITS IDS rather than fixed to `PanelTab`. The repo had three tab
 * implementations and no primitive; a second panel that needed two different
 * words would have made it four. `T extends string` costs nothing at either
 * call site — `tabs={["configure", "test"]}` still infers the narrow union, so
 * a typo in `active` is still a type error — and it means the next panel
 * reuses this row instead of copying it.
 */
export function PanelTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly T[];
  active: T;
  onSelect: (tab: T) => void;
}) {
 return (
 <div data-config-tabs className="flex gap-5 border-b border-border bg-card px-5">
 {tabs.map((t) => (
 <button
 key={t}
 onClick={() => onSelect(t)}
 className={`-mb-px border-b-2 py-3 text-base capitalize transition-colors ${
 active === t ?"border-primary font-semibold text-foreground" :"border-transparent font-medium text-muted-foreground hover:text-foreground"
 }`}
 >
 {t}
 </button>
 ))}
 </div>
 );
}
