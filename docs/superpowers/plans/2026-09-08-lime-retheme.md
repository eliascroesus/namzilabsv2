# Lime Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the Namzilabs console from blue-on-three-surfaces to the lime-on-one-surface design in Figma node 49:5268, and give every newly created metric tile a random colour.

**Architecture:** Token-first. The app is role-based — components say `bg-card` and `text-muted-foreground`, never `bg-neutral-800` — so rewriting the role layer in `src/app/globals.css` recolours all 131 components at once. Only then do the surfaces whose *structure* changed get touched (sidebar, top bar, cards, buttons). Docs and the `/design` page are rewritten last, describing what actually shipped.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (`@theme` in `globals.css`), TypeScript, Vitest, Drizzle + Neon, `lucide-react`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-08-lime-retheme-design.md`

## Global Constraints

- **Brand fill** `#B6FF56`; **ink on the fill** `#2C2C2C` (11.59:1). The brand is a fill under NEAR-BLACK ink, inverting the old white-on-blue rule.
- **Surfaces (dark):** page `#121214`, chrome `#121214`, panel `#121214`, card `#191919`, control `#202020`, hairline `#343434`.
- **Font is Inter everywhere.** No second family. No Poppins.
- **Radius is 8px** on every element that has one (`--radius-card`, `--radius-control`, `--radius-surface`). `rounded-full` only on the delta chip, freshness dot/halo, and avatar.
- **Weights are 400 / 500 / 600 only.** `font-bold` stays a build failure in `scripts/check-ui.ts`.
- **UI base type is 14px** (`--text-sm`), down from 15px.
- **Roles, never ramps,** at call sites. `dark:` at a call site is a build failure.
- **Every role declared in `:root` must also be declared in `.dark`** — `tests/design-swatches.test.ts` enforces the shared vocabulary.
- **Contrast bars:** text ≥ 4.5:1 on its own ground; a meaningful graphic ≥ 3:1.
- **Two recorded substitutions** (spec §"Contrast substitutions"): `--muted-foreground` is `#828282`, not the Figma's `#7E7E7E`; inactive tabs use `--muted-foreground`, not `#4A4A4A`.
- **The flow canvas and its nodes are exempt from redesign.** They recolour through tokens; their layout, spacing and structure must not change.
- Verification commands: `pnpm typecheck`, `pnpm test`, `pnpm check:ui`, `pnpm check:orphans`.

## File Structure

**Created**
- `tests/helpers/contrast.ts` — sRGB relative luminance + contrast ratio, shared by the theme tests. One home for the arithmetic so no test re-implements it.
- `tests/lime-theme.test.ts` — pins the lime tokens and their measured ratios in both themes.
- `tests/tile-colour.test.ts` — pins that a new tile gets a random non-grey key, and that every board hue clears 3:1 on the card.
- `tests/retheme-lime-docs.test.ts` — the prose half; replaces `retheme-blue-docs.test.ts`.

**Modified**
- `src/app/globals.css` — brand ramp, neutral ramp, both theme blocks, radius, type scale.
- `src/components/flow/node-accent.ts` — `GROUP_ACCENT` re-solved for `#191919`.
- `src/lib/board/tile-config.ts` — `accentOf()` fallback.
- `src/app/dashboard/board-actions.ts` — random colour on tile insert.
- `src/components/sidebar.tsx` — 260px always open; hover mechanism removed.
- `src/components/shell-skeleton.tsx` — mirror the new fixed width.
- `src/components/top-bar.tsx` — three-part bar.
- `src/components/ui/button.tsx` — lime fill under dark ink; white secondary.
- `src/components/metric-card.tsx`, `src/components/board-charts/*.tsx` — card, numeral, delta chip, series colours.
- `src/app/dashboard/board-controls.tsx` — tabs.
- `src/app/design/page.tsx` — swatch captions (pinned by `design-swatches.test.ts`).
- `DESIGN.md`, `docs/BRAND_KIT.md` — rewritten.

**Deleted**
- `tests/retheme-blue-docs.test.ts` — replaced by the lime equivalent.

---

### Task 1: The contrast helper

Every later task asserts a measured ratio. Build the arithmetic once.

**Files:**
- Create: `tests/helpers/contrast.ts`
- Test: `tests/helpers/contrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `luminance(hex: string): number`, `contrast(a: string, b: string): number`. Both take `#rrggbb` (any case). Used by Tasks 2, 3, 6.

- [ ] **Step 1: Write the failing test**

```ts
// tests/helpers/contrast.test.ts
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";

describe("contrast", () => {
  it("is 21:1 for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrast("#b6ff56", "#B6FF56")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    expect(contrast("#121214", "#b6ff56")).toBeCloseTo(contrast("#b6ff56", "#121214"), 10);
  });

  it("measures the lime brand on the page at 15.53:1", () => {
    expect(contrast("#b6ff56", "#121214")).toBeCloseTo(15.53, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/helpers/contrast.test.ts`
Expected: FAIL — `Cannot find module './contrast'`

- [ ] **Step 3: Write minimal implementation**

