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
vi.mock("next/font/google", () => ({
  Figtree: () => ({ variable: "snap-sans", className: "snap-sans" }),
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
   * path this page chooses today.
   */
  it("offers sign-up and log-in, and no dashboard link", async () => {
    const element = await Home();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/sign-up"');
    expect(html).toMatch(/href="\/(login|sign-in)"/);
    expect(html).not.toContain('href="/dashboard"');
  });
});
