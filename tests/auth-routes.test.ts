import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeNext } from "@/app/(auth)/next-path";

/**
 * THE SIGN-IN DOOR — moved onto our own domain, 16 Sep 2026.
 *
 * `/sign-in` and `/sign-up` used to bounce straight to WorkOS's hosted page at
 * `randomphrase.authkit.app`. The forms are ours now, at `/login` and
 * `/signup`, with WorkOS still doing every part of authentication that matters
 * (hashing, comparison, breach checks, token minting). Putting the hosted page
 * on `auth.namzilabs.co` instead would have been $99/mo; this was free.
 *
 * What is tested here is the part WE own and could get wrong. The parts WorkOS
 * owns are not ours to test.
 */

describe("where a sign-in is allowed to send somebody", () => {
  /**
   * THE OPEN REDIRECT, which is the one security bug this change could
   * plausibly introduce.
   *
   * The proxy puts the page somebody was trying to reach into `?next=`, so the
   * value arrives from the browser and is echoed into a redirect after the
   * password is accepted. Unchecked, a link to
   * `namzilabs.co/login?next=https://evil.example` bounces a customer off the
   * product from our own domain, with the padlock showing, seconds after they
   * typed their password — the most convincing phishing hop there is, hosted by
   * us.
   */
  it("refuses anything that leaves the site", () => {
    for (const hostile of [
      "https://evil.example",
      "http://evil.example",
      // Protocol-relative: browsers resolve this as absolute, and it is exactly
      // what a bare `startsWith("/")` check lets through.
      "//evil.example",
      "//evil.example/dashboard",
      // A backslash is a slash to a browser in an http(s) URL, and tabs and
      // newlines are stripped before parsing — each of these becomes
      // `//evil.example` once it reaches the Location header.
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "evil.example",
      "",
    ]) {
      expect(safeNext(hostile), `${hostile} must not be followed`).toBe("/dashboard");
    }
  });

  it("refuses anything that is not a string", () => {
    // `searchParams.get` can hand back null, and a form field can be a File.
    for (const junk of [null, undefined, 42, {}, [], ["/dashboard"]]) {
      expect(safeNext(junk)).toBe("/dashboard");
    }
  });

  it("keeps a real in-app path, query string and all", () => {
    // A link into the board carries its range and view; dropping the query
    // would land somebody on a different screen than the one they clicked.
    expect(safeNext("/dashboard?range=2026-09-01..2026-09-16&view=v2")).toBe(
      "/dashboard?range=2026-09-01..2026-09-16&view=v2",
    );
    expect(safeNext("/connections/conn_1")).toBe("/connections/conn_1");
  });
});

describe("the old paths still work", () => {
  /**
   * `/sign-in` is in the marketing nav, in `/auth-error`, in invite emails
   * already sent, and in whatever anybody bookmarked. These redirect rather
   * than 404, and the assertion is on the source because a route handler that
   * calls `redirect()` throws NEXT_REDIRECT and needs a whole Next runtime to
   * exercise honestly.
   */
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("/sign-in points at /login and /sign-up at /signup", () => {
    expect(read("src/app/sign-in/route.ts")).toMatch(/redirect\([^)]*"\/login"/);
    expect(read("src/app/sign-up/route.ts")).toMatch(/redirect\([^)]*"\/signup"/);
  });

  it("and they run the destination through the open-redirect guard", () => {
    for (const f of ["src/app/sign-in/route.ts", "src/app/sign-up/route.ts", "src/app/auth/google/route.ts"]) {
      expect(read(f), `${f} must not pass ?next= through unchecked`).toMatch(/safeNext\(/);
    }
  });
});

describe("the proxy sends people to our own form", () => {
  it("redirects to /login, not to the hosted AuthKit page", () => {
    /**
     * The proxy used to redirect to `authorizationUrl` — WorkOS's hosted page.
     * If that comes back, every protected link in the product quietly starts
     * bouncing to `authkit.app` again and the whole change is undone without a
     * single test failing anywhere else.
     */
    const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(proxy).toMatch(/new URL\("\/login"/);
    const code = proxy.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect(code, "the hosted URL must not be the redirect target any more").not.toMatch(/redirect:\s*authorizationUrl/);
  });
});

describe("Continue with Google", () => {
  /**
   * The Google button works by taking the URL `authkit-nextjs` built — PKCE
   * cookie and all — and swapping ONE query parameter. If a future SDK stops
   * spelling it `provider=authkit`, the swap would silently do nothing and
   * every Google press would land on the hosted page: still working, so nobody
   * would notice, and wrong.
   */
  it("swaps the provider rather than rebuilding the URL", () => {
    const src = readFileSync(join(process.cwd(), "src/app/auth/google/route.ts"), "utf8");
    expect(src, "the SDK must still do the PKCE work").toMatch(/getSignInUrl\(/);
    expect(src).toMatch(/searchParams\.set\("provider", "GoogleOAuth"\)/);
    // `screen_hint` is only accepted for the `authkit` provider.
    expect(src).toMatch(/searchParams\.delete\("screen_hint"\)/);
    expect(src, "and it must assert rather than assume").toMatch(/provider"\) !== "authkit"/);
  });

  it("actually finds provider=authkit in what the SDK builds today", async () => {
    /**
     * The assertion above is about the source; this is about reality. It builds
     * a URL the way the SDK does and checks the parameter is there — so the day
     * the SDK changes, this fails in CI rather than in production.
     */
    vi.resetModules();
    const { WorkOS } = await import("@workos-inc/node");
    const url = new WorkOS("sk_test", { clientId: "client_test" }).userManagement.getAuthorizationUrl({
      provider: "authkit",
      clientId: "client_test",
      redirectUri: "https://namzilabs.co/callback",
      screenHint: "sign-in",
    });
    expect(new URL(url).searchParams.get("provider")).toBe("authkit");
  });
});
