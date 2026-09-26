"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { planPauses, promoCodes, referrals } from "@/db/schema";
import { requireStaff } from "@/lib/admin/access";
import { recordAudit } from "@/lib/audit";
import { applyPlan, resumePlanPauses } from "@/lib/billing/pauses";
import { isPaidPlan, TRIAL_DAYS } from "@/lib/billing/plans";
import { grantReferralRewards } from "@/lib/billing/referral-rewards";
import { billingEnabled, grantPlan, normaliseCode, revokeGrant } from "@/lib/billing/state";
import { archiveLink, createLink } from "@/lib/growth/links";

/**
 * THE OWNER'S BACK OFFICE — every act behind /admin.
 *
 * `requireStaff()` IS EVERY FUNCTION'S FIRST STATEMENT, not a check further
 * down: a server action is a public endpoint whether or not a page links to
 * it, and nothing may be read or written before the caller is known to be
 * staff. `tests/admin-actions.test.ts` reads this file and fails if any
 * exported function starts with anything else.
 *
 * Every act leaves an `admin.*` audit row: who (the staff member), which
 * workspace or object, and an enum-shaped detail — never the note typed with
 * it, which stays on the grant or code it describes.
 */

const MONTHS = new Set([1, 3, 6, 12, 24]);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (orgId: string, q: string) => `/admin/workspaces/${encodeURIComponent(orgId)}?${q}`;

/** "3" → 3 months; "lifetime" → null; "until" + a future date → that date. Anything else is refused. */
function endOf(fd: FormData, now: Date): { ok: true; endsAt: Date | null; months: number | null } | { ok: false } {
  const duration = str(fd, "duration");
  if (duration === "lifetime") return { ok: true, endsAt: null, months: null };
  if (duration === "until") {
    const d = new Date(`${str(fd, "until")}T23:59:59Z`);
    return Number.isFinite(d.getTime()) && d.getTime() > now.getTime() ? { ok: true, endsAt: d, months: null } : { ok: false };
  }
  const months = Number(duration);
  if (!MONTHS.has(months)) return { ok: false };
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + months);
  return { ok: true, endsAt: d, months };
}

/** Give a workspace a plan — for some months, for life, or until a date. */
export async function grantPlanAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const orgId = str(formData, "orgId");
  const plan = str(formData, "plan");
  if (!orgId) redirect("/admin/search");
  if (!isPaidPlan(plan)) redirect(back(orgId, "error=plan"));
  const now = new Date();
  const end = endOf(formData, now);
  if (!end.ok) redirect(back(orgId, "error=duration"));
  const db = getDb();
  await grantPlan(db, { orgId, plan, kind: "manual", endsAt: end.endsAt, grantedBy: staff.userId, note: str(formData, "note") || null, now });
  await applyPlan(db, orgId).catch(() => {});
  await recordAudit(db, {
    action: "admin.grant",
    orgId,
    actorId: staff.userId,
    target: orgId,
    detail: { plan, months: end.months, lifetime: end.endsAt === null, until: str(formData, "duration") === "until" },
  });
  revalidatePath(`/admin/workspaces/${orgId}`);
  redirect(back(orgId, "done=grant"));
}

/** Take a grant back. Nothing is deleted — it is marked revoked, by whom and when. */
export async function revokeGrantAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const orgId = str(formData, "orgId");
  const grantId = str(formData, "grantId");
  if (!orgId || !grantId) redirect("/admin/search");
  const db = getDb();
  const done = await revokeGrant(db, { grantId, by: staff.userId });
  if (done) {
    await applyPlan(db, orgId).catch(() => {});
    await recordAudit(db, { action: "admin.revoke", orgId, actorId: staff.userId, target: grantId, detail: { revoked: true } });
  }
  revalidatePath(`/admin/workspaces/${orgId}`);
  redirect(back(orgId, done ? "done=revoke" : "error=revoke"));
}

/** A new access code: a plan for some months (or for life), optionally capped and with a redeem-by date. */
export async function createCodeAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const code = normaliseCode(str(formData, "code"));
  if (!code) redirect("/admin/codes?error=code");
  const plan = str(formData, "plan");
  if (!isPaidPlan(plan)) redirect("/admin/codes?error=plan");
  const duration = str(formData, "duration");
  const months = duration === "lifetime" ? null : Number(duration);
  if (months !== null && !MONTHS.has(months)) redirect("/admin/codes?error=duration");
  const capRaw = str(formData, "maxRedemptions");
  const cap = capRaw ? Number(capRaw) : null;
  if (cap !== null && !(Number.isInteger(cap) && cap >= 1 && cap <= 100_000)) redirect("/admin/codes?error=cap");
  const byRaw = str(formData, "redeemBy");
  const redeemBy = byRaw ? new Date(`${byRaw}T23:59:59Z`) : null;
  if (redeemBy && !(Number.isFinite(redeemBy.getTime()) && redeemBy.getTime() > Date.now())) redirect("/admin/codes?error=date");

  const db = getDb();
  const [row] = await db
    .insert(promoCodes)
    .values({ code, plan, months, maxRedemptions: cap, redeemBy, note: str(formData, "note") || null, createdBy: staff.userId })
    .onConflictDoNothing()
    .returning({ id: promoCodes.id });
  if (!row) redirect("/admin/codes?error=taken");
  await recordAudit(db, {
    action: "admin.code_create",
    actorId: staff.userId,
    target: row.id,
    detail: { plan, months, lifetime: months === null, capped: cap !== null, expires: redeemBy !== null },
  });
  revalidatePath("/admin/codes");
  redirect(`/admin/codes?done=create&code=${encodeURIComponent(code)}`);
}

