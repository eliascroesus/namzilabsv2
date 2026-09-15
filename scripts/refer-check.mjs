/**
 * THE REFERRAL SURFACES, DRIVEN.
 *
 * `tests/referral.test.ts` holds every RULE — the code, the four guards on an
 * attribution, the ladder's shape, the arithmetic of the bar. None of that
 * tells you whether the bar has a width on the screen or whether the invite
 * button opens anything, and this feature is a progress bar whose width is
 * computed inside a modal that has to open. Those are the two things that can
 * be perfectly correct in the source and absent in the browser.
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/design/refer`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

// ── the bar ──────────────────────────────────────────────────────────────────
console.log("\nthe progress bar");
const bars = await page.evaluate(() =>
  [...document.querySelectorAll("[data-refer-case]")].map((card) => {
    const fill = card.querySelector("[data-refer-fill]");
    const trough = fill?.parentElement;
    return {
      count: Number(card.getAttribute("data-refer-case")),
      shown: card.querySelector("[data-refer-count]")?.textContent?.trim(),
      valuenow: trough?.getAttribute("aria-valuenow"),
      // The RENDERED width as a fraction of the trough — not the style string,
      // because a `width: 50%` inside a zero-width trough is still nothing.
      ratio: fill && trough ? fill.getBoundingClientRect().width / trough.getBoundingClientRect().width : null,
      troughWidth: trough ? Math.round(trough.getBoundingClientRect().width) : 0,
    };
  }),
);
check(bars.length === 4, "all four counts rendered", `${bars.length} found`);

const at = (n) => bars.find((b) => b.count === n);

check(at(0)?.shown === "0", "a zero is drawn, not hidden", at(0)?.shown);
check(at(0)?.troughWidth > 200, "the trough has a real width", `${at(0)?.troughWidth}px`);
check(at(0)?.ratio === 0, "nothing earned draws an empty bar", String(at(0)?.ratio));

/**
 * TWO INVITES IS HALF THE CURRENT RUNG (1 -> 3), not 8% of the whole ladder.
 * That is the one arithmetic decision in this feature a person would actually
 * feel, and it is measured here in pixels rather than trusted from the style
 * attribute.
 */
const two = at(2);
check(two?.valuenow === "50", "two invites reports 50% to the accessibility tree", two?.valuenow);
check(
  two && Math.abs(two.ratio - 0.5) < 0.02,
  "and paints half the trough",
  two ? `${(two.ratio * 100).toFixed(1)}%` : "missing",
);

/* A count that has just reached a rung starts the NEXT run — the bar resets to
   the floor, and the page's `Math.max(…, 6)` keeps that visible rather than
   showing an empty trough to somebody who just earned something. */
const three = at(3);
check(three?.valuenow === "0", "a freshly earned rung restarts the bar", three?.valuenow);
check(three && three.ratio > 0.02 && three.ratio < 0.12, "with a visible sliver, not an empty trough", three ? `${(three.ratio * 100).toFixed(1)}%` : "missing");

/* The finished ladder must not divide by zero or paint a bar to nowhere. */
check(at(25)?.ratio === null, "a finished ladder draws no bar at all");

// ── the invite modal ─────────────────────────────────────────────────────────
console.log("\nthe invite choice");
check((await page.locator("[role='dialog']").count()) === 0, "no dialog before it is pressed");
await page.locator("[data-refer-invite]").getByRole("button", { name: /Invite someone/ }).click();
await page.waitForTimeout(400);
const dialog = page.locator("[role='dialog']");
check((await dialog.count()) === 1, "pressing Invite opens one dialog");
if (await dialog.count()) {
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  check(/Who are you inviting\?/.test(text), "it asks which KIND of invite");
  /**
   * BOTH CHOICES, and the reason this is asserted rather than assumed: one of
   * them shares your numbers and costs a seat, the other sends somebody to
   * build their own. A dialog that lost one of the two is a dialog that
   * silently picked for you.
   */
  check(/start using Namzilabs/i.test(text), "offers the referral");
  check(/into this workspace/i.test(text), "offers the workspace invite");
  check(/r\/ABC12345/.test(text), "and shows the real link", text.slice(0, 140));
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
console.log("\nPASS — the bar fills and the invite asks which kind.");
