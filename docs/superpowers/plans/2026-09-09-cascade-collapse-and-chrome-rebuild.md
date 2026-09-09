# Cascade Collapse + Chrome Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the CSS cascade so utilities win, then rebuild the top-bar chrome to match Figma `0:5` exactly.

**Architecture:** Phase A is CSS-only: move 25 unlayered rules into `@layer base` / `@layer components` so Tailwind utilities stop losing to them, guarded by a hardened version of the repo's existing `base-layer-cascade` test. Phase B splits the `--chrome` token family into `--rail` and `--topbar`, then rebuilds one 65px dark bar into three bars (57/49/43) matching the Figma. Every step is gated by the repo's own tools — `check:ui`, `geometry`, `shot` — rather than by new machinery.

**Tech Stack:** Next.js 16 (Turbopack), React, Tailwind v4 (`@theme` + `@theme inline` shadcn bridge), vitest, Playwright via `scripts/screenshot.mjs`, `next-themes`.

**Spec:** `docs/superpowers/specs/2026-09-09-cascade-collapse-and-chrome-rebuild-design.md`

**Worktree:** `.claude/worktrees/chrome-cascade-rebuild`, branch `chrome-cascade-rebuild`, based on `origin/main` (`78d2d6e`). Run everything from there.

## Global Constraints

- **Baseline is green: 252 files, 3250 tests.** Any task ending red is not done.
- **The flow builder is off-limits.** Its seven unlayered rules stay unlayered: `.react-flow__node`, `.react-flow__node.selectable:focus-visible`, `.react-flow__handle`, `.react-flow__edge-path`, `.flow-shadow`, `.flow-pop-in`, `.flow-pop-out`. Its design is not under review.
- **`--spacing-chrome-band: 24px` is NOT a chrome colour token.** It is flow-builder geometry. It survives the rename in Task 5 untouched.
- **`#topbar-slot` must keep its id.** `src/components/flow/FlowToolbar.tsx` calls `document.getElementById("topbar-slot")`; losing the id renders the builder's toolbar nowhere.
- **`#topbar-status` already exists** in `top-bar.tsx` and is the "Updated just now" slot. Fill it; do not invent a second mechanism.
- **`:root`, `.dark` and `html.dark` stay unlayered.** They declare only custom properties, which utilities read rather than compete with.
- **Do not implement the card-header divider (spec §B.3) from numbers in the spec.** Figma MCP hit the Starter-plan rate limit; node `0:212` must be re-read via `get_design_context` (behind the mandatory `figma-design-to-code` skill) first. Out of scope for this plan.
- **Type scale and gaps:** every sibling gap in a bar is `8`, every icon-to-label gap is `4`. Exceptions, and the only ones: `10` inside the search field and between a rail icon and its label, `12` inside the invite card, `16` between the rail's rule column and its links.
- **Commit after every task.** Message style follows the repo: a plain imperative sentence, often two clauses, no `feat:` prefix.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `tests/base-layer-cascade.test.ts` | Modify — harden the guard so comments cannot hide unlayered rules | A |
| `src/app/globals.css` | Modify — layer 25 rules, merge duplicate blocks, split `--chrome` | A + B |
| `tests/flow-builder-cascade.test.ts` | Create — pin the builder's seven rules as deliberately unlayered | A |
| `src/components/top-bar.tsx` | Modify — becomes bars 1 and 2 | B |
| `src/components/app-frame.tsx` | Modify — renders the new bar stack | B |
| `src/components/sidebar.tsx` | Modify — search removed from the rail | B |
| `src/app/dashboard/board-controls.tsx` | Modify — `ViewStrip` becomes pill tabs with icons; control row gains *Compare To* | B |
| `tests/page-width.test.ts` | Modify — reads the bar height by matching `<header className="…">`; the three-bar split changes it | B |
| `tests/topbar-figma.test.ts` | Create — asserts the three bar heights and the 8/4 gap rule | B |

