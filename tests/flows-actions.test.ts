import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { flowResults, flows, flowVersions, rankAssignments, workspaceRanks } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * `refreshAllFlowsAction` — THE RANK GATE ON A FLEET-WIDE WRITE.
 *
 * `refreshFlowAction` (the per-tile button) already no-ops on a flow a
 * rank-restricted member cannot see — a hidden flow does not exist for them.
 * "Refresh all" skipped that gate entirely: it marked every `flow_results` row
 * in the org stale unconditionally, so a member confined to one flow tile
 * could still force every OTHER flow in the workspace to recompute. Worse,
 * the STALE MARK ITSELF is a signal — a hidden flow's status flipping when a
 * restricted member clicks a button is exactly the kind of leak canSeeMetric
 * exists to prevent, independent of whether materialize ever gets to it.
 */

let db: DB;
let close: () => Promise<void>;
let ctx = { orgId: "org_a", userId: "user_1", role: "member" as string | undefined };

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { refreshAllFlowsAction } = await import("@/app/dashboard/flows/actions");

const A = "org_a";

/**
 * A published flow with one `fresh` flow_results row. The graph is the same
 * minimal shape `materialize-stale.test.ts` uses: it runs (so a materialize
 * pass really executes, not a stub) but produces no dashboard tile, so a
 * recompute settles the row on "error" — the honest outcome, and it says
 * nothing about the property under test, which is whether the row was
 * touched AT ALL.
 */
async function publishedFlow(name: string): Promise<string> {
  const connId = await seedConnection(db, { orgId: A, source: "webhook" });
  const graph = {
    nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source: "webhook" } } }],
    edges: [],
    metrics: [],
  };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: A, name, draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: A, version: 1, graph });
  await db.insert(flowResults).values({
    orgId: A,
    flowId: flow.id,
    version: 1,
    outputNodeId: "o1",
    tile: { name, value: 1 },
    status: "fresh",
  });
  return flow.id;
}

async function statusOf(flowId: string): Promise<string> {
  const [r] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
  return r.status;
}

async function assignRank(metricKeys: string[]) {
  await db.insert(workspaceRanks).values({ id: "rank_1", orgId: A, name: "Restricted", metricKeys });
  await db.insert(rankAssignments).values({ orgId: A, userId: "user_1", rankId: "rank_1" });
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ctx = { orgId: A, userId: "user_1", role: "member" };
});
afterEach(async () => {
  await close();
});

describe("refreshing every flow", () => {
  it("leaves a hidden flow's rows fresh, and touches the one the rank can see", async () => {
    const visible = await publishedFlow("Visible");
    const hidden = await publishedFlow("Hidden");
    await assignRank([`flow:${visible}`]);

    await refreshAllFlowsAction();

    // Hidden: for this rank, `flow:<hidden>` does not exist — never marked
    // stale, so never recomputed. Still exactly what it started as.
    expect(await statusOf(hidden)).toBe("fresh");
    // Visible: marked stale and picked up by the very same pass.
    expect(await statusOf(visible)).not.toBe("fresh");
  });

  it("touches nothing when the rank can see no flows at all", async () => {
    const a = await publishedFlow("A");
    const b = await publishedFlow("B");
    await assignRank([]); // sees nothing — allMetrics defaults false

    await refreshAllFlowsAction();

    expect(await statusOf(a)).toBe("fresh");
    expect(await statusOf(b)).toBe("fresh");
  });

  it("still marks everything for the common case: no rank assigned (full access)", async () => {
    const a = await publishedFlow("A");
    const b = await publishedFlow("B");
    // No rank assignment at all — effectiveAccess resolves to full access,
    // same as an admin or the workspace owner.

    await refreshAllFlowsAction();

    expect(await statusOf(a)).not.toBe("fresh");
    expect(await statusOf(b)).not.toBe("fresh");
  });
});
