import { Plus, Workflow, X } from "lucide-react";
import Link from "next/link";
import { requireOrg, requestAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { getReadDb } from "@/db/client";
import { flowState, listFlows } from "@/lib/flow/store";
import { unpublishedFlowIds } from "@/lib/flow/materialize";
import { parseGraph } from "@/lib/flow/types";
import { catalogEntry } from "@/connectors/catalog";
import { createFlowAction } from "./actions";
import { FlowList } from "./FlowRow";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget. This segment governs ONLY the flows list and
 * `createFlowAction` — a server action runs under the page the user is ON,
 * so the canvas's Test path, option pickers and Publish are governed by
 * `flows/[id]/page.tsx`'s declaration, not this one. (An earlier comment
 * here claimed otherwise, and the timeout test pinned this file while the
 * canvas ran on the platform default — the exact outage the pin exists to
 * prevent.) Kept because it costs nothing and createFlowAction does DB work.
 */
export const maxDuration = 60;


type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

/**
 * The row's subtitle and icon, derived from the graph the list already loaded.
 *
 * `flows.description` exists on the table and has never been written, so a
 * stored subtitle would be blank on every row. What a person actually wants
 * to know at a glance is how big the flow is and what it reads — both of
 * which the draft graph already says. Parsed through `parseGraph`, the same
 * choke point every other load path uses, so a legacy graph reads correctly
 * here too.
 */
function summarize(
  f: { id: string; name: string; status: string; publishedVersion: number | null; updatedAt: Date; draftGraph: unknown },
  unpublished: Set<string>,
) {
  let steps = 0;
  let sources: string[] = [];
  try {
    const g = parseGraph(f.draftGraph);
    steps = g.nodes.length;
    sources = [
      ...new Set(
        g.nodes
          .filter((n) => n.type === "app")
          .map((n) => String((n.data.config as { source?: unknown } | undefined)?.source ?? ""))
          .filter(Boolean),
      ),
    ];
  } catch {
    // A graph that will not parse is still a row the user must be able to
    // open and fix — it just has nothing to summarise.
  }
  const names = sources.map((s) => catalogEntry(s)?.name ?? s);
  const summary = steps === 0 ? "Empty — nothing built yet" : `${steps} step${steps === 1 ? "" : "s"}${names.length ? ` · ${names.join(", ")}` : ""}`;
  return {
    id: f.id,
    name: f.name,
    state: flowState(f),
    updatedAt: new Date(f.updatedAt).toISOString(),
    summary,
    source: sources[0] ?? null,
    // The third place this has to agree with: the toolbar says it while you
    // edit, the tile says it on the dashboard, and a list of flows is where
    // someone goes to ask "which of these is actually live?".
    unpublished: unpublished.has(f.id),
  };
}

export default async function FlowsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, userId, role, auth } = await requireOrg();
  const sp = await searchParams;
  // The list stays readable — viewing is not editing — but only of the flows
  // the member's rank can SEE. The editor shows a flow's computed numbers
  // (lastTest on every card), so "hidden tile, visible flow" was a leak with a
  // corridor to it; for a rank-restricted member a hidden flow does not exist
  // here, in the editor, or in any action. Create follows create_flows; the
  // action itself is gated server-side, the button is the courtesy.
  const access = await requestAccess(orgId, userId, role);
  const canCreate = access.can("create_flows");
  // `null` means the read FAILED; `[]` means the workspace is genuinely empty.
  // Collapsing both to `[]` is what made a database outage render as "No flows
  // yet — press Create flow", i.e. the product telling a customer their work is
  // gone. The exception goes to the log, never to the page.
  const allFlows = await listFlows(getReadDb(), orgId).catch((err) => {
    console.error("[flows] list read failed", err);
    return null;
  });
  const flowsUnavailable = allFlows === null;
  const flows = (allFlows ?? []).filter((f) => access.canSeeMetric(`flow:${f.id}`));
  // One pass for the whole list — the same answer the dashboard shows and the
  // same rule the editor's toolbar applies, so no two surfaces can disagree.
  const unpublished = await unpublishedFlowIds(getReadDb(), orgId).catch(() => new Set<string>());

  /**
   * ONE ACT, TWO PLACES, AND THE SAME BUTTON IN BOTH — BLACK, NOT NEON.
   *
   * The header's Create was the yellow hero on the argument that "Create flow"
   * is the single thing this screen exists to let you do. That argument holds
   * for a landing page and it does not hold here. The sheet's rule is at most
   * one yellow per screen because the scarcity IS the meaning, and the thing
   * that makes it mean anything is that the yellow is the LOUDEST thing in
   * view. On a page whose whole body is a list you came to read — a list where
   * the violet already marks the row under your pointer and every connector
   * chip carries its vendor's colour — a neon block in the top right is the
   * loudest thing on a screen that has plenty to say, competing with the
   * content rather than crowning it.
   *
   * So it takes the workhorse black, which is what the sheet gives to the
   * default action everywhere else, and the yellow stays where it is worth
   * something. Both call sites are the same button now: two blacks on one page
   * is the workhorse doing its job, which is the one colour the ratio rule
   * expects to see more than once.
   */
  const createButton = () =>
    canCreate ? (
      <form action={createFlowAction}>
        <Button>
          <Plus size={16} strokeWidth={2} />
          Create flow
        </Button>
      </form>
    ) : null;

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        {one(sp.error) === "rank" && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-base text-danger-ink">
            <p>Your role doesn&rsquo;t allow editing flows.</p>
            <Link
              href="/dashboard/flows"
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
        {one(sp.error) === "flow_limit" && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-base text-danger-ink">
            <p>This workspace has reached its flow limit, so nothing was created. Contact us and we&rsquo;ll raise it.</p>
            <Link
              href="/dashboard/flows"
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
        {/* NO LEDE. It described the builder to someone standing outside it,
            which is the one audience that cannot use the description — and the
            empty state below already says the only thing a first-timer needs
            ("Press Create flow to build one step by step"), where they need it. */}
        {/* THE SECTION WEARS ITS OWN COLOUR, and it is not a new one: the rail
            paints the Flows row periwinkle (`bg-accent-peri text-white`, see
            NAV in sidebar.tsx), so the page it leads to now carries the same
            mark beside its title. That is the whole trick — the chip is not
            decoration for its own sake, it is the rail's item arriving at its
            destination, which is what makes a product feel like one place
            rather than a set of routes. `aria-hidden`, so the h1's accessible
            name is still the word "Flows". */}
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-card bg-accent-peri text-white [&_svg]:size-[18px]"
              >
                <Workflow strokeWidth={2.25} />
              </span>
              Flows
            </span>
          }
          actions={createButton()}
        />

        {flowsUnavailable ? (
          <EmptyState
            className="mt-8"
            icon={<Workflow />}
            title="Your flows couldn’t be loaded"
            description="This is a problem on our side, not a change to your workspace — nothing has been deleted. Refresh to try again."
          />
        ) : flows.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={<Workflow />}
            title="No flows yet"
            description={
              <>
                Press <span className="font-semibold text-foreground">Create flow</span> to build one step by step.
              </>
            }
            action={createButton()}
          />
        ) : (
          <FlowList flows={flows.map((f) => summarize(f, unpublished))} />
        )}
      </PageContainer>
    </AppShell>
  );
}
