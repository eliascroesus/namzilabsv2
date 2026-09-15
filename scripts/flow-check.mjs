/**
 * DRIVE THE FLOW BUILDER'S CANVAS IN A REAL BROWSER.
 *
 * Everything the suite knows about this canvas it knows from source text or
 * from a position map. Both stayed green for months while a six-way Split with
 * splits nested under it drifted hundreds of pixels off-centre, because every
 * layout fixture in `tests/flow-canvas-utils.test.ts` was ONE split of leaf
 * steps — the only shape the old algorithm got right.
 *
 * This asks the browser the two questions a map cannot answer: are the cards
 * that were placed 344px apart actually clear of each other once rendered at
 * their real widths and heights, and does a branch card show the name its Split
 * gives it. `/design/flow` mounts the real builder on the real flow that was
 * reported as a mess, with no session needed.
 *
 * Usage: `pnpm dev` in one terminal, `pnpm flow` in another.
 * SHOT_BASE overrides http://localhost:3000, OUT overrides the screenshot path.
 * Exits non-zero on any failure.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/flow-canvas.png";
/** The card is `w-[300px]`; COL in graph-utils is that plus a 44px gutter. */
const COL = 344;

const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/design/flow`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
// React Flow measures every node after mount and the layout reads those heights
// back; a shot taken before that lands is of a canvas mid-thought.
await page.waitForTimeout(2000);

const boxes = await page.evaluate(() =>
  [...document.querySelectorAll(".react-flow__node")].map((el) => {
    const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
    const p = m ? m[1].split(",").map(Number) : [1, 0, 0, 1, 0, 0];
    return { id: el.getAttribute("data-id"), x: p[4], y: p[5], w: el.offsetWidth, h: el.offsetHeight, text: el.innerText.replace(/\s+/g, " ").trim() };
  }),
);

console.log(`\nFlow canvas — ${boxes.length} cards\n`);
check(boxes.length >= 25, "the whole flow rendered", `${boxes.length} cards`);
check(errors.length === 0, "no page errors", errors.join(" | "));

/**
 * The layout reasons in LEFT-EDGE coordinates and spaces columns by a constant
 * derived from the card's width, so a card of another width is not a cosmetic
 * difference — it is a lane whose gap means something different from every
 * other lane's. Named, not counted, because "300, 150" does not say which.
 */
const odd = boxes.filter((b) => b.w !== 300).map((b) => `${b.id}@${b.w}px`);
check(odd.length === 0, "every card is one width", odd.join(", "));

/**
 * OVERLAP MEASURED ON THE RENDERED BOX, not on the position the layout returned.
 * A card grows with a publish footer and with the length of its result line, so
 * "344 apart" and "not touching" are two different claims and only one of them
 * is checkable here.
 */
const hits = [];
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i];
    const b = boxes[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.id}/${b.id}`);
  }
}
check(hits.length === 0, "no two cards overlap", hits.join(", "));

// Same row, and closer than one column: the gap that reads as a collision even
// when the boxes technically clear.
const rows = new Map();
for (const b of boxes) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);
const tight = [];
for (const [y, list] of rows) {
  const sorted = [...list].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round(sorted[i].x - sorted[i - 1].x);
    if (gap < COL - 1) tight.push(`row ${Math.round(y)}: ${sorted[i - 1].id}→${sorted[i].id} ${gap}px`);
  }
}
check(tight.length === 0, `every same-row pair is at least ${COL}px apart`, tight.join("; "));

/**
 * A BRANCH CARD WEARS ITS SPLIT'S NAME. The specimen's Split calls its lanes
 * "Booked calls", "No-shows" and so on; a card still reading "Path A" means the
 * hub's list and the card have come apart again.
 */
const stale = boxes.filter((b) => /\bPath [A-F]\b/.test(b.text)).map((b) => b.id);
check(stale.length === 0, 'no branch card still reads "Path A"', stale.join(", "));
const named = boxes.filter((b) => /Booked calls|No-shows|High ticket|Within 7 days/.test(b.text));
check(named.length >= 4, "branch cards show the Split's names", `${named.length} found`);

/**
 * THE SAME NUMBER OF BRANCHES EACH SIDE OF A SPLIT — the MEDIAN branch under the
 * hub, not the midpoint of the outermost two. Branches are not evenly spaced (a
 * branch carrying a nested split is held further from its neighbour than a
 * branch that is one card), so the midpoint put four of six heads on one side.
 * Read off the rendered canvas, because this is the thing that looked wrong.
 */
const byId = new Map(boxes.map((b) => [b.id, b]));
const SPLITS = { hub: ["bA", "bB", "bC", "bD", "bE", "bF"], hA: ["aA", "aB"], hB: ["bBa", "bBb"], hC: ["cCa", "cCb"], hAA: ["aaA", "aaB"] };
for (const [hubId, kids] of Object.entries(SPLITS)) {
  const h = byId.get(hubId);
  const xs = kids.map((k) => byId.get(k)?.x).filter((x) => x != null).sort((a, b) => a - b);
  if (!h || xs.length !== kids.length) {
    check(false, `${hubId} and its branches all rendered`);
    continue;
  }
  const median = xs.length % 2 === 1 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  check(Math.abs(median - h.x) < 1, `${hubId}'s middle branch is under the hub`, `off by ${Math.round(median - h.x)}px`);
  const left = xs.filter((x) => x < h.x).length;
  const right = xs.filter((x) => x > h.x).length;
  check(Math.abs(left - right) <= 1, `${hubId} has the same number of branches each side`, `${left} left, ${right} right`);
}