/** Switch a code off (no new redemptions; grants already made are kept) or back on. */
export async function toggleCodeAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const codeId = str(formData, "codeId");
  const disable = str(formData, "disable") === "1";
  if (!codeId) redirect("/admin/codes");
  const db = getDb();
  await db.update(promoCodes).set({ disabledAt: disable ? new Date() : null }).where(eq(promoCodes.id, codeId));
  await recordAudit(db, { action: "admin.code_toggle", actorId: staff.userId, target: codeId, detail: { disabled: disable } });
  revalidatePath("/admin/codes");
  redirect(`/admin/codes?done=${disable ? "disable" : "enable"}`);
}

/** A new tracking link at /go/<slug>. */
export async function createLinkAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const db = getDb();
  const r = await createLink(db, {
    label: str(formData, "label"),
    slug: str(formData, "slug"),
    source: str(formData, "source"),
    medium: str(formData, "medium"),
    campaign: str(formData, "campaign") || null,
    destination: str(formData, "destination") || "/",
    createdBy: staff.userId,
  });
  if (!r.ok) redirect(`/admin/links?error=${r.error}`);
  await recordAudit(db, {
    action: "admin.link_create",
    actorId: staff.userId,
    target: r.link.id,
    detail: { source: r.link.source, medium: r.link.medium, campaign: r.link.campaign !== null },
  });
  revalidatePath("/admin/links");
  redirect(`/admin/links?done=create&slug=${encodeURIComponent(r.link.slug)}`);
}

/** Archive a link: it stops redirecting (visitors go home) and keeps its history. */
export async function archiveLinkAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const linkId = str(formData, "linkId");
  if (!linkId) redirect("/admin/links");
  const db = getDb();
  await archiveLink(db, linkId);
  await recordAudit(db, { action: "admin.link_archive", actorId: staff.userId, target: linkId, detail: { archived: true } });
  revalidatePath("/admin/links");
  redirect("/admin/links?done=archive");
}

const rowsOf = <T,>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];

/**
 * LAUNCH — every workspace with no plan gets 30 days of Growth (kind
 * `launch`), once. One statement for the whole fleet, so the button cannot
 * time out on a large one: a workspace with a live subscription or any grant
 * in force is skipped, and the unique index on (org) where kind = 'launch'
 * makes a second press a no-op. Then every referral reward earned so far is
 * paid (`grantReferralRewards` otherwise pays only while billing is on).
 *
 * PRESSED BEFORE BILLING IS SWITCHED ON, AND ONCE AFTER. Granting first means
 * no workspace is ever on Free at the moment billing comes on — members past
 * one seat would be sent to /seat, metrics past five locked, apps past three
 * paused. The second press picks up any workspace made in between.
 */
export async function startLaunchTrialsAction(): Promise<void> {
  const staff = await requireStaff();
  const db = getDb();
  const now = new Date();
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  const granted = rowsOf<{ org_id: string }>(
    await db.execute(sql`
      insert into access_grants (org_id, plan, kind, starts_at, ends_at, granted_by, note)
      select o.org_id, 'growth', 'launch', ${now.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, ${staff.userId}, 'Launch trial'
      from workspace_owners o
      where not exists (
        select 1 from billing_subscriptions s
        where s.org_id = o.org_id and s.status in ('active', 'trialing', 'past_due')
      )
      and not exists (
        select 1 from access_grants g
        where g.org_id = o.org_id and g.revoked_at is null
          and g.starts_at <= ${now.toISOString()}::timestamptz
          and (g.ends_at is null or g.ends_at > ${now.toISOString()}::timestamptz)
      )
      on conflict do nothing
      returning org_id
    `),
  ).map((r) => r.org_id);

  // Only workspaces with apps paused by their old plan need resuming.
  if (granted.length > 0) {
    const paused = await db.selectDistinct({ orgId: planPauses.orgId }).from(planPauses).where(inArray(planPauses.orgId, granted));
    for (const { orgId } of paused) await applyPlan(db, orgId).catch(() => {});
  }

  const referrers = await db.selectDistinct({ userId: referrals.referrerUserId }).from(referrals);
  let rewarded = 0;
  for (const { userId } of referrers) {
    const out = await grantReferralRewards(db, userId, { now, evenIfBillingOff: true }).catch(() => []);
    rewarded += out.filter((o) => o.form !== "failed").length;
  }

  await recordAudit(db, { action: "admin.launch_trials", actorId: staff.userId, detail: { granted: granted.length, rewarded } });
  revalidatePath("/admin");
  redirect(`/admin?launched=${granted.length}&rewarded=${rewarded}`);
}

/**
 * THE KILL SWITCH'S OTHER HALF. Switching BILLING_ENABLED off stops every
 * limit at once — but an app a plan already paused stays paused: its year-9999
 * pause never falls due, and only a plan change lifts it. This lifts all of
 * them (with billing off, `resumePlanPauses` resumes everything it recorded).
 * Refused while billing is on, where the plan decides what stays paused.
 */
export async function resumePlanPausesAction(): Promise<void> {
  const staff = await requireStaff();
  if (billingEnabled()) redirect("/admin?error=billing_on");
  const db = getDb();
  const orgs = await db.selectDistinct({ orgId: planPauses.orgId }).from(planPauses);
  let resumed = 0;
  for (const { orgId } of orgs) resumed += await resumePlanPauses(db, orgId).catch(() => 0);
  await recordAudit(db, { action: "admin.resume_pauses", actorId: staff.userId, detail: { resumed, workspaces: orgs.length } });
  revalidatePath("/admin");
  redirect(`/admin?resumed=${resumed}`);
}
