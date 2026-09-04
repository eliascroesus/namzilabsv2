# Blue Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the console from the cyan one-surface theme to the 4 September 2026 Figma: blue brand, three dark surfaces, 8px corners, the full-width top bar, the re-dressed hover rail, 28px tile numerals, and the matching light theme, with the brand kit, DESIGN.md and /design rewritten to match.

**Architecture:** Every colour is decided once in `src/app/globals.css` (roles in `:root` and `.dark`, ramps in `@theme`) and reaches components as utilities through the bridge; primitives in `src/components/ui` carry shape and size; the shell (`app-frame`, `top-bar`, `sidebar`) carries layout; tiles and charts consume tokens by name. Tasks run in that order because each layer consumes the names the previous one produces.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme`, `@custom-variant dark`), cva primitives (shadcn-derived), vitest + PGlite, `scripts/check-ui.ts`.

**Spec:** `docs/superpowers/specs/2026-09-04-retheme-blue-design.md` (binding; read it first — every task argues from it). Reader maps with file:line facts: `.superpowers/sdd/2026-09-04-retheme-blue/codebase-map-full.md`.

## Global Constraints

- Colours live only in `src/app/globals.css`; no hex literal in any `.tsx` (`scripts/check-ui.ts` fails the build on one). New roles: `--chrome`, `--panel`, `--avatar`, `--faint`, `--freshness-dot`, `--freshness-halo`; every role is bridged to a utility (`bg-chrome`, `bg-panel`, `bg-avatar`, `text-faint`, `bg-freshness-dot`, `bg-freshness-halo`).
- Brand ramp (spec table): 400 `#3D9BFF` dark stroke, 500 `#007BFF` the brand, 600 `#0070E8` THE FILL under white ink, 700 `#0069D9` pressed, 800 `#0062CC` light stroke. `--primary-foreground` is `#FFFFFF` in both themes.
- Dark surfaces: page `#0F1011`, chrome and cards `#111111`, panel `#181818`, control `#202020`, secondary `#333333`, avatar `#3A3A3A`, hairline `#343434`, rule `#4A4A4A`, faint `#6E6E6E`, muted `#858585`, text `#FFFFFF`. Light: page and panel `#F7F8F9`, chrome and cards `#FFFFFF`, hairline `#E1E1E1`, input outline `#E4E4E4`, control `#F4F4F4`, muted `#6B6B6B`, faint `#8E8E8E`, text `#000000`, heading `#313131`.
- Shape: `rounded-control` (8px) on everything pressable, typeable, tabs, nav rows and the period switch; cards 10px; circles only for avatars, badges, the freshness dot and the active-count numeral. `--radius-frame` = 8px. Card shadow `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 / .10)`.
- Type: body 15/22, captions 13, page title 26/600 unchanged; tile numeral 28px/40px Inter 600 (`.stat-numeral`); `.wordmark` Inter 900 24px/22px, the only weight above 600, allow-listed in check-ui for that class alone. No Poppins.
- Layout: 60px full-width top bar above [rail | panel]; the rail stays a hover rail (56px rest, 260px expanded, pin cookie and REVEAL unchanged); the panel has an 8px top-left corner; `#topbar-slot` and `#topbar-status` portals stay.
- Every fractional Figma pixel is rounded to a whole pixel.
- OFF-LIMITS: `src/components/flow/*`, `--canvas-*`, `GROUP_ACCENT` (node-accent.ts).
- Tests that pin the old design are UPDATED to pin the new rule (console-theme, page-width, chrome-band, design-swatches, vendored-primitives), never deleted or skipped.
- Per-task gate: `pnpm typecheck && pnpm vitest run <task test files> && pnpm check:ui`. Branch gate (last task): full `pnpm vitest run --maxWorkers=2`, `pnpm build`, `pnpm check:orphans`, `pnpm check:ui`, then a screenshot sweep of every authenticated route in both themes.
- Commit subjects are narrative sentences; every commit body ends with the trailer line exactly: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Re-theme the brand ramp from cyan to the Figma's blue

**Files**
- Modify: `src/app/globals.css`
- Modify: `src/app/design/page.tsx`
- Test: `tests/console-theme.test.ts`

**Interfaces**
- Consumes: `--color-brand-{50..900}` (the `@theme` ramp), `--primary` / `--marker` / `--brand-soft` / `--brand-soft-line` / `--primary-foreground` (role vars in `:root` and `.dark`).
- Produces: the same token **names**, new **values** — `--color-brand-600` becomes `#0070e8` (was `#00c0e8`), the full ramp is re-cut around it, `--primary-foreground` becomes a literal `#ffffff` in both themes (was near-black). No new tokens, no renames.

#### Step 1 — write the failing test

Split the combined "fills with #00c0e8 and grounds on #1b191a" test in `tests/console-theme.test.ts` into two, and update only the brand half — the ground assertion is left pointing at today's value because the neutral ramp isn't touched until the next task.

Replace:
```ts
  it("fills with #00c0e8 and grounds on #1b191a", () => {
    // The blue is the FILL step, because it was supplied as the shape of a
    // button — `--primary` reads `brand-600` and nothing else may be the
    // primary. The ground is `neutral-950`, which every surface is cut from.
    expect(token("color-brand-600")).toBe("#00c0e8");
    expect(token("color-neutral-950")).toBe("#1b191a");
    expect(token("primary")).toBe("var(--color-brand-600)");
  });
```
with:
```ts
  it("fills with #0070e8", () => {
    // The blue is the FILL step, because it was supplied as the shape of a
    // button — `--primary` reads `brand-600` and nothing else may be the
    // primary. #0070E8, not the Figma's own #007BFF: that value measures
    // 3.98:1 white-on-fill, under the 4.5 a 15px label owes; one step deeper
    // is indistinguishable beside it and clears the bar.
    expect(token("color-brand-600")).toBe("#0070e8");
    expect(token("primary")).toBe("var(--color-brand-600)");
  });

  it("grounds on #1b191a", () => {
    // The ground every surface is cut from. Untouched by this task — the
    // three-surface recut is a separate change.
    expect(token("color-neutral-950")).toBe("#1b191a");
  });
```

#### Step 2 — run it, confirm it fails

```bash
pnpm vitest run tests/console-theme.test.ts
```
Expected: the new `"fills with #0070e8"` test fails (`color-brand-600` is still `#00c0e8`); `"grounds on #1b191a"` still passes (untouched).

#### Step 3 — implement

In `src/app/globals.css`, replace the brand thesis comment (the block starting `/* --- Brand: the green...`):
```css
  /* --- Brand: the green, and why it no longer needs a rule to govern it ----
   * ONE COLOUR, BOTH JOBS.
   *
   * The kit ran "YELLOW FILLS, VIOLET DRAWS" for exactly one reason, and it is
   * worth writing down because the reason is now gone rather than forgotten.
   * #eecf00 measures 1.55:1 as a stroke on white and 11.24:1 as a fill under
   * near-black ink. That is not a dim line and a bright box, it is an ABSENT
   * line and a superb box — so the brand could only ever safely do one of the
   * two jobs, a second colour had to do the other, and `check-ui.ts` needed a
   * rule (`yellow-as-stroke`) to keep them from swapping places.
   *
   * On #1b191a the blue measures:
   *
   *                                as a STROKE / TEXT    as a FILL under #1b191a
   *   on the ground   #1b191a            9.20:1                    —
   *   on a card       #272426            8.49:1                    —
   *   #00c0e8 fill                         —                     8.08:1
   *
   * Both columns clear their bar with room, so the split has nothing left to
   * prevent. `--primary` fills, `--marker` draws, and they are two steps of one
   * ramp rather than two colours holding each other's job open. The gate rule
   * retires with the token it policed.
   *
   * HOVER WALKS UP, NOT DOWN. On a light ground the brand darkened under the
   * pointer, because brightening a yellow moves it toward the white behind it
   * and the label's contrast falls at the moment of the press. On near-black
   * the argument inverts with the surface: raised means lighter, so hover is
   * `500` and the press is `700`.
   */
  /* THE RAMP IS CYAN NOW, ANCHORED ON THE FILL RATHER THAN THE MIDDLE.
     #00c0e8 is the value the design supplies, and it is supplied as the shape
     of a BUTTON — "New flow", "Refresh all", the lit period pill — so it is
     `600`, the step `--primary` reads, and the rest of the ladder is cut
     around it rather than the other way about. The green it replaces was
     anchored the same way and every ratio below was re-measured, not carried
     over: the ground moved four counts lighter at the same time (see the
     neutral ramp), so every number in the old table was stale by construction. */
  --color-brand-50: #e0f7fd;
  --color-brand-100: #b5ecfa;
  --color-brand-200: #7fdff6;
  --color-brand-300: #45d2f2;
  --color-brand-400: #1ac9ed;
  --color-brand-500: #00cdf5; /* THE STROKE — 9.20:1 on the ground, 8.49:1 on a card */
  --color-brand-600: #00c0e8; /* THE FILL — 8.08:1 under #1b191a ink */
  --color-brand-700: #00a6c9; /* pressed */
  --color-brand-800: #008ba8;
  --color-brand-900: #00647a; /* THE LIGHT THEME'S STROKE — 6.77:1 on white */
```
with:
```css
  /* --- Brand: blue, and why one ramp does both jobs -----------------------
   * ONE COLOUR, THREE JOBS, ACROSS TWO RETHEMES.
   *
   * The kit ran "YELLOW FILLS, VIOLET DRAWS" for exactly one reason, and it is
   * worth keeping on the record because the reason is gone rather than
   * forgotten. #eecf00 measured 1.55:1 as a stroke on white and 11.24:1 as a
   * fill under near-black ink — an ABSENT line and a superb box, so the brand
   * could only ever safely do one of the two jobs and `check-ui.ts` needed a
   * rule (`yellow-as-stroke`) to keep them from swapping places.
   *
   * The 2 September cyan re-theme retired that rule once the brand moved onto
   * a hue that cleared its bar both ways. The 4 September Figma replaces the
   * cyan itself with #007BFF — a full re-cut, not a hex swap, because the
   * ground it is measured against moves too (three surfaces from the next
   * task on: #0F1011, #111111, #181818, in place of one #1B191A).
   *
   * `--primary` fills, `--marker` draws, and they are two steps of one ramp
   * rather than two colours holding each other's job open.
   *
   * HOVER WALKS UP, NOT DOWN, on dark. On a light ground the brand darkened
   * under the pointer, because brightening a colour moves it toward the white
   * behind it and the label's contrast falls at the moment of the press. On
   * near-black the argument inverts with the surface: raised means lighter, so
   * hover is `500` and the press is `700`.
   */
  /* THE 4 SEPTEMBER FIGMA SUPPLIES EVERY STEP. #007BFF is named as THE BRAND,
     but it is not the FILL: measured white-on-fill it is 3.98:1, under the 4.5
     a 15px label owes. `--primary` reads one step deeper, `600` (#0070E8,
     4.68:1 white-on-fill) — indistinguishable beside the named value, and it
     clears the bar the Figma's own choice does not. #007BFF keeps its place at
     `500`: the hover of the fill, the workspace-initial tint, decorative dots
     and the chart's default series. */
  --color-brand-50: #e6f2ff;
  --color-brand-100: #cce5ff;
  --color-brand-200: #99cbff;
  --color-brand-300: #66b2ff; /* 8.51:1 on #0F1011 */
  --color-brand-400: #3d9bff; /* THE DARK STROKE (`--marker` in `.dark`) — 6.65:1 on #0F1011, 6.59:1 on #111111, 6.20:1 on #181818 */
  --color-brand-500: #007bff; /* THE BRAND — hover of the fill, the workspace-initial tint, decorative dots, the chart's default series. 4.79:1 as a stroke on #0F1011 */
  --color-brand-600: #0070e8; /* THE FILL (`--primary`, both themes) under WHITE ink — 4.68:1 */
  --color-brand-700: #0069d9; /* pressed — 5.22:1 under white */
  --color-brand-800: #0062cc; /* THE LIGHT STROKE (`--marker` in `:root`) — 5.80:1 on white */
  --color-brand-900: #0056b3; /* reserved — the light theme's hover-of-a-stroke, 7.04:1 on white */
```

In the `.dark` block, replace:
```css
  /* ---- Brand ------------------------------------------------------------- */
  /* THE FILL. Blue under near-black ink at 8.08:1 — and the ink is a CONSTANT
     rather than `--foreground`, because a primary button is one object and the
     thing written on it does not get to be #e8e6e7 on #00c0e8 (1.74:1). */
  --primary: var(--color-brand-600);
  --primary-foreground: var(--color-neutral-950);

  /* THE STROKE. Every line, ring and coloured glyph: the focus ring, links, the
     active tab's rule, the active rail chip's glyph, a selected edge. 9.20:1 on
     the ground and 8.49:1 on a card, so unlike the violet it replaces it needs
     no second step to carry text. */
  --marker: var(--color-brand-500);
  /* The brand as a WASH — the "Free" and "Developer" pills, a selected row, a
     soft banner. Alpha rather than a mixed step so it sits correctly on the
     card AND on the ground without a second token. */
  --brand-soft: rgb(0 192 232 / 0.1);
  --brand-soft-line: rgb(0 192 232 / 0.2);
```
with:
```css
  /* ---- Brand ------------------------------------------------------------- */
  /* THE FILL. #0070E8 under WHITE ink at 4.68:1 — white rather than
     `--foreground`, because a primary button is one object and the ink on it
     does not change with the theme. It is white in `:root` too now, where the
     old cyan needed near-black ink in both. */
  --primary: var(--color-brand-600);
  --primary-foreground: #ffffff;

  /* THE STROKE. Every line, ring and coloured glyph: the focus ring, links,
     the active tab's rule, a selected edge. 6.65:1 on the ground, 6.59:1 on
     the chrome, 6.20:1 on the panel — one step LIGHTER than the fill (`400`,
     not `500`), because the fill's own step reads as a stroke at only 4.79:1
     and a 1px ring owes more room than a button's ink does. */
  --marker: var(--color-brand-400);
  /* The brand as a WASH — the "Free" and "Developer" pills, a selected row, a
     soft banner. Alpha rather than a mixed step so it sits correctly on any of
     the dark surfaces without a second token. */
  --brand-soft: rgb(0 123 255 / 0.1);
  --brand-soft-line: rgb(0 123 255 / 0.25);
```

In the `:root` block, replace:
```css
  /* ---- Brand ------------------------------------------------------------- */
  --primary: var(--color-brand-600); /* the fill does not change with the theme */
  --primary-foreground: var(--color-neutral-950);
  --marker: var(--color-brand-900); /* 5.91:1 on white, where brand-500 is 1.9:1 */
  --brand-soft: rgb(0 192 232 / 0.1);
  /* 30%, not the dark theme's 20%: the same alpha over white is a third of the
     edge it is over #272426, and a wash with no ring is not a badge. */
  --brand-soft-line: rgb(0 192 232 / 0.3);
```
with:
```css
  /* ---- Brand ------------------------------------------------------------- */
  --primary: var(--color-brand-600); /* the fill does not change with the theme */
  --primary-foreground: #ffffff;
  --marker: var(--color-brand-800); /* THE LIGHT STROKE — 5.80:1 on white */
  --brand-soft: rgb(0 123 255 / 0.1);
  /* 30%, not the dark theme's 25%: the same alpha over white is a smaller edge
     than it is over the near-black surfaces, and a wash with no ring is not a
     badge. */
  --brand-soft-line: rgb(0 123 255 / 0.3);
```

And the paragraph just above `:root` that explains the split, replace:
```css
 * THE BRAND CANNOT BE ONE VALUE, AND THAT IS THE SAME TRAP THE YELLOW FELL IN.
 * #00cdf5 measures 1.9:1 on white — invisible as a rule, a link or a glyph, in
 * exactly the way #eecf00 was. So the FILL stays `brand-600` in both themes
 * (it carries near-black ink at 8.08:1 either way, because a filled button is
 * the same object at both exposures) and the STROKE step drops to `brand-900`
 * here: 6.77:1 on white, where on the dark ground it would be 2.59:1. Two rungs of one ramp, one role
 * name each, which is the arrangement `--primary` / `--marker` was built for.
 */
```
with:
```css
 * THE BRAND CANNOT BE ONE VALUE, AND THAT IS THE SAME TRAP THE YELLOW FELL IN.
 * #007BFF measures 3.98:1 white-on-fill — under the 4.5 a 15px label owes, in
 * the same way #eecf00 was invisible as a rule. So the FILL stays `brand-600`
 * (#0070E8, 4.68:1 white-on-fill) in both themes, and the STROKE step drops to
 * `brand-800` on white — 5.80:1 — where `brand-400` (the dark theme's stroke)
 * is 6.65:1 on the ground. Two rungs of one ramp, one role name each, which is
 * the arrangement `--primary` / `--marker` was built for.
 */
```

In `src/app/design/page.tsx`, replace the `BRAND` comment and array:
```tsx
/**
 * THE BRAND RAMP IS ONE BLUE, AND IT NO LONGER NEEDS A SECOND COLOUR BESIDE
 * IT.
 *
 * This table used to be printed next to a violet one, because the two were the
 * halves of a single rule: `brand-*` was what a FILLED object is and `marker-*`
 * was what a LINE is, and the split existed because #eecf00 measures 1.55:1 as
 * a stroke on white and 11.24:1 as a fill. The brand could only ever safely do
 * one of the two jobs.
 *
 * On #1b191a the blue is 9.20:1 as a stroke and 8.08:1 as a fill under
 * near-black ink. Both clear their bar, so 500 DRAWS and 600 FILLS as two steps
 * of one ramp rather than as two colours covering for each other.
 *
 * HOVER WALKS UP, NOT DOWN, and that inverted with the surface: on a light
 * ground brightening the brand moved it toward the white behind it and the
 * label's contrast fell at the moment of the press. On near-black, raised means
 * lighter.
 */
const BRAND: Array<{ step: string; cls: string; hex: string }> = [
  { step: "50", cls: "bg-brand-50", hex: "#e0f7fd" },
  { step: "100", cls: "bg-brand-100", hex: "#b5ecfa" },
  { step: "200", cls: "bg-brand-200", hex: "#7fdff6" },
  { step: "300", cls: "bg-brand-300", hex: "#45d2f2" },
  { step: "400", cls: "bg-brand-400", hex: "#1ac9ed" },
  { step: "500", cls: "bg-brand-500", hex: "#00cdf5" },
  { step: "600", cls: "bg-brand-600", hex: "#00c0e8" },
  { step: "700", cls: "bg-brand-700", hex: "#00a6c9" },
];
```
with:
```tsx
/**
 * THE BRAND RAMP IS ONE BLUE, ACROSS THREE JOBS.
 *
 * `600` fills (`--primary`, both themes, under white ink at 4.68:1). `500` is
 * the brand itself — the Figma's own #007BFF — one step too light to carry
 * white text at 4.5:1 (3.98:1), so it never fills, but exactly right as the
 * hover of the fill, a decorative dot, a chart's default series and the
 * workspace-initial tint. `400` and `800` draw: the dark stroke and the light
 * stroke, one rung lighter than the fill on each surface, because a 1px ring
 * owes more room than a button's own ink needs.
 */
const BRAND: Array<{ step: string; cls: string; hex: string }> = [
  { step: "50", cls: "bg-brand-50", hex: "#e6f2ff" },
  { step: "100", cls: "bg-brand-100", hex: "#cce5ff" },
  { step: "200", cls: "bg-brand-200", hex: "#99cbff" },
  { step: "300", cls: "bg-brand-300", hex: "#66b2ff" },
  { step: "400", cls: "bg-brand-400", hex: "#3d9bff" },
  { step: "500", cls: "bg-brand-500", hex: "#007bff" },
  { step: "600", cls: "bg-brand-600", hex: "#0070e8" },
  { step: "700", cls: "bg-brand-700", hex: "#0069d9" },
  { step: "800", cls: "bg-brand-800", hex: "#0062cc" },
  { step: "900", cls: "bg-brand-900", hex: "#0056b3" },
];
```

#### Step 4 — run it, confirm green

```bash
pnpm vitest run tests/console-theme.test.ts tests/design-swatches.test.ts
```
Both new `console-theme.test.ts` its pass; `design-swatches.test.ts` passes because every `BRAND` row's hex now matches `--color-brand-*` in `globals.css`.

#### Step 5 — gate

```bash
pnpm typecheck && pnpm vitest run tests/console-theme.test.ts tests/design-swatches.test.ts && pnpm check:ui
```

#### Step 6 — commit

```bash
git add src/app/globals.css src/app/design/page.tsx tests/console-theme.test.ts
git commit -m "$(cat <<'EOF'
Re-theme the brand ramp from cyan to the Figma's blue

007BFF replaces the 2 September cyan across both role blocks: 600 fills
under white ink in both themes now, 400/800 draw as the dark/light stroke,
and 500 is the brand itself — one step too light to fill under white at
4.5:1, so it never does. The /design kit page and the pinned brand-constant
test move with it; the ground stays untouched until the next task.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Recut the neutral ramp for three dark surfaces, and the light roles from the Figma's light export

**Files**
- Modify: `src/app/globals.css`
- Modify: `src/app/design/page.tsx`
- Modify: `src/app/layout.tsx` (the dark `themeColor` meta literal — a hard dependency of `tests/design-swatches.test.ts`'s existing "theme-color meta matches background" assertion once `--background` in `.dark` moves; see openQuestions)
- Test: `tests/console-theme.test.ts`
- Test: `tests/design-swatches.test.ts`

**Interfaces**
- Consumes: `--color-neutral-{950,900,800,700,600,500,400,200}` (the `@theme` ramp); `--background` / `--card` / `--control` / `--secondary` / `--accent` / `--border` / `--rule` / `--muted-foreground` / `--foreground` / `--heading` (role vars, both blocks); `--canvas-bg` (frozen, read-only here).
- Produces: three new ramp steps `--color-neutral-925` / `-850` / `-450`; six new roles `--chrome` / `--panel` / `--avatar` / `--faint` / `--freshness-dot` / `--freshness-halo` declared in **both** `:root` and `.dark`; every role named above re-pointed to its new value; `SURFACE` / `INK` arrays in `design/page.tsx` re-captioned; `src/app/layout.tsx`'s dark `themeColor` literal moved to `#0f1011`.

#### Step 1 — write the failing tests

In `tests/console-theme.test.ts`, replace the ground test this task's predecessor left in place, and replace the canvas test (which currently asserts EQUALITY — the exact thing this task must now break on purpose):

Replace:
```ts
  it("grounds on #1b191a", () => {
    // The ground every surface is cut from. Untouched by this task — the
    // three-surface recut is a separate change.
    expect(token("color-neutral-950")).toBe("#1b191a");
  });

  it("keeps the canvas and the chrome on one colour", () => {
    // Not decoration: the canvas was FROZEN at #1b191a while the chrome sat
    // four counts off it, and globals.css carried a note admitting the gap.
    // The ground moving to meet it is what closed that, so if the two ever
    // diverge again the note above `--canvas-bg` is a lie.
    expect(darkToken("canvas-bg")).toBe(token("color-neutral-950"));
  });
```
with:
```ts
  it("grounds on #0f1011", () => {
    // The page ground under the blue re-theme's three-surface model.
    expect(token("color-neutral-950")).toBe("#0f1011");
  });

  it("keeps the canvas frozen even though the ground moved on without it", () => {
    // The blue re-theme moves the ground to #0F1011. `--canvas-bg` stays
    // #1b191a — the value the builder's canvas was frozen at during the
    // PREVIOUS re-theme — because the canvas is out of scope here (flow
    // builder: tidy and fix, never redesign). The two are allowed to diverge
    // again; this protects the canvas from being "fixed" to match whatever
    // the ground becomes next.
    expect(darkToken("canvas-bg")).toBe("#1b191a");
    expect(token("color-neutral-950")).not.toBe(darkToken("canvas-bg"));
  });
```

#### Step 2 — run it, confirm it fails

```bash
pnpm vitest run tests/console-theme.test.ts
```
Expected: both edited its fail — the ground is still `#1b191a` and `darkToken("canvas-bg")` still equals it (trivially, since neither value has moved yet), so the `.not.toBe` assertion fails.

#### Step 3 — implement

**3a. `src/app/globals.css` — the file-top thesis.** Replace:
```css
 * WHAT CHANGED, AND WHY: ONE SURFACE, SEPARATED BY HAIRLINES.
 *
 * The product used to be a #2e2e2e BAND — a 70px rail and a 70px top bar —
 * wrapping a #f5f5f5 page, with no rule anywhere inside the band because a
 * 40-point luminance step finds its own edge. That was a good argument and it
 * has been replaced by its opposite.
 *
 * The rail, the top bar and the page are now ONE COLOUR (#1b191a), and every
 * separation in the product is a 1px #3d393b hairline. Cards step UP to #272426
 * rather than down to white. Nothing inverts, because there is nothing to invert
 * INTO: the light theme is gone.
 *
 * The consequence worth stating up front, because it governs every recipe
 * below: THE HAIRLINE IS NOW STRUCTURAL. It is not trim. A card whose border is
 * missing is not a slightly flatter card, it is an invisible one — #272426 on
 * #1b191a is a 1.14:1 step, which is a step you can measure and not one you can
 * see. Every surface in this file draws its edge.
 *
 * THE RULE FOR COLOUR: the app is greyscale except for (a) the brand, which is
 * one green doing one job, and (b) state, which is what needs the user. A
 * console where everything is coloured can point at nothing.
```
with:
```css
 * WHAT CHANGED, AND WHY: THREE SURFACES NOW, AND THE HAIRLINE STILL DOES THE
 * SEPARATING.
 *
 * The product was a #2e2e2e BAND wrapping a #f5f5f5 page, then (2 September)
 * ONE COLOUR — rail, top bar and page all #1b191a, with every separation a 1px
 * hairline, because a single surface has no luminance step to find its own
 * edge with. The 4 September Figma reverses that again, but not back to the
 * band: it draws THREE surfaces instead of one — a page (#0F1011), a chrome
 * band carrying the top bar and the rail (#111111), and a content panel under
 * it (#181818) — each one to three counts from its neighbour.
 *
 * That is closer to the old band's shape than to the one-surface theme's, but
 * the steps are too small to see unaided: #0F1011 to #111111 is two counts in
 * one channel. THE HAIRLINE IS STILL STRUCTURAL. A card whose border is
 * missing is not a slightly flatter card, it is an invisible one, exactly as
 * it was under one surface — there are simply three near-identical grounds to
 * separate now instead of one. Cards share the chrome's step (#111111) rather
 * than stepping up from it, which is the Figma's own choice.
 *
 * THE RULE FOR COLOUR: the app is greyscale except for (a) the brand, which is
 * one blue doing one job, and (b) state, which is what needs the user. A
 * console where everything is coloured can point at nothing.
```

**3b. The retired-token list.** Replace:
```css
 *   --chrome-line, --chrome-chip, --chrome-chip-line, --chrome-badge,
 *   --chrome-badge-ink, --chrome-presence, --chrome-avatar, --chrome-add-ink,
 *   --chrome-ring-track                          nine tokens that existed only
 *       because the band did not invert with the theme and therefore could not
 *       use the roles. There is no theme to not-invert-with. Use `--border`,
 *       `--card`, `--primary`, `--muted-foreground`.
 *   --period-bg, --period-line, --period-ink     the period track was "the one
 *       control that follows the PAGE rather than the band". Same surface now.
 *       Use `--control` / `--border` / `--muted-foreground`.
 *   --tab-underline                              use `--marker`.
 *   --rail, --sidebar, --sidebar-accent          the rail is `--background`.
 *   --marker-ink                                 the split's second step. The
 *       violet needed one because 4.41:1 clears the 3:1 a rule owes and falls
 *       short of the 4.5:1 a link does. The blue is 9.20:1 on the console and
 *       6.77:1 on white, and clears both at both exposures.
```
with:
```css
 *   --chrome-line, --chrome-chip, --chrome-chip-line, --chrome-badge,
 *   --chrome-badge-ink, --chrome-presence, --chrome-avatar, --chrome-add-ink,
 *   --chrome-ring-track                          nine tokens that existed only
 *       because the band did not invert with the theme and therefore could not
 *       use the roles. There is no theme to not-invert-with. Use `--border`,
 *       `--card`, `--primary`, `--muted-foreground`. (A NEW `--chrome` role
 *       below is unrelated to this retired family beyond sharing a name — it
 *       names a SURFACE, not a component-specific line, chip or badge.)
 *   --period-bg, --period-line, --period-ink     the period track was "the one
 *       control that follows the PAGE rather than the band". Same surface now.
 *       Use `--control` / `--border` / `--muted-foreground`.
 *   --tab-underline                              use `--marker`.
 *   --rail, --sidebar, --sidebar-accent          the rail is `--chrome` now —
 *       its own surface again under the three-surface model, see the neutral
 *       ramp below.
 *   --marker-ink                                 the split's second step. The
 *       violet needed one because 4.41:1 clears the 3:1 a rule owes and falls
 *       short of the 4.5:1 a link does. The blue's dark stroke (`400`) is
 *       6.65:1 on the ground and its light stroke (`800`) is 5.80:1 on white,
 *       clearing both at both exposures.
```

