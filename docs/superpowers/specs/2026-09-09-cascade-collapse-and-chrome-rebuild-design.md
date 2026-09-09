---
name: Cascade collapse + chrome rebuild
date: 2026-09-09
base: 78d2d6e (origin/main)
figma: DWPyHPYAlD4czvPmppuf6y, node 0:5 ("Final Design"), 1920x1200
status: approved for implementation
---

# Cascade collapse, then chrome rebuild

Two pieces of work, in order. **A** removes the layering that lets dead CSS
outrank live utilities. **B** rebuilds the top-bar region to match the
9 September Figma. A comes first because B is unbuildable while thirty-two
unlayered rules beat every class B would write.

The *Compare To* control is built here; the comparison **series** behind it is
deferred. See Non-goals.

---

## 1. Why

Two separate complaints, established by measurement rather than by reading.

**The cascade.** `src/app/globals.css` is 1907 lines, 65% of it prose comment.
Thirty-five top-level rules sit outside any `@layer`. Unlayered CSS beats
layered CSS unconditionally — specificity is never consulted across layers — and
every Tailwind utility lives in `@layer utilities`. So these win over anything a
component writes:

```css
.stat-numeral { font-weight: 600 }
.wordmark     { font-size: 1.5rem; font-weight: 900 }
.label-micro  { font-size: var(--text-2xs); font-weight: 500 }
```

Writing `font-semibold` or `text-sm` on those elements does nothing. The file
documents having already shipped this exact bug once, when `text-wrap: balance`
on headings outranked `truncate`.

**The chrome.** The shipped app implements a *previous* Figma. The source cites
nodes `49:5268`, `58:5824`, `58:5930`, `49:5711` and `14:4` — none of which are
in the new file. The new frame reverses several of those decisions, most
importantly the colour of the top bar.

Verified by photographing `/design/overview` at 1920x1200 against the Figma
render:

| | Figma `0:5` | Shipped `78d2d6e` |
|---|---|---|
| Top-bar ground | white, `1px #F1F1F1` bottom border | `#121214`, both themes |
| Bar structure | three bars, 57 + 49 + 43 = 149px | one 65px bar + a controls row |
| Search | top bar, 480x40, `#EFEFEF` | in the rail |
| "Namzilabs" | wordmark, far right, 24/700 | centred promo, "Try Namzilabs for free" |
| Page title | "Overview", 24/700, bar 2 | absent |
| "Updated just now" | bar 2 | slot exists; no caller has ever passed it |
| Share / moon / bell | bar 2 | bar 1 |
| Moon + bell | 32x32, `#EFEFEF` on hover | `hover:bg-transparent` — suppressed |
| View tabs | filled pills, with icons | underlined text, no icons |
| Controls | Add · Today · Compare To · Refresh All | Add · Today · Refresh all |
| Card header | divider under the title row | no divider |

The `#EFEFEF` on the Group tab and on the moon icon are **hover states drawn in
place**, per the designer. They are not resting styling. Resting is transparent;
`#DEDEDE` is the active tab.

---

## 2. Non-goals

- **The comparison *series*** — not the *Compare To* control. The control is
  chrome, it is drawn in the Figma, and it is built here 1:1 (§B.2, bar 3).
  What is deferred is the data behind it: the two-series chart legend needs a
  comparison series the product does not compute, which `DESIGN.md` already
  records as unbuilt. That is backend and metrics work.

  So: the button ships at the correct geometry, wired to whatever range
  comparison the board already supports. Confirm that surface before
  implementing; if nothing exists to wire to, the control ships disabled with a
  note rather than silently doing nothing.
- **The flow builder.** Its seven unlayered rules stay exactly as they are —
  see A.3. Its design is not under review.
- **No wholesale deletion.** The rail, the cards, the twelve-column grid and the
  thirty-one primitives match the Figma and are kept. `@theme` and
  `@theme inline` are kept: they are the Tailwind v4 / shadcn bridge, not
  duplication, and removing them breaks every utility in the app.
- **No component rewrites in A.** A is a CSS-only change.

---

## 3. Section A — collapse the cascade

### A.1 What moves

Of the thirty-five unlayered rules, **three are benign and stay put**: `:root`,
`.dark` and `html.dark` declare only custom properties. Unlayered is the
conventional place for them and costs nothing.

