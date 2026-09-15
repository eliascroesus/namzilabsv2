import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { InfoTip } from "@/components/ui/info-tip";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { ReferBoard } from "@/components/refer-board";
import { referralLink } from "@/lib/referral";
import { ensureReferralCode, referralStats } from "@/lib/referral-store";

export const dynamic = "force-dynamic";

/**
 * THE REFERRAL PAGE — a game board, not a settings screen.
 *
 * The markup is in `ReferBoard` so that `/design/refer` can render the SAME
 * thing on a public route; this file is the data and the frame.
 *
 * EVERY EXPLANATORY SENTENCE IS BEHIND THE ⓘ, at the owner's ask and following
 * the rule already applied to the tile settings and the flow builder's field
 * picker: descriptions go behind an icon, the surface keeps the thing itself.
 *
 * WHAT IS IN THERE IS NOT DECORATION. Three of the four lines are limits on an
 * offer — the ninety-day window, once per person, new accounts only — and the
 * fourth is that FULFILMENT IS MANUAL. Reaching a rung does not flip a billing
 * flag today, and a scheme that lets somebody believe it does is one that gets
 * found out by the first customer who reaches one. Moving it behind a hover was
 * the instruction; deleting it was not, and it is the difference between a
 * tidy page and a page that misleads.
 */
export default async function ReferPage() {
  const { auth, userId, orgId } = await requireOrg();
  // Written lazily here because this is the only place a link can be obtained,
  // so it is the only place the index row has to exist by.
  const code = await ensureReferralCode(userId);
  const link = referralLink(code, process.env.APP_BASE_URL);
  const { count } = await referralStats(userId);

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              Invite &amp; earn
              <InfoTip label="Invite &amp; earn">
                Anyone who opens your link is remembered for 90 days. A signup counts once per person, and only for a
                new account. Counting is automatic; claiming is not yet — reach a rung and we apply it to your billing
                by hand.
              </InfoTip>
            </span>
          }
        />
        <ReferBoard link={link} code={code} count={count} />
      </PageContainer>
    </AppShell>
  );
}
