import type { ReactNode } from "react";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, flows } from "@/db/schema";
import { OrgSwitcher } from "./org-switcher";
import { Sidebar } from "./sidebar";
import { signOutAction } from "@/app/actions";

/**
 * The authenticated app shell: a static, full-height colour rail on the left
 * (Sidebar) plus a slim top bar on the right holding the organization switcher,
 * the signed-in email and sign-out. The page content scrolls beneath the top
 * bar while the rail stays put. All tenant data comes from the authenticated
 * session — never the browser.
 */
export async function AppShell({
  userId,
  orgId,
  userEmail,
  children,
}: {
  userId: string;
  orgId: string;
  userEmail?: string | null;
  children: ReactNode;
}) {
  const workos = getWorkOS();
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId,
    statuses: ["active"],
  });
  // Dedupe by org id (a duplicated membership row must never render twice).
  const seen = new Set<string>();
  let orgs = memberships.data
    .map((m) => ({ id: m.organizationId, name: m.organizationName }))
    .filter((o) => !seen.has(o.id) && (seen.add(o.id), true));

  // Hide leftover artifacts of the old duplicate-workspace bug: an org with the SAME
  // name as the active/data-holding one, holding no data of its own, is noise — the
  // user created "one Namzilabs", not four. The active org always stays visible, and
  // any org with real data (connections or flows) always stays visible.
  if (orgs.length > 1) {
    try {
      const ids = orgs.map((o) => o.id);
      const db = getDb();
      const withData = new Set<string>([
        ...(await db.selectDistinct({ orgId: connections.orgId }).from(connections).where(inArray(connections.orgId, ids))).map((r) => r.orgId),
        ...(await db.selectDistinct({ orgId: flows.orgId }).from(flows).where(inArray(flows.orgId, ids))).map((r) => r.orgId),
      ]);
      const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
      orgs = orgs.filter((o) => {
        if (o.id === orgId || withData.has(o.id)) return true;
        const twin = orgs.some((x) => x.id !== o.id && norm(x.name) === norm(o.name) && (x.id === orgId || withData.has(x.id)));
        return !twin;
      });
    } catch {
      // Shell must never fail on a DB hiccup — fall back to the full list.
    }
  }

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-end gap-4 border-b border-neutral-200 bg-white px-6 py-3">
          <OrgSwitcher orgs={orgs} currentId={orgId} />
          {userEmail && <span className="hidden text-sm text-neutral-500 sm:inline">{userEmail}</span>}
          <form action={signOutAction}>
            <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50">
              Sign out
            </button>
          </form>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
