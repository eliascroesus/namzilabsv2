import { unstable_cache } from "next/cache";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { LogOut } from "lucide-react";
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
  metricCount,
  children,
}: {
  userId: string;
  orgId: string;
  userEmail?: string | null;
  /**
   * HOW MANY METRICS THIS WORKSPACE HAS — supplied by the PAGE, never counted
   * here, and that is the one interesting decision in this prop.
   *
   * The shell is the wrong place to resolve it. It renders on ten routes and
   * only one of them — the dashboard — reads the metrics table at all, so a
   * count taken here would be a query the other nine pay on every render, and
   * on the dashboard it would be a SECOND read of rows that page has already
   * got in hand. Worse, the note at the top of this file explains that
   * `AppShell` runs strictly AFTER the page's own awaits: a query added here
   * overlaps nothing and lands whole on the critical path, twelve seconds
   * apart, forever, in every open tab.
   *
   * So the dashboard hands down `metrics.length + flowTiles.length` — both
   * already resolved, both already narrowed by rank — and every other route
   * leaves this undefined, which the bar reads as "nobody counted" and answers
   * by not drawing a ring. Undefined is deliberately NOT zero: see `TopBar`.
   */
  metricCount?: number;
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
    // SCROLLING IS ALL THIS SAYS NOW. The ground it scrolls on is `bg-ground`,
    // painted by AppFrame for every route at once — see the note there. This
    // read `bg-canvas-bg`, which made the shell that fetches memberships also
    // the file that decided what colour the dashboard is.
    <AppFrame
      surface="overflow-y-auto"
      hide={hide}
      workspace={workspace}
      metricCount={metricCount}
      account={{
        initials,
        // Rendered on the server, opened by the client rail: the light
        // panel beside the avatar. Workspace first, then identity, then
        // the way out.
        /**
         * THE PANEL, BUILT FOR A MENU RATHER THAN FOR A CARD.
         *
         * It was a `space-y-3` block with its own internal border, dropped into
         * a Radix menu that brings its own padding and its own separators — so
         * the email sat under a rule that did not line up with the panel's
         * edges, and a full-width secondary button read as a form inside a
         * dropdown. Three bands, each with the menu's own inset, divided by
         * hairlines that run the full width.
         *
         * THE ORDER IS WHO, THEN WHERE, THEN OUT — because the three answer
         * different questions and only the middle one is a list. Identity leads:
         * the email under the trigger's avatar is what tells you WHICH account
         * this browser is signed into, and it used to be a 12px grey line
         * between the switcher and the sign-out button, i.e. the least visible
         * thing in a menu that exists to carry it.
         *
         * Every band speaks the kit's menu grammar — a micro ALL-CAPS label,
         * rows at the control radius, hairlines edge to edge — so this reads as
         * the same object as the flow builder's menus rather than as a card
         * that happens to be floating.
         */
        panel: (
          <div className="text-sm">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              {/* The trigger's avatar again, at the same size and in the same
                  violet tint, so the panel visibly belongs to the control that
                  opened it. Violet is the sheet's identity colour, and the ink
                  is the 700: the 500 is a fill, and 4.42:1 as text. */}
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              >
                {initials}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signed in</p>
                <p className="truncate text-sm font-medium text-foreground">{userEmail ?? "Your account"}</p>
              </div>
            </div>
            {/* `p-1.5` matches the padding DropdownMenuContent would have given
                this band if the panel were not `p-0` — the rows have to clear
                the panel's own 16px corner, and 6px is the number the menu
                language already picked for that. */}
            <div className="border-t border-border p-1.5">
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {orgs.length > 1 ? "Workspaces" : "Workspace"}
              </p>
              <OrgSwitcher orgs={orgs} currentId={orgId} />
            </div>
            <form action={signOutAction} className="border-t border-border p-1.5">
              {/* Same override as the switcher's rows, for the same reason: the
                  panel's rows are 8px rectangles, and `rounded-control` cannot
                  displace `buttonVariants`' pill through `cn()`.
                  The INK is the menu's, not the ghost button's: a row here is
                  near-black text with a muted glyph, exactly as
                  `DropdownMenuItem` draws one. Left at the ghost's rest colour,
                  the way out of the product was the palest thing in the panel
                  that contains it. */}
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-9 w-full justify-start gap-2.5 rounded-[var(--radius-control)] px-2 font-normal text-foreground [&_svg]:text-muted-foreground"
              >
                <LogOut />
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
