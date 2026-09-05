import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE BLUE RETHEME (4 Sep 2026) — blue is reserved for "+ Add" and "New
 * flow"; every other header action, Refresh all included, takes the kit's
 * ordinary grey `secondary` button. A source pin because `SubmitButton`'s
 * props are plain strings — a render test here would only re-check this
 * same file's JSX against itself through React, at more cost for no more
 * certainty.
 */
describe("dashboard header actions, 4 Sep 2026 blue retheme", () => {
  it("draws Refresh all as secondary, not the brand fill", () => {
    const src = readFileSync(join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
    const anchor = src.indexOf("action={refreshAllFlowsAction}");
    expect(anchor, "the Refresh all form was found").toBeGreaterThan(-1);
    const block = src.slice(anchor, anchor + 500);
    expect(block, 'Refresh all reads variant="secondary"').toContain('variant="secondary"');
    expect(block, 'Refresh all no longer reads variant="accent"').not.toContain('variant="accent"');
    // The Figma's header buttons are the kit's `xs` rung, and its glyphs are
    // 16px — which `xs` does not give for free (`[&_svg]:size-3.5`), so the
    // override is part of the spelling rather than decoration.
    expect(block, "Refresh all is the header's xs rung").toContain('size="xs"');
    expect(block, "and carries a 16px icon").toContain("[&_svg]:size-4");
    expect(block, "which is the refresh glyph").toContain("<RefreshCw />");
  });
});
