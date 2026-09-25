/**
 * WHERE TO LAND AFTER SIGNING IN, VALIDATED RATHER THAN TRUSTED.
 *
 * The proxy puts the page somebody was trying to reach into `?next=`, so this
 * value arrives from the browser. Echoed into a redirect unchecked it is an
 * open redirect: a link to `namzilabs.co/login?next=https://evil.example` sends
 * a freshly authenticated customer straight off the product — from our own
 * domain, with the padlock showing, moments after they typed their password.
 * That is the single most convincing phishing hop there is, and we would be
 * hosting it.
 *
 * The rule is one leading slash and no second one. `//evil.example` is a
 * protocol-relative URL that browsers resolve as absolute, and it is exactly
 * the form a naive `startsWith("/")` check lets through — which is why it has
 * its own clause rather than being folded into the first.
 *
 * ═══ WHY THIS IS NOT IN `actions.ts` ═══
 *
 * It lived there until it did not compile. A `"use server"` module may only
 * export async functions — every export becomes a callable server endpoint —
 * and this is a pure synchronous string check. Worth having as its own file
 * anyway: the route handlers need it too, and a security rule with one home is
 * a security rule that cannot drift into two versions.
 */
export function safeNext(next: unknown): string {
  const raw = typeof next === "string" ? next : "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  /**
   * NO BACKSLASH AND NO CONTROL CHARACTER, ANYWHERE. A browser reads `\` as
   * `/` in an http(s) URL and strips tabs and newlines before parsing, so
   * `/\evil.example` and `/<tab>/evil.example` both arrive as `//evil.example`
   * — the protocol-relative hop the clause above exists to stop. No path in
   * this app contains either.
   */
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return "/dashboard";
  return raw;
}
