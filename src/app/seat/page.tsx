import { redirect } from "next/navigation";
import { getWorkOS, signOut, withAuth } from "@workos-inc/authkit-nextjs";
import { ChevronRight } from "lucide-react";
import { getReadDb } from "@/db/client";
import { switchOrgAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PLANS } from "@/lib/billing/plans";
import { workspacePlan } from "@/lib/billing/state";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A MEMBER PAST THE PLAN'S SEATS LANDS HERE — sent by `requireOrg`, which is
 * why this page must never call it.
 *
 * Nothing about them was removed: they are still a member, their work is still
 * in the workspace, and the owner upgrading brings them straight back. The page
 * says exactly that, and offers the other workspaces they belong to.
 */
export default async function SeatPage() {
  const auth = await withAuth({ ensureSignedIn: true });
  if (!auth.organizationId) redirect("/onboarding");

  const [plan, memberships] = await Promise.all([
    workspacePlan(getReadDb(), auth.organizationId).catch(() => null),
    getWorkOS()
      .userManagement.listOrganizationMemberships({ userId: auth.user.id, statuses: ["active"] })
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const planDef = PLANS[plan?.plan ?? "free"];
  const here = memberships.find((m) => m.organizationId === auth.organizationId)?.organizationName ?? "This workspace";
  const others = memberships
    .filter((m) => m.organizationId !== auth.organizationId)
    .map((m) => ({ id: m.organizationId, name: m.organizationName ?? "Workspace" }));
  const seats = planDef.limits.members;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="text-display-xs font-semibold text-foreground">{here} is on the {planDef.name} plan</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Its plan includes {seats === 1 ? "one member — the owner" : `${seats} members`}, so it&rsquo;s paused for you for now. Nothing has been
        removed: ask the workspace owner to upgrade and you&rsquo;ll be straight back in.
      </p>

      {others.length > 0 ? (
        <>
          <p className="mt-8 text-sm font-medium text-foreground">Your other workspaces</p>
          <Card variant="surface" padding="none" className="mt-3 divide-y divide-border">
            {others.map((o, i) => (
              <form key={o.id} action={switchOrgAction}>
                <input type="hidden" name="organizationId" value={o.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-auto w-full justify-between rounded-none px-4 py-3 text-left text-sm font-normal",
                    i === 0 && "rounded-t-surface",
                    i === others.length - 1 && "rounded-b-surface",
                  )}
                >
                  <span className="font-medium text-foreground">{o.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    Enter
                    <ChevronRight size={14} aria-hidden />
                  </span>
                </Button>
              </form>
            ))}
          </Card>
        </>
      ) : null}

      <form
        action={async () => {
          "use server";
          await signOut();
        }}
        className="mt-6"
      >
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  );
}
