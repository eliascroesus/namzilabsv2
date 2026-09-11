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
     * A BAR IS FILLED; A LOSS FRAME IS NOT — and telling them apart is new.
     *
     * Both are now percentage-width boxes on a stage row, so "count the
     * percentage-width divs" started counting six things for a four-stage
     * funnel: three bars plus the outlined rectangles that draw what each stage
     * LOST. The fill is the mark; the frame is the absence of one, which is
     * exactly the distinction the redesign is built on, so the check has to make
     * it too.
     */
    const bars = [...(card?.querySelectorAll("div[style*='width']") ?? [])].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && /%$/.test(el.style.width))) return false;
      const cls = (el.className || "").toString();
      return !!el.style.background || /bg-(marker|danger|brand)/.test(cls);
    });
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
      barPx,
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
  const drew = c.bars > 0 || c.arcs > 0;

  if (refused) {
    // A refusal REPLACES the mark. Anything drawn beside the sentence is the
    // half-chart failure this check exists for.
    if (drew) problems.push(`"${c.title}" refuses but still drew ${c.bars} bars / ${c.arcs} arcs`);
    // And it has to actually say something.
    if (c.text.length < 20) problems.push(`"${c.title}" refuses with no sentence on the card`);
    say(!drew && c.text.length >= 20, `${c.title} — refuses, mark replaced`);
  } else {
    if (!drew) problems.push(`"${c.title}" should draw but painted nothing`);
    say(drew, `${c.title} — draws (${c.bars} bars, ${c.arcs} arcs)`);
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
   * THE RISING STAGE IS THE LONGEST BAR — the assertion that replaces "it
   * carries a cut edge".
   *
   * The old mark measured against the FIRST stage and clamped at 100, so a
   * stage at 340% drew exactly as long as one at 100% and the only thing
   * telling the reader otherwise was a dashed border plus a sentence. Under
   * share-of-max there is nothing to clip: the risen stage simply IS the
   * longest, and a hairline notch marks where the stage above it ended.
   */
  const widest = Math.max(...widens.barPx);
  const ok = widens.barPx.indexOf(widest) > 0;
  if (!ok) problems.push(`the widening funnel's longest bar is not the risen stage (${widens.barPx.join(", ")}px)`);
  say(ok, `a stage bigger than the first draws the longest bar (${widens.barPx.join(", ")}px)`);
  const notched = widens.notches > 0;
  if (!notched) problems.push("the widening funnel drew no crossing mark where the stage above ended");
  say(notched, "…and a hairline marks where the stage above ended");
  const apology = /capped|cut off|larger than the first/.test(widens.notes);
  if (apology) problems.push("the cap apology outlived the cap");
  say(!apology, "…and nothing apologises for a clip that no longer happens");
}

const zeroTail = byTitle("last stage is zero");
if (zeroTail) {
  /**
   * A ZERO STAGE DRAWS NO BAR. The 4% floor manufactured ink for an empty set —
   * on the centred mark, a bullet floating under two slabs, clipped by the card.
   * The empty frame beside it is what carries the loss now.
   */
  const bars = zeroTail.barPx.length;
  const ok = bars === 3;
  if (!ok) problems.push(`a zero-tailed funnel drew ${bars} bars, expected 3 (the zero stage draws none)`);
  say(ok, `a zero stage draws no bar (${zeroTail.barPx.join(", ")}px for four stages)`);
}

const owner = byTitle("never narrows");
if (owner) {
  /**
   * THE OWNER'S OWN TILE, as the regression it caused. 12 -> 38 -> 0 used to draw
   * [100, 100, 4]: two pixel-identical full-width slabs and a stub. Stage 1 must
   * now be visibly SHORTER than stage 2, which is the truth about that data.
   */
  const [a, b] = owner.barPx;
  const ok = a != null && b != null && b > a * 2;
  if (!ok) problems.push(`the owner's tile still draws stage 1 and 2 alike (${owner.barPx.join(", ")}px)`);
  say(ok, `the owner's tile draws stage 1 short of stage 2 (${owner.barPx.join(", ")}px)`);
}

const funnel = byTitle("Composed funnel —") ?? byTitle("Composed funnel");
if (funnel) {
  const ok = /not followed as a cohort/.test(funnel.notes);
  if (!ok) problems.push("the cohort caveat is missing from a composed funnel");
  say(ok, "a composed funnel always discloses it is not a cohort");
}

const pie = byTitle("residual");
if (pie) {
  const ok = /assumed not to overlap/.test(pie.notes);
  if (!ok) problems.push("the pie never says its parts are assumed disjoint");
  say(ok, "a composed pie always discloses the MECE assumption");
  /**
   * COUNTED, NOT GREPPED — and that distinction is this check's own bug, caught
   * by running it. Asserting the word "Other" appears on the card passed for
   * both pies and failed for neither: the MECE disclosure is itself the
   * sentence `"Other" is Total Leads minus the named parts`, so the word is on
   * every composed pie whether or not a remainder was ever drawn. The arcs are
   * the claim; the prose is about the arcs.
   */
  const drewResidual = pie.arcs === 3;
  if (!drewResidual) problems.push(`the residual pie drew ${pie.arcs} arcs, expected 3 (two parts and the remainder)`);
  say(drewResidual, "…and the remainder is drawn as its own arc");
}

const exact = byTitle("tile exactly");
if (exact) {
  const ok = exact.arcs === 2;
  if (!ok) problems.push(`parts that tile the whole exactly drew ${exact.arcs} arcs, expected 2 and no remainder`);
  say(ok, "parts that tile exactly draw no remainder");
}

const duration = byTitle("duration");
if (duration) {
  const ok = /Speed to Lead/.test(duration.text);
  if (!ok) problems.push("the duration refusal does not name the offending metric");
  say(ok, "a refusal names the metric that caused it");
}

console.log(
  problems.length === 0
    ? `\n✓ ${cards.length} composed specimens: no prose on a drawing card, every refusal replaces its mark, every disclosure reachable`
    : `\n✗ ${problems.length} problem(s):\n  ` + problems.join("\n  "),
);
process.exit(problems.length === 0 ? 0 : 1);
