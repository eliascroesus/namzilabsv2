import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getReadDb } from "@/db/client";
import { effectiveAccess } from "@/lib/permissions";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { checkSeat } from "@/lib/billing/seats";
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
  // A member past the plan's seats sees /seat instead — every page and action
  // comes through here, so none can be reached around it.
  if (!(await seatFor(auth.organizationId, auth.user.id))) redirect("/seat");
  return { userId: auth.user.id, orgId: auth.organizationId, role: auth.role, auth };
}

/**
 * THE SEAT CHECK, once per request (see lib/billing/seats.ts). Free for the
 * owner and while billing is off; one membership list otherwise.
 *
 * FAILS OPEN. A WorkOS or database hiccup must never lock a team out of its
 * own workspace — a missed paywall for the length of an outage is the cheaper
 * mistake by far.
 */
const seatFor = cache(async (orgId: string, userId: string): Promise<boolean> => {
  try {
    return await checkSeat(getReadDb(), orgId, userId, async () => {
      const r = await getWorkOS().userManagement.listOrganizationMemberships({ organizationId: orgId, statuses: ["active"], limit: 100 });
      return r.data.map((m) => ({ userId: m.userId, createdAt: m.createdAt }));
    });
  } catch (e) {
    console.error("[seats] check failed; letting them in", e);
    return true;
  }
});

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

/**
 * THE REQUEST'S ACCESS, RESOLVED ONCE.
 *
 * `effectiveAccess` runs twice per render of the most-rendered page in the
 * product — once for the page's own gates and once for the AppShell's rail —
 * each resolution up to three queries for a ranked member, with nothing
 * remembering the first answer. React's `cache()` dedupes per request, and the
 * key is the three STRINGS rather than a context object precisely because
 * `cache` compares arguments by identity: two call sites building their own
 * `{orgId, userId}` objects would never hit.
 *
 * Lives here rather than in permissions.ts because that module deliberately
 * takes its DB as an argument (PGlite drives it in tests) and stays importable
 * anywhere; this wrapper is the server-only, request-scoped convenience.
 */
export const requestAccess = cache((orgId: string, userId: string, role?: string) =>
  effectiveAccess(getReadDb(), { orgId, userId, role }),
);
