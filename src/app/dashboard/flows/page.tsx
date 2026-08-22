import { Plus, Workflow, X } from "lucide-react";
import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { getReadDb } from "@/db/client";
import { flowState, listFlows } from "@/lib/flow/store";
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
function summarize(f: { id: string; name: string; status: string; publishedVersion: number | null; updatedAt: Date; draftGraph: unknown }) {
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
  const access = await effectiveAccess(getReadDb(), { orgId, userId, role });
  const canCreate = access.can("create_flows");
  const allFlows = await listFlows(getReadDb(), orgId).catch(() => []);
  const flows = allFlows.filter((f) => access.canSeeMetric(`flow:${f.id}`));

  const createForm = canCreate ? (
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
            <p>Your rank doesn&rsquo;t allow editing flows.</p>
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
        <PageHeader
          title="Flows"
          lede="Build metrics visually: connect an app, filter and aggregate, then output to your dashboard."
          actions={createForm}
        />

        {flows.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={<Workflow />}
            title="No flows yet"
            description={
              <>
                Press <span className="font-semibold text-foreground">Create flow</span> to build one step by step.
              </>
            }
            action={createForm}
          />
        ) : (
          <FlowList flows={flows.map(summarize)} />
        )}
      </PageContainer>
    </AppShell>
  );
}
