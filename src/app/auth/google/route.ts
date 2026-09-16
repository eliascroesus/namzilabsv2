import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/app/(auth)/next-path";

/**
 * "CONTINUE WITH GOOGLE" — straight to Google, never via the hosted page.
 *
 * ═══ WHY THIS IS A PARAMETER SWAP AND NOT A REIMPLEMENTATION ═══
 *
 * WorkOS's authorize endpoint takes a `provider`, and `GoogleOAuth` sends the
 * person directly to Google instead of rendering AuthKit's own UI. But
 * `authkit-nextjs` hardcodes `provider: 'authkit'` and gives no way to override
 * it.
 *
 * The obvious move — building the URL by hand — means reproducing the SDK's
 * PKCE dance: generate the verifier, seal the state with the cookie password,
 * write the PKCE cookie under the name the callback expects. All of that is
 * internal to the SDK, none of it is exported, and getting one detail wrong
 * breaks sign-in in a way that looks like a WorkOS outage. It would also rot
 * silently on the next SDK upgrade.
 *
 * So the SDK does all of it, and this changes exactly one query parameter on
 * the URL it produced. The state, the code challenge, the PKCE cookie and the
 * callback's verification are all untouched — `/callback` cannot tell the
 * difference, because there is none to tell.
 *
 * `screen_hint` comes off because WorkOS only accepts it for the `authkit`
 * provider and rejects it for any other.
 *
 * ═══ IT ASSERTS RATHER THAN ASSUMES ═══
 *
 * If a future SDK stops putting `provider=authkit` in the URL, the swap would
 * quietly do nothing and every Google press would land on the hosted page
 * instead — working, so nobody would notice, and wrong. It throws instead, and
 * `tests/auth-google.test.ts` pins the same thing so the failure arrives in CI
 * rather than in production.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  // Sets the PKCE cookie as a side effect — which is why this must run in a
  // Route Handler and not in a page.
  const hosted = await getSignInUrl({ returnTo: next });
  const url = new URL(hosted);

  if (url.searchParams.get("provider") !== "authkit") {
    throw new Error(
      "authkit-nextjs no longer builds its authorize URL with provider=authkit; " +
        "the Google button cannot be redirected by swapping it. See this file.",
    );
  }
  url.searchParams.set("provider", "GoogleOAuth");
  url.searchParams.delete("screen_hint");

  redirect(url.toString());
}