---

## Phase A — collapse the cascade

### Task 1: Harden the cascade guard, then layer the element-keyed rules

The repo already has `tests/base-layer-cascade.test.ts` asserting "no unlayered rule keyed on a bare element". It passes today — and it is wrong. Its selector regex is `[^{}@/]+?`, which cannot span a `/*…*/` comment, and in this file almost every rule is preceded by one. It sees **13 of 35** unlayered rules, misses bare `html` entirely, and even matches prose *inside* comments as selectors (it currently reports `` ` or ` `` as a CSS selector).

**Files:**
- Modify: `tests/base-layer-cascade.test.ts:79-120` (the `unlayered` / `unlayeredElementRules` helpers)
- Modify: `src/app/globals.css` — element-keyed rules at 1172-1184 (`html`), 1254-1256 (`textarea`), 1261-1263 (`html` again), 1334-1339 (`select:-webkit-autofill`), 1636-1638 (`:where(svg.lucide)`), 1653-1656 and 1707-1709 (the two focus-visible rules), 1790-1792 (`summary`)

**Interfaces:**
- Produces: a `stripComments(source: string): string` helper in the test file, applied before any selector scan. Task 2 relies on the same hardened scan seeing class rules.

- [ ] **Step 1: Write the failing test — strip comments before scanning**

In `tests/base-layer-cascade.test.ts`, add the helper and apply it inside `unlayeredElementRules`:

