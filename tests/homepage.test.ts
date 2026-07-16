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

import Home from "@/app/page";

describe("homepage (logged out)", () => {
  it("renders and links to /sign-in and /sign-up (no dashboard link)", async () => {
    const element = await Home();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('href="/sign-up"');
    expect(html).not.toContain('href="/admin"');
  });
});