/**
 * EVERY BRANCH OF A SPLIT TURNS ON ITS OWN LINE.
 *
 * `getSmoothStepPath` turns an edge at the midpoint between its two cards, and a
 * hub's branches all leave the same card on the same row — so without lanes, six
 * horizontal runs land on one y, each one's span containing the next, and a line
 * cannot be followed back to the branch it feeds. Measured, not eyeballed: the
 * y of each edge's horizontal run, per side of the hub.
 */
const runs = await page.evaluate(() =>
  [...document.querySelectorAll(".react-flow__edge")]
    .map((el) => {
      const d = el.querySelector("path.react-flow__edge-path")?.getAttribute("d") ?? "";
      // Each command's ENDPOINT, which for a Q is its last pair, not its control
      // point — the horizontal run starts where a rounded corner finishes.
      const pts = [...d.matchAll(/([MLQ])([^MLQZ]*)/g)].map((m) => {
        const n = m[2].trim().split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
        return { x: n[n.length - 2], y: n[n.length - 1] };
      });
      const flat = [];
      for (let i = 1; i < pts.length; i++) {
        if (Math.abs(pts[i].y - pts[i - 1].y) < 0.5 && Math.abs(pts[i].x - pts[i - 1].x) > 2) flat.push({ y: pts[i].y, lo: Math.min(pts[i].x, pts[i - 1].x), hi: Math.max(pts[i].x, pts[i - 1].x) });
      }
      return { id: el.getAttribute("data-id") ?? "", flat };
    })
    .filter((e) => e.id.startsWith("e_hub_") && e.flat.length > 0)
    .map((e) => ({ id: e.id, y: e.flat[0].y, lo: e.flat[0].lo, hi: e.flat[0].hi })),
);
const stacked = [];
for (let i = 0; i < runs.length; i++) {
  for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i];
    const b = runs[j];
    // Same y AND overlapping in x is one line drawn over another.
    if (Math.abs(a.y - b.y) < 1 && a.lo < b.hi - 1 && b.lo < a.hi - 1) stacked.push(`${a.id}/${b.id}@y${Math.round(a.y)}`);
  }
}
check(runs.length >= 6, "the Split's branch edges all draw a horizontal run", `${runs.length} found`);
check(stacked.length === 0, "no two branch edges share a horizontal line", stacked.join(", "));

await page.screenshot({ path: OUT });

/**
 * THE NUMBER PICKER FINDS A STEP BY ITS NAME.
 *
 * Every step in this flyout offers exactly one pickable column and every one of
 * them is called "Output number", so the ONLY string that tells "3. Booked
 * calls" from "4. No-shows" is the step's own name — and it was the one string
 * the search could not read. Typing "Booked" against a canvas full of named
 * filter steps answered "No fields match".
 *
 * `tests/field-picker-search.test.ts` holds the rule; this holds the WIRING,
 * which is the half a unit test cannot see: that `DataBrowser` is the component
 * behind this flyout, that it is handed one group per earlier step, and that
 * the group it is handed carries the title the canvas is showing. The bug lived
 * entirely in that gap — the predicate was correct about the columns it was
 * given, and nobody had given it the step.
 */
await page.locator('[data-testid="rf__node-calcNum"]').click();
await page.waitForSelector("text=Compare two numbers", { timeout: 10000 });
await page.getByRole("button", { name: "Pick a number from an earlier step" }).first().click();
const search = page.getByPlaceholder(/Search steps/).first();
await search.waitFor({ timeout: 10000 });

/** Everything visible inside the flyout, flattened. */
const flyout = () =>
  page.evaluate(() => {
    let n = document.querySelector("input[placeholder^='Search steps']");
    while (n && !String(n.className).includes("rounded-surface")) n = n.parentElement;
    return (n?.innerText ?? "").replace(/\s+/g, " ");
  });

await search.fill("Booked");
await page.waitForTimeout(300);
const hitStep = await flyout();
check(hitStep.includes("Booked calls"), 'searching "Booked" finds the step called Booked calls', hitStep.slice(0, 120));
check(!hitStep.includes("No-shows"), "…and only that step", hitStep.slice(0, 120));

await search.fill("zzzz");
await page.waitForTimeout(300);
const none = await flyout();
check(/No fields match/.test(none), "a query that matches nothing still matches nothing", none.slice(0, 120));

/**
 * AND THE PROSE IS GONE. Three explanations used to print inside this flyout —
 * a sentence under every step withholding its columns, and a standing line
 * along the bottom about filters adding none. They are one ⓘ beside the type
 * chips now. Asserted as an ABSENCE because that is what was asked for, and an
 * absence is the one thing a source grep would have to guess at.
 */
await search.fill("");
await page.waitForTimeout(300);
const full = await flyout();
check(!/on its last test|Filters and date windows/.test(full), "no step prints a paragraph under its fields");
check(
  (await page.getByRole("button", { name: "About picking data" }).count()) === 1,
  "the ⓘ beside the type chips carries the explanation instead",
);

console.log(`\nshot: ${OUT}`);
await browser.close();

if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — the builder's canvas holds its shape.");
