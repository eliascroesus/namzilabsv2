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
  it("hovers UP on dark (brand-500) and DOWN on light (brand-700)", () => {
    expect(darkToken("primary-hover")).toBe("var(--color-brand-500)");
    expect(lightToken("primary-hover")).toBe("var(--color-brand-700)");
  });

  it("presses to brand-700 in both themes", () => {
    expect(darkToken("primary-active")).toBe("var(--color-brand-700)");
    expect(lightToken("primary-active")).toBe("var(--color-brand-700)");
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

describe("board-controls.tsx's active view tab uses --tab-rule, not --marker", () => {
  it("the active tab's class carries border-tab-rule", () => {
    expect(boardControls).toMatch(/border-tab-rule/);
  });

  it("carries no border-marker anywhere in the file", () => {
    expect(boardControls).not.toMatch(/border-marker/);
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
 */
describe("no filled control anywhere still hovers to the bare brand-500 step", () => {
  const flowDir = join(root, "src", "components", "flow") + sep;
  const files = [...walkTsx(join(root, "src/app")), ...walkTsx(join(root, "src/components"))].filter(
    (f) => !f.startsWith(flowDir),
  );

  it("found more than a handful of files (a broken walk would pass everything)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const f of files) {
    const rel = f.slice(root.length + 1);
    it(`${rel} does not hover to bg-brand-500`, () => {
      expect(read(rel)).not.toMatch(/hover:bg-brand-500/);
    });
  }
});
