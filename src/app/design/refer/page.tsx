import { InviteButton } from "@/components/invite-picker";
import { MILESTONES, progressFor } from "@/lib/referral";
import { PageContainer, SectionHeading } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * THE REFERRAL SURFACES, ON A PUBLIC ROUTE.
 *
 * `/dashboard/refer` is behind WorkOS and reads two tables, so the only things
 * anybody could assert about the bar and the invite modal were that the source
 * files contain certain strings. That is not the same fact as "the bar fills to
 * half at two invites" or "pressing Invite opens a dialog with two choices in
 * it", and the difference is where this feature's bugs will live: it is a
 * progress bar whose width is computed, inside a modal that has to open.
 *
 * FOUR COUNTS, chosen to be the ones with edges: nothing yet, mid-rung, a rung
 * exactly reached, and the ladder finished. A fixture with one number proves
 * only that a number renders.
 */
export const dynamic = "force-dynamic";

const CASES = [0, 2, 3, 25];

function Bar({ count }: { count: number }) {
  const p = progressFor(count);
  return (
    <Card variant="surface" className="border-brand-soft-line bg-brand-soft" data-refer-case={count}>
      <p className="flex items-baseline gap-3">
        <span className="stat-numeral text-display-md leading-none text-foreground" data-refer-count>
          {count}
        </span>
        <span className="text-sm text-muted-foreground">
          {p.next ? `${p.toGo} more for ${p.next.reward}` : "ladder finished"}
        </span>
      </p>
      {p.next && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p.percent}
          aria-label={`${p.toGo} more invites until ${p.next.reward}`}
          className="mt-3 h-3 w-full overflow-hidden rounded-full bg-background"
        >
          <div
            data-refer-fill
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(p.percent, count > 0 ? 6 : 0)}%` }}
          />
        </div>
      )}
      <ul className="mt-4 flex flex-wrap gap-2">
        {MILESTONES.map((m) => (
          <li
            key={m.at}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              count >= m.at ? "border-success/40 bg-success-soft text-success-ink" : "border-border bg-card text-muted-foreground",
            )}
          >
            {m.at} · {m.reward}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function DesignReferPage() {
  return (
    <div className="min-h-screen bg-canvas-bg py-10">
      <PageContainer>
        <SectionHeading>Invite &amp; earn</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          The scoreboard at four counts, and the invite modal. `pnpm refer` drives both.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          {CASES.map((c) => (
            <Bar key={c} count={c} />
          ))}
        </div>

        <SectionHeading className="mt-12">The invite choice</SectionHeading>
        <div className="mt-4" data-refer-invite>
          <InviteButton link="https://app.namzilabs.com/r/ABC12345" count={2} />
        </div>
      </PageContainer>
    </div>
  );
}