**Seven are the flow builder's and stay put** (A.3).

The remaining **25 set real properties and move into a layer**:

    35 total  =  25 moved  +  3 benign (:root, .dark, html.dark)  +  7 builder

| Destination | Rules |
|---|---|
| `@layer base` | `html` (x2, merged), `textarea`, `summary`, `select:-webkit-autofill`, `:where(svg.lucide)`, both `:where(a, button, summary, …)` focus-visible rules |
| `@layer components` | `.stat-numeral`, `.label-micro`, `.wordmark`, `.tnum`, `.font-display`, `.quiet-scroll` and its four scrollbar pseudo-rules, `.board-canvas`, `.board-cell`, `.skip-link`, `.skip-link:focus-visible`, `.bg-rail`, the two `animate-in`/`animate-out` state rules |

`.board-canvas` and `.board-cell` carry the responsive `@media` blocks at
1479–1496; those move with them.

### A.2 Structural tidying

1. **Merge the three `@layer base` blocks** (33, 1270, 1376) into one.
2. **Merge the two `html` blocks** (1172, 1261). They do *not* conflict — one
   sets `color-scheme` and `scroll-padding-top`, the other
   `-webkit-tap-highlight-color` — so this is scatter, not a correctness bug.
3. **Replace the one dead colour literal.** Line 1262 is
   `-webkit-tap-highlight-color: rgb(0 212 146 / 0.12)` — `#00D492`, teal, from
   the pre-lime palette. It becomes the brand at the same alpha. This is the
   *only* live colour literal outside the token blocks; every other hex in the
   file is prose.
4. **Audit `@theme inline`** (53 vars) for entries with no consumer. Report the
   list; delete only the ones nothing reads.

### A.3 The flow builder is excluded, deliberately

`.react-flow__node`, `.react-flow__node.selectable:focus-visible`,
`.react-flow__handle`, `.react-flow__edge-path`, `.flow-shadow`,
`.flow-pop-in` and `.flow-pop-out` stay unlayered.

Layering them would hand precedence to utilities and could shift the builder's
appearance. The builder's design is settled and is not being revisited. The
inconsistency is accepted and recorded here so the next reader does not "fix" it.

### A.4 Verification — and what success actually looks like

**The goal is not "renders identically."** Layering these rules deliberately
returns precedence to utilities, so anywhere a utility was being silently
overridden, the pixels *will* change. Those changes are the bug being fixed.

The gate is therefore: **every diff is accounted for, none is a regression.**

1. `SHOT_SCHEME=light` and `SHOT_SCHEME=dark`, `SHOT_WIDTH=1920`, screenshot
   `/design/overview`, `/design`, `/design/board`, `/design/primitives`,
   `/design/gallery` before and after.
2. Diff each pair. For every difference, name the utility that now wins and
   confirm it is the intended value.
3. Screenshot the flow builder before and after; it must be **byte-identical**,
   since its rules did not move. Any difference means something leaked.
4. `pnpm typecheck`, `pnpm test`, `pnpm check:ui`, `pnpm geometry`.

---

## 4. Section B — rebuild the chrome

### B.1 The token split

The Figma draws the rail dark and the top bar white *in the same frame*. Today
both are one token, `--chrome: #121214`, identical in `:root` and `.dark`. That
token splits:

| Token | `:root` (light) | `.dark` |
|---|---|---|
| `--rail` | `#121214` | `#121214` |
| `--rail-foreground` | `#ffffff` | `#ffffff` |
| `--rail-muted` | `#7e7e7e` | `#7e7e7e` |
| `--rail-border` | `#343434` | `#343434` |
| `--rail-control` | `#202020` | `#202020` |
| `--topbar` | `#ffffff` | `#121214` |
| `--topbar-foreground` | `#2e2e2e` | `#ffffff` |
| `--topbar-muted` | `#7e7e7e` | `#7e7e7e` |
| `--topbar-border` | `#f1f1f1` | `#343434` |
| `--topbar-control` | `#efefef` | `#202020` |
| `--topbar-active` | `#dedede` | `#3a3a3a` |

The existing `--chrome-*` names are retired in favour of these two families.
The rail keeps every value it has today, so the rail should not move a pixel.

