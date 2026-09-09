import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE TWO ROLES THE 5 SEP 2026 AMENDMENT ADDED, PINNED WHERE THEY LAND.
 *
 * `--tab-rule` and `--primary-hover`/`--primary-active` exist because a value
 * that differs by theme has to be a ROLE — `globals.css` declares it in both
 * `:root` and `.dark`, bridged into a utility — rather than a component
 * spelling `dark:`, which `scripts/check-ui.ts` already bans outright.
 *
 * Before this pass, `button.tsx`'s filled variant hovered to `brand-500` in
 * BOTH themes (the spec's own words: "until the final pass lands, button.tsx
 * hovers to 500 in both themes, which on light puts white text on #007BFF at
 * 3.98:1 for the duration of the hover") and the active view tab's rule was
 * `border-marker` — the brand stroke — where the Figma actually draws that
 * rule in grey. This file pins the fix rather than the bug.
 *
 * Sabotage-verified: reverting any one of `globals.css`, `button.tsx` or
 * `board-controls.tsx` to its pre-final-pass spelling fails the matching
 * assertion here alone.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const css = read("src/app/globals.css");
const button = read("src/components/ui/button.tsx");
const boardControls = read("src/app/dashboard/board-controls.tsx");
const tabs = read("src/components/ui/tabs.tsx");

/** globals.css with every comment removed, so prose cannot answer for a value. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A role's declaration inside `:root`. First match wins. */
function lightToken(name: string): string | null {
  const end = bare.indexOf("\n.dark {");
  const block = bare.slice(0, end === -1 ? bare.length : end);
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

/** The same role, read from inside `.dark` — see console-theme.test.ts's note on why this can't be unscoped. */
function darkToken(name: string): string | null {
  const start = bare.indexOf(".dark {");
  const block = bare.slice(start, bare.indexOf("\n}", start));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

/** Every `.tsx` file under `dir`, recursively. */
function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("--tab-rule: the active tab's rule, not the brand stroke", () => {
  it("is declared in both themes", () => {
    expect(lightToken("tab-rule")).not.toBeNull();
    expect(darkToken("tab-rule")).not.toBeNull();
  });

  it("reads --heading on light, --muted-foreground on dark", () => {
    expect(lightToken("tab-rule")).toBe("var(--heading)");
    expect(darkToken("tab-rule")).toBe("var(--muted-foreground)");
  });

  it("is bridged to the border-tab-rule utility", () => {
    const bridge = bare.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(bridge).toMatch(/--color-tab-rule:\s*var\(--tab-rule\);/);
  });
});

describe("--primary-hover / --primary-active: the fill's hover and press", () => {
  /**
   * THE SPLIT RETIRED WITH THE INK THAT NEEDED IT.
   *
   * Under blue, the fill hovered UP on dark (brand-500) and DOWN on light
   * (brand-700), and the asymmetry was earned: the fill carried WHITE ink, so
   * brightening it on a light ground moved it toward the white behind it and
   * the label's contrast fell at the moment of the press.
   *
   * The lime fill carries NEAR-BLACK ink in both themes. Brightening it now
   * RAISES the label's contrast rather than lowering it — brand-300 is 12.02:1
   * under #2C2C2C where brand-400 is 11.59:1 — so the reason light had to move
   * the other way is gone, and both themes hover to the lighter step.
   */
  it("hovers UP in BOTH themes now, because the ink on the fill is dark", () => {
    expect(darkToken("primary-hover")).toBe("var(--color-brand-300)");
    expect(lightToken("primary-hover")).toBe("var(--color-brand-300)");
  });

  it("presses to brand-500 in both themes", () => {
    expect(darkToken("primary-active")).toBe("var(--color-brand-500)");
    expect(lightToken("primary-active")).toBe("var(--color-brand-500)");
  });

  it("is bridged to bg-primary-hover and bg-primary-active", () => {
    const bridge = bare.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(bridge).toMatch(/--color-primary-hover:\s*var\(--primary-hover\);/);
    expect(bridge).toMatch(/--color-primary-active:\s*var\(--primary-active\);/);
  });
});

describe("button.tsx's filled variant uses the roles, not the ramp directly", () => {
  it("hovers through bg-primary-hover", () => {
    expect(button).toMatch(/hover:bg-primary-hover/);
  });

  it("no longer spells hover:bg-brand-500", () => {
    expect(button).not.toMatch(/hover:bg-brand-500/);
  });

  it("presses through bg-primary-active", () => {
    expect(button).toMatch(/active:bg-primary-active/);
  });
});

/**
 * THE VIEW TABS ARE PILLS NOW, AND --tab-rule IS NOT DEAD.
 *
 * These asserted an underline: `border-tab-rule` on the active wrapper, a
 * matching transparent top border on the anchor so the box stayed symmetric,
 * and no `border-b-2`. That was the 8 September frame's answer and the
 * reasoning held — a grey rule carries no contrast claim, so the weight and the
 * ink said where you were.
 *
 * Node 0:5 draws a filled pill instead: #DEDEDE under the active tab, #EFEFEF
 * under the pointer. The fill says it now, so the underline and the border
 * symmetry it needed both go.
 *
 * `--tab-rule` ITSELF STAYS. It is still the rule under `ui/tabs.tsx`'s active
 * trigger, which is a different control on a different surface, and the swatch
 * on /design still draws it. Only the BOARD's view tabs stopped using it, which
 * is why this block moved rather than being deleted.
 */
describe("board-controls.tsx's active view tab is a filled pill", () => {
  it("takes the bar's active fill, not a rule", () => {
    expect(boardControls).toMatch(/bg-topbar-active/);
    expect(boardControls).not.toMatch(/border-tab-rule/);
  });

  it("takes the bar's control fill under the pointer", () => {
    expect(boardControls).toMatch(/hover:bg-topbar-control/);
  });

  it("is a rounded pill at the frame's own padding", () => {
    expect(boardControls).toContain("gap-1 rounded-control px-2 py-1");
  });

  it("carries no border-marker anywhere in the file", () => {
    expect(boardControls).not.toMatch(/border-marker/);
  });
});

/**
 * THE 1PX RULE, PINNED ON BOTH SIDES OF ITS OWN SYMMETRY TRICK.
 *
 * `9d328f4` (fix round 2) changed the wrapper's rule from `border-b-2` to
 * `border-b` and the anchor's compensating top border from `border-t-2` to
 * `border-t`, but landed no test — a revert of either one, or a plain
 * deletion of the anchor's `border-t-transparent` colour (leaving a visible
 * black rule on top of every tab), would have failed nothing. This pins all
 * three, plus the vendored `line`-variant tab strip's own 1px mark on both
 * its orientations.
 *
 * Sabotage-verified: reverting the wrapper to `border-b-2`, deleting
 * `border-t-transparent` from the anchor, or reverting `tabs.tsx` to
 * `after:h-0.5` each fail exactly the assertion that names them and no other.
 */
describe("the active tab's rule is 1px on the wrapper, the anchor and both tab orientations", () => {
  it("the wrapper carries border-b, not border-b-2", () => {
    // R3-1: `/border-b(?!-)/` alone is satisfied by `border-border` (a
    // `border-b` prefix followed by `o`, not `-`) — the file has two of
    // those plus two comment mentions, so that regex passed even with
    // `border-b` deleted from the wrapper entirely. An exact literal of the
    expect(boardControls).not.toMatch(/border-b-2/);
  });

  it("no longer needs the anchor's transparent top border", () => {
    // It existed to keep the box symmetric against a bottom-only rule. With no
    // rule there is nothing to balance, and the padding is on the pill.
    expect(boardControls).not.toContain("border-t border-t-transparent");
    expect(boardControls).not.toMatch(/border-t-2/);
  });

  it("ui/tabs.tsx's line-variant mark is 1px on both orientations", () => {
    expect(tabs).toMatch(/after:h-px/);
    expect(tabs).not.toMatch(/after:h-0\.5/);
    expect(tabs).toMatch(/after:w-px/);
    expect(tabs).not.toMatch(/after:w-0\.5/);
  });
});

/**
 * THE WHOLE-TREE SWEEP.
 *
 * `hover:bg-brand-500` was never a rule confined to one component — `theme.tsx`
 * (the colour-mode radio), `sidebar.tsx` (the collapsed New-flow chip) and
 * `chip.tsx` (the on-state filter chip) all hand-rolled the same fill, hover
 * and press classes `button.tsx`'s `accent` variant carries, and a fix in one
 * file only would have left three more places where a hover still put white
 * text on `#007BFF` at 3.98:1. `src/components/flow/*` is excluded because the
 * flow builder is frozen — tidy and fix, never redesign — and it never spelled
 * this class to begin with.
 *
 * A plain grep for the retired string is the simplest honest pin: it says
 * nothing survives, rather than enumerating every place that doesn't.
 *
 * ONE ASSERTION, NOT ONE PER FILE. The sweep first shipped as an `it` per
 * file — a couple hundred of them, all but one with an identical body — which
 * is the same information a single collected-offenders assertion carries in
 * one line, at a fraction of the suite's run-time noise. Any offender's PATH
 * still appears by name in the failure message, so nothing about "which file"
 * is lost by collapsing it.
 */
describe("no filled control anywhere still hovers to the bare brand-500 step", () => {
  const flowDir = join(root, "src", "components", "flow") + sep;
  const files = [...walkTsx(join(root, "src/app")), ...walkTsx(join(root, "src/components"))].filter(
    (f) => !f.startsWith(flowDir),
  );

  it("found more than a handful of files (a broken walk would pass everything)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no file hovers to bg-brand-500", () => {
    const offenders = files.filter((f) => /hover:bg-brand-500/.test(read(f.slice(root.length + 1))));
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});
