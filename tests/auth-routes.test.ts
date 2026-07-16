import { describe, it, expect, vi } from "vitest";

// getSignInUrl / getSignUpUrl return distinct WorkOS URLs; getSignUpUrl carries
// the sign-up screen hint.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getSignInUrl: vi.fn(async () => "https://auth.workos.com/authorize?client_id=x"),
  getSignUpUrl: vi.fn(async () => "https://auth.workos.com/authorize?client_id=x&screen_hint=sign-up"),
}));

// Capture the URL passed to redirect(); redirect() throws NEXT_REDIRECT in Next,
// so we mimic that (the route must not swallow it).
const hoisted = vi.hoisted(() => ({ url: null as unknown }));
vi.mock("next/navigation", () => ({
  redirect: (u: unknown) => {
    hoisted.url = u;
    throw new Error("NEXT_REDIRECT");
  },
}));

import { GET as signInGET } from "@/app/sign-in/route";
import { GET as signUpGET } from "@/app/sign-up/route";

describe("auth route handlers", () => {
  it("/sign-in redirects to the WorkOS sign-in URL", async () => {
    hoisted.url = null;
    await expect(signInGET()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(hoisted.url).toBe("https://auth.workos.com/authorize?client_id=x");
  });

  it("/sign-up redirects to the WorkOS sign-up URL (screen_hint=sign-up)", async () => {
    hoisted.url = null;
    await expect(signUpGET()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(String(hoisted.url)).toContain("screen_hint=sign-up");
  });
});
