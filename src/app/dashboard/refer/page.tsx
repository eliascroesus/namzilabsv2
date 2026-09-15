import { Check, Gift } from "lucide-react";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { CopyField } from "@/components/copy-field";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { referralCode, referralLink } from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * SOMEBODY'S OWN LINK, AND WHAT IS AND IS NOT TRUE ABOUT IT TODAY.
 *
 * The rail carries a loud card pointing here, because the owner asked for the
 * product to push referrals hard. This page is what keeps that push honest.
 *
 * THE LINK IS REAL: unique per account, stable forever (`referralCode` derives
 * it from the WorkOS user id, so it is the same link next year and needs no
 * backfill when attribution lands), and it goes to the marketing page.
 *
 * WHAT DOES NOT EXIST YET is the programme: nothing counts a signup against a
 * link, there is no reward and there is no payout. So this page does not say
 * there is. Every landing page in this product is held to "a landing page is
 * the easiest place to lie and the most expensive place to be caught", and a
 * dashboard promising a commission it cannot pay is the same offence with the
 * customer's own money attached.
 *
 * WHAT TO CHANGE WHEN THE TERMS EXIST: the card below gains the offer, and the
 * capture path is a cookie on `/` plus one column recording which code a new
 * account arrived with. The codes handed out today already resolve — that is
 * the reason they are derived rather than minted.
 */
export default async function ReferPage() {
  const { auth, userId, orgId } = await requireOrg();
  const code = referralCode(userId);
  const link = referralLink(code, process.env.APP_BASE_URL);

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader title="Refer Namzilabs" />

        <Card variant="surface" className="mt-4">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-card bg-brand-soft text-marker [&_svg]:size-5"
            >
              <Gift />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Your link</h2>
              <p className="mt-1 max-w-xl text-md leading-relaxed text-muted-foreground">
                Anyone who opens this lands on Namzilabs with your account attached to the visit. It is yours for good —
                the code is derived from your account rather than issued, so it never changes and never expires.
              </p>
            </div>
          </div>

          <div className="mt-6 max-w-xl">
            <CopyField label="Referral link" value={link} isUrl hint={`Your code is ${code}.`} />
          </div>
        </Card>

        <Card variant="surface" className="mt-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Who it is for</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {[
              "Anyone running outbound, a calendar and a CRM that disagree with each other.",
              "Agencies reporting one number to a client out of four dashboards.",
              "Creators whose revenue, audience and email all live in different tools.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-md leading-relaxed text-muted-foreground">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
                {line}
              </li>
            ))}
          </ul>
        </Card>

        {/**
         * THE SENTENCE THAT KEEPS THE REST OF THE PAGE HONEST, and it is
         * deliberately not hidden behind an ⓘ. The product's standing rule is
         * to prefer an icon over subtitle prose — but that rule is about
         * DESCRIPTIONS of controls. This is a limitation of the thing being
         * offered, and a limitation a reader has to hover to discover is one
         * they will discover later and worse.
         */}
        <Card variant="surface" className="mt-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">What happens next</h2>
          <p className="mt-2 max-w-xl text-md leading-relaxed text-muted-foreground">
            Rewards are not switched on yet: today the link works and is yours, but nothing is counting signups against
            it and there is nothing to pay out. When the programme opens, every link already shared keeps working —
            including the ones you send today.
          </p>
        </Card>
      </PageContainer>
    </AppShell>
  );
}
