import type * as React from "react";
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
import { ThemeChoice } from "@/components/theme";

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
 * WHOSE ROW IS WHOSE, IN COLOUR — and the one place this page spends the
 * sheet's decorative set.
 *
 * Every avatar used to be the same violet tint, which is a column of identical
 * discs: it marked nothing, because a mark that is the same on every row is
 * furniture. These are the sheet's three DECORATIVE accents (peri, pink,
 * orange), which say WHICH and never HOW IT IS GOING — exactly what an avatar
 * is for. There is no yellow among them because yellow LEFT the decorative set
 * when it became the brand: `--color-accent-yellow` was deleted, and anything
 * that wants it now asks for `--primary` by name. The owner's disc below does
 * exactly that.
 *
 * Keyed by the email rather than by list position, so a person's colour does
 * not change when somebody above them is removed.
 *
 * ALL THREE CARRY BLACK INK, which is where this parts company with
 * `StatusPill`'s tones. That component sets white on orange and on peri, and it
 * can: its labels are short caps over a wide pill. These are two letters at
 * 12px, and white measures 2.9:1 on the orange and 2.6:1 on the peri. The
 * sheet sets black on its bright fills everywhere it draws them.
 */
const AVATAR_TONES = ["bg-accent-peri", "bg-accent-pink", "bg-accent-orange"];
const avatarTone = (email: string) => {
  let n = 0;
  for (const ch of email) n = (n + ch.charCodeAt(0)) % 9973;
  return `${AVATAR_TONES[n % AVATAR_TONES.length]} text-neutral-900`;
};

/**
 * ONE SECTION, ONE CARD, ONE HEADER RECIPE.
 *
 * This page was three bare stacks: an eyebrow, then a box, then 32px of air,
 * then the next one — so nothing on it said what any section was FOR, and the
 * only structure was the gap between them. Every section is now a white island
 * with a head: the sheet's micro voice (12px, ALL CAPS, tracking) set in
 * `foreground` rather than the eyebrow's muted grey, because inside a card this
 * label is the card's TITLE and not a caption floating above it; the count
 * beside it; and exactly one line of description underneath.
 *
 * The description has one job — say the thing the rows below cannot. "Everyone
 * with an active seat" over a list of seats would be a caption; the rule that
 * an unranked member sees everything is a fact the list has no way to state.
 */