**This rename has 66 call sites across 5 files** — `text-chrome-foreground` (22),
`text-chrome-muted` (14), `bg-chrome` (8), `bg-chrome-control` (7),
`border-chrome-border` (6), `bg-chrome-accent` (3), and six single uses. Every
one is mechanical, but none can be left behind: a missed `bg-chrome` resolves to
nothing once the token is gone and paints the bar transparent. Rename by token,
compile, and let `pnpm typecheck` plus a grep for `-chrome` prove the set is
empty before the visual check.

**The dark column is a proposal, not a reading.** The Figma draws only the light
theme. The dark values continue what ships today. Flag on review.

### B.2 The three bars

Replacing one 65px bar with three, at the Figma's own heights. All three:
`padding: 8px 24px`, `background: var(--topbar)`,
`border-bottom: 1px solid var(--topbar-border)`, `justify-content: space-between`.

**Bar 1 — 57px.** Left, a 480x40 group with `gap: 8`:
- Search field, `flex: 1` (410px as drawn), `height: 40`, `padding: 0 12`,
  `background: var(--topbar-control)`, `radius: 8`, `gap: 10`; magnifier 18x18
  stroked `#6B6B6B`; placeholder "Search…" at 15/400/22 in `#6B6B6B`.
- Avatar, 32x32, `background: #2E2E2E`, `border-radius: 999px`, "EL" at 13/600
  in white.
- Gift glyph, 22x21, filled `#2E2E2E`, with a 3px-radius `#B6FF56` dot at its
  top-right.

Right: the **"Namzilabs" wordmark**, 24/700/32, `#2E2E2E`.

This moves search out of the rail. `railSearchEntries` and its filtering keep
working — only the mount point changes.

**Bar 2 — 49px.** Left: the page title, "Overview", 24/700/32, `#2E2E2E`.
Right, `gap: 8`:
- "Updated just now", 13/400/16, `#7E7E7E`, `padding: 8`. `top-bar.tsx:156`
  already documents a slot for this; it needs a caller that knows the freshness.
- "Share", `padding: 8`, `radius: 8`, `gap: 4`; two 9x10 chain strokes at 1.5 in
  `#2E2E2E`; label 13/400/16.
- Moon, 32x32, `radius: 8`, glyph filled `#2E2E2E`, **`background:
  var(--topbar-control)` on hover and focus-visible only.**
- Bell, 32x32, same treatment.

The current toggle sets `hover:bg-transparent`, which must be removed for the
hover to appear at all.

**Bar 3 — 43px.** Left, the tab strip: `flex gap-8 items-center`, `radius: 8`.
Label type is 13/400, `line-height: 16`, `letter-spacing: -0.24px` throughout.

**The active tab and the resting tabs are not the same box.** This is the
detail most likely to be got wrong:

- **Active (Overview)** — the padding is on the **outer** pill, which wraps
  *both* the link and the overflow menu:
  `background: #DEDEDE`, `flex gap-4 items-center`, `padding: 4px 8px`,
  `radius: 8`. Inside it, the link is `flex gap-4 items-center` (icon
  `bi:box` 14x14, label `#2E2E2E`), then a 14x14 container holding the
  15.99x15.99 "…" menu glyph.
- **Resting / hover (Group, Calendar)** — the outer element carries only
  `radius: 8` and the background; the padding is on the **inner** link:
  `flex gap-4 items-center`, `padding: 4px 8px`. Icons: `carbon:group` 16x16,
  `clarity:calendar-line` 14x14. Label `#4A4A4A`.

State mapping, from the designer's note that `#EFEFEF` is drawn as a hover:

| State | Background | Ink |
|---|---|---|
| Active | `#DEDEDE` (`--topbar-active`) | `#2E2E2E` |
| Hover | `#EFEFEF` (`--topbar-control`) | `#4A4A4A` |
| Resting | transparent | `#4A4A4A` |

Trailing "+" button: `flex items-center justify-center`, `radius: 8`, glyph
15.99x15.99 stroked `#4A4A4A`. No padding of its own in the frame.

Right, the controls, `gap: 8`, each `padding: 4px 8px`, `radius: 8`,
`background: #FFFFFF`, `border: 1px solid #E1E1E1`, `overflow: clip`, inner
`flex gap-4 items-center`, label 13/400/16 `#2E2E2E`:

| Button | Leading icon | Trailing |
|---|---|---|
| **Add** | `akar-icons:plus`, 14x14 | — |
| **Today** | calendar, 16x16 | chevron, 12x12 |
| **Compare To** | `boxicons:chart-line`, 16x16 | chevron, 12x12 |
| **Refresh All** | refresh, 16x16 | — |

Where a button has a trailing chevron, the label and chevron sit in their own
`flex gap-4 items-start` container inside the `gap-4` row — so the icon-to-label
gap and the label-to-chevron gap are both 4, but they are two separate
containers, not one four-item row.

Two details that are easy to lose: control labels carry **no letter-spacing**,
while the tab labels carry `-0.24px`. And the border is a real `border`, not an
outline — it occupies layout, which is why the drawn heights are 26px for a
16px line box plus 4+4 padding plus 1+1 border.

Note this makes *Add* outlined rather than lime-filled. That is the Figma's
reading and it reverses commit `cd621bf`.

### B.3 Card header divider

Each card gains a header row with a bottom border, per the Figma's
`HorizontalBorder` frames. Exact inset, height and border colour come from
`get_design_context` at implementation time.

### B.4 Provenance of every number in this spec

The bar is 1:1, so it matters where each value came from.

| Region | Node | Source | Authority |
|---|---|---|---|
| Rail | `0:6` | pasted export, complete | exact |
| Bar 1 | `0:101` | pasted export, complete | exact |
| Bar 2 | `0:118` | pasted export, complete | exact |
| Bar 3 | `0:132` | `get_design_context` | exact |
| Cards | `0:212`+ | metadata + render only | **approximate** |

The pasted export truncated at 50,000 characters mid-way through bar 3's *Today*
button — but bar 3 was then read authoritatively, so the whole chrome is exact.

**The card region is not.** `get_design_context` hit the Figma MCP
**Starter-plan rate limit** before it could be read. Its divider inset, height
and border colour (§B.3) are inferred from node metadata and the 1400px render,
and **must be confirmed with `get_design_context` on `0:212`** — behind the
mandatory `figma-design-to-code` skill — before the card work is written. Do not
implement §B.3 from the numbers in this document.

### B.5 Verification

1. Screenshot `/design/overview` at 1920x1200, light and dark, and compare
   against the Figma render element by element: the three bar heights, the
   480px search group, the wordmark's right edge, the tab pills, the control row.
2. Resting / hover / focus-visible for every tab and every icon button, since
   the Figma draws two of them mid-hover and those states are the deliverable.
3. Keyboard: focus-visible rings survive the layer move and the new pills.
4. `pnpm typecheck`, `pnpm test`, `pnpm check:ui`, `pnpm geometry`.
5. The rail must not move. It is unchanged by design; a diff there is a bug.

---

## 5. Risks

| Risk | Handling |
|---|---|
| Layering changes pixels somewhere unexamined | Before/after screenshots on all five `/design` routes, both themes; account for every diff |
| Something leaks into the flow builder | Its rules do not move; builder screenshots must be byte-identical |
| Dark-theme chrome values are invented | Flagged in B.1; confirm before implementing |
| Search relocation breaks rail search | `railSearchEntries` is reused unchanged; only the mount point moves |
| Truncated Figma export | B.4 — re-read via `get_design_context` before card work |
| Local `main` is 60 commits behind | Work is based on `origin/main` (`78d2d6e`) in a worktree, not on local `main` |

---

## Appendix — exact geometry

Every number below is read from the Figma, not estimated. The frame is 1920
wide; the content column is 1660 (1920 − the 260 rail).

### The arithmetic that proves the bar heights

Each bar is `padding: 8px 24px` over a `1px` bottom border, so its height is
fully determined by the tallest thing in it:

| Bar | Tallest child | Height |
|---|---|---|
| 1 | search group, 40 | 40 + 8 + 8 + 1 = **57** |
| 2 | icon buttons, 32 | 32 + 8 + 8 + 1 = **49** |
| 3 | controls, 26 | 26 + 8 + 8 + 1 = **43** |

Total chrome 57 + 49 + 43 = **149**, which is exactly where the content
container starts (`0:212` at `y=149`). If a bar's height is wrong, this sum
breaks and the board shifts — it is the cheapest check in the build.

A control's 26 is itself `16` line box + `4 + 4` padding + `1 + 1` border. The
border must be `border`, not `outline`, or the row measures 24 and every bar
below moves up 2px.

