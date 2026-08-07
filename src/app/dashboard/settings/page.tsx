import Link from "next/link";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { CopyField } from "@/components/copy-field";
import { inviteMemberAction, revokeInviteAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

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
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, userId, auth } = await requireOrg();
  const sp = await searchParams;
  const invited = one(sp.invited);
  const inviteError = one(sp.invite_error);

  const workos = getWorkOS();
  // Emails via one org-scoped listUsers, not a getUser per membership: the
  // N+1 here would be one WorkOS round trip per member on every page view.
  const [memberships, orgUsers, invitations] = await Promise.all([
    workos.userManagement.listOrganizationMemberships({ organizationId: orgId, statuses: ["active"], limit: 100 }),
    workos.userManagement.listUsers({ organizationId: orgId, limit: 100 }),
    workos.userManagement.listInvitations({ organizationId: orgId, limit: 100 }),
  ]);
  const emailByUser = new Map(orgUsers.data.map((u) => [u.id, u.email]));
  const members = memberships.data.map((m) => ({
    id: m.id,
    userId: m.userId,
    email: emailByUser.get(m.userId) ?? m.userId,
    role: m.role?.slug ?? "member",
  }));
  const pending = invitations.data.filter((i) => i.state === "pending");

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>

        {invited && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
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
          <div className="mt-6 flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{inviteError}</p>
            <Link href="/dashboard/settings" aria-label="Dismiss" className="font-semibold text-red-400 hover:text-red-700">
              ✕
            </Link>
          </div>
        )}

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Members</h2>
          <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-neutral-800">
                  {m.email}
                  {m.userId === userId && <span className="ml-2 text-xs text-neutral-400">(you)</span>}
                </span>
                <span className="text-xs uppercase tracking-wide text-neutral-400">{m.role}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Invite a teammate</h2>
          <form action={inviteMemberAction} className="flex gap-2">
            <input
              type="email"
              name="email"
              required
              placeholder="teammate@company.com"
              className="w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
            <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              Send invite
            </button>
          </form>
          <p className="mt-2 text-xs text-neutral-500">
            An email with a join link goes out automatically. Rather send it yourself? The same link appears
            under <b>Pending invitations</b> the moment you press Send — copy it into Slack, a text, anywhere.
            Invites expire automatically.
          </p>
        </section>

        {pending.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Pending invitations</h2>
            <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
              {pending.map((inv) => (
                <div key={inv.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-800">
                      {inv.email}
                      {inv.expiresAt && (
                        <span className="ml-2 text-xs text-neutral-400">
                          expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <button type="submit" className="text-sm font-medium text-red-600 hover:underline">
                        Revoke
                      </button>
                    </form>
                  </div>
                  {/* The link WorkOS emailed, surfaced for hand-delivery. It was
                      always in this list response (`acceptInvitationUrl`) and was
                      simply never rendered — which made "invite over Slack" look
                      like a missing feature instead of a missing <CopyField>.
                      Not `isUrl`: that flag exists to catch an unset APP_BASE_URL
                      on OUR urls; this one is WorkOS-hosted and never malformed. */}
                  <div className="mt-2">
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
    </>
  );
}
