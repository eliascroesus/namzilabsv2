import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, flows } from "@/db/schema";
import { OrgSwitcher } from "./org-switcher";
import { Sidebar } from "./sidebar";
import { signOutAction } from "@/app/actions";

/**
 * The authenticated frame: the navigation rail, and everything else beside it.
 *
 * THE APP HAD TWO NAVIGATIONS. The flow editor rendered a left rail; all eight
 * other pages rendered a top bar with its own set of links — so "where am I"
 * and "how do I get to X" were answered by different furniture in different
 * places, and the two lists had already drifted (the rail never had Settings;
 * the bar never had Connections). One rail now, everywhere.
 *
 * The rail also takes the account controls, which is where sidebar products
 * put them: a top bar should say what you are LOOKING AT, and there is no
 * room for that while it is also carrying who you are and where you can go.
 *
 * All tenant data still comes from the authenticated session — never the
 * browser.
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
  children: React.ReactNode;
}) {
  const workos = getWorkOS();
  const memberships = await workos.userManagement.listOrganizationMemberships({ userId, statuses: ["active"] });
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
      // The frame must never fail on a DB hiccup — fall back to the full list.
    }
  }

  const initials = (userEmail ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        account={{
          initials,
          // Rendered on the server, opened by the client rail: the light
          // panel beside the avatar. Workspace first, then identity, then
          // the way out.
          panel: (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-neutral-400">Workspace</p>
                <OrgSwitcher orgs={orgs} currentId={orgId} />
              </div>
              {userEmail && <p className="truncate border-t border-neutral-100 pt-2 text-tiny text-neutral-500">{userEmail}</p>}
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-control border border-neutral-200 px-3 py-1.5 text-small font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  Sign out
                </button>
              </form>
            </div>
          ),
        }}
      />
      {/* The rail is fixed; only this column scrolls. */}
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
