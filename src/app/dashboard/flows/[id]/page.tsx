import { notFound } from "next/navigation";
import { requireOrg, requestAccess } from "@/lib/auth";
import { getDb } from "@/db/client";
import { getFlow, publishedGraphFingerprint } from "@/lib/flow/store";
import { listConnections } from "@/lib/connections";
import { parseGraph } from "@/lib/flow/types";
import { FlowCanvas, type ConnMeta } from "@/components/flow/flow-canvas";
import { AppShell } from "@/components/app-shell";

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
  const { orgId, userId, role, auth } = await requireOrg();

  const flow = await getFlow(getDb(), orgId, id);
  if (!flow) notFound();
  // Same 404 as a flow that is not there, on purpose: for a rank-restricted
  // member a hidden flow DOES NOT EXIST, and a 403 would confirm it does.
  // The editor renders every step's last computed value, so this page is
  // where "hidden on the dashboard" would otherwise quietly leak.
  const access = await requestAccess(orgId, userId, role);
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
    /**
     * `AppShell`, NOT `AppFrame` — THE BUILDER HAD ITS OWN, EMPTIER RAIL.
     *
     * It reached past the shell to the frame directly, to set one thing: the
     * surface. The canvas pans itself, so the builder clips rather than
     * scrolls. Everything else the shell supplies went with that shortcut —
     * `workspace`, `views` and `account` are all undefined through `AppFrame`,
     * so the column rendered with no workspace switcher at its head, no
     * dashboard view list under it, and no profile at its foot. The owner's
     * words: "it is like we have loaded in a new left navbar on the flow
     * builder and not using the one we use everywhere else". That is exactly
     * what it was.
     *
     * The old note here justified it: "No account panel: it would cost a
     * WorkOS membership fetch per editor load for a control the dashboard is
     * one click away from." The saving is real and it is not worth a second
     * navigation column — the rail is the one thing on screen that must not
     * change when you move between pages, because it is how you move between
     * pages. `surface` and `ownsMain` are props on the shell now, so this
     * route gets its clipping canvas AND the product's own rail.
     */
    <AppShell
      userId={userId}
      orgId={orgId}
      userEmail={auth.user.email}
      ownsMain
      surface="overflow-hidden bg-canvas-bg"
    >
      <FlowCanvas
        flowId={flow.id}
        name={flow.name}
        status={flow.status}
        publishedVersion={flow.publishedVersion}
        publishedFingerprint={publishedFp}
        initialGraph={parseGraph(flow.draftGraph)}
        connections={connections}
      />
    </AppShell>
  );
}
