import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/db/client";
import { getFlow } from "@/lib/flow/store";
import { listConnections } from "@/lib/connections";
import { events } from "@/db/schema";
import { parseGraph } from "@/lib/flow/types";
import { FlowCanvas, type ConnMeta } from "@/components/flow/flow-canvas";

export const dynamic = "force-dynamic";

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
    <FlowCanvas
      flowId={flow.id}
      name={flow.name}
      status={flow.status}
      publishedVersion={flow.publishedVersion}
      initialGraph={parseGraph(flow.draftGraph)}
      connections={connections}
    />
  );
}
