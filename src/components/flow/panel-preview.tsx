"use client";

import { useState } from "react";
import { PanelTabs, type PanelTab } from "./panel-chrome";

/**
 * The config panel's REAL tab row, on the UI kit page.
 *
 * `/design` is a server component and `PanelTabs` takes an `onSelect`
 * callback, so the page cannot render the row itself — it would 500 with
 * "Event handlers cannot be passed to Client Component props". This is the
 * client boundary that owns the tab state, the same trick `ToolbarPreview`
 * plays for the toolbar.
 *
 * It exists so the kit shows the row the product ships rather than a copy of
 * it: a copied tab row is how a screenshot of this page once advertised a fix
 * that had never been made. Both tabs, because both is what a step that can be
 * tested offers.
 */
export function PanelTabsPreview() {
  const [tab, setTab] = useState<PanelTab>("configure");
  return <PanelTabs tabs={["configure", "test"]} active={tab} onSelect={setTab} />;
}