function SettingsSection({
  label,
  count,
  description,
  bodyClassName,
  children,
}: {
  label: string;
  count?: number;
  description: string;
  /** The body's own fill — see the Roles call site for the page's one recess. */
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {/* `overflow-hidden` keeps the row hover tint and the recessed tray
          inside the card's 16px corners. Nothing here pops over an edge: the
          delete confirm is inline and the role picker is a native select. */}
      <Card variant="surface" padding="none" className="overflow-hidden">
        <header className="px-5 py-4">
          <div className="flex items-center gap-2">
            <SectionHeading className="mb-0 text-foreground">{label}</SectionHeading>
            {count !== undefined && <Badge className="tnum">{count}</Badge>}
          </div>
          {/* `max-w-2xl` is what PageHeader caps its lede at, for the same
              reason and with the same number: a sentence run the full width of
              the container is roughly twice a readable measure. One spelling
              for one job. */}
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </header>
        <div className={cn("border-t border-border", bodyClassName)}>{children}</div>
      </Card>
    </section>
  );
}

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
 *
 * THE ORDER IS THE STORY A WORKSPACE ADMIN IS ACTUALLY TELLING: who is here,
 * how another person gets here, who is on the way, and what any of them are
 * allowed to see. Roles used to sit second — between the member list and the
 * invite box — which put the page's densest control in the middle of a
 * two-sentence errand.
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

  /**
   * THE MEMBER ROW IS A GRID, and that is the whole point of it.
   *
   * It was a flex row: avatar, then a growing name block, then whatever
   * controls the row happened to have, packed to the right. So the role
   * pickers stepped in and out by however long each email was, and a list of
   * six members had six left edges on its one interactive column.
   *
   * Three tracks — the 36px mark, the identity, and a fixed 176px for the
   * control — so every picker starts on the same line down the card. Below
   * `sm` the third track is gone and the picker drops to a second row under
   * the identity (`col-start-2`), which is the only way 176px of select and a
   * truncating email both fit on a phone.
   */
  const memberRow = cn(
    "grid items-center gap-x-3.5 gap-y-2 px-5 py-3 transition-colors duration-(--duration-fast) hover:bg-foreground/5",
    isAdmin ? "grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[2.25rem_minmax(0,1fr)_11rem]" : "grid-cols-[2.25rem_minmax(0,1fr)]",
  );

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* NARROW STAYS. This is a page of lists you read and switches you flip,
          and at the 1152px default the role picker on a member row would sit
          the better part of a metre from the name it belongs to. `narrow` is
          what PageContainer calls the form measure, and the sections use their
          full width rather than the page borrowing more of it. */}
      <PageContainer width="narrow">
        {/* NO LEDE. It listed the three section headings that follow it — and
            now every one of those headings carries its own line of description,
            so a lede could only say all of it a third time. */}
        <PageHeader title="Workspace settings" />

        {invited && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-success-soft bg-success-soft/50 p-4 text-sm text-success-ink">
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
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink">
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

        <div className="mt-6 flex flex-col gap-4">
          <SettingsSection
            label="Members"
            count={members.length}
            description="Everyone with an active seat. A role limits what its holder sees; without one, they see everything."
          >
            <div className="divide-y divide-border">
              {members.map((m) => {
                const rankName = rankNameById.get(rankIdByUser.get(m.userId) ?? "");
                return (
                  <div key={m.id} className={memberRow}>
                    {/* THE OWNER TAKES THE BRAND FILL — one branded block per
                        list, marking identity, like the rail's own mark, and a
                        filled disc under near-black ink is the shape the yellow
                        is measured in (11.24:1). The rest wear the decorative
                        set (see AVATAR_TONES): round, because on this page a
                        CIRCLE is a person and a rounded SQUARE is a thing (the
                        role marks in the panel below use the same three colours
                        in the other shape). */}
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full text-xs font-semibold",
                        m.role === "owner" ? "bg-primary text-primary-foreground" : avatarTone(m.email),
                      )}
                      aria-hidden
                    >
                      {initials(m.email)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{m.email}</span>
                        {m.userId === userId && <span className="shrink-0 text-xs text-muted-foreground">(you)</span>}
                        {/* THE "MEMBER" BADGE IS GONE, and only that one.
                            The workspace's own access model is called Roles now
                            (the section below, and the picker on this row), so a
                            WorkOS role slug rendered as a badge put two different
                            things called a role on one row — the picker said
                            "Setter & Closer" and the badge beside it said
                            "Member", about the same person, meaning unrelated
                            things. Owner survives because it is a distinct fact
                            that nothing else on the row carries. */}
                        {m.role === "owner" && <StatusPill tone="brand">Owner</StatusPill>}
                      </span>
                      {/* THE META LINE IS FOR THE PEOPLE WHO HAVE NO PICKER.
                          An admin gets the select one track over, which already
                          reads "Full access" or the role's name — so printing
                          the same words under the email was the row saying one
                          fact twice, in two type sizes. */}
                      {!isAdmin && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">{rankName ?? "Full access"}</span>
                      )}
                    </span>
                    {/* Admins assign roles in place; everyone else just sees
                        them (the meta line above). An admin picking a role for
                        another admin is allowed and harmless — admins are
                        never restricted, even with a role assigned. */}
                    {isAdmin && (
                      <span className="col-start-2 sm:col-start-3">
                        <MemberRankSelect
                          memberUserId={m.userId}
                          rankId={rankIdByUser.get(m.userId) ?? null}
                          ranks={rankOptions}
                        />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </SettingsSection>

          {/* Inviting is governance — hidden with the rank editor. The action
              re-checks server-side; this is the courtesy. */}
          {isAdmin && (
            <SettingsSection
              label="Invite"
              description="WorkOS sends the email and hosts the link. It is personal: only the address typed here can use it."
            >
              {/* THE FORM IS A SECTION NOW, not a field floating in a box. It
                  sits under the header's hairline with the card's own padding,
                  so the invite row starts on the same left edge as every member
                  row above it. */}
              <form action={inviteMemberAction} className="flex flex-wrap items-center gap-2.5 px-5 py-4">
                <Input
                  type="email"
                  name="email"
                  required
                  // The ONE field in the app that wants the browser's help: it is
                  // a real email address, and the person sending an invite has
                  // almost certainly typed their colleague's before.
                  autoComplete="email"
                  placeholder="teammate@company.com"
                  aria-label="Teammate's email address"
                  className="min-w-0 flex-1 sm:max-w-sm"
                />
                {/* THE PAGE'S ACT, IN THE BRAND. Workspace settings is a page of
                    lists you read and switches you flip; the single ACT it
                    exists for is putting another person in the workspace, which
                    is precisely what `accent` is reserved for.
                    WHAT CHANGED IS THE REASON IT IS SAFE. It used to be a count
                    — nothing else on this page may take the yellow, because a
                    second one halves the value of the first — and that rule was
                    retired because nothing could check it. What holds now is
                    that this is a FILLED control under near-black ink at
                    11.24:1, which is the only shape the brand is allowed to take
                    at all. The owner's disc above is the same fill and does not
                    compete with it: an avatar is identity and a button is an
                    act. The destructive controls below are ghosts, which is what
                    keeps them the quietest things on the page. */}
                <SubmitButton variant="accent" pendingLabel="Sending…">
                  Send invite
                </SubmitButton>
              </form>
            </SettingsSection>
          )}

          {pending.length > 0 && (
            <SettingsSection
              label="Pending invitations"
              count={pending.length}
              description="Sent and not accepted yet. Revoking one kills its link immediately, wherever it was pasted."
            >
              <div className="divide-y divide-border">
                {pending.map((inv) => (
                  /* The member row's grid, one track wider: the revoke sits in
                     its own column, and the link spans from the identity track
                     to the edge so it lines up with the email above it rather
                     than with a hand-typed indent. */
                  <div
                    key={inv.id}
                    className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 px-5 pb-1.5 pt-3.5"
                  >
                    {/* DASHED AND NEUTRAL — the one avatar on the page with no
                        colour in it. A pending invitee is not a member yet, and
                        the same dashed-outline idiom marks the empty slot at the
                        foot of the roles list. */}
                    <span
                      className="flex size-9 items-center justify-center rounded-full border border-dashed border-border bg-muted text-xs font-semibold text-muted-foreground"
                      aria-hidden
                    >
                      {initials(inv.email)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{inv.email}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {inv.expiresAt ? `Invited · expires ${formatDate(new Date(inv.expiresAt))}` : "Invited"}
                      </span>
                    </span>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      {/* destructiveGhost, not destructive: revoking is a real
                          action but never the point of this list — quiet until
                          hovered, then unmistakably red. */}
                      <Button type="submit" variant="destructiveGhost" size="sm">
                        Revoke
                      </Button>
                    </form>
                    {/* The link WorkOS emailed, surfaced for hand-delivery. It was
                        always in this list response (`acceptInvitationUrl`) and was
                        simply never rendered — which made "invite over Slack" look
                        like a missing feature instead of a missing <CopyField>.
                        Not `isUrl`: that flag exists to catch an unset APP_BASE_URL
                        on OUR urls; this one is WorkOS-hosted and never malformed. */}
                    <div className="col-span-2 col-start-2">
                      <CopyField
                        label="Invite link — send it any way you like"
                        value={inv.acceptInvitationUrl}
                        hint={`The link is personal: it only admits ${inv.email}. Revoke kills it instantly.`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SettingsSection>
          )}

          {isAdmin && (
            /* "Roles" in every string a user reads. The table, the columns and
               every identifier under it stay `rank` — see RanksPanel's own
               note. Renaming those is a migration across the permission model
               for nothing anyone can see. */
            <SettingsSection
              label="Roles"
              count={rankRows.length}
              description="Named bundles of permissions and metric visibility, assigned to a member from the list above."
              /**
               * THE PAGE'S ONE RECESSED SECTION, and the reason the rest of it
               * is white.
               *
               * Off-white is the app's page colour, which is exactly why it
               * must not be a card's default fill as well: a surface that is
               * the same value as the thing behind it has no presence, and a
               * page where everything is that value has no depth at all. It
               * earns its place in ONE spot — as a TRAY, cut into a white card,
               * holding cards of its own. Miro's template strip is the
               * reference: the recess says "these are items in a container",
               * which is precisely what a list of roles is and what a list of
               * members is not.
               *
               * `bg-muted` rather than `bg-background`: same #f5f5f5, and
               * `muted` is the token that means "recessed surface" (globals.css
               * says so on the line that declares it), so a theme that moves
               * the page does not silently move this tray with it.
               */
              bodyClassName="bg-muted p-4"
            >
              <RanksPanel ranks={rankRows} memberCounts={memberCounts} catalogue={catalogue} />
            </SettingsSection>
          )}

          {/* APPEARANCE — the one section on this page that is not about the
              WORKSPACE.
              Everything above it is shared state: who is a member, what a rank
              may do, which apps are connected. This is a preference held per
              PERSON and per DEVICE (see theme.tsx), so it is last and it says
              so in its own description — a customer who reads "Roles" and then
              "Appearance" should not have to wonder whether they are about to
              change what their colleagues see.
              It is NOT gated on a rank for the same reason. Every other section
              here is behind `can(...)`; a theme is not a permission. */}
          <SettingsSection
            label="Appearance"
            description="How Namzilabs looks on this device. Your choice is remembered here and does not change what anyone else sees."
            bodyClassName="p-4"
          >
            <ThemeChoice />
          </SettingsSection>
        </div>
      </PageContainer>
    </AppShell>
  );
}
