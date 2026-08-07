import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

/**
 * WorkOS redirects here after authentication (must match
 * NEXT_PUBLIC_WORKOS_REDIRECT_URI, e.g. https://app.namzilabs.com/callback).
 *
 * onError: without it, any callback failure answers with the SDK's raw JSON
 * blob — which is what an invited teammate once saw as their very first
 * contact with the product. The SDK has already console.error'd the real
 * cause ("[AuthKit callback error]", visible in Vercel logs) by the time
 * onError runs, so this adds no logging — it only turns the dead end into
 * a human page with the two fixes that cover the common cases.
 */
export const GET = handleAuth({
  returnPathname: "/dashboard",
  onError: ({ request }) => NextResponse.redirect(new URL("/auth-error", request.url)),
});
