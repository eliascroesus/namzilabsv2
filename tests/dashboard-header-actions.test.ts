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
    /**
     * RE-POINTED 6 SEP 2026, AND THE OLD PIN IS WHY THIS SHIPPED WRONG.
     *
     * It required `size="xs"` plus a `[&_svg]:size-4` override, on the reading
     * that the Figma's header controls were the kit's dense rung. They are
     * not: `xs` was 24px at 12px type, so these three sat 8px shorter and two
     * type steps quieter than the identical-looking buttons in the top bar
     * directly above them. `xs` is now deleted from the size table, the
     * default rung IS 32px at 14px, and its `[&_svg]:size-4` comes with it —
     * so the override is gone too, rather than being a class set to the value
     * it already had.
     *
     * Sabotage: put `size="xs"` back on this button and the first assertion
     * fails; add `[&_svg]:size-4` back and the second does.
     */
    expect(block, "Refresh all stands at the kit's one control height").not.toContain('size="xs"');
    expect(block, "and does not re-set the icon size the rung already gives").not.toContain("[&_svg]:size-4");
    expect(block, "which is the refresh glyph").toContain("<RefreshCw />");
  });
});
