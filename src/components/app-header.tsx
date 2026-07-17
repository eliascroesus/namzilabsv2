import Link from "next/link";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { OrgSwitcher } from "./org-switcher";
import { signOutAction } from "@/app/actions";

/**
 * Authenticated top bar: brand, organization switcher (from the user's WorkOS
 * memberships), the signed-in email, and sign-out. All tenant data comes from
 * the authenticated session — never the browser.
 */
export async function AppHeader({
  userId,
  orgId,
  userEmail,
}: {
  userId: string;
  orgId: string;
  userEmail?: string | null;
}) {
  const workos = getWorkOS();
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId,
    statuses: ["active"],
  });
  const orgs = memberships.data.map((m) => ({ id: m.organizationId, name: m.organizationName }));

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            Namzilabs
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-600">
            <Link href="/dashboard" className="hover:text-neutral-900">
              Dashboard
            </Link>
            <Link href="/integrations" className="hover:text-neutral-900">
              Integrations
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <OrgSwitcher orgs={orgs} currentId={orgId} />
          {userEmail && <span className="hidden text-sm text-neutral-500 sm:inline">{userEmail}</span>}
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
