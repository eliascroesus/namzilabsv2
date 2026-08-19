/**
 * /design already renders preview copies of chrome, and a copy that drifts is
 * worse than none — a screenshot of the kit once showed a fix that did not
 * exist in the product. These exist so the panel's shell has ONE definition.
 */

/**
 * The panel's surface, and nothing about where it sits.
 *
 * What the canvas adds on top of this (`absolute inset-y-0 right-0 z-20 m-6`
 * and the width clamped against that margin) is a fact about the canvas, not
 * about the panel — a kit page has no toolbar to be inset from. What is left
 * here is the panel itself: ONE white plane, a real hairline, and an elevation
 * with no ring in it, because a ring under a border is two hairlines of
 * different hue reading as a 2px dirty rim (see `--shadow-panel`).
 *
 * No `"use client"` on this file on purpose: the directive would turn even
 * this string into a client reference, and /design is a server component that
 * needs to read it as a string.
 */
export const PANEL_SHELL = "flex flex-col overflow-hidden rounded-surface border border-border bg-card shadow-island";

/** Set the step up, then run it. A step that cannot be run offers only the first. */
export type PanelTab = "configure" | "test";

/**
 * The tab row. `data-config-tabs` is load-bearing — the field browser measures
 * it to know where the panel's scrolling body starts.
 *
 * The active underline is `primary`. It was brand-500, one step off the
 * product's own accent — and this is the single accent moment in the panel,
 * which is the one place two almost-identical blues cannot be afforded.
 */
export function PanelTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly PanelTab[];
  active: PanelTab;
  onSelect: (tab: PanelTab) => void;
}) {
  return (
    <div data-config-tabs className="flex gap-5 border-b border-border bg-card px-5">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          className={`-mb-px border-b-2 py-3 text-base capitalize transition-colors ${
            active === t ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
