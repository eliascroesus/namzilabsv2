import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, flows } from "@/db/schema";
import { OrgSwitcher } from "./org-switcher";
import { BrandMark, MainNav } from "./main-nav";
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
      // Header must never fail on a DB hiccup — fall back to the full list.
    }
  }

  return (
    // Sticky, and hairline rather than a full border: the page scrolls under a
    // bar that stays available instead of scrolling away with the content.
    <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-6">
          <BrandMark />
          {/* Flows had no route in the nav at all: the ONLY ways in were the
              dashboard's New-flow button and the onboarding checklist, and
              the checklist disappears for good once one tile is published.
              A user who published a metric last week and came back had no
              visible path to the thing that built it. */}
          <MainNav />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <OrgSwitcher orgs={orgs} currentId={orgId} />
          {/* The email is identity, not navigation — it reads as a quiet
              caption beside the switcher rather than a fourth control. */}
          {userEmail && <span className="hidden max-w-[180px] truncate text-xs text-neutral-400 lg:inline">{userEmail}</span>}
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
