import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/db/client";
import { getFlow } from "@/lib/flow/store";
import { listConnections } from "@/lib/connections";
import { events } from "@/db/schema";
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

  const db = getDb();
  const conns = await listConnections(orgId).catch(() => []);
  const typeRows = await db
    .selectDistinct({ connectionId: events.connectionId, eventType: events.eventType })
    .from(events)
    .where(and(eq(events.orgId, orgId), isNull(events.deletedAt)))
    .catch(() => [] as { connectionId: string; eventType: string }[]);

  const typesByConn = new Map<string, string[]>();
  for (const r of typeRows) {
    if (!typesByConn.has(r.connectionId)) typesByConn.set(r.connectionId, []);
    typesByConn.get(r.connectionId)!.push(r.eventType);
  }

  const connections: ConnMeta[] = conns.map((c) => ({
    id: c.id,
    name: c.name,
    source: c.source,
    eventTypes: (typesByConn.get(c.id) ?? []).sort(),
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