```ts
// tests/helpers/contrast.ts
/**
 * sRGB relative luminance and contrast ratio, WCAG 2.x.
 *
 * One home for the arithmetic. The kit's design docs are built on measured
 * ratios, and a ratio each test re-derives is a ratio that drifts — this file
 * exists so a claim in BRAND_KIT.md and the assertion defending it are the
 * same calculation.
 */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/helpers/contrast.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/contrast.ts tests/helpers/contrast.test.ts
git commit -m "test: add the contrast helper the lime re-theme measures with"
```

---

### Task 2: The brand ramp becomes lime

**Files:**
- Create: `tests/lime-theme.test.ts`
- Modify: `src/app/globals.css` (brand ramp ~lines 231–240; `:root` ~645–660; `.dark` ~783–802)

**Interfaces:**
- Consumes: `contrast()` from Task 1.
- Produces: the token readers `token(name)`, `lightToken(name)`, `darkToken(name)` used by Tasks 3 and 4. Copy the `.dark`-scoped reader pattern from `tests/console-theme.test.ts` — an unscoped lookup silently answers with the `:root` value.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lime-theme.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "./helpers/contrast";

/**
 * THE LIME THEME'S VALUES, PINNED WHERE THEY LIVE.
 *
 * The 8 September Figma (node 49:5268) supplied colours; this file is what
 * makes a later "tidy-up" of one of them a build failure rather than a
 * design-review comment. Ratios are measured here rather than quoted, so a
 * value and the claim defending it cannot drift apart.
 */
const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
/** Comments stripped, so prose cannot answer for a value. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

function token(name: string): string | null {
  return bare.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

function darkToken(name: string): string | null {
  const start = bare.indexOf(".dark {");
  const block = bare.slice(start, bare.indexOf("\n}", start));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

function lightToken(name: string): string | null {
  const block = bare.slice(0, bare.indexOf("\n.dark {"));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

describe("the brand ramp is lime", () => {
  it("brand-400 is the Figma's #B6FF56", () => {
    expect(token("color-brand-400")).toBe("#b6ff56");
  });

  it("carries no blue", () => {
    expect(bare).not.toMatch(/#007bff|#0070e8|#3d9bff|#0062cc/i);
  });

  it("the light stroke clears 4.5:1 on white", () => {
    const stroke = token("color-brand-800")!;
    expect(contrast(stroke, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the fill inverts: near-black ink on lime", () => {
  it("--primary-foreground is #2c2c2c in both themes", () => {
    expect(lightToken("primary-foreground")).toBe("#2c2c2c");
    expect(darkToken("primary-foreground")).toBe("#2c2c2c");
  });

  it("the fill clears 4.5:1 under its own ink", () => {
    expect(contrast("#b6ff56", "#2c2c2c")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("--marker draws on both themes", () => {
  it("is the brand itself on dark, clearing 4.5:1 on the page", () => {
    expect(darkToken("marker")).toBe("var(--color-brand-400)");
    expect(contrast("#b6ff56", "#121214")).toBeGreaterThanOrEqual(4.5);
  });

  it("is the solved-down lime on light, because #B6FF56 cannot draw on white", () => {
    expect(lightToken("marker")).toBe("var(--color-brand-800)");
    expect(contrast("#b6ff56", "#ffffff")).toBeLessThan(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts`
Expected: FAIL — `expected '#3d9bff' to be '#b6ff56'`

- [ ] **Step 3: Replace the brand ramp**

In `src/app/globals.css`, replace the ten `--color-brand-*` declarations with:

```css
  --color-brand-50: #f4ffe4;
  --color-brand-100: #e9ffc9;
  --color-brand-200: #dbffa6;
  --color-brand-300: #c9ff7d; /* hover of the fill — lighter, because the fill is already bright */
  --color-brand-400: #b6ff56; /* THE BRAND — the fill, the dark stroke (`--marker`), and the default chart series. 15.53:1 on #121214, 11.59:1 under #2C2C2C ink */
  --color-brand-500: #a2e844; /* pressed */
  --color-brand-600: #8acc2e; /* reserved */
  --color-brand-700: #6fa61c; /* reserved */
  --color-brand-800: #4f7a00; /* THE LIGHT STROKE (`--marker` in `:root`) — 5.10:1 on white */
  --color-brand-900: #3d5e00; /* the light theme's hover-of-a-stroke — 7.50:1 on white */
```

Rewrite the comment block above the ramp: it currently argues that `#007BFF` fails white-on-fill at 3.98:1 and so `--primary` sits one step deeper. That argument is gone. The new one: lime is a fill under NEAR-BLACK, `400` has 11.59:1 of room there and 15.53:1 as a stroke on the page, so one step does both jobs on dark and only the light stroke needs its own value.

- [ ] **Step 4: Point the roles at it, in both theme blocks**

In `:root`: `--primary: var(--color-brand-400); --primary-foreground: #2c2c2c; --marker: var(--color-brand-800); --primary-hover: var(--color-brand-300); --primary-active: var(--color-brand-500); --brand-soft: rgb(182 255 86 / 0.1); --brand-soft-line: rgb(182 255 86 / 0.3);`

