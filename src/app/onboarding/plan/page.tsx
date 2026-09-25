import { redirect } from "next/navigation";
import { PlanPicker } from "@/components/billing/plan-picker";
import { getDb } from "@/db/client";
import { safeNext } from "@/app/(auth)/next-path";
import { requireOrg } from "@/lib/auth";
import { codeErrorMessage } from "@/lib/billing/describe";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { billingEnabled, hasTrialed, workspacePlan } from "@/lib/billing/state";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

/**
 * STEP 2 OF ONBOARDING — the plan, straight after the workspace is made.
 *
 * `afterWorkspaceCreated` sends a new workspace here unless a code already
 * gave it a plan; `next` is where they were going (a template link, the
 * board), and every choice ends there. Nothing here can strand someone: with
 * billing off, or a plan already held, the page steps aside.
 */
export default async function PlanStepPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const next = safeNext(one(sp.next) || "/dashboard");
  if (!billingEnabled()) redirect(next);

  const db = getDb();
  const [plan, trialed] = await Promise.all([
    workspacePlan(db, ctx.orgId).catch(() => null),
    hasTrialed(db, ctx.userId).catch(() => true),
  ]);
  if (!plan || plan.plan !== "free") redirect(next);

  const codeError = codeErrorMessage(one(sp.code_error));

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center px-4 py-12 sm:px-6">
      <p className="text-center text-xs font-medium uppercase tracking-label text-muted-foreground">Step 2 of 2</p>
      <h1 className="mt-2 text-center text-display-xs font-semibold text-foreground">Choose a plan</h1>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
        {trialed
          ? "You've already had your free trial. Pick a plan, or start on Free and upgrade whenever you like."
          : `Try Growth or Scale free for ${TRIAL_DAYS} days — no card needed. Or start on Free and upgrade whenever you like.`}
      </p>
      {codeError && (
        <p role="alert" className="mx-auto mt-6 w-full max-w-xl rounded-card border border-danger-soft bg-danger-soft/50 px-4 py-3 text-sm text-danger-ink">
          {codeError}
        </p>
      )}
      <div className="mt-8">
        <PlanPicker
          mode="onboarding"
          current="free"
          currentSource="free"
          trialAvailable={!trialed}
          next={next}
          back={`/onboarding/plan?next=${encodeURIComponent(next)}`}
        />
      </div>
    </main>
  );
}
