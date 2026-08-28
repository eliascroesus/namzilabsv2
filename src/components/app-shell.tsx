import { unstable_cache } from "next/cache";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requestAccess } from "@/lib/auth";
import { connections, flows } from "@/db/schema";
import { AppFrame } from "./app-frame";
import { OrgSwitcher } from "./org-switcher";
import { Button } from "@/components/ui/button";
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
/**
 * THE WORKSPACE SWITCHER'S LIST, CACHED — because it is the last thing on the
 * critical path and it almost never changes.
 *
 * `AppShell` renders only after the page's own body has finished every await,
 * so this WorkOS call is strictly ADDITIVE to the database chain rather than
 * overlapping it: measured at ~175ms, paid on every view switch, every range
 * press and every twelve-second poller refresh. A membership list changes when
 * somebody joins or leaves a workspace, which is not a per-render event.
 *
 * Five minutes, keyed by user. `unstable_cache` has its own store and works
 * under `force-dynamic`; the tag is here so an invite flow can drop it the day
 * one wants to.
 */
const listMemberships = unstable_cache(
  async (uid: string): Promise<Array<{ organizationId: string; organizationName: string; roleSlug?: string }>> => {
    const res = await getWorkOS().userManagement.listOrganizationMemberships({ userId: uid, statuses: ["active"] });
    // Only the three fields the shell reads — a cache entry should not hold a
    // whole SDK response, and this one crosses a serialization boundary. The
    // role travels because the rank gate below reads it.
    return res.data.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      roleSlug: m.role?.slug,
    }));
  },
  ["org-memberships"],
  { revalidate: 300, tags: ["memberships"] },
);

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
  const memberships = await listMemberships(userId);
  // Dedupe by org id (a duplicated membership row must never render twice).
  const seen = new Set<string>();
  let orgs = memberships
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

  // The rail's Apps item follows the same rank gate as /integrations itself.
  // Role comes from the membership list already fetched above (the same WorkOS
  // fact the session's `role` carries — the shell isn't handed the session).
  // Hiding is a courtesy: the /integrations page gate is the real wall, so on
  // any hiccup the frame shows the full rail rather than failing.
  let hide: string[] | undefined;
  try {
    const role = memberships.find((m) => m.organizationId === orgId)?.roleSlug;
    // Same request-scoped resolution the page used — `cache()` makes this the
    // FIRST call's answer rather than a second set of queries.
    const access = await requestAccess(orgId, userId, role);
    if (!access.can("view_integrations")) hide = ["Apps"];
  } catch {
    // Full rail on failure — never a broken frame.
  }

  const initials = (userEmail ?? "?").slice(0, 2).toUpperCase();
  // The active workspace's own name, for the top bar. Falls back rather than
  // rendering an empty slot: a membership list can come back short.
  const workspace = orgs.find((o) => o.id === orgId)?.name ?? "Workspace";

  return (
    // The sidebar and the top bar are fixed; only the page column scrolls.
    <AppFrame
      surface="overflow-y-auto bg-canvas-bg"
      hide={hide}
      workspace={workspace}
      account={{
        initials,
        // Rendered on the server, opened by the client rail: the light
        // panel beside the avatar. Workspace first, then identity, then
        // the way out.
        panel: (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
              <OrgSwitcher orgs={orgs} currentId={orgId} />
            </div>
            {userEmail && <p className="truncate border-t border-border pt-2 text-tiny text-muted-foreground">{userEmail}</p>}
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" size="sm" className="w-full">
                Sign out
              </Button>
            </form>
          </div>
        ),
      }}
    >
      {children}
    </AppFrame>
  );
}