In `.dark`: the same, except `--marker: var(--color-brand-400);` and `--brand-soft-line: rgb(182 255 86 / 0.25);`

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/lime-theme.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css tests/lime-theme.test.ts
git commit -m "feat(theme): the brand becomes lime, a fill under near-black ink"
```

---

### Task 3: One surface, one card

**Files:**
- Modify: `src/app/globals.css` (neutral ramp ~lines 301–314; `.dark` surface roles ~748–766)
- Modify: `tests/lime-theme.test.ts` (append)

**Interfaces:**
- Consumes: `contrast()`, the token readers from Task 2.
- Produces: the surface values every later task styles against.

- [ ] **Step 1: Write the failing test** (append to `tests/lime-theme.test.ts`)

```ts
describe("one surface, one card", () => {
  it("page, chrome and panel are all #121214", () => {
    expect(token("color-neutral-950")).toBe("#121214");
    expect(token("color-neutral-925")).toBe("#121214");
    expect(darkToken("background")).toBe("var(--color-neutral-950)");
    expect(darkToken("chrome")).toBe("var(--color-neutral-925)");
  });

  it("the card is the only step away, and it is tiny", () => {
    expect(token("color-neutral-900")).toBe("#191919");
    const step = contrast("#191919", "#121214");
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThan(1.15); // which is why the hairline is load-bearing
  });

  it("keeps --panel as a role even though it no longer differs", () => {
    // Deleting it would break the shared-vocabulary rule and every bg-panel site.
    expect(darkToken("panel")).not.toBeNull();
    expect(lightToken("panel")).not.toBeNull();
  });

  it("the hairline and the control are unchanged", () => {
    expect(token("color-neutral-600")).toBe("#343434");
    expect(token("color-neutral-850")).toBe("#202020");
  });
});