### Bar 1 — `0:101`

Left group at `x=24`, `480 × 40`, `gap: 8`:

| Element | Geometry |
|---|---|
| Search field | `410 × 40`, `padding: 0 12`, `bg #EFEFEF`, `radius 8`, `gap 10` |
| — magnifier | `17.99`, stroke `#6B6B6B` @ `1.68656`, at `x=12` |
| — placeholder | `x=39.99` (12 + 17.99 + 10), "Search…", 15/400/22, `#6B6B6B` |
| Avatar | `x=418` (410 + 8), `32 × 32`, `bg #2E2E2E`, `radius 999`, "EL" 13/600/18 white |
| Gift | `x=458` (418 + 32 + 8), `20 × 20` glyph, fill `#2E2E2E`, lime `#B6FF56` dot `r=3` at its top-right |

Right: **"Namzilabs"**, `x=1515`, `121 × 32`, 24/700/32, `#2E2E2E`.
Right edge 1515 + 121 = 1636 = 1660 − 24. ✔

### Bar 2 — `0:118`

Left: **"Overview"**, `x=24`, `111 × 32`, 24/700/32, `#2E2E2E`.

Right group at `x=1360`, `276 × 32`, `gap: 8`:

| Element | Width | Internals |
|---|---|---|
| "Updated just now" | 121 | `padding: 8`; text `105 × 16`, 13/400/16, `#7E7E7E` |
| "Share" | 67 | `padding: 8`, `gap 4`; chain `12 × 12` at `x=8`; label `35 × 16` at `x=24`, 13/400/16, `#2E2E2E` |
| Moon | 32 | `32 × 32`, `radius 8`; glyph `16 × 16` centred, fill `#2E2E2E` |
| Bell | 32 | `32 × 32`, `radius 8`; glyph `16 × 16` centred, fill `#2E2E2E` |

Positions fall out of the gaps: 0 → 129 → 204 → 244. Right edge
1360 + 276 = 1636 = 1660 − 24. ✔

`8 + 12 + 4 + 35 + 8 = 67` is the Share button's own proof.

**The moon is drawn mid-hover.** Its `#EFEFEF` rounded square is the hover
state, not resting. Resting is transparent — the bell beside it, drawn resting,
is the reference. Both need `background: var(--topbar-control)` on
`:hover` and `:focus-visible` only, and the current `hover:bg-transparent` on
the toggle must be removed or nothing will show.

### Rail — `0:6`, verification only

The rail is **not** being redesigned; these are here so "unchanged" can be
checked rather than assumed. Column `260`, `bg #121214`, content inset `16`.

| Element | Geometry |
|---|---|
| Switcher | `228 × 35.99` at `y=8`; inner `padding: 4px 8px`; "P" badge `27.99`, `bg #B6FF56`, `radius 8`, 13/700/18 `#2E2E2E`; label `x=37.99` (gap 10), 14/600/22 white; chevron `24` at `x=196` |
| "Main Menu" | `65 × 12`, 12/400/12, `#4A4A4A` |
| Nav row | `228 × 32`, `radius 8`, `gap 10`; icon box `32`, glyph `17.99`; label 13/**600**/18 white when active, 13/400/22 `#7E7E7E` when not |
| Active row | `bg #202020` |
| Nav pitch | 40 (32 + gap 8) — Activity 164, Flows 204, Apps 244, Settings 284 |
| Nested group | `228 × 96` at `y=60`; rule column `16` wide (3 × `16 × 32`), `gap 16`, links `196 × 32`, `padding-right 8` |
| Rule ink | active segment white, the other two `#7E7E7E` |
| Invite card | `228 × 50`; `padding: 8px 12`, `bg #202020`, `radius 8`, `border 1px #343434`, `gap 12`; title 12/600/16 white, sub 12/400/16 `#7E7E7E`, `gap 2` |
| New button | `228 × 36` at `gap 16` below invite; `padding: 4px 6`, `bg #B6FF56`, `radius 8`; plus `14`, `gap 4`, "New" 13/600/18 `#2C2C2C` |

### The two numbers that are everywhere

`8` and `4` — every gap between siblings in a bar is `8`, every gap between an
icon and its own label is `4`. The exceptions, and they are the only ones:
`10` inside the search field and between a rail icon and its label, `12` inside
the invite card, `16` between the rail's rule column and its links.
