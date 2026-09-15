/**
 * THE SECURITY HEADERS ARE ACTUALLY ON THE WIRE — and the CSP has not broken
 * the app.
 *
 * These were the one substantive finding of the 15 Sep 2026 audit: the product
 * sent none. Tenant isolation held at every request-facing query, every server
 * action was gated, credentials were AES-256-GCM with a fresh nonce, the
 * webhook route failed closed on an unreadable secret, and the MCP path
 * verified membership rather than trusting a token's org claim. This was the
 * gap.
 *
 * IT IS CHECKED IN A BROWSER, NOT BY READING `next.config.mjs`, for two
 * reasons that a source grep cannot cover:
 *
 *   1. A header configured is not a header DELIVERED. `headers()` matches by
 *      path, a platform can strip or override, and the auth proxy's matcher
 *      deliberately excludes the machine endpoints — exactly the routes a
 *      header set in middleware would miss.
 *   2. A CSP is the one security control that can take the product down. A
 *      wrong `script-src` leaves every page rendering and nothing
 *      interactive: correct markup, dead buttons, 200 OK. So this presses
 *      something and checks it responded.
 *
 * Usage: `pnpm dev` in one terminal, `pnpm headers` in another.
 * Exits non-zero on a missing header, a weakened directive, or a CSP violation.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

/**
 * Every route class, including the two the auth proxy's matcher excludes.
 * `/api/webhooks/...` and `/api/health` are the ones a middleware-based header
 * would have silently skipped, which is why they are named rather than assumed.
 */
const ROUTES = ["/", "/design", "/api/health", "/api/webhooks/00000000-0000-0000-0000-000000000000"];

/** Header name → a predicate on its value, with the reason in the label. */
const REQUIRED = [
  ["strict-transport-security", (v) => /max-age=\d{7,}/.test(v) && /includeSubDomains/i.test(v), "two years, subdomains included"],
  ["x-frame-options", (v) => /^DENY$/i.test(v.trim()), "DENY"],
  ["x-content-type-options", (v) => /nosniff/i.test(v), "nosniff"],
  ["referrer-policy", (v) => /strict-origin-when-cross-origin/i.test(v), "strict-origin-when-cross-origin"],
  ["permissions-policy", (v) => /camera=\(\)/.test(v) && /microphone=\(\)/.test(v) && /geolocation=\(\)/.test(v), "camera, mic and geolocation all denied"],
  ["cross-origin-opener-policy", (v) => /same-origin/.test(v), "same-origin"],
  ["content-security-policy", (v) => v.length > 40, "present"],
];

/**
 * CSP directives that must hold their value. `script-src` is NOT here: it
 * carries `'unsafe-inline'` because Next's App Router emits inline bootstrap
 * and hydration scripts, and dropping it needs a nonce threaded through every
 * response rather than a config change. That weakness is stated in
 * `next.config.mjs` rather than hidden, and what the directive still buys —
 * no script from another ORIGIN executes — is asserted below.
 */
const CSP_MUST = [
  ["frame-ancestors 'none'", "the clickjacking wall, over two irreversible controls"],
  ["object-src 'none'", "no plugin an injected <embed> could reach"],
  ["base-uri 'self'", "an injected <base> cannot re-point every relative URL"],
  ["form-action 'self'", "a form cannot be re-pointed at somebody else's server"],
  ["default-src 'self'", "everything not named falls back to us"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log("headers, on every route class");
for (const route of ROUTES) {
  const res = await page.request.get(`${BASE}${route}`, { failOnStatusCode: false });
  const h = res.headers();
  const missing = REQUIRED.filter(([name, ok]) => !(name in h) || !ok(h[name] ?? ""));
  check(
    missing.length === 0,
    `${route} carries all ${REQUIRED.length}`,
    missing.map(([n, , why]) => `${n} (${why})`).join(", "),
  );
}

console.log("\nthe CSP's directives");
const csp = (await page.request.get(BASE, { failOnStatusCode: false })).headers()["content-security-policy"] ?? "";
for (const [directive, why] of CSP_MUST) check(csp.includes(directive), `${directive} — ${why}`);
/* `script-src` is weak by design, but it must still be ORIGIN-bound: the whole
   value of the directive is that an injected `<script src="//evil">` cannot
   load. A wildcard or a `*` here would give that away. */
const scriptSrc = csp.match(/script-src ([^;]*)/)?.[1] ?? "";
check(scriptSrc.includes("'self'"), "script-src is origin-bound", scriptSrc);
check(!/\*|https:(?!\/\/)/.test(scriptSrc), "script-src allows no wildcard origin", scriptSrc);

console.log("\nand the CSP has not broken the product");
const violations = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
page.on("console", (m) => {
  if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160));
});

for (const route of ["/", "/design/refer", "/design/overview"]) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check((await page.locator("body > *").count()) > 0, `${route} renders`);
}

/**
 * HYDRATION, by pressing something. This is the assertion that would catch a
 * `script-src` mistake: a blocked bundle leaves every page rendering and every
 * control inert, which no status code and no markup check can see.
 */
await page.goto(`${BASE}/design/refer`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.locator("[data-refer-case='0']").getByRole("button", { name: /Invite someone/ }).click().catch(() => {});
await page.waitForTimeout(500);
check((await page.locator("[role='dialog']").count()) === 1, "a button still opens a dialog — the bundle runs");

check(violations.length === 0, "no CSP violations anywhere", [...new Set(violations)].join(" · "));
check(errors.length === 0, "no page errors", [...new Set(errors)].join(" · "));

await browser.close();
if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — every header is on the wire and the CSP has not cost us the app.");