describe("the recorded contrast substitutions", () => {
  it("--muted-foreground clears 4.5:1 on BOTH the page and the card", () => {
    expect(token("color-neutral-400")).toBe("#828282");
    expect(contrast("#828282", "#121214")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#828282", "#191919")).toBeGreaterThanOrEqual(4.5);
  });

  it("records why the Figma's own #7E7E7E was not used", () => {
    expect(contrast("#7e7e7e", "#191919")).toBeLessThan(4.5);
  });

  it("--faint stays a caps-label step and is never body copy", () => {
    expect(token("color-neutral-450")).toBe("#6e6e6e");
    expect(contrast("#6e6e6e", "#121214")).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts -t "one surface"`
Expected: FAIL — `expected '#0f1011' to be '#121214'`

- [ ] **Step 3: Re-cut the neutral ramp**

Replace the three surface steps and the two ink steps in `@theme`:

```css
  --color-neutral-950: #121214; /* THE PAGE — and the chrome, and the panel. One surface again. */
  --color-neutral-925: #121214; /* THE CHROME — top bar and rail. Same value as the page: the Figma draws no step here. */
  --color-neutral-900: #191919; /* THE CARD — the only surface that steps away, at 1.06:1 */
  --color-neutral-400: #828282; /* the dimmest INK — 4.87:1 on the page, 4.58:1 on a card */
```

Leave `850`, `800`, `700`, `600`, `500`, `450`, `300`, `200`, `100`, `50` untouched.

In `.dark`, point `--card` at `var(--color-neutral-900)` (it currently aliases `--chrome`), and leave `--panel` pointing at a surface value that now equals the page.

- [ ] **Step 4: Rewrite the ramp's comment block**

It currently argues for THREE surfaces and a mirror. Replace with the one-surface argument: page, chrome and panel are one colour, the card is the single 1.06:1 step, and `#343434` is what makes that step visible at all. Note explicitly that this reverses the 4 September three-surface argument for the second time.

- [ ] **Step 5: Run the full suite**

Run: `pnpm vitest run tests/lime-theme.test.ts && pnpm typecheck`
Expected: PASS, 14 tests. Other theme tests WILL fail here — Task 5 fixes them.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css tests/lime-theme.test.ts
git commit -m "feat(theme): collapse three dark surfaces to one, card at #191919"
```

---

### Task 4: Radius, the frame's retirement, and the 14px base

**Files:**
- Modify: `src/app/globals.css` (radius ~425–440; type scale in `@theme`)
- Modify: `tests/lime-theme.test.ts` (append)

**Interfaces:**
- Consumes: token readers from Task 2.
- Produces: `--radius-card`/`--radius-control`/`--radius-surface` all 8px; `--text-sm` at 14px.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("shape and type", () => {
  it("every containing radius is 8px", () => {
    expect(token("radius-card")).toBe("var(--radius-lg)");
    expect(token("radius-control")).toBe("var(--radius-lg)");
    expect(token("radius-surface")).toBe("var(--radius-lg)");
    expect(token("radius-lg")).toBe("0.5rem");
  });

  it("retires the frame notch, because one surface reveals nothing", () => {
    expect(token("radius-frame")).toBe("0");
  });

  it("the UI base is 14px", () => {
    expect(token("text-sm")).toBe("0.875rem");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts -t "shape and type"`
Expected: FAIL — `--radius-control` is `var(--radius-md)`

- [ ] **Step 3: Set the radii and the base**

- `--radius-control: var(--radius-lg);` (was `--radius-md`, 6px)
- `--radius-card` and `--radius-surface` already resolve to `--radius-lg`; confirm `--radius-lg: 0.5rem`.
- `--radius-frame: 0;` and rewrite its comment: the notch existed because a radius reveals what is behind it; page, chrome and panel are one colour again, so it reveals nothing. This is the same argument the blue theme used to reinstate it, running the other way.
- `--text-sm: 0.875rem` with `line-height: 1.125rem` (18px) and `letter-spacing: -0.24px`.
- `--text-xs`: 12px / 16px / −0.078px. `--text-md`: 15px / 22px / −0.24px. `--text-display-xs`: 28px / 40px / −1.08px.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/lime-theme.test.ts && pnpm check:ui`
Expected: lime-theme PASS (17 tests); `check:ui` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tests/lime-theme.test.ts
git commit -m "feat(theme): 8px on everything, retire the frame notch, 14px base"
```

---

### Task 5: Re-point the tests that pinned the blue theme

Five existing tests assert the old values. They are rewritten to the new truth, not deleted — the discipline they encode is the reason the kit has not drifted.

**Files:**
- Modify: `tests/console-theme.test.ts`, `tests/theme-roles.test.ts`, `tests/canvas-tokens.test.ts`, `tests/design-swatches.test.ts`
- Modify: `src/app/design/page.tsx` (swatch hex captions)
- Delete: `tests/retheme-blue-docs.test.ts`
- Create: `tests/retheme-lime-docs.test.ts`

**Interfaces:**
- Consumes: the tokens from Tasks 2–4.
- Produces: a green suite, which every later task depends on to detect its own breakage.

- [ ] **Step 1: See the damage**

Run: `pnpm test`
Expected: FAIL in `console-theme`, `theme-roles`, `canvas-tokens`, `design-swatches`, `retheme-blue-docs`. Record the failing assertion names — each one names a claim that must be restated.

- [ ] **Step 2: Update the four value-pinning tests**

Replace every old literal with its new counterpart: `#1b191a`/`#0f1011` → `#121214`, `#111111` → `#121214`, `#181818` → `#191919`, `#007bff`/`#0070e8` → `#b6ff56`, `#858585` → `#828282`. In `theme-roles.test.ts`, `--primary-hover` is now `--color-brand-300` and `--primary-active` is `--color-brand-500`. `--tab-rule` keeps its grey job in both themes.

- [ ] **Step 3: Update `/design`'s swatch captions**

`design-swatches.test.ts` parses `{ step, cls, hex }` rows out of `src/app/design/page.tsx` and compares each hex to the token it names. Update every brand and neutral row's `hex` literal to match Task 2 and Task 3.

- [ ] **Step 4: Replace the docs-prose test**

```bash
git rm tests/retheme-blue-docs.test.ts
```

```ts
// tests/retheme-lime-docs.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PINS THE PROSE THE SAME WAY design-swatches.test.ts PINS THE SWATCHES.
 *
 * Replaces retheme-blue-docs.test.ts. Every assertion fails on the OLD claim
 * and passes only once the NEW one is actually written down.
 */
const root = join(__dirname, "..");
const brandKit = () => readFileSync(join(root, "docs/BRAND_KIT.md"), "utf8");
const design = () => readFileSync(join(root, "DESIGN.md"), "utf8");

describe("the docs describe the lime theme", () => {
  it("states one surface, not three", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#121214/);
    expect(doc).not.toMatch(/#0F1011/i);
    expect(doc).not.toMatch(/#181818/i);
  });

  it("names the lime brand and its near-black ink", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#B6FF56/i);
    expect(doc).toMatch(/#2C2C2C/i);
    expect(doc).not.toMatch(/#007BFF|#0070E8/i);
  });

  it("records both contrast substitutions", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#828282/i);
    expect(doc).toMatch(/4\.33/); // why #7E7E7E was not used on the card
    expect(doc).toMatch(/2\.11/); // why #4A4A4A was not used for a tab
  });

  it("DESIGN.md owns the second reversal rather than quietly rewording", () => {
    const doc = design();
    expect(doc).toMatch(/#121214/);
    expect(doc).not.toMatch(/#0F1011/i);
  });
});
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: the four value tests PASS; `retheme-lime-docs` FAILS (docs not yet rewritten — Task 12). That is the intended red.

- [ ] **Step 6: Commit**

```bash
git add -A tests src/app/design/page.tsx
git commit -m "test: re-point the theme tests at the lime values"
```

---

### Task 6: Re-solve the board palette for the dark card

**Files:**
- Modify: `src/components/flow/node-accent.ts` (`GROUP_ACCENT`)
- Modify: `src/lib/board/tile-config.ts` (`accentOf`)
- Create: `tests/tile-colour.test.ts`

**Interfaces:**
- Consumes: `contrast()` from Task 1.
- Produces: `GROUP_ACCENT` with the SAME 12 keys (`grey`, `red`, `orange`, `amber`, `olive`, `green`, `teal`, `cyan`, `blue`, `indigo`, `violet`, `pink`), re-solved. `GROUP_COLOR_KEYS` is unchanged in order and length. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tile-colour.test.ts
import { describe, expect, it } from "vitest";
import { GROUP_ACCENT, GROUP_COLOR_KEYS } from "@/components/flow/node-accent";
import { contrast } from "./helpers/contrast";

const CARD = "#191919";

describe("the board palette is solved for the dark card", () => {
  it("keeps every key — a dropped key silently resets a stored board", () => {
    expect(GROUP_COLOR_KEYS).toEqual([
      "grey", "red", "orange", "amber", "olive", "green",
      "teal", "cyan", "blue", "indigo", "violet", "pink",
    ]);
  });

  it("every hue clears 3:1 on the card it is drawn on", () => {
    for (const key of GROUP_COLOR_KEYS) {
      expect(contrast(GROUP_ACCENT[key], CARD), `${key} on the card`).toBeGreaterThanOrEqual(3);
    }
  });

  it("is no longer solved against white", () => {
    // The old ramp was cut for a white card; at least one hue must have moved.
    expect(GROUP_ACCENT.green).not.toBe("#00AB17");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tile-colour.test.ts`
Expected: FAIL — several hues under 3:1 on `#191919`

- [ ] **Step 3: Re-solve the twelve values**

Keep hue and order. **The ground inverting inverts the solve.** On white, the bar capped how LIGHT a hue could be, so every value was pushed down and the rule was "the most vivid version that still clears 3.05:1". On `#191919` the bar caps how DARK it can be, and a mark that only just clears 3:1 on near-black is one you squint at — so each hue is taken to the most saturated version that clears the bar **with margin**. The twelve below land between 5.09:1 (grey) and 8.78:1 (olive), measured; the test asserts only the 3:1 hard bar, and the comment records the range.

```ts
export const GROUP_ACCENT: Record<string, string> = {
  grey: "#8A8A8A", //      the "no colour" default, re-cut for the dark card
  red: "#FF6B66", //   2°
  orange: "#FF8A3D", //  28°
  amber: "#D9A400", //  45°
  olive: "#9BC61F", //  75°
  green: "#2ECC4A", // 128°
  teal: "#1FC9A0", // 166°
  cyan: "#22BEE8", // 192°
  blue: "#5AAEFF", // 210°
  indigo: "#A99BFF", // 248°
  violet: "#E27DFF", // 288°
  pink: "#FF6FBA", // 330°
};
```

Measured on `#191919`: grey 5.09, red 6.32, orange 7.50, amber 7.75, olive 8.78,
green 8.25, teal 8.31, cyan 8.04, blue 7.48, indigo 7.38, violet 7.21, pink 6.89.

Update the block comment: the solve's GROUND changed from white to `#191919`, the keys did not, and that is exactly what the key-not-hex design was for — this is the first pass to spend it.

- [ ] **Step 4: Re-point `accentOf`'s fallback**

In `src/lib/board/tile-config.ts`, change the fallback from `var(--color-brand-500)` to `var(--color-brand-400)`, and update the comment: the Figma draws the default series in `#B6FF56`, the same value as the fill, so the series does not get its own ramp step.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/tile-colour.test.ts && pnpm check:ui`
Expected: PASS, 3 tests. `check:ui` clean — `node-accent.ts` is the one allowlisted file for hexes.

- [ ] **Step 6: Commit**

```bash
git add src/components/flow/node-accent.ts src/lib/board/tile-config.ts tests/tile-colour.test.ts
git commit -m "feat(board): re-solve the 12 board hues against the dark card"
```

---

### Task 7: A new tile picks its own colour

**Files:**
- Modify: `src/app/dashboard/board-actions.ts` (the `BoardTileRow` insert, ~line 1188)
- Modify: `tests/tile-colour.test.ts` (append)

**Interfaces:**
- Consumes: `GROUP_COLOR_KEYS` from Task 6.
- Produces: `randomTileColour(): string` exported from `src/lib/board/tile-config.ts`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { randomTileColour } from "@/lib/board/tile-config";

describe("a new tile picks its own colour", () => {
  it("never returns grey — grey is the degrade path, not a choice", () => {
    for (let i = 0; i < 200; i++) expect(randomTileColour()).not.toBe("grey");
  });

  it("only ever returns a key the palette knows", () => {
    for (let i = 0; i < 200; i++) expect(GROUP_COLOR_KEYS).toContain(randomTileColour());
  });

  it("actually varies", () => {
    const seen = new Set(Array.from({ length: 200 }, randomTileColour));
    expect(seen.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tile-colour.test.ts -t "picks its own colour"`
Expected: FAIL — `randomTileColour is not a function`

- [ ] **Step 3: Add the function**

In `src/lib/board/tile-config.ts`:

```ts
/**
 * The colour a NEWLY CREATED tile wears.
 *
 * Chosen at CREATION, not at render: a colour re-rolled on every load is a
 * different feature and a worse one — the board would change under the
 * customer while they read it. Stored as a key like every other tile colour,
 * so re-solving a hue restyles every board at once with no backfill.
 *
 * `grey` is excluded deliberately. It is the "no colour" default the column
 * degrades to when a key is unknown, so handing it out as a CHOICE would make
 * "unset" and "deliberately grey" indistinguishable.
 */
export function randomTileColour(): string {
  const hues = GROUP_COLOR_KEYS.filter((k) => k !== "grey");
  return hues[Math.floor(Math.random() * hues.length)];
}
```

- [ ] **Step 4: Use it at the insert**

In `src/app/dashboard/board-actions.ts`, the `row: BoardTileRow` literal gains `color: randomTileColour(),`. Import it from `@/lib/board/tile-config`. Leave the column's `"grey"` default in `schema.ts` alone — that is the degrade path for rows written by anything else and should stay boring.

If `BoardTileRow` does not carry `color`, add it to the type in `src/lib/board/types.ts` as `color: string`.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/tile-colour.test.ts tests/board-actions.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/board/tile-config.ts src/lib/board/types.ts src/app/dashboard/board-actions.ts tests/tile-colour.test.ts
git commit -m "feat(board): a new metric tile gets a random colour"
```

---

### Task 8: The sidebar stops being a rail

The largest structural change. `src/components/sidebar.tsx` is 1025 lines and the hover mechanism is woven through it: `group-hover/rail`, `group-focus-within/rail`, `group-data-[pinned=true]/rail`, the `REVEAL` constant, the `SLOT` constant, and a pin cookie.

**Files:**
- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/shell-skeleton.tsx`
- Modify: `src/components/app-shell.tsx` (whatever sets the rail's width and reads the pin cookie)
- Test: `tests/console-theme.test.ts` (it already asserts sidebar spacing), plus a new case below

**Interfaces:**
- Consumes: the tokens from Tasks 2–4.
- Produces: a fixed 260px sidebar at `md` and up. The mobile drawer below `md` is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/lime-theme.test.ts`:

```ts
describe("the sidebar is always open", () => {
  // `readFileSync`, `join` and `root` are already in scope from Task 2's header.
  const sidebar = readFileSync(join(root, "src/components/sidebar.tsx"), "utf8");
  const skeleton = readFileSync(join(root, "src/components/shell-skeleton.tsx"), "utf8");

  it("carries no hover-to-open mechanism", () => {
    expect(sidebar).not.toMatch(/group-hover\/rail/);
    expect(sidebar).not.toMatch(/group-focus-within\/rail/);
    expect(sidebar).not.toMatch(/group-data-\[pinned=true\]\/rail/);
  });

  it("is 260px wide", () => {
    expect(sidebar).toMatch(/w-\[260px\]/);
  });

  it("the skeleton mirrors the same width, or the content jumps at hydration", () => {
    expect(skeleton).toMatch(/w-\[260px\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts -t "always open"`
Expected: FAIL — `group-hover/rail` still present

- [ ] **Step 3: Rewrite the sidebar**

Structure, per the spec's Layout section. Container: `w-[260px] bg-chrome border-r border-border pt-[14px] px-4 flex flex-col h-full`.

1. Workspace row — `py-1.5 flex items-center justify-between`, then `pb-6`. A 28px `bg-primary rounded-card` square holding the initial in `text-primary-foreground text-[13px] font-semibold`; the name in `text-sm font-semibold text-foreground`; a 24px chevron.
2. Search — the existing `Input`, `h-9 bg-control border border-border rounded-control`, an 18px glyph in a 32px box, placeholder `text-md text-muted-foreground`.
3. `Main Menu` — `pt-6`, `text-xs text-faint`, then `gap-2`.
4. Nav rows — `h-9 rounded-control gap-2.5`, an 18px glyph in a 32px box, label `text-sm`. Active: `bg-control text-foreground font-semibold`. Rest: `text-muted-foreground`.
5. Sub-nav — `gap-4`; a `w-4` gutter holding three stacked `flex-1 border-r` rules, the active one `border-foreground` and the rest `border-muted-foreground`; then `h-8` rows at `text-sm`.
6. Footer — `px-4 pb-6 gap-4 mt-auto`. The Invite card (`bg-control border border-border rounded-card px-3 py-2`), then the lime New button (`h-9 bg-primary text-primary-foreground rounded-control`).

Delete `REVEAL` and every `group-*/rail` variant. Delete the pin cookie and its toggle. Keep `RailLabel` only if it still has a caller after the rewrite; if not, delete it and let `pnpm check:orphans` confirm.

- [ ] **Step 4: Mirror the width in the skeleton**

In `src/components/shell-skeleton.tsx`, the ghost rail becomes `w-[260px]`. It mirrored 56px for a reason that has not changed: a ghost of the wrong width jumps the content at hydration.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run && pnpm typecheck && pnpm check:ui && pnpm check:orphans`
Expected: PASS except `retheme-lime-docs` (Task 12)

- [ ] **Step 6: Look at it**

```bash
pnpm dev &
SHOT_SCHEME=dark pnpm shot /design/overview /tmp/sidebar.png 1200
```

Compare against the Figma render. The rail is 260px, always open, with no hover state.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar.tsx src/components/shell-skeleton.tsx src/components/app-shell.tsx tests/lime-theme.test.ts
git commit -m "feat(shell): the sidebar is always open at 260px"
```

---

### Task 9: The top bar

**Files:**
- Modify: `src/components/top-bar.tsx`

**Interfaces:**
- Consumes: tokens from Tasks 2–4.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing test** (append to `tests/lime-theme.test.ts`)

```ts
describe("the top bar", () => {
  const bar = readFileSync(join(root, "src/components/top-bar.tsx"), "utf8");

  it("carries the promo line with the brand word in lime", () => {
    expect(bar).toMatch(/Namzilabs/);
    expect(bar).toMatch(/text-marker|text-primary/);
  });

  it("sets no colour by hex at the call site", () => {
    expect(bar).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts -t "top bar"`
Expected: FAIL on the promo assertion

- [ ] **Step 3: Rebuild the bar**

`bg-chrome border-b border-border px-6 py-4 flex items-center`, three groups:

- Left: a 32px `bg-avatar rounded-full` disc with `text-[13px]` initials; the name in `text-sm font-semibold`; a 20px gift glyph carrying a small `bg-primary rounded-full` dot badge.
- Centre: `flex-1 flex items-center justify-center`. `Try` and `for free` in `italic font-normal`; `Namzilabs` in `italic font-semibold text-marker`. All `text-sm`.
- Right: `flex items-center gap-4` — `Updated just now` in `text-sm text-muted-foreground`; a Share group (14px glyph + `text-sm font-semibold`); the existing 16px theme toggle; a 24px bell.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run && pnpm check:ui`
Expected: PASS except `retheme-lime-docs`

- [ ] **Step 5: Commit**

```bash
git add src/components/top-bar.tsx tests/lime-theme.test.ts
git commit -m "feat(shell): the three-part top bar"
```

---

### Task 10: Buttons and tabs

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/app/dashboard/board-controls.tsx` (tabs)

**Interfaces:**
- Consumes: `--primary`, `--primary-foreground`, `--muted-foreground`.
- Produces: the `white` button variant the header's Today/Refresh All use.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("buttons and tabs", () => {
  const button = readFileSync(join(root, "src/components/ui/button.tsx"), "utf8");
  const controls = readFileSync(join(root, "src/app/dashboard/board-controls.tsx"), "utf8");

  it("the filled variant takes its ink from the role, which is now near-black", () => {
    expect(button).toMatch(/bg-primary/);
    expect(button).toMatch(/text-primary-foreground/);
  });

  it("stands every labelled button at 32px", () => {
    expect(button).toMatch(/h-8/);
  });

  it("an inactive tab is readable — never the Figma's #4A4A4A at 2.11:1", () => {
    expect(controls).toMatch(/text-muted-foreground/);
    expect(controls).not.toMatch(/#4a4a4a/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts -t "buttons and tabs"`

- [ ] **Step 3: Update the variants**

The filled variant already spells `bg-primary text-primary-foreground`; Task 2 inverted the ink, so it needs no call-site change — confirm and leave it. The `white` variant (`bg-white text-[#4A4A4A]` via roles: `bg-secondary text-secondary-foreground` in light) is what Today and Refresh All wear; give it a role pair rather than a literal, and set `--secondary`/`--secondary-foreground` in `.dark` to `#ffffff` / `#4a4a4a` so the dark console's secondary buttons are the white pills the Figma draws.

Set every labelled button to `h-8` and `rounded-control`.

- [ ] **Step 4: Tabs**

Active: `text-sm font-semibold text-foreground`. Inactive: `text-sm text-muted-foreground` (substitution 2 — never `#4A4A4A`, which measures 2.11:1 here).

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run && pnpm check:ui && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/button.tsx src/app/dashboard/board-controls.tsx tests/lime-theme.test.ts
git commit -m "feat(ui): lime fill under near-black, white secondary pills, 32px buttons"
```

---

### Task 11: Cards, charts and the delta chip

**Files:**
- Modify: `src/components/metric-card.tsx`
- Modify: `src/components/board-charts/frame.tsx`, `cartesian.tsx`, `scorecard.tsx`
- Modify: `src/components/charts.tsx`

**Interfaces:**
- Consumes: `accentOf()` from Task 6, tokens from Tasks 2–4.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("cards and the delta chip", () => {
  const card = readFileSync(join(root, "src/components/metric-card.tsx"), "utf8");
  const charts = readFileSync(join(root, "src/components/charts.tsx"), "utf8");

  it("the numeral is 28px semibold, not bold", () => {
    expect(card).toMatch(/text-display-xs/);
    expect(card).not.toMatch(/font-bold/);
  });

  it("the delta chip refuses to pick a direction", () => {
    // Both +50% and -50% are drawn in the same grey in the Figma.
    expect(card).not.toMatch(/text-success|text-danger/);
  });

  it("no chart hard-codes the old blue series", () => {
    expect(charts).not.toMatch(/#007bff|brand-500/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lime-theme.test.ts -t "cards and the delta"`

- [ ] **Step 3: Card and tile**

Card: `bg-card border border-border rounded-card`. Header `pt-4 px-4`, title `text-sm text-muted-foreground leading-[15px]`, freshness group right (12px `rounded-full` halo at `--freshness-halo`, a 4px `--freshness-dot`, then `text-xs text-muted-foreground`).

Chart card body: `px-4 pb-2`, numeral `text-display-xs font-semibold` (28/40/−1.08). Chart `pt-3` with a right-aligned `text-xs text-muted-foreground` y-axis column, horizontal grid lines per tick, a dashed zero floor, and an x-axis row. Legend centred, `pb-4 gap-2.5`, an 8px `rounded-full` dot per series then `text-xs text-muted-foreground`.

Stat tile body: `p-4`, numeral at 28/36/−1.08, delta chip pushed right.

- [ ] **Step 4: Delta chip**

`bg-[rgb(120_120_120_/_0.15)]` expressed as a role — add `--delta-chip` to both theme blocks rather than a literal at the call site — `rounded-full px-2 py-0.5 gap-1`. A 12px direction arrow, the percentage at `text-xs font-semibold` (NOT `font-bold`: the Figma asks for 700 and the kit runs three weights), then `vs compared` at `text-xs`. Ink and arrow are `text-muted-foreground` in BOTH directions.

- [ ] **Step 5: Series colours**

Primary series: the tile's accent via `accentOf()`, defaulting to `var(--color-brand-400)`. Comparison series: `rgb(10 151 213 / 0.5)` — add as `--series-compare` in both theme blocks. This is the one place blue survives, and it survives as a comparison, not as the brand.

- [ ] **Step 6: Run tests and look**

Run: `pnpm vitest run && pnpm check:ui && SHOT_SCHEME=dark pnpm shot /design/overview /tmp/cards.png`
Expected: PASS except `retheme-lime-docs`; the shot matches the Figma's card row.

- [ ] **Step 7: Commit**

```bash
git add src/components/metric-card.tsx src/components/board-charts src/components/charts.tsx src/app/globals.css tests/lime-theme.test.ts
git commit -m "feat(board): lime cards, 28px numerals, a neutral delta chip"
```

---

### Task 12: Sweep the remaining surfaces, canvas excepted

**Files:**
- Modify: whatever `rg` finds below.

- [ ] **Step 1: Find every call site still spelling the old theme**

```bash
rg -n "#0f1011|#111111|#181818|#007bff|#0070e8|#3d9bff|#858585|#6e6e6e" src --glob '!src/components/flow/node-accent.ts'
rg -n "dark:" src --type tsx
```

Expected: a list. Every hit is either a role that should be spelled by name, or a genuine exception needing a comment.

- [ ] **Step 2: Fix each hit by replacing the literal with its role**

Not by replacing the literal with a NEW literal. `bg-card`, `text-muted-foreground`, `border-border`.

- [ ] **Step 3: Re-theme the flow builder's chrome**

Its panels, headers, buttons and lists follow the same roles as everything else. **Do not touch the canvas surface or the node bodies** — `src/components/flow/` node rendering and the `@xyflow` canvas keep their layout, spacing and structure. They recolour only through `--canvas-bg`, `--canvas-dot`, `--canvas-edge`, which get re-cut for `#121214`.

- [ ] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm test && pnpm check:ui && pnpm check:orphans`
Expected: PASS except `retheme-lime-docs`

- [ ] **Step 5: Screenshot every unauthenticated surface**

```bash
for p in /design /design/board /design/canvas; do
  SHOT_SCHEME=dark pnpm shot "$p" "/tmp/shot-$(basename $p).png"
done
```

Check for: a control that vanished into its ground, an icon that stayed blue, text under its contrast bar.

**And check the dense views specifically** — the 15px→14px base is spec Risk 1,
and tables are where a base change shows first. Screenshot `/design/board` and
the connections list, and confirm no row wraps that did not wrap before.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat(theme): sweep every remaining surface onto the lime roles"
```

---

### Task 13: Rewrite the design documents

The last task, because a document describing what shipped is worth more than one describing what was planned.

**Files:**
- Modify: `DESIGN.md` (550 lines), `docs/BRAND_KIT.md` (836 lines)

- [ ] **Step 1: Run the docs test to see what must be stated**

Run: `pnpm vitest run tests/retheme-lime-docs.test.ts`
Expected: FAIL on all four assertions — each names a claim the prose must make.

- [ ] **Step 2: Rewrite `DESIGN.md`**

Front-matter: `accent` becomes the lime and its near-black ink; `neutral` becomes one ground plus a card; `type` drops to a 14px base; `status` records the 8 Sep re-theme.

§2 must own the **second reversal** explicitly — three surfaces back to one — rather than quietly rewording. The argument: the Figma draws no step between page, chrome and panel, so the hairline's job narrows to the single 1.06:1 card edge, and `--radius-frame` retires because a notch cut into one colour reveals nothing.

§4 must record that the two-step blue split (`--marker` draws, `--primary` fills) collapses to one value on dark, because lime has 15.53:1 as a stroke and 11.59:1 as a fill and needs no second step; only light mode keeps a separate, solved-down stroke.

Add a short section owning the **white secondary buttons**: they are the loudest thing in the header after the lime, they are drawn that way, and the "quiet chrome" thesis has to acknowledge the tension rather than pretend it does not exist.

- [ ] **Step 3: Rewrite `docs/BRAND_KIT.md`**

Token tables from Tasks 2–4, the measured ratios from `tests/lime-theme.test.ts`, and a **substitution log** naming both deviations with their numbers: `#7E7E7E` at 4.33:1 on the card, `#4A4A4A` at 2.11:1 for a tab.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm check:ui && pnpm typecheck`
Expected: **all green, including `retheme-lime-docs`**

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md docs/BRAND_KIT.md
git commit -m "docs: rewrite the kit and the design language for the lime theme"
```

---

## Done when

- `pnpm typecheck && pnpm test && pnpm check:ui && pnpm check:orphans` all pass.
- `SHOT_SCHEME=dark pnpm shot /design/overview` matches Figma node 49:5268 in colour, type, spacing and radius.
- A newly created metric tile renders in a non-grey colour that differs run to run.
- `rg "#007bff|#0f1011|#181818" src DESIGN.md docs/BRAND_KIT.md` returns nothing.
