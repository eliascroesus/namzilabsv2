/**
 * THE INVITE BOARD, DRIVEN.
 *
 * `tests/referral.test.ts` holds every RULE — the code, the four guards on an
 * attribution, the ladder's shape, the arithmetic. None of that tells you
 * whether the bar can be SEEN, and that is precisely how the first version
 * shipped: the maths was right, every test was green, and the trough was
 * `--background` on a 10% brand tint — about 1.1:1 apart — with no fill at all
 * at zero invites. The owner's report was "where is the progress bar".
 *
 * So this measures the two things a source check cannot: the track's own
 * contrast against the card it sits on, and the fill's width in pixels.
 *
 * Usage: `pnpm dev` in one terminal, `pnpm refer` in another.
 * SHOT_BASE overrides http://localhost:3000. Exits non-zero on any failure.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

/** WCAG 2.x relative luminance and contrast, from sRGB triples. */
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/design/refer`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

// ── the track ────────────────────────────────────────────────────────────────
console.log("\nthe progress track");
const boards = await page.evaluate(() =>
  [...document.querySelectorAll("[data-refer-case]")].map((sec) => {
    const track = sec.querySelector("[data-refer-track]");
    const fill = sec.querySelector("[data-refer-fill]");
    const t = track?.getBoundingClientRect();
    const f = fill?.getBoundingClientRect();
    return {
      count: Number(sec.getAttribute("data-refer-case")),
      valuenow: track?.getAttribute("aria-valuenow"),
      trackW: t ? Math.round(t.width) : 0,
      trackH: t ? Math.round(t.height) : 0,
      ratio: t && f && t.width ? f.width / t.width : null,
      pips: sec.querySelectorAll("[data-refer-pip]").length,
      done: sec.querySelectorAll("[data-refer-pip].bg-white").length,
    };
  }),
);
check(boards.length === 4, "all four counts rendered the real board", `${boards.length} found`);
const at = (n) => boards.find((b) => b.count === n);

check(at(0)?.trackW > 400, "the track is a real width", `${at(0)?.trackW}px`);
check(at(0)?.trackH >= 16, "and tall enough to read as a bar", `${at(0)?.trackH}px`);
check(at(0)?.pips === 5, "every rung is pinned to the track itself", `${at(0)?.pips} pips`);

/**
 * THE BAR MUST BE VISIBLE AGAINST ITS OWN TROUGH. This is the assertion the
 * first version of the board would have failed: a trough at 1.1:1 against what
 * was behind it is a bar you cannot find, whatever its width says. 3:1 is the
 * bar for a non-text object under WCAG 1.4.11.
 *
 * SAMPLED FROM PAINTED PIXELS, NOT FROM `getComputedStyle`. The first attempt
 * read `backgroundColor` and parsed it as rgb — and Tailwind's opacity
 * modifiers resolve to `oklab(… / .35)`, whose numbers are not channels. It
 * reported a healthy ratio for a trough deliberately set to `bg-white/85`
 * against a white fill: a measurement that does not respond to the fix is
 * measuring something else. Exactly the same trap as `landing-check`'s, in a
 * second file, which is what makes it worth this much prose.
 *
 * Taken off the TWO-INVITE board, the only one with both a filled and an empty
 * stretch, at 10% (filled) and 50% (empty — clear of the pips at 40 and 60).
 */
const shot = (await page.screenshot({ fullPage: true })).toString("base64");
const sampled = await page.evaluate(
  async (b64) =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const track = document.querySelector("[data-refer-case='2'] [data-refer-track]");
        const r = track.getBoundingClientRect();
        const k = img.width / innerWidth;
        const px = (fx) => {
          const d = g.getImageData(Math.round((r.left + r.width * fx) * k), Math.round((r.top + r.height / 2 + scrollY) * k), 1, 1).data;
          return [d[0], d[1], d[2]];
        };
        res({ fill: px(0.1), trough: px(0.5) });
      };
      img.src = `data:image/png;base64,${b64}`;
    }),
  shot,
);
const trackVsFill = ratio(sampled.fill, sampled.trough);
check(
  trackVsFill >= 3,
  "the fill stands out against the trough",
  `${trackVsFill.toFixed(2)}:1 — fill rgb(${sampled.fill}) on trough rgb(${sampled.trough})`,
);

/**
 * EVERY RUNG IS AN EQUAL FIFTH OF THE TRACK. Laid out to scale, 1/3/5/10/25
 * would crowd the first four rungs into the left sixth and give the run to 25
 * two-thirds of the bar — the early wins that matter most would be invisible.
 */
check(at(0)?.valuenow === "0", "nothing yet reads as zero", at(0)?.valuenow);
check(at(0)?.ratio === 0, "and paints nothing");
// Two invites: past rung one (1/5 of the track) and halfway through the 1→3
// gap, so 1.5 fifths = 30%.
check(at(2)?.valuenow === "30", "two invites is 30% of the ladder", at(2)?.valuenow);
check(at(2) && Math.abs(at(2).ratio - 0.3) < 0.02, "and paints it", at(2) ? `${(at(2).ratio * 100).toFixed(1)}%` : "—");
/* CROSSING A RUNG MOVES THE BAR FORWARD, never backwards. The rung-local
   reading resets to zero the moment you earn something, which is correct about
   the next gap and a terrible thing to watch right after an achievement. */
check(at(3)?.valuenow === "40", "earning a rung advances the bar rather than resetting it", at(3)?.valuenow);
check(at(3) && at(3).ratio > at(2).ratio, "strictly further than the count below it");
check(at(25)?.valuenow === "100", "a finished ladder is full", at(25)?.valuenow);
check(at(25)?.done === 5, "with every pip marked done", `${at(25)?.done}/5`);

// ── no prose ─────────────────────────────────────────────────────────────────
console.log("\nthe board carries no description text");
const prose = await page.evaluate(() => {
  const sec = document.querySelector("[data-refer-case='0']");
  return (sec?.innerText ?? "").replace(/\s+/g, " ");
});
for (const gone of ["Counting is automatic", "remembered for 90 days", "Takes about ten seconds"]) {
  check(!prose.includes(gone), `"${gone}" is off the surface`);
}

// ── the invite modal ─────────────────────────────────────────────────────────
console.log("\nthe invite choice");
check((await page.locator("[role='dialog']").count()) === 0, "no dialog before it is pressed");
await page.locator("[data-refer-case='0']").getByRole("button", { name: /Invite someone/ }).click();
await page.waitForTimeout(400);
const dialog = page.locator("[role='dialog']");
check((await dialog.count()) === 1, "pressing Invite opens one dialog");
if (await dialog.count()) {
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  check(/Who are you inviting\?/.test(text), "it asks which KIND of invite");
  /**
   * BOTH CHOICES, and the reason this is asserted rather than assumed: one
   * shares your numbers and costs a seat, the other sends somebody to build
   * their own. A dialog that lost one of the two is a dialog that picked for
   * you.
   */
  check(/start using Namzilabs/i.test(text), "offers the referral");
  check(/into this workspace/i.test(text), "offers the workspace invite");
  check(/r\/ABC12345/.test(text), "and shows the real link", text.slice(0, 140));
  // The descriptions under each option came off; the pictures carry it.
  check(!/They see these metrics/.test(text), "and carries no description under the options");
}
await page.keyboard.press("Escape");
await page.waitForTimeout(350);
check((await page.locator("[role='dialog']").count()) === 0, "Escape closes it");

check(errors.length === 0, "no page errors", errors.join(" · "));

await browser.close();
if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — the track is visible, fills forward, and the invite asks which kind.");