**3c. The neutral ramp itself.** Replace the whole comment+values block:
```css
  /* --- The neutral ramp ----------------------------------------------------
   * TAILWIND'S `neutral-*`, REDEFINED IN PLACE — and this time it is the whole
   * interface rather than half of it.
   *
   * The kit used to run TWO grey ramps: `neutral-*` for the light app and
   * `ink-*` for "the navigation rail and any dark surface". That division made
   * sense while the product was a dark band around a light page. It does not
   * survive a product that is one surface: `ink-*` is retired, every value here
   * is cut for #1b191a, and there is one ladder from the ground to the ink.
   *
   * The ramp keeps the conventional direction — 50 is the lightest, 950 the
   * darkest — so a `neutral-800` still means what it means in every other
   * codebase. What changed is where the STEPS are: seven of the eleven now live
   * between #1b191a and #4d494b, because that is the range this interface
   * actually builds surfaces in, and the four above it are text.
   *
   * THE SURFACE HALF (950 → 500) and THE INK HALF (400 → 50) are separated on
   * purpose and never trade places. 500 is the last step you may draw a LINE in
   * and 400 the first you may set TEXT in; there is a deliberate gap between
   * them, because the value that is legible as a 1px rule and the value that is
   * legible as 12px copy are not the same value and the product had been
   * pretending they were.
   */
  /* THE GROUND MOVED, AND IT MOVED TO MEET THE CANVAS.
     #1b191a is not a new colour in this file — it is `--canvas-bg`, the value
     the builder's canvas was FROZEN at when the console went dark, with a note
     below admitting the chrome then sat "six counts off" it. The chrome is what
     moves. That resolves the split rather than deepening it, and the console
     and the canvas are finally one surface.
     The hue comes with it: #1b191a is a hair warm (R 27, B 26, G 25) where
     #1b191a was a hair cool, so the whole ladder is re-cut on that cast. Mixing
     a cool grey rule into a warm ground is the near-miss this file exists to
     stop — it reads as a smudge rather than as a line.
     Every ink ratio below was re-measured against the new ground and the new
     card, and 400/300/200 were all lifted to hold the bar they held before: a
     lighter ground costs contrast, so carrying the old values across would have
     dropped the dimmest ink to 4.22:1 on a card, under the 4.5 it must clear. */
  --color-neutral-950: #1b191a; /* THE GROUND — rail, top bar, page AND canvas */
  --color-neutral-900: #211f20; /* controls: selects, inputs, the period track */
  --color-neutral-800: #272426; /* CARDS and popovers — a 1.14:1 step, so they draw their edge */
  --color-neutral-700: #332f31; /* raised: a card's hover, a menu row, the toast */
  --color-neutral-600: #3d393b; /* THE HAIRLINE — every separation in the product */
  --color-neutral-500: #4d494b; /* the heavier rule: switch track, table divider, ring track */
  --color-neutral-400: #948d93; /* the dimmest INK — 4.75:1 on a card, 5.41:1 on the ground */
  --color-neutral-300: #b0a9ae; /* descriptions, captions — 6.68:1 on a card */
  --color-neutral-200: #e8e6e7; /* body and card titles — 12.37:1 on a card */
  --color-neutral-100: #eceaeb;
  --color-neutral-50: #fafafa;
```
with:
```css
  /* --- The neutral ramp ----------------------------------------------------
   * THREE SURFACES NOW, NOT ONE — and the ramp is re-cut to build all three.
   *
   * The 2 September re-theme argued for a single ground with hairlines doing
   * every separation, and it was right for the surface the product had then.
   * The 4 September Figma draws three: a page (#0F1011), a chrome band that
   * carries the top bar and the rail (#111111), and a content panel under it
   * (#181818). That is not a value tweak on the old thesis, it is its reversal
   * — reintroducing exactly the surface split the one-surface ramp retired —
   * and it is deliberate.
   *
   * TWO NEW STEPS LAND BETWEEN EXISTING ONES rather than displacing them,
   * because both new surfaces sit between values the ramp already had: `925`
   * is the chrome, one count lighter than the page; `850` is the control fill,
   * one count lighter than the panel. A `900` still means "recessed"; only the
   * HEX under it moved.
   *
   * THE SURFACE HALF (950 → 500) and THE INK HALF (450 → 200) are still
   * separated on purpose. `500` is the last step a LINE may be drawn in
   * (`--rule`); `450` is a caps-label-only step (`--faint`, "Main Menu" and
   * nothing that reads as a sentence); `400` is the first step body TEXT may be
   * set in (`--muted-foreground`). The Figma's own "Main Menu" grey — #4A4A4A —
   * is not text-safe at 2.13:1 on the chrome, which is exactly the gap this
   * rule exists to catch; the caption gets a lighter, tested step instead.
   */
  --color-neutral-950: #0f1011; /* THE PAGE — the ground beneath everything */
  --color-neutral-925: #111111; /* THE CHROME — top bar, rail, AND the card fill */
  --color-neutral-900: #181818; /* THE PANEL — the content area under the top bar */
  --color-neutral-850: #202020; /* THE CONTROL — fields, the search box, the active nav row */
  --color-neutral-800: #333333; /* grey buttons (`--secondary`); `--accent`'s hover step */
  --color-neutral-700: #3a3a3a; /* avatar and icon circles (`--avatar`) */
  --color-neutral-600: #343434; /* THE HAIRLINE — every separation in the product */
  --color-neutral-500: #4a4a4a; /* the heavier rule: switch track, table divider, ring track */
  --color-neutral-450: #6e6e6e; /* THE FAINT LABEL — "Main Menu" and nothing else; 3.70:1 on the chrome, never body copy */
  --color-neutral-400: #858585; /* the dimmest INK — 4.81:1 on the panel, 5.12:1 on a card */
  --color-neutral-300: #b0a9ae; /* no longer read by a role since `--muted-foreground` moved to `400`; kept for the handful of call sites that still spell it directly */
  --color-neutral-200: #ffffff; /* body, headings and card titles — the Figma sets both in white */
  --color-neutral-100: #eceaeb;
  --color-neutral-50: #fafafa;
```

**3d. `--radius-frame`.** Replace:
```css
  /* THE FRAME'S CORNER IS ZERO, AND THAT IS THE WHOLE CHROME CHANGE IN ONE
     TOKEN.
     It was 16px: the radius of the notch cut out of the band's charcoal where
     the light page met the rail below-left and the top bar above. There is no
     notch now, because there is no second material to cut into — the rail, the
     bar and the page are the same #1b191a and what separates them is a
     hairline. Rounding a corner between two identical surfaces draws a shape
     nobody can see, on a page that then has to carry the layout cost of it.
     Kept at 0 rather than deleted so `rounded-frame` stays a legal spelling for
     whatever the builder's shell decides next. */
  --radius-frame: 0px;
```
with:
```css
  /* THE FRAME'S CORNER IS BACK, BECAUSE THERE IS A SECOND MATERIAL AGAIN.
     It went to 0 when the rail, the bar and the page became one #1b191a
     surface — cutting a corner between two identical materials draws a shape
     nobody can see, and the token was kept only so `rounded-frame` stayed a
     legal spelling for whatever the shell decided next. What it decided is a
     THIRD surface: the content panel (#181818) sits under the top bar and
     beside the rail, both #111111, and the panel's top corner where it meets
     them is cut at 8px — half the old 16, because the panel is a much smaller
     luminance step off the chrome than the light page ever was off the band. */
  --radius-frame: 8px;
```

**3e. The `.dark` block.** Replace the ENTIRE `.dark { ... }` block (as read from `src/app/globals.css` lines 666-827 in this worktree) with:
```css
.dark {
  /* ---- Surface ----------------------------------------------------------- */
  --background: var(--color-neutral-950); /* #0F1011 — THE PAGE */
  --foreground: var(--color-neutral-200); /* #FFFFFF — the Figma sets body AND titles in white */
  --heading: var(--color-neutral-200); /* #FFFFFF — the same value as `--foreground` now; see the light block's note for where they diverge */

  /* THE CHROME — the top bar and the rail, one step lighter than the page.
     `--card` shares it: the Figma's cards sit on the same near-black as the
     bars around them, not on a third value of their own. */
  --chrome: var(--color-neutral-925); /* #111111 */
  --card: var(--chrome);
  --card-foreground: var(--color-neutral-200);
  --popover: var(--chrome);
  --popover-foreground: var(--color-neutral-200);

  /* THE PANEL — the content area under the top bar, one step lighter again
     than the chrome. Three surfaces, three steps: page, chrome, panel. */
  --panel: var(--color-neutral-900); /* #181818 */

  /* THE CONTROL SURFACE — one step LIGHTER than the panel it sits in, not
     darker. That inverts the old scheme's rule ("a control recesses from a
     card") and this file's own "directions are mirrored" invariant above — the
     Figma's fields, search box and active nav row measure lighter than the
     panel around them, not shadowed into it. Kept as supplied rather than
     forced back into the old shape. */
  --control: var(--color-neutral-850); /* #202020 */

  /* ---- Brand ------------------------------------------------------------- */
  /* THE FILL. #0070E8 under WHITE ink at 4.68:1 — white rather than
     `--foreground`, because a primary button is one object and the ink on it
     does not change with the theme. It is white in `:root` too now, where the
     old cyan needed near-black ink in both. */
  --primary: var(--color-brand-600);
  --primary-foreground: #ffffff;

  /* THE STROKE. Every line, ring and coloured glyph: the focus ring, links,
     the active tab's rule, a selected edge. 6.65:1 on the ground, 6.59:1 on
     the chrome, 6.20:1 on the panel — one step LIGHTER than the fill (`400`,
     not `500`), because the fill's own step reads as a stroke at only 4.79:1
     and a 1px ring owes more room than a button's ink does. */
  --marker: var(--color-brand-400);
  /* The brand as a WASH — the "Free" and "Developer" pills, a selected row, a
     soft banner. Alpha rather than a mixed step so it sits correctly on any of
     the dark surfaces without a second token. */
  --brand-soft: rgb(0 123 255 / 0.1);
  --brand-soft-line: rgb(0 123 255 / 0.25);

  /* ---- Neutral roles ----------------------------------------------------- */
  --secondary: var(--color-neutral-800); /* #333333 — grey buttons */
  --secondary-foreground: var(--color-neutral-200);

  /* AVATAR AND ICON CIRCLES — a role of its own, one step lighter than
     `--secondary`: a workspace initial or a bell icon sits on its own circle
     rather than inside a button. */
  --avatar: var(--color-neutral-700); /* #3A3A3A */

  /**
   * MUTED IS RECESSED; ACCENT IS RAISED. Two roles, two directions, and on this
   * surface they must not be the same value.
   *
   * `--muted` was `neutral-800` for one draft, which is EXACTLY `--card` — so
   * `hover:bg-muted` on a card painted the card onto itself, and six call sites
   * had an invisible hover on the only control in their row that had to say "you
   * can press me". That is the same bug the light theme had when `--muted` and
   * the page were both #f5f5f5; it survived the re-theme by being re-introduced
   * rather than by being kept.
   *
   * The three-surface recut moves both steps but keeps the shape: muted is now
   * the SAME step as `--panel` (#181818 — a skeleton's track, a table's head, a
   * disabled fill, and the content area itself) and accent is the same step as
   * `--secondary` (#333333 — every hover and every selected row in the
   * product). `--card` sits at `--chrome` (#111111) between them, so a hover
   * still reads as coming forward and a disabled fill still reads as sinking
   * back.
   */
  --muted: var(--color-neutral-900); /* #181818 */
  --muted-foreground: var(--color-neutral-400); /* #858585 — 4.81:1 on the panel, 5.12:1 on a card */

  --accent: var(--color-neutral-800); /* #333333 — the same step as `--secondary` */
  --accent-foreground: var(--color-neutral-200);

  /* THE FAINT LABEL — the one role beneath the ink floor, and it exists for a
     single job: a caps section caption ("Main Menu") that must sit quieter
     than `--muted-foreground` without being mistaken for a rule. 3.70:1 on the
     chrome. Never body copy — see the ramp's note on the gap between `450` and
     `400`. */
  --faint: var(--color-neutral-450); /* #6E6E6E */

  --destructive: var(--color-red-600);
  --destructive-foreground: var(--color-neutral-950);

  /* ---- The hairline ------------------------------------------------------
   * STILL THE STRUCTURE, ACROSS THREE SURFACES NOW INSTEAD OF ONE.
   *
   * #0F1011, #111111 and #181818 are two to three counts of near-black apart
   * at most — closer to each other than the old #1b191a/#272426 pair was, not
   * further apart. Three surfaces did not buy this file a set of steps you can
   * see without a border; it bought three steps you STILL cannot see without
   * one. `--border` draws every one of those seams, exactly as it drew the
   * one seam the one-surface theme had.
   */
  --border: var(--color-neutral-600); /* #343434 — EVERY hairline */
  --input: var(--border);
  /* The heavier rule a control owes 3:1 for — a switch track, a checkbox at
     rest, a table divider, a chart's zero line. The Figma's own "Main Menu"
     grey is this exact value and it is NOT text-safe here — 2.13:1 on the
     chrome — which is why the caption gets `--faint` (`450`) instead; a
     control's own edge may use it, a caption may not. */
  --rule: var(--color-neutral-500); /* #4A4A4A */
  /* THE RING IS A STROKE, so it is the marker's. */
  --ring: var(--marker);

  /* shadcn components that do their own `calc()` off a single base radius. */
  --radius: 0.5rem;

  /* ---- State -------------------------------------------------------------
   * Each state is a trio: the colour itself (dots, strokes), a soft wash
   * (badge/banner fill), and an ink (text ON the wash). The inks are SOLVED,
   * not picked — each is the step that lands ink-on-its-own-soft in a 5.2–5.5:1
   * band.
   *
   * SUCCESS STAYS GREEN, SEPARATE FROM THE BRAND — a DONE badge and a New-flow
   * button being one colour would put the loudest state and the loudest act in
   * one vocabulary, and that was true when the brand was cyan and is equally
   * true now that it is blue. The values are untouched by this re-theme: 9.02:1
   * on the ground, 7.93:1 on a card, and #00647a at 5.91:1 on white in light.
   *
   * STATUS IS QUIET WHEN FINE. A healthy thing carries a 6px dot; only a thing
   * that needs something wears a full pill.
   */
  --success: #00d492; /* 9.02:1 on the ground, 7.93:1 on a card */
  --success-soft: rgb(0 212 146 / 0.1);
  --success-ink: #19d99c;
  --warn: #f5a524;
  --warn-soft: rgb(245 165 36 / 0.1);
  --warn-ink: #f7b955;
  --danger: #fb2c36;
  --danger-soft: rgb(251 44 54 / 0.1);
  --danger-ink: #ff7a80;

  /* THE FRESHNESS DOT — its own token, not a re-use of `--success`. A tile's
     "healthy" dot used to borrow the state vocabulary directly; the Figma
     draws it as a distinct green with its own halo, so it gets a role of its
     own and the state trio above stays free for what actually needs the user.
     Same value in both themes — see `:root`. */
  --freshness-dot: #34c759;
  --freshness-halo: rgb(0 212 146 / 0.15);

  /* ---- The builder's canvas ----------------------------------------------
   * FROZEN, AND NOW VISIBLY SO — the gap the 2 September re-theme closed has
   * reopened from the other side.
   *
   * These values are unchanged; they are the ones the canvas was frozen at
   * when the console first went dark. The 2 September re-theme moved
   * `--color-neutral-950` to meet `--canvas-bg` at #1b191a, closing the gap by
   * moving the chrome. This re-theme moves the chrome again — to #0F1011 — and
   * the canvas does not move with it, because the canvas is out of scope here
   * (flow builder: tidy and fix, never redesign). The two are allowed to
   * diverge again; `tests/console-theme.test.ts` pins `--canvas-bg` at its own
   * frozen value now, rather than pinning it equal to the ground.
   *
   * The dot and the edge stay cool (#2e3646, #475467) against a ground that is
   * near-black in a different way again. That mismatch is inside the frozen
   * scope and is noted here rather than fixed, exactly as it was before.
   */
  --canvas-bg: #1b191a;
  --canvas-dot: #2e3646;
  --canvas-edge: #475467;

  /* The far end a group's name is mixed toward — see `groupInk` in
     node-accent.ts. Near-white, because the badge is the dark thing. */
  --group-ink-end: #f9fafb;
}
```

**3f. The `:root` block.** Replace the ENTIRE `:root { ... }` block with:
```css
:root {
  /* ---- Surface ----------------------------------------------------------- */
  --background: #f7f8f9; /* THE PAGE — off-white, so a white card reads as one */
  --foreground: #000000; /* 21:1 on a card — the Figma sets page copy in pure black */
  /* THE ONE INK THAT OUTRANKS THE BODY — a page title, the workspace name, and
     the active tab. In the dark theme it is now the SAME value as the body
     (both #FFFFFF). In light it stays a distinct step: #313131 against a pure
     #000000 body, one count LIGHTER rather than heavier — the Figma's own
     page-title and workspace-name samples measure #313131 while body copy
     samples #000000, so the direction inverts with the theme and this role is
     what carries that. */
  --heading: #313131;

  /* THE CHROME — the top bar and the rail. White, and `--card` shares it: the
     light Figma draws both on the same white, distinguished from the page
     only by the hairline — exactly as the dark theme's chrome and card share
     a step. */
  --chrome: #ffffff;
  --card: var(--chrome);
  --card-foreground: #000000;
  --popover: var(--chrome);
  --popover-foreground: #000000;

  /* THE PANEL — the content area under the top bar. Same value as the page in
     this theme: the light Figma's panel and ground are both `#F7F8F9`, so the
     top bar's white is the only surface that steps away from it. */
  --panel: var(--background);

  /* RECESSED, exactly as in dark. A field on a white card is a slot cut into
     it; white-on-white would make a row of them read as a stack of panels. */
  --control: #f4f4f4;

  /* ---- Brand ------------------------------------------------------------- */
  --primary: var(--color-brand-600); /* the fill does not change with the theme */
  --primary-foreground: #ffffff;
  --marker: var(--color-brand-800); /* THE LIGHT STROKE — 5.80:1 on white */
  --brand-soft: rgb(0 123 255 / 0.1);
  /* 30%, not the dark theme's 25%: the same alpha over white is a smaller edge
     than it is over the near-black surfaces, and a wash with no ring is not a
     badge. */
  --brand-soft-line: rgb(0 123 255 / 0.3);

  /* ---- Neutral roles ----------------------------------------------------- */
  /* Both white with a `--input` outline — the Figma's grey buttons are white
     with a hairline edge, not a filled grey. */
  --secondary: #ffffff;
  --secondary-foreground: #4a4a4a; /* icon ink on a grey/white button — 8.4:1 */

  /* No distinct value in the light Figma export — the control fill stands in
     until a dedicated one is supplied. */
  --avatar: var(--control);

  --muted: #f1f3f5;
  --muted-foreground: #6b6b6b; /* 5.33:1 on white, 5.01:1 on the page/panel */

  /* RAISED. On white, coming forward means getting DARKER — the mirror of the
     dark theme's step, not a copy of it. */
  --accent: #ebeef1;
  --accent-foreground: #000000;

  /* THE FAINT LABEL — see the role's note in `.dark`. The Figma's own caps-
     label grey (`#BABABA`) is 1.94:1 on white; `#8E8E8E` is the tested
     substitute — 3.28:1, caps label only, never body copy. */
  --faint: #8e8e8e;

  --destructive: #dc2626;
  --destructive-foreground: #ffffff;

  /* ---- The hairline ------------------------------------------------------
   * Doing less work here than it does in dark, and that asymmetry is real
   * rather than an oversight: a white card on a #f7f8f9 ground is announced by
   * its FILL as well as its edge, where the dark theme's three surfaces are
   * two to three counts apart and the border is doing most of the work.
   */
  --border: #e1e1e1;
  --input: #e4e4e4; /* the control outline — one count darker than `--border` */
  --ring: var(--marker);

  /* The heavier rule a control owes 3:1 for — a switch track, a checkbox at
     rest, a table divider, a chart's zero line. Unchanged by this re-theme:
     the Figma's light export does not name a value for it. */
  --rule: #c9ced5;

  --radius: 0.5rem;

  /* ---- State -------------------------------------------------------------
     Green, not the brand — see the dark block's note. #00734b is the step the
     old brand ramp used here and it still measures 5.91:1 on white. */
  --success: #00734b;
  --success-soft: rgb(0 212 146 / 0.12);
  --success-ink: #00603e;
  --warn: #b45309;
  --warn-soft: rgb(180 83 9 / 0.12);
  --warn-ink: #92400e;
  --danger: #b42318;
  --danger-soft: rgb(180 35 24 / 0.1);
  --danger-ink: #912018;

  /* THE FRESHNESS DOT — same value in both themes; only the surface under its
     halo changes. See the note in `.dark`. */
  --freshness-dot: #34c759;
  --freshness-halo: rgb(0 212 146 / 0.15);

  /* ---- The builder's canvas ---------------------------------------------- */
  --canvas-bg: #f5f5f5;
  --canvas-dot: #d6d6d6;
  --canvas-edge: #98a2b3;

  --group-ink-end: #0c111d;
}
```

**3g. `src/app/design/page.tsx` — `SURFACE` and `INK`.** Replace:
```tsx
/**
 * THE SURFACE HALF of the neutral ramp — the five steps the interface is built
 * out of, and they are five because the product has five surfaces and not
 * because five is a nice number.
 *
 * 950 is the GROUND, and the rail, the top bar and the page are all of it: one
 * colour, with a 1px 600 hairline doing every separation in the product. 800 is
 * a CARD, which is a 1.14:1 step off the ground — a step you can measure and
 * not one you can see, which is why a card without its border is an invisible
 * card rather than a flat one. 900 is a CONTROL, one step DOWN from a card, so
 * a select reads as a recessed slot rather than a raised chip. 700 is RAISED —
 * a hover, a menu row, the toast. 500 is the heavier rule a checkbox or a
 * switch track owes.
 */
const SURFACE: Array<{ step: string; cls: string; hex: string }> = [
  { step: "950", cls: "bg-neutral-950", hex: "#1b191a" },
  { step: "900", cls: "bg-neutral-900", hex: "#211f20" },
  { step: "800", cls: "bg-neutral-800", hex: "#272426" },
  { step: "700", cls: "bg-neutral-700", hex: "#332f31" },
  { step: "600", cls: "bg-neutral-600", hex: "#3d393b" },
  { step: "500", cls: "bg-neutral-500", hex: "#4d494b" },
];
/**
 * THE INK HALF — four values, and the count is the point.
 *
 * The reference this interface is drawn from ships SEVEN greys for text:
 * #ffffff, #e8e6e7, #e5e7eb, #a1a1a1, #b0a9ae, #99a1af and #6a7282. Three of
 * those are within three counts of each other. That is the same failure the
 * type scale was closed to prevent — twelve names over nine sizes — arriving in
 * the colour layer, and it collapses here to one value per job.
 *
 * 400 IS NOT THE REFERENCE'S #6a7282, and this is the one measurement in the
 * kit that overrules the source outright: that value is 3.56:1 on the #272426
 * card the reference sets its own empty-state copy on, against the 4.5:1 body
 * text owes. Raised four steps in the same hue to 4.75:1.
 *
 * There is a deliberate GAP between this half and the surface half above. 500
 * is the last step a LINE may be drawn in and 400 the first that TEXT may be
 * set in; the value that reads as a 1px rule and the value that reads as 12px
 * copy are not the same value, and the product had been pretending they were.
 */
const INK: Array<{ step: string; cls: string; hex: string }> = [
  { step: "400", cls: "bg-neutral-400", hex: "#948d93" },
  { step: "300", cls: "bg-neutral-300", hex: "#b0a9ae" },
  { step: "200", cls: "bg-neutral-200", hex: "#e8e6e7" },
  { step: "100", cls: "bg-neutral-100", hex: "#eceaeb" },
  { step: "50", cls: "bg-neutral-50", hex: "#fafafa" },
];
```
with:
```tsx
/**
 * THE SURFACE HALF of the neutral ramp — eight steps now, because the
 * interface is built out of THREE grounds instead of one: `950` is the page,
 * `925` is the chrome (the top bar and the rail, and the card fill), `900` is
 * the panel under the top bar, and `850` is a control recessed into the
 * panel. `800` and `700` are raised — a hover, a menu row, an avatar circle.
 * `600` is the hairline; `500` is the heavier rule a checkbox or a switch
 * track owes.
 */
const SURFACE: Array<{ step: string; cls: string; hex: string }> = [
  { step: "950", cls: "bg-neutral-950", hex: "#0f1011" },
  { step: "925", cls: "bg-neutral-925", hex: "#111111" },
  { step: "900", cls: "bg-neutral-900", hex: "#181818" },
  { step: "850", cls: "bg-neutral-850", hex: "#202020" },
  { step: "800", cls: "bg-neutral-800", hex: "#333333" },
  { step: "700", cls: "bg-neutral-700", hex: "#3a3a3a" },
  { step: "600", cls: "bg-neutral-600", hex: "#343434" },
  { step: "500", cls: "bg-neutral-500", hex: "#4a4a4a" },
];
/**
 * THE INK HALF — three steps, and a deliberate gap before the surface half
 * above. `450` is a caps-label-only step ("Main Menu" and nothing that reads
 * as a sentence); `400` is the first step body TEXT may be set in
 * (`--muted-foreground`); `200` is body and headings both, since the Figma
 * sets both in white.
 */
const INK: Array<{ step: string; cls: string; hex: string }> = [
  { step: "450", cls: "bg-neutral-450", hex: "#6e6e6e" },
  { step: "400", cls: "bg-neutral-400", hex: "#858585" },
  { step: "200", cls: "bg-neutral-200", hex: "#ffffff" },
];
```

**3h. `src/app/layout.tsx`.** Replace:
```tsx
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#1b191a" },
  ],
```
with:
```tsx
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1011" },
  ],
```

#### Step 4 — run it, confirm green

```bash
pnpm vitest run tests/console-theme.test.ts tests/design-swatches.test.ts
```
All of `console-theme.test.ts` passes; `design-swatches.test.ts` passes including the "theme-color meta matches background" describe block (layout.tsx's dark literal now matches `.dark`'s `--background`) and "declares the same role names in both blocks" (six new roles land in both `:root` and `.dark`).

#### Step 5 — gate

```bash
pnpm typecheck && pnpm vitest run tests/console-theme.test.ts tests/design-swatches.test.ts && pnpm check:ui
```

#### Step 6 — commit

```bash
git add src/app/globals.css src/app/design/page.tsx src/app/layout.tsx tests/console-theme.test.ts tests/design-swatches.test.ts
git commit -m "$(cat <<'EOF'
Recut the neutral ramp for three dark surfaces, blue re-theme

