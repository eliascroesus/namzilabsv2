import { redirect } from "next/navigation";
import { withAuth, signOut, getWorkOS } from "@workos-inc/authkit-nextjs";
import { createOrganizationAction, switchOrgAction } from "@/app/actions";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {hasWorkspaces ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a workspace</h1>
          <p className="mt-2 text-sm text-neutral-600">
            You already belong to {orgs.length === 1 ? "a workspace" : `${orgs.length} workspaces`}. Pick one to continue.
          </p>
          <div className="mt-6 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {orgs.map((o) => (
              <form key={o.id} action={switchOrgAction}>
                <input type="hidden" name="organizationId" value={o.id} />
                <button
                  type="submit"
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-neutral-50"
                >
                  <span className="font-medium">{o.name}</span>
                  <span className="text-neutral-400">Enter &rarr;</span>
                </button>
              </form>
            ))}
          </div>

          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-800">
              Create another workspace
            </summary>
            <CreateForm className="mt-4" />
          </details>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
          <p className="mt-2 text-sm text-neutral-600">
            A workspace is your organization&rsquo;s private space. All connected integrations and data
            live inside it.
          </p>
          <CreateForm className="mt-8" />
        </>
      )}

      <form action={async () => { "use server"; await signOut(); }} className="mt-6">
        <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-800">
          Sign out
        </button>
      </form>
    </main>
  );
}

function CreateForm({ className }: { className?: string }) {
  return (
    <form action={createOrganizationAction} className={`space-y-4 ${className ?? ""}`}>
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-neutral-700">
          Workspace name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="Acme Inc"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        className="w-full rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-800"
      >
        Create workspace
      </button>
    </form>
  );
}
