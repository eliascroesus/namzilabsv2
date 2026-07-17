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
const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/onboarding", "/app", "/integrations", "/connections"];
const PROTECTED_API_PREFIXES = ["/api/replay", "/api/reconcile", "/api/connections", "/api/org", "/api/oauth"];

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
