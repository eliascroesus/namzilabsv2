import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
import { getFlow, publishedGraphFingerprint } from "@/lib/flow/store";
import { listConnections } from "@/lib/connections";
import { parseGraph } from "@/lib/flow/types";
import { FlowCanvas, type ConnMeta } from "@/components/flow/flow-canvas";
import { AppFrame } from "@/components/app-frame";

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
  const { orgId, userId, role } = await requireOrg();

  const flow = await getFlow(getDb(), orgId, id);
  if (!flow) notFound();
  // Same 404 as a flow that is not there, on purpose: for a rank-restricted
  // member a hidden flow DOES NOT EXIST, and a 403 would confirm it does.
  // The editor renders every step's last computed value, so this page is
  // where "hidden on the dashboard" would otherwise quietly leak.
  const access = await effectiveAccess(getDb(), { orgId, userId, role });
  if (!access.canSeeMetric(`flow:${id}`)) notFound();

  /**
   * WHAT THE DASHBOARD IS ACTUALLY COMPUTING FROM, so the toolbar can say
   * whether the draft still agrees with it.
   *
   * Hashed in the query rather than read out of it: the answer has to survive
   * every edit the user makes without a round trip, so the canvas gets the
   * published version's FINGERPRINT and re-fingerprints the draft as it
   * changes — and the projection keeps every step's cached Test payload in the
   * database (see `graphForFingerprint`). Only for a flow that has something
   * live to differ from.
   *
   * Guarded like its sibling below, and for the stronger reason: this decides
   * whether a PILL is shown. A version cut before a schema change can fail to
   * parse, and that must degrade to no fingerprint — whereupon the toolbar
   * warns rather than claiming the edits are live — never to no editor.
   */
  const publishedFp =
    flow.publishedVersion != null
      ? await publishedGraphFingerprint(getDb(), orgId, id, flow.publishedVersion).catch(() => null)
      : null;

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
    // The same frame every other screen has. The chrome that belongs to the
    // FLOW floats on the canvas (FlowToolbar); the chrome that belongs to the
    // APP is the rail — hiding it here left the editor with a bare left edge
    // and navigation buried in a ⋮ menu.
    // The builder does not scroll: the canvas pans itself, so this surface
    // clips rather than scrolls, and sits on the canvas grey rather than white.
    // No account panel: it would cost a WorkOS membership fetch per editor
    // load for a control the dashboard is one click away from.
    <AppFrame framed surface="overflow-hidden bg-canvas-bg">
      <FlowCanvas
        flowId={flow.id}
        name={flow.name}
        status={flow.status}
        publishedVersion={flow.publishedVersion}
        publishedFingerprint={publishedFp}
        initialGraph={parseGraph(flow.draftGraph)}
        connections={connections}
      />
    </AppFrame>
  );
}
