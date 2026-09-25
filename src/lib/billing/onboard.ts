import type { DB } from "@/db/types";
import { applyPlan } from "./pauses";
import { billingEnabled, redeemCode } from "./state";

/**
 * AN ACCESS CODE A VISITOR BROUGHT — kept by `/p/<CODE>` in this cookie until
 * they have a workspace to redeem it on. Thirty days, like the referral cookie.
 */
export const CODE_COOKIE = "nz_code";
export const CODE_COOKIE_DAYS = 30;

type Jar = { get(name: string): { value: string } | undefined; delete(name: string): void };

const withParam = (path: string, param: string) => `${path}${path.includes("?") ? "&" : "?"}${param}`;

/**
 * THE STEP AFTER A WORKSPACE IS CREATED — redeem the code they brought, then
 * decide where they land: the plan step (with billing on, and no code having
 * already given them a plan), or where they were going.
 *
 * NEVER FAILS THE SIGN-UP. Everything that can throw is caught: a bad code, a
 * missing table before the migration is pasted, a database hiccup — each costs
 * the code, never the workspace.
 */
export async function afterWorkspaceCreated(db: DB, input: { orgId: string; landing: string; jar: Jar }): Promise<string> {
  let redeemed = false;
  try {
    const raw = input.jar.get(CODE_COOKIE)?.value;
    if (raw) {
      const r = await redeemCode(db, { orgId: input.orgId, code: raw });
      if (r.ok) {
        redeemed = true;
        await applyPlan(db, input.orgId).catch(() => {});
      }
      // Kept or not, the cookie has done its job: a code that failed here
      // would fail the same way on their next workspace.
      input.jar.delete(CODE_COOKIE);
    }
  } catch (e) {
    console.error("[billing] access code at sign-up failed", e);
  }
  if (!billingEnabled()) return input.landing;
  if (redeemed) return withParam(input.landing, "welcome=code");
  return `/onboarding/plan?next=${encodeURIComponent(input.landing)}`;
}
