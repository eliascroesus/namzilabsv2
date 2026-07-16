import "server-only";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import type { UserInfo } from "@workos-inc/authkit-nextjs";

/**
 * The authenticated tenant context. `orgId` is the WorkOS organization id and
 * is the ONLY source of tenancy — it is never accepted from the browser.
 */
export type OrgContext = {
  userId: string;
  orgId: string;
  role?: string;
  auth: UserInfo;
};

/**
 * For server components on protected pages: ensure the user is signed in AND has
 * an active organization. Redirects to sign-in (via AuthKit) or to /onboarding
 * if the user has no organization yet.
 */
export async function requireOrg(): Promise<OrgContext> {
  const auth = await withAuth({ ensureSignedIn: true });
  if (!auth.organizationId) {
    redirect("/onboarding");
  }
  return { userId: auth.user.id, orgId: auth.organizationId, role: auth.role, auth };
}

/**
 * For route handlers: resolve the tenant context from the session without
 * redirecting. Returns null when unauthenticated or org-less, so the caller can
 * return a 401/403. The proxy already gates protected API prefixes; this is
 * defense-in-depth and the sole place orgId is derived for queries.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const auth = await withAuth();
  if (!auth.user || !auth.organizationId) return null;
  return { userId: auth.user.id, orgId: auth.organizationId, role: auth.role, auth };
}
