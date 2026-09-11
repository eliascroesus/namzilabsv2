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
    const bars = [...(card?.querySelectorAll("div[style*='width']") ?? [])].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && /%$/.test(el.style.width);
    });
    const arcs = [...(card?.querySelectorAll("path, circle") ?? [])].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    const cut = [...(card?.querySelectorAll("[title]") ?? [])]
      .map((el) => el.getAttribute("title"))
      .filter((t) => t && /cut off/.test(t));
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
      cut: cut.length,
      overflow,
      clipped,
      text,
      w: Math.round(box.width),
      h: Math.round(box.height),
    };
  });
});

await browser.close();

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

  if (c.overflow) problems.push(`"${c.title}" paints outside its card`);
  if (c.w === 0 || c.h === 0) problems.push(`"${c.title}" has a zero-sized card`);
  for (const t of c.clipped) problems.push(`"${c.title}" cuts off the text "${t}…"`);
}

// The specific claims, by name.
const byTitle = (s) => cards.find((c) => c.title.includes(s));

const widens = byTitle("widens");
if (widens) {
  const ok = widens.cut > 0;
  if (!ok) problems.push("the widening funnel drew no cut edge — an over-long bar is clipping flush again");
  say(ok, `a stage wider than the first carries a cut edge (${widens.cut})`);
  const named = /larger than the first stage/.test(widens.text);
  if (!named) problems.push("the widening funnel never names the stage in prose");
  say(named, "…and the tile names it in words");
}

const funnel = byTitle("Composed funnel —") ?? byTitle("Composed funnel");
if (funnel) {
  const ok = /not followed as a cohort/.test(funnel.text);
  if (!ok) problems.push("the cohort caveat is missing from a composed funnel");
  say(ok, "a composed funnel always discloses it is not a cohort");
}

const pie = byTitle("residual");
if (pie) {
  const ok = /assumed not to overlap/.test(pie.text);
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
    ? `\n✓ ${cards.length} composed specimens: every refusal replaces its mark, every disclosure is on the card`
    : `\n✗ ${problems.length} problem(s):\n  ` + problems.join("\n  "),
);
process.exit(problems.length === 0 ? 0 : 1);
