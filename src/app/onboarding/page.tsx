import { redirect } from "next/navigation";
import { withAuth, signOut, getWorkOS } from "@workos-inc/authkit-nextjs";
import { ArrowRight, ChevronRight } from "lucide-react";
import { createOrganizationAction, switchOrgAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Shown when a signed-in user has no ACTIVE organization in their session.
 *
 * Guards the duplicate-workspace bug: a user who already belongs to one or more
 * organizations is offered to enter an existing one (the default), and only sees
 * the create form if they explicitly choose to make another. Creating is reserved
 * for genuinely new users, so reloading this page can't spawn extra workspaces.
 */
export default async function OnboardingPage() {
  const auth = await withAuth({ ensureSignedIn: true });
  if (auth.organizationId) redirect("/dashboard");

  const memberships = await getWorkOS()
    .userManagement.listOrganizationMemberships({ userId: auth.user.id, statuses: ["active"] })
    .then((r) => r.data)
    .catch(() => []);
  const orgs = memberships.map((m) => ({ id: m.organizationId, name: m.organizationName ?? "Workspace" }));
  const hasWorkspaces = orgs.length > 0;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      {hasWorkspaces ? (
        <>
          <h1 className="font-display text-display-xs font-semibold text-foreground">Choose a workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You already belong to {orgs.length === 1 ? "a workspace" : `${orgs.length} workspaces`}. Pick one to continue.
          </p>
          <Card variant="surface" padding="none" className="mt-6 divide-y divide-border">
            {orgs.map((o, i) => (
              <form key={o.id} action={switchOrgAction}>
                <input type="hidden" name="organizationId" value={o.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-auto w-full justify-between rounded-none px-4 py-3 text-left text-sm font-normal",
                    i === 0 && "rounded-t-surface",
                    i === orgs.length - 1 && "rounded-b-surface",
                  )}
                >
                  <span className="font-medium text-foreground">{o.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    Enter
                    <ArrowRight size={14} strokeWidth={2.25} />
                  </span>
                </Button>
              </form>
            ))}
          </Card>

          <details className="group mt-6">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} strokeWidth={2.25} className="transition-transform group-open:rotate-90" />
              Create another workspace
            </summary>
            <CreateForm className="mt-4" />
          </details>
        </>
      ) : (
        <>
          <h1 className="font-display text-display-xs font-semibold text-foreground">Create your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A workspace is your organization&rsquo;s private space. All connected integrations and data
            live inside it.
          </p>
          <CreateForm className="mt-8" />
        </>
      )}

      <form action={async () => { "use server"; await signOut(); }} className="mt-6">
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  );
}

function CreateForm({ className }: { className?: string }) {
  return (
    <form action={createOrganizationAction} className={cn("space-y-4", className)}>
      <div>
        <FieldLabel htmlFor="name">Workspace name</FieldLabel>
        <Input id="name" name="name" required placeholder="Acme Inc" />
      </div>
      <Button type="submit" className="w-full">
        Create workspace
      </Button>
    </form>
  );
}
