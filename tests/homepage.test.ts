import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Logged-out session. Crucially, the homepage must NOT call the PKCE URL
// functions during render (that was the 500 cause) — it only reads `user`.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn(async () => ({ user: null })),
}));
// Render next/link as a plain anchor so we can render without the Next runtime.
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));

// next/font is a build-time transform with no runtime outside Next, so the
// landing page's two faces are stubbed the same way next/link is above. The
// page only ever reads `.variable` off them, which is the class name that
// carries the CSS custom property.
//
// BOTH ENTRY POINTS, because the two faces no longer come from one: Switzer
// is self-hosted through `next/font/local` (a DEFAULT export, so the stub has
// to be one too) and Instrument Serif still comes from Google. Stubbing only
// the Google one left `localFont` undefined and the failure read "default is
// not a function" at the top of page.tsx — which says nothing about fonts.
vi.mock("next/font/google", () => ({
  Instrument_Serif: () => ({ variable: "snap-serif", className: "snap-serif" }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "snap-sans", className: "snap-sans" }),
}));

import Home from "@/app/page";

describe("homepage (logged out)", () => {
  /**
   * The invariant is that a logged-out visitor is offered a way to SIGN UP
   * and a way to LOG IN, and is never handed a dashboard link they cannot
   * use — that last one is what caused a 500 once, when the page called the
   * PKCE URL helpers during render instead of only reading `user`.
   *
   * It used to assert `/sign-in` specifically, because that was the path the
   * marketing nav happened to use. The nav now links `/login` directly rather
   * than through the redirect, which is one hop fewer for a real person;
   * `/sign-in` still redirects for old invite emails and bookmarks, and
   * tests/auth-routes.test.ts is what guarantees that, independently of which
   * path this page chooses today. The same is now true of the sign-up pair:
   * the buttons go to `/signup`, where the form actually lives, and `/sign-up`
   * still redirects there — so this accepts either rather than pinning the
   * page to the spelling it happens to use this week.
   */
  it("offers sign-up and log-in, and no dashboard link", async () => {
    const element = await Home();
    const html = renderToStaticMarkup(element);
    expect(html).toMatch(/href="\/sign-?up"/);
    expect(html).toMatch(/href="\/(login|sign-in)"/);
    expect(html).not.toContain('href="/dashboard"');
  });

  /**
   * THE SECOND DOOR IS PART OF THE INVARIANT NOW, and it is the one that can
   * disappear without anything else noticing: `/auth/google` is a route
   * handler, so a button that stops pointing at it still renders, still looks
   * right, and simply stops being a Google sign-up. The page offers both ways
   * to start or it is not doing its job.
   */
  it("offers the Google door as well as the email one", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/auth/google"');
  });

  /**
   * A signed-in reader is offered NEITHER. `Start free` is a false statement
   * to somebody who already has an account, and both links would walk them
   * through sign-up to arrive back where they started.
   */
  it("offers a signed-in reader their dashboard instead of a sign-up", async () => {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    vi.mocked(withAuth).mockResolvedValueOnce({ user: { id: "user_1" } } as never);

    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain("Start free with");
    expect(html).not.toContain('href="/auth/google"');
  });
});
