import { NextRequest, NextResponse } from "next/server";
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";

/**
 * Next.js 16 proxy (the successor to `middleware.ts`). Runs WorkOS AuthKit on
 * every matched request so `withAuth()` works in server components/route
 * handlers, and enforces authentication on protected routes.
 *
 * Machine endpoints (webhooks, inngest, health) are excluded from the matcher
 * entirely, so they are always public and never touch auth. Public marketing /
 * legal pages ("/", "/terms", "/privacy") are matched (so the header can render
 * auth-aware) but are not in the protected list, so anonymous users see them.
 */
/**
 * Every prefix here must name a route that EXISTS. This list once carried
 * "/app", "/api/reconcile", "/api/connections" and "/api/org" — protection
 * for routes that were never built. Dead prefixes cost nothing at runtime but
 * teach readers a false map of the app, and a false map is how the NEXT
 * route ships unprotected ("it's probably covered, the list is long").
 * Routes also enforce auth themselves (requireOrg / getOrgContext) — this
 * layer is the outer wall, not the only one.
 */
/**
 * `/design` is deliberately NOT here. It renders no customer data — it is the
 * brand kit drawn with fixtures — and scripts/screenshot.mjs can only reach
 * routes that need no session. Putting the kit page behind auth costs the one
 * tool in the repo that can see a colour resolving to nothing, and buys
 * hiding a style guide.
 */
const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/onboarding", "/integrations", "/connections"];
const PROTECTED_API_PREFIXES = ["/api/replay", "/api/results-version", "/api/oauth"];

function isProtected(pathname: string): boolean {
  return [...PROTECTED_PAGE_PREFIXES, ...PROTECTED_API_PREFIXES].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default async function proxy(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request);
  const { pathname } = request.nextUrl;

  if (isProtected(pathname) && !session.user) {
    // Unauthenticated API calls get a clean 401; pages redirect to sign-in.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (authorizationUrl) {
      return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
    }
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/inngest|api/health).*)"],
};
