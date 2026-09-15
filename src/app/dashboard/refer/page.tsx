import { Check, Gift, Lock, Sparkles } from "lucide-react";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { CopyField } from "@/components/copy-field";
import { InviteButton } from "@/components/invite-picker";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { MILESTONES, progressFor, referralLink } from "@/lib/referral";
import { ensureReferralCode, referralStats } from "@/lib/referral-store";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * THE REFERRAL PAGE — and it is a GAME BOARD, not a settings screen.
 *
 * The first version of this was three calm cards explaining a link. It was
 * correct and nobody would ever have used it twice, because nothing on it
 * changed between visits. What makes a referral scheme work is not the reward,
 * it is the BAR: a number that moved since last time, a rung you can see the
 * edge of, and one obvious act that moves it.
 *
 * SO THE ORDER IS: how many, how far to the next rung, the act, then the
 * ladder, then the link. The count is the biggest thing on the page even when
 * it is zero — a zero you can see is an invitation; a zero hidden in a sentence
 * is nothing at all.
 *
 * THE LADDER IS A PRODUCT PROMISE and lives in `lib/referral.ts`. It is months
 * of Namzilabs rather than cash, because months are something this product can
 * grant with a flag and cash needs a payout rail, tax handling and a fraud
 * team. A scheme that cannot pay what it advertised is worse than no scheme.
 *
 * WHAT IS REAL TODAY: the code, the link, the capture (`/r/CODE` sets a
 * ninety-day cookie), the attribution (`/callback` writes one row per new
 * account, guarded by a UNIQUE on the referred user) and therefore the count
 * and the bar. What is NOT automatic is FULFILMENT — reaching a rung does not
 * yet flip a billing flag, so the page says a person will sort it rather than
 * implying a robot has.
 */
export default async function ReferPage() {
  const { auth, userId, orgId } = await requireOrg();
  // Written lazily here because this is the only place a link can be obtained,
  // so it is the only place the index row has to exist by.
  const code = await ensureReferralCode(userId);
  const link = referralLink(code, process.env.APP_BASE_URL);
  const { count } = await referralStats(userId);
  const p = progressFor(count);

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader title="Invite & earn" />

        {/* ── THE SCOREBOARD ──────────────────────────────────────────────
            The brand wash rather than a solid fill: this is the biggest object
            on the page and a solid brand rectangle at this size fights every
            number printed on it. */}
        <Card
          variant="surface"
          className="mt-4 border-brand-soft-line bg-brand-soft"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-marker">
                <Sparkles aria-hidden className="size-3.5" />
                {p.earned ? `${p.earned.reward} unlocked` : "Your invites"}
              </p>
              <p className="mt-3 flex items-baseline gap-3">
                {/* THE COUNT IS THE PAGE. `text-banner` is the landing page's
                    one oversized step and this is the only place in the app
                    that borrows it — because this is the only number in the
                    product whose whole job is to make somebody want it to be
                    bigger. */}
                <span className="stat-numeral text-banner leading-none text-foreground">{count}</span>
                <span className="text-lg text-muted-foreground">
                  {count === 1 ? "person joined" : "people joined"}
                </span>
              </p>
              <p className="mt-4 max-w-md text-md leading-relaxed text-muted-foreground">
                {p.next
                  ? `${p.toGo} more and you get ${p.next.reward}.`
                  : "You have finished the ladder. Namzilabs is yours for good."}
              </p>
            </div>

            <div className="shrink-0 lg:text-right">
              <InviteButton link={link} count={count} />
              <p className="mt-2 text-xs text-muted-foreground">Takes about ten seconds.</p>
            </div>
          </div>

          {/* ── THE BAR ──────────────────────────────────────────────────── */}
          {p.next && (
            <div className="mt-8">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold text-foreground">{p.earned?.reward ?? "Start here"}</span>
                <span className="text-muted-foreground">{p.next.reward}</span>
              </div>
              {/* `role="progressbar"` with real values, so the thing that is
                  the whole point of the page is not invisible to a reader who
                  cannot see it fill. */}
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.percent}
                aria-label={`${p.toGo} more invites until ${p.next.reward}`}
                className="mt-2 h-3 w-full overflow-hidden rounded-full bg-background"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-(--duration-slow) ease-(--ease-standard)"
                  style={{ width: `${Math.max(p.percent, count > 0 ? 6 : 0)}%` }}
                />
              </div>
              {/* A SEGMENT COUNT UNDER THE BAR, because a percentage of an
                  invisible span is not a thing anybody can act on — "two more"
                  is. The dots are the rung, not the whole ladder. */}
              <div className="mt-2 flex items-center gap-1.5">
                {Array.from({ length: p.next.at }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={cn("h-1.5 flex-1 rounded-full", i < count ? "bg-primary" : "bg-background")}
                  />
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ── THE LADDER ─────────────────────────────────────────────────── */}
        <h2 className="mt-8 text-lg font-semibold tracking-tight text-foreground">The ladder</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MILESTONES.map((m) => {
            const done = count >= m.at;
            const current = p.next?.at === m.at;
            return (
              <li
                key={m.at}
                className={cn(
                  "flex flex-col gap-2 rounded-card border p-4 transition-colors",
                  done
                    ? "border-success/40 bg-success-soft"
                    : current
                      ? "border-brand-soft-line bg-brand-soft"
                      : "border-border bg-card",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="stat-numeral text-display-xs leading-none text-foreground">{m.at}</span>
                  {done ? (
                    <Check aria-hidden className="size-4 text-success" />
                  ) : current ? (
                    <span className="stat-numeral rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                      {p.toGo} to go
                    </span>
                  ) : (
                    <Lock aria-hidden className="size-4 text-muted-foreground" />
                  )}
                </span>
                <span className="text-md font-semibold text-foreground">{m.reward}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{m.blurb}</span>
              </li>
            );
          })}
        </ul>

        {/* ── THE LINK ───────────────────────────────────────────────────── */}
        <Card variant="surface" className="mt-8">
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
                Anyone who opens this is remembered for 90 days — they can read the site today and sign up next month,
                and it still counts. The code is derived from your account rather than issued, so it never changes and
                never expires.
              </p>
            </div>
          </div>
          <div className="mt-6 max-w-xl">
            <CopyField label="Referral link" value={link} isUrl hint={`Your code is ${code}.`} />
          </div>
        </Card>

        {/**
         * THE SENTENCE THAT KEEPS THE REST OF THE PAGE HONEST, and deliberately
         * not behind an ⓘ. The product's standing rule prefers an icon over
         * subtitle prose, but that rule is about DESCRIPTIONS of controls. This
         * is a limitation of what is being offered, and a limitation somebody
         * has to hover to discover is one they discover later and worse.
         */}
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Counting is automatic — a signup through your link appears above within a minute. Claiming is not yet: reach a
          rung and we apply it to your billing by hand, so give us a day. Referrals are counted once per person, and an
          account has to be new.
        </p>
      </PageContainer>
    </AppShell>
  );
}
