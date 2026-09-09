# Phase A ledger — what the layering moved

**Base:** `78d2d6e` · **After:** `bfb7da8` · **Method:** `scripts/screenshot.mjs`, 1920x1200, `deviceScaleFactor: 2`, both colour schemes, `globals.css` swapped to the base commit and back on a hot-reloading dev server so nothing but the stylesheet differed.

## Result

| Route | Light | Dark |
|---|---|---|
| `/design` | identical | identical |
| `/design/board` | identical | identical |
| `/design/canvas` | identical | identical |
| `/design/overview` | identical | identical |

Eight of eight byte-identical. **Phase A moved zero pixels.**

## Why that is the expected result, not a disappointing one

The plan said to expect diffs, because layering hands precedence back to utilities and anywhere a utility had been losing, it now wins. None were losing. Checked directly rather than inferred:

| Class | Sets | Live consumers | Conflicting utility? |
|---|---|---|---|
| `.stat-numeral` | weight, letter-spacing, numerics | 9 | No. `calendar-board.tsx:862` carries `text-lg leading-tight`, and the class sets neither font-size nor line-height. |
| `.wordmark` | size, line-height, weight | **0** | No consumer at all — `top-bar.tsx:14` records that the mark was removed and the account took its place. |
| `.label-micro` | size, line-height, weight, transform, tracking | 1 | Demoed on `/design`, which came back identical. |
| `.tnum`, `.font-display`, `.quiet-scroll`, `.board-canvas`, `.board-cell`, `.skip-link` | numerics, family, scrollbars, grid, positioning | 3–24 | No utility competes for those properties at any call site. |
| `.bg-rail` | background | **0** | — |

So the fix is a **latent hazard removed**, not a visible bug repaired. Every one of those rules was *able* to outrank a utility written against it; none happened to be doing so today. The next `font-semibold` added to a `.stat-numeral` would have lost silently, and the guard that exists to catch precisely that was blind.

The guard was the real defect. `tests/base-layer-cascade.test.ts` asserted "no unlayered rule keyed on a bare element" and passed while `html`, `textarea`, `summary` and the autofill rule all sat outside every layer — its scan could not step over a comment, so it saw 13 of 35 rules and read prose inside comments as selectors.

## What this does NOT prove

**The four `/design` routes are all that is reachable without a WorkOS session.** The authenticated dashboard, the settings screens, the flows list and the real calendar were not photographed and are not covered by the table above. Phase A is CSS-only and the class census above is app-wide, so there is no *reason* to expect a diff there — but it has not been measured, and this document should not be read as if it had.

The flow builder is the exception that was measured: `/design/canvas` renders it, and it is byte-identical. Its seven rules did not move, and nothing leaked.