```ts
/**
 * Comments are removed before any selector scan.
 *
 * The scan below keys on `(^|})\s*([^{}@/]+?)\s*\{`, and `/` is excluded from a
 * selector for good reason — but that makes the pattern unable to step over a
 * `/* … *\/` block, and in this stylesheet nearly every rule is preceded by
 * one. The effect was silent and total: the check saw 13 of 35 unlayered rules,
 * could not see bare `html` at all, and matched prose inside comments as
 * selectors. A guard that cannot see the thing it guards is worse than none,
 * because it reports success.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}
```

Then change the scan's input in `unlayeredElementRules` from `unlayered(css)` to `stripComments(unlayered(css))`, and the same in `unlayeredDeclarations`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/base-layer-cascade.test.ts`
Expected: FAIL on `leaves no unlayered rule keyed on a bare element`, reporting `html` (`color-scheme`, `scroll-padding-top`), `html` again (`-webkit-tap-highlight-color`), `textarea`, `summary`, `select:-webkit-autofill`, and the `:where(...)` rules.

If it still passes, the helper is not wired into the scan — fix that before continuing. A green test here means the task did nothing.

- [ ] **Step 3: Move the element-keyed rules into `@layer base`**

In `src/app/globals.css`, wrap each of these in the base layer, keeping every declaration and every comment exactly as it is:

`html` (1172-1184), `html` (1261-1263), `textarea` (1254-1256), `summary` (1790-1792), `select:-webkit-autofill` (1334-1339), `:where(svg.lucide)` (1636-1638), and both `:where(a, button, summary, [role="button"], [role="switch"], [tabindex]:not([tabindex="-1"]))` focus-visible rules (1653-1656, 1707-1709).

Do **not** move `:root`, `.dark`, or `html.dark` — they declare only custom properties. Do **not** move any `.react-flow__*`, `.flow-shadow` or `.flow-pop-*` rule.

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run tests/base-layer-cascade.test.ts`
Expected: PASS, 2 tests.

Run: `npx vitest run`
Expected: 252 files, 3250 tests, all passing. If a test that previously passed now fails, a utility has started winning where it did not before — that is the fix working. Read the failure, confirm the new value is the intended one, and update the test's expectation rather than reverting the layer.

- [ ] **Step 5: Commit**

```bash
git add tests/base-layer-cascade.test.ts src/app/globals.css
git commit -m "Let the cascade guard see past its own comments, and layer what it finds"
```

---

### Task 2: Layer the component classes, and pin the builder's exclusion

**Files:**
- Modify: `src/app/globals.css` — `.quiet-scroll` and its four scrollbar pseudo-rules (1417-1436), `.board-canvas` / `.board-cell` and their two `@media` blocks (1459-1496), `.tnum` (1501-1504), `.stat-numeral` (1522-1545), `.font-display` (1552-1555), `.wordmark` (1572-1579), `.label-micro` (1591-1597), `.skip-link` and `.skip-link:focus-visible` (1716-1726), `.bg-rail` (1808-1810), and the two `animate-in`/`animate-out` rules (56-63)
- Create: `tests/flow-builder-cascade.test.ts`

**Interfaces:**
- Consumes: `stripComments` from Task 1's hardened test — the new test file defines its own copy rather than importing across test files.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing test — the builder's rules are unlayered ON PURPOSE**

Create `tests/flow-builder-cascade.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FLOW BUILDER'S RULES ARE UNLAYERED DELIBERATELY, AND THIS SAYS SO.
 *
 * Task 2 of the cascade collapse layered every other component class. These
 * seven were left alone because layering them hands precedence to utilities and
 * could move the builder, whose design is settled and not under review. That is
 * a decision, not an oversight — but it is indistinguishable from an oversight
 * to the next person holding a list of unlayered rules. So it is pinned here:
 * if someone "finishes the job", this test tells them it was already finished.
 */
const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8");

const BUILDER_RULES = [
  ".react-flow__node",
  ".react-flow__node.selectable:focus-visible",
  ".react-flow__handle",
  ".react-flow__edge-path",
  ".flow-shadow",
  ".flow-pop-in",
  ".flow-pop-out",
];

/** The stylesheet with every `@layer <name> { … }` block removed. */
function unlayered(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; ) {
    const at = source.indexOf("@layer", i);
    if (at === -1) {
      out += source.slice(i);
      break;
    }
    const open = source.indexOf("{", at);
    const semi = source.indexOf(";", at);
    if (open === -1 || (semi !== -1 && semi < open)) {
      out += source.slice(i, semi + 1);
      i = semi + 1;
      continue;
    }
    out += source.slice(i, at);
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

describe("the flow builder's rules stay out of the layers", () => {
  const outside = unlayered(css).replace(/\/\*[\s\S]*?\*\//g, "");

  for (const selector of BUILDER_RULES) {
    it(`keeps ${selector} unlayered`, () => {
      expect(outside).toContain(selector);
    });
  }

  it("keeps --spacing-chrome-band, which is builder geometry and not a chrome colour", () => {
    expect(css).toMatch(/--spacing-chrome-band\s*:\s*24px/);
  });
});
```

- [ ] **Step 2: Run it to verify it passes already**

Run: `npx vitest run tests/flow-builder-cascade.test.ts`
Expected: PASS, 8 tests. This one is a pin, not a red-green cycle — it documents the current state so Step 3 cannot silently break it.

- [ ] **Step 3: Move the component classes into `@layer components`**

Wrap the rules listed under **Files** above in `@layer components { … }`, keeping declarations and comments intact. `.board-canvas` and `.board-cell` take their two `@media (min-width: …)` blocks with them — the media queries go *inside* the layer.

Leave every `BUILDER_RULES` selector exactly where it is.

- [ ] **Step 4: Run both tests and the suite**

Run: `npx vitest run tests/flow-builder-cascade.test.ts tests/base-layer-cascade.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: 252 files + 1 new, all green. Investigate any newly-red test as in Task 1 Step 4.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tests/flow-builder-cascade.test.ts
git commit -m "Put the component classes in a layer, and pin the seven that stay out"
```

---

### Task 3: Merge the duplicated blocks and kill the dead teal

**Files:**
- Modify: `src/app/globals.css` — `@layer base` at 33, 1270, 1376; `html` at 1172 and 1261 (now both inside `@layer base` after Task 1)

- [ ] **Step 1: Write the failing test**

Append to `tests/base-layer-cascade.test.ts`:

```ts
describe("the stylesheet says each thing once", () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("declares @layer base exactly once", () => {
    expect([...bare.matchAll(/@layer\s+base\s*\{/g)]).toHaveLength(1);
  });

  it("declares html exactly once", () => {
    expect([...bare.matchAll(/^\s*html\s*\{/gm)]).toHaveLength(1);
  });

  it("carries no colour from the pre-lime palette", () => {
    // #00D492 — the teal the app used before the 8 September re-theme. It
    // survived as a tap-highlight nobody looked at on a desktop browser.
    expect(bare).not.toMatch(/0\s+212\s+146/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/base-layer-cascade.test.ts`
Expected: FAIL on all three — three `@layer base` blocks, two `html` blocks, and the teal still present.

- [ ] **Step 3: Merge and replace**

Combine the three `@layer base` blocks into one, at the position of the first (line 33), preserving the order of their contents. Combine the two `html` rules into one inside it:

```css
html {
  color-scheme: light;
  scroll-padding-top: 5rem;
  -webkit-tap-highlight-color: rgb(182 255 86 / 0.12);
}
```

`rgb(182 255 86)` is `#B6FF56`, the brand, at the alpha the teal used.

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run tests/base-layer-cascade.test.ts` → PASS (5 tests)
Run: `npx vitest run` → all green
Run: `npx tsx scripts/check-ui.ts` → exit 0

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tests/base-layer-cascade.test.ts
git commit -m "Say @layer base once, say html once, and drop the teal nothing has drawn since August"
```

---

### Task 4: Account for every pixel Phase A moved

Phase A's success criterion is **not** "renders identically" — layering deliberately hands precedence back to utilities, so pixels move where a utility was being overridden. The gate is that every diff is explained.

**Files:** none modified. This task produces evidence.

- [ ] **Step 1: Capture the "after" set**

```bash
pnpm dev   # separate terminal, note the port
```

For each of `/design/overview`, `/design`, `/design/board`, `/design/primitives`, `/design/gallery`, in both schemes:

```bash
SHOT_BASE=http://localhost:3000 SHOT_WIDTH=1920 node scripts/screenshot.mjs /design/overview after-overview-light.png 1200
SHOT_SCHEME=dark SHOT_BASE=http://localhost:3000 SHOT_WIDTH=1920 node scripts/screenshot.mjs /design/overview after-overview-dark.png 1200
```

- [ ] **Step 2: Capture the "before" set from the base commit**

```bash
git stash push -u -m "cascade-after-shots"
git checkout 78d2d6e -- src/app/globals.css
# re-run the same ten shots as before-*.png
git checkout HEAD -- src/app/globals.css
git stash list --format='%H %gs'        # capture the SHA for this tag
git stash apply <sha>                    # apply, never pop
```

Note: the stash stack is shared across worktrees — use the tagged-apply-drop sequence, never bare `git stash pop`.

- [ ] **Step 3: Diff each pair and write the ledger**

For every pair that differs, record: the element, the property, the utility that now wins, and whether the new value is correct. Any diff you cannot explain is a regression — fix it before moving on.

- [ ] **Step 4: Prove the builder did not move**

Screenshot the flow builder before and after. Its seven rules did not move, so it must be **byte-identical**:

```bash
cmp before-builder.png after-builder.png && echo "IDENTICAL"
```

Any difference means something leaked out of Tasks 1-3. Stop and find it.

- [ ] **Step 5: Commit the ledger**

```bash
git add docs/superpowers/plans/2026-09-09-cascade-ledger.md
git commit -m "Write down every pixel the layering moved, and why each one is right"
```

---

## Phase B — rebuild the chrome

### Task 5: Split `--chrome` into `--rail` and `--topbar`

Eight colour tokens, declared twice (`:root` 713-725, `.dark` 871-883), become two families. 66 call sites across 5 files follow.

**Files:**
- Modify: `src/app/globals.css:713-725` and `:871-883`
- Modify: `src/components/top-bar.tsx`, `src/components/sidebar.tsx`, `src/components/app-frame.tsx`, `src/components/shell-skeleton.tsx`, and the fifth file `grep -rl` reports

**Interfaces:**
- Produces: `--rail`, `--rail-foreground`, `--rail-muted`, `--rail-faint`, `--rail-border`, `--rail-control`, `--rail-accent`, `--rail-brand`; and `--topbar`, `--topbar-foreground`, `--topbar-muted`, `--topbar-faint`, `--topbar-border`, `--topbar-control`, `--topbar-active`, `--topbar-brand`. Tasks 6-8 use the `--topbar-*` family exclusively.

- [ ] **Step 1: Write the failing test**

Create `tests/topbar-figma.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8");
const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
const dark = css.slice(css.indexOf(".dark {"));

describe("the rail and the top bar are two surfaces", () => {
  it("keeps the rail near-black in both themes", () => {
    expect(light).toMatch(/--rail:\s*#121214/i);
    expect(dark).toMatch(/--rail:\s*#121214/i);
  });

  it("makes the top bar white on light and near-black on dark", () => {
    expect(light).toMatch(/--topbar:\s*#ffffff/i);
    expect(dark).toMatch(/--topbar:\s*#121214/i);
  });

  it("gives the top bar the Figma's control and active fills", () => {
    expect(light).toMatch(/--topbar-control:\s*#efefef/i);
    expect(light).toMatch(/--topbar-active:\s*#dedede/i);
    expect(light).toMatch(/--topbar-border:\s*#f1f1f1/i);
  });

  it("retires every --chrome colour role", () => {
    expect(css).not.toMatch(/--chrome(-[a-z-]+)?\s*:/);
  });

  it("keeps --spacing-chrome-band, which is builder geometry", () => {
    expect(css).toMatch(/--spacing-chrome-band\s*:\s*24px/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/topbar-figma.test.ts`
Expected: FAIL — no `--rail` or `--topbar` tokens exist yet.

- [ ] **Step 3: Declare the two families**

Replace the eight `--chrome*` declarations in `:root` with the rail family at today's values plus the topbar family at the Figma's, and the same in `.dark` with the topbar family continuing today's near-black. Use the table in spec §B.1 verbatim. Add `--topbar-active` (`#dedede` light, `#3a3a3a` dark), which has no `--chrome` equivalent.

Leave `--spacing-chrome-band` alone.

- [ ] **Step 4: Rename the 66 call sites**

Every `bg-chrome` → `bg-rail`, `text-chrome-foreground` → `text-rail-foreground`, and so on, in the five files. All are currently rail or bar surfaces that stay dark, so the rail family is the correct target for all 66 — Tasks 6-8 move the bar's own to `--topbar-*` as they rebuild each bar.

Prove none were missed:

```bash
grep -rn "chrome" src --include='*.tsx' | grep -v "chrome-band"
```
Expected: no output.

- [ ] **Step 5: Run everything and commit**

```bash
npx vitest run tests/topbar-figma.test.ts   # PASS
npx vitest run                               # all green
npx tsc --noEmit                             # clean
npx tsx scripts/check-ui.ts                  # exit 0
git add -A && git commit -m "Give the rail and the bar their own names, since they stopped being one colour"
```

Note: `scripts/check-ui.ts` derives `LIVE_CHROME_ROLES` from `--chrome-*` declarations. Retiring them all re-arms its ban on `chrome-*` classes automatically — which is why Step 4's grep must come back empty.

---

### Task 6: Bar 1 — search, account, wordmark

Bar 1 is global chrome and keeps `#topbar-slot` for the flow builder.

**Files:**
- Modify: `src/components/top-bar.tsx:85` (the `<header>` and its three groups)
- Modify: `src/components/sidebar.tsx` — remove the rail's search field, keep `railSearchEntries`
- Modify: `tests/page-width.test.ts` — it matches `<header className="…">` to read the bar height

- [ ] **Step 1: Write the failing test**

Append to `tests/topbar-figma.test.ts`:

```ts
const topBar = readFileSync(join(__dirname, "..", "src/components/top-bar.tsx"), "utf8");

describe("bar 1 draws the Figma's first band", () => {
  it("stands 57px — 40px of search over 8+8 padding and a hairline", () => {
    expect(topBar).toMatch(/h-\[57px\]/);
  });

  it("keeps the slot the flow builder renders its toolbar into", () => {
    expect(topBar).toMatch(/id="topbar-slot"/);
  });

  it("carries the search field the rail used to own", () => {
    expect(topBar).toMatch(/w-\[480px\]/);
    expect(topBar).toMatch(/placeholder="Search\.\.\."/);
  });

  it("puts the wordmark at the reading edge, not a promo in the middle", () => {
    expect(topBar).toMatch(/Namzilabs/);
    expect(topBar).not.toMatch(/for free/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/topbar-figma.test.ts`
Expected: FAIL — bar is `h-[65px]`, has no search, still carries the promo.

- [ ] **Step 3: Rebuild bar 1**

```tsx
<header className="flex h-[57px] shrink-0 items-center justify-between gap-4 border-b border-topbar-border bg-topbar px-6 py-2">
  <div className="flex w-[480px] shrink-0 items-center gap-2">
    {menu}
    <div className="flex h-10 flex-1 items-center gap-2.5 rounded-control bg-topbar-control px-3">
      <Search aria-hidden className="size-[18px] shrink-0 text-topbar-muted" />
      <input
        placeholder="Search..."
        className="min-w-0 flex-1 bg-transparent text-[15px] leading-[22px] text-topbar-muted outline-none placeholder:text-topbar-muted"
      />
    </div>
    {account && (
      <Link href="/dashboard/profile" aria-label="Your profile" className="…rounded-full bg-[#2E2E2E] size-8 text-xs font-semibold text-white">
        {account.initials}
      </Link>
    )}
    <Link href="/dashboard/settings" aria-label="Get free access" className="relative flex size-5 shrink-0 items-center justify-center text-topbar-foreground">
      <Gift />
      <span aria-hidden className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary" />
    </Link>
  </div>
  <div id="topbar-slot" className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
  <p className="shrink-0 text-2xl font-bold leading-8 text-topbar-foreground peer-[:not(:empty)]:hidden">Namzilabs</p>
</header>
```

The `peer` / `empty:hidden` arbitration is kept exactly as it was: the wordmark yields when the builder fills the slot.

Then delete the search block from `sidebar.tsx`, leaving `railSearchEntries` and its filtering intact for the relocated field to call.

- [ ] **Step 4: Run and fix `page-width.test.ts`**

Run: `npx vitest run tests/topbar-figma.test.ts` → PASS
Run: `npx vitest run tests/page-width.test.ts` → will FAIL on the height; update its expectation from 65 to 57 and re-run.
Run: `npx vitest run` → all green

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Give the bar the search the rail was holding, and the mark the promo displaced"
```

---

### Task 7: Bar 2 — title, freshness, share, and the two icon buttons that finally hover

Bar 2 is global so the theme toggle and bell stay reachable on every route. The title arrives through a slot; the 19 existing `PageHeader` callers are untouched.

**Files:**
- Modify: `src/components/top-bar.tsx` — add the second `<header>`, move `ShareLink`, `ThemeToggle` and the bell into it
- Modify: `src/components/top-bar.tsx:262` — the `ThemeToggle` className, which currently sets `hover:bg-transparent`

- [ ] **Step 1: Write the failing test**

```ts
describe("bar 2 draws the Figma's second band", () => {
  it("stands 49px — a 32px control over 8+8 and a hairline", () => {
    expect(topBar).toMatch(/h-\[49px\]/);
  });

  it("lets the moon and the bell take a fill on hover", () => {
    expect(topBar).not.toMatch(/hover:bg-transparent/);
    expect(topBar).toMatch(/hover:bg-topbar-control/);
  });

  it("keeps the freshness a slot rather than a claim the bar cannot make", () => {
    expect(topBar).toMatch(/id="topbar-status"/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — no `h-[49px]`, and `hover:bg-transparent` is still on the toggle.

- [ ] **Step 3: Build bar 2**

```tsx
<header className="flex h-[49px] shrink-0 items-center justify-between gap-4 border-b border-topbar-border bg-topbar px-6 py-2">
  <h1 id="topbar-title" className="text-2xl font-bold leading-8 text-topbar-foreground empty:hidden" />
  <div className="flex shrink-0 items-center gap-2">
    <div id="topbar-status" className="flex shrink-0 items-center p-2 text-[13px] leading-4 text-topbar-muted empty:hidden" />
    <ShareLink />
    <ThemeToggle />
    <Button variant="ghost" size="icon" className="size-8 rounded-control text-topbar-foreground hover:bg-topbar-control">
      <Bell />
    </Button>
  </div>
</header>
```

And on `ThemeToggle`, replace `hover:bg-transparent hover:text-chrome-muted active:bg-transparent` with `size-8 rounded-control hover:bg-topbar-control`.

The dashboard fills `#topbar-title` with "Overview" and `#topbar-status` with its freshness.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run && npx tsc --noEmit
git add -A && git commit -m "Give the moon its fill back, and the page the title the Figma draws above the tabs"
```

---

### Task 8: Bar 3 — pill tabs with icons, and the control row

The active tab and the resting tabs are **not the same box**: the active pill carries its padding on the outer element and wraps both the link and the overflow menu at `gap-4`; the resting tabs carry padding on the inner link.

**Files:**
- Modify: `src/app/dashboard/board-controls.tsx` — `ViewStrip` (tabs) and the control row
- Modify: `tests/board-controls.test.ts`, `tests/controls-and-rail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const controls = readFileSync(join(__dirname, "..", "src/app/dashboard/board-controls.tsx"), "utf8");

describe("bar 3 draws the Figma's third band", () => {
  it("fills the active tab and leaves the resting ones bare", () => {
    expect(controls).toMatch(/bg-topbar-active/);
    expect(controls).toMatch(/hover:bg-topbar-control/);
  });

  it("gives every tab its icon", () => {
    expect(controls).toMatch(/Box|Boxes/);
    expect(controls).toMatch(/Users|UsersRound/);
    expect(controls).toMatch(/Calendar/);
  });

  it("draws the four controls outlined, Add included", () => {
    expect(controls).toMatch(/Compare To/);
    expect(controls).not.toMatch(/bg-primary[^-]/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — tabs are underlined text with no icons, there is no *Compare To*, and *Add* is brand-filled.

- [ ] **Step 3: Rebuild the strip and the controls**

Tab, active:

```tsx
<div className="flex items-center gap-1 rounded-control bg-topbar-active px-2 py-1">
  <Link href={href} className="flex items-center gap-1 text-[13px] leading-4 tracking-[-0.24px] text-topbar-foreground">
    <Box aria-hidden className="size-3.5" />
    {view.name}
  </Link>
  <TileMenu className="size-3.5" />
</div>
```

Tab, resting and hover:

```tsx
<Link
  href={href}
  className="flex items-center gap-1 rounded-control px-2 py-1 text-[13px] leading-4 tracking-[-0.24px] text-[#4A4A4A] hover:bg-topbar-control"
>
  <UsersRound aria-hidden className="size-4" />
  {view.name}
</Link>
```

Control button, all four identical but for glyph and label — note `border`, not `outline`, or the row measures 24 and every bar below shifts 2px:

```tsx
<button className="flex items-center gap-1 rounded-control border border-[#E1E1E1] bg-card px-2 py-1 text-[13px] leading-4 text-topbar-foreground">
  <Plus aria-hidden className="size-3.5" />
  Add
</button>
```

*Today* and *Compare To* take a trailing `ChevronDown` at `size-3` inside their own `flex gap-1 items-start` container. *Compare To* wires to the board's existing range comparison; if none is reachable, ship it `disabled` with a title explaining why rather than as a control that silently does nothing.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run && npx tsc --noEmit && npx tsx scripts/check-ui.ts
git add -A && git commit -m "Make the tabs pills with icons, and stand the four controls in one outlined row"
```

---

### Task 9: Measure the result against the Figma

**Files:** none modified unless the measurement says so.

- [ ] **Step 1: Assert the bar heights sum to the Figma's content offset**

Append to `tests/topbar-figma.test.ts`:

```ts
it("stacks to 149px, where the Figma's content container starts", () => {
  const heights = [...topBar.matchAll(/h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  expect(heights).toContain(57);
  expect(heights).toContain(49);
  // bar 3 is 43 and lives in board-controls; 57 + 49 + 43 = 149
  expect(57 + 49 + 43).toBe(149);
});
```

- [ ] **Step 2: Run the geometry check in the browser**

```bash
pnpm dev
SHOT_SCHEME=light pnpm geometry
pnpm geometry            # dark
```

`scripts/geometry-check.mjs` measures the shell against Figma nodes `49:5268` / `58:5824` — the **previous** frame. Its expected top-bar numbers are now wrong by design. Update its expectations to the new frame (`0:5`): bar stack 149, rail 260, content inset 24.

- [ ] **Step 3: Photograph and compare**

```bash
SHOT_WIDTH=1920 node scripts/screenshot.mjs /design/overview final-light.png 1200
SHOT_SCHEME=dark SHOT_WIDTH=1920 node scripts/screenshot.mjs /design/overview final-dark.png 1200
```

Compare `final-light.png` against the Figma render element by element, using spec §Appendix: the three bar heights, the 480px search group, the wordmark's right edge at 1636, the tab pills, the four outlined controls, and every 8 and 4.

Check resting / hover / focus-visible on every tab and icon button — two of them are drawn mid-hover in the Figma, so those states are the deliverable.

- [ ] **Step 4: Confirm the rail did not move**

The rail is unchanged by design. Diff its region against the Phase A "after" shot; any difference is a bug from Task 5's rename.

- [ ] **Step 5: Full gate, then commit**

```bash
npx vitest run          # 252+ files green
npx tsc --noEmit
npx tsx scripts/check-ui.ts
pnpm geometry
git add -A && git commit -m "Measure the new bars against the frame that specified them"
```

---

## Self-Review

**Spec coverage.** §A.1 → Tasks 1-2. §A.2 → Task 3. §A.3 → Task 2's pin. §A.4 → Task 4. §B.1 → Task 5. §B.2 bar 1 → Task 6, bar 2 → Task 7, bar 3 → Task 8. §B.5 → Task 9. §B.3 (card divider) → **deliberately absent**: the spec forbids implementing it from unverified numbers, and the Figma read is rate-limited. It needs its own task once `0:212` can be read.

**Type consistency.** Token names are fixed in Task 5's Interfaces block and used identically in Tasks 6-8 (`--topbar-control`, `--topbar-active`, `--topbar-border`, `--topbar-foreground`, `--topbar-muted`, `--rail*`). `stripComments` is defined in Task 1 and re-declared, not imported, in Task 2's new file.

**Known follow-ups, not silently dropped:**
1. The card-header divider (§B.3) — blocked on the Figma rate limit.
2. The comparison **series** and the two-series legend — deferred by the spec; only the control ships.
3. `scripts/geometry-check.mjs` still cites the old Figma nodes; Task 9 Step 2 updates its numbers.
