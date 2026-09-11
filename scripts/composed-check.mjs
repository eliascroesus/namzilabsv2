/**
 * DOES A COMPOSED FUNNEL OR PIE ACTUALLY DRAW WHAT IT CLAIMS?
 *
 * Every other check on this feature reads source or calls a pure function, and
 * none of them can see the three things that actually go wrong on a screen:
 *
 *   A REFUSAL THAT DRAWS ANYWAY. `ChartFrame` promises a blocked state REPLACES
 *   the mark. A composed tile that refuses must show its sentence and NO bars,
 *   no arcs and no headline — a refusal printed under half a chart is worse
 *   than either alone, because the chart is the part people believe.
 *
 *   A BAR CLIPPED FLUSH. A stage wider than the first is clamped to 100%, which
 *   makes it pixel-identical to a stage at exactly 100% unless the cut edge
 *   renders. That is a claim about a border, and only a browser has one.
 *
 *   A DISCLOSURE THAT IS NOT ON THE PAGE. The cohort caveat and the residual
 *   sentence are never optional, so "the string is in the JSX" is not the
 *   question — "is it laid out, non-empty and inside the card" is.
 *
 * So this drives the real components in a real browser and measures the result.
 * Run the dev server first; it reads `/design/canvas`, which needs no auth.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
const res = await page.goto(`${BASE}/design/canvas`, { waitUntil: "networkidle" }).catch(() => null);
if (!res || res.status() >= 400) {
  console.log(`✗ /design/canvas returned ${res?.status() ?? "nothing"} — is the dev server up?`);
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);

const cards = await page.evaluate(() => {
  const host = document.querySelector("[data-composed]");
  if (!host) return null;
  return [...host.children].map((cell) => {
    const card = cell.querySelector("[data-tile-card]") ?? cell.firstElementChild;
    const text = (card?.textContent ?? "").replace(/\s+/g, " ").trim();
    // The mark: any bar or arc actually painted inside this card.
    /**
     * TWO MARKS, TWO SHAPES OF INK — and the check has to know both.
     *
     * A "Funnel" is still a row of filled DIVS on a track, where a loss frame is
     * an outlined box of the same kind: telling those apart needs the fill test,
     * because counting percentage-width divs counted six things for a
     * four-stage funnel.
     *
     * A "Pipeline" is now an SVG POLYGON per stage, one connected body, so it
     * has no divs at all — and the first version of this check duly reported
     * that every pipeline "painted nothing" while a perfectly good funnel was on
     * screen. `segments` is the union: the things that carry a stage's ink,
     * whichever mark drew them.
     */
    const filledDivs = [...(card?.querySelectorAll("div[style*='width']") ?? [])].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && /%$/.test(el.style.width))) return false;
      const cls = (el.className || "").toString();
      return !!el.style.background || /bg-(marker|danger|brand)/.test(cls);
    });
    /**
     * A ZERO STAGE'S POLYGON IS DEGENERATE ON PURPOSE — it is the point the body
     * comes to — so it is counted as a segment that drew NOTHING rather than as
     * a missing stage. `getBBox().width` is the honest measure: a zero-width
     * polygon still exists, still owns its band, and still answers a hover.
     */
    /**
     * A SEGMENT'S OWN WIDTH IS ITS TOP EDGE, not its bounding box — and getting
     * that wrong reported the owner's flaring tile as two equal 100s.
     *
     * Each polygon runs from this stage's width down to the NEXT one's, so a
     * stage that flares has a bbox as wide as the stage below it: exactly the
     * "two identical slabs" reading this redesign exists to kill, resurrected
     * inside the check meant to catch it. The first two points are the top edge,
     * which is the stage's own width and nothing else.
     *
     * A zero stage keeps its polygon — it is the point the body comes to, it
     * owns its band and it answers a hover — and measures 0, which is the whole
     * reason the 4% floor had to die.
     */
    /**
     * A SEGMENT'S OWN WIDTH IS ITS TOP EDGE, not its bounding box — and getting
     * that wrong reported the owner's flaring tile as two equal 100s. Each
     * polygon runs from this stage's width toward the next one's, so a stage
     * whose neighbour is wider has a bbox as wide as that neighbour: exactly the
     * "two identical slabs" reading this redesign exists to kill, resurrected
     * inside the check meant to catch it.
     *
     * The FLOOR is captured beside it, because the fix for that misreading lives
     * there: a falling stage tapers (floor < top), a RISING one steps (floor ===
     * top) and the stage below simply starts wider. A floor wider than its own
     * top is the flare coming back.
     */
    const polyGeom = [...(card?.querySelectorAll("polygon") ?? [])].map((el) => {
      const pts = (el.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      /**
       * MEASURE WHICHEVER AXIS CARRIES THE COUNT. Running DOWN, a stage's edge
       * is horizontal and the measure is x; running ACROSS the whole shape is
       * transposed and it is y. Reading x unconditionally reported every
       * across-flow stage as zero-width — which would have passed a collapsed
       * mark off as an empty one, the exact failure this file exists to catch.
       */
      const w = (a, b) =>
        pts[a] && pts[b]
          ? Math.round(Math.max(Math.abs(pts[b][0] - pts[a][0]), Math.abs(pts[b][1] - pts[a][1])) * 10) / 10
          : 0;
      // 0,1 are the stage's own edge; 4,3 are the band's far edge.
      return { top: w(0, 1), floor: w(4, 3) };
    });
    const polys = polyGeom.map((g) => g.top);
    /** A zero stage draws no polygon at all — it is a dashed rule on the band's axis. */
    const zeroMarks = (card?.querySelectorAll("line[stroke-dasharray]") ?? []).length;
    const bars = filledDivs;
    const arcs = [...(card?.querySelectorAll("path, circle") ?? [])].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    const titles = [...(card?.querySelectorAll("[title]") ?? [])].map((el) => el.getAttribute("title") ?? "");
    /**
     * THE BAR LENGTHS THEMSELVES, in the order they are drawn. Counting bars was
     * enough while every width was a share of the FIRST stage and clamped — the
     * lengths could not be wrong in an interesting way. Under share-of-max the
     * LENGTH is the whole claim, so it has to be read: a rising stage must be the
     * longest bar on the card, and a zero stage must have no bar at all.
     */
    const barPx = bars.map((el) => Math.round(el.getBoundingClientRect().width));
    // The 1px rule marking where the stage above ended, drawn only on a bar that ran past it.
    const notches = [...(card?.querySelectorAll("div") ?? [])].filter((el) => {
      const cls = (el.className || "").toString();
      return /\bw-px\b/.test(cls) && /bg-card/.test(cls);
    }).length;
    /**
     * THE DISCLOSURES LIVE IN `title` NOW, NOT ON THE CARD FACE — the owner's
     * call, after a screenshot in which three stacked sentences took more of a
     * four-column tile than the pipeline they were qualifying and pushed the
     * last stage's bar under the fold.
     *
     * So this stops asserting they are VISIBLE and starts asserting they are
     * REACHABLE, which is the property that actually has to hold: every word is
     * still on the mark for a hover and for a screen reader, and none of it
     * costs a row. Asserting the old way would have quietly passed on a build
     * that dropped them altogether, because the sentences also appear in
     * refusals.
     */
    const notes = titles.join("\n");
    /**
     * TEXT THE BOX CUT OFF — the check that found the real bug here.
     *
     * `Pipeline` shares one row between a stage's NAME, the drop-off pill, the
     * ratio and the count, and at the tile's own minimum width the pill won:
     * "Booked Leads" rendered "Booke…". Nothing else could see it — the string
     * is in the DOM, the test that asserts the label passes, and only the
     * layout is wrong.
     *
     * `sr-only` is excluded rather than measured: it is a 1px clip by
     * definition, so every screen-reader summary reports as truncated and would
     * bury the one finding that matters.
     */
    const clipped = [...(card?.querySelectorAll("span,p") ?? [])]
      .filter((el) => !/sr-only/.test((el.className || "").toString()))
      /**
       * A STAGE NAME RUNNING ACROSS HAS NOWHERE ELSE TO GO — it shares the card
       * with every sibling stage, so truncation is the arithmetic rather than a
       * bug, and the full string is in `title`. The DOWN flow's name lane is not
       * exempt: that is where "Booked Leads" rendered "Booke…" because a pill
       * took room the name could have had, which is the case this rule exists
       * for.
       */
      .filter((el) => !el.hasAttribute("data-stage-name"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent || "").slice(0, 24));
    const box = card?.getBoundingClientRect() ?? { width: 0, height: 0 };
    // Does anything inside overflow the card's own box sideways?
    const overflow = [...(card?.querySelectorAll("*") ?? [])].some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
    });
    return {
      title: text.slice(0, 46),
      bars: bars.length,
      arcs: arcs.length,
      polyCount: polys.length,
      barPx,
      polys,
      polyGeom,
      zeroMarks,
      notches,
      notes,
      overflow,
      clipped,
      text,
      w: Math.round(box.width),
      h: Math.round(box.height),
    };
  });
});