Reverses the 2 September one-surface thesis on purpose: page (#0F1011),
chrome (#111111, the top bar and rail, and the card fill) and panel
(#181818, the content area) replace the single #1B191A ground. Adds
--chrome/--panel/--avatar/--faint/--freshness-dot/--freshness-halo to both
role blocks, re-points --muted-foreground/--foreground/--heading/--control
to their new steps, and carries the light theme over from the Figma's
light export. The canvas stays frozen at its old #1B191A and now visibly
diverges from the ground on purpose — console-theme.test.ts pins that
divergence instead of the old equality. layout.tsx's dark theme-color meta
moves with --background since nothing else can read the token at build
time.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Cut the shadow and frame radius to the Figma's values, shrink the tile numeral to 28/40 Inter, add .wordmark, and bridge every new role

**Files**
- Modify: `src/app/globals.css`
- Modify: `src/app/design/page.tsx` (the `TYPE` array's numeral caption)
- Test: `tests/design-swatches.test.ts`

**Interfaces**
- Consumes: `--shadow-card`, `--text-display-md` / `--text-display-md--line-height`, the `.stat-numeral` class, the `@theme inline` bridge block.
- Produces: `--shadow-card` as a standalone literal (no longer aliasing `--shadow-sm`); `--text-display-md` re-cut to 28px/40px; `.stat-numeral` set in Inter explicitly (`--font-inter`, not `--font-display`); a new `.wordmark` class (Inter 900, 24px/22px — the one weight above 600 in the kit); six new utilities (`bg-chrome`/`text-chrome`, `bg-panel`, `bg-avatar`, `text-faint`, `bg-freshness-dot`, `bg-freshness-halo`, etc.) compiled via the bridge; `--color-heading` fixed from the undefined `var(--title)` to `var(--heading)`.

(Note: `--radius-frame: 8px` and the neutral/brand ramp values this task's numeral and shadow depend on already landed in the two prior tasks — this task only adds the shadow, numeral, wordmark and bridge changes.)

#### Step 1 — write the failing tests

Append to the end of `tests/design-swatches.test.ts` (after the file's closing `});`):
```ts

describe("the blue re-theme's supplied shape and type constants", () => {
  it("draws the Figma's own card shadow", () => {
    const m = css.match(/--shadow-card:\s*([^;]+);/);
    expect(m?.[1].replace(/\s+/g, " ").trim()).toBe("0 1px 2px rgb(0 0 0 / 0.2), 0 0 3px rgb(0 0 0 / 0.1)");
  });

  it("shrinks the tile numeral to 28px/40px, set in Inter", () => {
    const size = css.match(/--text-display-md:\s*([0-9.]+)rem;/)?.[1];
    const lh = css.match(/--text-display-md--line-height:\s*([0-9.]+)rem;/)?.[1];
    expect(size, "--text-display-md is not a rem literal").toBeTruthy();
    expect(Number(size) * 16).toBe(28);
    expect(Number(lh) * 16).toBe(40);
    const numeral = css.match(/\.stat-numeral\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(numeral, "the .stat-numeral rule is missing").toBeTruthy();
    expect(numeral).toMatch(/font-family:\s*var\(--font-inter/);
  });

  it("gives the wordmark its own class — Inter 900, the one weight above 600", () => {
    const wordmark = css.match(/\.wordmark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(wordmark, "the .wordmark rule is missing").toBeTruthy();
    expect(wordmark).toMatch(/font-weight:\s*900;/);
    expect(Number(wordmark.match(/font-size:\s*([0-9.]+)rem;/)?.[1]) * 16).toBe(24);
    expect(Number(wordmark.match(/line-height:\s*([0-9.]+)rem;/)?.[1]) * 16).toBe(22);
  });
});

describe("the bridge exposes every new role as a utility", () => {
  const bridge = css.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("finds the bridge block (a parse matching nothing would pass everything)", () => {
    expect(bridge.length, "the @theme inline parser missed the block").toBeGreaterThan(200);
  });

  for (const role of ["chrome", "panel", "avatar", "faint", "freshness-dot", "freshness-halo"]) {
    it(`--color-${role} is bridged to a utility`, () => {
      expect(bridge).toMatch(new RegExp(`--color-${role}:\\s*var\\(--${role}\\);`));
    });
  }

  it("bridges --color-heading to --heading, not the undefined --title", () => {
    // Found while adding the six roles above: this line read `var(--title)`,
    // a property nowhere else in the file defines, so `text-heading` has been
    // compiling to nothing since it was written.
    expect(bridge).toMatch(/--color-heading:\s*var\(--heading\);/);
  });
});
```

Also replace the `TYPE` array's numeral row:
```tsx
  { token: "text-display-md", cls: "stat-numeral text-display-md", px: "36px", use: "Headline numbers, via formatMetricValue — the ledger numeral", sample: "1,204" },
```
with:
```tsx
  { token: "text-display-md", cls: "stat-numeral text-display-md", px: "28px", use: "Headline numbers, via formatMetricValue — the ledger numeral, set in Inter", sample: "1,204" },
```
(this edit belongs to the same commit as the test above, since `tests/design-swatches.test.ts`'s existing "type captions match the scale" describe block will fail against the OLD `36px` caption once `--text-display-md` moves in Step 3 — doing it now keeps the red-then-green story honest for that pre-existing test too.)

#### Step 2 — run it, confirm it fails

```bash
pnpm vitest run tests/design-swatches.test.ts
```
Expected failures: the three new "shape and type constants" its (shadow literal still aliases `--shadow-sm`, `--text-display-md` still 36px, no `.wordmark` rule exists); all six "bridge" its for the new roles (none exist yet); the pre-existing "text-display-md is captioned 28px" case now fails too, since `globals.css` hasn't moved yet.

#### Step 3 — implement

**3a. Shadow.** In `src/app/globals.css`, replace:
```css
  --shadow-card: var(--shadow-sm);
  --shadow-card-hover: var(--shadow-md);
```
with:
```css
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.2), 0 0 3px rgb(0 0 0 / 0.1); /* the Figma's card shadow, both themes — no longer an alias of `--shadow-sm` */
  --shadow-card-hover: var(--shadow-md);
```

**3b. The tile numeral.** Replace:
```css
  --text-display-md: 2.25rem; /* 36px — the tile's headline number */
  --text-display-md--line-height: 2.75rem;
```
with:
```css
  --text-display-md: 1.75rem; /* 28px — the tile's headline number */
  --text-display-md--line-height: 2.5rem; /* 40px */
```

Replace the comment and rule above `.stat-numeral`:
```css
/**
 * THE LEDGER NUMERAL — the product's one signature.
 *
 * A tile's number is the entire payoff of the product: six tools disagreed,
 * and this is the answer. It carries the WHOLE separation between the chrome
 * and the content now that there is no second typeface doing half of it — 36px
 * at -0.03em against a 14px interface, which is a bigger gap than a family
 * change was ever making.
 *
 * `tabular-nums` is not decoration: these numbers refresh in place, and
 * proportional figures make a tile twitch every time a 1 becomes a 4.
 */
.stat-numeral {
  font-family: var(--font-display);
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  font-weight: 600;
}
```
with:
```css
/**
 * THE LEDGER NUMERAL — the product's one signature, and now its one named
 * exception to "no second typeface".
 *
 * The 2 September re-theme deleted the display face on the argument that a
 * numeral at 36px and -0.03em against a 15px interface already carried the
 * separation size alone could pay for. The 4 September Figma names Inter
 * specifically for this one number — the only place the export calls out a
 * face by name — so the numeral gets its own `font-family` here rather than
 * reading `--font-display` (which stays system-ui-first for every OTHER
 * heading). The size drops with it: 28px, not 36, because the old size was
 * solved for a face this element no longer uses.
 *
 * `tabular-nums` is not decoration: these numbers refresh in place, and
 * proportional figures make a tile twitch every time a 1 becomes a 4.
 */
.stat-numeral {
  font-family: var(--font-inter, "Inter"), var(--font-sans);
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  font-weight: 600;
}
```

**3c. The wordmark.** Insert between the existing `.font-display` block and the `.label-micro` block:
```css
/**
 * THE WORDMARK — "Namzilabs", and the only weight above 600 anywhere in the
 * kit.
 *
 * The Figma sets it in Inter at 900/24px/22px line — a real exception to the
 * "never 700" weight lock the rest of the type system holds, not an
 * oversight. `scripts/check-ui.ts`'s `font-bold` ban is allow-listed for this
 * class alone; nowhere else may reach for 900 or spell `font-bold`.
 */
.wordmark {
  font-family: var(--font-inter, "Inter"), var(--font-sans);
  font-size: 1.5rem; /* 24px */
  line-height: 1.375rem; /* 22px */
  font-weight: 900;
}
```

**3d. The bridge.** Replace the `THE BRIDGE.` comment:
```css
/**
 * THE BRIDGE.
 *
 * A role declared in `:root` is a custom property and nothing more — only an
 * inline style could reach it. This block is what makes each one a UTILITY, so
 * `bg-card`, `text-muted-foreground`, `border-border` and `ring-marker` all
 * COMPILE. Without it the roles above are forty variables and a rail ends up
 * with a hex in its class list.
 */
```
with:
```css
/**
 * THE BRIDGE.
 *
 * A role declared in `:root` is a custom property and nothing more — only an
 * inline style could reach it. This block is what makes each one a UTILITY, so
 * `bg-card`, `text-muted-foreground`, `border-border` and `ring-marker` all
 * COMPILE. Without it the roles above are forty variables and a rail ends up
 * with a hex in its class list.
 *
 * Six roles are new with the blue re-theme's three-surface model — `chrome`,
 * `panel`, `avatar`, `faint`, `freshness-dot`, `freshness-halo` — and each
 * needs a line here or `bg-chrome` etc. compile to nothing, silently, exactly
 * like every other role above. `--color-heading` was also found pointing at
 * `var(--title)`, a property this file never defines anywhere — a bridge
 * entry that has compiled to nothing since it was written, catchable only by
 * rendering a page whose title unexpectedly inherits the wrong ink. Fixed to
 * `var(--heading)` in the same pass that added the six.
 */
```

And replace the block itself:
```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-control: var(--control);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-marker: var(--marker);
  --color-rule: var(--rule);
  --color-heading: var(--title);
  --color-brand-soft: var(--brand-soft);
  --color-brand-soft-line: var(--brand-soft-line);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-success-ink: var(--success-ink);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);
  --color-warn-ink: var(--warn-ink);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-danger-ink: var(--danger-ink);
  --color-canvas-bg: var(--canvas-bg);
  --color-canvas-dot: var(--canvas-dot);
  --color-canvas-edge: var(--canvas-edge);
}
```
with:
```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-control: var(--control);
  --color-chrome: var(--chrome);
  --color-panel: var(--panel);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-marker: var(--marker);
  --color-rule: var(--rule);
  --color-heading: var(--heading);
  --color-brand-soft: var(--brand-soft);
  --color-brand-soft-line: var(--brand-soft-line);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-avatar: var(--avatar);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-faint: var(--faint);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-success-ink: var(--success-ink);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);
  --color-warn-ink: var(--warn-ink);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-danger-ink: var(--danger-ink);
  --color-freshness-dot: var(--freshness-dot);
  --color-freshness-halo: var(--freshness-halo);
  --color-canvas-bg: var(--canvas-bg);
  --color-canvas-dot: var(--canvas-dot);
  --color-canvas-edge: var(--canvas-edge);
}
```

#### Step 4 — run it, confirm green

```bash
pnpm vitest run tests/design-swatches.test.ts
```
All new its pass; the pre-existing "text-display-md is captioned 28px" case passes now that both the CSS token and the `TYPE` array agree.

#### Step 5 — gate

```bash
pnpm typecheck && pnpm vitest run tests/design-swatches.test.ts tests/console-theme.test.ts && pnpm check:ui
```
(Re-running `console-theme.test.ts` here too as a cheap regression check — this task does not touch it, so it should already be green from the prior task.)

#### Step 6 — commit

```bash
git add src/app/globals.css src/app/design/page.tsx tests/design-swatches.test.ts
git commit -m "$(cat <<'EOF'
Cut the Figma's card shadow and 8px frame radius, shrink the tile numeral
to 28/40 Inter, add .wordmark, and bridge every new role

--shadow-card becomes the Figma's own literal instead of aliasing
--shadow-sm; the tile numeral (--text-display-md, .stat-numeral) drops from
36px to 28/40 and is set in Inter explicitly, the one named exception to
the kit's system-ui-first display face. A new .wordmark class carries the
kit's one weight above 600. The bridge gains six utilities for the new
chrome/panel/avatar/faint/freshness-dot/freshness-halo roles, and
--color-heading is fixed from a stale var(--title) — a property nowhere
in the file defines — to var(--heading), a pre-existing bug found while
adding the six.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Take the pill off the button and the period groove — the shape rule's last word

**Files**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/page.tsx` (only the `PERIOD_TRACK`/`PERIOD_PILL` block, lines ~112–171 — `PageHeader` below it is a separate task)
- Test: `tests/console-theme.test.ts`

**Interfaces**
- Consumes: `--secondary`, `--secondary-foreground`, `--input` (roles defined in `src/app/globals.css` by the tokens task — by name only, never a hex literal in these `.tsx` files, per `scripts/check-ui.ts`'s hex-literal rule).
- Produces: `buttonVariants()`'s base class at `rounded-control` (was `rounded-full`); `secondary` variant reading `bg-secondary text-secondary-foreground border-input`; `PERIOD_TRACK`/`PERIOD_PILL` (unchanged export names, consumed by `src/app/dashboard/page.tsx`, `src/components/theme.tsx`, `src/components/calendar/calendar-board.tsx`) at `rounded-control`.

This is the third flip of the button-shape rule (the file's own header comment says so) and the spec (`docs/superpowers/specs/2026-09-04-retheme-blue-design.md`, "Shape" section) is recorded as the reference so a fourth flip needs a new design, not a comment.

---

#### Step 1 — write the failing test

`tests/console-theme.test.ts` currently pins the OLD rule (pills) in two places inside `describe("the console's supplied constants", ...)`. Replace both `it()` blocks (lines 76–114) with the new rule:

```ts
  it("draws every button and the period pill at the control radius — the shape rule's final word", () => {
    // THE 4 SEP 2026 FIGMA IS THE LAST WORD: 8px on every button, chip, input,
    // select, tab and the period switch, no pills anywhere in the kit. The
    // TOKEN itself must still stay a rectangle regardless of what the BASE
    // class spells, so a stray `--radius-control: 9999px` experiment (it
    // happened once) can't silently pill-ify every field, menu row and small
    // panel again.
    expect(button).toMatch(/"inline-flex shrink-0[^"]*\brounded-control\b/);
    expect(button, "the pill must not come back on the base class").not.toMatch(
      /"inline-flex shrink-0[^"]*\brounded-full\b/,
    );
    expect(page).toMatch(/PERIOD_PILL =\s*\n?\s*"[^"]*\brounded-control\b/);
    expect(page, "the period pill must not come back either").not.toMatch(
      /PERIOD_PILL =\s*\n?\s*"[^"]*\brounded-full\b/,
    );
    expect(token("radius-control")).toBe("var(--radius-md)");
    expect(token("radius-md")).toBe("0.5rem");
  });

  it("keeps the period control's groove — only its corners were asked to move, again", () => {
    /**
     * A REGRESSION TEST FOR OVER-REACH, not for a value.
     *
     * The brief was "all buttons and timeline buttons have 999 radius", the
     * FIRST time this control's shape changed. The pass that implemented it
     * also deleted the track's border, its fill and its enclosure, leaving six
     * bare labels on the page — a redesign nobody asked for, delivered under a
     * radius change. This asserts the three properties that were silently
     * dropped, so the next tidy-up of this control — including THIS one, which
     * flips the corners back from a pill to 8px — has to be deliberate about
     * losing them.
     */
    const track = page.match(/PERIOD_TRACK =\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(track, "the groove lost its border").toMatch(/\bborder-border\b/);
    expect(track, "the groove lost its fill").toMatch(/\bbg-control\b/);
    expect(track, "the groove lost its enclosure").toMatch(/\boverflow-hidden\b/);
    // And the part THIS pass changed: the groove is an 8px rectangle now, per
    // the 4 Sep 2026 Figma — not the capsule the previous pass drew.
    expect(track).toMatch(/\brounded-control\b/);
    expect(track, "the pill must not come back").not.toMatch(/\brounded-full\b/);
  });
```

(Leave the other two `it()` blocks in the `describe` — `"fills with #00c0e8 and grounds on #1b191a"` and `"keeps the canvas and the chrome on one colour"` — untouched; those pin hex values and belong to the tokens task's own edit of this same file. Expect a merge/rebase against that task's changes.)

#### Step 2 — run it, expect failure

```bash
pnpm vitest run tests/console-theme.test.ts
```
Expected failure: both new `it()` blocks fail — the first because `button.tsx` and `page.tsx` still contain `rounded-full`, not `rounded-control`; the second on its final two assertions for the same reason on `PERIOD_TRACK`.

#### Step 3 — implement: button.tsx

Replace the block from the `rounded-full` comment through the base class string (current lines 46–64):

```ts
    //
  // `rounded-full`, AND THE SHAPE RULE HAS INVERTED BACK. This has now moved
  // twice, so it is worth being exact about what decides it: the SHEET does.
  // The 8px rectangle came from a reference whose buttons, badges and selects
  // were all rounded rectangles, and a pill among them read as borrowed. The
  // sheet this interface is drawn from now pills every pressable thing —
  // "New flow", "Refresh all", "Invite members", the lit period chip, the
  // notification bell — while leaving cards at 10px and fields at 8px. So the
  // pill comes back HERE, on the button, and not on `--radius-control`: that
  // token was 9999px for one commit once and 51 files inherited it, which is
  // how every text field, menu row and small panel went capsule-shaped.
  //
  // THE ONE EXCEPTION THE PILL NEEDS IS STILL REAL: a control that WRAPS
  // cannot be a pill, because a full radius on a two-line box is half its
  // height and renders as a circle around the words. Such a call site passes
  // `rounded-control` and now genuinely wins, because `cn()` was taught the
  // kit's radius names (see lib/utils.ts) — the last time this was a pill, that
  // override was silently dropped and the page title rendered inside a circle.
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
```

with:

```ts
    //
  // `rounded-control`, AND THE SHAPE RULE IS DONE MOVING. It went rectangle,
  // then pill, then rectangle again — three sheets, three answers — and the
  // 4 Sep 2026 Figma (docs/superpowers/specs/2026-09-04-retheme-blue-design.md)
  // is recorded as the LAST word specifically so the next flip needs a new
  // design, not a comment: 8px on every button, chip, input, select, tab and
  // the period switch, circles reserved for avatars, badges and dots. The
  // capsule "New flow"/"Refresh all"/"Invite members" drew in the previous
  // sheet is gone with it.
  //
  // The token itself was never the risk — `--radius-control` was 9999px for
  // one commit once and 51 files inherited it, which is how every text field,
  // menu row and small panel went capsule-shaped, and that is why the base
  // class has always spelled its OWN radius rather than deferring to the
  // token. It still does, so a stray global pill-ification can't recur.
  //
  // THE ONE EXCEPTION IS UNCHANGED: a control that WRAPS still passes an
  // explicit `rounded-control` override, which still wins over this base
  // through `cn()` (see lib/utils.ts) — it is simply no longer overriding a
  // different shape.
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
```

Then replace the `secondary` variant (current lines 105–107):

```ts
        /** The recessed twin of `default` — a control sitting ON a card, where
         *  the card's own colour would give the button no edge to be found by. */
        secondary: "border border-border bg-control text-foreground shadow-xs hover:bg-accent active:bg-accent",
```

with:

```ts
        /**
         * THE RECESSED TWIN OF `default`, AND NOW ITS OWN TOKEN.
         *
         * It used to borrow `--control` — the surface a search field or a
         * select sits on — because `--secondary` had no consumer anywhere in
         * the app to prove it out. The 4 Sep 2026 Figma draws these buttons as
         * their own grey (#333333 dark, white-with-a-hairline light), distinct
         * from a field's own fill, so this is the button that finally spends
         * the token that was sitting there unused. `border-input` rather than
         * `border-border`: it is the SAME hairline in the dark theme (`--input`
         * aliases `--border` there) and the Figma's own lighter edge in the
         * light theme, where a white button on an off-white page has no other
         * way to be found.
         */
        secondary: "border border-input bg-secondary text-secondary-foreground shadow-xs hover:bg-accent active:bg-accent",
```

#### Step 4 — implement: page.tsx (PERIOD_TRACK / PERIOD_PILL only)

Replace the whole comment block and the two exports (current lines 112–171) with:

```ts
/**
 * THE HEADER'S TIME CONTROL — the groove, and the segments that sit in it.
 *
 * Every view answers "what span am I reading" in the same slot beside the page
 * title, and until this constant existed each one drew that answer itself: the
 * dashboard's six period links in one spelling, the calendar's month stepper in
 * another. They came out at different HEIGHTS on different SURFACES with
 * different RADII, which is exactly the drift `BOARD_GRID` is spelled here to
 * prevent one layout down — and it is the kind nobody files a bug for, because
 * each control looks fine until you switch tabs and the row moves.
 *
 * THE SEGMENTS FILL THE TRACK, AND THE TRACK IS A BUTTON'S HEIGHT.
 *
 * It was a 32px groove holding 28px segments with a 2px inset, which is the
 * classic segmented shape and the wrong one beside "Refresh all": the group
 * measured 32 but every option in it measured 28, so a row containing both had
 * two control heights in it and the one you press was the shorter.
 *
 * `h-full` on the segment and `overflow-hidden` on the track: each option is
 * the full 32, the active fill runs edge to edge, and the track's own corners
 * clip whatever sits inside it.
 *
 * 32px, DOWN FROM 40. This is the reference's control height and it is the
 * same 32 as every select, every date picker and every dense button in the
 * product — which is the point of shrinking it. At 40 it was the tallest
 * object in the page header and it sat beside a title that has just come DOWN
 * to 24px; the row read as a control with a caption rather than a page with a
 * filter.
 *
 * THE CORNERS HAVE NOW MOVED TWICE, AND THE 4 SEP 2026 FIGMA
 * (docs/superpowers/specs/2026-09-04-retheme-blue-design.md) IS THE LAST WORD.
 *
 * The first move was recorded here as a correction: a brief that said "all
 * buttons and timeline buttons have 999 radius" had been read as licence to
 * restyle the whole control, deleting the border, the fill and the enclosure
 * and leaving six bare labels floating on the page. Nobody asked for that, so
 * the groove came back as a bordered `bg-control` track with every segment a
 * full capsule inside it — a radius change, and only a radius change.
 *
 * The second move is this one, and it is the opposite correction for the
 * opposite reason: the groove was never asked to be a capsule AT ALL, only to
 * follow whatever the sheet said buttons were, and the sheet now says 8px,
 * everywhere, permanently. So `rounded-full` comes off the track and the
 * segment both, and `--radius-control` is what both now spell — the same
 * token the button beside them already uses. `overflow-hidden` plus `h-full`
 * still does the work of making them agree: a segment fills the track's full
 * 32px, so the first and last segment's outer corners land exactly on the
 * track's own 8px corners, and the lit segment reads as a rectangle inside a
 * rectangle rather than a shape fighting the one around it — there is no
 * smaller-radius-inside-a-bigger-clip seam to avoid any more, since track and
 * segment now share the identical radius.
 *
 * `bg-control` + `border-border`, and the three `--period-*` tokens stay
 * retired. They existed because this was "the one control that follows the
 * PAGE rather than the band" — a near-black pill group on a light page would
 * have been a second dark object competing with the chrome, so it needed its
 * own surface that inverted separately. There is one surface; a control is
 * `--control`.
 */
export const PERIOD_TRACK =
  "inline-flex h-8 items-center overflow-hidden rounded-control border border-border bg-control";

/** One control inside that groove — a period link, a month arrow, "This month". */
export const PERIOD_PILL =
  "inline-flex h-full shrink-0 items-center rounded-control px-3 text-sm font-medium transition-colors duration-(--duration-fast)";
```

#### Step 5 — run it, expect green

```bash
pnpm vitest run tests/console-theme.test.ts
```
Both rewritten tests pass; the two untouched hex-pin tests in the same file still run (they may separately fail/pass depending on whether the tokens task has landed in this working tree yet — not this task's concern).

#### Step 6 — gate

```bash
pnpm typecheck && pnpm vitest run tests/console-theme.test.ts tests/cn-merge.test.ts tests/calendar-view.test.ts && pnpm check:ui
```
(`cn-merge.test.ts` and `calendar-view.test.ts` are run alongside because they import `buttonVariants`/reference the period groove and must not regress.)

#### Step 7 — commit

```bash
git add src/components/ui/button.tsx src/components/ui/page.tsx tests/console-theme.test.ts
git commit -m "$(cat <<'EOF'
Take the pill off the button and the period groove

The 4 Sep 2026 Figma settles the shape rule for good: 8px rectangles on
every button and the period switch, no pills anywhere in the kit. Also
gives the secondary button its own --secondary/--input pair instead of
borrowing the field's --control surface.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Centre the page title between the tab strip and the actions

**Files**
- Modify: `src/components/ui/page.tsx` (only `PageHeader`/`PageHeaderProps`, current lines ~173–313 — the `PERIOD_TRACK`/`PERIOD_PILL` block above it belongs to the previous task and is untouched here)
- Test: `tests/page-header.test.ts` (new)

**Interfaces**
- Produces: `PageHeaderProps.tabs?: React.ReactNode` (new, optional). Every existing call site (17 per the codebase map: settings, connectors, flows, etc.) omits it and is unaffected — the component's existing two-zone branch is left byte-identical. Only a caller that passes `tabs` gets the new three-zone centred-title row.
- Consumes: nothing new — this is a pure layout change inside one component, no new globals.css roles.
- Downstream note: the dashboard's own view tab strip is rendered separately today (`ViewStrip`, inline in `src/app/dashboard/page.tsx`, outside this area's files) and is NOT wired into the new `tabs` prop by this task — that integration belongs to whichever task owns the dashboard board header.

---

#### Step 1 — write the failing test

Create `tests/page-header.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/page";

/**
 * THE THIRD ZONE, AND THE PROMISE THE OTHER SEVENTEEN CALL SITES GET FOR
 * FREE: passing no `tabs` prop must render exactly the header this kit has
 * always drawn — title left, actions right, `justify-between`. Only a caller
 * that opts in with `tabs` gets the Figma's centred-title row.
 */
describe("PageHeader's title, with and without a tab strip beside it", () => {
  it("keeps the original two-zone layout when no tab strip is passed", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { title: "Settings", actions: createElement("button", null, "Save") }),
    );
    expect(html, "the three-zone grid must not appear uninvited").not.toMatch(/grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toMatch(/justify-between/);
  });

  it("centres the title between the tab strip and the actions when both are given", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Dashboard",
        tabs: createElement("nav", null, "Views"),
        actions: createElement("button", null, "+ Add"),
      }),
    );
    expect(html).toMatch(/grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toMatch(/text-center/);
    // Source order is tabs, then the title, then the actions — the grid places
    // them left/centre/right by DOM position, not by an `order-*` override.
    const tabsAt = html.indexOf("Views");
    const titleAt = html.indexOf("Dashboard");
    const actionsAt = html.indexOf("+ Add");
    expect(tabsAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(tabsAt);
    expect(actionsAt).toBeGreaterThan(titleAt);
  });
});
```

#### Step 2 — run it, expect failure

```bash
pnpm vitest run tests/page-header.test.ts
```
Expected failure: the second test fails — `PageHeaderProps` has no `tabs` field yet, so TypeScript/the component ignores it and no `grid-cols-[1fr_auto_1fr]` or `text-center` ever renders.

#### Step 3 — implement

Replace the `PageHeaderProps` type and the `PageHeader` function (current lines 173–313) with:

```tsx
/**
 * Title row: optional back link, one h1 recipe, optional lede, actions on
 * the right. The h1 is the ONLY page-title spelling in the product.
 */
export type PageHeaderProps = {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * THE TAB STRIP, AND THE THIRD ZONE THE FIGMA ADDS.
   *
   * Every route so far put a title on the left of this header and actions on
   * the right. The board's own page carries a THIRD object beside them — its
   * view tab strip — and the reference sets it to the LEFT of a title that
   * itself moves to the CENTRE of the row, actions staying right. Passing
   * `tabs` is what asks for that row; leave it out and the header renders
   * exactly as it always has — every one of the other seventeen call sites is
   * unaffected by this prop's existence.
   */
  tabs?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
};

export function PageHeader({ title, lede, actions, tabs, back, className }: PageHeaderProps) {
  return (
    <header className={cn("pb-6", className)}>
      {back && (
        <Link
          href={back.href}
          className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-control pl-2 pr-3 text-sm text-muted-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={14} />
          {back.label}
        </Link>
      )}
      {tabs ? (
        /**
         * THE THREE-ZONE ROW: tabs | title | actions, and the middle one is
         * an `auto` column between two EQUAL `1fr` tracks — the grid trick
         * for a title that sits in the true centre of the row no matter how
         * wide the tab strip or the actions are, rather than merely centred
         * in whatever space `justify-content: center` happens to leave over.
         *
         * `min-w-0` on the side columns is the same fix `actions` always
         * needed below: a grid track defaults to `min-width: auto`, which
         * refuses to shrink below its content's own width — the same bug
         * that once pushed a 520px period track into horizontal page scroll,
         * and a grid column inherits the identical failure mode.
         *
         * Base layout stacks (title, then tabs, then actions) below `sm`,
         * where three side-by-side zones have no room left to be zones.
         */
        <div
          className={cn(
            "flex flex-col items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-x-4",
            back && "mt-3",
          )}
        >
          <div className="flex min-w-0 items-center">{tabs}</div>
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-display-xs font-semibold tracking-[0.07px] text-heading">{title}</h1>
            {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
          </div>
          {actions && (
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 sm:justify-end">{actions}</div>
          )}
        </div>
      ) : (
        <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", back && "mt-3")}>
          <div className="flex flex-col items-start gap-2">
            <h1 className="text-display-xs font-semibold tracking-[0.07px] text-heading">{title}</h1>
            {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
          </div>
          {actions && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}
```

(The `else` branch is byte-identical to the pre-existing markup — same classes, same historical reasoning already documented earlier in this file's own comments about `min-w-0`, `items-start` and the hover-wash fix; nothing there is stale, so nothing there needs new prose.)

#### Step 4 — run it, expect green

```bash
pnpm vitest run tests/page-header.test.ts
```

#### Step 5 — gate

```bash
pnpm typecheck && pnpm vitest run tests/page-header.test.ts tests/board-controls.test.ts tests/calendar-view.test.ts && pnpm check:ui
```
(`board-controls.test.ts` and `calendar-view.test.ts` reference `PageHeader`'s wrapping/spacing behaviour and must still pass unchanged.)

#### Step 6 — commit

```bash
git add src/components/ui/page.tsx tests/page-header.test.ts
git commit -m "$(cat <<'EOF'
Give PageHeader a third zone, and centre the title in it

PageHeader now accepts an optional `tabs` slot. Passing it renders the
Figma's three-zone row — tab strip left, title centred, actions right —
while every existing call site that doesn't pass it is unaffected.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Give every avatar circle one fill, and stop the field comments lying about 9999px

**Files**
- Modify: `src/components/ui/avatar.tsx`
- Modify: `src/components/ui/input.tsx` (comment-only; no class changes)
- Modify: `src/components/ui/tabs.tsx` (comment-only; no class changes)
- Test: `tests/avatar-theme.test.ts` (new)

**Interfaces**
- Consumes: `--avatar` / the `bg-avatar` utility — a new neutral role (`#3A3A3A` per the spec's re-cut dark ramp, "avatar / icon circles") that the tokens task registers in `globals.css` (`--avatar` custom property plus `--color-avatar` so Tailwind emits `bg-avatar`). **Sequencing note**: `pnpm typecheck`, `pnpm vitest` and `pnpm check:ui` all pass on this task's own diff whether or not the tokens task has landed yet (an unregistered `bg-avatar` is a legal, if inert, class name — the same silent-no-color failure mode `check-ui.ts`'s own "retired token" rule documents) — but the avatar circles are only visually correct once the token exists. Land this after, or in the same PR as, the tokens task.
- Produces: `AvatarFallback` and `AvatarGroupCount` (from `src/components/ui/avatar.tsx`, single consumer today per the codebase map: `src/app/design/gallery.tsx`) both fill with `bg-avatar text-foreground` — previously `bg-accent text-accent-foreground` and `bg-muted text-muted-foreground` respectively, two different pairs for what the spec treats as one thing.

---

#### Step 1 — write the failing test

Create `tests/avatar-theme.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the avatar and group-count circles share one fill", () => {
  it("AvatarFallback fills with --avatar, not --accent", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, null, createElement(AvatarFallback, null, "NA")),
    );
    expect(html).toMatch(/\bbg-avatar\b/);
    expect(html, "the old accent fill must be gone").not.toMatch(/\bbg-accent\b/);
    expect(html).toMatch(/\btext-foreground\b/);
  });

  it("AvatarGroupCount fills with the same --avatar, not --muted", () => {
    const html = renderToStaticMarkup(createElement(AvatarGroup, null, createElement(AvatarGroupCount, null, "+3")));
    expect(html).toMatch(/\bbg-avatar\b/);
    expect(html, "the old muted fill must be gone").not.toMatch(/\bbg-muted\b/);
    expect(html).toMatch(/\btext-foreground\b/);
  });
});

describe("the field comments no longer claim a 9999px radius that hasn't shipped since", () => {
  it("input.tsx does not say rounded-control is 9999px", () => {
    expect(read("src/components/ui/input.tsx")).not.toMatch(/9999px/);
  });
  it("input.tsx does not claim px-4 padding it doesn't use", () => {
    expect(read("src/components/ui/input.tsx")).not.toMatch(/\bpx-4\b/);
  });
  it("tabs.tsx does not say --radius-control is 9999px", () => {
    expect(read("src/components/ui/tabs.tsx")).not.toMatch(/9999px/);
  });
});
```

#### Step 2 — run it, expect failure

```bash
pnpm vitest run tests/avatar-theme.test.ts
```
Expected failure: the two avatar tests fail (`bg-accent`/`bg-muted` still present, no `bg-avatar`); the three comment tests fail (`9999px` and `px-4` still appear in `input.tsx`'s and `tabs.tsx`'s prose).

#### Step 3 — implement: avatar.tsx

Replace the `AvatarFallback` class string (current lines 48–62, the `cn(...)` call) —

old:
```tsx
      className={cn(
        // Initials on the marker's own wash, not on grey. The fallback is what
        // most avatars in this product actually render — almost nobody uploads
        // a picture to an internal analytics tool — so treating it as the
        // degraded case left the app's people looking like missing images.
        //
        // The MARKER's tint pair rather than the brand's, and the initials are
        // the reason: they are TEXT, `accent` over `accent-foreground` is the
        // violet pair that is safe for text (6.79:1), and yellow has no such
        // pair — it carries near-black or it carries nothing, and near-black
        // initials on a yellow disc read as a button. Identity is also the one
        // job the rebrand deliberately left violet; see `--chrome-avatar`.
        "flex size-full items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground group-data-[size=sm]/avatar:text-xs",
        className
      )}
```

new:
```tsx
      className={cn(
        // Initials on `--avatar`, THE ONE FILL FOR EVERY AVATAR-SHAPED
        // CIRCLE — this fallback disc and `AvatarGroupCount`'s "+N" disc
        // share it, per the 4 Sep 2026 Figma naming both "avatar / icon
        // circles". The fallback is what most avatars in this product
        // actually render — almost nobody uploads a picture to an internal
        // analytics tool — so treating it as the degraded case left the
        // app's people looking like missing images.
        //
        // `--foreground` carries the initials: `--avatar` is a plain
        // near-black neutral fill, not a tint with a matching text pair, so
        // the ink is the kit's ordinary white body colour rather than a
        // role built for this one fill.
        "flex size-full items-center justify-center rounded-full bg-avatar text-sm font-semibold text-foreground group-data-[size=sm]/avatar:text-xs",
        className
      )}
```

Then replace `AvatarGroupCount`'s class string (current lines 111–113) —

old:
```tsx
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
```

new:
```tsx
        // Same `--avatar` fill as `AvatarFallback` — one neutral circle for
        // every avatar-shaped thing the kit draws, per the shape rule's
        // "circles only for avatars/badges" clause.
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-avatar text-sm text-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
```

#### Step 4 — implement: input.tsx (comment fixes, no class changes)

Replace the `FIELD` comment (current lines 36–42) —

old:
```ts
/**
 * THE SHEET IS PILL-FIRST, so a single-line field is fully round — the same
 * `rounded-control` (9999px) the button beside it takes. That is also why the
 * padding below is px-4 where a rounded rectangle wanted px-3: a pill's corner
 * curve reaches much further into the box, and text set tight against it reads
 * as though it is sliding out of one end.
 */
const FIELD = `${FIELD_BASE} rounded-control`;
```

new:
```ts
/**
 * A SINGLE-LINE FIELD IS AN 8px RECTANGLE, THE SAME AS THE BUTTON BESIDE IT.
 *
 * `--radius-control` was 9999px for one commit; this comment used to describe
 * that experiment rather than the token that actually ships, and it was wrong
 * the whole time this file's `rounded-control` was 8px. The 4 Sep 2026 Figma
 * (docs/superpowers/specs/2026-09-04-retheme-blue-design.md) makes it the
 * final word regardless: buttons, chips, inputs, selects, tabs and the period
 * switch are all `rounded-control`, and none of them is ever a pill again.
 * Padding is `px-3`, the same rectangle a button wants — there is no curved
 * corner here to clear.
 */
const FIELD = `${FIELD_BASE} rounded-control`;
```

Then replace the `Textarea` comment (current lines 129–138) —

old:
```ts
/**
 * THE MULTI-LINE FIELD, AND THE ONE PLACE THE PILL STOPS.
 *
 * `rounded-control` is 9999px, which on an 80px-tall box is not a pill but a
 * stadium — the corner curve arcs across the first and last line of whatever
 * was typed. The sheet draws BUTTONS, INPUTS AND MENU ROWS round, and a
 * paragraph box is none of the three, so it takes the card radius instead.
 * It keeps the field's px-4 so that a form of stacked fields still has one
 * left edge down the whole column.
 */
```

new:
```ts
/**
 * THE MULTI-LINE FIELD, AND `rounded-control` THE WHOLE WAY DOWN.
 *
 * This used to argue for the CARD radius here — reasoning that `rounded-
 * control` was a 9999px stadium on an 80px box, whose curve would arc across
 * the first and last typed line, and that a paragraph box being none of
 * BUTTON/INPUT/MENU-ROW should take 10px instead. The token was never 9999px
 * when this shipped, so the argument never matched the code below it, which
 * has always been `rounded-control` at 8px — an ordinary rectangle a
 * multi-line box has no more reason to avoid than a single-line one does. It
 * keeps the field's `px-3` so that a form of stacked fields still has one left
 * edge down the whole column.
 */
```

(`GrowingTextarea`, further down, already carries its own accurate `rounded-card` comment — leave it untouched.)

#### Step 5 — implement: tabs.tsx (comment fix, no class change)

Replace the `tabsListVariants` comment (current lines 28–40) —

old:
```ts
/**
 * THE TRACK IS A PILL, AND SO IS THE TAB INSIDE IT.
 *
 * `p-[3px]` became `p-1`. Three pixels is not a step on the 4px grid; it was
 * there so a squarish `rounded-surface` tab could sit inside a squarish
 * `rounded-surface` track without the two corners fighting. At `--radius-control`'s
 * 9999px both are lozenges and the inset is simply breathing room, so it can be
 * a real grid step — which is what puts the active pill's edge on the same
 * rhythm as everything else in the row.
 *
 * The `line` variant keeps its padding at zero: it has no track to inset from,
 * and 4px there pushed the underline 4px clear of the text it underlines.
 */
```

new:
```ts
/**
 * THE TRACK IS AN 8px RECTANGLE, AND SO IS THE TAB INSIDE IT.
 *
 * `p-[3px]` became `p-1`. Three pixels is not a step on the 4px grid; it was
 * there so a squarish `rounded-surface` tab could sit inside a squarish
 * `rounded-surface` track without the two corners fighting. `--radius-control`
 * is 8px, not the 9999px this comment used to claim, so both track and tab are
 * ordinary rounded rectangles and the inset is simply breathing room — which
 * is what puts the active tab's edge on the same rhythm as everything else in
 * the row, whether it is filled (`default`) or bare (`line`).
 *
 * The `line` variant keeps its padding at zero: it has no track to inset from,
 * and 4px there pushed the underline 4px clear of the text it underlines.
 */
```

#### Step 6 — run it, expect green

```bash
pnpm vitest run tests/avatar-theme.test.ts
```

#### Step 7 — gate

```bash
pnpm typecheck && pnpm vitest run tests/avatar-theme.test.ts && pnpm check:ui
```

#### Step 8 — commit

```bash
git add src/components/ui/avatar.tsx src/components/ui/input.tsx src/components/ui/tabs.tsx tests/avatar-theme.test.ts
git commit -m "$(cat <<'EOF'
Give every avatar circle one fill, and fix the field comments' 9999px

AvatarFallback and AvatarGroupCount both move to --avatar (one neutral
fill for every avatar-shaped circle, per the retheme spec) instead of
two unrelated tokens. Also corrects three stale comments in input.tsx
and tabs.tsx that still described a one-commit 9999px radius experiment
as though it shipped — it never did; rounded-control has been 8px this
whole time.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Let `.wordmark` be the one weight above 600, and fix the kit gate's cyan-era math

**Files**
- Modify: `scripts/check-ui.ts`

**Interfaces**
- Consumes: the literal class name `wordmark`. The exemption below is scoped to that CLASS NAME appearing on the same source line as the weight utility, not to a file path — so it needs no coordination with whichever area ends up actually rendering the "Namzilabs" wordmark (the spec puts it in the top bar's left slot, `src/components/top-bar.tsx`, which is outside this area's files). Whoever builds it just has to spell the weight alongside a class literally containing `wordmark` (e.g. `className="wordmark font-black"`, or via the `.wordmark` CSS class itself if that file also happens to reference the word `wordmark` in a nearby Tailwind class — see the rule's own comment for the exact contract).
- Produces: the `"font-bold"` rule's `find` now flags `font-bold` OR `font-black` anywhere in the app, with a single content-scoped exception (no `allow` map entry needed).

This is a script with top-level side effects (`process.exit`), so it is exercised directly rather than imported into a vitest test — the RED/GREEN loop below uses a throwaway probe file that never gets committed.

---

#### Step 1 — write the failing test (a throwaway probe, run through the real gate)

Create a scratch probe (not committed — deleted in Step 5):

```bash
cat > src/components/ui/__wordmark_probe.tsx <<'EOF'
export function Probe() {
  return <span className="font-black">Namzilabs</span>;
}

export function WordmarkProbe() {
  return <span className="wordmark font-black">Namzilabs</span>;
}
EOF
```

#### Step 2 — run it, expect failure (the gap: font-black isn't caught at all yet)

```bash
pnpm tsx scripts/check-ui.ts
```
Expected (current, RED): `PASS` — exit 0. Neither `Probe`'s bare `font-black` nor `WordmarkProbe`'s is flagged, because the rule only matches `font-bold` today. This is the wrong outcome: `Probe`'s line should fail once font-black is banned, and it doesn't yet.

#### Step 3 — implement

Replace the `"font-bold"` rule (current lines 141–152) —

old:
```ts
  {
    name: "font-bold",
    why: "the kit runs 400 / medium / semibold; 700 is a fourth weight nothing else in the product uses",
    /**
     * Added because the NEWEST surface broke it. `top-bar.tsx` — shipped in the
     * chrome rebuild — set the workspace name, the avatar initial and the
     * greeting in `font-bold`, three of them, while every other heading in the
     * app is `font-semibold`. Nothing failed, because this rule did not exist:
     * §3 of the kit said "Never `font-bold`" and only prose was enforcing it.
     */
    find: (line) => (/\bfont-bold\b/.test(line) ? "font-bold" : null),
  },
```

new:
```ts
  {
    name: "font-bold",
    why: "the kit runs 400 / 500 / 600, plus exactly one named exception; a bare font-bold or font-black anywhere else is a weight nothing else in the product uses",
    /**
     * Added because the NEWEST surface broke it. `top-bar.tsx` — shipped in the
     * chrome rebuild — set the workspace name, the avatar initial and the
     * greeting in `font-bold`, three of them, while every other heading in the
     * app is `font-semibold`. Nothing failed, because this rule did not exist:
     * §3 of the kit said "Never `font-bold`" and only prose was enforcing it.
     *
     * THE ONE EXCEPTION, ADDED WITH THE 4 SEP 2026 FIGMA: the "Namzilabs"
     * wordmark is Inter, weight 900 — the only step above 600 the kit allows.
     * `font-black` (Tailwind's 900) is banned here for the same reason
     * `font-bold` (700) already was, so nothing ELSE in the product can reach
     * for a heavy weight the same way. The exemption is scoped to the CLASS,
     * not to a file: a line is let through only when it also carries the
     * literal word `wordmark`, so nothing else sharing a file with the
     * wordmark inherits the exemption by being next to it.
     */
    find: (line) => {
      const hit = line.match(/\bfont-(?:bold|black)\b/)?.[0];
      if (!hit) return null;
      if (/\bwordmark\b/.test(line)) return null;
      return hit;
    },
  },
```

Then replace the stale cyan-era measurement inside the `"yellow-as-stroke" IS RETIRED` comment block (current lines 240–245) —

old:
```ts
   * The measurement it was built on is gone. `--primary` is #00c0e8 and
   * `--marker` is #00cdf5, both cyan, and on #1b191a the stroke step is 9.20:1
   * — past what a line owes AND past what body text owes. The split it enforced
   * has nothing left to keep apart, and the exemption it carried (top-bar.tsx's
   * ring arc, "the one surface where the brand strokes at 8.77:1") is now every
   * surface in the product.
```

new:
```ts
   * The measurement it was built on is gone twice over now: cyan (`--primary`
   * #00c0e8, `--marker` #00cdf5) gave way to the 4 Sep 2026 Figma's blue
   * (`--primary` #0070E8, `--marker` #3D9BFF in the dark theme), and the split
   * this rule enforced has nothing left to keep apart either way — on the new
   * ground (#0F1011) the stroke step measures 6.65:1, still past what a line
   * owes AND past what body text owes. The exemption it carried (top-bar.tsx's
   * ring arc, "the one surface where the brand strokes clearly") is now every
   * surface in the product.
```

Then extend the `RADIUS_OK` doc comment (current lines 99–100) —

old:
```ts
/** Radius suffixes the kit owns. Anything else — including bare `rounded`. */
const RADIUS_OK = /^(xs|sm|md|lg|xl|2xl|3xl|4xl|control|card|surface|frame|full|none)$/;
```

new:
```ts
/**
 * Radius suffixes the kit owns. Anything else — including bare `rounded`.
 *
 * `full` STAYS, EVEN THOUGH THE BUTTON BASE NO LONGER USES IT. The 4 Sep 2026
 * Figma takes the pill off every button and the period switch, but circles are
 * still the shape of an avatar, a badge dot, a freshness dot and the active-
 * count numeral — this rule was never "no pills anywhere", only "no fifth
 * radius", and a circle spelled `rounded-full` is the kit's own spelling for
 * those, not a fifth one.
 */
const RADIUS_OK = /^(xs|sm|md|lg|xl|2xl|3xl|4xl|control|card|surface|frame|full|none)$/;
```

#### Step 4 — run it, expect green (on the probe)

```bash
pnpm tsx scripts/check-ui.ts
```
Expected: `FAIL` — exactly one violation under `font-bold`, pointing at `src/components/ui/__wordmark_probe.tsx`'s `Probe` function (the bare `font-black` line). `WordmarkProbe`'s line must NOT appear in the output — it carries `wordmark` and is exempted.

#### Step 5 — delete the probe, confirm the real repo is clean

```bash
rm src/components/ui/__wordmark_probe.tsx
pnpm tsx scripts/check-ui.ts
```
Expected: `PASS` — exit 0, no violations, nothing left behind (`git status` shows only `scripts/check-ui.ts` modified).

#### Step 6 — gate

```bash
pnpm typecheck && pnpm check:ui
```
(No new vitest file — this task's verification is the script itself, exercised in Steps 2–5. `pnpm vitest run` on the full suite is unaffected since no other file changed.)

#### Step 7 — commit

```bash
git add scripts/check-ui.ts
git commit -m "$(cat <<'EOF'
Give the wordmark its one weight above 600, fix the gate's cyan math

check-ui.ts's font-bold rule now also bans font-black app-wide, with a
single content-scoped exception for a line carrying the literal class
`wordmark` — the Inter 900 the 4 Sep 2026 Figma names for "Namzilabs"
and nothing else. Also corrects the rule's own retired-cyan-era hex
comment to the new blue values, and documents why `full` still belongs
in the radius allowlist now that buttons no longer use it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Turn the frame: a full-width top bar over the rail and the panel

**Files**
- Modify: `src/components/app-frame.tsx`
- Modify: `src/components/top-bar.tsx`
- Modify: `src/components/sidebar.tsx` (type-only: two new optional props on the signature; no behaviour change yet — Task 2 wires them up)
- Test: `tests/page-width.test.ts`

**Interfaces**
- Consumes: `Sidebar({ hide?, views?, pinned?, workspace?: string, account?: { initials: string; avatarUrl?: string | null; panel: ReactNode } })`
- Produces: `AppFrame`'s new tree (`TopBar` full-width, then a row of `Sidebar` + panel); `TopBar({ account?, firstName?, metricCount? })` (no `workspace`); the `.wordmark` class in the bar; the ring's guard is now `tracked != null` alone.

#### Step 1 — write the failing test

Append a new `describe` block to `tests/page-width.test.ts` (it already has `const frame`-style file reads at the top; add one for the bar):

```ts
describe("the frame's new shape — a full-width bar over [rail | panel]", () => {
  const frame = read("src/components/app-frame.tsx");
  const bar = read("src/components/top-bar.tsx");

  it("renders the top bar before the rail, as a column rather than a row", () => {
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/className="flex h-dvh flex-col bg-background"/);
    expect(code.indexOf("<TopBar")).toBeGreaterThan(-1);
    expect(code.indexOf("<Sidebar")).toBeGreaterThan(code.indexOf("<TopBar"));
  });

  it("gives the panel its own surface and a top-left corner", () => {
    expect(frame).toMatch(/rounded-tl-frame bg-panel/);
  });

  it("hands the rail the workspace and the account it will need for its own switcher", () => {
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<Sidebar[^>]*\bworkspace=\{workspace\}/);
    expect(code).toMatch(/<Sidebar[^>]*\baccount=\{account\}/);
    expect(read("src/components/sidebar.tsx")).toMatch(/workspace\?:\s*string/);
  });

  it("moves the wordmark into the bar", () => {
    expect(bar).toMatch(/\bwordmark\b/);
    expect(bar).toMatch(/>\s*Namzilabs\s*</);
  });

  it("stops threading the workspace name into the top bar", () => {
    const props = bar.match(/export function TopBar\(\{([\s\S]*?)\}:/)?.[1] ?? "";
    expect(props).not.toMatch(/\bworkspace\b/);
  });

  it("drops the old identity dropdown along with the workspace group it opened", () => {
    expect(bar).not.toMatch(/DropdownMenu/);
    expect(bar).not.toMatch(/ChevronDown/);
  });

  it("keeps the setup ring, gated on the count alone", () => {
    const code = bar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/\{tracked != null && \(/);
    expect(code).toMatch(/aria-label=\{`\$\{tracked\} of \$\{METRIC_GOAL\} metrics tracked`\}/);
  });
});
```

#### Step 2 — run it, expect the new assertions to fail

```
pnpm vitest run tests/page-width.test.ts
```

Expected failure: the new `describe` block's `it`s fail — `app-frame.tsx` still renders `<Sidebar>` before a column containing `<TopBar>`, the panel wrapper is still `bg-background` with no `rounded-tl-frame`, `Sidebar`'s type has no `workspace`, and `top-bar.tsx` still imports `DropdownMenu`/`ChevronDown` and destructures `workspace`. (The rest of the file's existing tests keep passing — this task does not touch the `<aside>`, the rail's pin machinery, or the bar's height/hairline.)

#### Step 3 — implement

**`src/components/app-frame.tsx`** — replace the file's top doc comment (currently the `/** THE FRAME: three surfaces and two hairlines... */` block through `* SCROLLING.\n */`) with:

```tsx
/**
 * THE FRAME — a full-width bar above a row of [rail | panel].
 *
 * IT USED TO RUN THE OTHER WAY: the rail full height on the left, the bar
 * confined to the content column beside it, on the argument that a bar
 * spanning both would put the workspace switcher above the navigation that
 * switches it. That argument dissolved when the switcher moved OFF the bar
 * and into the rail's own head block (see `Sidebar`) — there is no longer
 * anything in the bar for the rail to sit "above" in that sense, and the
 * Figma this re-theme follows draws one continuous bar across the top with
 * the rail hanging beneath its left end, which is what this file now does.
 *
 * THREE SURFACES, NOT ONE. The bar and the rail are `--chrome`; the panel
 * under them is `--panel`, its own material, which is why it can carry a
 * corner (`rounded-tl-frame`) where the rail's right edge and the bar's
 * bottom edge would otherwise cross at a T instead of closing one frame.
 *
 * `surface` is still the caller's, because the pages genuinely disagree about
 * SCROLLING: list pages scroll, the builder does not.
 */
```

Then replace the render (from `const className = cn("relative min-w-0 flex-1 bg-background", surface);` through the final `</div>\n  );\n}`):

```tsx
  const className = cn("relative min-w-0 flex-1 rounded-tl-frame bg-panel", surface);

  return (
    // `h-dvh`, not `h-screen` — see the safe-area note below; unchanged.
    <div
      className="flex h-dvh flex-col bg-background"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* THE BAR SPANS EVERYTHING, ABOVE THE RAIL RATHER THAN BESIDE IT.
          It no longer receives `workspace` — the wordmark and the setup ring
          are the only things it draws on its own account now; the workspace
          switcher moved into the rail's own head block, and it needs
          `workspace`/`account` for that, not the bar. */}
      <TopBar account={account} firstName={firstName} metricCount={metricCount} />
      {/* THE ROW BELOW THE BAR — the rail, then the panel. `min-h-0` is load
          bearing: without it a flex row with a scrolling child never shrinks
          past its content's natural height, and the panel's own
          `overflow-y-auto` never gets anything to scroll AGAINST. */}
      <div className="flex min-h-0 flex-1">
        <Sidebar hide={hide} views={views} pinned={railPinned} workspace={workspace} account={account} />
        {ownsMain ? (
          <main id="main" className={className}>
            {children}
          </main>
        ) : (
          <div className={className}>{children}</div>
        )}
      </div>
    </div>
  );
}
```

**`src/components/sidebar.tsx`** — type-only change. In the `Sidebar` export's parameter type (currently):

```tsx
}: {
  hide?: string[];
  views?: BoardView[];
  pinned?: boolean;
}) {
```

replace with:

```tsx
}: {
  hide?: string[];
  views?: BoardView[];
  pinned?: boolean;
  /**
   * The active workspace's name and the signed-in account — accepted here
   * now, unused until the next commit. `AppFrame` hands both down because the
   * rail's head block is about to become the workspace switcher; splitting
   * the prop-plumbing commit from the rendering one keeps each one small
   * enough to read in one sitting.
   */
  workspace?: string;
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
}) {
```

(Do not destructure `workspace`/`account` in this task — they stay unread on the type only, which is legal TypeScript and keeps `noUnusedLocals` quiet until Task 2 uses them.)

**`src/components/top-bar.tsx`**

1. Imports — replace:
```tsx
import { Bell, ChevronDown, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
```
with:
```tsx
import { Bell, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
```

2. Replace the whole top doc comment (the `/** THE TOP BAR — who you are... */` block, lines 11–59) with:
```tsx
/**
 * THE TOP BAR — the product's name, what you're looking at, and the two
 * things you start from.
 *
 * THE MARK LIVES HERE NOW. It used to sit in the rail's head block, on the
 * argument that this bar was answering "which workspace, how much of it is
 * measured" and a second "Namzilabs" here would say the product's name
 * twice. The workspace switcher moved OUT of this bar and into the rail's
 * own head block (see `Sidebar`) — this bar no longer answers "which
 * workspace" at all, so the mark has somewhere to go that isn't a second
 * corner saying the same word.
 *
 * THE RING CAME WITH IT, ALONE. The old identity group — workspace avatar,
 * name, chevron, the dropdown that opened the account panel — is gone from
 * here entirely; that dropdown's TRIGGER is the rail's switcher row now, and
 * `account.panel` is passed straight through to `Sidebar` rather than read
 * here. The metrics ring never depended on that group for its own meaning
 * (its `aria-label` already spells out what it counts), so it keeps its own
 * guard — `tracked != null`, i.e. `metricCount` supplied — independent of
 * `account` or `workspace`, in the bar's right-hand cluster.
 *
 * 60px, `--chrome` fill, `--border` bottom rule — the bar, the rail beside
 * it and the page below the panel are three different surfaces now, so this
 * rule is the only thing marking where the bar's material stops.
 */
```

3. Remove the `identity` const entirely — delete the block that begins `const identity = (` and ends at its closing `);` (the avatar span, workspace name span, and `ChevronDown`).

4. In the `TopBar` export's signature, remove the `workspace` parameter, its doc comment, and the `initial` computation. Change:
```tsx
export function TopBar({
  account,
  workspace,
  firstName,
  metricCount,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /**
   * The active workspace's own name. A DEFAULT rather than a required prop
   * ...
   */
  workspace?: string;
```
to:
```tsx
export function TopBar({
  account,
  firstName,
  metricCount,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
```
(keep every other doc comment/param — `firstName`, `metricCount`, `unread` — unchanged.)

And remove:
```tsx
  const initial = (workspace ?? "").trim().charAt(0).toUpperCase() || "W";
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
```
replacing with just:
```tsx
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
```

5. Replace the entire `<header>...</header>` body with:
```tsx
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-border bg-chrome px-6 py-2">
      {/* ── THE MARK ─────────────────────────────────────────────────────── */}
      <Link href="/dashboard" className="wordmark shrink-0 text-foreground">
        Namzilabs
      </Link>

      {/* ── WHAT YOU ARE LOOKING AT ──────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div id="topbar-slot" className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
        <span className="truncate text-sm font-medium text-foreground peer-[:not(:empty)]:hidden">{greeting}</span>
      </div>

      {/* ── HOW MUCH IS MEASURED, THEN WHAT YOU CAN START ────────────────── */}
      <div className="flex shrink-0 items-center gap-4">
        <div id="topbar-status" className="flex shrink-0 items-center empty:hidden" />

        {tracked != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="img"
                aria-label={`${tracked} of ${METRIC_GOAL} metrics tracked`}
                className="flex shrink-0 items-center gap-2 rounded-control"
              >
                <span className="relative flex size-6 items-center justify-center">
                  <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 size-6 -rotate-90">
                    <circle cx="12" cy="12" r={RING_RADIUS} fill="none" strokeWidth="3" className="stroke-rule" />
                    {arc > 0 && (
                      <circle
                        cx="12"
                        cy="12"
                        r={RING_RADIUS}
                        fill="none"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={RING_CIRCUMFERENCE - arc}
                        className="stroke-marker"
                      />
                    )}
                  </svg>
                </span>
                <span className="text-sm font-medium text-foreground">
                  {tracked}/{METRIC_GOAL}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{ringMessage}</TooltipContent>
          </Tooltip>
        )}

        <Link
          href="/dashboard/settings"
          className={cn(buttonVariants({ variant: "secondary" }), "[&_svg]:size-4")}
          title="Invite someone to this workspace"
        >
          <UserPlus />
          <span className="hidden sm:inline">Invite members</span>
        </Link>
        <Link href="/dashboard/flows" className={cn(buttonVariants({ variant: "secondary" }), "[&_svg]:size-4")}>
          <Plus />
          <span>New flow</span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
          className="relative rounded-full bg-avatar text-foreground hover:bg-accent active:bg-accent"
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-chrome bg-primary text-2xs font-semibold leading-none text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>

        {account && (
          <Link
            href="/dashboard/profile"
            aria-label="Your profile"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "rounded-full bg-avatar text-xs font-semibold text-foreground hover:bg-accent active:bg-accent",
            )}
          >
            {account.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.avatarUrl} alt="" className="size-full rounded-full object-cover" />
            ) : (
              account.initials
            )}
          </Link>
        )}
      </div>
    </header>
```

6. Delete the trailing `SubBar`-history comment block at the end of the file only if it still reads true after this edit — it does (it documents an unrelated, already-removed second band); leave it as is.

#### Step 4 — run the tests green

```
pnpm vitest run tests/page-width.test.ts
```
All assertions — the new block and every pre-existing one (the gutter/caps pair, the rail's pinned-mode block, the board grid, the calendar day cell) — pass. The pre-existing rail-pin assertions are untouched because this task does not touch the `<aside>` element, its width ternary, or the toggle button.

#### Step 5 — gate

```
pnpm typecheck && pnpm vitest run tests/page-width.test.ts && pnpm check:ui
```
`check:ui` passes: `bg-chrome`, `bg-panel`, `bg-avatar`, `rounded-tl-frame`, `rounded-control`, `bg-brand-500` and `rounded-full` on the bell/avatar are all sanctioned spellings (the retired-token rule only bans `chrome-<word>` compounds, not bare `chrome`; `RADIUS_OK` already lists `frame`, `control` and `full`). Until the tokens area lands `--color-chrome`/`--color-panel`/`--color-avatar` in `globals.css`, these utilities compile to no rule rather than failing the build — see the area's open questions.

#### Step 6 — commit

```
git add src/components/app-frame.tsx src/components/top-bar.tsx src/components/sidebar.tsx tests/page-width.test.ts
git commit -m "$(cat <<'EOF'
Span the top bar full width, and move the wordmark into it

The bar now sits above a row of [rail | panel] instead of beside the rail,
the wordmark moves from the rail's head block into the bar's left edge, and
the old workspace-identity dropdown (avatar, name, chevron) is gone from the
bar — its trigger becomes the rail's own switcher row in the next commit.
The metrics ring keeps working, relocated into the bar's right-hand cluster
and gated on the count alone.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Move the workspace switcher into the rail, and give it Main Menu, a field-styled search, and Get Free Access

**Files**
- Modify: `src/components/sidebar.tsx`
- Test: `tests/page-width.test.ts`

**Interfaces**
- Consumes: `workspace?: string`, `account?: { initials, avatarUrl, panel }` (typed in Task 1, destructured here).
- Produces: the rail's re-dressed head block, nav caption, search field and foot row described above. `WorkspaceChip` (exported from this same file, pinned by `tests/vendored-primitives.test.ts` and `tests/console-theme.test.ts`) is untouched — the switcher's square is a new, separate element, not a `WorkspaceChip` reuse.

#### Step 1 — write the failing test

Append to `tests/page-width.test.ts`:

```ts
describe("the rail's re-dress — a workspace switcher, Main Menu, a search field, Get Free Access", () => {
  it("builds its switcher from workspace and account, not a per-workspace hue", () => {
    expect(sidebar).toMatch(/workspace\?:\s*string/);
    expect(sidebar).toMatch(/bg-brand-500\/75/);
    expect(sidebar).not.toMatch(/const PRODUCT = "Namzilabs"/);
  });

  it("leaves WorkspaceChip exactly as it was", () => {
    // Regression: the switcher must not reuse or edit the pinned component.
    const chip = sidebar.match(/export function WorkspaceChip[\s\S]*?\n}/)?.[0] ?? "";
    expect(chip).toMatch(/style=\{\{\s*background: groupBadge\(key\),\s*color: groupInk\(key\)\s*\}\}/);
  });

  it("labels the nav list in the faint role, only", () => {
    expect(sidebar).toMatch(/text-faint/);
    expect(sidebar).toMatch(/Main Menu/);
  });

  it("dresses the search row as a bordered field, not a nav row", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/aria-keyshortcuts="Meta\+K"[\s\S]{0,200}border border-border bg-control/);
  });

  it("replaces the inert bell row with Get Free Access", () => {
    expect(sidebar).toMatch(/Get Free Access/);
    expect(sidebar).not.toMatch(/Notifications/);
  });

  it("keeps both rail columns 8px apart", () => {
    // Regression for console-theme.test.ts's own pin — not this file's test,
    // but broken by exactly the kind of edit this task makes if the wrapper
    // gap classes are touched.
    const gaps = [...sidebar.matchAll(/flex[^"]*\bflex-col\b[^"]*\bgap-(\S+)/g)].map((m) => m[1]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(g).toBe("2");
  });
});
```

#### Step 2 — run it, expect failure

```
pnpm vitest run tests/page-width.test.ts
```
Expected failure: `sidebar.tsx` still declares `const PRODUCT = "Namzilabs"`, has no `bg-brand-500/75`, no `text-faint`/`Main Menu`, the search button has no `border-border bg-control`, and the foot still says "Notifications" rather than "Get Free Access". (`WorkspaceChip` and the gap-2 assertions already pass and stay green — they guard against this task's own risk of collateral damage.)

#### Step 3 — implement

All edits are inside `src/components/sidebar.tsx`.

**1. Destructure the new props and compute the initial.** Change:
```tsx
export function Sidebar({
  hide,
  views = [],
  pinned: initialPinned = false,
}: {
```
to:
```tsx
export function Sidebar({
  hide,
  views = [],
  pinned: initialPinned = false,
  workspace,
  account,
}: {
```
(the type block already carries `workspace?`/`account?` from Task 1 — leave it as is, just add the two names to the destructuring list above it).

After the existing `const pathname = usePathname();` / `const params = useSearchParams();` lines, add:
```tsx
  // The workspace's initial for the switcher's square. `.trim()` first: an
  // org named " Acme" would otherwise render a blank blue square — the same
  // guard the old top-bar identity used.
  const initial = (workspace ?? "").trim().charAt(0).toUpperCase() || "W";
```

**2. Drop the now-unused `PRODUCT` constant and its comment.** Delete:
```tsx
/** The product's name: the mark's accessible name, and the wordmark the open
 *  panel shows beside it. One literal, because it is one fact. */
const PRODUCT = "Namzilabs";
```

**3. Add imports.** Change:
```tsx
import { Bell, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plug, Plus, Radio, Search, Settings, Workflow } from "lucide-react";
```
to:
```tsx
import { Bell, ChevronDown, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plug, Plus, Radio, Search, Settings, Workflow } from "lucide-react";
```
and add, alongside the existing `import { Button } from "@/components/ui/button";` line:
```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
```

**4. Replace the top block.** Replace the comment block above it (`/* THE TOP BLOCK IS THE TOP BAR'S OWN HEIGHT... */`, running through `... two letters nobody says out loud. */`) and the block itself:
```tsx
        <div className="flex h-[60px] shrink-0 items-center px-3.5">
          <Link href="/dashboard" aria-label={`${PRODUCT} — dashboard`} className={SLOT}>
            <span className={ICON_COL}>
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full border-2 border-marker text-xs font-semibold text-marker transition-colors duration-(--duration-fast) ease-(--ease-standard) group-hover:bg-brand-soft"
              >
                NA
              </span>
            </span>
            <RailLabel className="font-semibold text-foreground">{PRODUCT}</RailLabel>
          </Link>
          {/* THE PIN, AND IT ONLY EXISTS ONCE THE PANEL IS OPEN. ... */}
        </div>
```
with:
```tsx
        {/* THE SWITCHER IS HERE NOW; THE MARK MOVED TO THE BAR.
            One wordmark in the chrome is enough, and the bar carries it full
            width now — this block used to be that mark, and it is the
            workspace switcher instead, which is where the Figma puts it: the
            head of the column you use to move between the things a
            WORKSPACE has, not the product's own name.

            THE SQUARE IS A FLAT BLUE TINT, NOT `WorkspaceChip`'s PER-WORKSPACE
            HUE. `WorkspaceChip` (below, and in `org-switcher.tsx`) draws a
            LIST, where colour is what tells several workspaces apart at a
            glance. This draws the ONE workspace you are already in, so the
            export's flat brand tint is the right answer — reusing
            `WorkspaceChip` here would answer a question ( "which of several" )
            that this row never asks.

            IT OPENS THE SAME PANEL THE BAR'S OLD IDENTITY CONTROL DID —
            `account.panel`, built once in `app-shell.tsx` and unchanged by
            this move: only the trigger relocated, not the workspace list, the
            identity band or the way out inside it.

            THE CHEVRON IS A PROMISE, so it only appears when there is a panel
            to open — the same rule the bar's own identity control followed:
            `account` present draws the dropdown, its absence draws plain
            text with no chevron pointing at nothing. */}
        <div className="flex h-[60px] shrink-0 items-center px-3.5">
          {workspace &&
            (account ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(SLOT, "hover:bg-transparent active:bg-transparent")}
                    aria-label={`${workspace} — workspace and account`}
                  >
                    <span className={ICON_COL}>
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-control bg-brand-500/75 text-xs font-semibold text-white"
                      >
                        {initial}
                      </span>
                    </span>
                    <span className={cn("flex min-w-0 flex-1 items-center gap-1", REVEAL)}>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{workspace}</span>
                      <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-64 p-0">
                  {account.panel}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className={SLOT}>
                <span className={ICON_COL}>
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-control bg-brand-500/75 text-xs font-semibold text-white"
                  >
                    {initial}
                  </span>
                </span>
                <RailLabel className="font-semibold text-foreground">{workspace}</RailLabel>
              </span>
            ))}
        </div>
```
(The pin-toggle button that used to sit as a sibling comment inside this block is unaffected — it is a separate `<Button>` further down the file, outside this div, untouched by this edit.)

**5. Restyle the search row and add the Main Menu label.** Change:
```tsx
              <Button
                variant="ghost"
                size="iconSm"
                aria-keyshortcuts="Meta+K"
                className={cn(SLOT, "hover:bg-transparent active:bg-transparent")}
              >
                <span className={ICON_COL}>
                  <RailChip tone="rest">
                    <Search />
                  </RailChip>
                </span>
                <RailLabel className="text-muted-foreground group-hover:text-foreground">Search</RailLabel>
                <span
                  aria-hidden
                  className={cn(
                    "ml-auto rounded-xs border border-border px-1.5 py-0.5 text-2xs font-medium text-muted-foreground",
                    REVEAL,
                  )}
                >
                  ⌘K
                </span>
              </Button>
              {items
```
to:
```tsx
              {/* THE FIELD LOOK IS THE WHOLE ROW'S NOW, NOT A HOVER STATE OF
                  IT — a bordered, filled box the way an actual search field
                  is drawn everywhere else in the kit, since this is a field
                  wearing a button's behaviour rather than a nav row. */}
              <Button
                variant="ghost"
                size="iconSm"
                aria-keyshortcuts="Meta+K"
                className={cn(SLOT, "border border-border bg-control hover:bg-control active:bg-control")}
              >
                <span className={ICON_COL}>
                  <Search aria-hidden className="size-[18px] text-muted-foreground" />
                </span>
                <RailLabel className="text-muted-foreground group-hover:text-foreground">Search</RailLabel>
                <span
                  aria-hidden
                  className={cn(
                    "ml-auto rounded-xs border border-border px-1.5 py-0.5 text-2xs font-medium text-muted-foreground",
                    REVEAL,
                  )}
                >
                  ⌘K
                </span>
              </Button>
              {/* THE CAPS LABEL IS BACK, ON THE FIGMA'S OWN TERMS THIS TIME.
                  It was removed because a heading reserved at 70px pushed
                  every row below it down while the pointer was still moving
                  onto one of them. `REVEAL` fades OPACITY rather than height,
                  so the label costs the same fixed slice of the column
                  whether it is visible or not — nothing moves under the
                  cursor, which is the fix, not a re-litigation of the old
                  argument (the row it labels simply always reserves the
                  space now, seen or not). */}
              <p className={cn("px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-faint", REVEAL)}>
                Main Menu
              </p>
              {items
```

**6. Replace the foot's bell control with Get Free Access.** Change:
```tsx
          <Button
            variant="ghost"
            size="iconSm"
            className={cn(SLOT, "text-foreground hover:bg-transparent active:bg-transparent")}
          >
            <span
              className={cn(
                ICON_COL,
                "relative rounded-control transition-colors duration-(--duration-fast) ease-(--ease-standard) group-hover:bg-accent",
              )}
            >
              <Bell />
              <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-primary" />
            </span>
            <RailLabel className="text-muted-foreground group-hover:text-foreground">Notifications</RailLabel>
          </Button>
```
with:
```tsx
          {/* GET FREE ACCESS — the upsell row the old bell placeholder becomes.
              That control had no store to read ("Notifications have no store
              yet" — see the removed note) and nothing behind it; this is the
              row the export actually draws at the foot of the rail, and it
              goes to the same place the dropped plan card used to: Settings,
              where billing lives. */}
          <Link
            href="/dashboard/settings"
            className={cn(SLOT, "text-muted-foreground hover:bg-accent hover:text-foreground")}
          >
            <span className={cn(ICON_COL, "relative")}>
              <Bell className="size-[18px]" />
              <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-brand-500" />
            </span>
            <RailLabel className="text-muted-foreground group-hover:text-foreground">Get Free Access</RailLabel>
          </Link>
```

#### Step 4 — run the tests green

```
pnpm vitest run tests/page-width.test.ts
```

#### Step 5 — gate

```
pnpm typecheck && pnpm vitest run tests/page-width.test.ts && pnpm check:ui
```
`check:ui`'s "hand-rolled button" rule is unaffected (no raw `<button>` introduced); the new `<DropdownMenu>`/`<Link>` usages are ordinary kit primitives. `bg-brand-500/75`, `bg-control`, `text-faint` all pass the same way Task 1's `bg-chrome`/`bg-panel` did.

#### Step 6 — commit

```
git add src/components/sidebar.tsx tests/page-width.test.ts
git commit -m "$(cat <<'EOF'
Put the workspace switcher, Main Menu and Get Free Access in the rail

The rail's head block is the workspace switcher now (a flat blue-tinted
square, the name, a chevron opening the same account panel the bar used to
trigger) rather than the product wordmark, which moved to the bar last
commit. The nav list gets its "Main Menu" caption back, faded in with the
rest of the rail's labels rather than reserved as dead space. The search
row now looks like the field it is, and the old inert Notifications control
becomes a Get Free Access link to Settings.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Mirror the new geometry in the loading skeleton and close out the shell's tests

**Files**
- Modify: `src/components/shell-skeleton.tsx`
- Test: `tests/page-width.test.ts` (new assertions), `tests/chrome-band.test.ts` and `tests/vendored-primitives.test.ts` (regression run — no edits expected)

**Interfaces**
- Produces: `ShellSkeleton`'s new tree — `<div class="flex h-dvh flex-col bg-background">` holding the bar ghost, then a `flex min-h-0 flex-1` row holding the rail ghost and the panel ghost.

#### Step 1 — write the failing test

Append to `tests/page-width.test.ts`:

```ts
describe("the skeleton mirrors the frame's new order", () => {
  it("holds the bar above the row, not beside it", () => {
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/className="flex h-dvh flex-col bg-background"/);
    // The bar's ghost precedes the rail's ghost in the DOM now.
    expect(code.indexOf("border-b border-border")).toBeLessThan(code.indexOf("border-r border-border"));
  });

  it("gives its content ghost the panel's own surface and corner", () => {
    expect(skeleton).toMatch(/rounded-tl-frame bg-panel/);
  });

  it("puts the two chrome ghosts on --chrome, matching the real bar and rail", () => {
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/h-\[60px\][^"]*bg-chrome/);
    expect(code).toMatch(/w-\[56px\][^"]*bg-chrome/);
  });
});
```

#### Step 2 — run it, expect failure

```
pnpm vitest run tests/page-width.test.ts
```
Expected failure: the skeleton still opens `flex h-dvh bg-background` (no `flex-col`), the rail ghost still precedes the bar ghost, and both chrome ghosts are still `bg-background` rather than `bg-chrome`; the content ghost has no `rounded-tl-frame bg-panel`.

#### Step 3 — implement

In `src/components/shell-skeleton.tsx`, replace the file's top doc comment (`/** THE SHELL, HELD OPEN WHILE A PAGE STREAMS. ... */`) with:
```tsx
/**
 * THE SHELL, HELD OPEN WHILE A PAGE STREAMS.
 *
 * Every authenticated route renders inside AppShell — a full-width bar,
 * then a row of the rail and the panel under it. The root `loading.tsx`
 * cannot know that, so a navigation into one of those routes used to blank
 * the whole viewport and then paint the chrome back.
 *
 * This holds the frame's new SHAPE — bar first, then the row — so only the
 * CONTENT shimmers. All three bands are deliberately empty rather than
 * skeletons of themselves: the real chrome is about to occupy them.
 *
 * `tests/page-width.test.ts` pins this against `app-frame.tsx`, `top-bar.tsx`
 * and `sidebar.tsx` class-for-class — it is the only thing that keeps a
 * hand-copied mirror honest, and it has already caught two drifts.
 */
```

Then replace the return block, from `<div className="flex h-dvh bg-background">` through the matching closing `</div>` (the whole component body, before `SkeletonRows`):
```tsx
    <div className="flex h-dvh flex-col bg-background">
      {/* THE BAR'S GHOST — 60px, `--chrome`, its bottom hairline. Empty: the
          real bar is about to occupy it, and a shimmering placeholder under
          a wordmark that never moves is noise. */}
      <div className="h-[60px] shrink-0 border-b border-border bg-chrome" />
      <div className="flex min-h-0 flex-1">
        {/* THE RAIL'S GHOST — its own width, pinned against `sidebar.tsx` by
            `tests/page-width.test.ts`. `--chrome`, matching the bar above it;
            the border is the ONLY thing marking where it ends, because the
            rail and the panel beside it are two different surfaces now. */}
        <div className="w-[56px] shrink-0 border-r border-border bg-chrome" />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* THE PANEL'S GHOST — its own surface (`--panel`) and the same
              top-left corner the real content column carries under the bar. */}
          <div className="flex-1 overflow-y-auto rounded-tl-frame bg-panel">
            {/* Not <main>: PageContainer renders the page's one main landmark. */}
            <div className={`mx-auto w-full p-6 ${width === "narrow" ? "max-w-3xl" : "max-w-6xl"}`}>
              <Skeleton className="h-8 w-48" />
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
```

#### Step 4 — run the tests green

```
pnpm vitest run tests/page-width.test.ts tests/chrome-band.test.ts tests/vendored-primitives.test.ts
```
All three files pass: `page-width.test.ts` with its new and pre-existing assertions (the width/hairline/height mirrors still read the same literals off `sidebar.tsx`/`top-bar.tsx`, which this task does not touch); `chrome-band.test.ts` unchanged (it is entirely about the flow builder's `FlowToolbar.tsx`/`ConfigPanel.tsx`, untouched by this area); `vendored-primitives.test.ts` unchanged (`WorkspaceChip`'s source was never edited across any of this area's three tasks).

#### Step 5 — gate

```
pnpm typecheck && pnpm vitest run tests/page-width.test.ts tests/chrome-band.test.ts tests/vendored-primitives.test.ts && pnpm check:ui
```

#### Step 6 — commit

```
git add src/components/shell-skeleton.tsx tests/page-width.test.ts
git commit -m "$(cat <<'EOF'
Mirror the frame's new geometry in the loading skeleton

ShellSkeleton now opens with the bar's ghost above a row of the rail's ghost
and the panel's, matching AppFrame's column-first tree from two commits ago,
with both chrome ghosts on --chrome and the content ghost on --panel with
its own top-left corner. Closes out the shell area's own test files.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Mute the tile's title again, and drop its edge on the default board

**Files**
- Modify: `src/components/metric-card.tsx`
- Create: `tests/metric-card-shape.test.ts`

**Interfaces**
- Consumes: `Card` (`@/components/ui/card`), `cn` (`@/lib/utils`) — unchanged.
- Produces: `MetricCard`'s rendered `<h3>` carries `text-muted-foreground` and no longer `font-medium`; `MetricCard`'s rendered markup no longer contains `--tile-edge` anywhere. The `--tile-edge` CSS custom property and `board-column.tsx`'s per-lane setter are untouched (kept for the canvas board, per spec).

- [ ] **Step 1 — write the failing test**

  Create `tests/metric-card-shape.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { createElement } from "react";
  import { renderToStaticMarkup } from "react-dom/server";
  import { MetricCard } from "@/components/metric-card";

  /**
   * THE BLUE RETHEME (4 Sep 2026) — the metric card's title goes back to
   * muted, body-weight, and the per-column edge strip stops painting on the
   * default board. Both are facts from the 4 Sep Figma export, pinned here so
   * a future pass cannot silently restore either without a test noticing.
   */
  describe("MetricCard, 4 Sep 2026 blue retheme", () => {
    it("renders the title muted at body weight, not full-ink font-medium", () => {
      const html = renderToStaticMarkup(createElement(MetricCard, { title: "Speed To Lead", headline: "44" }));
      const h3Class = html.match(/<h3[^>]*class="([^"]*)"/)?.[1] ?? "";
      expect(h3Class, "the h3 was found").not.toBe("");
      expect(h3Class, "the title carries the muted role").toContain("text-muted-foreground");
      expect(h3Class, "the title is no longer font-medium").not.toContain("font-medium");
    });

    it("paints no --tile-edge strip on the default board's shell", () => {
      const html = renderToStaticMarkup(createElement(MetricCard, { title: "Speed To Lead", headline: "44" }));
      expect(html, "the Figma's default board has no per-column edge on the tile").not.toContain("--tile-edge");
    });
  });
  ```

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/metric-card-shape.test.ts
  ```

  Expected failure: both assertions fail against the current source — the title still renders `class="...text-sm font-medium text-foreground"` (contains `font-medium`, no `text-muted-foreground`), and the markup still contains `style="background:var(--tile-edge, var(--border))"`.

- [ ] **Step 3 — implement**

  In `src/components/metric-card.tsx`, the file-level rationale (currently):

  ```
   * A LEADING EDGE IN THE GROUP'S COLOUR. The one new device, and borrowed rather
   * than invented: the builder's step card wears 4px of its own colour on exactly
   * this edge. A tile sits inside a coloured COLUMN whose tint it floated on
   * without ever referring to, so the board was throwing away the one fact the
   * arrangement encodes. It arrives as `--tile-edge`, set by the lane in
   * `board-column.tsx` — which means a card dragged into another column changes
   * allegiance with no prop threaded anywhere, and the ungrouped row above the
   * columns falls back to the ordinary hairline instead of claiming a group.
  ```

  becomes:

  ```
   * NO LEADING EDGE, AS OF THE 4 SEP 2026 BLUE RETHEME. The card used to wear
   * 4px of its group's colour on this edge, borrowed from the builder's step
   * card — the one device that let a tile floating loose in a coloured COLUMN
   * refer back to the tint it sat on. The Figma's default board draws no such
   * edge on any tile, so the strip is gone from here. `--tile-edge` is not:
   * the lane in `board-column.tsx` still sets it per group, unread by anything
   * on this board now, kept alive for the canvas board this spec does not
   * touch.
  ```

  The edge span (currently):

  ```tsx
      <div className="flex flex-1">
        {/* THE EDGE. `--tile-edge` is the group's accent, set by the lane; the
            fallback is the ordinary hairline, so an ungrouped tile keeps the
            same geometry without borrowing a colour that would mean it belongs
            somewhere. `aria-hidden` because it duplicates the group name the
            column header already states. */}
        <span
          aria-hidden
          className="w-1 shrink-0"
          style={{ background: "var(--tile-edge, var(--border))" }}
        />
        <div className="flex min-w-0 flex-1 flex-col p-4">
  ```

  becomes:

  ```tsx
      <div className="flex flex-1">
        {/* NO EDGE, AS OF THE 4 SEP 2026 BLUE RETHEME — see the file note
            above. `--tile-edge` stays defined and `board-column.tsx` still
            sets it per lane; nothing in this shell reads it any more. This
            wrapper is a one-child flex div now — harmless, and left alone
            rather than reflowing every line below it for a width the edge no
            longer needs. */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
  ```

  The title's own comment (currently):

  ```
              {/* A CARD TITLE, NOT A MICRO-LABEL.
                  This was 13px ALL-CAPS semibold muted, on the argument that a
                  metric's name LABELS the figure under it and that caps-and-
                  muted is what keeps the NUMBER the loud thing. The second half
                  of that is right and survives: the name is `font-medium` at
                  body size against a 36px numeral, which is a two-step gap —
                  the number is in no danger.
                  The first half was overcorrecting. Every tile on the board
                  read as a caption with a graph under it, at a size two steps
                  below the body text everywhere else in the product, and the
                  reference sets a card's name at exactly the same 14px/500 as
                  its body. The micro-label voice is for a STATUS or a column
                  head — strings you scan — not for a name the customer wrote. */}
  ```

  becomes:

  ```
              {/* A CARD TITLE, NOT A MICRO-LABEL — AND MUTED AGAIN AS OF THE
                  4 SEP 2026 BLUE RETHEME. This was 13px ALL-CAPS semibold
                  muted, on the argument that a metric's name LABELS the figure
                  under it and that caps-and-muted is what keeps the NUMBER the
                  loud thing. The size half of that overcorrected: every tile
                  read as a caption with a graph under it, two steps below the
                  body text everywhere else in the product, so the name moved
                  up to body size (`text-sm`, 15px) against a 28px numeral —
                  still a two-step gap, the number is in no danger.
                  THE INK HALF CAME BACK MUTED. The body-size name briefly
                  carried `font-medium text-foreground`, on the argument that a
                  name the customer wrote earned full ink; the Figma draws it
                  `text-muted-foreground` at body weight instead, so the
                  numeral stays the one full-ink object the card has. The
                  micro-label voice is still the wrong one here — it is for a
                  STATUS or a column head, strings you scan, not a name someone
                  wrote — the size argument above still holds at 15px muted. */}
  ```

  And the `<h3>` itself (currently):

  ```tsx
              <h3 className="flex min-w-0 flex-1 items-baseline text-sm font-medium text-foreground">
  ```

  becomes:

  ```tsx
              <h3 className="flex min-w-0 flex-1 items-baseline text-sm font-normal text-muted-foreground">
  ```

- [ ] **Step 4 — run it green**

  ```bash
  pnpm vitest run tests/metric-card-shape.test.ts
  ```

- [ ] **Step 5 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/metric-card-shape.test.ts && pnpm check:ui
  ```

- [ ] **Step 6 — commit**

  ```bash
  git add src/components/metric-card.tsx tests/metric-card-shape.test.ts
  git commit -m "$(cat <<'EOF'
  Mute the tile's title again, and drop its edge on the default board

  The 4 Sep 2026 Figma draws a card's name muted at body weight, not the
  full-ink font-medium the previous pass gave it, and shows no per-column
  colour strip on any tile on the default board. --tile-edge stays defined
  (board-column.tsx still sets it per lane) for the canvas board; this shell
  just stops reading it.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: Give the freshness dot its own colour, out from under success

**Files**
- Modify: `src/components/flow-tile.tsx`
- Create: `tests/freshness-dot.test.ts`

**Interfaces**
- Consumes: `--freshness-dot` / `--freshness-halo` tokens (`src/app/globals.css`) — these land via this branch's tokens task; this task only reads the `bg-freshness-dot` / `bg-freshness-halo` utility classes they generate. If this task runs before the tokens task lands, `pnpm check:ui`'s unresolved-utility check (or a visual check) will flag the two classes as unresolved — sequence this task after the tokens task, or land the two token lines first.
- Produces: `Freshness({status: "fresh"})`'s healthy-dot markup now reads `bg-freshness-halo` (the 16px wash) wrapping `bg-freshness-dot` (the 6px dot), never `bg-success`/`bg-success/15`. `--success`, `--success-soft`, and every other reader of them (`TargetBar`'s met state in `charts.tsx`, `GoalBar` in `board-charts/scorecard.tsx`, `StatusPill`'s success tone in `badge.tsx`) are untouched — this is a new, separate pair of tokens, not a repoint of `--success`.

- [ ] **Step 1 — write the failing test**

  Create `tests/freshness-dot.test.ts`:

  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { createElement } from "react";
  import { renderToStaticMarkup } from "react-dom/server";

  // flow-tile.tsx imports a "use server" action and next/link; the same
  // boundary tests/custom-tile-render.test.ts already crosses to reach a
  // named export from this file in a plain node render.
  vi.mock("server-only", () => ({}));
  vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

  const { Freshness } = await import("@/components/flow-tile");

  /**
   * THE BLUE RETHEME (4 Sep 2026) — the healthy dot stops re-using
   * `--success` for its own colour. `--freshness-dot`/`--freshness-halo` are
   * new, separate tokens (globals.css) so a goal bar or a badge going
   * success-green some day cannot drag the freshness dot's hue along with it,
   * and this dot changing hue cannot dim what "goal met" means elsewhere.
   */
  describe("Freshness, 4 Sep 2026 blue retheme", () => {
    it("draws the healthy dot in --freshness-dot inside the --freshness-halo, never --success", () => {
      const html = renderToStaticMarkup(createElement(Freshness, { status: "fresh" }));
      expect(html, "the halo wraps the dot in bg-freshness-halo").toMatch(/bg-freshness-halo/);
      expect(html, "the dot itself is bg-freshness-dot").toMatch(/bg-freshness-dot/);
      expect(html, "the old success re-use is gone from this mark").not.toContain("bg-success");
    });
  });
  ```

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/freshness-dot.test.ts
  ```

  Expected failure: the rendered markup contains `bg-success/15` and `bg-success`, not `bg-freshness-halo`/`bg-freshness-dot` — the first two assertions fail, the third (`not.toContain("bg-success")`) fails too since `bg-success/15` contains the substring `bg-success`.

- [ ] **Step 3 — implement**

  In `src/components/flow-tile.tsx`, inside `Freshness`, the fresh-state return (currently):

  ```tsx
      /**
       * STILL A 6px DOT (docs/BRAND_KIT.md says so, and the quiet-when-fine
       * rule depends on it staying small) — now sitting in a 16px wash of its
       * own colour. A bare 6px dot at the corner of a 24px-padded card read as
       * a speck of dust; the halo gives it a shape to be, at no extra ink.
       * It is also what makes the healthy state and the pill states the same
       * SIZE, so the head does not reflow when a tile goes stale.
       */
      <span
        className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-success/15"
        title="Up to date"
        role="img"
        aria-label="Up to date"
      >
        <span className="size-1.5 rounded-full bg-success" />
      </span>
  ```

  becomes:

  ```tsx
      /**
       * STILL A 6px DOT (docs/BRAND_KIT.md says so, and the quiet-when-fine
       * rule depends on it staying small) — now sitting in a 16px wash of its
       * own colour. A bare 6px dot at the corner of a 24px-padded card read as
       * a speck of dust; the halo gives it a shape to be, at no extra ink.
       * It is also what makes the healthy state and the pill states the same
       * SIZE, so the head does not reflow when a tile goes stale.
       *
       * ITS OWN TOKEN, AS OF THE 4 SEP 2026 BLUE RETHEME — not `--success`
       * borrowed. `--freshness-dot`/`--freshness-halo` (globals.css) are a
       * separate pair so a goal bar or a badge going success-green some day
       * cannot drag this dot's hue along, and this dot going anything else
       * cannot dim what "goal met" means.
       */
      <span
        className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-freshness-halo"
        title="Up to date"
        role="img"
        aria-label="Up to date"
      >
        <span className="size-1.5 rounded-full bg-freshness-dot" />
      </span>
  ```

- [ ] **Step 4 — run it green**

  ```bash
  pnpm vitest run tests/freshness-dot.test.ts
  ```

- [ ] **Step 5 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/freshness-dot.test.ts && pnpm check:ui
  ```

- [ ] **Step 6 — commit**

  ```bash
  git add src/components/flow-tile.tsx tests/freshness-dot.test.ts
  git commit -m "$(cat <<'EOF'
  Give the freshness dot its own colour, out from under success

  The healthy dot was re-using --success/--success-soft, which meant any
  future retuning of the success trio (a goal bar's met state, a StatusPill)
  would drag the freshness dot's hue along uninvited. --freshness-dot and
  --freshness-halo are the dot's own pair now, per the 4 Sep 2026 Figma.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 13: Point every default chart mark at the brand's 500, not the marker

**Files**
- Modify: `src/lib/board/tile-config.ts`
- Modify: `src/components/charts.tsx`
- Modify: `tests/tile-config.test.ts` (updates an existing pin)
- Modify: `tests/board-chart-marks.test.ts` (updates an existing byte-identical hash pin)

**Interfaces**
- Consumes: `--color-brand-500` — the existing `@theme` token; a separate tokens task on this branch repoints its hex to `#007BFF` (dark) per the ramp table, this task only changes which token NAME the default accent and the legacy series read.
- Produces: `accentOf(color?)` (`src/lib/board/tile-config.ts`) returns `"var(--color-brand-500)"` for any tile with no (or an unpalatable) `GROUP_ACCENT` colour — was `"var(--color-brand-600)"`. `BREAKDOWN_ACCENTS[0]`, `Sparkbars`' wash/axis-rule and its bars (`src/components/charts.tsx`) read `bg-brand-500`/`border-brand-500` — were `bg-marker`/`border-marker`. `GROUP_ACCENT` (`flow/node-accent.ts`), `--marker` itself, `TargetBar`'s neutral/success states, and `board-charts/scorecard.tsx`'s `GoalBar` are all untouched.

- [ ] **Step 1 — write the failing tests**

  In `tests/tile-config.test.ts`, the existing pin (currently):

  ```ts
    expect(accentOf("constructor")).toBe("var(--color-brand-600)");
    expect(accentOf("nope")).toBe("var(--color-brand-600)");
    expect(accentOf(undefined)).toBe("var(--color-brand-600)");
    expect(accentOf("teal")).not.toBe("var(--color-brand-600)");
  ```

  becomes (same test, new pin — this is the retheme's rule, not a deletion):

  ```ts
    expect(accentOf("constructor")).toBe("var(--color-brand-500)");
    expect(accentOf("nope")).toBe("var(--color-brand-500)");
    expect(accentOf(undefined)).toBe("var(--color-brand-500)");
    expect(accentOf("teal")).not.toBe("var(--color-brand-500)");
  ```

  In `tests/board-chart-marks.test.ts`, append a new paragraph to the byte-identical test's docblock (after `* direction-blind delta are all untouched.` and before the closing `*/`, i.e. immediately above `const hash = createHash(...)`):

  ```
     *
     * AND MOVED A FIFTH TIME FOR THE BLUE RETHEME (4 Sep 2026) — a rename,
     * not a behaviour change, but the file said "a series is a MARK and stays
     * `--marker`" two paragraphs up and that stopped being true. The Figma's
     * ramp splits jobs the single `--marker` used to hold alone: `--marker`
     * becomes the dark stroke (`brand-400`) or light stroke (`brand-800`) for
     * links, the focus ring and the active-tab rule, while the chart series —
     * Sparkbars' wash, its bars, and the breakdown's first slot — takes
     * `--color-brand-500` (`#007BFF`) directly, because after the split the
     * two tokens are no longer the same colour in either theme. `TargetBar`
     * is untouched again: it already drew in `--success`/neutral, never
     * `--marker`, so the goal-bar paragraphs above still hold.
     */
  ```

  and change the hash literal (currently):

  ```ts
    expect(hash).toBe("49fae91cb1e4bc260c958a910bbf0a26c2fe6dc7fec70f714f8fa907ba036203");
  ```

  to the hash of `charts.tsx` AFTER Step 3's edit below (computed ahead of time against the exact diff this task makes):

  ```ts
    expect(hash).toBe("1bc249c1d7cbb6345eb3f70df52215d01d483d2e19873f582bd9e18cdf2baf29");
  ```

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/tile-config.test.ts tests/board-chart-marks.test.ts
  ```

  Expected failure: `tile-config.test.ts`'s four `accentOf` assertions fail (the function still returns `brand-600`); `board-chart-marks.test.ts`'s hash assertion fails (`charts.tsx` is still byte-identical to its old self, so its hash is still `49fae91c...`, not `1bc249c1...`).

- [ ] **Step 3 — implement**

  In `src/lib/board/tile-config.ts`, the docblock above `accentOf` (currently):

  ```
  /**
   * The tile's accent, resolved from its stored palette KEY.
   *
   * A key, never a hex — re-solving a hue for contrast then restyles every board
   * at once with no backfill, and a key this palette has since dropped degrades
   * to the kit's own mark colour instead of rendering `undefined` into a style
   * attribute. The same argument `node-accent.ts` makes for group colours.
   */
  ```

  becomes:

  ```
  /**
   * The tile's accent, resolved from its stored palette KEY.
   *
   * A key, never a hex — re-solving a hue for contrast then restyles every board
   * at once with no backfill, and a key this palette has since dropped degrades
   * to the kit's own mark colour instead of rendering `undefined` into a style
   * attribute. The same argument `node-accent.ts` makes for group colours.
   *
   * THE DEFAULT IS `--color-brand-500`, NOT `--primary`. As of the 4 Sep 2026
   * blue retheme the ramp splits the two jobs the old single brand token did:
   * `--color-brand-600` (`--primary`) is the FILL controls take under white
   * ink, and `--color-brand-500` (`#007BFF`) is the chart-series step — the
   * colour a tile with no `GROUP_ACCENT` colour of its own draws in.
   */
  ```

  and the return line (currently):

  ```ts
    return color && Object.hasOwn(GROUP_ACCENT, color) ? GROUP_ACCENT[color] : "var(--color-brand-600)";
  ```

  becomes:

  ```ts
    return color && Object.hasOwn(GROUP_ACCENT, color) ? GROUP_ACCENT[color] : "var(--color-brand-500)";
  ```

  In `src/components/charts.tsx`, five spots move from `marker` to `brand-500`. The file-level vocabulary bullet (currently):

  ```
   *   THE MARKER DRAWS THE SERIES. A mark here is one measure, and the marker's
   *     violet is the colour the product measures in: the sparkbars, the goal
   *     bar, a breakdown's first row.
  ```

  becomes:

  ```
   *   THE BRAND DRAWS THE SERIES. A mark here is one measure, and
   *     `--color-brand-500` (`#007BFF`) is the colour the product measures in:
   *     the sparkbars and a breakdown's first row — the goal bar stays
   *     neutral-until-met (see `TargetBar` below), which is a state, not a
   *     series.
  ```

  `BREAKDOWN_ACCENTS` (currently):

  ```ts
  const BREAKDOWN_ACCENTS = ["bg-marker", "bg-accent-peri", "bg-accent-orange", "bg-accent-pink"];
  ```

  becomes:

  ```ts
  const BREAKDOWN_ACCENTS = ["bg-brand-500", "bg-accent-peri", "bg-accent-orange", "bg-accent-pink"];
  ```

  The axis-rule comment inside `Sparkbars` (currently):

  ```
      // THE TWO USED TO BE ONE COLOUR AND CANNOT BE, which is the fill/stroke
      // split drawn inside a single element. The axis is a RULE, so it is the
      // marker's: a 25% yellow line measures about 1.1:1 on a white card and is
  ```

  becomes:

  ```
      // THE TWO USED TO BE ONE COLOUR AND CANNOT BE, which is the fill/stroke
      // split drawn inside a single element. The axis is a RULE, so it is the
      // brand's: a 25% yellow line measures about 1.1:1 on a white card and is
  ```

  `Sparkbars`' container (currently):

  ```tsx
      className={cn("mt-3 flex items-end gap-1 rounded-t-sm border-b border-marker/25 bg-marker/5", className)}
  ```

  becomes:

  ```tsx
      className={cn("mt-3 flex items-end gap-1 rounded-t-sm border-b border-brand-500/25 bg-brand-500/5", className)}
  ```

  and each bar's class (currently):

  ```ts
              "bg-marker",
  ```

  becomes:

  ```ts
              "bg-brand-500",
  ```

  (this is the sole occurrence of the bare string `"bg-marker",` on its own line in the file — the one inside the `cn(...)` call for each bar in `Sparkbars`).

- [ ] **Step 4 — run it green**

  ```bash
  pnpm vitest run tests/tile-config.test.ts tests/board-chart-marks.test.ts
  ```

  If the hash still mismatches, the edit differs from what Step 1's literal assumed — diff against `git diff src/components/charts.tsx` and either fix the edit to match exactly the five changes above, or recompute the hash with `shasum -a 256 src/components/charts.tsx` and use that value (only after confirming the diff is exactly the five changes listed, nothing else).

- [ ] **Step 5 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/tile-config.test.ts tests/board-chart-marks.test.ts && pnpm check:ui
  ```

- [ ] **Step 6 — commit**

  ```bash
  git add src/lib/board/tile-config.ts src/components/charts.tsx tests/tile-config.test.ts tests/board-chart-marks.test.ts
  git commit -m "$(cat <<'EOF'
  Point every default chart mark at the brand's 500, not the marker

  --marker stops being the chart-series colour under the blue retheme -- it
  becomes the link/focus-ring/active-tab-rule stroke (brand-400 dark,
  brand-800 light), a different step of the ramp in both themes now. The
  series default (a tile's accent with no GROUP_ACCENT colour, and the
  legacy board's sparkbars/breakdown-first-slot) moves to --color-brand-500
  (#007BFF) directly so it keeps its own colour rather than silently
  following wherever --marker goes next.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 14: Let Refresh all go quiet — grey is the header's default now

**Files**
- Modify: `src/app/dashboard/page.tsx`
- Create: `tests/dashboard-header-actions.test.ts`

**Interfaces**
- Consumes: `SubmitButton`'s `variant` prop (`@/components/ui/submit-button`), which forwards to `Button`'s existing `"secondary"` variant (`@/components/ui/button.tsx`) — no change to either component.
- Produces: the dashboard's "Refresh all" form (`boardActions` in `src/app/dashboard/page.tsx`) renders `<SubmitButton variant="secondary" size="sm">` — was `variant="accent" size="sm" className="px-5"`.

**A scoping note carried into openQuestions, not solved by this task**: the spec's Page Header section (`docs/superpowers/specs/2026-09-04-retheme-blue-design.md`, "Layout and the shell") describes a redesigned actions row — "+ Add" primary, "Today" and "Refresh All" secondary, all `xs` with 16px icons — that does not match today's dashboard header. Today's header's right-hand slot is the six-pill period track (`RANGE_OPTIONS`/`PERIOD_TRACK` in `ui/page.tsx`, a shared app-wide chrome primitive), and the tile-adding "+ Add" button lives in `src/app/dashboard/custom-board.tsx` (not a file this area owns) as `<Button variant="white" size="sm"><Plus />Add</Button>`. This task only touches the one control that both exists today AND is unambiguous — "Refresh all", already a real `variant="accent"` button. It does not invent a "Today" button or move "+ Add" out of `custom-board.tsx`; see openQuestions.

- [ ] **Step 1 — write the failing test**

  Create `tests/dashboard-header-actions.test.ts`:

  ```ts
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
      const block = src.slice(anchor, anchor + 400);
      expect(block, 'Refresh all reads variant="secondary"').toContain('variant="secondary"');
      expect(block, 'Refresh all no longer reads variant="accent"').not.toContain('variant="accent"');
    });
  });
  ```

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/dashboard-header-actions.test.ts
  ```

  Expected failure: the sliced block contains `variant="accent"`, not `variant="secondary"` — both assertions fail.

- [ ] **Step 3 — implement**

  In `src/app/dashboard/page.tsx`, the comment and button (currently):

  ```tsx
        {/* Recompute every published metric.
            THE YELLOW IS SPENT HERE, and the reason is no longer scarcity. This
            file used to argue at length about how many yellows a screen may hold
            — that the colour belongs to "the single act the page exists for", and
            that a second one halves the value of the first. The kit retired that
            rule because nothing could check it. What replaced it is the
            fill/stroke split: yellow may only paint a FILLED object, and this is a
            filled control carrying near-black ink at 11.24:1, which is the only
            combination the brand is measured in. That is permission rather than
            instruction, so the reason it is THIS control and not its neighbours
            survives the change of rule: it is the one thing in the row that
            CHANGES anything rather than narrowing what is shown, and the two
            beside it stay white pills.
            `variant="accent"` IS that fill — `bg-primary` under
            `text-primary-foreground`. The `yellow` variant this used to name has
            been deleted: with a yellow primary the two resolved to the same
            object under two names.
            `px-5` is 20px, wider than `size="sm"`'s own 14px, because the button
            that acts is the one that is meant to be reached for. */}
        <form action={refreshAllFlowsAction} className="shrink-0">
          <SubmitButton
            variant="accent"
            size="sm"
            className="px-5"
            pendingLabel="Refreshing…"
            title="Recompute every published metric now"
          >
            Refresh all
          </SubmitButton>
        </form>
  ```

  becomes:

  ```tsx
        {/* Recompute every published metric.
            NOT THE FILL, AS OF THE 4 SEP 2026 BLUE RETHEME. This used to argue
            for spending the brand's one filled control here — first as
            scarcity ("the single act the page exists for"), then as a
            fill/stroke rule keyed to which control CHANGES something rather
            than narrows what is shown. The Figma settles it a third way, by
            naming names: blue is reserved for "+ Add" and "New flow"; every
            other header action — Refresh all included — is `secondary`, the
            kit's ordinary grey button (see `ui/button.tsx`). Acting is no
            longer the test; being one of exactly two adds-something verbs is.
            `px-5`'s argument went with the fill: a `secondary` button reaches
            for no more attention than its neighbours, so it takes
            `size="sm"`'s own 14px like they do. */}
        <form action={refreshAllFlowsAction} className="shrink-0">
          <SubmitButton
            variant="secondary"
            size="sm"
            pendingLabel="Refreshing…"
            title="Recompute every published metric now"
          >
            Refresh all
          </SubmitButton>
        </form>
  ```

- [ ] **Step 4 — run it green**

  ```bash
  pnpm vitest run tests/dashboard-header-actions.test.ts
  ```

- [ ] **Step 5 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/dashboard-header-actions.test.ts && pnpm check:ui
  ```

- [ ] **Step 6 — commit**

  ```bash
  git add src/app/dashboard/page.tsx tests/dashboard-header-actions.test.ts
  git commit -m "$(cat <<'EOF'
  Let Refresh all go quiet -- grey is the header's default now

  The 4 Sep 2026 Figma reserves blue for the two controls that add
  something (+ Add, New flow); every other header action takes the kit's
  ordinary secondary button. Refresh all was the one place variant="accent"
  survived on this page from the yellow-brand era's fill/stroke argument --
  it goes grey, and the width override that argument justified goes with it.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

  (Last task in this area's slice — if this is also the last task of the WHOLE branch plan, the branch-level gate replaces Step 5's per-task gate: `pnpm typecheck && pnpm vitest run && pnpm build && pnpm check:orphans && pnpm check:ui`. Confirm with the orchestrating plan before running the branch-level gate here — this area was not told whether it is last.)

---

### Task 15: BRAND_KIT.md — Principles and Colour (§1, §2) for the blue console

**Files**
- Modify: `docs/BRAND_KIT.md`
- Create: `tests/retheme-blue-docs.test.ts`

**Interfaces**
- Consumes: `docs/superpowers/specs/2026-09-04-retheme-blue-design.md` (Tokens section: brand ramp, neutral ramp, light theme, state trios).
- Produces: `docs/BRAND_KIT.md` with §1 principle 1 and all of §2 rewritten to the three-surface, `#007BFF` vocabulary, ratios computed fresh (not copied from the cyan-era text).

- [ ] **Step 1 — write the failing test**

  Create `tests/retheme-blue-docs.test.ts`:

  ```ts
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  import { describe, expect, it } from "vitest";

  /**
   * PINS THE PROSE THE SAME WAY design-swatches.test.ts PINS THE SWATCHES.
   *
   * BRAND_KIT.md, DESIGN.md and /design have no compiler checking their prose
   * against the tokens they describe — which is exactly how the kit page once
   * showed ultramarine tiles captioned with the old indigo hexes. This file is
   * the doc-prose half of that discipline for the 4 September 2026 blue
   * re-theme: every assertion fails on the OLD claim and passes only once the
   * NEW one is actually written down.
   */
  const root = join(__dirname, "..");
  const brandKit = () => readFileSync(join(root, "docs/BRAND_KIT.md"), "utf8");

  describe("BRAND_KIT.md §1–§2 match the blue re-theme (4 September 2026 Figma)", () => {
    it("principle 1 states three dark surfaces, not one", () => {
      const doc = brandKit();
      expect(doc).not.toMatch(/rail, the top bar and the\s+page are all `#1B191A`/);
      expect(doc).toMatch(/#0F1011/);
      expect(doc).toMatch(/#111111/);
      expect(doc).toMatch(/#181818/);
    });

    it("the brand ramp fills with #0070E8 under #007BFF, not the cyan pair", () => {
      const doc = brandKit();
      expect(doc).toMatch(/#007BFF/);
      expect(doc).toMatch(/#0070E8/);
    });

    it("the neutral ramp names the three new dark steps", () => {
      const doc = brandKit();
      expect(doc).toMatch(/neutral-925/);
      expect(doc).toMatch(/neutral-850/);
      expect(doc).toMatch(/neutral-450/);
    });

    it("the light theme table carries the Figma's light export values", () => {
      const doc = brandKit();
      expect(doc).toMatch(/#F7F8F9/);
      expect(doc).toMatch(/#E1E1E1/);
      expect(doc).toMatch(/#34C759/);
    });

    it("state trios are re-measured against the new dark surfaces", () => {
      const doc = brandKit();
      expect(doc).toMatch(/9\.83:1/);
      expect(doc).not.toMatch(/9\.02:1 on the ground, 7\.93:1 on a card/);
    });
  });
  ```

- [ ] **Step 2 — run it, confirm the failure**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: every `it` in the new describe block fails — the file still says `#1B191A`, `#00C0E8`/`#00CDF5`, has no `neutral-925`/`850`/`450`, no `#F7F8F9`/`#E1E1E1`/`#34C759`, and still prints the old `9.02:1 on the ground, 7.93:1 on a card` state-trio line.

- [ ] **Step 3 — implement: rewrite principle 1**

  In `docs/BRAND_KIT.md`, replace the intro's colour-vocabulary clause:

  OLD (line 9-10):
  ```
  from a VoltAgent-style observability console: **one surface separated entirely
  by hairlines**, one neutral ramp, one blue in three shapes, a 14px UI base, and
  ```
  NEW:
  ```
  from the 4 September 2026 Figma: **three dark surfaces meeting at one
  hairline**, one neutral ramp, one blue doing a stroke's job and a fill's,
  a 14px UI base, and
  ```

  Replace principle 1 (lines 23-27):

  OLD:
  ```
  1. **One surface. The hairline is the structure.** The rail, the top bar and the
     page are all `#1B191A`; every separation in the product is a 1px `#3D393B`
     rule. A card is `#272426` — a **1.14:1** step, which exists in the numbers
     and not in the eye — so a card without its border is not a flatter card, it
     is an invisible one.
  ```
  NEW:
  ```
  1. **Three darks, one hairline.** The page is `#0F1011`; the top bar, the
     rail and every card share `#111111`; the content panel under the top bar —
     where the board and its tiles actually sit — is `#181818`. That is three
     surfaces where the two-day-old console ran one, and they sit within a hair
     of each other on purpose: `#111111` on `#0F1011` measures **1.01:1**,
     `#181818` on `#0F1011` measures **1.07:1** — both TIGHTER than the 1.14:1
     step the previous scheme ran between its one ground and its cards. `#343434`
     is still the one hairline value that separates them anyway, because a
     surface change nobody can see without its edge is not a flatter surface, it
     is an invisible one — the same argument as two days ago, now covering three
     surfaces instead of one.
  ```

- [ ] **Step 4 — implement: rewrite §2 Colour in full**

  Replace everything from `## 2. Color` (line 46) through the end of the State
  trios section, immediately before `## 3. Typography` (through line 167), with:

  ```markdown
  ## 2. Color

  ### The brand ramp — one blue, two jobs

  Two days ago the kit ran cyan in three shapes: a ring for identity, a glyph
  for location, a fill for action. The Figma this pass builds from does not
  mark location with the brand at all — the rail's active row is a **neutral**
  `--control` fill with a `--border` edge, not a coloured glyph — so the "glyph
  is location" job retires with the cyan that carried it, and colour is left
  doing exactly two things: drawing a **stroke** and painting a **fill**.

  | Step | Hex | Role | Measured |
  |---|---|---|---|
  | 50 | `#E6F2FF` | wash on light | — |
  | 100 | `#CCE5FF` | | — |
  | 200 | `#99CBFF` | | — |
  | 300 | `#66B2FF` | | 8.51:1 on `#0F1011` |
  | 400 | `#3D9BFF` | **THE DARK STROKE** (`--marker` in `.dark`): links, focus ring, active tab rule, selected edge | 6.65:1 on `#0F1011`, 6.59:1 on `#111111`, 6.20:1 on `#181818` |
  | 500 | `#007BFF` | **THE BRAND**: hover of the fill, the workspace initial tint (`rgb(0 123 255 / .75)`), decorative dots, chart series default | 4.79:1 as a stroke on `#0F1011` |
  | 600 | `#0070E8` | **THE FILL** (`--primary`, both themes) under white ink | 4.68:1 white-on-fill — the Figma's own `#007BFF` measures 3.98:1 under white, short of the 4.5:1 a 15px label owes, so the fill sits one step deeper than the brand it is named after |
  | 700 | `#0069D9` | pressed | 5.22:1 under white |
  | 800 | `#0062CC` | **THE LIGHT STROKE** (`--marker` in `:root`): links, ring, active rule on white | 5.80:1 on white |
  | 900 | `#0056B3` | reserved — light hover of a stroke | 7.04:1 on white |

  `--primary-foreground` is `#FFFFFF` in both themes now — it was near-black
  under cyan, because `#00C0E8` needed a dark ink to clear its bar and `#0070E8`
  needs a light one. `--brand-soft` is `rgb(0 123 255 / 0.10)`; `--brand-soft-line`
  is `rgb(0 123 255 / 0.25)` on dark and `0.30` on light — a 10% wash needs more
  ring on the lighter ground to keep an edge. **Hover still walks UP the ramp on
  dark** (600 fill → 500 on hover) **and DOWN on light** (600 → 700): brightening
  a fill under the pointer moves it toward the white page behind it on a light
  surface, and the label's contrast falls at the exact moment of the press.

  ### The neutral ramp (dark), re-cut for three surfaces

  | Token | Hex | Job |
  |---|---|---|
  | `neutral-950` | `#0F1011` | `--background` — **the page ground** |
  | `neutral-925` (new) | `#111111` | `--chrome` — top bar, rail, **and** `--card` |
  | `neutral-900` | `#181818` | `--panel` — the content area under the top bar |
  | `neutral-850` (new) | `#202020` | `--control` — fields, the search box, the active nav row |
  | `neutral-800` | `#333333` | `--secondary` — grey buttons; `--accent` hover step |
  | `neutral-700` | `#3A3A3A` | avatar / icon circles (`--avatar`) |
  | `neutral-600` | `#343434` | `--border` — every hairline |
  | `neutral-500` | `#4A4A4A` | `--rule` — the heavier control edge (switch track, checkbox, table divider); the Figma's own "Main Menu" grey measures **2.13:1** here and is not text-safe |
  | `neutral-450` (new) | `#6E6E6E` | `--faint` — the caps section label only ("Main Menu"), **3.70:1** on `#111111`; never body copy |
  | `neutral-400` | `#858585` | `--muted-foreground` — the Figma's own `#7E7E7E` measures **4.37:1** on the panel; `#858585` clears **4.81:1** there and **5.12:1** on a card |
  | `neutral-200` | `#FFFFFF` | `--foreground`, `--heading`, `--card-foreground` — the Figma sets body *and* titles in white |

  Step numbers stay labels for the ladder, not a promise of visual distance —
  **925 on 950 measures 1.01:1** and **900 on 950 measures 1.07:1**, both
  tighter than the single 1.14:1 step the cyan console ran between its one
  surface and its cards. `neutral-300` — the fourth ink step, "descriptions,
  captions" — is no longer named as a role: the Figma's own ink ramp is two
  values, not four, and carrying a third would be inventing a distinction the
  source does not draw (see the retired-token table below). **500 is still the
  last step a LINE may be drawn in and 450 a caps-label-only step; 400 is the
  first that TEXT may be set in.** The gap that used to run 500→400 now runs
  500→450→400, and 450 is deliberately narrow: a section label reads at it, a
  sentence must not.

  Shadows: `--shadow-card` is `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 /
  .10)` — the Figma's own card shadow, unchanged by theme. Card radius stays
  10px; controls 8px (§4); `--radius-frame` comes back at 8px — the panel's
  top-left corner meets the top bar beside a rail whose chrome is a genuinely
  different colour again, which is exactly the condition the frame token
  existed for and lost two days ago when the whole shell became one surface.

  ### The light theme (`:root`), from the Figma's light export

  | Role | Hex | Measured |
  |---|---|---|
  | `--background` (page) and `--panel` | `#F7F8F9` | — |
  | `--chrome` (top bar, rail) and `--card` | `#FFFFFF` | — |
  | `--border` (hairline) | `#E1E1E1` | — |
  | control outline (`--input`) | `#E4E4E4` | — |
  | `--control` (search box, active nav row) | `#F4F4F4` | — |
  | `--secondary` | `#FFFFFF` with a `--input` outline — the Figma's own grey buttons are white with an `#E4E4E4` edge | — |
  | `--foreground` / `--heading` | `#000000` / `#313131` (page title, workspace name) | — |
  | `--muted-foreground` | `#6B6B6B` — the Figma's own `#8E8E8E` measures **3.28:1** on white, short of the 4.5:1 body text owes; `#6B6B6B` clears **5.33:1** on white and **5.01:1** on `#F7F8F9` |
  | `--faint` (caps label) | `#8E8E8E` — the Figma's own `#BABABA` measures **1.94:1**, unreadable at any size | 3.28:1, caps label only |
  | icon ink on grey buttons | `#4A4A4A` | **8.86:1** on white, measured directly — the Figma export's own figure of 8.4:1 is a hair off, most likely a rounding pass on their side |
  | `--primary` / `--marker` | `#0070E8` / `#0062CC` | see the brand ramp above |
  | `--success` etc. | unchanged (`#00734B` trio) | 5.91:1 on white |
  | `--freshness-dot` | `#34C759` on `rgb(0 212 146 / .15)` | 8.51:1 on `#111111`; on white the dot keeps its halo — flat `#34C759` alone measures **2.22:1** on white, so the halo is load-bearing there, not decorative |

  ### Retired token families

  All of these still PARSE as classes; most compile to NOTHING, which is why
  they are a build failure rather than a review comment (§11, `retired
  token`). The last three rows are a different case, flagged as such:

  | retired | use instead | why it existed |
  |---|---|---|
  | `--ground`, `--ground-ink`, `--ground-ink-muted` | `background`, `foreground`, `muted-foreground` | the page was a different surface from the app's background while a band wrapped it |
  | nine `--chrome-*` roles | `border`, `card`, `primary`, `muted-foreground` | the band did not invert with the theme, so it could not use the roles |
  | `--period-bg`, `--period-line`, `--period-ink` | `control`, `border`, `muted-foreground` | the period track was the one control that followed the page rather than the band |
  | `--tab-underline` | `marker` | — |
  | `--marker-ink` | `marker` | see above |
  | the `marker-*` ramp | `brand-*` | one ramp; the violet's steps had no twin to keep in step with |
  | the `ink-*` ramp | `neutral-*` | it was the dark-surface ladder in a light app; every surface is that surface now |
  | `--rail`, `--sidebar`, `--sidebar-accent` | `background`, `neutral-700` | — |
  | `--accent-yellow` | `primary` | two yellows four counts apart under two names |
  | `.focus-ring-light` | the global ring | the product's ring was invisible on the one dark surface |
  | cyan `brand-500`/`brand-600` (`#00CDF5`/`#00C0E8`) | `brand-500`/`brand-600` at `#007BFF`/`#0070E8` | **not a dead class** — the 4 September 2026 Figma named a different blue two days after this ramp last moved. Recorded here anyway because a class surviving under a new value is the "plausible and wrong" case this table exists to catch in the DOCS, not the code |
  | `rounded-full` on `buttonVariants`'s base class | `rounded-control` | **not a dead class either** — the shape rule flipped to a pill and back for the second time (§4); `rounded-full` still compiles on purpose (avatars, the bell badge, the freshness dot, the active-count numeral), so this row is a paper trail for the next flip rather than a dead-class warning |
  | `neutral-300` as a named role ("descriptions, captions") | `neutral-400` (muted text) or `neutral-200` (body/heading) | the Figma draws two ink greys, not four; carrying a third was inventing a distinction the source does not |

  ### State

  `--success` / `--warn` / `--danger` are unchanged hex values in both themes,
  but they sit on new dark surfaces now and are re-measured rather than carried
  over on faith: `#00D492` clears **9.83:1** on the page, **9.74:1** on the
  chrome, **9.16:1** on the panel; `#F5A524` clears **9.33:1** / **9.25:1** /
  **8.70:1** across the same three; `#FB2C36` clears **5.00:1** / **4.96:1** /
  **4.66:1** — the tightest of the three, and still comfortably past 4.5.
  Light-theme success is unchanged at **5.91:1** on white.

  A new `--freshness-dot: #34C759` (both themes) and `--freshness-halo:
  rgb(0 212 146 / 0.15)` replace the tile's re-use of `--success` /
  `--success-soft` for the "healthy" dot — the state vocabulary stays separate
  from a colour that used to double as the metric card's own "everything is
  fine" tint. `--success` itself keeps doing status work everywhere else
  (badges, pills); only the tile's freshness dot moves to its own pair.
  ```

- [ ] **Step 5 — run it green**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all five `it`s pass.

- [ ] **Step 6 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/retheme-blue-docs.test.ts && pnpm check:ui
  ```

- [ ] **Step 7 — commit**

  ```bash
  git add docs/BRAND_KIT.md tests/retheme-blue-docs.test.ts
  git commit -m "$(cat <<'EOF'
  Rewrite BRAND_KIT's principles and colour tables for the blue console

  Three dark surfaces (#0F1011/#111111/#181818) replace the one-surface
  thesis, #007BFF replaces the two-day-old cyan, and every contrast ratio
  in the brand ramp, neutral ramp, light theme and state trios is measured
  fresh against the new hex pairs rather than carried over from the cyan
  console.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 16: BRAND_KIT.md — Type, Shape, Layout, Components, Data viz and Enforcement (§3, §4, §5, §6, §9, §11)

**Files**
- Modify: `docs/BRAND_KIT.md`
- Modify: `tests/retheme-blue-docs.test.ts`

**Interfaces**
- Consumes: `docs/BRAND_KIT.md` §2 as rewritten by the prior task (for the surface/ramp facts these sections reference); the spec's Type, Shape, Layout, Components, Tiles-and-charts and Docs-and-enforcement sections.
- Produces: §3 (numeral 28px, `.wordmark`), §4 (8px/no-pill, final), §5 (top bar wordmark, rail dressing), §6 (component-level token facts), §9 (brand-series chart colours, tile edge removed from default board), §11 (retired-token additions narrated).

- [ ] **Step 1 — extend the failing test**

  Add to `tests/retheme-blue-docs.test.ts`, inside the existing `describe("BRAND_KIT.md §1–§2 ...")` block's file (as a second `describe`):

  ```ts
  describe("BRAND_KIT.md §3–§11 match the blue re-theme", () => {
    it("the tile numeral is 28px and the wordmark is documented", () => {
      const doc = brandKit();
      expect(doc).toMatch(/28px/);
      expect(doc).toMatch(/\.wordmark/);
      expect(doc).toMatch(/weight\s*\*?\*?900/i);
    });

    it("shape is 8px, no pill, and names the Figma as final", () => {
      const doc = brandKit();
      expect(doc).not.toMatch(/Everything you press is a full pill/);
      expect(doc).toMatch(/no pill/i);
      expect(doc).toMatch(/4 September 2026 Figma/);
    });

    it("radius-frame is 8px again, not retired at 0", () => {
      const doc = brandKit();
      expect(doc).not.toMatch(/`--radius-frame` is \*\*0\*\*/);
      expect(doc).toMatch(/`--radius-frame` is \*\*8px\*\*/);
    });

    it("the top bar carries the wordmark, out of the rail", () => {
      const doc = brandKit();
      expect(doc).toMatch(/top bar now carries the wordmark/i);
    });

    it("chart series default to the brand, not the marker", () => {
      const doc = brandKit();
      expect(doc).toMatch(/--color-brand-500/);
      expect(doc).toMatch(/rgb\(0 123 255 \/ \.12\)/);
    });

    it("the enforcement section narrates the cyan-ramp and rounded-full retirements", () => {
      const doc = brandKit();
      expect(doc).toMatch(/two more rows/i);
    });
  });
  ```

- [ ] **Step 2 — run it, confirm the failure**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: the six new `it`s in the second describe block fail (the file still has 36px/no wordmark, still says "a full pill", still has `--radius-frame` at 0, no top-bar-wordmark sentence, `bg-marker` instead of `brand-500`, no "two more rows" narration); the five from the prior task still pass.

- [ ] **Step 3 — implement: §3 Typography**

  Replace the display-face paragraph:

  OLD (lines 176-181):
  ```
  **The display face is deleted.** Instrument Sans ran page titles, the landing
  hero and the metric numeral. The distinction this interface draws is between the
  chrome and the NUMBER, and 36px at -0.03em against a 14px interface already
  carries it; a second family was buying separation the size step had paid for.
  `.font-display` survives as a tracking utility (-0.022em) and `.stat-numeral` as
  the ledger figure.
  ```
  NEW:
  ```
  **The display face is deleted.** Instrument Sans ran page titles, the landing
  hero and the metric numeral. The distinction this interface draws is between the
  chrome and the NUMBER, and a tile's headline dropped from 36px to **28px** in
  this pass — the Figma draws it smaller than the console did — but the
  separation still does not need a second family: 28px Inter 600 against a 15px
  interface still reads as the loudest thing on the tile. `.font-display`
  survives as a tracking utility (-0.022em) and `.stat-numeral` is now `28px /
  40px`, `font-family: var(--font-inter, "Inter"), var(--font-sans)` — Inter
  named explicitly, because the numeral is the one place the Figma names a face
  rather than asking for the platform's own.
  ```

  Update the type table's numeral row:

  OLD (line 193):
  ```
  | `text-display-md` | 36 | the tile's headline number |
  ```
  NEW:
  ```
  | `text-display-md` | 28 | the tile's headline number — Inter 600, 40px line, via `.stat-numeral` |
  ```

  Insert two new paragraphs after the type table (before `**The micro-label
  voice**`, i.e. right after the sentence ending `...marketing and the landing
  page only, never in-app.` — matching the paragraph following the table at
  line 195's row and preceding line 197's micro-label paragraph):

  NEW (insert between the table and the micro-label paragraph):
  ```
  **The wordmark is a new, standalone class — not a scale step.** `.wordmark`
  sets "Namzilabs" at Inter, 24px, weight **900**, 22px line: the only weight
  above 600 anywhere in the kit, and it earns the exemption for one reason —
  the Figma names Inter 900 for exactly one string in the whole export, and a
  kit that has never bent its own never-700 rule does not get to bend it
  quietly now. `scripts/check-ui.ts`'s `font-bold` ban allow-lists `.wordmark`
  by name. It sits in the top bar's left slot now — the rail's mark moved out
  with it (§5).

  **No new caption step.** The Figma's header actions ("+ Add", "Today",
  "Refresh All") set 12px/550, and its own body copy's inspector reports
  12.11px — both round to the kit's existing `text-xs` (13px) rather than
  earning a new named size: the header actions map to the kit's `xs` button
  size, and captions stay 13px, the closed scale's nearest step. A 12px step
  was considered and rejected for exactly this reason.
  ```

  Replace the weights sentence:

  OLD (lines 207-208):
  ```
  **One name per size**, enforced (§11). Weights are **400 / 500 / 600**; never
  700, and neither Figma export got an exemption for its bold numerals.
  ```
  NEW:
  ```
  **One name per size**, enforced (§11). Weights are **400 / 500 / 600 — plus,
  now, two named exceptions and nothing else.** `.wordmark` is one, at 900
  (above). The rail's workspace-switcher badge is the other: its initial sets
  at 13px/**700**, because a one-character badge is not prose and the rule
  this file has never bent was always about text. Every other request for 700
  or 900 either Figma export made — and both made several — shipped at 500 or
  600 regardless.
  ```

- [ ] **Step 4 — implement: §4 Shape & elevation, full rewrite**

  Replace lines 210-231 (`## 4. Shape & elevation` body, from `**Everything
  that contains something is 10px**` through `...a hairline of light is the
  only thing that reads as height.`) with:

  ```markdown
  **Everything that contains something is 10px** — `--radius-card` and
  `--radius-surface` are still the same value, and still true of a card, a
  popover and a menu under this Figma as much as the last one.

  **Everything you press is 8px. There is no pill, and this is recorded as
  the final word on the question.** The shape rule has flipped between a
  pill and a rounded rectangle more than once now (see the retired-token
  table in §2), and each flip changed the argument along with the answer.
  This one does not leave room for a third: the 4 September 2026 Figma is
  named here as the reference, and the rule is that a button, a chip's
  container, an input, a select, a tab, a nav row and the period switch are
  ALL `rounded-control` (8px), full stop. `buttonVariants`' base class drops
  `rounded-full` for `rounded-control`; `ui/page.tsx`'s `PERIOD_TRACK` and
  `PERIOD_PILL` do the same; `tests/console-theme.test.ts`'s pin flips from
  asserting a pill to asserting `rounded-control`. **Circles are reserved for
  four things only: an avatar, the bell's unread badge, the freshness dot,
  and the tile's "active count" numeral** — nothing that reads as an action
  is ever fully round again. The WRAP exception the last pill era needed —
  `rounded-control` on a two-line box, because a full radius there renders as
  a circle around the words — is no longer an exception to anything: 8px is
  simply what every button already is.

  **A badge is 4px.** `--radius-frame` is **8px** again — not the 0 it was
  cut to two days ago, and not because that reasoning was wrong: it argued
  that a notch drawn into a colour identical to what sits behind it draws
  nothing, which was true of a single-surface shell. The panel this Figma
  draws is `#181818`, meeting a top bar and a rail that are genuinely
  `#111111` — a real, if narrow, colour change — so the frame token has
  somewhere to point again. It rounds the panel's top-left corner — the one
  nearest the rail — regardless of whether the rail is at rest or open;
  nothing about the top bar's own corners changes. See Layout (§5).

  **Shadows barely exist here, still.** `--shadow-card` is now the Figma's
  own card shadow — `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 / .10)` —
  the same value in both themes rather than a dark-only rule with nothing to
  floor it on light. The ladder keeps its other rungs so vendored components
  compile, and the same two are ever chosen on purpose: `shadow-card` in the
  page flow, `shadow-pop` for anything floating, with the floating rungs
  keeping their white inset ring on dark — a hairline of light is still the
  only thing that reads as height on a near-black surface.
  ```

- [ ] **Step 5 — implement: §5 Layout & spacing, insert shell dressing**

  Insert two new paragraphs immediately after the existing closing paragraph
  of §5 (after `...jumps the page 1px in each axis at hydration.`, line 272,
  and before `## 6. Components`):

  ```markdown

  **The top bar now carries the wordmark, and the rail does not.** Full
  width, 60px, `--chrome` fill, `--border` bottom rule. Left: `.wordmark` —
  moved out of the rail, because a name that only appears once per session
  should not live inside a column that is 56px wide most of the time.
  Centre: "Welcome back{, name}!". Right: Invite members and New flow as
  `secondary` 32px buttons with 16px icons, the bell (a 32px `--avatar`
  circle with its badge count), the avatar circle (initials, 13px/600).
  `#topbar-slot` and `#topbar-status` — the two portals the flow builder's
  own chrome uses — are unchanged; the builder's toolbar still lands in the
  same bar, it is just a bluer, three-surfaced bar underneath it now.

  **The rail's dressing changed; its behaviour did not (decision 3).** It is
  still a hover rail: 56px of icons at rest on `--chrome`, opening in place
  to 260px. What used to be a bare icon column now expands into, top to
  bottom: a workspace switcher row (a 28px `rounded-control` square tinted
  `rgb(0 123 255 / .75)` carrying the initial in white at 13px/700 — the
  exception §3 names — the workspace name at 15px/600, and a chevron), a
  search field styled exactly like a real `Input` (`--control` fill,
  `--border` outline, a magnifier, "Search", a ⌘K hint) that opens the same
  command palette a real search box would, a "Main Menu" caps label in
  `--faint` at 12px, nav rows at 36px with 18px icons (the active row takes
  a `--control` fill — **not** a coloured glyph; the "location" job left the
  brand with this Figma, per §2), Dashboard's sub-items at 32px indented
  under an 8px dash marker, and at the foot a full-width `primary` "New
  flow" button above a "Get Free Access" row (a bell icon carrying a small
  blue dot, the label muted). The collapse/pin cookie behaviour — what
  actually opens and closes the column — is untouched; only what is drawn
  inside it changed.

  **The panel takes the corner, not the frame.** `AppFrame` renders the top
  bar above a row of `[rail | panel]`; the panel is `--panel` with an 8px
  top-left corner where it meets the top bar beside the rail — the one
  corner in the shell where three different surfaces (bar, rail, panel)
  meet at once. `shell-skeleton.tsx` mirrors the geometry by hand, same as
  it always has, and `tests/page-width.test.ts` is the pin that keeps the
  mirror honest.
  ```

- [ ] **Step 6 — implement: §6 Components, append token-level facts**

  Insert a new paragraph immediately after the existing §6 paragraph (the one
  ending `...never a re-typed class string.`, line 297) and before `##
  7. Interaction`:

  ```markdown

  **What this pass actually touches in these files, without changing what any
  of them mean:** `Button`'s base class carries `rounded-control` rather than
  `rounded-full` (§4); its `secondary` variant paints `bg-secondary
  text-secondary-foreground` and, in the light theme only, adds an `--input`
  outline — the Figma's own grey buttons are white with a hairline edge, not
  a filled grey; `accent` and `primary` both fill with `--primary` under
  white ink. Sizes are untouched — 32px is still the default height, in both
  themes, for every one of the eleven variants. `Card` fills with `--card`,
  edges with `--border`, and floats on `--shadow-card`, all three carrying
  new values from §2 without a line of the component changing. `Tabs`' line
  variant draws its active rule from `--rule` — the heavier control-edge
  step, not the hairline itself — and keeps 8px corners. `Avatar`'s fallback
  initials and its group-count overflow chip both fill with `--avatar` now,
  the same token, so a stack of avatars and the "+3" that follows it are one
  material. `Input`'s `Textarea` takes `rounded-control` — the comment above
  it used to say 8px while the class read something else, resolved toward
  the comment — and its two stale `9999px` comments (left over from the
  pill era before this one) are corrected to say what the class actually
  renders. `ui/page.tsx`'s `PERIOD_TRACK` and `PERIOD_PILL` both move to 8px
  corners, and `PageHeader`'s title is centred — tab strip left (an active
  tab at 15px/600 in `--heading` with a 1px `--muted-foreground` bottom rule
  and a "…" menu; inactive tabs 15px/500, muted; a 28px `secondary` "+"
  square), the title itself centred at 26px/600 with its pencil, and actions
  on the right (a `primary` `xs` "+ Add"; `secondary` `xs` "Today" and
  "Refresh All" with 16px icons — "Refresh All" keeps the `accent` variant it
  already had, because blue is spent on "+ Add" and "New flow" only).
  ```

- [ ] **Step 7 — implement: §9 Data visualization**

  Replace the opening paragraph:

  OLD (lines 365-368):
  ```
  **Marks are the MARKER** (`bg-marker`); target-met `success`; bottleneck
  `danger`; tracks `bg-muted`. Bars never `bg-neutral-800`. Headline numbers per
  §3. One `Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
  `src/components/charts.tsx`, shared by every tile.
  ```
  NEW:
  ```
  **Marks are the BRAND now, not the marker.** The Figma's own chart draws
  its series in the same blue as its buttons: `--color-brand-500` (`#007BFF`)
  is the default series colour, an area fill under a line is `rgb(0 123 255 /
  .12)`, a bar is `#007BFF` flat, and a comparison series (yesterday's line
  beside today's) steps down to the ramp's 300 (`#66B2FF`) rather than a
  second hue — "today vs yesterday" reads as one series at two strengths, not
  two things competing for attention. Target-met stays `success`; bottleneck
  stays `danger`; tracks stay `bg-muted`. Headline numbers per §3 — 28px now,
  not 36. One `Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
  `src/components/charts.tsx`, shared by every tile.

  *Why the series left the marker.* The marker argument two days ago was
  that a bar is a shape read by its edge, with no ink of its own to carry
  contrast — true when the brand was a stroke colour with nothing to spare
  for a second job. This blue already carries two jobs (§2: a stroke *and*
  a fill), and the Figma's own chart uses the fill job for its series, so
  the marker no longer needs to cover for it. `GROUP_ACCENT` in the flow
  builder is untouched — the canvas is out of scope regardless of which
  token wins here.
  ```

  Replace the tile-edge opening claim and its detail paragraph:

  OLD (line 400-402, opening two sentences):
  ```
  **One card, and it wears its column on its leading edge.** Every tile on the
  groups board — a materialized flow Output and a legacy `metrics` row alike —
  renders through `MetricCard`.
  ```
  NEW:
  ```
  **One card. It does NOT wear its column on its leading edge any more — on
  the default board.** Every tile on the groups board — a materialized flow
  Output and a legacy `metrics` row alike — renders through `MetricCard`. The
  Figma draws no coloured edge on a metric tile at all, and the kit follows
  it: the 4px `--tile-edge` strip is removed from the default board's
  rendering. The token is not deleted — the canvas board, where a step
  card's own leading edge is exactly this idea and is explicitly out of
  scope for this pass, still reads it, so `--tile-edge` stays defined and
  simply gains one fewer consumer.
  ```

  OLD (lines 408-416, the paragraph beginning "The card is one block of
  padding with a 4px leading edge..."):
  ```
  The card is one block of padding with a 4px leading edge in its group's colour,
  borrowed from the builder's step card. The colour arrives as `--tile-edge`, set
  by the lane in `board-column.tsx` and read by inheritance — so a tile dragged to
  another column changes allegiance on the frame it lands, with nothing threaded
  through a server-rendered node, and the ungrouped row falls back to `--border`
  rather than claiming a group. Content takes the slack (`flex-1 justify-center`,
  so a bare scalar centres instead of hanging off the top of a stretched card) and
  the footline is welded to the bottom, because a ragged row of footers is §5's
  difference between a board and a pile.
  ```
  NEW:
  ```
  The card is one block of padding, `p-4`, with no coloured edge on the
  default board now — the leading-edge idea moves entirely to the canvas
  board, where a step card already draws exactly this, and `--tile-edge`
  stays wired for it: set by the lane in `board-column.tsx`, read by
  inheritance, so a tile dragged to another column on the canvas board
  changes allegiance on the frame it lands, with nothing threaded through a
  server-rendered node. Content still takes the slack (`flex-1
  justify-center`, so a bare scalar centres instead of hanging off the top
  of a stretched card) and the footline is still welded to the bottom,
  because a ragged row of footers is §5's difference between a board and a
  pile — losing the coloured edge does not mean losing the discipline that
  made the tile readable without it.
  ```

- [ ] **Step 8 — implement: §11 Enforcement, narrate the new retired-token rows**

  Insert a new paragraph immediately after the existing paragraph beginning
  `**\`retired token\` is the rule this re-theme earned the hard way.**`
  (lines 459-467) and before `**\`dead dark: variant\`** exists because...`:

  ```markdown

  **This pass adds two more rows to §2's table rather than a new mechanism.**
  The cyan ramp's own values (`#00CDF5`/`#00C0E8`) are retired now that the
  ramp holds `#007BFF`/`#0070E8` instead — a class name that keeps compiling
  under a new value is not the same failure a dead class is, but it earns a
  row for the same reason: a value that changed under a name that did not is
  exactly the kind of fact a comment forgets and a table does not.
  `rounded-full` on `buttonVariants`' base class is the second row, and it is
  the one to read carefully — the CLASS still compiles (avatars, the bell
  badge, the freshness dot and the active-count numeral all keep using
  `rounded-full` on purpose), so nothing here is a dead-class failure either.
  The row exists because this is the shape rule's second flip (§4), and a
  rule that has flipped twice with no paper trail is a rule a third flip will
  not bother explaining either.
  ```

- [ ] **Step 9 — run it green**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all eleven `it`s across both describe blocks pass.

- [ ] **Step 10 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/retheme-blue-docs.test.ts && pnpm check:ui
  ```

- [ ] **Step 11 — commit**

  ```bash
  git add docs/BRAND_KIT.md tests/retheme-blue-docs.test.ts
  git commit -m "$(cat <<'EOF'
  Carry the blue re-theme through BRAND_KIT's type, shape, layout,
  components and enforcement sections

  The tile numeral drops to 28px and gains a named wordmark exception;
  every pressable control is 8px with no pill, named final against the
  4 September 2026 Figma; the top bar now carries the wordmark and the
  rail's dressing (not its hover behaviour) changes; charts default to
  the brand rather than the marker; and the retired-token table records
  the cyan ramp and rounded-full-on-buttons as two more rows.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 17: DESIGN.md — rewrite in lockstep, and fix the §10 canvas-bg sentence

**Files**
- Modify: `DESIGN.md`
- Modify: `tests/retheme-blue-docs.test.ts`

**Interfaces**
- Consumes: `docs/BRAND_KIT.md` (rewritten by the prior two tasks) — DESIGN.md is the argued half of the same facts and must not disagree with it.
- Produces: `DESIGN.md` frontmatter + §2 + §5 + §6 rewritten; §10's `--canvas-bg` sentence fixed to say what actually happens now that `--background` moves and `--canvas-bg` does not.

- [ ] **Step 1 — extend the failing test**

  Add to `tests/retheme-blue-docs.test.ts`:

  ```ts
  describe("DESIGN.md matches the blue re-theme in lockstep", () => {
    const designMd = () => readFileSync(join(root, "DESIGN.md"), "utf8");

    it("frontmatter names the new accent, not the cyan one", () => {
      const doc = designMd();
      expect(doc).toMatch(/#007BFF/);
      expect(doc).not.toMatch(/accent: one blue \(#00C0E8\)/);
    });

    it("section 2 argues three surfaces, not one", () => {
      const doc = designMd();
      expect(doc).toMatch(/#0F1011/);
      expect(doc).toMatch(/#111111/);
      expect(doc).toMatch(/#181818/);
    });

    it("section 5 names the Figma as the final shape reference", () => {
      const doc = designMd();
      expect(doc).toMatch(/4 September 2026 Figma/);
      expect(doc).not.toMatch(/Everything you press is a full pill; everything you type in is 8px/);
    });

    it("section 6 documents the 28px numeral and the wordmark", () => {
      const doc = designMd();
      expect(doc).toMatch(/28px/);
      expect(doc).toMatch(/\.wordmark/);
    });

    it("the section 10 canvas-bg sentence is no longer self-contradictory", () => {
      const doc = designMd();
      expect(doc).not.toMatch(/keeps its previous value `#1B191A` rather than moving\s+to `#1B191A`/);
      expect(doc).toMatch(/rather than moving to (this pass's )?`#0F1011`/);
    });
  });
  ```

- [ ] **Step 2 — run it, confirm the failure**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all five new `it`s fail against the current file (old accent hex, one-surface §2, pill-era §5, 36px/no-wordmark §6, and the same-hex-twice §10 sentence); all eleven from the prior two tasks still pass.

- [ ] **Step 3 — implement: frontmatter**

  OLD (lines 1-12):
  ```
  ---
  name: Namzilabs
  tagline: Six tools disagree; this one answers in a figure you can defend.
  register: quiet chrome, loud numbers
  surfaces: [ground (rail + top bar + page), card, control, raised, floating]
  themes: dark (the console) + light · per device · defaults to the OS
  accent: one blue (#00C0E8) · 500 draws on dark, 900 on light · 600 fills on both
  neutral: one ramp, cut for #1B191A — five surfaces below, four inks above
  type: SF Pro (system) / Inter · 11 · 13 · 15 · 17 · 18 · 20 · 26 · 36 · 48
  radius: 4 badge · 8 field · 10 everything that contains something · full button, chip and avatar
  status: chrome, furniture and primitives SETTLED · metric card and chart card IN PROGRESS
  ---
  ```
  NEW:
  ```
  ---
  name: Namzilabs
  tagline: Six tools disagree; this one answers in a figure you can defend.
  register: quiet chrome, loud numbers
  surfaces: [page, chrome (top bar + rail + card), panel (the content area), control, raised, floating]
  themes: dark (the console) + light · per device · defaults to the OS
  accent: one blue (#007BFF) · 400 strokes on dark, 800 strokes on light · 600 fills on both
  neutral: one ramp, re-cut for three darks (#0F1011 / #111111 / #181818) — eight surface steps below the gap, two ink steps above it, one caps-label-only step between them
  type: SF Pro (system) / Inter · 11 · 13 · 15 · 17 · 18 · 20 · 26 · 28 · 48
  radius: 4 badge · 8 field, button and chip · 10 everything that contains something · full avatar, bell badge, freshness dot and active-count numeral
  status: chrome, furniture and primitives SETTLED · metric card and chart card IN PROGRESS
  ---
  ```

- [ ] **Step 4 — implement: §2, full rewrite**

  Replace `## 2. One surface, and the hairline that is now structural` through
  the end of that section (lines 42-84, up to but not including `## 3. Five
  surfaces, and which direction each one goes`) with:

  ```markdown
  ## 2. Three surfaces, and the hairline that is still structural

  The product's identity was **a single near-black surface** two days ago —
  `#1B191A` carrying a 56px icon rail, a 60px bar and the page inside them,
  all one colour. The 4 September 2026 Figma draws three: the page is
  `#0F1011`, the top bar and the rail (and every card) are `#111111`, and
  the content panel sitting under the top bar — where the board and its
  tiles live — is `#181818`. **This reverses the reversal.** The one-surface
  thesis was this file's own central argument two days ago, made
  deliberately (a 40-point luminance step needs no help finding its own
  edge, and a rule drawn where two identical surfaces meet does nothing);
  it is reversed again here, just as deliberately, because the surfaces are
  no longer identical and the hairline has a job to do that it did not have
  before.

  The three are close on purpose, not despite the purpose: `#111111` on
  `#0F1011` measures **1.01:1**, and `#181818` on `#0F1011` measures
  **1.07:1** — both TIGHTER than the 1.14:1 gap the previous surface ran
  between its ground and its cards. **The hairline is doing more work now,
  not less.** Every separation that is not one of those two steps is the
  same 1px `#343434` rule as before, recut for the new ground:

  - The rail's `border-r` and the bar's `border-b` are unchanged in kind —
    they take a real pixel each, and `ShellSkeleton` mirrors both for the
    same reason it always did: a ghost without them jumps the content at
    hydration.
  - **The notch is back.** `--radius-frame` was 0 because a corner cut into
    `#1B191A` to reveal `#1B191A` draws nothing. The panel it now cuts into
    is `#181818`, sitting beside a rail and under a bar that are `#111111`
    — a real, if narrow, colour change — so the same argument that retired
    the notch two days ago is exactly the argument that reinstates it here:
    a radius reveals whatever is behind it, and there is something behind
    it again.
  - **The rail's glyphs still sit on nothing at rest** — the surface behind
    them is `--chrome`, and a bare icon measures the same 14+:1 it always
    did against a near-black ground, chrome or otherwise.
  - **The focus ring is still one ring.** It is blue at `--marker`'s new
    measurement — 6.65:1 on the page, 6.59:1 on the chrome, 6.20:1 on the
    panel — on every one of the three surfaces rather than the one this
    file used to have to cover.

  **Cards still need their border, and for almost the same reason as two
  days ago — just not the one you'd guess.** `--card` is `#111111`: on the
  `#0F1011` page that is **1.01:1**, and on the `#181818` panel a card
  usually sits on, it is **1.06:1** — lighter to darker rather than the old
  "cards step up" direction, and close enough either way that eye and
  instrument disagree about which one is which. A card without its border
  is still not a flatter card, it is an invisible one; what changed is that
  there are now three surfaces this is true of instead of one, and the
  border has to say so on all three.

  The rail carries no labels at rest, same as two days ago, and it still
  opens: point at it and the column widens in place to 260px. What sits
  inside the open column changed — a tinted switcher badge, a search field,
  a "Main Menu" label, nav rows on a neutral fill rather than a coloured
  glyph — and the written kit's own Layout section is where that is
  itemised; the mechanism itself (hover, a cookie, a fixed 56px rest state)
  did not move.
  ```

- [ ] **Step 5 — implement: §5 Shape, full rewrite**

  Replace `## 5. Shape` through its end (lines 189-223, up to but not
  including `## 6. Type`) with:

  ```markdown
  ## 5. Shape

  **Everything that contains something is still 10px.** Cards, panels,
  popovers, selects, the period track, tables — unchanged by this pass,
  because the argument for one container radius never depended on which
  theme sat under it.

  **Everything you press is 8px, and there is no pill this time — nor is
  there a next time.** This has flipped between a pill and a rounded
  rectangle twice now: the reference before the cyan console pilled every
  pressable thing, the cyan console kept the pill, and this Figma draws
  none. Two flips with no stated reference produced a genuine "which one is
  right" argument each time; this file names the 4 September 2026 Figma as
  the reference specifically so a third flip needs a new design behind it,
  not a preference. `buttonVariants`' base class carries `rounded-control`
  (8px) rather than `rounded-full`; the period track's segments do the
  same. The WRAP exception the last flip needed — a control that wraps to
  two lines cannot be a pill, because a full radius on a two-line box
  renders as a circle around the words — does not reopen, because nothing
  here is a pill for that exception to be an exception to. `rounded-control`
  simply is what a button is now.

  **Circles are reserved for four things, and reading as an action is no
  longer one of them:** an avatar, the bell's unread badge, the freshness
  dot, and the tile's "active count" numeral. Nothing that a person presses
  is ever fully round.

  **A badge is 4px. A card is 10px.**

  **The frame is back.** `--radius-frame` was 0 two days ago because the
  notch's whole argument — a radius reveals whatever sits behind it — had
  nothing to reveal once the shell became one colour. It did not stay one
  colour; see §2. The token is **8px** again, cutting the content panel's
  top-left corner where it meets the top bar beside the rail, which is the
  one place in the shell where three surfaces (bar, rail, panel) actually
  meet.

  **Hairlines still carry structure; shadows still barely exist.** The card
  shadow is now the Figma's own value, `0 1px 2px rgb(0 0 0 / .20), 0 0 3px
  rgb(0 0 0 / .10)`, shared by both themes rather than floored only on
  dark. The elevation ladder keeps its unused rungs so vendored components
  compile, and the same two are ever chosen on purpose — `card` in the page
  flow, `pop` for anything floating, with the floating ones keeping their
  white inset ring on dark.
  ```

- [ ] **Step 6 — implement: §6 Type**

  Replace the display-face paragraph:

  OLD (lines 236-241):
  ```
  **The display face is gone.** Instrument Sans ran page titles, the landing
  hero and the metric numeral, because a page set entirely in Inter is the house
  style of every dashboard built since 2019. That argument is answered rather than
  abandoned: the distinction this interface draws is between the chrome and the
  NUMBER, and 36px at -0.03em against a 14px interface already carries it. A
  second family was buying separation the size step had paid for.
  ```
  NEW:
  ```
  **The display face is still gone, and the number holding its place got
  smaller.** Instrument Sans ran page titles, the landing hero and the metric
  numeral; the distinction this interface draws is between the chrome and the
  NUMBER, and that argument does not need the numeral to be 36px to work —
  this Figma draws it at **28px**, Inter 600, and 28 against a 15px interface
  still reads as the loudest thing on the tile. A second family was buying
  separation the size step had already paid for, at 36 or at 28 either one.
  ```

  Insert a new paragraph after the "A chip is the one small object that is
  NOT caps" paragraph (after line 257) and before "**One name per size.**"
  (line 259):

  ```markdown

  **The wordmark is new, and it is not a scale step.** "Namzilabs" sets in a
  class of its own, `.wordmark` — Inter, 24px, weight 900, 22px line —
  because this is the one string in the whole Figma the export actually
  names a face and a weight for, rather than asking for the platform's own
  UI font at whatever this kit already runs. It moved out of the rail into
  the top bar's left slot in the same pass (§2, above), which is the more
  visible of the two changes: a wordmark that only appeared once per
  session, inside a column that is 56px wide most of the time, was never
  going to be the thing anyone noticed move.
  ```

  Replace the weights paragraph:

  OLD (lines 264-266):
  ```
  Weights are 400 / 500 / 600. Never 700 — and neither rebrand's source got an
  exemption. Both Figma exports set small numerals and chrome labels at 700;
  `check:ui` fails on `font-bold`, so all of them shipped at 500 or 600.
  ```
  NEW:
  ```
  Weights are 400 / 500 / 600 — plus, now, exactly two named exceptions.
  `.wordmark` is one, at 900. The rail's workspace-switcher badge is the
  other: its initial sets at 13px/700, because a one-character badge is not
  prose and the rule this file has never bent was always about text. Every
  other request for 700 or 900 either Figma export made shipped at 500 or
  600 regardless — `check:ui` fails on `font-bold` for everything but these
  two named classes.
  ```

- [ ] **Step 7 — implement: §10, fix the canvas-bg sentence**

  OLD (lines 380-385):
  ```
  **The builder's canvas.** Out of scope for this pass by instruction. One visible
  consequence: `--canvas-bg` keeps its previous value `#1B191A` rather than moving
  to `#1B191A`, so the canvas sits six counts off the chrome around it. That is a
  known seam, not an oversight. The builder's *chrome* — its toolbar, config panel
  and modals — follows the primitives and so inherits the new control ladder
  without having been redesigned.
  ```
  NEW:
  ```
  **The builder's canvas.** Out of scope for this pass by instruction, same as
  last time. `--canvas-bg` keeps its frozen value, `#1B191A` — the OLD page
  ground, from before either retheme — rather than moving to this pass's
  `#0F1011`. Two days ago that value happened to equal the page ground,
  which is the coincidence that closed a seam a previous pass had opened;
  this pass reopens it, on purpose, because moving `--canvas-bg` would be a
  canvas decision and none has been made. It is the same seam a previous
  pass closed by coincidence, not a new one — the builder's *chrome* (its
  toolbar, config panel and modals) still follows the primitives, so it
  inherits every token change in this pass without the canvas itself having
  been touched.
  ```

- [ ] **Step 8 — run it green**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all sixteen `it`s across all three describe blocks pass.

- [ ] **Step 9 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/retheme-blue-docs.test.ts && pnpm check:ui
  ```

- [ ] **Step 10 — commit**

  ```bash
  git add DESIGN.md tests/retheme-blue-docs.test.ts
  git commit -m "$(cat <<'EOF'
  Rewrite DESIGN.md in lockstep with the blue BRAND_KIT, and fix the
  canvas-bg sentence

  Frontmatter, the surface argument (section 2), the shape argument
  (section 5) and the type argument (section 6) now match BRAND_KIT.md's
  three-surface, no-pill, 28px-numeral blue console. Section 10's
  self-contradictory canvas-bg sentence (quoting the same hex as both
  the old and the new value) is corrected to say what actually happens:
  the canvas stays frozen at the OLD page ground while the page itself
  moves on, reopening a seam a previous pass had closed by coincidence.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 18: /design page — rewrite the swatch, radius and direction specimens; log STATE.md

**Files**
- Modify: `src/app/design/page.tsx`
- Modify: `STATE.md`
- Modify: `tests/retheme-blue-docs.test.ts`

**Interfaces**
- Consumes: `docs/BRAND_KIT.md` §2 (rewritten by task 1) for the exact hex/step names; the tokens-owning area's `globals.css` additions (`--color-neutral-925`, `--color-neutral-850`, `--color-neutral-450`, `--color-brand-800`, `--color-brand-900`, `--text-display-md` at 28px / 1.75rem) — `tests/design-swatches.test.ts` (pre-existing, unmodified by this task) only goes fully green once that area's tokens land; this task's own new assertions do not depend on it.
- Produces: `src/app/design/page.tsx`'s `BRAND`/`SURFACE`/`INK` swatch arrays, the `TYPE` table's numeral row, the `RADII` array, and the four affected `DIRECTION` rows, all updated for the blue console; `STATE.md` gains a dated line recording the retheme.

- [ ] **Step 1 — extend the failing test**

  Add to `tests/retheme-blue-docs.test.ts`:

  ```ts
  describe("/design's swatch and radius arrays reflect the blue re-theme", () => {
    const page = () => readFileSync(join(root, "src/app/design/page.tsx"), "utf8");

    it("the brand ramp includes the new blue steps", () => {
      const src = page();
      expect(src).toMatch(/hex:\s*"#007bff"/);
      expect(src).toMatch(/hex:\s*"#0070e8"/);
    });

    it("the surface ramp includes the three new dark steps", () => {
      const src = page();
      expect(src).toMatch(/bg-neutral-925/);
      expect(src).toMatch(/bg-neutral-850/);
      expect(src).toMatch(/bg-neutral-450|neutral-450/);
    });

    it("RADII and DIRECTION agree: control is 8px, not a pill", () => {
      const src = page();
      expect(src).not.toMatch(/control · pill/);
      expect(src).toMatch(/control · 8px/);
    });

    it("the headline numeral caption is 28px", () => {
      const src = page();
      expect(src).toMatch(/token:\s*"text-display-md"[^}]*?px:\s*"28px"/);
    });
  });

  describe("STATE.md records the retheme", () => {
    it("has a dated line about the blue console", () => {
      const doc = readFileSync(join(root, "STATE.md"), "utf8");
      expect(doc).toMatch(/4 September 2026/);
      expect(doc).toMatch(/#007BFF/);
    });
  });
  ```

- [ ] **Step 2 — run it, confirm the failure**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all five new `it`s fail (no `#007bff`/`#0070e8` swatch rows yet, no `neutral-925`/`850`/`450` classes, `RADII` still says "control · pill", the numeral caption is still `36px`, and `STATE.md` has no 4 September line); all sixteen from the prior three tasks still pass.

- [ ] **Step 3 — implement: BRAND array and its comment**

  Replace the comment block and array (lines 67-95):

  OLD:
  ```tsx
  /**
   * THE BRAND RAMP IS ONE BLUE, AND IT NO LONGER NEEDS A SECOND COLOUR BESIDE
   * IT.
   *
   * This table used to be printed next to a violet one, because the two were the
   * halves of a single rule: `brand-*` was what a FILLED object is and `marker-*`
   * was what a LINE is, and the split existed because #eecf00 measures 1.55:1 as
   * a stroke on white and 11.24:1 as a fill. The brand could only ever safely do
   * one of the two jobs.
   *
   * On #1b191a the blue is 9.20:1 as a stroke and 8.08:1 as a fill under
   * near-black ink. Both clear their bar, so 500 DRAWS and 600 FILLS as two steps
   * of one ramp rather than as two colours covering for each other.
   *
   * HOVER WALKS UP, NOT DOWN, and that inverted with the surface: on a light
   * ground brightening the brand moved it toward the white behind it and the
   * label's contrast fell at the moment of the press. On near-black, raised means
   * lighter.
   */
  const BRAND: Array<{ step: string; cls: string; hex: string }> = [
    { step: "50", cls: "bg-brand-50", hex: "#e0f7fd" },
    { step: "100", cls: "bg-brand-100", hex: "#b5ecfa" },
    { step: "200", cls: "bg-brand-200", hex: "#7fdff6" },
    { step: "300", cls: "bg-brand-300", hex: "#45d2f2" },
    { step: "400", cls: "bg-brand-400", hex: "#1ac9ed" },
    { step: "500", cls: "bg-brand-500", hex: "#00cdf5" },
    { step: "600", cls: "bg-brand-600", hex: "#00c0e8" },
    { step: "700", cls: "bg-brand-700", hex: "#00a6c9" },
  ];
  ```
  NEW:
  ```tsx
  /**
   * THE BRAND RAMP IS ONE BLUE, DOING TWO JOBS — NOT THREE.
   *
   * The cyan console ran a ring for identity, a glyph for location, a fill for
   * action. The 4 September 2026 Figma this pass builds from does not mark
   * location with the brand at all — the rail's active row is a NEUTRAL
   * `--control` fill now, not a coloured glyph — so colour is left doing
   * exactly two things: drawing a STROKE (`--marker`) and painting a FILL
   * (`--primary`).
   *
   * `#3D9BFF` (400) is the dark stroke, 6.65:1–6.20:1 across the three dark
   * surfaces. `#0070E8` (600) is the fill under white ink, 4.68:1 — one step
   * deeper than `#007BFF` (500, the brand's own hex), because the Figma's own
   * blue measures 3.98:1 under white and a 15px label owes 4.5.
   *
   * HOVER STILL WALKS UP ON DARK, DOWN ON LIGHT: 600 fill → 500 on hover on
   * dark, 600 → 700 on light, because brightening a fill under the pointer on
   * a light page moves it toward the white behind it and the label's contrast
   * falls at the moment of the press.
   */
  const BRAND: Array<{ step: string; cls: string; hex: string }> = [
    { step: "50", cls: "bg-brand-50", hex: "#e6f2ff" },
    { step: "100", cls: "bg-brand-100", hex: "#cce5ff" },
    { step: "200", cls: "bg-brand-200", hex: "#99cbff" },
    { step: "300", cls: "bg-brand-300", hex: "#66b2ff" },
    { step: "400", cls: "bg-brand-400", hex: "#3d9bff" },
    { step: "500", cls: "bg-brand-500", hex: "#007bff" },
    { step: "600", cls: "bg-brand-600", hex: "#0070e8" },
    { step: "700", cls: "bg-brand-700", hex: "#0069d9" },
    { step: "800", cls: "bg-brand-800", hex: "#0062cc" },
    { step: "900", cls: "bg-brand-900", hex: "#0056b3" },
  ];
  ```

- [ ] **Step 4 — implement: SURFACE array and its comment**

  Replace lines 96-117:

  OLD:
  ```tsx
  /**
   * THE SURFACE HALF of the neutral ramp — the five steps the interface is built
   * out of, and they are five because the product has five surfaces and not
   * because five is a nice number.
   *
   * 950 is the GROUND, and the rail, the top bar and the page are all of it: one
   * colour, with a 1px 600 hairline doing every separation in the product. 800 is
   * a CARD, which is a 1.14:1 step off the ground — a step you can measure and
   * not one you can see, which is why a card without its border is an invisible
   * card rather than a flat one. 900 is a CONTROL, one step DOWN from a card, so
   * a select reads as a recessed slot rather than a raised chip. 700 is RAISED —
   * a hover, a menu row, the toast. 500 is the heavier rule a checkbox or a
   * switch track owes.
   */
  const SURFACE: Array<{ step: string; cls: string; hex: string }> = [
    { step: "950", cls: "bg-neutral-950", hex: "#1b191a" },
    { step: "900", cls: "bg-neutral-900", hex: "#211f20" },
    { step: "800", cls: "bg-neutral-800", hex: "#272426" },
    { step: "700", cls: "bg-neutral-700", hex: "#332f31" },
    { step: "600", cls: "bg-neutral-600", hex: "#3d393b" },
    { step: "500", cls: "bg-neutral-500", hex: "#4d494b" },
  ];
  ```
  NEW:
  ```tsx
  /**
   * THE SURFACE HALF — eight steps now, not five, because the shell has three
   * dark grounds instead of one.
   *
   * 950 is the PAGE. 925 and 900 are the two new steps this pass adds: 925 is
   * the CHROME (top bar, rail, and every card) and 900 is the PANEL — the
   * content area under the top bar, which the board and its tiles actually sit
   * on. 850 is a third new step, the CONTROL (fields, the search box, the
   * active nav row) — one step down from the surfaces around it, so a select
   * still reads as a recessed slot. 800 is SECONDARY (grey buttons); 700 is
   * AVATAR (icon and initials circles); 600 is the HAIRLINE; 500 is the
   * heavier RULE a switch track or table divider owes.
   *
   * The three darkest steps sit within a hair of each other on purpose:
   * 925-on-950 measures 1.01:1 and 900-on-950 measures 1.07:1, both tighter
   * than the single 1.14:1 step the two-day-old console ran between its one
   * ground and its cards. The border is not decoration on a surface you can
   * already tell apart from its neighbour — it is the only thing that does.
   */
  const SURFACE: Array<{ step: string; cls: string; hex: string }> = [
    { step: "950", cls: "bg-neutral-950", hex: "#0f1011" },
    { step: "925", cls: "bg-neutral-925", hex: "#111111" },
    { step: "900", cls: "bg-neutral-900", hex: "#181818" },
    { step: "850", cls: "bg-neutral-850", hex: "#202020" },
    { step: "800", cls: "bg-neutral-800", hex: "#333333" },
    { step: "700", cls: "bg-neutral-700", hex: "#3a3a3a" },
    { step: "600", cls: "bg-neutral-600", hex: "#343434" },
    { step: "500", cls: "bg-neutral-500", hex: "#4a4a4a" },
  ];
  ```

- [ ] **Step 5 — implement: INK array and its comment**

  Replace lines 118-143:

  OLD:
  ```tsx
  /**
   * THE INK HALF — four values, and the count is the point.
   *
   * The reference this interface is drawn from ships SEVEN greys for text:
   * #ffffff, #e8e6e7, #e5e7eb, #a1a1a1, #b0a9ae, #99a1af and #6a7282. Three of
   * those are within three counts of each other. That is the same failure the
   * type scale was closed to prevent — twelve names over nine sizes — arriving in
   * the colour layer, and it collapses here to one value per job.
   *
   * 400 IS NOT THE REFERENCE'S #6a7282, and this is the one measurement in the
   * kit that overrules the source outright: that value is 3.56:1 on the #272426
   * card the reference sets its own empty-state copy on, against the 4.5:1 body
   * text owes. Raised four steps in the same hue to 4.75:1.
   *
   * There is a deliberate GAP between this half and the surface half above. 500
   * is the last step a LINE may be drawn in and 400 the first that TEXT may be
   * set in; the value that reads as a 1px rule and the value that reads as 12px
   * copy are not the same value, and the product had been pretending they were.
   */
  const INK: Array<{ step: string; cls: string; hex: string }> = [
    { step: "400", cls: "bg-neutral-400", hex: "#948d93" },
    { step: "300", cls: "bg-neutral-300", hex: "#b0a9ae" },
    { step: "200", cls: "bg-neutral-200", hex: "#e8e6e7" },
    { step: "100", cls: "bg-neutral-100", hex: "#eceaeb" },
    { step: "50", cls: "bg-neutral-50", hex: "#fafafa" },
  ];
  ```
  NEW:
  ```tsx
  /**
   * THE INK HALF — two values now, not four, because the Figma draws two.
   *
   * The previous ramp carried 400/300/200/white on the argument that seven
   * greys for text was a "twelve names, nine sizes" failure arriving in
   * colour. This Figma's own ink is simpler than that argument needed: a
   * muted value and a body-and-heading white, nothing between them.
   * `neutral-300` — the old "descriptions, captions" step — is not carried
   * forward as a named role; see BRAND_KIT.md's retired-token table.
   *
   * 400 is `--muted-foreground`: the Figma's own `#7E7E7E` measures 4.37:1 on
   * the panel, and this kit's `#858585` clears 4.81:1 there and 5.12:1 on a
   * card. 200 is `--foreground` / `--heading` / `--card-foreground`, all one
   * value — the Figma sets body AND titles in white, same as the console it
   * replaces.
   *
   * `450` — `--faint`, `#6E6E6E` — sits BETWEEN this half and the surface half
   * above and is deliberately not printed as a swatch here: it is a
   * caps-label-only step (BRAND_KIT.md §2), never body text, and a ramp with a
   * value that is neither surface nor prose is not one more swatch, it is a
   * footnote.
   */
  const INK: Array<{ step: string; cls: string; hex: string }> = [
    { step: "400", cls: "bg-neutral-400", hex: "#858585" },
    { step: "200", cls: "bg-neutral-200", hex: "#ffffff" },
  ];
  ```

- [ ] **Step 6 — implement: TYPE array's numeral row**

  OLD (line 191):
  ```tsx
    { token: "text-display-md", cls: "stat-numeral text-display-md", px: "36px", use: "Headline numbers, via formatMetricValue — the ledger numeral", sample: "1,204" },
  ```
  NEW:
  ```tsx
    { token: "text-display-md", cls: "stat-numeral text-display-md", px: "28px", use: "Headline numbers, via formatMetricValue — the ledger numeral, dropped from 36px this pass", sample: "1,204" },
  ```

- [ ] **Step 7 — implement: RADII array**

  Replace lines 207-218:

  OLD:
  ```tsx
  const RADII: Array<{ cls: string; label: string; body: string }> = [
    { cls: "rounded-control", label: "control · pill", body: "Buttons, inputs, menu rows" },
    { cls: "rounded-card", label: "card · 10px", body: "Tiles, list rows, rail tiles" },
    { cls: "rounded-surface", label: "surface · 16px", body: "Panels, modals, tables, step cards" },
    /* BACK FROM ZERO. It was 32px while the frame painted a gradient behind a
       transparent rail, then 0 when the navigation briefly became a white column
       and there was no wash left to cut into. There is again — the band is
       charcoal and the ground is off-white — and 16px is what the export draws.
       Applied TOP-LEFT ONLY: the one corner where the page meets both halves of
       the band at once. */
    { cls: "rounded-frame", label: "frame · 16px", body: "The ground's top-left corner, cut into the band" },
  ];
  ```
  NEW:
  ```tsx
  const RADII: Array<{ cls: string; label: string; body: string }> = [
    { cls: "rounded-control", label: "control · 8px", body: "Buttons, inputs, selects, tabs, nav rows, the period switch — no pill, final word" },
    { cls: "rounded-card", label: "card · 10px", body: "Tiles, list rows, board cards" },
    { cls: "rounded-surface", label: "surface · 10px", body: "Panels, modals, tables, step cards — same radius as a card, a bigger object" },
    /* THE FRAME IS BACK. It was 0 while the shell was one surface (--radius-frame
       had nothing to reveal — see the Frame section below) and returns at 8px
       now that the panel (#181818) sits under a top bar and beside a rail that
       are a genuinely different colour (#111111). Applied to the PANEL'S
       TOP-LEFT corner only — the one nearest the rail, regardless of whether
       the rail is at rest or open. */
    { cls: "rounded-frame", label: "frame · 8px", body: "The panel's top-left corner, cut where it meets the bar beside the rail" },
  ];
  ```

- [ ] **Step 8 — implement: DIRECTION array, four rows**

  Replace the "One surface, and a hairline" row (lines 156-159):

  OLD:
  ```tsx
    {
      rule: "One surface, and a hairline",
      why: "The rail, the top bar and the page are ALL #1B191A, and every separation in the product is a 1px #3D393B rule. This is the reverse of the band that wrapped a light page, and the reversal is the whole re-theme: with one material there is no 40-point luminance step to find its own edge, so the hairline stops being trim and becomes the structure. A card is #272426 — a 1.14:1 step — so a card without its border is not a flatter card, it is an invisible one.",
    },
  ```
  NEW:
  ```tsx
    {
      rule: "Three darks, and a hairline",
      why: "The page is #0F1011; the top bar, the rail and every card are #111111; the panel under the top bar is #181818 — three surfaces where the two-day-old console ran one. They sit within a hair of each other on purpose (#111111 on #0F1011 measures 1.01:1, tighter than the 1.14:1 step the last surface ran), so the 1px #343434 rule between them is doing more work than ever, not less: a surface change nobody can see without its edge is not a flatter surface, it is an invisible one.",
    },
  ```

  Replace the "Content floats on the ground" row (lines 160-163):

  OLD:
  ```tsx
    {
      rule: "Content floats on the ground",
      why: "Nothing sits flat on the page but a heading or a caption. Everything with content in it is an island with an EDGE, and the edge is the whole of it: a card is a 1.14:1 step off the page, so the border is not trim on a surface you can already see, it is the only thing making the surface visible at all.",
    },
  ```
  NEW:
  ```tsx
    {
      rule: "Content floats on the ground",
      why: "Nothing sits flat on the page but a heading or a caption. Everything with content in it is an island with an EDGE, and the edge is the whole of it: a card is #111111 on a #0F1011 page — 1.01:1, tighter than ever — so the border is not trim on a surface you can already see, it is the only thing making the surface visible at all.",
    },
  ```

  Replace the "One blue, in three shapes" row (lines 164-167):

  OLD:
  ```tsx
    {
      rule: "One blue, in three shapes",
      why: "The fill/stroke split existed because #EECF00 is 1.55:1 as a stroke on white and 11.24:1 as a fill — an absent line and a superb box, so the brand could only safely do one of the two jobs and a second colour had to hold the other. On #1B191A the blue is 9.20:1 drawn and 8.08:1 filled, so the split has nothing left to prevent and yellow-as-stroke retires with it. What replaces it is a rule about SHAPE, all three visible at once in the rail: a RING is identity (the mark), a GLYPH is location (the active row), a FILL is action (the +, every primary button). Success is NOT the brand: it kept the green the brand vacated, because a DONE badge and a New-flow button being one colour would put the loudest state and the loudest act in one vocabulary. Warn and danger are the other two state hues, and what stops any of them becoming wallpaper is that status is quiet when fine.",
    },
  ```
  NEW:
  ```tsx
    {
      rule: "One blue, two jobs",
      why: "#007BFF replaces the cyan everywhere. It draws two jobs, not three: a STROKE (--marker: links, the focus ring, the active tab rule) at 6.65:1-6.20:1 across the three dark surfaces, and a FILL (--primary, one step deeper at #0070E8) at 4.68:1 white-on-fill. The 'glyph is location' job cyan carried is gone — the rail's active row is a neutral --control fill now, not a coloured icon, because that is what the Figma actually draws. Success is still NOT the brand: it keeps the green the brand vacated, because a DONE badge and a New-flow button being one colour puts the loudest state and the loudest act in one vocabulary. Warn and danger are the other two state hues, and status is still quiet when fine.",
    },
  ```

  Replace the "Ten contains, eight presses" row (lines 168-171):

  OLD:
  ```tsx
    {
      rule: "Ten contains, eight presses",
      why: "Everything that contains something is 10px — cards, panels, popovers, selects, the period track. Everything pressable is 8. A badge is 4. An avatar and a status dot are the only full radii left. This replaced 'everything pressable is a full pill', which needed an exception it could never justify: a control that WRAPS cannot be a pill, because a full radius on a two-line box renders as a circle around the words. There is no exception now.",
    },
  ```
  NEW:
  ```tsx
    {
      rule: "Ten contains, eight presses",
      why: "Everything that contains something is 10px — cards, panels, popovers, selects, the period track. Everything pressable is 8: buttons, chips, inputs, selects, tabs, nav rows, the period switch. A badge is 4. Circles are reserved for four things that are never an action — an avatar, the bell's unread badge, the freshness dot, and the tile's active-count numeral. This replaced 'everything pressable is a full pill' for the second time now, and the 4 September 2026 Figma is named as the reference so a third flip needs a new design, not a comment.",
    },
  ```

- [ ] **Step 9 — implement: STATE.md, add the dated line**

  Append a new dated section at the end of `STATE.md` (after its last
  paragraph, "**MCP Phase 1...**"):

  ```markdown

  ---

  ## Update — 4 September 2026

  **The blue re-theme shipped**, two days after the cyan console did.
  `#007BFF` replaces `#00C0E8`/`#00CDF5` everywhere; the one-surface thesis
  (`#1B191A` for the rail, the top bar and the page alike) is reversed back
  to three dark surfaces (`#0F1011` page, `#111111` chrome, `#181818`
  panel); every button, input, tab and nav row drops the pill for an 8px
  corner, named final against the 4 September 2026 Figma; the tile numeral
  drops from 36px to 28px; and the top bar gains a wordmark the rail used
  to carry. `docs/BRAND_KIT.md`, `DESIGN.md` and `/design` were rewritten in
  lockstep — see `docs/superpowers/specs/2026-09-04-retheme-blue-design.md`
  for the approved decisions and the measured contrast ratios behind them.
  ```

- [ ] **Step 10 — run it green**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all twenty-one `it`s across all five describe blocks pass.

- [ ] **Step 11 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/retheme-blue-docs.test.ts && pnpm check:ui
  ```

  Note: `tests/design-swatches.test.ts` is not part of this task's gate — it
  cross-checks `page.tsx` against `globals.css`, which the tokens-owning
  area's task edits; run it (and the rest of the suite) at the branch-level
  gate once all areas have landed.

- [ ] **Step 12 — commit**

  ```bash
  git add src/app/design/page.tsx STATE.md tests/retheme-blue-docs.test.ts
  git commit -m "$(cat <<'EOF'
  Update the /design kit page's swatches and radius specimen for the
  blue console, and log it in STATE.md

  BRAND/SURFACE/INK swatch arrays, the headline-numeral caption, the
  RADII specimen and the four DIRECTION rows they used to contradict
  now agree with the blue console: #007BFF, three dark surfaces, no
  pill, 28px numeral. STATE.md gets a dated line pointing at the
  approved spec.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## After the last task (controller, not an implementer)

1. Whole-branch review (fable) with the Figma beside it: every route, both themes, 1440 and 1920 wide; contrast re-measured for every pair the docs cite.
2. Merge to main and push; Vercel deploys.
