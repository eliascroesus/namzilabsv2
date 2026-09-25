import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { withAuth, signOut, getWorkOS } from "@workos-inc/authkit-nextjs";
import { getReadDb } from "@/db/client";
import { Checkbox } from "@/components/ui/checkbox";
import { summarize } from "@/lib/templates/snapshot";
import { TEMPLATE_COOKIE } from "@/lib/templates/cookie";
import { getPublicTemplate } from "@/lib/templates/store";
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

  /**
   * THE TEMPLATE THEY CAME FOR, if a template link sent them here — see
   * `TEMPLATE_COOKIE` for the paths that lose `next` and land here instead.
   * Offered ticked on the create form; any failure to read it is simply no
   * offer, since this page's job is making a workspace and it must not fail at
   * that over a template.
   */
  const pending = await getPublicTemplate(getReadDb(), (await cookies()).get(TEMPLATE_COOKIE)?.value).catch(() => null);
  const template =
    pending?.enabled && pending.snapshot
      ? { code: pending.code, name: pending.name, author: pending.authorName, views: summarize(pending.snapshot).views }
      : null;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      {hasWorkspaces ? (
        <>
          <h1 className="text-display-xs font-semibold text-foreground">Choose a workspace</h1>
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
                    <ArrowRight size={14} />
                  </span>
                </Button>
              </form>
            ))}
          </Card>

          <details className="group mt-6" open={template != null}>
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
              Create another workspace
            </summary>
            <CreateForm className="mt-4" template={template} />
          </details>
        </>
      ) : (
        <>
          <h1 className="text-display-xs font-semibold text-foreground">Create your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A workspace is your organization&rsquo;s private space. All connected integrations and data
            live inside it.
          </p>
          <CreateForm className="mt-8" template={template} />
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

type PendingTemplate = { code: string; name: string; author: string | null; views: number } | null;

function CreateForm({ className, template }: { className?: string; template: PendingTemplate }) {
  return (
    <form action={createOrganizationAction} className={cn("space-y-4", className)}>
      {template && (
        /* TICKED, NOT SILENT. They chose this template a page or two ago, so
           the default is to honour it — but it is said out loud and can be
           unticked, because a workspace is theirs and a layout they did not
           expect is the one surprise onboarding should never spring. */
        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-border bg-card p-4">
          <Checkbox name="template" value={template.code} defaultChecked className="mt-0.5" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">Start from &ldquo;{template.name}&rdquo;</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {`${template.views} ${template.views === 1 ? "view" : "views"}${template.author ? `, shared by ${template.author}` : ""}. `}
              Your workspace opens with its layout and notes — none of anyone else&rsquo;s data.
            </span>
          </span>
        </label>
      )}
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
