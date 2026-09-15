import { PageContainer, SectionHeading } from "@/components/ui/page";
import { ReferBoard } from "@/components/refer-board";
import { MILESTONES } from "@/lib/referral";

/**
 * THE INVITE BOARD, ON A PUBLIC ROUTE.
 *
 * `/dashboard/refer` is behind WorkOS and reads two tables, so nothing outside
 * a session could look at it. This page used to draw a hand-built miniature of
 * the board for that reason — a trough, a fill and some chips — which is the
 * exact failure this repo keeps writing down: the check was green while the
 * real page shipped with an invisible progress bar, because the check was not
 * looking at the real page.
 *
 * So the markup moved into `ReferBoard` and both routes render it. Four counts,
 * chosen to be the ones with edges: nothing yet, mid-rung, a rung exactly
 * reached, and the ladder finished. A fixture with one number proves only that
 * a number renders.
 */
export const dynamic = "force-dynamic";

/**
 * Four counts with edges on them: nothing yet, mid-rung, a rung exactly
 * reached, and the ladder finished. The last one is read FROM the ladder
 * rather than typed, because it was `25` until the lifetime tier came off and
 * a fixture pinned to a rung that no longer exists is a fixture testing the
 * wrong end of the scale.
 */
const CASES = [0, 2, 3, MILESTONES[MILESTONES.length - 1].at];

export default function DesignReferPage() {
  return (
    <div className="min-h-screen bg-canvas-bg py-10">
      <PageContainer>
        <SectionHeading>Invite &amp; earn</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          The real board at four counts. <code>pnpm refer</code> measures the track and drives the invite modal.
        </p>

        {CASES.map((c) => (
          <section key={c} data-refer-case={c} className="mt-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{c} invited</p>
            <ReferBoard link="https://app.namzilabs.com/r/ABC12345" code="ABC12345" count={c} />
          </section>
        ))}
      </PageContainer>
    </div>
  );
}