/**
 * THE SETTINGS PANEL'S RESTING HEIGHT, which is the other half of this feature
 * and the half nothing could see.
 *
 * The owner's complaint was not that the panel was wrong but that it "feels
 * complex", and the measurable version of that is: how tall is the Data tab at
 * rest, and is the control you came for on the screen? Both are geometry. The
 * repo's own checks read source, so a panel that scrolls past the fold on every
 * composed tile ships green — and the panel is `w-[min(384px,…)]`, narrower
 * than anyone estimating from a screenshot assumes.
 *
 * `scrolls` is the claim that matters: the Data tab is inside a
 * `max-h-[calc(100dvh-2rem)]` shell, so "too tall" shows up as a scrollable
 * body rather than as overflow.
 */
const panels = await page.evaluate(() => {
  const host = document.querySelector("[data-composed-panel]");
  if (!host) return null;
  return [...host.querySelectorAll("[data-tile-panel]")].map((p) => {
    const body = p.querySelector(".overflow-y-auto");
    const stages = [...p.querySelectorAll("p,span")].find((el) => /^(Stages|Parts) \(/.test(el.textContent ?? ""));
    const add = [...p.querySelectorAll("button")].find((b) => /^Add (stage|part)$/.test(b.textContent ?? ""));
    const pr = p.getBoundingClientRect();
    return {
      width: Math.round(pr.width),
      panelH: Math.round(pr.height),
      contentH: body ? body.scrollHeight : 0,
      viewportH: body ? body.clientHeight : 0,
      scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
      heading: stages?.textContent?.trim() ?? null,
      // Where the control the panel exists for sits, measured from the panel's top.
      addFromTop: add ? Math.round(add.getBoundingClientRect().top - pr.top) : null,
      addBelowFold: add ? add.getBoundingClientRect().top > pr.bottom : null,
      addDisabled: add ? add.disabled : null,
      missingChip: /isn’t published any more/.test(p.textContent ?? ""),
    };
  });
});

await browser.close();

if (panels && panels.length > 0) {
  console.log("\nthe settings panel, composing:");
  for (const p of panels) {
    console.log(
      `  ${p.width}px wide · body ${p.contentH}px in ${p.viewportH}px${p.scrolls ? " (SCROLLS)" : ""} · "${p.heading}" · Add at +${p.addFromTop}px${p.addDisabled ? " (disabled)" : ""}`,
    );
  }
  const overCap = panels.find((p) => /\((\d+) of (\d+)\)/.test(p.heading ?? "") && (() => {
    const [, n, m] = p.heading.match(/\((\d+) of (\d+)\)/);
    return Number(n) > Number(m);
  })());
  if (overCap && !overCap.addDisabled) {
    console.log("✗ a panel over its cap still offers Add");
  }
  if (!panels.some((p) => p.missingChip)) {
    console.log("✗ the unpublished-part chip did not render — the specimen no longer covers it");
  }
}

if (!cards) {
  console.log("✗ no [data-composed] gallery on the page — did the specimen move?");
  process.exit(1);
}

const problems = [];
const say = (ok, line) => console.log(`${ok ? "✓" : "✗"} ${line}`);

for (const c of cards) {
  const refused = /Refused —/.test(c.title) || /Unconfigured/.test(c.title);
  const drew = c.bars > 0 || c.arcs > 0 || c.polys.length > 0;

  if (refused) {
    // A refusal REPLACES the mark. Anything drawn beside the sentence is the
    // half-chart failure this check exists for.
    if (drew) problems.push(`"${c.title}" refuses but still drew ${c.bars} bars / ${c.arcs} arcs`);
    // And it has to actually say something.
    if (c.text.length < 20) problems.push(`"${c.title}" refuses with no sentence on the card`);
    say(!drew && c.text.length >= 20, `${c.title} — refuses, mark replaced`);
  } else {
    if (!drew) problems.push(`"${c.title}" should draw but painted nothing`);
    say(drew, `${c.title} — draws (${c.bars} bars, ${c.arcs} arcs, ${c.polyCount} segments)`);
  }

  /**
   * NO PROSE ON A CARD THAT DRAWS — the owner's rule, 11 Sep 2026, and the one
   * that needs a check of its own because it is the easiest to undo by accident.
   * Every future caveat will arrive as "just one short line"; three of them is
   * what the pipeline screenshot already was.
   *
   * A REFUSAL IS NOT PROSE. When a composition cannot honestly draw, the
   * sentence IS the content — it replaces the mark rather than sitting under it —
   * so this only judges cards that painted something.
   */
  if (drew) {
    const sentences = (c.text.match(/[^.]{25,}?\./g) ?? []).filter(
      (s) => !/^\s*\d/.test(s) && / (is|are|not|assumed|counted|dated) /.test(s),
    );
    for (const s of sentences) problems.push(`"${c.title}" prints prose on a drawing card: "${s.trim().slice(0, 60)}…"`);
  }

  if (c.overflow) problems.push(`"${c.title}" paints outside its card`);
  if (c.w === 0 || c.h === 0) problems.push(`"${c.title}" has a zero-sized card`);
  for (const t of c.clipped) problems.push(`"${c.title}" cuts off the text "${t}…"`);
}

// The specific claims, by name.
const byTitle = (s) => cards.find((c) => c.title.includes(s));

const widens = byTitle("widens");
if (widens) {
  /**
   * A RISING STAGE STEPS, IT DOES NOT FLARE — the assertion that replaces "it
   * carries a cut edge", and then replaces the first version of its own
   * replacement.
   *
   * Capping was the original lie: a stage at 340% drew exactly as long as one at
   * 100%. Share-of-max removed it. Then the connected body reintroduced it
   * geometrically — an unconditional taper gave a narrow stage a bottom edge as
   * wide as the wide stage under it, so a 31%-wide stage ended its band at 100%.
   * A stage's floor may never exceed its own top.
   */
  const flares = widens.polyGeom.filter((g) => g.floor > g.top + 0.5);
  if (flares.length) problems.push(`a rising stage flares outward again (${JSON.stringify(flares)})`);
  say(!flares.length, "a rising stage steps rather than flaring outward");

  const widest = Math.max(...widens.polys);
  const ok = widens.polys.indexOf(widest) > 0;
  if (!ok) problems.push(`the widening funnel's widest segment is not the risen stage (${widens.polys.join(", ")})`);
  say(ok, `a stage bigger than the first is the widest segment (${widens.polys.join(", ")})`);

  const apology = /capped|cut off|larger than the first/.test(widens.notes);
  if (apology) problems.push("the cap apology outlived the cap");
  say(!apology, "…and nothing apologises for a clip that no longer happens");
}

const zeroTail = byTitle("last stage is zero");
if (zeroTail) {
  /**
   * A ZERO STAGE IS NOT A POLYGON AT ALL any more. Its shape was degenerate —
   * the point the body comes to — so the band rendered blank, and when that
   * stage is also the bottleneck there was nothing for the danger colour to
   * fill. It is a dashed rule on the band's own axis now: present, empty, and
   * without the manufactured width the 4% floor used to invent.
   */
  const ok = zeroTail.polys.length === 3 && zeroTail.zeroMarks === 1;
  if (!ok) {
    problems.push(
      `a zero-tailed funnel drew ${zeroTail.polys.length} segments and ${zeroTail.zeroMarks} zero marks; expected 3 and 1`,
    );
  }
  say(ok, `a zero stage is a dashed rule, not a segment (${zeroTail.polys.join(", ")} + ${zeroTail.zeroMarks} mark)`);
}

const owner = byTitle("owner's tile —");
if (owner) {
  /**
   * THE OWNER'S OWN TILE, RUNNING DOWN. 12 -> 39 -> 0 used to draw two
   * pixel-identical full-width slabs and a floating stub. Stage 1 must now be
   * visibly narrow, step out to a wider stage 2, and the zero stage must be a
   * dashed rule rather than a segment.
   */
  const [a, b] = owner.polys;
  const stepped = a != null && b != null && b > a * 2;
  const pinched = owner.polys.length === 2 && owner.zeroMarks === 1;
  if (!stepped) problems.push(`the owner's tile does not step out (${owner.polys.join(", ")})`);
  if (!pinched) problems.push(`the owner's zero stage is not a dashed rule (${owner.polys.length} segments, ${owner.zeroMarks} marks)`);
  say(stepped && pinched, `the owner's tile steps out and pinches to nothing (${owner.polys.join(", ")} + ${owner.zeroMarks} mark)`);
}

const across = byTitle("left to right");
if (across) {
  /**
   * THE SAME GEOMETRY, TRANSPOSED. Running across, HEIGHT carries the count, so
   * the measured axis flips — and the stages must still step and pinch exactly
   * as they do running down. If this reports zeroes the transpose has silently
   * collapsed the shape.
   */
  const drew = across.polys.filter((w) => w > 0.5).length;
  const ok = drew >= 2;
  if (!ok) problems.push(`the across flow drew no measurable segments (${across.polys.join(", ")})`);
  say(ok, `the across flow measures on its own axis (${across.polys.join(", ")})`);
}

console.log(
  problems.length === 0
    ? `\n✓ ${cards.length} composed specimens: no prose on a drawing card, every refusal replaces its mark, every disclosure reachable`
    : `\n✗ ${problems.length} problem(s):\n  ` + problems.join("\n  "),
);
process.exit(problems.length === 0 ? 0 : 1);
