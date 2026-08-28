import Link from "next/link";
import { X } from "lucide-react";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth";
import { canManageRanks, claimOwnerIfMissing } from "@/lib/permissions";
import { getDb, getReadDb } from "@/db/client";
import { flows, metrics, rankAssignments, workspaceRanks } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
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
      <PageContainer width="narrow">
        {/* NO LEDE. It listed the three section headings that follow it. */}
        <PageHeader title="Workspace settings" />

        {invited && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-success-soft bg-success-soft/50 p-4 text-base text-success-ink">
            {/* One clause. The banner used to explain that an email goes out
                and that the same link can be copied from Pending invitations —
                and Pending invitations is directly below with the link already
                in a CopyField, labelled "Invite link — send it any way you
                like". A banner narrating the section under it is furniture. */}
            <p>
              Invitation sent to <b>{invited}</b>.
            </p>
            {/* ONE DISMISS CONTROL IN THE PRODUCT. The Apps page's banner
                already spells this as a ghost icon button tinted to its own
                trio; this was a bare glyph on an opacity fade, which is the
                same affordance drawn two ways in two files. */}
            <Link
              href="/dashboard/settings"
              aria-label="Dismiss"
              className={cn(
                buttonVariants({ variant: "ghost", size: "iconSm" }),
                "text-success-ink/70 hover:bg-success-soft hover:text-success-ink",
              )}
            >
              <X />
            </Link>
          </div>
        )}
        {inviteError && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-base text-danger-ink">
            <p>{inviteError}</p>
            <Link
              href="/dashboard/settings"
              aria-label="Dismiss"
              className={cn(
                buttonVariants({ variant: "ghost", size: "iconSm" }),
                "text-danger-ink/70 hover:bg-danger-soft hover:text-danger-ink",
              )}
            >
              <X />
            </Link>
          </div>
        )}

        {/* EVERY SECTION LABEL CARRIES ITS OWN COUNT. "Members" over a list of
            members is a caption; "MEMBERS · 4" is the one fact the heading can
            add that the rows underneath do not already say, and it is what an
            admin opening this page is counting anyway. */}
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <SectionHeading className="mb-0">Members</SectionHeading>
            <Badge className="tnum">{members.length}</Badge>
          </div>
          <Card variant="surface" padding="none" className="divide-y divide-border overflow-hidden">
            {members.map((m) => {
              const rankName = rankNameById.get(rankIdByUser.get(m.userId) ?? "");
              return (
                /* The builder-card anatomy: a round mark, a semibold title, one
                   muted meta line. The OWNER's avatar is the list's single
                   solid-violet accent — like the rail's N. */
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/5">
                  {/* THE TINT PAIR, not an alpha of the fill. `bg-primary/10`
                      carrying `text-primary` is brand-500 at 10% under
                      brand-500 ink — 4.42:1 at best, and the sheet's rule is
                      that the 500 FILLS while the 700 SPEAKS. `accent` /
                      `accent-foreground` is exactly that pair, and it is the
                      one the empty state and the chips already use. The owner
                      keeps the solid fill: one violet block per list, marking
                      identity, like the rail's own mark. */}
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      m.role === "owner" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                    }`}
                    aria-hidden
                  >
                    {initials(m.email)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-md font-semibold text-foreground">{m.email}</span>
                      {m.userId === userId && <span className="shrink-0 text-xs text-muted-foreground">(you)</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{rankName ?? "Full access"}</span>
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
                    {/* THE "MEMBER" BADGE IS GONE, and only that one.
                        The workspace's own access model is called Roles now
                        (the section below, and the picker to the left of this),
                        so a WorkOS role slug rendered as a badge put two
                        different things called a role on one row — the picker
                        said "Setter & Closer" and the badge beside it said
                        "Member", about the same person, meaning unrelated
                        things. "Member" was also the badge on everyone who
                        wasn't the owner, which is a column of identical words.
                        Owner survives because it is a distinct fact that
                        nothing else on the row carries. */}
                    {m.role === "owner" && <StatusPill tone="brand">Owner</StatusPill>}
                  </span>
                </div>
              );
            })}
          </Card>
        </section>

        {isAdmin && (
          <section className="mt-8">
            {/* "Roles" in every string a user reads. The table, the columns and
                every identifier under it stay `rank` — see RanksPanel's own
                note. Renaming those is a migration across the permission model
                for nothing anyone can see. */}
            <div className="mb-3 flex items-center gap-2">
              <SectionHeading className="mb-0">Roles</SectionHeading>
              <Badge className="tnum">{rankRows.length}</Badge>
            </div>
            <RanksPanel ranks={rankRows} memberCounts={memberCounts} catalogue={catalogue} />
          </section>
        )}

        {/* Inviting is governance — hidden with the rank editor. The action
            re-checks server-side; this is the courtesy. */}
        {isAdmin && (
          <section className="mt-8">
            {/* "Invite", not "Invite a teammate" — the field's own placeholder
                is teammate@company.com and the button says Send invite, so the
                heading was saying it a third time. */}
            <SectionHeading>Invite</SectionHeading>
            <Card variant="surface" padding="compact">
              <form action={inviteMemberAction} className="flex flex-wrap gap-2">
                <Input
                  type="email"
                  name="email"
                  required
                  // The ONE field in the app that wants the browser's help: it is
                  // a real email address, and the person sending an invite has
                  // almost certainly typed their colleague's before.
                  autoComplete="email"
                  placeholder="teammate@company.com"
                  className="max-w-sm"
                />
                {/* THE PAGE'S ONE YELLOW. Workspace settings is a page of lists
                    you read and switches you flip; the single ACT it exists for
                    is putting another person in the workspace, and on this sheet
                    that is precisely what the neon is for. Nothing else here
                    takes it — a second yellow would halve the value of this one,
                    and the two destructive controls below are deliberately the
                    quietest things on the page. */}
                <SubmitButton variant="yellow" pendingLabel="Sending…">
                  Send invite
                </SubmitButton>
              </form>
              {/* No note. It said an email goes out, that the link is also
                  copyable from Pending invitations, and that invites expire —
                  and Pending invitations renders directly below with the link
                  in a labelled CopyField and the expiry date on the row. Every
                  clause was a description of the next section down. */}
            </Card>
          </section>
        )}

        {pending.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <SectionHeading className="mb-0">Pending invitations</SectionHeading>
              <Badge className="tnum">{pending.length}</Badge>
            </div>
            <Card variant="surface" padding="none" className="divide-y divide-border">
              {pending.map((inv) => (
                <div key={inv.id} className="px-4 py-3">
                  {/* Same recipe as the Members card: avatar mark, semibold
                      title, one muted meta line, quiet action at the edge —
                      including the tint pair, so a pending row and a member row
                      are the same object at two stages rather than two designs. */}
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                      aria-hidden
                    >
                      {initials(inv.email)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-semibold text-foreground">{inv.email}</span>
                      <span className="block text-xs text-muted-foreground">
                        {inv.expiresAt ? `Invited · expires ${formatDate(new Date(inv.expiresAt))}` : "Invited"}
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
            </Card>
          </section>
        )}
      </PageContainer>
    </AppShell>
  );
}
