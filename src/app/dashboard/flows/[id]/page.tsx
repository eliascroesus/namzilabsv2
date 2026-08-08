import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/db/client";
import { getFlow } from "@/lib/flow/store";
import { listConnections } from "@/lib/connections";
import { parseGraph } from "@/lib/flow/types";
import { FlowCanvas, type ConnMeta } from "@/components/flow/flow-canvas";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget — THIS is the segment that governs the canvas's
 * server actions. A server action invoked from a client component POSTs to
 * the page the user is ON, so the inline Test path, the provider-hitting
 * option pickers and Publish (inline materialize) all run under THIS page's
 * config — not flows/page.tsx's, which the timeout test used to pin by
 * mistake while this file ran on the platform default (10s Hobby): exactly
 * the mid-call kill the budget exists to prevent. 60 is the Hobby ceiling;
 * must stay above PROVIDER_CALL_BUDGET_MS (tests/timeout-budgets.test.ts).
 */
export const maxDuration = 60;

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireOrg();

  const flow = await getFlow(getDb(), orgId, id);
  if (!flow) notFound();

  const conns = await listConnections(orgId).catch(() => []);
  // Record types are NOT loaded here: the Configure panel fetches them fresh
  // per connection on open (listRecordTypesAction). The page-render snapshot
  // this used to take went stale the moment a Test synced anything, and cost
  // an org-wide distinct scan on every editor load.
  const connections: ConnMeta[] = conns.map((c) => ({
    id: c.id,
    name: c.name,
    source: c.source,
    syncStatus: c.syncStatus,
  }));

  return (
    // The left rail lives ONLY here, in the canvas/flow view. FlowCanvas keeps its
    // own full-height layout; the wrapper just reserves the width beside the rail.
    <div className="flex h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <FlowCanvas
          flowId={flow.id}
          name={flow.name}
          status={flow.status}
          publishedVersion={flow.publishedVersion}
          initialGraph={parseGraph(flow.draftGraph)}
          connections={connections}
        />
      </div>
    </div>
  );
}
