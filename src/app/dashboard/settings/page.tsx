import Link from "next/link";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth";
import { canManageRanks, claimOwnerIfMissing } from "@/lib/permissions";
import { getDb, getReadDb } from "@/db/client";
import { flows, metrics, rankAssignments, workspaceRanks } from "@/db/schema";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/copy-field";
import { inviteMemberAction, revokeInviteAction } from "./actions";
import { MemberRankSelect, RanksPanel } from "./RanksPanel";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

/** The avatar tile's two letters, from the email's local part — display only. */
const initials = (email: string) => {
  const parts = (email.split("@")[0] ?? "").split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? email).slice(0, 2);
  return (s || "?").toUpperCase();
};

/**
 * Workspace settings — today that means MEMBERS. Tenancy in this product IS
 * the organization, and until this page existed the product could create a
 * workspace and put exactly one person in it: the second person at a customer
 * had no way in short of the WorkOS admin dashboard. WorkOS stays the source
 * of truth (identity mirrors were dropped in migration 0022); this page reads
 * it live and writes through its invitation API, which sends the email too.
 *
 * Each pending invitation also shows its accept link for hand-delivery
 * (Slack, text) — same link as the email, hosted and expired by WorkOS.
 * Email-bound on purpose: a WorkOS invitation admits only its addressee, so a
 * leaked link is inert. An "anyone with the link joins" token was considered
 * and deliberately not built — it would need its own table, a public /join
 * route, and member caps, for no need the personal link doesn't cover.
 *
 * RANKS: org-local ACL — named permission/metric bundles assigned per member
 * (src/lib/permissions.ts is the model). The editor renders for anyone who
 * may MANAGE ranks — WorkOS admins, and unranked members, because a
 * self-serve workspace has no admin slug until WorkOS roles are configured
 * and the owner would otherwise be locked out of the feature's own editor.
 * That render gate is UX, not security: every rank action re-checks
 * canManageRanks on the server before touching a row.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, userId, role, auth } = await requireOrg();
  const sp = await searchParams;
  const invited = one(sp.invited);
  const inviteError = one(sp.invite_error);
  const workos = getWorkOS();
  const db = getReadDb(); // read-only page load: rides the DB_DRIVER_READ soak seam (B.3)
  // Emails via one org-scoped listUsers, not a getUser per membership: the
  // N+1 here would be one WorkOS round trip per member on every page view.
  const [memberships, orgUsers, invitations, rankRows, assignments] = await Promise.all([
    workos.userManagement.listOrganizationMemberships({ organizationId: orgId, statuses: ["active"], limit: 100 }),
    workos.userManagement.listUsers({ organizationId: orgId, limit: 100 }),
    workos.userManagement.listInvitations({ organizationId: orgId, limit: 100 }),
    // Ranks + assignments load for EVERYONE: non-admins see teammates' ranks
    // as text in the Members list. Columns are listed out, not select() —
    // this page renders every rank field but should never ride along when
    // someone adds a wide column to the table (Neon egress is metered).
    db
      .select({
        id: workspaceRanks.id,
        name: workspaceRanks.name,
        allPermissions: workspaceRanks.allPermissions,
        permissions: workspaceRanks.permissions,
        allMetrics: workspaceRanks.allMetrics,
        metricKeys: workspaceRanks.metricKeys,
        inherits: workspaceRanks.inherits,
      })
      .from(workspaceRanks)
      .where(eq(workspaceRanks.orgId, orgId)),
    db
      .select({ userId: rankAssignments.userId, rankId: rankAssignments.rankId })
      .from(rankAssignments)
      .where(eq(rankAssignments.orgId, orgId)),
  ]);

  // ORGS OLDER THAN workspace_owners GET THEIR OWNER STAMPED HERE — the first
  // settings visit claims the earliest-created active membership (the creator;
  // onboarding makes the org and its first membership in one action). Writes
  // through the WRITE handle: the page is otherwise read-only, but a claim is
  // a fact being recorded, and the read replica must not swallow it. Runs
  // BEFORE canManageRanks so a legacy owner sees the rank editor on their
  // very first visit, ranked or not.
  const ownerUserId = await claimOwnerIfMissing(
    getDb(),
    orgId,
    memberships.data.map((m) => ({ userId: m.userId, createdAt: m.createdAt })),
  );
  const isAdmin = await canManageRanks(db, { orgId, userId, role });

  // The metric catalogue only feeds the admin-only editor, so non-admin loads
  // skip both queries entirely. Published flows only: a draft has no dashboard
  // tile, so there is nothing to show or hide yet.
  const [publishedFlows, metricRows] = await Promise.all([
    isAdmin
      ? db
          .select({ id: flows.id, name: flows.name })
          .from(flows)
          .where(and(eq(flows.orgId, orgId), eq(flows.status, "published")))
      : [],
    isAdmin ? db.select({ id: metrics.id, name: metrics.name }).from(metrics).where(eq(metrics.orgId, orgId)) : [],
  ]);
  const emailByUser = new Map(orgUsers.data.map((u) => [u.id, u.email]));
  const members = memberships.data.map((m) => ({
    id: m.id,
    userId: m.userId,
    email: emailByUser.get(m.userId) ?? m.userId,
    role: m.userId === ownerUserId ? "owner" : (m.role?.slug ?? "member"),
  }));
  const pending = invitations.data.filter((i) => i.state === "pending");

  const rankNameById = new Map(rankRows.map((r) => [r.id, r.name]));
  const rankIdByUser = new Map(assignments.map((a) => [a.userId, a.rankId]));
  const rankOptions = rankRows.map((r) => ({ id: r.id, name: r.name }));
  // Member counts per rank — the list summaries and the delete confirm both
  // need "how many people would this touch".
  const memberCounts: Record<string, number> = {};
  for (const a of assignments) memberCounts[a.rankId] = (memberCounts[a.rankId] ?? 0) + 1;
  // The metric-visibility catalogue, keyed exactly as effectiveAccess checks:
  // a flow tile is "flow:<flowId>", a classic metric tile is "metric:<metricId>".
  const catalogue = [
    ...publishedFlows.map((f) => ({ key: `flow:${f.id}`, name: f.name })),
    ...metricRows.map((m) => ({ key: `metric:${m.id}`, name: m.name })),
  ];

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-display font-semibold tracking-tight text-foreground">Workspace settings</h1>

        {invited && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-green-200 bg-green-50 p-4 text-base text-green-800">
            <p>
              Invitation created for <b>{invited}</b> — they&rsquo;ll get an email with a join link. Or copy the
              same link under <b>Pending invitations</b> below and send it to them yourself.
            </p>
            <Link href="/dashboard/settings" aria-label="Dismiss" className="font-semibold text-green-500 hover:text-green-800">
              ✕
            </Link>
          </div>
        )}
        {inviteError && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-red-200 bg-red-50 p-4 text-base text-red-800">
            <p>{inviteError}</p>
            <Link href="/dashboard/settings" aria-label="Dismiss" className="font-semibold text-red-400 hover:text-red-700">
              ✕
            </Link>
          </div>
        )}

        <section className="mt-10">
          <h2 className="mb-3 text-micro font-semibold uppercase tracking-wide text-neutral-400">Members</h2>
          <div className="divide-y divide-border rounded-surface border border-border bg-card shadow-card">
            {members.map((m) => {
              const rankName = rankNameById.get(rankIdByUser.get(m.userId) ?? "");
              return (
                /* The builder-card anatomy: a round mark, a semibold title, one
                   muted meta line. The OWNER's avatar is the list's single
                   solid-violet accent — like the rail's N. */
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-tiny font-semibold ${
                      m.role === "owner" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                    }`}
                    aria-hidden
                  >
                    {initials(m.email)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-base font-semibold text-foreground">{m.email}</span>
                      {m.userId === userId && <span className="shrink-0 text-tiny text-muted-foreground">(you)</span>}
                    </span>
                    <span className="block text-tiny text-muted-foreground">{rankName ?? "Full access"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {/* Admins assign ranks in place; everyone else just sees
                        them (the meta line above). An admin picking a rank for
                        another admin is allowed and harmless — admins are
                        never restricted, even with a rank assigned. */}
                    {isAdmin && (
                      <MemberRankSelect
                        memberUserId={m.userId}
                        rankId={rankIdByUser.get(m.userId) ?? null}
                        ranks={rankOptions}
                      />
                    )}
                    {m.role === "owner" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-bold uppercase text-primary">
                        {m.role}
                      </span>
                    ) : (
                      <span className="text-micro uppercase tracking-wide text-neutral-400">{m.role}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {isAdmin && (
          <section className="mt-10">
            <h2 className="mb-3 text-micro font-semibold uppercase tracking-wide text-neutral-400">Ranks</h2>
            <RanksPanel ranks={rankRows} memberCounts={memberCounts} catalogue={catalogue} />
          </section>
        )}

        {/* Inviting is governance — hidden with the rank editor. The action
            re-checks server-side; this is the courtesy. */}
        {isAdmin && (
        <section className="mt-10">
          <h2 className="mb-3 text-micro font-semibold uppercase tracking-wide text-neutral-400">Invite a teammate</h2>
          <div className="rounded-surface border border-border bg-card p-4 shadow-card">
            <form action={inviteMemberAction} className="flex gap-2">
              <input
                type="email"
                name="email"
                required
                placeholder="teammate@company.com"
                className="w-full max-w-sm rounded-control border border-input bg-card px-3 py-2 text-base text-foreground focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
              <Button type="submit">Send invite</Button>
            </form>
            <p className="mt-2.5 text-tiny text-muted-foreground">
              An email with a join link goes out automatically — the same link appears under{" "}
              <b>Pending invitations</b> for you to copy into Slack, a text, anywhere. Invites expire automatically.
            </p>
          </div>
        </section>
        )}

        {pending.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-micro font-semibold uppercase tracking-wide text-neutral-400">Pending invitations</h2>
            <div className="divide-y divide-border rounded-surface border border-border bg-card shadow-card">
              {pending.map((inv) => (
                <div key={inv.id} className="px-4 py-3">
                  {/* Same recipe as the Members card: avatar mark, semibold
                      title, one muted meta line, quiet action at the edge. */}
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-tiny font-semibold text-primary"
                      aria-hidden
                    >
                      {initials(inv.email)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-foreground">{inv.email}</span>
                      <span className="block text-tiny text-muted-foreground">
                        {inv.expiresAt ? `Invited · expires ${new Date(inv.expiresAt).toLocaleDateString()}` : "Invited"}
                      </span>
                    </span>
                    <form action={revokeInviteAction} className="shrink-0">
                      <input type="hidden" name="invitationId" value={inv.id} />
                      {/* destructiveGhost, not destructive: revoking is a real
                          action but never the point of this list — quiet until
                          hovered, then unmistakably red. */}
                      <Button type="submit" variant="destructiveGhost" size="sm">
                        Revoke
                      </Button>
                    </form>
                  </div>
                  {/* The link WorkOS emailed, surfaced for hand-delivery. It was
                      always in this list response (`acceptInvitationUrl`) and was
                      simply never rendered — which made "invite over Slack" look
                      like a missing feature instead of a missing <CopyField>.
                      Not `isUrl`: that flag exists to catch an unset APP_BASE_URL
                      on OUR urls; this one is WorkOS-hosted and never malformed. */}
                  <div className="mt-2 pl-12">
                    <CopyField
                      label="Invite link — send it any way you like"
                      value={inv.acceptInvitationUrl}
                      hint={`The link is personal: it only admits ${inv.email}. Revoke kills it instantly.`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
