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
 * A SPLIT SITS OVER THE MIDDLE OF ITS OWN BRANCHES. Read off the rendered
 * canvas rather than the position map, because this is the thing that was
 * wrong: the hub was centred, the branches were not under it.
 */
const byId = new Map(boxes.map((b) => [b.id, b]));
const SPLITS = { hub: ["bA", "bB", "bC", "bD", "bE", "bF"], hA: ["aA", "aB"], hB: ["bBa", "bBb"], hC: ["cCa", "cCb"], hAA: ["aaA", "aaB"] };
for (const [hubId, kids] of Object.entries(SPLITS)) {
  const h = byId.get(hubId);
  const xs = kids.map((k) => byId.get(k)?.x).filter((x) => x != null);
  if (!h || xs.length !== kids.length) {
    check(false, `${hubId} and its branches all rendered`);
    continue;
  }
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  check(Math.abs(mid - h.x) < 1, `${hubId} is centred over its ${kids.length} branches`, `off by ${Math.round(mid - h.x)}px`);
}

await page.screenshot({ path: OUT });
console.log(`\nshot: ${OUT}`);
await browser.close();

if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — the builder's canvas holds its shape.");
