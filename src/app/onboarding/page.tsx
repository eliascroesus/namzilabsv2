import { redirect } from "next/navigation";
import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { createOrganizationAction } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * Shown when a signed-in user has no organization yet. Creating one makes them
 * the first member and switches their session into it.
 */
export default async function OnboardingPage() {
  const auth = await withAuth({ ensureSignedIn: true });
  if (auth.organizationId) redirect("/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-2 text-sm text-neutral-600">
        A workspace is your organization&rsquo;s private space. All connected integrations and data
        live inside it.
      </p>

      <form action={createOrganizationAction} className="mt-8 space-y-4">
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

      <form action={async () => { "use server"; await signOut(); }} className="mt-6">
        <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-800">
          Sign out
        </button>
      </form>
    </main>
  );
}
