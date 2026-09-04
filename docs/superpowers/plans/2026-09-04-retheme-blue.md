# Blue Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the console from the cyan one-surface theme to the 4 September 2026 Figma: blue brand, three dark surfaces, 8px corners, the full-width top bar, the re-dressed hover rail, 28px tile numerals, and the matching light theme, with the brand kit, DESIGN.md and /design rewritten to match.

**Architecture:** Every colour is decided once in `src/app/globals.css` (roles in `:root` and `.dark`, ramps in `@theme`) and reaches components as utilities through the bridge; primitives in `src/components/ui` carry shape and size; the shell (`app-frame`, `top-bar`, `sidebar`) carries layout; tiles and charts consume tokens by name. Tasks run in that order because each layer consumes the names the previous one produces.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme`, `@custom-variant dark`), cva primitives (shadcn-derived), vitest + PGlite, `scripts/check-ui.ts`.

**Spec:** `docs/superpowers/specs/2026-09-04-retheme-blue-design.md` (binding; read it first — every task argues from it). Reader maps with file:line facts: `.superpowers/sdd/2026-09-04-retheme-blue/codebase-map-full.md`.

## Global Constraints

- Colours live only in `src/app/globals.css`; no hex literal in any `.tsx` (`scripts/check-ui.ts` fails the build on one). New roles: `--chrome`, `--panel`, `--avatar`, `--faint`, `--freshness-dot`, `--freshness-halo`; every role is bridged to a utility (`bg-chrome`, `bg-panel`, `bg-avatar`, `text-faint`, `bg-freshness-dot`, `bg-freshness-halo`).
- Brand ramp (spec table): 400 `#3D9BFF` dark stroke, 500 `#007BFF` the brand, 600 `#0070E8` THE FILL under white ink, 700 `#0069D9` pressed, 800 `#0062CC` light stroke. `--primary-foreground` is `#FFFFFF` in both themes.
- Dark surfaces: page `#0F1011`, chrome and cards `#111111`, panel `#181818`, control `#202020`, secondary `#333333`, avatar `#3A3A3A`, hairline `#343434`, rule `#4A4A4A`, faint `#6E6E6E`, muted `#858585`, text `#FFFFFF`; `--muted` fill `#181818`, `--accent` hover `#3A3A3A` (amended 5 Sep: at `#333333` it equalled `--secondary` and a grey button's hover vanished), `--input` = `--border`. Light: page and panel `#F7F8F9`, chrome and cards `#FFFFFF`, hairline `#E1E1E1`, input outline `#E4E4E4`, control `#F4F4F4`, muted `#6B6B6B`, faint `#8E8E8E`, text `#000000`, heading `#313131`, `--secondary-foreground` `#303030` (icons that set their own ink use `#4A4A4A`, 8.86:1 on white), `--avatar` `#FFFFFF` with the `--input` outline, `--muted` `#F4F4F4`, `--accent` `#ECECEC`, `--rule` `#CFCFCF`. `--popover` = `--card` in BOTH themes.
- Depth, stated honestly — "a control recesses" is retired: on dark, a field is a step UP from the chrome/card it sits on (`#202020` on `#111111`) and its hover a further step up (`#333333`); on light a field is a step DOWN (`#F4F4F4` on white) and its hover a further step down (`#ECECEC`). The directions mirror; neither is described as "recessed".
- Neutral steps 300 / 100 / 50 stay DEFINED and are re-cut (`#B5B5B5`, `#E5E5E5`, `#FAFAFA`): `scroll-area.tsx`, `switch.tsx`, `button.tsx`'s `white` variant and the off-limits `node-meta.ts` spell them directly. Nothing here retires them.
- Shape: `rounded-control` (8px) on everything pressable, typeable, tabs, nav rows and the period switch; cards 10px; circles only for avatars, badges, the freshness dot and the active-count numeral. `--radius-frame` = 8px. Card shadow `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 / .10)`.
- Type: body 15/22, captions 13, page title 26/600 unchanged; tile numeral 28px/40px Inter 600 (`.stat-numeral`); `.wordmark` Inter 900 24px/22px, the only weight above 600 — declared in the CSS class, never as a `font-black` utility, so `scripts/check-ui.ts` (which scans `.tsx` only) needs no allow-list and gets none. The rail's workspace-switcher initial is 13/**600** (`font-semibold`), not 700. No Poppins.
- Layout: 60px full-width top bar above [rail | panel]; the rail stays a hover rail (56px rest, 260px expanded, pin cookie and REVEAL unchanged); the panel rounds its **top-right** corner (`rounded-tr-frame`, 8px) under the bar and stays square on the left beside the rail; `#topbar-slot` and `#topbar-status` portals stay; the top bar carries NO metrics-setup ring.
- Dashboard header actions: a `secondary` `xs` "Today ▾" dropdown (16px calendar icon, the selected `RANGE_OPTIONS` label, a chevron) in place of the six-pill period track; "+ Add" on the brand fill (`variant="accent"` — the kit has no variant literally named `primary`) at `xs`; "Refresh All" `secondary` `xs`. All three pass `[&_svg]:size-4`, because `xs` ships `[&_svg]:size-3.5`.
- Every fractional Figma pixel is rounded to a whole pixel.
- OFF-LIMITS: `src/components/flow/*`, `--canvas-*`, `GROUP_ACCENT` (node-accent.ts).
- Tests that pin the old design are UPDATED to pin the new rule (console-theme, page-width, design-swatches, calendar-view, tile-config, board-chart-marks; chrome-band and vendored-primitives are re-verified unchanged), never deleted or skipped.
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
- Consumes: `--color-neutral-{950,900,800,700,600,500,400,300,200,100,50}` (the `@theme` ramp); `--background` / `--card` / `--popover` / `--control` / `--secondary` / `--secondary-foreground` / `--muted` / `--accent` / `--border` / `--input` / `--rule` / `--muted-foreground` / `--foreground` / `--heading` (role vars, both blocks); `--canvas-bg` (frozen, read-only here).
- Produces: three new ramp steps `--color-neutral-925` / `-850` / `-450`, and re-cut values for `-300` / `-100` / `-50` (which stay DEFINED — `scroll-area.tsx`, `switch.tsx`, `button.tsx`'s `white` variant and the off-limits `node-meta.ts` spell them directly); six new roles `--chrome` / `--panel` / `--avatar` / `--faint` / `--freshness-dot` / `--freshness-halo` declared in **both** `:root` and `.dark`; every role named above re-pointed to its new value — including **`--secondary-foreground`**, which `button.tsx`'s `secondary` variant consumes by name in a later task (`#FFFFFF` in dark via `neutral-200`, `#303030` in light) — and `--popover` pointed at `--card` in both blocks; `SURFACE` / `INK` arrays in `design/page.tsx` re-captioned; `src/app/layout.tsx`'s two `themeColor` literals pinned to the new `--background` values (`#f7f8f9` light, `#0f1011` dark).

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
   * THE SURFACE HALF (950 → 500) and THE INK HALF (450 → 50) are still
   * separated on purpose. `500` is the last step a LINE may be drawn in
   * (`--rule`); `450` is a caps-label-only step (`--faint`, "Main Menu" and
   * nothing that reads as a sentence); `400` is the first step body TEXT may be
   * set in (`--muted-foreground`). The Figma's own "Main Menu" grey — #4A4A4A —
   * is not text-safe at 2.13:1 on the chrome, which is exactly the gap this
   * rule exists to catch; the caption gets a lighter, tested step instead.
   *
   * 300, 100 AND 50 STAY DEFINED, RE-CUT RATHER THAN RETIRED. No ROLE reads
   * them once `--muted-foreground` moves to `400`, but four files still spell
   * them directly — `ui/scroll-area.tsx` (the thumb), `ui/switch.tsx` (the off
   * track), `ui/button.tsx`'s `white` variant (`hover:bg-neutral-100`) and the
   * off-limits `flow/node-meta.ts` — and deleting a colour token out from
   * under a live class is the exact "renders with no colour at all" failure
   * `check-ui.ts`'s retired-token rule exists to punish. They are re-cut for
   * the new near-neutral cast instead of being carried over from the warm
   * ramp, so nothing in the product mixes a warm grey into a neutral one.
   *
   * DEPTH, STATED HONESTLY. This file used to say "a control recesses from a
   * card". That is not what either theme does now and the sentence is gone:
   * here, on the #111111 chrome and cards, a field is a step UP (850) and its
   * hover a further step up (800); in `:root`, on white, a field is a step
   * DOWN (#F4F4F4) and its hover a further step down (#ECECEC). The two
   * directions MIRROR each other, which is the invariant that actually holds —
   * "raised" and "recessed" do not survive the mirror and are not used.
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
  --color-neutral-300: #b5b5b5; /* no role reads it since `--muted-foreground` moved to `400`; scroll-area's thumb, switch's off track and node-meta's untested dot still spell it */
  --color-neutral-200: #ffffff; /* body, headings and card titles — the Figma sets both in white */
  --color-neutral-100: #e5e5e5; /* button.tsx's `white` variant hovers here */
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
  /* A MENU IS A CARD THAT FLOATS. Pointed at `--card` rather than at
     `--chrome` directly, in both themes, so the two can never drift apart by
     one of them being re-pointed and the other forgotten. */
  --popover: var(--card);
  --popover-foreground: var(--card-foreground);

  /* THE PANEL — the content area under the top bar, one step lighter again
     than the chrome. Three surfaces, three steps: page, chrome, panel. */
  --panel: var(--color-neutral-900); /* #181818 */

  /* THE CONTROL SURFACE, AND THE DEPTH RULE STATED HONESTLY.
     A field on this theme's chrome and cards (#111111) is a step UP: #202020,
     with its hover a further step up at #333333 (`--accent`). On white it is
     the mirror — a step DOWN to #F4F4F4, hovering a further step down to
     #ECECEC. That is the invariant this file actually holds: the two themes
     MIRROR each other. What it no longer says is "a control recesses from a
     card", which was a sentence about one theme pretending to be a rule about
     both, and which the Figma contradicts on the dark side outright. */
  --control: var(--color-neutral-850); /* #202020 — a step UP from #111111 */

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
   * back. `:root` mirrors this exactly: #F4F4F4 muted, #ECECEC accent, one
   * step down and then a further step down from the white card between them.
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
  /* A MENU IS A CARD THAT FLOATS — see the note in `.dark`. Same pointer, so
     the two cannot drift apart by one being re-pointed and the other missed. */
  --popover: var(--card);
  --popover-foreground: var(--card-foreground);

  /* THE PANEL — the content area under the top bar. Same value as the page in
     this theme: the light Figma's panel and ground are both `#F7F8F9`, so the
     top bar's white is the only surface that steps away from it. */
  --panel: var(--background);

  /* THE CONTROL SURFACE — a step DOWN from the white card it sits on, which is
     the MIRROR of the dark theme's step UP rather than a copy of it. See the
     depth note in `.dark`: the invariant is that the two directions mirror,
     not that either one is "recessed". */
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
  /* THE BUTTON'S TEXT, WHICH IS NOT THE SAME QUESTION AS ITS ICON'S INK.
     #303030 is the label colour the Figma's own grey buttons carry — 13.2:1 on
     white. The export ALSO sets a few icons in #4A4A4A (8.86:1 measured, not
     the 8.4:1 the export rounds it to); those are set where they are drawn,
     never through this role, so a label and its glyph are two decisions and
     this token holds the one it is named for. */
  --secondary-foreground: #303030;

  /* AVATAR AND ICON CIRCLES — white, found by the `--input` outline the bell
     and the avatar wear in the light export rather than by a fill. The dark
     theme's #3A3A3A is a fill because there is nothing lighter to outline
     against; here the outline is the whole device. */
  --avatar: #ffffff;

  --muted: #f4f4f4; /* the same step as `--control` — a fill one down from white */
  --muted-foreground: #6b6b6b; /* 5.33:1 on white, 5.01:1 on the page/panel */

  /* THE HOVER STEP — one further DOWN from `--control`, mirroring the dark
     theme's one further UP. See the depth note in `.dark`. */
  --accent: #ececec;
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
     rest, a table divider, a chart's zero line. #CFCFCF: one clear step darker
     than `--border` (#E1E1E1), the same relationship `--rule` (#4A4A4A) has to
     the hairline (#343434) in dark. The old #C9CED5 was cut on a blue-grey
     cast the rest of this theme no longer has. */
  --rule: #cfcfcf;

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

**3h. `src/app/layout.tsx`.** Both literals are checked against the new
`--background` values, because `design-swatches.test.ts` pins BOTH: the light
one is already `#f7f8f9` and stays (the Figma's light page did not move), and
the dark one moves. Replace:
```tsx
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#1b191a" },
  ],
```
with:
```tsx
  themeColor: [
    // Pinned to `--background` by tests/design-swatches.test.ts, in both
    // themes: Next evaluates this at build time and cannot read a custom
    // property, so a re-theme that misses it leaves a grey band above the app.
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
 * oversight.
 *
 * THE WEIGHT IS DECLARED HERE, IN CSS, AND THAT IS WHAT KEEPS IT THE ONLY ONE.
 * A call site writes `className="wordmark"` and never `font-black`, so
 * `scripts/check-ui.ts` — which reads `.tsx` and never `.css` — still fails
 * the build on any heavy-weight UTILITY anywhere in the app, with no
 * allow-list entry to widen and no spelling convention for a consumer to get
 * wrong. The exception lives in exactly one rule in one file.
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
- Modify: `src/components/calendar/calendar-board.tsx` (the month stepper's two `rounded-full` overrides only)
- Read-only check: `src/components/ui/select.tsx`
- Test: `tests/console-theme.test.ts`

**Interfaces**
- Consumes: `--secondary`, `--secondary-foreground` (`#FFFFFF` dark / `#303030` light), `--input` (roles defined in `src/app/globals.css` by Task 2 — by name only, never a hex literal in these `.tsx` files, per `scripts/check-ui.ts`'s hex-literal rule).
- Produces: `buttonVariants()`'s base class at `rounded-control` (was `rounded-full`); `secondary` variant reading `bg-secondary text-secondary-foreground border-input`; `PERIOD_TRACK`/`PERIOD_PILL` (unchanged export names, consumed by `src/app/dashboard/page.tsx`, `src/components/theme.tsx`, `src/components/calendar/calendar-board.tsx`) at `rounded-control`; `calendar-board.tsx`'s two month-arrow buttons inheriting the base 8px instead of overriding to a circle.

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

  it("leaves the month stepper's arrows the same 8px as every other button", () => {
    // A SOURCE PIN, because the offence is an OVERRIDE rather than a default.
    // `calendar-board.tsx`'s two month arrows spelled `rounded-full` on top of
    // `buttonVariants`' base, so flipping the base alone would have left two
    // circles sitting inside an 8px groove — the one place in the product
    // where the old shape could survive this pass unnoticed.
    const calendar = read("src/components/calendar/calendar-board.tsx");
    expect(calendar, "the month arrows must not re-spell a pill").not.toMatch(
      /className="rounded-full text-muted-foreground/,
    );
  });

  it("confirms Select already draws at the control radius — verified, not changed", () => {
    // The spec's Shape bullet names SELECTS alongside buttons, inputs, tabs
    // and nav rows. `select.tsx` was already `rounded-control` on both its
    // trigger and its items and needs no edit; this asserts that rather than
    // leaving "presumably fine" as the plan's answer.
    const select = read("src/components/ui/select.tsx");
    expect(select).toMatch(/rounded-control border border-input bg-control/);
    expect(select, "the trigger must not go back to a pill").not.toMatch(/rounded-full/);
  });
```

(`read(p)` is the file's own helper, defined at the top beside `root` — reuse it rather than adding a second `readFileSync` import.)

(Leave the file's other `it()` blocks in the `describe` alone — after Tasks 1 and 2 those are `"fills with #0070e8"`, `"grounds on #0f1011"` and `"keeps the canvas frozen even though the ground moved on without it"`. They pin hex values and belong to the tokens tasks' own edits of this same file; this task's two rewrites and two additions sit in disjoint blocks, so landing second is a rebase rather than a conflict.)

#### Step 2 — run it, expect failure

```bash
pnpm vitest run tests/console-theme.test.ts
```
Expected failure: three of the four blocks fail — the first because `button.tsx` and `page.tsx` still contain `rounded-full`, not `rounded-control`; the second on its final two assertions for the same reason on `PERIOD_TRACK`; the month-stepper block because `calendar-board.tsx` still spells `rounded-full` on both arrows. The Select block PASSES from the start and is meant to: it records a fact about a file this pass does not change, so that "selects are 8px too" stops being an assumption.

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

#### Step 5 — implement: calendar-board.tsx (the month stepper's two arrows)

The two arrows inside `PERIOD_TRACK` override the base radius to a circle. With
the base at 8px that override is the last pill left in a groove that is now a
rectangle, so it comes off — the buttons inherit `rounded-control` like every
other button in the product, and keep every other class they had.

There are exactly two occurrences of this line in the file (the previous-month
button at ~line 430 and the next-month button at ~line 451). Replace BOTH:

```tsx
              className="rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
```

with:

```tsx
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
```

(Nothing else in this file changes. The `rounded-full` on the day-cell count
badge (~line 384), the "This month" chip (~line 484), the legend chip (~line
704) and the tally badge (~line 814) all STAY: those are badges and counts, and
circles are still exactly what the shape rule reserves for them.)

#### Step 6 — run it, expect green

```bash
pnpm vitest run tests/console-theme.test.ts
```
All four blocks pass; the three untouched hex-pin tests in the same file still run (they may separately fail or pass depending on whether the tokens tasks have landed in this working tree yet — not this task's concern).

#### Step 7 — gate

```bash
pnpm typecheck && pnpm vitest run tests/console-theme.test.ts tests/cn-merge.test.ts tests/calendar-view.test.ts && pnpm check:ui
```
(`cn-merge.test.ts` and `calendar-view.test.ts` are run alongside because they import `buttonVariants`/reference the period groove and must not regress.)

#### Step 8 — commit

```bash
git add src/components/ui/button.tsx src/components/ui/page.tsx src/components/calendar/calendar-board.tsx tests/console-theme.test.ts
git commit -m "$(cat <<'EOF'
Take the pill off the button, the period groove and the month arrows

The 4 Sep 2026 Figma settles the shape rule for good: 8px rectangles on
every button and the period switch, no pills anywhere in the kit. The
calendar's two month arrows drop the rounded-full override that would
otherwise have left two circles inside a rectangular groove, and Select is
pinned as already-compliant rather than assumed to be. Also gives the
secondary button its own --secondary/--input pair instead of borrowing the
field's --control surface.

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
- Downstream note: the dashboard's own view tab strip is rendered separately today (`ViewStrip`, inline in `src/app/dashboard/page.tsx`, outside this area's files) and is NOT wired into the new `tabs` prop by this task. **Task 14 does that**, and is what turns this prop from plumbing into the Figma's actual header — nothing here ships a visible change on its own.

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
    /**
     * NO RULE UNDER THE HEADER ANY MORE — the spacing survives, the hairline
     * does not.
     *
     * It was `border-b border-border`, drawn when the header was the only
     * thing between the page title and the content. On the board that rule now
     * lands one line above the tab strip's own 2px underline, so the top of the
     * page reads as two horizontal rules eight pixels apart, and the one that
     * MEANS something — which tab you are on — is the fainter of the two. The
     * `pb-4` stays: it is what stops a title touching the thing beneath it, and
     * dropping both would have been a different change.
     */
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

(The `<header>` doc comment above is carried across VERBATIM rather than
rewritten, and it has to be: `tests/calendar-view.test.ts` asserts
`readFileSync("src/components/ui/page.tsx").toMatch(/pb-4/)` — the string only
exists in that comment — as its proof that the header, and not the board's own
control row, owns the 16px under the title. Dropping the block would fail a
test in a file this task never opens.)

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
- Consumes: `--avatar` / the `bg-avatar` utility — a new neutral role (`#3A3A3A` per the spec's re-cut dark ramp, "avatar / icon circles") that Task 2 declares in `globals.css` (`--avatar`) and Task 3 bridges (`--color-avatar`, so Tailwind emits `bg-avatar`). **Sequencing note**: `pnpm typecheck`, `pnpm vitest` and `pnpm check:ui` all pass on this task's own diff whether or not Tasks 2 and 3 have landed yet (an unregistered `bg-avatar` is a legal, if inert, class name — the same silent-no-color failure mode `check-ui.ts`'s own "retired token" rule documents) — but the avatar circles are only visually correct once the token exists. Land this after Tasks 2 and 3, or in the same PR as them.
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

### Task 7: Turn the frame: a full-width top bar over the rail and the panel

**Files**
- Modify: `src/components/app-frame.tsx`
- Modify: `src/components/top-bar.tsx`
- Modify: `src/components/app-shell.tsx` (the `metricCount` pass-through only)
- Modify: `src/app/dashboard/page.tsx` (the `metricCount` computation and the prop that carried it)
- Modify: `src/lib/board/nav-views.ts` (comment-only: it cites `metricCount` as its worked example)
- Modify: `src/components/sidebar.tsx` (type-only: two new optional props on the signature; no behaviour change yet — Task 8 wires them up)
- Test: `tests/page-width.test.ts`

**Interfaces**
- Consumes: `Sidebar({ hide?, views?, pinned?, workspace?: string, account?: { initials: string; avatarUrl?: string | null; panel: ReactNode } })`; `.wordmark` and the `bg-chrome` / `bg-panel` / `bg-avatar` utilities (Tasks 2 and 3).
- Produces: `AppFrame`'s new tree (`TopBar` full-width, then a row of `Sidebar` + panel), with the panel rounding its **top-right** corner (`rounded-tr-frame`); `TopBar({ account?, firstName?, unread? })` — no `workspace`, and **no `metricCount`**; the `.wordmark` class in the bar.
- Removes, in one commit because each link dies with the one below it: the metrics-setup ring's markup, `RING_RADIUS` / `RING_CIRCUMFERENCE` / `METRIC_GOAL` / `tracked` / `arc` / `ringMessage` and the `Tooltip` import in `top-bar.tsx`; `metricCount` from `TopBar`, `AppFrame` and `AppShell`; and the `const metricCount = …` computation in `src/app/dashboard/page.tsx`. `noUnusedLocals`/`noUnusedParameters` are on (see `tsconfig.json`), so a half-done removal does not typecheck — that is why the chain is one task. No test asserts on the ring or the count anywhere in `tests/`, so nothing is deleted alongside it.

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

  it("gives the panel its own surface and a top-RIGHT corner", () => {
    // THE FIGMA ROUNDS THE FAR CORNER, NOT THE NEAR ONE. The panel meets the
    // rail on its left with a hairline and butts square against it; the corner
    // the export softens is the one under the bar at the opposite end. This
    // reverses the shell's own historical `rounded-tl-frame` convention, which
    // is exactly why it is pinned rather than left to a comment.
    expect(frame).toMatch(/rounded-tr-frame bg-panel/);
    expect(frame, "the old top-left notch must not come back").not.toMatch(/rounded-tl-frame/);
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

  it("drops the metrics-setup ring, and the whole chain that fed it", () => {
    /**
     * THE FIGMA'S BAR HAS NO RING, and the progress it reported has a better
     * home already: the dashboard's own setup checklist says the same thing
     * with room to say what to do about it. So it goes — and with it the
     * four-file pass-through nobody else was reading, because a prop chain
     * whose only consumer has been deleted is dead weight that still costs a
     * render and still reads as a feature to the next person.
     */
    expect(bar, "the ring's arc is gone").not.toMatch(/METRIC_GOAL/);
    expect(bar, "and its geometry with it").not.toMatch(/RING_RADIUS/);
    expect(bar, "the bar no longer takes a count").not.toMatch(/metricCount/);
    for (const p of ["src/components/app-frame.tsx", "src/components/app-shell.tsx", "src/app/dashboard/page.tsx"]) {
      expect(read(p), `${p} still threads metricCount`).not.toMatch(/metricCount/);
    }
  });
});
```

#### Step 2 — run it, expect the new assertions to fail

```
pnpm vitest run tests/page-width.test.ts
```

Expected failure: the new `describe` block's `it`s fail — `app-frame.tsx` still renders `<Sidebar>` before a column containing `<TopBar>`, the panel wrapper is still `bg-background` with no `rounded-tr-frame`, `Sidebar`'s type has no `workspace`, `top-bar.tsx` still imports `DropdownMenu`/`ChevronDown` and destructures `workspace`, and all four files still spell `metricCount`. (The rest of the file's existing tests keep passing — this task does not touch the `<aside>`, the rail's pin machinery, or the bar's height/hairline.)

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
 * under them is `--panel`, its own material, which is what gives a corner
 * something to reveal again after two days at `--radius-frame: 0`.
 *
 * IT IS THE TOP-RIGHT CORNER, AND THAT REVERSES THIS FILE'S OWN HISTORY.
 * Every previous era cut the panel's TOP-LEFT — the corner nearest the rail —
 * because the rail was a different material and the notch was how the page
 * wrapped around it. The 4 September Figma does not: the panel butts square
 * against the rail behind a hairline, and the corner it softens is the far
 * one, under the bar at the opposite end of the row. Followed literally
 * rather than corrected toward the old convention, and pinned in
 * `tests/page-width.test.ts` so the convention cannot quietly reassert itself.
 *
 * `surface` is still the caller's, because the pages genuinely disagree about
 * SCROLLING: list pages scroll, the builder does not.
 */
```

Then remove `metricCount` from the signature — the destructured name AND its
whole doc-commented type entry (`/** How many metrics this workspace has, for
the top bar's ring. … */ metricCount?: number;`), since the ring it fed is
being deleted below and `noUnusedLocals` will not tolerate the leftover
binding. Everything else in the signature — `account`, `workspace`,
`firstName`, `views`, `surface`, `hide`, `railPinned`, `ownsMain`, `children`
— is unchanged.

Then replace the block that runs from the comment opening `* THE NOTCH IS GONE, AND `--radius-frame` IS 0 TO SAY SO.` (its `/**` line) through the file's final `</div>\n  );\n}` — the comment goes with the code because it argues for a token that has been 8px since Task 2:

```tsx
  /**
   * THE NOTCH IS BACK, ON THE OTHER SIDE.
   *
   * `--radius-frame` went to 0 when the rail, the bar and the page became one
   * #1B191A: a radius reveals whatever is BEHIND the element it is cut into,
   * and cutting a corner out of a colour to reveal the same colour draws
   * nothing at the cost of a gap the bar's hairline then has to stop short of.
   * There are three surfaces again — the panel is `--panel`, the bar and rail
   * `--chrome` — so there is something behind it, and the token is 8px.
   *
   * WHICH corner is the part that changed. Every previous notch was TOP-LEFT,
   * nearest the rail. The 4 September Figma cuts the TOP-RIGHT instead and
   * leaves the rail-side corner square, so that is what this spells.
   */
  const className = cn("relative min-w-0 flex-1 rounded-tr-frame bg-panel", surface);

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
          It no longer receives `workspace` — the workspace switcher moved into
          the rail's own head block, and it needs `workspace`/`account` for
          that, not the bar — and it no longer receives `metricCount`, because
          the setup ring that was the only reader of it is gone (the Figma has
          no ring; the dashboard's checklist reports the same progress). What
          the bar draws on its own account is the wordmark, the greeting and
          the right-hand cluster. */}
      <TopBar account={account} firstName={firstName} />
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

(Do not destructure `workspace`/`account` in this task — they stay unread on the type only, which is legal TypeScript and keeps `noUnusedLocals` quiet until Task 8 uses them.)

**`src/components/top-bar.tsx`**

1. Imports — replace:
```tsx
import { Bell, ChevronDown, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```
with:
```tsx
import { Bell, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
```
(`Tooltip` goes with the ring — it was the ring's bubble and nothing else in
this file opened one.)

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
 * THE OLD IDENTITY GROUP IS GONE — workspace avatar, name, chevron, and the
 * dropdown that opened the account panel. That dropdown's TRIGGER is the
 * rail's switcher row now, and `account.panel` is passed straight through to
 * `Sidebar` rather than read here.
 *
 * SO IS THE METRICS-SETUP RING, AND THAT IS A DELETION RATHER THAN A MOVE.
 * The Figma's bar has no ring. The fact it reported — how many of six metrics
 * a workspace has built — is already on the dashboard's own setup checklist,
 * where there is room to say what to do about it instead of only how far
 * along you are; a 24px arc in the chrome was the same claim with no room for
 * the second half. Everything behind it goes in the same commit: this file's
 * `RING_RADIUS`/`RING_CIRCUMFERENCE`/`METRIC_GOAL`, the `tracked`/`arc`/
 * `ringMessage` derivations, and `metricCount` off `TopBar`, `AppFrame`,
 * `AppShell` and the dashboard page that computed it. A prop chain whose only
 * consumer has been deleted still reads as a feature to whoever finds it next.
 *
 * 60px, `--chrome` fill, `--border` bottom rule — the bar, the rail beside
 * it and the page below the panel are three different surfaces now, so this
 * rule is the only thing marking where the bar's material stops.
 */
```

3. Remove the `identity` const entirely — delete the block that begins `const identity = (` and ends at its closing `);` (the avatar span, workspace name span, and `ChevronDown`).

4. Remove the ring's two constant blocks near the top of the file — the
`/** The ring: r=9 in a 24px box… */` pair (`RING_RADIUS`, `RING_CIRCUMFERENCE`)
and the whole `/** WHERE THE RING STOPS ASKING — six metrics… */` block with
`const METRIC_GOAL = 6;`. Nothing else in the file or the app reads either
name (`grep -rn "METRIC_GOAL\|RING_RADIUS" src tests` returns only this file).

5. In the `TopBar` export's signature, remove BOTH the `workspace` and the
`metricCount` parameters together with their doc comments, and remove the
`initial` computation. Change:
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
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
```
and delete the `metricCount?: number;` entry lower in the same type, along with
the long `/** How many metrics this workspace has … */` comment above it.
(`firstName` and `unread` keep their own doc comments unchanged.)

And remove:
```tsx
  const initial = (workspace ?? "").trim().charAt(0).toUpperCase() || "W";
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
```
replacing with just:
```tsx
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
```

Then delete the three derivations the ring owned and the comment blocks above
each: `const tracked = …`, `const arc = …` and `const ringMessage = …`. After
this the component body between the signature and the `return` is a single
`greeting` line.

6. Replace the entire `<header>...</header>` body with:
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

      {/* ── WHAT YOU CAN START ───────────────────────────────────────────
          NO RING HERE ANY MORE. This cluster used to open with a 24px arc
          counting metrics towards six; the Figma has none, and the dashboard's
          setup checklist already carries the same number with somewhere to put
          the next step. See the file note above for what went with it. */}
      <div className="flex shrink-0 items-center gap-4">
        <div id="topbar-status" className="flex shrink-0 items-center empty:hidden" />

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

7. Delete the trailing `SubBar`-history comment block at the end of the file only if it still reads true after this edit — it does (it documents an unrelated, already-removed second band); leave it as is.

**`src/components/app-shell.tsx`** — the middle link of the dead chain.
Remove `metricCount` from the destructuring list in `AppShell({ … })`, remove
its type entry `metricCount?: number;` together with the long `/** HOW MANY
METRICS THIS WORKSPACE HAS — supplied by the PAGE … */` comment above it, and
remove the `metricCount={metricCount}` line from the `<AppFrame …>` call.

**`src/app/dashboard/page.tsx`** — the source of the number. Delete the whole
`/** WHAT THE TOP BAR'S RING COUNTS, AND WHY IT COSTS NOTHING. … */` comment
block and the line under it:
```tsx
  const metricCount = loadError ? undefined : metrics.length + flowTiles.length;
```
and change:
```tsx
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email} metricCount={metricCount}>
```
to:
```tsx
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
```
Then fix the one comment further up the file that names it as a landmark —
replace:
```
   * miss a change). Awaited beside `metricCount`, right before the return —
   * nothing between here and there reads it.
```
with:
```
   * miss a change). Awaited right before the return — nothing between here and
   * there reads it.
```

**`src/lib/board/nav-views.ts`** — comment only. Its argument for `cache()`
cites the deleted prop as the contrasting example. Replace:
```
 * every open tab. `metricCount` is passed down from the page for precisely this
 * reason. A view list cannot be — the whole feature is jumping to a view from
 * somewhere that is not the dashboard.
```
with:
```
 * every open tab. The top bar's metric count used to be passed down from the
 * page for precisely this reason, until the ring that read it was deleted with
 * the 4 September re-theme. A view list cannot be passed down that way — the
 * whole feature is jumping to a view from somewhere that is not the dashboard.
```

#### Step 4 — run the tests green

```
pnpm vitest run tests/page-width.test.ts
```
All assertions — the new block and every pre-existing one (the gutter/caps pair, the rail's pinned-mode block, the board grid, the calendar day cell) — pass. The pre-existing rail-pin assertions are untouched because this task does not touch the `<aside>` element, its width ternary, or the toggle button.

#### Step 5 — gate

```
pnpm typecheck && pnpm vitest run tests/page-width.test.ts tests/calendar-view.test.ts tests/dashboard-tiles.test.ts && pnpm check:ui
```
`typecheck` is the real gate on the `metricCount` removal: `noUnusedLocals` and `noUnusedParameters` are both on, so a link left behind anywhere in the chain fails the build rather than lingering. `check:ui` passes: `bg-chrome`, `bg-panel`, `bg-avatar`, `rounded-tr-frame`, `rounded-control` and `rounded-full` on the bell/avatar are all sanctioned spellings (the retired-token rule only bans `chrome-<word>` compounds, not bare `chrome`; `RADIUS_OK` already lists `frame`, `control` and `full`). Until Tasks 2 and 3 land `--color-chrome`/`--color-panel`/`--color-avatar` in `globals.css`, these utilities compile to no rule rather than failing the build — which is why the tokens tasks come first.

#### Step 6 — commit

```
git add src/components/app-frame.tsx src/components/top-bar.tsx src/components/app-shell.tsx src/components/sidebar.tsx src/app/dashboard/page.tsx src/lib/board/nav-views.ts tests/page-width.test.ts
git commit -m "$(cat <<'EOF'
Span the top bar full width, move the wordmark in, and drop the setup ring

The bar now sits above a row of [rail | panel] instead of beside the rail,
the wordmark moves from the rail's head block into the bar's left edge, and
the old workspace-identity dropdown (avatar, name, chevron) is gone from the
bar — its trigger becomes the rail's own switcher row in the next commit.
The metrics-setup ring goes entirely: the Figma has none and the dashboard's
setup checklist already reports the same progress, so the arc and the whole
metricCount chain behind it (TopBar, AppFrame, AppShell, the dashboard page's
own computation) come out together — a half-removal would not typecheck.
The panel rounds its top-RIGHT corner, per the export, where every previous
era of this shell cut the top-left.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Move the workspace switcher into the rail, and give it Main Menu, a field-styled search, and Get Free Access

**Files**
- Modify: `src/components/sidebar.tsx`
- Test: `tests/page-width.test.ts`

**Interfaces**
- Consumes: `workspace?: string`, `account?: { initials, avatarUrl, panel }` (typed in Task 7, destructured here).
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

  it("sets the switcher's initial at 600, the kit's top weight, not the export's 700", () => {
    // THE WEIGHT LOCK HAS EXACTLY ONE EXCEPTION AND THIS IS NOT IT.
    // `.wordmark` is 900, declared in CSS. Everything else in the product,
    // this badge included, tops out at `font-semibold` — and a badge is
    // precisely where "it is not really prose" would be argued next, so the
    // rule is pinned at the one call site most likely to bend it.
    expect(sidebar).toMatch(/rounded-control bg-brand-500\/75 text-xs font-semibold text-white/);
    expect(sidebar, "no heavy weight anywhere in the rail").not.toMatch(/\bfont-(?:bold|black)\b/);
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
Expected failure: `sidebar.tsx` still declares `const PRODUCT = "Namzilabs"`, has no `bg-brand-500/75` (so the switcher and weight blocks both fail), no `text-faint`/`Main Menu`, the search button has no `border-border bg-control`, and the foot still says "Notifications" rather than "Get Free Access". (`WorkspaceChip` and the gap-2 assertions already pass and stay green — they guard against this task's own risk of collateral damage.)

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
(the type block already carries `workspace?`/`account?` from Task 7 — leave it as is, just add the two names to the destructuring list above it).

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
            text with no chevron pointing at nothing.

            THE INITIAL IS `text-xs font-semibold` — 13px at 600, which is what
            the kit's top weight is. The export draws it at 700; this is one of
            the several 700s the kit does not follow, because "a badge is not
            prose" would let every badge in the product past the weight lock
            and 600 already reads as a badge at 13px. `.wordmark` stays the ONE
            exception above 600 (see globals.css), and it needs no gate change
            because its weight is declared in CSS. */}
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
`check:ui`'s "hand-rolled button" rule is unaffected (no raw `<button>` introduced); the new `<DropdownMenu>`/`<Link>` usages are ordinary kit primitives. `bg-brand-500/75`, `bg-control`, `text-faint` all pass the same way Task 7's `bg-chrome`/`bg-panel` did.

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

### Task 9: Mirror the new geometry in the loading skeleton and close out the shell's tests

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
    expect(skeleton).toMatch(/rounded-tr-frame bg-panel/);
    expect(skeleton, "the mirror must not keep a corner the frame dropped").not.toMatch(/rounded-tl-frame/);
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
Expected failure: the skeleton still opens `flex h-dvh bg-background` (no `flex-col`), the rail ghost still precedes the bar ghost, and both chrome ghosts are still `bg-background` rather than `bg-chrome`; the content ghost has no `rounded-tr-frame bg-panel`.

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
              top-RIGHT corner the real content column carries under the bar.
              The rail side stays square in both, which is the export's own
              geometry and the reverse of every earlier notch this shell had. */}
          <div className="flex-1 overflow-y-auto rounded-tr-frame bg-panel">
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
its own top-right corner. Closes out the shell area's own test files.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Mute the tile's title again, and drop its edge on the default board

**Files**
- Modify: `src/components/metric-card.tsx`
- Create: `tests/metric-card-shape.test.ts`

**Interfaces**
- Consumes: `Card` (`@/components/ui/card`), `cn` (`@/lib/utils`) — unchanged.
- Produces: `MetricCard`'s rendered `<h3>` carries `text-muted-foreground` and no longer `font-medium`; the headline numeral's `<p>` carries `text-heading` explicitly; `MetricCard`'s rendered markup no longer contains `--tile-edge` anywhere. The `--tile-edge` CSS custom property and `board-column.tsx`'s per-lane setter are untouched (kept for the canvas board, per spec).

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

    it("inks the numeral with --heading, which is not --foreground in light", () => {
      /**
       * THE ONE PLACE THE TWO ROLES DIVERGE. In dark they are the same white,
       * so an unset numeral inheriting `--card-foreground` looks correct and
       * nothing catches it. In light `--heading` is #313131 and `--foreground`
       * is pure #000000 — the spec's "numeral 28/40 Inter 600 `--heading`" is
       * a real choice, and inheritance is the wrong answer to it.
       */
      const html = renderToStaticMarkup(createElement(MetricCard, { title: "Speed To Lead", headline: "44" }));
      const numeral = html.match(/<p[^>]*class="([^"]*stat-numeral[^"]*)"/)?.[1] ?? "";
      expect(numeral, "the numeral element was found").not.toBe("");
      expect(numeral).toContain("text-heading");
    });
  });
  ```

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/metric-card-shape.test.ts
  ```

  Expected failure: all three assertions fail against the current source — the title still renders `class="...text-sm font-medium text-foreground"` (contains `font-medium`, no `text-muted-foreground`), the markup still contains `style="background:var(--tile-edge, var(--border))"`, and the numeral's class list is `stat-numeral text-display-md leading-none` with no ink class at all.

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

  Finally the numeral, which has been inheriting its ink rather than naming it
  (currently):

  ```tsx
                <p className={cn("stat-numeral text-display-md leading-none", headline == null && "text-muted-foreground")}>
  ```

  becomes:

  ```tsx
                {/* `text-heading`, SAID OUT LOUD. It used to inherit
                    `--card-foreground` and looked right, because in the dark
                    theme `--heading` and `--foreground` are the same white. In
                    light they are not — #313131 against #000000 — and the spec
                    asks for the heading step. `cn` still lets the em-dash case
                    win: tailwind-merge drops `text-heading` when
                    `text-muted-foreground` is appended for a null headline. */}
                <p className={cn("stat-numeral text-display-md leading-none text-heading", headline == null && "text-muted-foreground")}>
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
  just stops reading it. The headline numeral now names --heading instead of
  inheriting the card's ink, which is the same white in dark and a different
  grey in light.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Give the freshness dot its own colour, out from under success

**Files**
- Modify: `src/components/flow-tile.tsx`
- Create: `tests/freshness-dot.test.ts`

**Interfaces**
- Consumes: `--freshness-dot` / `--freshness-halo` (declared in both role blocks by Task 2, bridged to utilities by Task 3); this task only reads the `bg-freshness-dot` / `bg-freshness-halo` classes they generate. If this task runs before those land, `pnpm check:ui`'s unresolved-utility check (or a visual check) will flag the two classes as unresolved — sequence this task after Tasks 2 and 3, or land those two token lines first.
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

### Task 12: Point every default chart mark at the brand's 500, not the marker

**Files**
- Modify: `src/lib/board/tile-config.ts`
- Modify: `src/components/charts.tsx`
- Modify: `tests/tile-config.test.ts` (updates an existing pin)
- Modify: `tests/board-chart-marks.test.ts` (updates an existing byte-identical hash pin)

**Interfaces**
- Consumes: `--color-brand-500` — the existing `@theme` token, whose hex Task 1 repoints to `#007BFF` per the ramp table. This task only changes which token NAME the default accent and the legacy series read.
- Produces: `accentOf(color?)` (`src/lib/board/tile-config.ts`) returns `"var(--color-brand-500)"` for any tile with no (or an unpalatable) `GROUP_ACCENT` colour — was `"var(--color-brand-600)"`. `BREAKDOWN_ACCENTS[0]`, `Sparkbars`' wash/axis-rule and its bars (`src/components/charts.tsx`) read `bg-brand-500`/`border-brand-500` — were `bg-marker`/`border-marker` — with the wash raised from `/5` to `/12`, the spec's `rgb(0 123 255 / .12)`. `GROUP_ACCENT` (`flow/node-accent.ts`), `--marker` itself, `TargetBar`'s neutral/success states, and `board-charts/scorecard.tsx`'s `GoalBar` are all untouched.

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

  Leave the hash literal (currently):

  ```ts
    expect(hash).toBe("49fae91cb1e4bc260c958a910bbf0a26c2fe6dc7fec70f714f8fa907ba036203");
  ```

  **exactly as it is for now.** It is the hash of the file BEFORE this task's
  edit, so it is what makes Step 2 fail for the right reason.

  **Do not write a new hash by hand, and do not accept one written for you.**
  A SHA-256 of a file cannot be predicted from a diff; a literal that arrives
  in a plan is either copied from a real run or wrong, and a wrong one costs
  the next reader a debugging session on a test that is doing its job. The new
  value is computed from the real post-edit file in Step 4, below, and pasted
  in then.

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/tile-config.test.ts tests/board-chart-marks.test.ts
  ```

  Expected failure: `tile-config.test.ts`'s four `accentOf` assertions fail (the function still returns `brand-600`). `board-chart-marks.test.ts` still PASSES at this point — its hash pin is the pre-edit value and `charts.tsx` has not moved yet. It turns red in Step 3 and is made green again in Step 4 by recomputing, which is the only honest order for a byte-identical pin.

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

  becomes — note the wash goes to **12%**, which is the spec's own
  `rgb(0 123 255 / .12)` and not the 5% this class happened to inherit from
  the era when the wash sat under a yellow; the 25% border is unchanged:

  ```tsx
      className={cn("mt-3 flex items-end gap-1 rounded-t-sm border-b border-brand-500/25 bg-brand-500/12", className)}
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

- [ ] **Step 4 — re-pin the hash from the real file, then run it green**

  First confirm the diff is exactly the five changes above and nothing else:

  ```bash
  git diff src/components/charts.tsx
  ```

  Then compute the hash of the file as it now stands and paste THAT value into
  `tests/board-chart-marks.test.ts`, replacing the pre-edit literal:

  ```bash
  shasum -a 256 src/components/charts.tsx
  ```

  The pin is byte-identical by design — its whole job is to make an
  unannounced edit to this file fail — so the only correct way to move it is
  to move it to a value the file actually has. Never invent, guess or carry
  over a hash literal.

  ```bash
  pnpm vitest run tests/tile-config.test.ts tests/board-chart-marks.test.ts
  ```

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

### Task 13: Let Refresh all go quiet — grey is the header's default now

**Files**
- Modify: `src/app/dashboard/page.tsx`
- Create: `tests/dashboard-header-actions.test.ts`

**Interfaces**
- Consumes: `SubmitButton`'s `variant`/`size`/`className` props (`@/components/ui/submit-button`, which spreads them onto `Button`), `Button`'s existing `"secondary"` variant and `xs` size (`@/components/ui/button.tsx`) — no change to either component. `RefreshCw` from `lucide-react`.
- Produces: the dashboard's "Refresh all" form (`boardActions` in `src/app/dashboard/page.tsx`) renders `<SubmitButton variant="secondary" size="xs" className="[&_svg]:size-4">` with a `<RefreshCw />` in front of the label — was `variant="accent" size="sm" className="px-5"` with no icon.

**Scope**: this task changes the ONE control the spec names that already exists as a real button — "Refresh all" — to the Figma's variant, size and icon. The other two thirds of the spec's actions row (the "Today ▾" dropdown that replaces the six-pill period track, and "+ Add" moving to the brand fill) are Task 14, which owns `PageHeader`'s wiring and `custom-board.tsx`. They are split because this one is a three-attribute change to a control in place, and that one restructures the header.

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
  ```

- [ ] **Step 2 — run it, confirm it fails**

  ```bash
  pnpm vitest run tests/dashboard-header-actions.test.ts
  ```

  Expected failure: the sliced block contains `variant="accent"` and `size="sm"`, no `[&_svg]:size-4` and no icon — all five assertions fail.

- [ ] **Step 3 — implement**

  In `src/app/dashboard/page.tsx`, first add the icon to the lucide import.
  Replace:

  ```tsx
  import { X } from "lucide-react";
  ```

  with:

  ```tsx
  import { RefreshCw, X } from "lucide-react";
  ```

  Then the comment and button (currently):

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
            for no more attention than its neighbours.
            `xs`, NOT `sm`, AND AN ICON. The Figma's header actions are its
            smallest button rung with a 16px glyph in front of the verb, and
            all three of them agree — this one, "+ Add" and the "Today"
            dropdown. `xs` ships `[&_svg]:size-3.5` (14px), which is the rung's
            default and not what this row draws, so the 16 is spelled here;
            the override is on the button rather than the icon because the
            size variant's own descendant rule would win over a class on the
            svg no matter which order they were written in. */}
        <form action={refreshAllFlowsAction} className="shrink-0">
          <SubmitButton
            variant="secondary"
            size="xs"
            className="[&_svg]:size-4"
            pendingLabel="Refreshing…"
            title="Recompute every published metric now"
          >
            <RefreshCw />
            Refresh all
          </SubmitButton>
        </form>
  ```

  (`SubmitButton` spreads `size` and `className` straight onto `Button`, and
  renders `children` after its own spinner — so the glyph sits where the
  spinner will replace the label, exactly as the builder's toolbar buttons do.)

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
  it goes grey, drops to the header's xs rung and gains the 16px refresh
  glyph the export draws in front of the verb.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 14: Wire the dashboard's header — tabs beside a centred title, a "Today" dropdown, and the brand on "+ Add"

**Files**
- Modify: `src/app/dashboard/board-controls.tsx` (adds `RangeMenu`)
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/board-layout.tsx`
- Modify: `src/app/dashboard/custom-board.tsx`
- Modify: `tests/calendar-view.test.ts` (two existing assertions re-pinned to the new arrangement)
- Create: `tests/dashboard-page-header.test.ts`

**Interfaces**
- Consumes: `PageHeaderProps.tabs` (produced by Task 5 — this is the task that finally passes it); `Button`'s `xs` size, its `accent` and `secondary` variants and the `rounded-control` base (Task 4); `DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` / `DropdownMenuRadioGroup` / `DropdownMenuRadioItem` (existing kit primitives); `useBoard()`'s `go`/`pending`/`picked` inside `board-controls.tsx`; `RANGE_OPTIONS` and `resolveRange` (`@/lib/metrics/range`, unchanged).
- Produces: `RangeMenu` (a new client export of `src/app/dashboard/board-controls.tsx`); the dashboard route rendering `<PageHeader tabs={viewStrip} … actions={…<RangeMenu/>}>`; `BoardLayout` and `CustomBoard` without a `viewStrip` prop; `custom-board.tsx`'s "+ Add" on the brand fill at `xs`.
- Removes: the six-pill period track from `src/app/dashboard/page.tsx` (its `PERIOD_TRACK`/`PERIOD_PILL`/`RangeLink` imports go with it). `ui/page.tsx` keeps exporting all three — `calendar-board.tsx` and `theme.tsx` still spell the groove, and `RangeLink` is still `board-controls.tsx`'s own.

**Why this is one task and not three**: the tab strip cannot be in two places at once. Passing `tabs` to `PageHeader` while `BoardLayout`/`CustomBoard` still render `{viewStrip}` draws it twice, and taking it out of them is what makes the three-zone header the real header rather than a second one. The "Today" dropdown lands here for the same reason — it is the third zone's other occupant, and the row it replaces is the thing `tabs` displaces.

- [ ] **Step 1 — write the failing tests**

  Create `tests/dashboard-page-header.test.ts`:

  ```ts
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  import { describe, expect, it } from "vitest";

  /**
   * THE FIGMA'S HEADER, ASSEMBLED — and the reason this is a source pin
   * rather than a render.
   *
   * `dashboard/page.tsx` is an async server component that awaits the
   * database, the session and a WorkOS membership list before it returns any
   * markup, so rendering it here would test the fixtures rather than the
   * layout. What is being asserted is an ARRANGEMENT — which node goes in
   * which slot — and that is a fact about the source. `PageHeader`'s own
   * three-zone behaviour is render-tested separately in
   * `tests/page-header.test.ts`; this file pins that the dashboard actually
   * asks for it.
   */
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  describe("the dashboard's page header, 4 Sep 2026 blue retheme", () => {
    const page = read("src/app/dashboard/page.tsx");

    it("puts the view strip in the header's tab slot", () => {
      const header = page.slice(page.indexOf("<PageHeader"), page.indexOf("<PageHeader") + 1200);
      expect(header, "the PageHeader call was found").not.toBe("");
      expect(header).toContain("tabs={viewStrip}");
    });

    it("renders the strip once, not once per board", () => {
      // The bug this exists to stop: `tabs` passed AND the boards still
      // rendering their own copy, which draws two tab strips on every view.
      for (const p of ["src/app/dashboard/board-layout.tsx", "src/app/dashboard/custom-board.tsx"]) {
        expect(read(p), `${p} still renders its own view strip`).not.toMatch(/viewStrip/);
      }
      const calendarBranch = page.slice(page.indexOf('{!emptyWorkspace && activeKind === "calendar" ? ('));
      expect(calendarBranch.slice(0, calendarBranch.indexOf("<CalendarBoard"))).not.toMatch(/\{viewStrip\}/);
    });

    it("answers 'what span' with the Figma's dropdown, not six pills", () => {
      expect(page).toContain("<RangeMenu");
      expect(page, "the six-pill track is gone from this page").not.toMatch(/className=\{PERIOD_TRACK\}/);
      expect(page, "and so are its imports").not.toMatch(/PERIOD_PILL/);
    });

    it("dresses that dropdown as a secondary xs control with a 16px calendar glyph", () => {
      const controls = read("src/app/dashboard/board-controls.tsx");
      const menu = controls.slice(controls.indexOf("export function RangeMenu"));
      expect(menu, "RangeMenu was found").not.toBe("");
      expect(menu).toContain('variant="secondary"');
      expect(menu).toContain('size="xs"');
      expect(menu).toContain("[&_svg]:size-4");
      expect(menu).toContain("<CalendarDays");
      expect(menu).toContain("<ChevronDown");
      // The presets are the same six, and they still select through the URL.
      expect(menu).toContain("options.map");
      expect(menu).toContain('dim: "range"');
    });

    it("promotes + Add to the brand fill at the header's own size", () => {
      const custom = read("src/app/dashboard/custom-board.tsx");
      const add = custom.slice(custom.indexOf("function AddChartMenu"));
      expect(add).toContain('variant="accent"');
      expect(add).toContain('size="xs"');
      expect(add).toContain("[&_svg]:size-4");
      expect(add, "the white variant it borrowed is gone from this control").not.toContain('variant="white"');
    });
  });
  ```

  Then re-pin the two assertions in `tests/calendar-view.test.ts` that describe
  the OLD arrangement. Both are correct today and become wrong under this task,
  so they move rather than being deleted — the rule this branch holds for every
  test that pins the previous design.

  Replace:

  ```ts
    /**
     * THE ONE THING THAT WOULD BREAK QUIETLY. `viewStrip` and `boardActions` are
     * rendered by `BoardLayout`/`CustomBoard`, not by the page — so a branch
     * that forgets them loses the tab strip and the `+`, and the only way back
     * to another view is the browser's back button.
     */
    const branch = page.slice(page.indexOf('{!emptyWorkspace && activeKind === "calendar" ? ('));
    const head = branch.slice(0, branch.indexOf("<CalendarBoard"));
    expect(head).toMatch(/\{viewStrip\}/);
    expect(head).toMatch(/\{boardActions\}/);
  ```

  with:

  ```ts
    /**
     * THE ONE THING THAT WOULD BREAK QUIETLY, RE-AIMED. `boardActions` is
     * still rendered by the BRANCH — so a branch that forgets it loses
     * Refresh all. The view strip is no longer its job: it moved into
     * `PageHeader`'s `tabs` slot with the 4 September re-theme, which is above
     * every branch and therefore cannot be forgotten by one. What this asserts
     * now is exactly that split.
     */
    const branch = page.slice(page.indexOf('{!emptyWorkspace && activeKind === "calendar" ? ('));
    const head = branch.slice(0, branch.indexOf("<CalendarBoard"));
    expect(head, "the strip belongs to the header now, not to this branch").not.toMatch(/\{viewStrip\}/);
    expect(head).toMatch(/\{boardActions\}/);
    expect(page).toMatch(/tabs=\{viewStrip\}/);
  ```

  And replace:

  ```ts
    expect(board).toMatch(/className=\{PERIOD_TRACK\}/);
    expect(page).toMatch(/className=\{PERIOD_TRACK\}/);
  ```

  with:

  ```ts
    // THE GROOVE IS THE CALENDAR'S ALONE NOW. The board's own time control is
    // still `PERIOD_TRACK` — a month stepper is a segmented control and reads
    // as one — while the range control it used to line up with became the
    // Figma's "Today" dropdown. The drift this guards is unchanged in kind:
    // neither may re-spell what the other imports.
    expect(board).toMatch(/className=\{PERIOD_TRACK\}/);
    expect(page).toMatch(/<RangeMenu/);
  ```

  (The `it` above it is renamed from `"sits in the SAME groove the period pills
  do, imported not re-spelled"` to `"keeps the month stepper in the imported
  groove, beside the header's own dropdown"`, and its docblock's last sentence —
  "`BOARD_GRID` is spelled once for the same reason one layout down." — is kept
  as is.)

- [ ] **Step 2 — run them, confirm they fail**

  ```bash
  pnpm vitest run tests/dashboard-page-header.test.ts tests/calendar-view.test.ts
  ```

  Expected failure: every `it` in the new file fails — `PageHeader` gets no
  `tabs`, both boards still render `{viewStrip}`, the page still spells
  `PERIOD_TRACK`, there is no `RangeMenu`, and `AddChartMenu` is still
  `variant="white" size="sm"`. In `calendar-view.test.ts` the two re-pinned
  assertions fail for the mirror-image reason: the calendar branch DOES still
  render `{viewStrip}` and the page DOES still spell `className={PERIOD_TRACK}`.

- [ ] **Step 3 — implement: `RangeMenu` in `board-controls.tsx`**

  Add the icons and the menu primitives to the imports. Replace:

  ```tsx
  import { Copy as CopyIcon, MoreHorizontal, PenLine, Trash2 } from "lucide-react";
  ```

  with:

  ```tsx
  import { CalendarDays, ChevronDown, Copy as CopyIcon, MoreHorizontal, PenLine, Trash2 } from "lucide-react";
  ```

  and add, immediately after the existing `import { Button } from "@/components/ui/button";` line:

  ```tsx
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  ```

  Then add `RangeMenu` immediately after the `RangeLink` function (which stays
  exactly as it is — the calendar's own controls and any future segmented use
  still want it):

  ```tsx
  /**
   * THE PERIOD CONTROL, AS ONE DROPDOWN RATHER THAN SIX PILLS.
   *
   * The six were a segmented track sitting in the page header's right slot,
   * and they were a ~520px control that could not wrap — it carried its own
   * horizontal scroller specifically so a 390px viewport would not push the
   * whole page sideways. The 4 September Figma draws the same six answers as
   * a 24px-high dropdown reading "Today", which is the same information in a
   * tenth of the width and takes the scroller's problem off the page rather
   * than managing it.
   *
   * WHAT DID NOT CHANGE IS THE MECHANISM. The range still lives in the URL:
   * each item pushes `?range=<key>` through `useBoard()`'s `go`, so the tiles
   * still swap to skeletons on the press, the server still answers, and a
   * link someone pastes into Slack still opens on the range it was copied
   * from. Only the shape of the control moved.
   *
   * A RADIO GROUP, NOT A LIST OF ITEMS, because the six are mutually
   * exclusive and exactly one of them is true — which is what a radio item
   * says to a screen reader and what an ordinary menu item does not.
   *
   * `options` arrives as DATA rather than as a callback: this is a client
   * component rendered by a server one, and a function prop does not cross
   * that boundary. The page builds each `href` with its own `qs()` helper,
   * which is where every other link on the board gets one.
   */
  export function RangeMenu({
    options,
    activeRange,
  }: {
    options: { key: string; label: string; href: string }[];
    activeRange: string;
  }) {
    const { pending, go, picked } = useBoard();
    // The optimistic answer is only trusted WHILE the transition is in
    // flight, exactly as `RangeLink` does it — a failed or redirected
    // navigation must not leave the trigger reading a range nobody is on.
    const active = pending && picked?.dim === "range" ? picked.key : activeRange;
    const label = options.find((o) => o.key === active)?.label ?? options[0].label;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* `xs` with the icons pushed to 16px: the rung ships
              `[&_svg]:size-3.5`, and the export draws 16. The override is on
              the button because the size variant's own descendant rule beats
              a class on the svg whichever order they are written in. */}
          <Button
            variant="secondary"
            size="xs"
            className="[&_svg]:size-4"
            aria-label={`Period — ${label}`}
          >
            <CalendarDays aria-hidden />
            <span>{label}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup
            value={active}
            onValueChange={(key) => {
              const chosen = options.find((o) => o.key === key);
              if (chosen) go(chosen.href, { dim: "range", key });
            }}
          >
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.key} value={o.key}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  ```

- [ ] **Step 4 — implement: `src/app/dashboard/page.tsx`**

  **4a. Imports.** Replace:

  ```tsx
  import { PageContainer, PageHeader, PERIOD_PILL, PERIOD_TRACK } from "@/components/ui/page";
  ```

  with:

  ```tsx
  import { PageContainer, PageHeader } from "@/components/ui/page";
  ```

  and replace:

  ```tsx
  import { BoardControls, RangeLink, TileArea, ViewStrip, ViewTitle } from "./board-controls";
  ```

  with:

  ```tsx
  import { BoardControls, RangeMenu, TileArea, ViewStrip, ViewTitle } from "./board-controls";
  ```

  **4b. The orphaned track prose.** The block that argued for the segmented
  control has no code under it any more. Replace the whole doc comment that
  begins:

  ```tsx
  /**
   * The range control, worn by links — range lives in the URL, so these stay
   * anchors rather than becoming the Chip button.
  ```

  and ends:

  ```tsx
   * The classes themselves now live on the `RangeLink` call below, because the
   * ACTIVE one is decided per press rather than per render — see
   * board-controls.tsx.
   */
  ```

  with:

  ```tsx
  /**
   * THE RANGE CONTROL IS A DROPDOWN NOW — see `RangeMenu` in
   * board-controls.tsx, which is where its markup and its argument both live.
   *
   * What stood here was the case for a SEGMENTED TRACK: eleven free-floating
   * chips across two filter dimensions had wrapped onto a second line and
   * orphaned the last two sources, so sitting the ranges in one groove made
   * them read as one control with one answer. That was right against loose
   * chips and it is not what the 4 September Figma draws — six pills is a
   * ~520px object in a header slot, carrying its own horizontal scroller so a
   * narrow viewport would not push the page sideways, and a dropdown answers
   * the same question in a tenth of the width with no scroller to carry.
   *
   * The range still lives in the URL; the source filter is still gone; the
   * press still lands optimistically through `BoardControls`. Only the shape
   * changed.
   */
  ```

  **4c. The header itself.** Add the `tabs` slot and swap the actions. Replace:

  ```tsx
        <PageHeader
          title={
  ```

  with:

  ```tsx
        <PageHeader
          /* THE THIRD ZONE, AND THE WHOLE REASON THE TITLE CENTRES.
             The view strip used to be the first thing inside the BOARD, one
             row below this header, which meant the top of the page read as a
             title band and then a tab band. The Figma draws one row: tabs
             left, the view's name centred, the actions right. `PageHeader`
             grew a `tabs` slot for exactly this, and passing it is what
             switches the component into its three-zone grid — no other route
             passes it, and every other route is untouched. */
          tabs={viewStrip}
          title={
  ```

  and replace the entire non-calendar branch of the `actions` value — from:

  ```tsx
            /* ── THE PERIOD CONTROL ────────────────────────────────────────
  ```

  through the end of that branch:

  ```tsx
            <div className="-mx-1 min-w-0 overflow-x-auto px-1">
              {/* The groove is `PERIOD_TRACK` now, imported rather than spelled:
                  the calendar's month stepper sits in the same slot and has to
                  be the same object, not a second one that looks like it. */}
              <div className={PERIOD_TRACK}>
                {RANGE_OPTIONS.map((r) => (
                  // The press lands NOW: the pill lights and the tiles become
                  // skeletons while this page re-renders, instead of a second
                  // of nothing over numbers that answer the old range.
                  <RangeLink
                    key={r.key}
                    href={qs({ range: r.key })}
                    rangeKey={r.key}
                    activeRange={rangeKey}
                    className={PERIOD_PILL}
                    activeClassName="bg-primary text-primary-foreground"
                    /* Hover reaches for `--ground-ink`, which is the page's own
                       ink at both exposures — white on the dark group, near-
                       black on the white one. `--foreground` would have been
                       wrong in exactly one theme, which is the kind of bug that
                       ships. */
                    idleClassName="text-muted-foreground hover:text-foreground"
                  >
                    {r.label}
                  </RangeLink>
                ))}
              </div>
            </div>
            )
  ```

  with:

  ```tsx
            /* ── THE PERIOD CONTROL ────────────────────────────────────────
               ONE DROPDOWN, SIX ANSWERS, AND THE SAME URL UNDERNEATH. The
               track that stood here is gone (see the note above `boardActions`
               for why); what replaces it says the current range on its face
               and opens the other five. `RANGE_OPTIONS` is still the list, and
               each `href` is still `qs()`'s, so nothing about which numbers a
               link opens on has changed.

               The scroller went with it, and that is the point rather than a
               side effect: a ~520px control in this slot could only survive a
               390px viewport by scrolling inside itself, and the header's
               right column had to stop being `shrink-0` to let it. A 24px
               dropdown needs neither. */
            <RangeMenu
              activeRange={rangeKey}
              options={RANGE_OPTIONS.map((r) => ({ key: r.key, label: r.label, href: qs({ range: r.key }) }))}
            />
            )
  ```

  **4d. The calendar branch's own row**, which no longer holds the strip.
  Replace:

  ```tsx
            <div className="flex items-center justify-between gap-4">
              {viewStrip}
  ```

  with:

  ```tsx
            {/* `justify-end`, not `justify-between`: the left half of this row
                was the view strip, and the strip is in the page header now. */}
            <div className="flex items-center justify-end gap-4">
  ```

  **4e. The empty-workspace note**, which names where the strip renders.
  Replace:

  ```
            Most of that is free: `viewStrip` and `boardActions` are rendered
            INSIDE `BoardLayout`/`CustomBoard`, which live inside `TileArea`, so
            not taking that branch already removes the strip, the `+`, New group,
            All sources and Refresh all. `PageHeader` is the only chrome that
            survived the old empty path, and this is what removes it.
            `BoardControls` is skipped with it. It is a context provider that
            emits no DOM, and nothing here calls `useBoard()` — `RangeLink`,
            `ViewTab` and `TileArea` are its only consumers now and
            none of them render in this branch.
  ```

  with:

  ```
            Most of that is free: `boardActions` is rendered INSIDE
            `BoardLayout`/`CustomBoard`, which live inside `TileArea`, so not
            taking that branch already removes the `+`, New group and Refresh
            all. `PageHeader` carries the view strip and the period dropdown,
            and skipping the header is what removes those two.
            `BoardControls` is skipped with it. It is a context provider that
            emits no DOM, and nothing here calls `useBoard()` — `RangeMenu`,
            `ViewTab` and `TileArea` are its only consumers now and
            none of them render in this branch.
  ```

- [ ] **Step 5 — implement: the two boards stop drawing the strip**

  **`src/app/dashboard/board-layout.tsx`.** Remove `viewStrip` from the
  destructuring list (the bare `  viewStrip,` line between `viewId,` and
  `boardActions,`), and remove its type entry together with the doc comment
  above it — the block from `   * The view tabs, rendered on the SERVER and
  passed through` down to and including `  viewStrip?: ReactNode;`.

  In the `boardActions` doc comment that follows, replace:

  ```
   * They arrive as a node for exactly the reason `viewStrip` does: the source
  ```

  with:

  ```
   * They arrive as a node for the reason the tiles do: the source
  ```

  Replace the row's opening argument:

  ```
          WHICH VIEW on the left, WHAT IS ON IT on the right, and everything
          here is about THIS BOARD. The one question that is not — over what
          period — moved up to the page header, where it sits beside the title
          as the pill group. One question per row, which is what lets a reader
          stop looking for the third control.
  ```

  with:

  ```
          WHAT IS ON THIS BOARD, and nothing else. Both of the other questions
          moved up to the page header with the 4 September re-theme: WHICH VIEW
          is the tab strip in the header's own `tabs` slot, and OVER WHAT PERIOD
          is the "Today" dropdown in its actions. What is left here acts on the
          board in front of you — New group, Refresh all — which is one question
          per row taken to its end rather than abandoned.
  ```

  Replace the guard:

  ```tsx
      {(viewStrip || boardActions || canEdit) && (
  ```

  with:

  ```tsx
      {(boardActions || canEdit) && (
  ```

  and replace the strip's own cell:

  ```tsx
          <div className="min-w-0 flex-1">{viewStrip}</div>
  ```

  with:

  ```tsx
          {/* THE LEFT HALF IS EMPTY ON PURPOSE, and it is a spacer rather than
              a deletion: `justify-between` needs something to push against, and
              a flexible cell here keeps the actions on the right edge whether
              or not they wrap. The tabs it used to hold are in the page header. */}
          <div className="min-w-0 flex-1" />
  ```

  **`src/app/dashboard/custom-board.tsx`.** The same three removals. Take
  `  viewStrip,` out of the destructuring list, and delete its type entry with
  the comment above it — the block from `   * The same tabs the groups board
  wears.` down to and including `  viewStrip?: ReactNode;`. In the
  `boardActions` comment below it, replace:

  ```
   * The source picker and Refresh all — the same pair the groups board wears,
   * for the same reason the strip above is shared: a view's promise is that
   * moving between kinds does not move the furniture. Server markup, passed
   * through; see the note on `boardActions` in board-layout.tsx.
  ```

  with:

  ```
   * The source picker and Refresh all — the same pair the groups board wears.
   * A view's promise is that moving between kinds does not move the furniture,
   * and the tabs that promise is mostly about now live in the page header,
   * above both boards. Server markup, passed through; see the note on
   * `boardActions` in board-layout.tsx.
  ```

  Replace the row's opening comment:

  ```
      {/* The tab / action row, in the same place and shape the groups board
          puts it: the view strip on the left, the board's own controls on the
          right. On a canvas the arrangement door reads "Add" rather than "New
          group", and it takes the same first position in the right-hand group
          — arrangement, then filter, then the yellow act on the outside edge.
  ```

  with:

  ```
      {/* The action row, in the same place and shape the groups board puts it:
          the board's own controls on the right, the left half a spacer since
          the view strip moved into the page header. On a canvas the
          arrangement door reads "Add" rather than "New group", and it takes
          the same first position in the right-hand group.
  ```

  and replace the strip's cell:

  ```tsx
        <div className="min-w-0 flex-1">{viewStrip}</div>
  ```

  with:

  ```tsx
        {/* Empty spacer — see the same note in board-layout.tsx. */}
        <div className="min-w-0 flex-1" />
  ```

  Finally, promote the Add button. Replace:

  ```tsx
          <Button variant="white" size="sm" onClick={() => setOpen(!open)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
  ```

  with:

  ```tsx
          {/* THE BRAND IS SPENT HERE, AND ON "New flow", AND NOWHERE ELSE.
              `variant="white"` was a bordered chip from the light-page era —
              on three near-black surfaces it is a white slab beside two grey
              buttons. The Figma fills this one: it is the control that ADDS
              something, which is the whole of the rule the re-theme replaced
              "at most one yellow per screen" with. `accent` IS the brand fill
              (`bg-primary` under `text-primary-foreground`); the kit has no
              variant literally named `primary`. `xs` with a 16px glyph, the
              same rung and the same override as "Refresh all" beside it. */}
          <Button variant="accent" size="xs" className="[&_svg]:size-4" onClick={() => setOpen(!open)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
  ```

- [ ] **Step 6 — run it green**

  ```bash
  pnpm vitest run tests/dashboard-page-header.test.ts tests/calendar-view.test.ts tests/page-header.test.ts tests/board-controls.test.ts
  ```

  All four pass. `page-header.test.ts` (Task 5's) is re-run because this is the
  first caller of the `tabs` prop it defined; `board-controls.test.ts` because
  `RangeMenu` lands in the file it imports from and `RangeLink` must still be
  exported and behave exactly as it did.

- [ ] **Step 7 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/dashboard-page-header.test.ts tests/calendar-view.test.ts tests/page-header.test.ts tests/board-controls.test.ts tests/board-canvas-render.test.ts tests/board-shape.test.ts tests/dashboard-empty.test.ts && pnpm check:ui
  ```

  `typecheck` is what catches a half-removed prop: `noUnusedLocals` fails on a
  destructured `viewStrip` nothing reads, and the two boards' call sites in
  `page.tsx` fail on a prop their types no longer declare. `check:ui` passes —
  `RangeMenu` uses kit primitives and no raw `<button>`, and `[&_svg]:size-4`
  is a size utility rather than a radius or a colour.

- [ ] **Step 8 — commit**

  ```bash
  git add src/app/dashboard/board-controls.tsx src/app/dashboard/page.tsx src/app/dashboard/board-layout.tsx src/app/dashboard/custom-board.tsx tests/dashboard-page-header.test.ts tests/calendar-view.test.ts
  git commit -m "$(cat <<'EOF'
  Assemble the dashboard's header: tabs, a centred title, and a Today menu

  PageHeader's `tabs` slot has had no caller since it was added; this is it.
  The view strip moves out of BoardLayout and CustomBoard into the header,
  which switches the component into the Figma's three-zone row — strip left,
  the view's own name centred, the actions right. The six-pill period track
  becomes a secondary xs "Today" dropdown listing the same six presets and
  selecting them the same way, through ?range= in the URL, which also takes
  a 520px control and its horizontal scroller off a 390px viewport. "+ Add"
  moves from the light-era white chip to the brand fill at the same xs rung
  as Refresh all beside it.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

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
  surface and its cards. **500 is still the last step a LINE may be drawn in
  and 450 a caps-label-only step; 400 is the first that TEXT may be set in.**
  The gap that used to run 500→400 now runs 500→450→400, and 450 is
  deliberately narrow: a section label reads at it, a sentence must not.

  `neutral-300` (`#B5B5B5`), `neutral-100` (`#E5E5E5`) and `neutral-50`
  (`#FAFAFA`) keep their definitions and are re-cut with the rest of the
  ladder. No ROLE reads them any more — the Figma's own ink is two values, so
  `--muted-foreground` sits at 400 and nothing needs a third — but four files
  still spell them directly: `ui/scroll-area.tsx`'s thumb, `ui/switch.tsx`'s off
  track, `ui/button.tsx`'s `white` variant, and the flow builder's
  `node-meta.ts`, which is out of scope. Deleting a colour token out from under
  a live class is the "renders with no colour at all" failure §11's retired-token
  rule exists to punish, so they stay — orphaned by the roles, not retired.

  **Depth, and the sentence this kit no longer says.** "A control recesses from
  a card" was true of one theme and stated as a rule about both. What actually
  holds is that the two directions MIRROR: on dark, a field on the `#111111`
  chrome is a step UP (`--control` `#202020`) and its hover a further step up
  (`--accent` `#333333`); on light a field on white is a step DOWN (`#F4F4F4`)
  and its hover a further step down (`#ECECEC`). Neither is "recessed", and the
  Figma contradicts the old wording outright on the dark side.

  Shadows: `--shadow-card` is `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 /
  .10)` — the Figma's own card shadow, unchanged by theme. Card radius stays
  10px; controls 8px (§4); `--radius-frame` comes back at 8px — the panel's
  top-RIGHT corner, under the top bar at the end of the row away from the rail,
  now that the panel and the chrome are genuinely different colours again,
  which is exactly the condition the frame token existed for and lost two days
  ago when the whole shell became one surface.

  ### The light theme (`:root`), from the Figma's light export

  | Role | Hex | Measured |
  |---|---|---|
  | `--background` (page) and `--panel` | `#F7F8F9` | — |
  | `--chrome` (top bar, rail) and `--card` | `#FFFFFF` | — |
  | `--border` (hairline) | `#E1E1E1` | — |
  | control outline (`--input`) | `#E4E4E4` | — |
  | `--control` (search box, active nav row) | `#F4F4F4` | — |
  | `--secondary` | `#FFFFFF` with a `--input` outline — the Figma's own grey buttons are white with an `#E4E4E4` edge | — |
  | `--secondary-foreground` (that button's TEXT) | `#303030` | **13.2:1** on white |
  | icon ink, where a glyph sets its own | `#4A4A4A` | **8.86:1** on white, measured directly — the Figma export's own figure of 8.4:1 is a hair off, most likely a rounding pass on their side. It is a per-glyph choice, not the `--secondary-foreground` role: a label and its icon are two decisions and the export makes them differently |
  | `--foreground` / `--heading` | `#000000` / `#313131` (page title, workspace name) | — |
  | `--muted-foreground` | `#6B6B6B` — the Figma's own `#8E8E8E` measures **3.28:1** on white, short of the 4.5:1 body text owes; `#6B6B6B` clears **5.33:1** on white and **5.01:1** on `#F7F8F9` |
  | `--faint` (caps label) | `#8E8E8E` — the Figma's own `#BABABA` measures **1.94:1**, unreadable at any size | 3.28:1, caps label only |
  | `--avatar` (the bell and avatar circles) | `#FFFFFF` with the `--input` outline — the light export finds these by their edge, where dark finds them by a `#3A3A3A` fill | — |
  | `--muted` (fill) | `#F4F4F4` — the same step as `--control` | — |
  | `--accent` (hover) | `#ECECEC` — one further step down; see the depth note above | — |
  | `--rule` (heavier control edge) | `#CFCFCF` — one clear step darker than `--border`, the relationship `#4A4A4A` has to `#343434` in dark | — |
  | `--popover` / `--popover-foreground` | `= --card` / `= --card-foreground`, in BOTH themes — a menu is a card that floats, and pointing rather than repeating is what stops the two drifting | — |
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

  `neutral-300`, `neutral-100` and `neutral-50` are deliberately NOT in that
  table. No role reads them any longer, which is a different thing from being
  retired: four files still spell them as classes, so the tokens keep their
  definitions and were re-cut with the rest of the ladder. A row here would
  invite exactly the deletion §11 exists to prevent.

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
- Modify: `scripts/check-ui.ts` (one stale comment; **no rule changes** — see Step 9)
- Modify: `tests/retheme-blue-docs.test.ts`

**Interfaces**
- Consumes: `docs/BRAND_KIT.md` §2 as rewritten by the prior task (for the surface/ramp facts these sections reference); the spec's Type, Shape, Layout, Components, Tiles-and-charts and Docs-and-enforcement sections.
- Produces: §3 (numeral 28px, `.wordmark`, one weight exception and not two), §4 (8px/no-pill, final; the frame's top-right corner), §5 (top bar wordmark and no setup ring, rail dressing), §6 (component-level token facts, and the header's three actions), §9 (brand-series chart colours, the 12% wash, the tile edge removed from the default board), §11 (the cyan and `rounded-full` rows narrated, and the finding that `check-ui.ts` itself needs no rule change).

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
  quietly now. The weight is declared in the CSS class, never as a
  `font-black` utility at a call site, which is what keeps the exception
  contained: `scripts/check-ui.ts` reads `.tsx` and never `.css`, so its
  `font-bold` ban still fails the build on any heavy weight anywhere in the
  app and needs no allow-list entry — one rule, one file, no widening. It sits
  in the top bar's left slot now; the rail's mark moved out with it (§5).

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
  **One name per size**, enforced (§11). Weights are **400 / 500 / 600 — plus
  exactly ONE named exception.** `.wordmark` is it, at 900 (above), and it is
  one because the Figma names a face and a weight for that single string and
  for nothing else. The rail's workspace-switcher badge was considered as a
  second and refused: its initial ships at 13px/**600** (`font-semibold`),
  because "a one-character badge is not prose" is an argument that would let
  every badge in the product off, and the kit's top weight already reads as a
  badge at 13px. Every other request for 700 or 900 either Figma export made —
  and both made several — ships at 500 or 600 regardless.
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
  somewhere to point again. It rounds the panel's **top-RIGHT** corner, under
  the bar at the end of the row away from the rail; the rail-side corner stays
  square, and nothing about the top bar's own corners changes. That reverses
  the convention every earlier era of this shell used (`rounded-tl-frame`, the
  corner nearest the rail) and it is the export read literally rather than
  corrected toward habit. See Layout (§5).

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
  **No metrics-setup ring.** The export has none, and the progress it
  reported is already on the dashboard's own setup checklist with room to say
  what to do next — a 24px arc in the chrome was the same claim with no room
  for the second half. The arc, its `METRIC_GOAL` cap and the whole
  `metricCount` chain that fed it (page → `AppShell` → `AppFrame` → `TopBar`)
  came out together. `#topbar-slot` and `#topbar-status` — the two portals the
  flow builder's own chrome uses — are unchanged; the builder's toolbar still
  lands in the same bar, it is just a bluer, three-surfaced bar underneath it
  now.

  **The rail's dressing changed; its behaviour did not (decision 3).** It is
  still a hover rail: 56px of icons at rest on `--chrome`, opening in place
  to 260px. What used to be a bare icon column now expands into, top to
  bottom: a workspace switcher row (a 28px `rounded-control` square tinted
  `rgb(0 123 255 / .75)` carrying the initial in white at 13px/**600** — the
  kit's own top weight; the export's 700 here is one of the several §3 does
  not follow — the workspace name at 15px/600, and a chevron), a
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
  **top-right** corner under the bar, and a square top-left where it butts
  against the rail behind a hairline. Every earlier era cut the rail-side
  corner instead; this one follows the export, which softens the far end.
  `shell-skeleton.tsx` mirrors the geometry by hand, same as it always has,
  and `tests/page-width.test.ts` is the pin that keeps the mirror honest —
  including a negative assertion on `rounded-tl-frame`, because a convention
  that old comes back on its own otherwise.
  ```

- [ ] **Step 6 — implement: §6 Components, append token-level facts**

  Insert a new paragraph immediately after the existing §6 paragraph (the one
  ending `...never a re-typed class string.`, line 297) and before `##
  7. Interaction`:

  ```markdown

  **What this pass actually touches in these files, without changing what any
  of them mean:** `Button`'s base class carries `rounded-control` rather than
  `rounded-full` (§4); its `secondary` variant paints `bg-secondary
  text-secondary-foreground` with an `--input` outline — the Figma's own grey
  buttons are white with a hairline edge in light, a `#333333` fill in dark,
  and `--input` aliases `--border` there so the one spelling covers both. The
  brand fill is the `accent` variant (`bg-primary` under
  `text-primary-foreground`); there is no variant literally named `primary`,
  and prose that says "primary button" means this one. Sizes are untouched —
  32px is still the default height in both themes — and `xs` (24px, 13px
  type, 14px glyphs) is the header row's rung, with a `[&_svg]:size-4`
  override wherever the export draws 16px icons on it. `Card` fills with
  `--card`, edges with `--border`, and floats on `--shadow-card`, all three
  carrying new values from §2 without a line of the component changing.
  `Tabs`' line variant draws its active rule from `--rule` — the heavier
  control-edge step, not the hairline itself — and keeps 8px corners.
  `Avatar`'s fallback initials and its group-count overflow chip both fill
  with `--avatar` now, the same token, so a stack of avatars and the "+3"
  that follows it are one material. `Input`'s `Textarea` takes
  `rounded-control`, and its two stale `9999px` comments (left over from the
  pill era before this one) are corrected to say what the class actually
  renders. `ui/page.tsx`'s `PERIOD_TRACK` and `PERIOD_PILL` both move to 8px
  corners — the calendar's month stepper is what still wears them, and its
  two arrows drop the `rounded-full` override that would have left circles
  inside a rectangle. `Select` was already `rounded-control` on both its
  trigger and its items: verified, not changed.

  `PageHeader`'s title is centred whenever a caller passes the new `tabs`
  slot — tab strip left (an active tab at 15px/600 in `--heading` with a 1px
  `--muted-foreground` bottom rule and a "…" menu; inactive tabs 15px/500,
  muted; a 28px `secondary` "+" square), the title itself centred at 26px/600
  with its pencil, and the actions right. The dashboard is the one caller,
  and its three actions are the export's: a **"Today" dropdown** (`secondary`
  `xs`, a 16px calendar glyph, the selected preset's label, a chevron) in
  place of the six-pill period track — same six presets, same `?range=` in
  the URL, a tenth of the width and no horizontal scroller; **"+ Add"** on
  the brand fill at `xs` with a 16px plus; and **"Refresh All"** `secondary`
  `xs` with a 16px refresh glyph. Blue is spent on "+ Add" and "New flow",
  and on nothing else in the header.
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
  .12)` — which `Sparkbars` spells `bg-brand-500/12`, up from the 5% it had
  inherited, keeping its 25% border — and a bar is `#007BFF` flat. Target-met
  stays `success`; bottleneck stays `danger`; tracks stay `bg-muted`.
  Headline numbers per §3 — 28px now, not 36, and inked with `--heading`
  rather than inherited, which is the same white in dark and `#313131` in
  light. One `Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
  `src/components/charts.tsx`, shared by every tile.

  **A comparison series steps down to the ramp's 300 (`#66B2FF`)** — one
  series at two strengths, not two hues competing. *This row is documentation
  and nothing else today*: nothing in the product plots a second series, so
  there is no consumer to point at the token and none was invented to give
  the line something to do. It is written here so the first chart that needs
  one does not pick a colour.

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

  **AND `scripts/check-ui.ts` GAINS NOTHING, WHICH IS THE FINDING.** The
  obvious move — "add the cyan names to the retired-token rule" — does not
  apply, and it is worth writing down why so nobody adds them later. That rule
  matches deleted TOKEN NAMES rendered as classes (`bg-ink-400`,
  `text-marker-ink`), because an unresolved colour utility renders with no
  colour at all and looks plausible. No name is retired here: `brand-500` and
  `brand-600` both still exist and still compile — only their VALUES moved, and
  a value cannot be caught by a rule that reads class names. The old cyan
  HEXES, meanwhile, are already a build failure anywhere in a component under
  the generic `hex literal` rule, which bans every `#xxxxxx` in `.tsx` outside
  four named files. The `font-bold` ban needs no widening either: `.wordmark`
  declares its 900 in CSS and `check-ui.ts` reads `.tsx` only (§3). The radius
  set already keeps `full` for avatars, badges and dots (§4). So the cyan's
  retirement is recorded in the table above — where a value that changed under
  a name that did not actually belongs — and the gate is left alone.
  ```

- [ ] **Step 9 — implement: one stale comment in `scripts/check-ui.ts`**

  No rule changes, no allow-list entries, no new patterns. The file's retired
  `yellow-as-stroke` block quotes the cyan hexes as the CURRENT brand, which
  stops being true the moment Task 1 lands, and a gate that describes the
  wrong palette is the same doc-rot this section is about.

  Replace:

  ```ts
   * The measurement it was built on is gone. `--primary` is #00c0e8 and
   * `--marker` is #00cdf5, both cyan, and on #1b191a the stroke step is 9.20:1
   * — past what a line owes AND past what body text owes. The split it enforced
   * has nothing left to keep apart, and the exemption it carried (top-bar.tsx's
   * ring arc, "the one surface where the brand strokes at 8.77:1") is now every
   * surface in the product.
  ```

  with:

  ```ts
   * The measurement it was built on is gone twice over now. Cyan (`--primary`
   * #00c0e8, `--marker` #00cdf5) retired the rule on 2 September; the 4
   * September Figma replaced the cyan itself, so `--primary` is #0070e8 and
   * `--marker` is #3d9bff on dark and #0062cc on light. The split has nothing
   * left to keep apart either way — the dark stroke step measures 6.65:1 on
   * the page ground, past what a line owes AND past what body text owes. The
   * exemption this rule carried (top-bar.tsx's ring arc, "the one surface
   * where the brand strokes at 8.77:1") outlived it and then outlived the arc:
   * the ring itself was deleted with the same re-theme.
  ```

- [ ] **Step 10 — run it green**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all eleven `it`s across both describe blocks pass.

- [ ] **Step 11 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/retheme-blue-docs.test.ts && pnpm check:ui
  ```

  `check:ui` is run here for the ordinary reason and one extra: this task edits
  the gate's own source, so a typo in that comment block would surface as the
  script failing to parse rather than as a violation.

- [ ] **Step 12 — commit**

  ```bash
  git add docs/BRAND_KIT.md scripts/check-ui.ts tests/retheme-blue-docs.test.ts
  git commit -m "$(cat <<'EOF'
  Carry the blue re-theme through BRAND_KIT's type, shape, layout,
  components and enforcement sections

  The tile numeral drops to 28px and the wordmark is the kit's ONE weight
  above 600 -- the rail's switcher badge ships at 600 rather than becoming
  a second exception. Every pressable control is 8px with no pill, named
  final against the 4 September 2026 Figma, and the frame's corner comes
  back on the panel's top-RIGHT. The top bar carries the wordmark and no
  setup ring; charts default to the brand rather than the marker at a 12%
  wash. The retired-token table records the cyan ramp and
  rounded-full-on-buttons, and §11 records why check-ui.ts needs no rule
  change for either -- only one stale comment in it does.

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

  **The frame is back, and on the other corner.** `--radius-frame` was 0 two
  days ago because the notch's whole argument — a radius reveals whatever sits
  behind it — had nothing to reveal once the shell became one colour. It did
  not stay one colour; see §2. The token is **8px** again, cutting the content
  panel's **top-right** corner under the top bar. Every earlier era cut the
  top-LEFT, the corner nearest the rail, and the export does not: the panel
  butts square against the rail behind a hairline and softens the far end
  instead. Followed literally rather than corrected toward the older
  convention, and pinned in `tests/page-width.test.ts` with a negative
  assertion on `rounded-tl-frame` so the habit cannot return by itself.

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
  Weights are 400 / 500 / 600 — plus exactly ONE named exception, and the
  count matters more than the exception does. `.wordmark` is it, at 900,
  because the Figma names a face and a weight for that one string and for
  nothing else. The rail's workspace-switcher badge was the candidate for a
  second and did not get it: its initial ships at 13px/600, since "a
  one-character badge is not prose" would let every badge in the product
  through and 600 already reads as a badge at that size. Every other request
  for 700 or 900 either Figma export made ships at 500 or 600 regardless.
  `check:ui` still fails on `font-bold` and needs no allow-list for the
  wordmark: the 900 is declared in the CSS class, and the gate reads `.tsx`,
  never `.css`.
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

### Task 18: /design page — the specimens the tokens moved under, and the prose that was already stale

**Files**
- Modify: `src/app/design/page.tsx`
- Modify: `STATE.md`
- Modify: `tests/retheme-blue-docs.test.ts`

**Interfaces**
- Consumes: the POST-token state of `src/app/design/page.tsx`. Tasks 1, 2 and 3 already rewrote the `BRAND`, `SURFACE` and `INK` arrays and the `TYPE` table's numeral row in this file, because `tests/design-swatches.test.ts` cross-checks every `{ step, cls, hex }` row against `globals.css` and would have gone red the moment a token moved. **Every OLD quote below is that post-token text, not the pre-retheme file.** Also consumes `docs/BRAND_KIT.md` §2 (Task 15) for the wording the captions echo.
- Produces: the `RADII` array at 8px with the frame on the panel's top-right; the four rewritten `DIRECTION` rows; the ramp captions above each swatch table, including the `450` footnote; and the page's remaining pre-retheme prose — the `note=` strings and JSX comments that still describe a charcoal band, an off-white page, a yellow brand and a one-surface console — brought up to the blue console. `STATE.md` gains a dated line.
- Not produced here: the swatch arrays themselves. Re-writing them a second time is what the cross-area conflict this plan was corrected for actually was.

**On hex literals in this file**: `scripts/check-ui.ts`'s `hex literal` rule
carries an explicit allow-list entry — `"src/app/design/page.tsx": "the kit
page prints hex VALUES as documentation labels"` — so the `hex:` fields in the
swatch arrays and the `#111111` in the caption below are sanctioned, not
tolerated. Nothing in this task needs a new exemption and none is added.

- [ ] **Step 1 — extend the failing test**

  Add to `tests/retheme-blue-docs.test.ts`:

  ```ts
  describe("/design's specimens and prose reflect the blue re-theme", () => {
    const page = () => readFileSync(join(root, "src/app/design/page.tsx"), "utf8");

    /**
     * THE FIRST TWO ARE REGRESSION PINS, NOT THIS TASK'S OWN RED.
     *
     * The token-layer tasks rewrote the swatch arrays in this same file —
     * they had to, because `design-swatches.test.ts` compares every row's
     * hex against `globals.css` and would have failed the moment a token
     * moved. These assert that they stayed rewritten, which is the thing a
     * docs pass over the same file could plausibly undo.
     */
    it("the brand ramp still carries the new blue steps", () => {
      const src = page();
      expect(src).toMatch(/hex:\s*"#007bff"/);
      expect(src).toMatch(/hex:\s*"#0070e8"/);
    });

    it("the ramps still carry the three new dark steps", () => {
      const src = page();
      expect(src).toMatch(/bg-neutral-925/);
      expect(src).toMatch(/bg-neutral-850/);
      expect(src).toMatch(/bg-neutral-450/);
    });

    it("captions the 450 step where it is printed, since it is neither surface nor prose", () => {
      // The one ink step with a job narrow enough to need saying out loud —
      // and the one a reader would otherwise take for a body-text grey.
      expect(page()).toContain("faint — the caps section label only, 3.70:1 on #111111");
    });

    it("RADII and DIRECTION agree: control is 8px, not a pill", () => {
      const src = page();
      expect(src).not.toMatch(/control · pill/);
      expect(src).toMatch(/control · 8px/);
    });

    it("draws the frame specimen on the panel's top-right corner", () => {
      const src = page();
      expect(src).toMatch(/rounded-tr-frame/);
      expect(src, "the old rail-side notch is gone from the specimen too").not.toMatch(/rounded-tl-frame/);
    });

    it("the headline numeral caption is 28px", () => {
      expect(page()).toMatch(/token:\s*"text-display-md"[^}]*?px:\s*"28px"/);
    });

    it("has no prose left from the charcoal band, the off-white page or the yellow brand", () => {
      /**
       * THE DOC-ROT THIS PAGE ACCUMULATED, PINNED SO IT CANNOT COME BACK.
       *
       * These strings are not near-misses: `#2E2E2E` was the charcoal band,
       * `#F5F5F5` the light page under it, `ink-950` a ramp retired two
       * re-themes ago, and "ONE GREEN, IN THREE SHAPES" a caption for a
       * yellow-and-violet kit. Each described the product accurately at some
       * point and none of them has for months, on the one page whose whole
       * job is to be the reference.
       */
      const src = page();
      for (const dead of ["#2E2E2E", "#F5F5F5", "ink-950", "ink-900", "ink-800", "ONE GREEN, IN THREE SHAPES", "Pill-first"]) {
        expect(src, `"${dead}" is still on the kit page`).not.toContain(dead);
      }
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

  Expected: the 450-caption, RADII, frame-corner, dead-prose and STATE.md
  `it`s fail. The two ramp pins and the 28px caption PASS already — the
  token-layer tasks put those rows in the file, and this task's job is to
  keep them rather than to write them; they are here so a later edit to this
  page cannot quietly undo them. All sixteen `it`s from the prior three docs
  tasks still pass.

- [ ] **Step 3 — implement: the ramp captions, including the 450 footnote**

  The three caption lines above the swatch tables still count the old ramps.
  Replace:

  ```tsx
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            Surface — the five things the app is built out of, neutral-*
          </p>
  ```

  with:

  ```tsx
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            Surface — eight steps, three of them grounds: 950 page, 925 chrome and card, 900 panel, neutral-*
          </p>
  ```

  and replace:

  ```tsx
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ink — four values, one per job, neutral-*</p>
  ```

  with:

  ```tsx
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Ink — three values, one per job, neutral-* · 450 is faint — the caps section label only, 3.70:1 on #111111,
            and never a sentence
          </p>
  ```

  (`#111111` as literal text is what this page is for, and is covered by
  `check-ui.ts`'s own allow-list entry for this file — see the note above.)

- [ ] **Step 4 — implement: `RADII`**

  This array is untouched by the token tasks — it is captions, not rows — so
  the OLD text below is the file as it stands today. Replace:

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

  with:

  ```tsx
  const RADII: Array<{ cls: string; label: string; body: string }> = [
    { cls: "rounded-control", label: "control · 8px", body: "Buttons, inputs, selects, tabs, nav rows, the period switch — no pill, final word" },
    { cls: "rounded-card", label: "card · 10px", body: "Tiles, list rows, board cards" },
    { cls: "rounded-surface", label: "surface · 10px", body: "Panels, modals, tables, step cards — the same radius as a card, on a bigger object" },
    /* THE FRAME IS BACK, ON THE OTHER CORNER. It was 32px while the frame
       painted a gradient behind a transparent rail, then 16px, then 0 when the
       rail, the bar and the page became one surface and a notch had nothing
       left to reveal. There are three surfaces again — the panel is #181818
       under a bar and beside a rail that are #111111 — so 8px, half the old 16
       because the step it reveals is a fraction of what the light page was.
       Applied to the panel's TOP-RIGHT corner: every earlier era cut the
       top-left, nearest the rail, and the 4 Sep 2026 Figma does not. The rail
       side butts square behind a hairline. */
    { cls: "rounded-frame", label: "frame · 8px", body: "The panel's top-right corner, under the bar away from the rail" },
  ];
  ```

- [ ] **Step 5 — implement: the four `DIRECTION` rows**

  Also untouched by the token tasks. Replace the "One surface, and a hairline"
  row:

  ```tsx
    {
      rule: "One surface, and a hairline",
      why: "The rail, the top bar and the page are ALL #1B191A, and every separation in the product is a 1px #3D393B rule. This is the reverse of the band that wrapped a light page, and the reversal is the whole re-theme: with one material there is no 40-point luminance step to find its own edge, so the hairline stops being trim and becomes the structure. A card is #272426 — a 1.14:1 step — so a card without its border is not a flatter card, it is an invisible one.",
    },
  ```

  with:

  ```tsx
    {
      rule: "Three darks, and a hairline",
      why: "The page is #0F1011; the top bar, the rail and every card are #111111; the panel under the top bar is #181818 — three surfaces where the two-day-old console ran one. They sit within a hair of each other on purpose (#111111 on #0F1011 measures 1.01:1, tighter than the 1.14:1 step the last surface ran), so the 1px #343434 rule between them is doing more work than ever, not less: a surface change nobody can see without its edge is not a flatter surface, it is an invisible one.",
    },
  ```

  Replace the "Content floats on the ground" row:

  ```tsx
    {
      rule: "Content floats on the ground",
      why: "Nothing sits flat on the page but a heading or a caption. Everything with content in it is an island with an EDGE, and the edge is the whole of it: a card is a 1.14:1 step off the page, so the border is not trim on a surface you can already see, it is the only thing making the surface visible at all.",
    },
  ```

  with:

  ```tsx
    {
      rule: "Content floats on the ground",
      why: "Nothing sits flat on the page but a heading or a caption. Everything with content in it is an island with an EDGE, and the edge is the whole of it: a card is #111111 on a #0F1011 page — 1.01:1, tighter than ever — so the border is not trim on a surface you can already see, it is the only thing making the surface visible at all.",
    },
  ```

  Replace the "One blue, in three shapes" row:

  ```tsx
    {
      rule: "One blue, in three shapes",
      why: "The fill/stroke split existed because #EECF00 is 1.55:1 as a stroke on white and 11.24:1 as a fill — an absent line and a superb box, so the brand could only safely do one of the two jobs and a second colour had to hold the other. On #1B191A the blue is 9.20:1 drawn and 8.08:1 filled, so the split has nothing left to prevent and yellow-as-stroke retires with it. What replaces it is a rule about SHAPE, all three visible at once in the rail: a RING is identity (the mark), a GLYPH is location (the active row), a FILL is action (the +, every primary button). Success is NOT the brand: it kept the green the brand vacated, because a DONE badge and a New-flow button being one colour would put the loudest state and the loudest act in one vocabulary. Warn and danger are the other two state hues, and what stops any of them becoming wallpaper is that status is quiet when fine.",
    },
  ```

  with:

  ```tsx
    {
      rule: "One blue, two jobs",
      why: "#007BFF replaces the cyan everywhere. It does two jobs, not three: a STROKE (--marker: links, the focus ring, the active tab rule) at 6.65:1 down to 6.20:1 across the three dark surfaces, and a FILL (--primary, one step deeper at #0070E8) at 4.68:1 under white ink. The 'glyph is location' job the cyan carried is gone — the rail's active row is a neutral --control fill now, not a coloured icon, because that is what the Figma draws. Success is still NOT the brand: it keeps the green the brand vacated, because a DONE badge and a New-flow button being one colour puts the loudest state and the loudest act in one vocabulary. Warn and danger are the other two state hues, and status is still quiet when fine.",
    },
  ```

  Replace the "Ten contains, eight presses" row:

  ```tsx
    {
      rule: "Ten contains, eight presses",
      why: "Everything that contains something is 10px — cards, panels, popovers, selects, the period track. Everything pressable is 8. A badge is 4. An avatar and a status dot are the only full radii left. This replaced 'everything pressable is a full pill', which needed an exception it could never justify: a control that WRAPS cannot be a pill, because a full radius on a two-line box renders as a circle around the words. There is no exception now.",
    },
  ```

  with:

  ```tsx
    {
      rule: "Ten contains, eight presses",
      why: "Everything that contains something is 10px — cards, panels, popovers, selects, the period track. Everything pressable is 8: buttons, chips, inputs, selects, tabs, nav rows, the period switch. A badge is 4. Circles are reserved for four things that are never an action — an avatar, the bell's unread badge, the freshness dot, and the tile's active-count numeral. This replaced 'everything pressable is a full pill' for the second time, and the 4 September 2026 Figma is named as the reference so a third flip needs a new design rather than a preference.",
    },
  ```

- [ ] **Step 6 — implement: the `note=` strings that still describe an older product**

  These are the page's own captions, and every one of them was wrong before
  this re-theme started — they describe a charcoal band around an off-white
  page, a yellow brand and a violet marker. The page whose job is to be the
  reference is the last place that can carry them.

  **6a. Brand sheet.** Replace:

  ```tsx
          note="The supplied sheets, rendered from the shipping components rather than drawn. Kept as the historical record of a language this kit no longer speaks: deep black doing the work, a yellow carrying the act, a violet drawing every line, and everything shaped as a full pill. What survived the re-theme is the argument rather than the palette — the workhorse is quiet and colour arrives only where it means something, which is now one blue in three shapes on a single near-black surface."
  ```

  with:

  ```tsx
          note="The supplied sheets, rendered from the shipping components rather than drawn. Kept as the historical record of a language this kit no longer speaks: deep black doing the work, a yellow carrying the act, a violet drawing every line, and everything shaped as a full pill. What survived is the argument rather than the palette — the workhorse is quiet and colour arrives only where it means something, which is now one blue doing a stroke's job and a fill's, across three near-black surfaces."
  ```

  **6b. Colour.** Replace:

  ```tsx
          note="ONE GREEN, IN THREE SHAPES. That is a measurement, not a preference: #EECF00 is 1.55:1 as a stroke or as text on white and 11.24:1 as a fill under #1A1A1A ink, so the brand is spent on filled objects — the mark, the active rail chip, primary buttons, the unread badge, step markers — and never on a rule, a ring, a border or a glyph standing on the page. Everything that draws is the marker's violet: focus rings, links, hover borders, selection rings, the active tab's rule. The one place yellow may stroke is a dark surface, where it measures 8.77:1 — which is why the top bar's progress arc is yellow and a link never is. check:ui's yellow-as-stroke rule fails the build the moment the primary is spelled as text, a border, a ring, a stroke, a fill or a divide, which is what makes this rule enforceable where 'yellow is the hero at most once per screen' never was — nothing could ever count the yellows on a screen. Beside the two sits a three-colour accent set (orange, pink, periwinkle) for surfaces that need to be identifiable rather than to mean something; success, warn and danger keep the job of meaning."
  ```

  with:

  ```tsx
          note="ONE BLUE, TWO JOBS, and both of them measured. #0070E8 FILLS, carrying white ink at 4.68:1 — one step deeper than the Figma's own #007BFF, which measures 3.98:1 under white and is under the 4.5 a 15px label owes. #3D9BFF DRAWS on dark (6.65:1 on the page, 6.20:1 on the panel) and #0062CC draws on light (5.80:1 on white), because a 1px rule owes more room than a button's own ink does. The 'yellow fills, violet draws' split is retired and so is the gate rule that policed it: two steps of one ramp need no rule to keep them apart. Beside them sits a three-colour accent set (orange, pink, periwinkle) for surfaces that need to be identifiable rather than to mean something; success, warn and danger keep the job of meaning, and the tile's freshness dot has its own #34C759 so retuning a status can never move it."
  ```

  **6c. Radius and elevation.** Replace:

  ```tsx
          note="Pill-first, the way the sheet draws it: every button, input and menu row is fully round, cards take 10px and panels 16px. One elevation ladder — hairline borders carry structure, shadows only say how far a surface floats."
  ```

  with:

  ```tsx
          note="8px-first, the way the 4 September 2026 Figma draws it: every button, input, select, tab, nav row and the period switch is an 8px rectangle, cards and panels take 10px, and circles are reserved for avatars, the bell badge, the freshness dot and the active-count numeral. One elevation ladder — hairline borders carry structure, shadows only say how far a surface floats, and --shadow-card is the export's own value in both themes."
  ```

  **6d. Rail.** Replace:

  ```tsx
          note="A 48px icon column in the SAME #1B191A as the page beside it, separated by one hairline. These tiles are a swatch — the real markup lives in src/components/sidebar.tsx and nowhere else, and it has moved on from what is drawn here: the active row is a brand GLYPH on a raised chip rather than a filled brand square, because the fill is spent once in this column and it is spent on the + in the foot, which is the one verb."
  ```

  with:

  ```tsx
          note="A 56px icon column on --chrome (#111111), one step off the #0F1011 page beside it and separated by one hairline. These tiles are a swatch — the real markup lives in src/components/sidebar.tsx and nowhere else, and it has moved on from what is drawn here: the rail opens to 260px on hover with a workspace switcher at its head, a Main Menu caption and a Get Free Access row at its foot. The active row is a neutral --control fill, not a coloured glyph: the brand's 'location' job retired with the cyan, and the fill is spent on the New flow button in the foot."
  ```

  **6e. Marks.** Replace:

  ```tsx
          note="What a dashboard tile is made of. The series is the MARKER — a series is a mark, and the fill step is reserved for things you press — the last bucket takes the ink (a positional fact, not a verdict), and a breakdown walks the marker plus the accent three. TargetBar drew met in --success and in-progress in --marker, which were the same green while success WAS the brand — so it rendered both states identically and stopped reporting the only thing it exists to report. That collision is gone (the brand is cyan, success is green), but the fix outlived it on its own merits: the unmet meter is greyscale and colour ARRIVES when the goal lands, which is the honest reading anyway — a bar at 40% is not good, it is 40%. Every value goes through formatMetricValue, so the tooltip and the headline say the same quantity the same way. A delta is never green or red: up is good for Booked Leads and bad for Speed to Lead, and nothing on a tile knows which — so it is coloured by WHETHER it moved, and the arrow alone carries direction."
  ```

  with:

  ```tsx
          note="What a dashboard tile is made of. The series is the BRAND — --color-brand-500 (#007BFF), the same blue as the buttons, with a 12% wash under it — because after the ramp split, --marker is the stroke step for links and rings and no longer the colour the product measures in. A breakdown walks that blue plus the accent three. TargetBar drew met in --success and in-progress in --marker, which were the same green while success WAS the brand — so it rendered both states identically and stopped reporting the only thing it exists to report. That collision is long gone, but the fix outlived it on its own merits: the unmet meter is greyscale and colour ARRIVES when the goal lands, which is the honest reading anyway — a bar at 40% is not good, it is 40%. Every value goes through formatMetricValue, so the tooltip and the headline say the same quantity the same way. A delta is never green or red: up is good for Booked Leads and bad for Speed to Lead, and nothing on a tile knows which — so it is coloured by WHETHER it moved, and the arrow alone carries direction."
  ```

- [ ] **Step 7 — implement: the specimens whose own markup went stale with them**

  **7a. The toast swatch's comment**, which names a ramp retired two re-themes
  ago. Replace:

  ```tsx
              {/* `ink-800` is the toast's rung — the ladder's "raised" step,
                  which is what `ui/toast.tsx` actually paints. On a charcoal
                  band raised means LIGHTER, so this now sits ABOVE ink-950
                  rather than below it. */}
  ```

  with:

  ```tsx
              {/* `neutral-700` is the toast's rung — the ladder's "raised"
                  step, which is what `ui/toast.tsx` actually paints. On a
                  near-black surface raised means LIGHTER, so it sits above the
                  page rather than below it. (The `ink-*` ramp this comment used
                  to name was retired with the light theme.) */}
  ```

  **7b. The rail swatch's surface**, which paints the page's colour rather than
  the rail's. Replace:

  ```tsx
            {/* `bg-background`, the band's own token, rather than `bg-rail`: that
                role answers WHITE in the light theme (the 264px sidebar it was
                named for became a recessed light column long ago) and painting
                a swatch of the chrome with it would show white glyphs on white.
                The band is the ink ladder's base and does not invert. */}
            <div className="inline-flex items-start gap-3 rounded-card bg-background px-5 py-4">
  ```

  with:

  ```tsx
            {/* `bg-chrome`, which is what the real rail is painted. It was
                `bg-background` while the rail, the bar and the page were one
                colour and the distinction cost nothing; under three surfaces
                that would draw the swatch on the PAGE's step and quietly
                misreport the one thing this specimen exists to show. (`--rail`
                itself is long retired — see the retired-token table.) */}
            <div className="inline-flex items-start gap-3 rounded-card bg-chrome px-5 py-4">
  ```

  **7c. The rail swatch's ACTIVE chip**, which fills with the brand where the
  Figma fills with the control step. Replace:

  ```tsx
                <span className="flex size-10 items-center justify-center rounded-control bg-primary text-primary-foreground">
                  <LayoutDashboard size={24} />
                </span>
  ```

  with:

  ```tsx
                {/* THE ACTIVE ROW IS NEUTRAL NOW. It was the brand, filled —
                    the "glyph is location" job the cyan carried. The 4 Sep 2026
                    Figma marks the active row with a `--control` fill and an
                    ordinary ink glyph, which is what leaves the brand free to
                    mean "this does something" everywhere else. */}
                <span className="flex size-10 items-center justify-center rounded-control bg-control text-foreground">
                  <LayoutDashboard size={24} />
                </span>
  ```

  **7d. The rail's two prose paragraphs.** Replace:

  ```tsx
              <p>
                The band is <code className="font-mono text-foreground">ink-950</code>{" "}#2E2E2E in both themes — flat,
                not a gradient, and with no seam inside it: the rail&rsquo;s right edge and the top bar&rsquo;s underside
                are one continuous shape, because a rule drawn where two different materials already meet is a rule
                doing nothing.
              </p>
              <p>
                REST IS NOTHING AT ALL. Every chip but one is a bare white glyph — on this charcoal a 16px white mark
                measures 14.08:1, so it does not need a plate to be found, and seven pale squares down a 70px column were
                the loudest thing in the chrome. Hover raises to <code className="font-mono text-foreground">ink-900</code>{" "}
                and ACTIVE is the brand, filled, at 8.77:1 on the band — one yellow chip in the column, which is why the
                other six do not have to compete to be seen.
              </p>
  ```

  with:

  ```tsx
              <p>
                The rail is <code className="font-mono text-foreground">--chrome</code> (#111111), the same step as the
                top bar above it and every card on the page — one count off the #0F1011 ground and two off the #181818
                panel, so its right edge is a real 1px hairline rather than a luminance step you could see unaided.
              </p>
              <p>
                REST IS NOTHING AT ALL. Every chip but one is a bare glyph on the chrome — a white mark measures 18.1:1
                there, so it does not need a plate to be found, and seven pale squares down the column were the loudest
                thing in it. Hover raises to <code className="font-mono text-foreground">--accent</code> and ACTIVE takes
                a <code className="font-mono text-foreground">--control</code> fill: neutral, not the brand, because
                where you are is not something you press.
              </p>
  ```

  **7e. The frame specimen**, which is the one place the corner is drawn.
  Replace:

  ```tsx
          note="THE NOTCH IS GONE AND --radius-frame IS 0. It cut 16px out of the page's top-left so the band's charcoal showed through — the one corner where the page met both halves of the band at once. A radius reveals whatever is BEHIND the element it is cut into, and the thing behind the page is now the same #1B191A as the page: cutting a corner out of it to reveal it draws nothing, at the cost of a curved notch the top bar's hairline then has to stop short of. What frames the application now is the pair of rules, not a shape."
        >
          <div className="flex h-40 overflow-hidden rounded-card bg-background">
            <div className="w-[100px] shrink-0" />
            <div className="flex-1 rounded-tl-frame bg-background" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A radius reveals whatever is BEHIND the element it is cut into, which is why the column holding the top bar
            and the page is painted <code className="font-mono text-foreground">ink-950</code> rather than left at
            `background`: at #F5F5F5 behind #F5F5F5 the notch was perfectly invisible. The page inside it is{" "}
            <code className="font-mono text-foreground">--ground</code>, and content sits on it in islands, never flat.
          </p>
  ```

  with:

  ```tsx
          note="THE NOTCH IS BACK AND --radius-frame IS 8px. It went to 0 when the rail, the bar and the page became one colour: a radius reveals whatever is BEHIND the element it is cut into, and cutting a corner out of a colour to reveal the same colour draws nothing. There are three surfaces again — the panel is #181818 under a bar and beside a rail that are #111111 — so there is something to reveal. It is the panel's TOP-RIGHT corner, under the bar at the end of the row away from the rail; every earlier era of this shell cut the top-left instead, and the 4 September 2026 Figma does not."
        >
          <div className="flex h-40 overflow-hidden rounded-card bg-chrome">
            {/* The rail's width, holding the chrome's own colour — the panel
                butts square against it, which is the half of this specimen
                that is easy to miss. */}
            <div className="w-[100px] shrink-0" />
            <div className="flex-1 rounded-tr-frame bg-panel" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A radius reveals whatever is BEHIND the element it is cut into, which is why this specimen paints the frame{" "}
            <code className="font-mono text-foreground">--chrome</code> and the panel inside it{" "}
            <code className="font-mono text-foreground">--panel</code>: with both the same colour the corner would be
            perfectly invisible, which is exactly the argument that took the token to 0 two days ago. Content sits on the
            panel in islands, never flat.
          </p>
  ```

- [ ] **Step 8 — implement: `STATE.md`, add the dated line**

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
  drops from 36px to 28px; the top bar gains a wordmark the rail used to
  carry and loses the metrics-setup ring; and the dashboard's six-pill
  period track becomes a "Today" dropdown beside a centred title.
  `docs/BRAND_KIT.md`, `DESIGN.md` and `/design` were rewritten in lockstep
  — see `docs/superpowers/specs/2026-09-04-retheme-blue-design.md` for the
  approved decisions and the measured contrast ratios behind them.
  ```

- [ ] **Step 9 — run it green**

  ```bash
  pnpm vitest run tests/retheme-blue-docs.test.ts
  ```

  Expected: all twenty-four `it`s across all five describe blocks pass.

- [ ] **Step 10 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/retheme-blue-docs.test.ts tests/design-swatches.test.ts tests/design-index.test.ts && pnpm check:ui
  ```

  `design-swatches.test.ts` IS in this gate, unlike the earlier docs tasks:
  this task edits the same file it parses, and the guard that matters is its
  "finds the ramps (a parse that silently matches nothing would pass
  everything)" case — a caption edit that accidentally reformatted a swatch
  row would turn that whole file green on zero assertions. `check:ui` passes
  because this file is already on the `hex literal` rule's allow-list.

  **This is the last task on the branch, so the BRANCH gate runs here too**,
  after the per-task one above:

  ```bash
  pnpm typecheck && pnpm vitest run --maxWorkers=2 && pnpm build && pnpm check:orphans && pnpm check:ui
  ```

  Then the screenshot sweep the spec's Rollout section describes: every
  authenticated route, both themes, 1440 and 1920 wide, with the Figma beside
  it. Playwright is not in the repo — it is `pnpm dev` and a manual capture by
  the reviewer.

- [ ] **Step 11 — commit**

  ```bash
  git add src/app/design/page.tsx STATE.md tests/retheme-blue-docs.test.ts
  git commit -m "$(cat <<'EOF'
  Bring the /design kit page's specimens and prose up to the blue console

  The swatch arrays already moved with the tokens; what was left was the
  page's own argument, and most of it had been wrong since before this
  re-theme: notes describing a charcoal band, an off-white page, a yellow
  brand and a violet marker, an ink-* ramp retired two re-themes ago, and
  a frame specimen drawing a notch the token had been holding at 0. RADII
  goes to 8px with the frame on the panel's top-right, the four DIRECTION
  rows say three surfaces and two jobs, the ramp captions count the steps
  that are actually there, and the 450 step gets the caption it needs to
  not be read as body-text grey. STATE.md gets a dated line pointing at
  the approved spec.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 19: Mobile shell — the rail becomes a left drawer below `md`

**Runs after Task 9.** Every quotation below is of the code Tasks 7, 8 and 9
PRODUCE, not of what is in the tree today: `app-frame.tsx`, `top-bar.tsx`,
`sidebar.tsx` and `shell-skeleton.tsx` are all still pre-Task-7 as this is
written, and starting here before the shell has turned would edit three files
into a shape the next commit overwrites.

**Files**
- Modify: `src/components/sidebar.tsx` (extract `RailContent`; hide the rail below `md`; 44px rows)
- Create: `src/components/mobile-drawer.tsx`
- Modify: `src/components/top-bar.tsx` (a `menu` slot; the greeting and the two acts step aside below their breakpoints)
- Modify: `src/components/app-frame.tsx` (build the drawer, hand it to the bar; the panel's corner is `md:` now)
- Modify: `src/components/shell-skeleton.tsx` (mirror both)
- Modify: `package.json` (`jsdom`, dev — see Step 1's note; it is the repo's first)
- Test: `tests/page-width.test.ts` (two existing pins re-aimed at both layouts), `tests/mobile-shell.test.ts` (new), `tests/mobile-drawer.test.ts` (new, jsdom)

**Interfaces**
- Consumes: the post-Task-8 `Sidebar` body (`SLOT`, `ICON_COL`, `GUTTER`, `REVEAL`, `RailLabel`, `RailChip`, `ViewList`, the switcher, the search field, Main Menu, the foot); the post-Task-7 `<header>` in `top-bar.tsx`; `ui/sheet.tsx`'s `Sheet` / `SheetContent` / `SheetTrigger` / `SheetTitle` (vendored, unchanged by this task); `bg-avatar`, `bg-chrome`, `border-border` (Tasks 2–3).
- Produces: `RailContent({ hide?, views?, workspace?, account?, invite? })` — a new **export of `sidebar.tsx`**, rendered by the rail's panel AND by the drawer, which is what the spec's "the same component tree, not a copy" means in code; `MobileDrawer({ hide?, views?, workspace?, account? })`; `TopBar({ account?, firstName?, unread?, menu? })` — one new optional `ReactNode` slot.
- Does NOT produce a second nav data structure, a second `NAV` array, or a copy of any row's markup. The test in Step 1 asserts the drawer file contains none of the rail's strings.

**Why the drawer needs no new "expanded" flag.** `REVEAL` (sidebar.tsx) is
`opacity-0 … group-hover/rail:opacity-100 group-focus-within/rail:opacity-100
group-data-[pinned=true]/rail:opacity-100`, and `ViewList` and the "New flow"
fill read the same three. Rendered outside a `group/rail` every label in the
tree would be invisible — which is exactly the trap a hand-copied drawer falls
into. The drawer therefore wraps `RailContent` in `group/rail`
`data-pinned="true"`: the third variant fires, every label, the keycap, the
view list and the filled "New flow" row open together, and not one class in
`sidebar.tsx` learns that a drawer exists.

- [ ] **Step 1 — write the failing tests**

  Two new files and two edits to an existing one.

  **1a. `tests/mobile-shell.test.ts`** — the breakpoint contract, as source
  pins. This is not laziness about rendering: a Tailwind breakpoint IS a class
  in this codebase, jsdom applies no stylesheet at all, and `page-width.test.ts`
  and `chrome-band.test.ts` already pin every other measurement in this shell
  the same way.

  ```ts
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  import { describe, expect, it } from "vitest";

  /**
   * THE PHONE LAYOUT, PINNED WHERE IT ACTUALLY LIVES.
   *
   * Below `md` the rail is not rendered and a drawer carries it instead. Every
   * half of that is a class — `hidden md:block` on the footprint, `md:hidden`
   * on the trigger — so it is pinned as source, the way this shell's other
   * geometry already is. The one thing that is genuinely BEHAVIOUR (the drawer
   * opens, and closes when the route changes under it) is in
   * `tests/mobile-drawer.test.ts`, which pays for a DOM.
   */
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const sidebar = read("src/components/sidebar.tsx");
  const drawer = read("src/components/mobile-drawer.tsx");
  const bar = read("src/components/top-bar.tsx");
  const frame = read("src/components/app-frame.tsx");
  const skeleton = read("src/components/shell-skeleton.tsx");

  describe("the rail below md", () => {
    it("is not rendered at all — footprint, panel and toggle together", () => {
      // The <aside> IS the footprint. Hiding the panel alone would leave a
      // 56px column of nothing on the left of every phone screen.
      expect(code(sidebar)).toMatch(/"relative z-20 hidden h-full shrink-0 md:block"/);
    });

    it("hands its content to a component both it and the drawer render", () => {
      expect(sidebar).toMatch(/export function RailContent\(/);
      expect(code(sidebar)).toMatch(/<RailContent hide=\{hide\} views=\{views\} workspace=\{workspace\} account=\{account\} \/>/);
      expect(code(drawer)).toMatch(/<RailContent[\s\S]{0,160}invite/);
    });

    it("is not copied into the drawer, which is the whole point", () => {
      /**
       * THE FAILURE THIS EXISTS TO STOP is a drawer that reimplements the rail
       * — two nav lists, two search rows, two answers to "which view am I on",
       * drifting apart on the first change to either. If any of these strings
       * appears in the drawer's own file, the tree was copied rather than
       * rendered.
       */
      for (const literal of ["Main Menu", "Get Free Access", "aria-keyshortcuts", "LayoutDashboard"]) {
        expect(drawer, `the drawer re-spells ${literal}`).not.toContain(literal);
      }
    });
  });

  describe("the drawer", () => {
    it("is the kit's sheet, on the left, at the export's width and fill", () => {
      expect(drawer).toContain('side="left"');
      expect(drawer).toContain("w-[280px]");
      expect(drawer).toContain("bg-chrome");
      expect(drawer).toContain("border-border");
    });

    it("exists only below md, on the trigger AND on the panel", () => {
      // Both, because a drawer left open across a resize past 768px would
      // otherwise sit beside the rail it stands in for.
      const trigger = drawer.slice(drawer.indexOf("SheetTrigger"), drawer.indexOf("SheetContent"));
      expect(trigger).toContain("md:hidden");
      expect(drawer.slice(drawer.indexOf("<SheetContent"))).toContain("md:hidden");
    });

    it("opens the rail's own tree by pinning it, not by re-styling it", () => {
      // `REVEAL` fades on `group-data-[pinned=true]/rail`. No wrapper, no
      // labels — this is the line that makes the reuse work.
      expect(code(drawer)).toMatch(/group\/rail[^"]*"[\s\S]{0,120}data-pinned="true"/);
    });

    it("closes on navigation, and on a change of view", () => {
      /**
       * `usePathname` ALONE IS NOT ENOUGH, and this is the assertion that says
       * why: the dashboard's views are `?view=` on one pathname, so a drawer
       * keyed on the path only would stay open over the board it just changed.
       * `sidebar.tsx` already calls `useSearchParams()` in this same tree, so
       * the dynamic-rendering cost was paid before this task existed.
       */
      expect(drawer).toContain("usePathname");
      expect(drawer).toContain("useSearchParams");
      expect(code(drawer)).toMatch(/useEffect\([\s\S]{0,120}setOpen\(false\)[\s\S]{0,80}\[pathname, search\]\)/);
    });

    it("carries the two acts the bar sheds", () => {
      expect(code(drawer)).toMatch(/invite\b/);
      expect(code(sidebar)).toMatch(/\{invite && \(/);
    });
  });

  describe("the top bar below md", () => {
    it("takes a menu slot and draws it before the mark", () => {
      const header = bar.slice(bar.indexOf("<header"));
      expect(header.indexOf("{menu}")).toBeGreaterThan(-1);
      expect(header.indexOf("{menu}")).toBeLessThan(header.indexOf("Namzilabs"));
      expect(code(frame)).toMatch(/<TopBar[\s\S]{0,240}menu=\{<MobileDrawer/);
    });

    it("draws the menu button at 32px, on the avatar circle", () => {
      const trigger = drawer.slice(drawer.indexOf("SheetTrigger"), drawer.indexOf("SheetContent"));
      expect(trigger).toContain('size="icon"');
      expect(trigger).toContain("rounded-full bg-avatar");
    });

    it("drops the greeting below sm and both acts below md", () => {
      // One span carries both rules: `max-sm:hidden` for the phone and the
      // pre-existing peer rule for the builder's portalled toolbar.
      expect(code(bar)).toMatch(/max-sm:hidden[^"]*peer-\[:not\(:empty\)\]:hidden|peer-\[:not\(:empty\)\]:hidden[^"]*max-sm:hidden/);
      // Exactly two controls step aside at `md` — Invite members and New flow.
      // Counted over the CODE: the note above them names both by hand, and a
      // rule that can read its own explanation counts to four.
      expect(code(bar).match(/hidden md:inline-flex/g) ?? []).toHaveLength(2);
      expect(code(bar)).toContain("Invite members");
      expect(code(bar)).toContain("New flow");
    });
  });

  describe("touch targets below md", () => {
    it("gives every rail row 44px, and hands it back at md", () => {
      expect(sidebar).toMatch(/const SLOT = "[^"]*\bmin-h-11\b[^"]*\bmd:min-h-0\b/);
    });

    it("gives the nested view rows the same, since they are nav rows too", () => {
      // The view link and the "Show all" fold, between `ViewList` and the
      // frame component below it. `SLOT` is a module constant above this
      // region, so its own `min-h-11` cannot be what satisfies the count.
      const list = sidebar.slice(sidebar.indexOf("const ViewList"), sidebar.indexOf("export function Sidebar"));
      expect(list.match(/min-h-11[^"]*md:min-h-0/g) ?? []).toHaveLength(2);
    });
  });

  describe("the skeleton mirrors the phone layout too", () => {
    it("reserves no rail below md", () => {
      expect(code(skeleton)).toMatch(/hidden w-\[56px\][^"]*md:block/);
    });

    it("drops the panel's corner below md, in both files", () => {
      expect(code(skeleton)).toContain("md:rounded-tr-frame bg-panel");
      expect(code(frame)).toContain("md:rounded-tr-frame bg-panel");
    });
  });
  ```

  **1b. `tests/mobile-drawer.test.ts`** — the one behaviour a source pin cannot
  reach.

  > **This is the repo's first jsdom test.** Verified before writing it:
  > `grep -rn "jsdom\|@testing-library" tests/ package.json` returns exactly one
  > hit, and it is a sentence in `tests/freshness-poller.test.ts` saying there
  > isn't one. `vitest.config.ts` sets `environment: "node"` globally and
  > `include: ["tests/**/*.test.ts"]` — so **the file must be `.ts`, not
  > `.tsx`** (a `.test.tsx` is silently not collected, which is the worst
  > possible failure for a new test), it uses `createElement` rather than JSX
  > exactly as `tests/board-canvas-render.test.ts` does, and it opts into a DOM
  > with a per-file pragma rather than by moving the suite's default. Run
  > `pnpm add -D jsdom` first; nothing else is added — no `@testing-library`,
  > because `react-dom/client` plus React's own `act` is the whole of what this
  > needs.

  ```ts
  // @vitest-environment jsdom
  import { act, createElement } from "react";
  import { createRoot, type Root } from "react-dom/client";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

  /**
   * THE DRAWER OPENS, AND SHUTS ITSELF WHEN THE ROUTE MOVES.
   *
   * The two facts in this file are the only ones in the phone layout that are
   * not classes. Everything else — that the rail is absent below `md`, that
   * the trigger is 32px on `--avatar`, that rows are 44px — is pinned as
   * source in `tests/mobile-shell.test.ts`, and it has to be: jsdom loads no
   * stylesheet, so a 390px viewport here proves nothing about a `md:` prefix.
   * The width is set anyway, and stated as documentation rather than as a
   * mechanism, so the next person does not mistake this file for a layout
   * test.
   */
  let pathname = "/dashboard";
  let search = "";

  vi.mock("next/navigation", () => ({
    usePathname: () => pathname,
    useSearchParams: () => new URLSearchParams(search),
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
  }));
  // `next/link` wants the App Router context on the client; the rail is full of
  // anchors and none of them is what this file is about.
  vi.mock("next/link", async () => {
    const { createElement: h } = await import("react");
    return {
      default: ({ children, href, ...rest }: { children?: unknown; href: string }) =>
        h("a", { href, ...rest }, children as never),
    };
  });

  const { MobileDrawer } = await import("@/components/mobile-drawer");

  // React 19 refuses to run `act` without this.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let root: Root;
  let host: HTMLDivElement;

  const drawer = () => document.querySelector('[data-slot="sheet-content"]');
  const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="Open the navigation"]');

  const draw = () =>
    act(() => {
      root.render(createElement(MobileDrawer, { workspace: "Acme", views: [], hide: [] }));
    });

  beforeEach(() => {
    // A phone's viewport, stated. See the note above: jsdom applies no CSS, so
    // this documents the case rather than producing it.
    window.innerWidth = 390;
    pathname = "/dashboard";
    search = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    draw();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  describe("the phone's navigation drawer", () => {
    it("is shut until the menu button is pressed", () => {
      expect(trigger(), "the bar's menu button").not.toBeNull();
      expect(drawer()).toBeNull();
    });

    it("opens onto the rail's own content", () => {
      act(() => trigger()!.click());
      const panel = drawer();
      expect(panel).not.toBeNull();
      // The workspace switcher, the search field and the nav are the RAIL's,
      // rendered here rather than rebuilt — so finding them proves the reuse.
      expect(panel!.textContent).toContain("Acme");
      expect(panel!.textContent).toContain("Main Menu");
      expect(panel!.textContent).toContain("Dashboard");
      // …including the two controls the top bar sheds on a phone.
      expect(panel!.textContent).toContain("New flow");
      expect(panel!.textContent).toContain("Invite members");
    });

    it("closes when the route changes under it", () => {
      act(() => trigger()!.click());
      expect(drawer()).not.toBeNull();
      pathname = "/dashboard/flows";
      draw();
      expect(drawer(), "a drawer left open over the page it just navigated to").toBeNull();
    });

    it("closes when only the view changes, which is a search param", () => {
      // The dashboard's views are `?view=` on one pathname. A drawer keyed on
      // the pathname alone stays open over the board it just switched.
      act(() => trigger()!.click());
      search = "view=v2";
      draw();
      expect(drawer()).toBeNull();
    });
  });
  ```

  **1c. `tests/page-width.test.ts`** — two existing pins describe a rail that is
  now desktop-only. Both are RE-AIMED at both layouts rather than deleted, which
  is this branch's rule for every test that pinned the previous design.

  Replace:

  ```ts
    // The <aside>'s OWN class carries no group — a negative match against the
    // element would always fail, because the panel that DOES carry it is a
    // descendant. This is the aside's class string, asserted whole.
    expect(code).toMatch(/"relative z-20 h-full shrink-0"/);
  ```

  with:

  ```ts
    // The <aside>'s OWN class carries no group — a negative match against the
    // element would always fail, because the panel that DOES carry it is a
    // descendant. This is the aside's class string, asserted whole — and it
    // now also carries the phone layout, because the FOOTPRINT is what has to
    // go below `md`: hiding the panel alone would leave a 56px column of
    // nothing down the left of every phone screen.
    expect(code).toMatch(/"relative z-20 hidden h-full shrink-0 md:block"/);
  ```

  And in the skeleton's hairline assertion, replace:

  ```ts
    expect(code(skeleton)).toMatch(/w-\[56px\][^"]*border-r border-border/);
  ```

  with:

  ```ts
    // `hidden` precedes the width now — the ghost mirrors the rail's absence
    // below `md` as well as its 56px above it, or the skeleton reserves a
    // column the real chrome will not draw.
    expect(code(skeleton)).toMatch(/hidden w-\[56px\][^"]*border-r border-border/);
  ```

- [ ] **Step 2 — run them, confirm they fail**

  ```bash
  pnpm add -D jsdom
  pnpm vitest run tests/mobile-shell.test.ts tests/mobile-drawer.test.ts tests/page-width.test.ts
  ```

  Expected: `mobile-shell.test.ts` and `mobile-drawer.test.ts` fail to even
  resolve `@/components/mobile-drawer` (the file does not exist); the two
  re-aimed assertions in `page-width.test.ts` fail because the `<aside>` is
  still `"relative z-20 h-full shrink-0"` and the skeleton's ghost still opens
  with `w-[56px]`. Everything else in `page-width.test.ts` — the gutter pair,
  the caps, the rail/bar height mirror, Tasks 7–9's own blocks — stays green.

- [ ] **Step 3 — implement: `src/components/sidebar.tsx`**

  **3a. One import.** The drawer's foot draws "Invite members", and the row's
  markup belongs here with `SLOT`, `ICON_COL` and `RailLabel` rather than in the
  drawer, which would have to import three module-private constants to spell it.
  After Task 8 the line reads:

  ```tsx
  import { Bell, ChevronDown, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plug, Plus, Radio, Search, Settings, Workflow } from "lucide-react";
  ```

  Replace with:

  ```tsx
  import { Bell, ChevronDown, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plug, Plus, Radio, Search, Settings, UserPlus, Workflow } from "lucide-react";
  ```

  **3b. 44px rows.** Three constants and one button carry the rail's row
  heights. `min-h-11` rather than `h-11`, so the 36px `h-9` stays the desktop
  answer and `md:min-h-0` hands it back — a second height would be a second
  decision to keep in step. Replace:

  ```tsx
  const SLOT = "group flex h-9 w-full shrink-0 items-center justify-start gap-2.5 rounded-control";
  ```

  with:

  ```tsx
  /**
   * 44px BELOW `md`, AND IT IS THE SAME ROW, NOT A SECOND ONE.
   *
   * `h-9` is 36 — over WCAG 2.2's 24px minimum and right for a pointer, and
   * four pixels under what a finger asks for. `min-h-11` raises the computed
   * height to 44 on a phone without touching `h-9`, and `md:min-h-0` stands
   * down again above the breakpoint, so the rail keeps its density and the
   * drawer keeps its targets from one string.
   */
  const SLOT = "group flex h-9 min-h-11 w-full shrink-0 items-center justify-start gap-2.5 rounded-control md:min-h-0";
  ```

  In `ViewList`, the nested view row is a nav row too. Replace:

  ```tsx
                "flex h-8 items-center rounded-control pl-4 pr-2 text-sm transition-colors duration-(--duration-fast)",
  ```

  with:

  ```tsx
                "flex h-8 min-h-11 items-center rounded-control pl-4 pr-2 text-sm transition-colors duration-(--duration-fast) md:min-h-0",
  ```

  and, on the "Show all" button in the same block, replace:

  ```tsx
            className="h-8 w-full justify-start rounded-control pl-8 pr-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent"
  ```

  with:

  ```tsx
            className="h-8 min-h-11 w-full justify-start rounded-control pl-8 pr-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent md:min-h-0"
  ```

  **3c. Split the component in two.** Everything from the state the rows read
  down to the foot becomes `RailContent`; `Sidebar` keeps the pin, the
  footprint, the panel and the toggle. Nothing inside the moved region is
  rewritten — the head block, the search field, "Main Menu", the nav, `ViewList`
  and the foot all move verbatim, with `min-h-11` from 3b already on them.

  Replace the opening of the export, which after Tasks 7 and 8 reads:

  ```tsx
  export function Sidebar({
    hide,
    views = [],
    /**
     * PINNED OPEN, READ ON THE SERVER FROM A COOKIE.
     * …
     */
    pinned: initialPinned = false,
    workspace,
    account,
  }: {
    hide?: string[];
    views?: BoardView[];
    pinned?: boolean;
    /**
     * The active workspace's name and the signed-in account — …
     */
    workspace?: string;
    account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  }) {
    const pathname = usePathname();
  ```

  with — keeping the `PINNED OPEN` docblock, which moves down to `Sidebar`
  below:

  ```tsx
  /**
   * THE RAIL'S CONTENT — one tree, rendered in two places.
   *
   * The phone has no hover, so it cannot have a hover rail; below `md` the
   * column is not rendered at all and a drawer carries the same rows (see
   * `mobile-drawer.tsx`). The thing that must not happen is the obvious one:
   * a second nav list, a second search row, a second answer to "which view am
   * I on", drifting apart on the first change to either. So this is the whole
   * of what the rail SAYS, and the rail and the drawer are two frames around
   * it — one 56px and hover-driven, one 280px and pressed open.
   *
   * IT NEEDS NO "EXPANDED" PROP, AND THAT IS THE POINT OF THE SPLIT. Every
   * label in here rides `REVEAL`, which fades on `group-hover/rail`,
   * `group-focus-within/rail` and `group-data-[pinned=true]/rail`. The drawer
   * wraps this in a `group/rail` carrying `data-pinned="true"`, so the third
   * variant fires and the labels, the keycap, the view list and the filled
   * "New flow" row all open exactly as they do in a pinned rail. Not one class
   * below knows a drawer exists.
   */
  export function RailContent({
    hide,
    views = [],
    workspace,
    account,
    invite = false,
  }: {
    hide?: string[];
    views?: BoardView[];
    workspace?: string;
    account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
    /**
     * Draw "Invite members" in the foot. The DRAWER sets it and the rail does
     * not, because this is where that control lands when the top bar sheds it
     * below `md` — above `md` it is still in the bar, and a second copy here
     * would be two routes to one settings page a centimetre apart.
     */
    invite?: boolean;
  }) {
    const pathname = usePathname();
  ```

  Everything from that `const pathname` line down to the END of the foot block
  stays exactly where it is, with three exceptions:

  1. Delete the `pinned`/`togglePin` block, which belongs to the frame rather
     than to the content — the four lines beginning `const [pinned, setPinned] =
     useState(initialPinned);` through the closing `};` of `togglePin`, plus the
     `/** Local state as well as the cookie, so the press is instant. … */`
     comment above them. (`useState` is still imported and still used by
     `allViews` here and by `pinned` in `Sidebar` below.)
  2. Replace the whole return, from the `// THE FOOTPRINT, AND ONLY THE
     FOOTPRINT.` comment and its `<aside …>` down to the `<div …>` that opens
     the panel, with a bare fragment:

     ```tsx
     return (
       <>
     ```

  3. At the end of the foot, replace the panel's and the aside's closing tags
     and the toggle button between them — everything from the foot block's own
     closing `</div>` down to `</aside>\n  );\n}` — with:

     ```tsx
           {/* INVITE MEMBERS, WHICH IS A GUEST OF THIS FOOT RATHER THAN A
               RESIDENT. It is a top-bar control; below `md` the bar has room
               for a menu button, the mark and your avatar and nothing else, so
               it comes here with "New flow" rather than being dropped. The rail
               never sets `invite`, because up there the bar still carries it. */}
           {invite && (
             <Link
               href="/dashboard/settings"
               className={cn(SLOT, "text-muted-foreground hover:bg-accent hover:text-foreground")}
             >
               <span className={ICON_COL}>
                 <UserPlus className="size-[18px]" />
               </span>
               <RailLabel className="text-muted-foreground group-hover:text-foreground">Invite members</RailLabel>
             </Link>
           )}
         </div>
       </>
     );
   }
     ```

     (The `</div>` above `</>` is the foot block's own closing tag, kept.)

  Then add `Sidebar` back, below `RailContent`, as the frame it now is:

  ```tsx
  /**
   * THE HOVER RAIL — the frame around `RailContent`, and nothing else.
   *
   * What is left here is the geometry the CONTENT does not care about: the
   * footprint the page is laid out against, the panel that overlays rather
   * than pushes, the pin cookie, and the toggle straddling the hairline. The
   * rows, the search field and the foot are all `RailContent`, which the
   * phone's drawer renders too.
   *
   * IT IS NOT RENDERED BELOW `md`. A hover rail on a touch screen is a column
   * of unlabelled glyphs that can never open — the panel's whole vocabulary is
   * `hover` and `focus-within`, and a finger produces neither. `hidden
   * md:block` on the FOOTPRINT rather than on the panel: hiding the panel
   * alone would leave 56px of empty column down the left of every phone
   * screen, laid out and painted, holding nothing.
   */
  export function Sidebar({
    hide,
    views = [],
    /**
     * PINNED OPEN, READ ON THE SERVER FROM A COOKIE.
     *
     * It arrives as a prop rather than being read here because the alternative
     * is a layout jump on every cold load: `localStorage` is not knowable
     * during render, so a pinned rail would paint at 56px and snap to 260px a
     * frame later — dragging the top bar and the whole page with it. That is
     * the exact failure `tests/page-width.test.ts` exists for, and a preference
     * is not worth reintroducing it. `AppShell` reads the cookie; this only
     * toggles it.
     */
    pinned: initialPinned = false,
    workspace,
    account,
  }: {
    hide?: string[];
    views?: BoardView[];
    pinned?: boolean;
    workspace?: string;
    account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  }) {
    /**
     * Local state as well as the cookie, so the press is instant. The cookie is
     * for the NEXT page load; this is for this one. Writing only the cookie
     * would mean the rail did nothing until you navigated.
     */
    const [pinned, setPinned] = useState(initialPinned);
    const togglePin = () => {
      const next = !pinned;
      setPinned(next);
      // A year, path-wide, Lax: it is a display preference, so it wants to
      // survive a restart and does not want to ride on cross-site requests.
      document.cookie = `rail=${next ? "pinned" : "hover"}; path=/; max-age=31536000; samesite=lax`;
    };

    return (
      <aside className={cn("relative z-20 hidden h-full shrink-0 md:block", pinned ? "w-65" : "w-[56px]")}>
        {/* THE PANEL — the whole rail, floated out of the layout. The hairline
            travels with it: the rail and the panel beside it are two surfaces
            now, and `border-r` is where one stops. `group/rail` is HERE and not
            on the <aside>, which is what stops the toggle's own focus holding
            the column open — see the note on the toggle below. */}
        <div
          className={cn(
            "peer group/rail absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-border bg-chrome transition-[width] duration-(--duration-base) ease-(--ease-standard)",
            pinned ? "w-65" : "w-[56px] hover:w-65 focus-within:w-65",
          )}
          /* Read by `REVEAL` through `group-data-[pinned=true]/rail:`, so every
             label, the keycap, the view list and the "New flow" fill open
             together without any of them taking a prop. The drawer sets the
             same attribute by hand for exactly that reason. */
          data-pinned={pinned}
        >
          <RailContent hide={hide} views={views} workspace={workspace} account={account} />
        </div>
        {/* THE TOGGLE FOLLOWS THE PANEL'S EDGE, NOT THE FOOTPRINT'S, and it is
            a sibling of the panel rather than a child: pressing it FOCUSES it,
            and while it sat inside `group/rail` that focus held the panel open
            after a collapse. `top-12` centres it on y=60, the corner where the
            bar's bottom rule meets the rail's right one. */}
        <Button
          variant="ghost"
          size="iconXs"
          onClick={togglePin}
          aria-pressed={pinned}
          aria-label={pinned ? "Collapse the navigation" : "Keep the navigation open"}
          className={cn(
            "absolute top-12 z-10 -translate-x-1/2 rounded-full border border-border bg-card text-muted-foreground shadow-card transition-[left] duration-(--duration-base) ease-(--ease-standard) hover:bg-accent hover:text-foreground",
            pinned ? "left-65" : "left-14 peer-hover:left-65 peer-focus-within:left-65",
          )}
        >
          {pinned ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
      </aside>
    );
  }
  ```

  > **One value changed inside a class string I was rewriting anyway, and it is
  > flagged rather than smuggled.** The panel's fill above is `bg-chrome`, where
  > today it is `bg-background`. Task 9 paints the skeleton's rail ghost
  > `bg-chrome` and no task in this plan moves the real one, so as written the
  > branch would ship a `#0F1011` rail behind a `#111111` ghost — the exact
  > class-for-class drift `page-width.test.ts` exists to catch, and the spec is
  > unambiguous ("Rail: … at rest 56px of icons on `--chrome`"). **If Task 8 or
  > 9 has already made this change, leave it alone and keep the rest of this
  > block.**

- [ ] **Step 4 — implement: `src/components/mobile-drawer.tsx` (new)**

  ```tsx
  "use client";

  import { Menu } from "lucide-react";
  import { usePathname, useSearchParams } from "next/navigation";
  import { useEffect, useState, type ReactNode } from "react";
  import { Button } from "@/components/ui/button";
  import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
  import { RailContent } from "@/components/sidebar";
  import type { BoardView } from "@/lib/board/types";

  /**
   * THE PHONE'S NAVIGATION — the rail's own tree, in a drawer.
   *
   * A HOVER RAIL CANNOT SURVIVE A TOUCH SCREEN. Its 56px state is unlabelled
   * glyphs and everything that names them is `hover:` or `focus-within:`, so on
   * a phone it is a column you cannot read and cannot open. Below `md` the rail
   * is not rendered (see `Sidebar`) and this stands in: the bar grows a menu
   * button, and pressing it slides the same rows in from the left.
   *
   * THE SAME COMPONENT TREE, NOT A COPY. `RailContent` is one export rendered
   * in two frames. A hand-built drawer is the obvious alternative and it is
   * wrong in a way that only shows up months later — two nav lists, two search
   * rows, two active-row rules, and a change to one of them landing on half the
   * product.
   *
   * `data-pinned="true"` ON A `group/rail` IS WHAT OPENS IT. Every label in
   * that tree rides `REVEAL`, which fades on hover, focus-within, or a pinned
   * rail. There is no hover here, so the wrapper claims the third: a drawer IS
   * a rail held open, which is what the attribute already means.
   *
   * IT CLOSES ON NAVIGATION, INCLUDING A CHANGE OF VIEW. `usePathname` alone
   * would leave it standing over the board it just switched, because the
   * dashboard's views are `?view=` on one path. `sidebar.tsx` already calls
   * `useSearchParams()` in this same tree, so reading it here costs nothing
   * that was not already being paid.
   */
  export function MobileDrawer({
    hide,
    views = [],
    workspace,
    account,
  }: {
    hide?: string[];
    views?: BoardView[];
    workspace?: string;
    account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const search = useSearchParams().toString();
    useEffect(() => {
      setOpen(false);
    }, [pathname, search]);

    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          {/* 32px on the avatar circle, which is what the bell and the account
              chip beside it wear — three round objects at one size, so the bar
              reads as one row rather than as a button and two blobs. It is the
              only control on this bar that is not there above `md`. */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open the navigation"
            className="shrink-0 rounded-full bg-avatar text-foreground hover:bg-accent active:bg-accent md:hidden"
          >
            <Menu />
          </Button>
        </SheetTrigger>
        {/* `md:hidden` HERE TOO, and it is not belt-and-braces: a drawer left
            open while the window widens past 768px would otherwise sit over the
            page beside the rail it stands in for.

            280px, `--chrome`, `--border` — the export's own drawer. `p-0` and
            `gap-0` because the sheet's padded, gapped default is for a form and
            this is a navigation column that brings its own gutter. The close X
            is off: at `top-4 right-4` it lands exactly on the workspace
            switcher's chevron, and the drawer already closes on the overlay, on
            Escape, and on any navigation. */}
        <SheetContent
          side="left"
          showCloseButton={false}
          aria-describedby={undefined}
          className="w-[280px] gap-0 border-border bg-chrome p-0 md:hidden"
        >
          {/* Radix names the dialog from this; the drawer's own head is the
              workspace switcher, which is a name for the WORKSPACE rather than
              for the panel. */}
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="group/rail flex h-full min-h-0 flex-col overflow-y-auto" data-pinned="true">
            <RailContent hide={hide} views={views} workspace={workspace} account={account} invite />
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  ```

- [ ] **Step 5 — implement: `src/components/top-bar.tsx`**

  Three edits, all inside the `<header>` Task 7 produced.

  **5a. The slot.** In the signature Task 7 leaves as:

  ```tsx
  export function TopBar({
    account,
    firstName,
    unread = 1,
  }: {
    account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  ```

  add `menu` to both halves:

  ```tsx
  export function TopBar({
    account,
    firstName,
    menu,
    unread = 1,
  }: {
    account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
    /**
     * The phone's way into the navigation — `MobileDrawer`, built by
     * `AppFrame` and handed down as a node.
     *
     * A NODE RATHER THAN FOUR PROPS. The drawer needs the workspace, the
     * account, the view list and the hidden-items list; this bar needs none of
     * them and has just finished giving two of them back (see the file note).
     * Passing the built control keeps the bar's signature about the BAR, which
     * is the same reason `account.panel` arrives as a node rather than as a
     * workspace list.
     */
    menu?: ReactNode;
  ```

  **5b. The mark, with the menu button before it.** Replace:

  ```tsx
        {/* ── THE MARK ─────────────────────────────────────────────────────── */}
        <Link href="/dashboard" className="wordmark shrink-0 text-foreground">
          Namzilabs
        </Link>
  ```

  with:

  ```tsx
        {/* ── THE WAY IN, THEN THE MARK ────────────────────────────────────
            The menu button exists only below `md`, where there is no rail to
            the left of this bar — it is the phone's whole navigation, so it
            takes the reading edge and the mark steps right by 40px. Above
            `md` it is not rendered and this group is the wordmark alone,
            exactly where it was. */}
        <div className="flex shrink-0 items-center gap-2">
          {menu}
          <Link href="/dashboard" className="wordmark shrink-0 text-foreground">
            Namzilabs
          </Link>
        </div>
  ```

  **5c. What steps aside, and where it goes.** The greeting first — replace:

  ```tsx
          <span className="truncate text-sm font-medium text-foreground peer-[:not(:empty)]:hidden">{greeting}</span>
  ```

  with:

  ```tsx
          {/* `max-sm:hidden`, NOT `hidden sm:block`, AND THE DIFFERENCE IS A
              BUG AVOIDED. This span already carries `peer-[:not(:empty)]:hidden`
              — the rule that gets out of the builder's way when its toolbar
              portals into the slot beside it. A base `hidden` plus `sm:block`
              would put a responsive variant into a fight with that peer rule
              that is settled by Tailwind's own emission order rather than by
              anything written here, and the losing case is a greeting sitting
              on top of the builder's toolbar. One `max-` variant hides it below
              `sm` and leaves the peer rule the only thing deciding anything at
              `sm` and above. */}
          <span className="truncate text-sm font-medium text-foreground max-sm:hidden peer-[:not(:empty)]:hidden">
            {greeting}
          </span>
  ```

  Then the two acts. Replace:

  ```tsx
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
  ```

  with:

  ```tsx
          {/* BOTH ACTS LEAVE THE BAR BELOW `md`, AND NEITHER IS LOST. They are
              in the drawer's foot — "New flow" is the rail's own filled row and
              has always been there, and "Invite members" is a guest of that
              foot for exactly as long as this bar has no room for it. What is
              left up here on a phone is the menu, the mark and you, which is
              the export's own phone bar.
              The label's `hidden sm:inline` goes with the move: it was the
              narrow-viewport accommodation this replaces, and a control that is
              not rendered below `md` cannot need one. */}
          <Link
            href="/dashboard/settings"
            className={cn(buttonVariants({ variant: "secondary" }), "hidden md:inline-flex [&_svg]:size-4")}
            title="Invite someone to this workspace"
          >
            <UserPlus />
            <span>Invite members</span>
          </Link>
          <Link
            href="/dashboard/flows"
            className={cn(buttonVariants({ variant: "secondary" }), "hidden md:inline-flex [&_svg]:size-4")}
          >
            <Plus />
            <span>New flow</span>
          </Link>
  ```

  The bell and the avatar stay at every width. The spec's phone bar names the
  menu, the mark and the avatar; it says only that *Invite members and New flow*
  leave, and those two are the two with somewhere to land. A bell dropped here
  would be reachable nowhere on a phone, which is a product decision this
  re-theme was not asked to make. Their `gap-4` is 16px, over the spec's 8px
  minimum between controls.

- [ ] **Step 6 — implement: `src/components/app-frame.tsx` and `shell-skeleton.tsx`**

  **6a.** In `app-frame.tsx`, add the import beside the other two:

  ```tsx
  import { MobileDrawer } from "./mobile-drawer";
  ```

  Replace the panel's class line Task 7 produced:

  ```tsx
    const className = cn("relative min-w-0 flex-1 rounded-tr-frame bg-panel", surface);
  ```

  with:

  ```tsx
    /**
     * THE CORNER IS A DESKTOP FACT. It reveals the page behind the panel where
     * the bar's rule ends and the rail's begins — and below `md` there is no
     * rail, so the panel runs the full width of the viewport and the only thing
     * an 8px notch could reveal is the 8px of `--background` outside it. A
     * rounded corner against the edge of a phone screen reads as a rendering
     * fault, which is the same argument that took the notch off when the
     * surfaces were one colour, in a different axis.
     *
     * `md:rounded-tr-frame bg-panel` in that order on purpose: the pair is
     * matched as a literal by `tests/page-width.test.ts`, on both sides of the
     * frame/skeleton mirror.
     */
    const className = cn("relative min-w-0 flex-1 md:rounded-tr-frame bg-panel", surface);
  ```

  And hand the bar its menu — replace:

  ```tsx
        <TopBar account={account} firstName={firstName} />
  ```

  with:

  ```tsx
        {/* THE DRAWER IS BUILT HERE BECAUSE THIS IS WHERE THE NAVIGATION DATA
            IS. `AppFrame` already holds the workspace, the account, the view
            list and `hide` for the rail beside it; the bar holds none of them
            and should not start. Below `md` this is the only way into any of
            it — the rail is not rendered at all. */}
        <TopBar
          account={account}
          firstName={firstName}
          menu={<MobileDrawer hide={hide} views={views} workspace={workspace} account={account} />}
        />
  ```

  **6b.** In `shell-skeleton.tsx`, mirror both. Replace the rail ghost Task 9
  produced:

  ```tsx
          <div className="w-[56px] shrink-0 border-r border-border bg-chrome" />
  ```

  with:

  ```tsx
          {/* NOTHING IS RESERVED FOR THE RAIL BELOW `md`, because nothing is
              drawn there — see `Sidebar`. A ghost the real chrome will not
              replace is 57px of content jumping left when the route lands,
              which is the one failure this file exists to prevent. */}
          <div className="hidden w-[56px] shrink-0 border-r border-border bg-chrome md:block" />
  ```

  and the panel ghost:

  ```tsx
            <div className="flex-1 overflow-y-auto rounded-tr-frame bg-panel">
  ```

  with:

  ```tsx
            <div className="flex-1 overflow-y-auto md:rounded-tr-frame bg-panel">
  ```

  The bar's ghost is unchanged and stays empty: the real bar's phone contents —
  a menu button, the mark, an avatar — are all things that appear instantly and
  never move, which is the same reason the ghost draws none of the desktop ones.

- [ ] **Step 7 — run it green**

  ```bash
  pnpm vitest run tests/mobile-shell.test.ts tests/mobile-drawer.test.ts tests/page-width.test.ts tests/vendored-primitives.test.ts tests/console-theme.test.ts
  ```

  All five pass. `vendored-primitives.test.ts` because `WorkspaceChip` lives in
  `sidebar.tsx` and this task moves code around it (the chip itself is not
  touched, and it is not inside `RailContent`); `console-theme.test.ts` because
  it reads the same file's shape.

  If the jsdom file fails for a reason inside Radix rather than inside this
  code — a portal that will not mount, a missing DOM API — **report it and stop
  rather than deleting the file**: the open/close contract is also pinned as
  source in `mobile-shell.test.ts`, so the branch is not blind, but a first
  jsdom test that was quietly removed is a capability the next task will
  re-litigate from scratch.

- [ ] **Step 8 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/mobile-shell.test.ts tests/mobile-drawer.test.ts tests/page-width.test.ts tests/chrome-band.test.ts && pnpm check:ui
  ```

  `typecheck` is the real gate on the split: `noUnusedLocals` and
  `noUnusedParameters` are both on, so a prop left behind on `Sidebar` or a
  constant orphaned by the move fails the build rather than lingering.
  `chrome-band.test.ts` is a regression run — it is entirely about the flow
  builder's `FlowToolbar.tsx`/`ConfigPanel.tsx`, which this task does not open,
  and it is here to prove that. `check:ui` passes: no raw `<button>` (the
  trigger is `Button`), no hex, no `dark:` variant, `bg-avatar`/`bg-chrome` are
  the sanctioned spellings Task 7 already cleared, and `rounded-full` is in
  `RADIUS_OK` for exactly this kind of circle.

- [ ] **Step 9 — commit**

  ```bash
  git add package.json pnpm-lock.yaml src/components/sidebar.tsx src/components/mobile-drawer.tsx src/components/top-bar.tsx src/components/app-frame.tsx src/components/shell-skeleton.tsx tests/mobile-shell.test.ts tests/mobile-drawer.test.ts tests/page-width.test.ts
  git commit -m "$(cat <<'EOF'
  Give the phone a drawer, and stop drawing a hover rail it cannot open

  Below md the rail is not rendered: its panel is opened by hover and by
  focus-within, neither of which a finger produces, so on a phone it was a
  column of unlabelled glyphs with no way in. The rail's content is now one
  exported component that both the 56px column and a 280px left sheet render
  — the same tree, not a copy, opened in the drawer by the data-pinned
  attribute REVEAL already reads. The bar grows a 32px menu button on the
  avatar circle before the mark, drops the greeting below sm and both acts
  below md (they land in the drawer's foot beside New flow), rows are 44px
  under the breakpoint, and the panel's top-right corner and the skeleton's
  rail ghost both stand down where there is no rail to sit beside.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 20: Mobile content — one column, a stacking header, and no sideways scroll

**Runs after Tasks 14 and 19.** Task 14 is what puts a tab strip in
`PageHeader`'s `tabs` slot at all, so the stacking rules below have nothing to
stack until it lands; Task 19 establishes `md` as the shell's own breakpoint,
and a header that stacked at `sm` while the rail disappeared at `md` would give
the 640–768px band a three-zone row with no rail beside it.

**Files**
- Modify: `src/components/ui/page.tsx` (`PageHeader`'s three-zone branch; `BOARD_GRID`'s first rung)
- Modify: `src/app/dashboard/board-controls.tsx` (`ViewStrip` stops wrapping below `md`, so the header's scroller has something to scroll)
- Test: `tests/page-header.test.ts` and `tests/page-width.test.ts` and `tests/board-canvas-render.test.ts` (existing pins re-aimed at both layouts), `tests/mobile-content.test.ts` (new)

> **`ui/page.tsx` was being edited by another worker while this was written.**
> Every quotation of it below is of the file as it stood after commit `d97cff4`
> ("Give PageHeader a third zone, and centre the title in it") — Tasks 1–6 in,
> Task 7 onward not. The two blocks quoted are `BOARD_GRID` and the `tabs ? (`
> branch of `PageHeader`, neither of which any later task in this plan touches.
> If either has moved under you, re-read before editing and say so.

**Interfaces**
- Consumes: `PageHeaderProps.tabs` (Task 5), the dashboard passing it (Task 14), `md` as the shell's breakpoint (Task 19), `.quiet-scroll` (globals.css).
- Produces: `BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3"` — the same three-rung decision, with its first rung moved from 640px to 768px; a `PageHeader` three-zone row that stacks below `md` with the title left-aligned and the tab strip in its own horizontal scroller.
- Removes: nothing.

**What was checked and needs no change, which is a finding rather than an
omission.** The spec asks for tiles at full width, charts fitting their
container and tables scrolling inside their own. Three of the four were already
true and are pinned rather than rewritten:

- **The custom canvas is already one column below `md`.** `src/lib/board/grid.ts`
  computes all three renderings per cell (`canvasCells` → `--c12`/`--c6`/`--c1`)
  and `globals.css` picks between them at `min-width: 768px` and `1024px`, with
  the ONE-column geometry as the base case. Nothing in this task changes that;
  Step 1 pins it, because a media query someone "tidies" from 768 to 640 would
  silently put two columns on a phone and no test would say so.
- **Charts fit by construction.** `board-charts/cartesian.tsx` draws into a
  stretched `viewBox` with the labels in HTML outside it — its own note explains
  why — and every width in that directory is a percentage or a slot computed
  from the point count. There is no fixed pixel width in any mark.
- **Tables and lanes already scroll inside their own containers.**
  `ui/table.tsx` is `overflow-x-auto`; the groups board's two lane scrollers
  (`board-layout.tsx`) are `overflow-x-auto` around `COLUMN_W` = `w-[310px]`
  columns, which is under 390 and inside a scroller besides; the calendar's
  sheet is a `min-w-[640px]` grid inside an `overflow-x-auto` card, which is the
  deliberate arrangement its own comment describes.
- **Not fixed here, recorded so the next pass does not re-find it:**
  `SCROLLER_BLEED` (`board-shape.ts`) is `-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8
  lg:px-8` against a page gutter that stopped stepping and is a flat `p-6`. At
  `lg` the bleed is 32px against 24px of padding, so between 1024px and ~1152px
  — where the container has no spare margin — the lane scrollers overhang their
  container by 8px a side. That is a DESKTOP overflow, it predates this spec, and
  fixing it means re-deciding the bleed against the flat gutter, which is a
  different change from a phone layout.
- **The panel has no side inset to drop.** The spec's "below `md` the panel
  drops its rounded corner and side inset" has one half with code behind it —
  the corner, which Task 19 moves to `md:rounded-tr-frame`. `AppFrame` sets no
  side inset at all beyond `env(safe-area-inset-*)`, and the 24px that looks
  like one is `PageContainer`'s flat `p-6`, which `page-width.test.ts` pins as a
  PAIR with the skeleton and whose own note argues at length for not stepping
  with the viewport (the top bar's inset cannot step, so every rung is a width
  at which the page's content and the bar's stand on two different lines). 24px
  on a 390px screen leaves a 342px measure and no horizontal scroll, so the
  gutter is left alone deliberately rather than by omission.

- [ ] **Step 1 — write the failing tests**

  **1a. `tests/mobile-content.test.ts`** (new):

  ```ts
  import { readdirSync, readFileSync, statSync } from "node:fs";
  import { join, relative } from "node:path";
  import { describe, expect, it } from "vitest";

  /**
   * THE PHONE'S CONTENT COLUMN: one board column, a header that stacks, and
   * nothing on any authenticated route wider than the screen.
   *
   * Source pins, like `page-width.test.ts` beside it, and for the same reason:
   * what is being asserted is a BREAKPOINT, which in this codebase is a class
   * and a media query rather than a measurement any renderer here can take.
   */
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  const page = read("src/components/ui/page.tsx");
  const css = read("src/app/globals.css");

  describe("the board is one column below md", () => {
    it("moves the grid's first rung from sm to md", () => {
      /**
       * `sm:grid-cols-2` put two tiles side by side from 640px — inside the
       * band where the rail has already gone and the header has already
       * stacked, on a screen that is a large phone. The rungs above it are
       * unchanged: three columns is still what 1152px is for.
       */
      expect(page).toMatch(/BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3";/);
      expect(page, "the sm rung must not come back").not.toMatch(/BOARD_GRID = "[^"]*sm:grid-cols-2/);
    });

    it("keeps the canvas's phone rendering at one column, and at 768", () => {
      /**
       * The custom board never had this bug — `grid.ts` computes a 1-column
       * reflow and the stylesheet picks it as the BASE case. It is pinned
       * because it is invisible: the geometry is in custom properties, so a
       * media query edited from 768 to 640 would put six columns on a large
       * phone and every render test would still pass.
       */
      expect(css).toMatch(/\.board-canvas\s*\{[^}]*grid-template-columns:\s*repeat\(1,/);
      expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.board-canvas\s*\{[^}]*repeat\(6,/);
    });
  });

  describe("the page header stacks below md", () => {
    const header = page.slice(page.indexOf("export function PageHeader"));

    it("is a column below the breakpoint and a three-zone grid above it", () => {
      expect(header).toContain("flex flex-col items-stretch gap-3 md:grid md:grid-cols-[1fr_auto_1fr]");
      expect(header, "the sm rung belonged to a shell that broke at sm").not.toContain("sm:grid-cols-[1fr_auto_1fr]");
    });

    it("puts the tab strip in its own scroller, not on a second line", () => {
      expect(header).toMatch(/quiet-scroll[^"]*overflow-x-auto[^"]*md:overflow-visible/);
      // …and the strip inside it has to stop wrapping, or it wraps INSIDE the
      // scroller and the scroller never has anything to scroll.
      expect(read("src/app/dashboard/board-controls.tsx")).toMatch(/flex flex-nowrap items-center gap-6 px-1 py-1 md:flex-wrap/);
    });

    it("left-aligns the title on its own line, and centres it only at md", () => {
      expect(header).toContain("items-start gap-2 text-left md:items-center md:text-center");
    });

    it("wraps the actions at 8px", () => {
      expect(header).toContain("flex-wrap items-center justify-start gap-2 md:justify-end");
    });
  });

  /**
   * NOTHING ON AN AUTHENTICATED ROUTE IS WIDER THAN THE SCREEN.
   *
   * A 390px viewport is the narrowest phone this product has to open on, and
   * one fixed width over it anywhere in a page's own tree pushes the WHOLE
   * document sideways — which is worse than a clipped element, because it
   * moves the chrome too and there is no scroll position that reads correctly.
   *
   * `max-w-[…]` is not a fixed width and is excluded by the lookbehind; a
   * scroller's own inner track is not one either, which is what the allow-list
   * is for. The scan is px-only: this codebase spells every fixed chrome
   * measurement in pixels (56, 60, 280, 310, 640), and a rem width would be a
   * new habit rather than a hole in this rule.
   *
   * `src/components/flow/*` is out of scope by the spec's own non-goals — the
   * builder's canvas is frozen for this re-theme, and it is a panning surface
   * with its own viewport besides.
   */
  describe("no authenticated page is wider than a phone", () => {
    const ALLOWED: Record<string, string[]> = {
      // The month sheet: seven columns of a readable width need ~640px, so it
      // scrolls INSIDE its own card (`overflow-x-auto p-3 sm:p-4`) rather than
      // squeezing a number into 40px. The container, not the page, scrolls.
      "src/components/calendar/calendar-board.tsx": ["min-w-[640px]"],
      // Two kit specimens on /design, both `w-[452px] max-w-full` — a panel
      // drawn at its real size on a wide screen and told to shrink below it.
      "src/app/design/page.tsx": ["w-[452px]"],
    };

    const FIXED = /(?<!max-)\b(?:min-w|w)-\[(\d+)px\]/g;

    function tsx(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (full.endsWith(join("components", "flow"))) continue;
          tsx(full, out);
        } else if (entry.endsWith(".tsx")) out.push(full);
      }
      return out;
    }

    it("sets no fixed width over 390px outside the allow-list", () => {
      const offenders: string[] = [];
      for (const file of [...tsx(join(root, "src/app")), ...tsx(join(root, "src/components"))]) {
        const rel = relative(root, file);
        const allowed = ALLOWED[rel] ?? [];
        for (const [cls, px] of readFileSync(file, "utf8").matchAll(FIXED)) {
          if (Number(px) <= 390 || allowed.includes(cls)) continue;
          offenders.push(`${rel}: ${cls}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });
  ```

  **1b. `tests/page-header.test.ts`** — the pins Task 5 wrote describe a header
  that only ever had a desktop shape. They are re-aimed at both, not deleted.
  Replace:

  ```ts
      expect(html).toMatch(/grid-cols-\[1fr_auto_1fr\]/);
      expect(html).toMatch(/text-center/);
  ```

  with:

  ```ts
      // BOTH LAYOUTS, FROM ONE RENDER. The three-zone grid is a `md:` fact
      // now — below the breakpoint this same markup is a column with the title
      // left-aligned, which is a phone's only honest reading of a row that
      // wants a tab strip, a centred name and three buttons on it.
      expect(html).toMatch(/md:grid-cols-\[1fr_auto_1fr\]/);
      expect(html).toMatch(/md:text-center/);
      expect(html).toMatch(/flex flex-col items-stretch/);
  ```

  and add a third `it` to the same `describe`:

  ```ts
    it("stacks below md: a scrolling tab strip, a left title, wrapping actions", () => {
      const html = renderToStaticMarkup(
        createElement(PageHeader, {
          title: "Dashboard",
          tabs: createElement("nav", null, "Views"),
          actions: createElement("button", null, "+ Add"),
        }),
      );
      // The strip scrolls sideways inside its own box rather than pushing the
      // page — the failure a ~520px control in this row used to cause.
      expect(html).toMatch(/overflow-x-auto/);
      expect(html).toMatch(/text-left/);
      // 8px between actions, wrapping rather than overflowing.
      expect(html).toMatch(/flex-wrap[^"]*gap-2/);
    });
  ```

  **1c. `tests/page-width.test.ts`** — two pins name the grid's old first rung.
  Replace:

  ```ts
        .filter((f) => readFileSync(f, "utf8").includes("sm:grid-cols-2 xl:grid-cols-3"));
  ```

  with:

  ```ts
        .filter((f) => readFileSync(f, "utf8").includes("md:grid-cols-2 xl:grid-cols-3"));
  ```

  and replace:

  ```ts
      expect(page).toMatch(/BOARD_GRID = "grid gap-6 sm:grid-cols-2 xl:grid-cols-3";/);
  ```

  with:

  ```ts
      // The first rung is `md` since the 4 September re-theme: below it the
      // rail is not rendered and the header has stacked, so two tiles abreast
      // there is a phone layout pretending to be a tablet one.
      expect(page).toMatch(/BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3";/);
  ```

  (The `it` above the first one says the rule "bans the exact old board literal,
  not `sm:grid-cols-2` in general". That stays true and stays as written — the
  literal it bans is simply the current one. `tests/board-render.test.ts` needs
  no edit at all: it asserts `expect(html).toContain(BOARD_GRID)` against the
  imported constant, so it follows this change by construction, which is why the
  constant is imported there rather than typed.)

  **1d. `tests/board-canvas-render.test.ts`** — it already proves every cell
  carries all three renderings; it has never said what the phone's one is. Add,
  after `it("gives every cell all three renderings", …)`:

  ```ts
    it("renders the phone at ONE column, in the desktop reading order", () => {
      /**
       * `--c1` is what the stylesheet picks below 768px. Two tiles side by side
       * at twelve columns must both come back full width and stacked here —
       * `reflow(tiles, 1)` packs left to right and wraps when the next tile
       * will not fit, which at one column is every time.
       *
       * The ORDER is the desktop reading order, which is the only order a
       * phone can honestly present: the cells are placed on explicit lines, so
       * the DOM order is the same at every width and this decides tab order.
       */
      const html = render([tile("a"), tile("b", { x: 3 })]);
      expect(html.match(/--c1:1 \/ span 1/g) ?? []).toHaveLength(2);
      expect(html).toContain("--r1:1 / span 4");
      expect(html).toContain("--r1:5 / span 4");
      expect(html.indexOf("Metric a")).toBeLessThan(html.indexOf("Metric b"));
    });
  ```

- [ ] **Step 2 — run them, confirm they fail**

  ```bash
  pnpm vitest run tests/mobile-content.test.ts tests/page-header.test.ts tests/page-width.test.ts tests/board-canvas-render.test.ts
  ```

  Expected: in `mobile-content.test.ts` the grid pin fails (`BOARD_GRID` still
  says `sm:`), all four header pins fail (the branch is still `sm:grid`,
  `items-center`, `text-center`, `justify-center sm:justify-end`, with no
  scroller), and the strip pin fails (`ViewStrip` is still `flex-wrap`); the
  canvas and fixed-width blocks PASS from the first run and are regression
  guards rather than red steps — that is the point of writing them. In
  `page-header.test.ts` the two re-aimed assertions and the new `it` fail; in
  `page-width.test.ts` the `BOARD_GRID` literal fails; in
  `board-canvas-render.test.ts` the new `it` passes immediately, for the reason
  its own docblock gives.

- [ ] **Step 3 — implement: `src/components/ui/page.tsx`**

  **3a. The grid's first rung.** Replace:

  ```tsx
  export const BOARD_GRID = "grid gap-6 sm:grid-cols-2 xl:grid-cols-3";
  ```

  with:

  ```tsx
  /**
   * THE FIRST RUNG IS `md`, NOT `sm`, SINCE THE 4 SEPTEMBER RE-THEME.
   *
   * `sm:grid-cols-2` put two tiles abreast from 640px — inside the band where
   * the rail is no longer rendered and this page's own header has already
   * stacked, on a screen that is a large phone held sideways. Two 300px tiles
   * there are narrower than the 28px numeral they are built around, and the
   * board stops being readable exactly where the shell has just admitted it is
   * on a phone. One decision, one breakpoint: below `md` the console is a
   * single column of everything.
   */
  export const BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3";
  ```

  **3b. The header's three zones become three lines.** Replace the `tabs ? (`
  branch's wrapper, title cell and actions cell — the block Task 5 produced,
  which reads:

  ```tsx
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
  ```

  with:

  ```tsx
        <div
          className={cn(
            /**
             * IT BREAKS AT `md`, WHICH IS WHERE THE SHELL BREAKS. This stacked
             * at `sm` when it was written, on the reasonable-sounding rule that
             * three side-by-side zones need ~640px to be zones. The rail leaves
             * at 768 (see `Sidebar`), so between the two the page had a
             * three-zone header, no rail, and a board still trying for two
             * columns — one layout in three minds. One breakpoint for the whole
             * console is worth more than a header that is right on its own.
             *
             * `items-stretch`, NOT `items-center`, below the breakpoint: these
             * three are full-width rows on a phone, and centring them makes the
             * tab strip's scroller as narrow as its content, which is the one
             * shape a scroller must never take.
             */
            "flex flex-col items-stretch gap-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-x-4",
            back && "mt-3",
          )}
        >
          {/* THE STRIP SCROLLS RATHER THAN WRAPPING. A view bar is a horizontal
              object — the order is meaningful and draggable — and a phone with
              six views would otherwise turn the top of the board into three
              lines of tabs above the title they belong to. `quiet-scroll` is
              the same scrollbar the board's own lane scrollers wear.
              `md:overflow-visible` hands the focus ring its room back above the
              breakpoint, where nothing needs to scroll. */}
          <div className="quiet-scroll flex min-w-0 max-w-full items-center overflow-x-auto md:overflow-visible">
            {tabs}
          </div>
          {/* LEFT ON A PHONE, CENTRED ABOVE `md`. A centred title is what the
              Figma draws BETWEEN two zones; on its own line with nothing either
              side of it, centring is just a heading that has come loose from
              the page's own reading edge. */}
          <div className="flex flex-col items-start gap-2 text-left md:items-center md:text-center">
            <h1 className="text-display-xs font-semibold tracking-[0.07px] text-heading">{title}</h1>
            {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
          </div>
          {actions && (
            /* WRAPS AT 8px, ALIGNED TO THE READING EDGE BELOW `md`. "+ Add",
               "Refresh All" and "Today ▾" are ~260px of `xs` controls: they fit
               on one line at 390px and wrap to two the moment a label grows,
               which is what `flex-wrap` is for and why none of them is
               `shrink-0`. */
            <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">{actions}</div>
          )}
        </div>
  ```

  And correct the last paragraph of the docblock above that branch, which
  describes the arrangement wrongly in two ways — it names `sm` and it lists the
  stacked order as "title, then tabs, then actions" when the DOM order has
  always been tabs, title, actions. Replace:

  ```tsx
         * Base layout stacks (title, then tabs, then actions) below `sm`,
         * where three side-by-side zones have no room left to be zones.
  ```

  with:

  ```tsx
         * Base layout stacks below `md` — the tab strip in its own scroller,
         * then the title on its own line at the reading edge, then the actions
         * wrapping — in DOM order, which is the order the grid places them in
         * left to right above the breakpoint. `md` rather than `sm` because
         * that is where the shell's rail goes; see the row's own note.
  ```

- [ ] **Step 4 — implement: `src/app/dashboard/board-controls.tsx`**

  One class, and it is what makes the header's scroller a scroller. Replace:

  ```tsx
      <div ref={strip} className="-mx-1 flex flex-wrap items-center gap-6 px-1 py-1">
  ```

  with:

  ```tsx
      /* `flex-nowrap` BELOW `md`, AND THE HEADER SCROLLS IT. A wrapping strip
         inside an `overflow-x-auto` box never scrolls — it just gets taller,
         which on a phone is three lines of tabs above the title they name. It
         also fixes the drag on a narrow screen for free: the reorder finds its
         target by comparing `clientX` against each tab's rect, and a wrapped
         row has several tabs at the same x. Above `md` there is room for the
         row and wrapping stays the right answer. */
      <div ref={strip} className="-mx-1 flex flex-nowrap items-center gap-6 px-1 py-1 md:flex-wrap">
  ```

- [ ] **Step 5 — run it green**

  ```bash
  pnpm vitest run tests/mobile-content.test.ts tests/page-header.test.ts tests/page-width.test.ts tests/board-canvas-render.test.ts tests/board-render.test.ts tests/board-shape.test.ts tests/board-controls.test.ts tests/calendar-view.test.ts tests/dashboard-page-header.test.ts tests/dashboard-empty.test.ts
  ```

  All ten pass. The last six are regression runs against this task's two real
  risks: `board-render`/`board-shape`/`calendar-view`/`dashboard-page-header`
  all read `BOARD_GRID` or the header's arrangement, and
  `board-controls`/`dashboard-empty` cover the strip whose wrap rule just
  changed (`dashboard-empty.test.ts` pins a `sm:grid-cols-2` on the METRIC
  PICKER, which is a different grid and is deliberately not touched here).

- [ ] **Step 6 — gate**

  ```bash
  pnpm typecheck && pnpm vitest run tests/mobile-content.test.ts tests/page-header.test.ts tests/board-canvas-render.test.ts tests/page-width.test.ts tests/chrome-band.test.ts && pnpm check:ui
  ```

  `check:ui` passes: nothing here is a colour, a radius, a weight or a
  hand-rolled control — `quiet-scroll` is a globals.css class the board's own
  scrollers already wear, and `md:` on an existing utility is not a new
  spelling of anything.

- [ ] **Step 7 — commit**

  ```bash
  git add src/components/ui/page.tsx src/app/dashboard/board-controls.tsx tests/mobile-content.test.ts tests/page-header.test.ts tests/page-width.test.ts tests/board-canvas-render.test.ts
  git commit -m "$(cat <<'EOF'
  Stack the page header on a phone, and hold the board to one column under md

  The three-zone header now breaks where the shell breaks: below md the tab
  strip scrolls sideways in its own container, the title sits on its own line
  at the reading edge instead of centred between two zones that are no longer
  beside it, and the actions wrap at 8px. The board's grid moves its first
  rung from sm to md, so 640-768px stops being a band with no rail, a stacked
  header and two 300px tiles in it; the custom canvas was already one column
  there and is now pinned as such. A new scan fails the build on any fixed
  width over 390px outside two allow-listed scrollers, which is the rule that
  keeps a phone from scrolling sideways.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## After the last task (controller, not an implementer)

1. Whole-branch review (fable) with the Figma beside it: every route, both themes, 1440 and 1920 wide; contrast re-measured for every pair the docs cite.
2. Merge to main and push; Vercel deploys.
