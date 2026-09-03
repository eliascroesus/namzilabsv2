import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { flows, flowVersions, flowResults, metrics } from "@/db/schema";
import type { DB } from "@/db/types";

vi.mock("server-only", () => ({}));
const memberships = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: (a: unknown) => memberships(a) }, organizations: { getOrganization: async (id: string) => ({ id, name: `Org ${id}` }) } }),
}));
let db: DB; let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

import { publishedFlowTiles } from "@/lib/flow/materialize";
import { getMetricTool } from "@/lib/mcp/tools/metrics";
import { clearMembershipCache } from "@/lib/mcp/workspace";
import { AggregateSchema } from "@/lib/metrics/types";

const authInfo = (over = {}) => ({ token: "t", clientId: "client:c1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { userId: "user_1", orgIdClaim: "org_a", bindingKey: "client:c1", ...over } });
const member = (role = "member") => memberships.mockImplementation(async () => ({ data: [{ id: "m", userId: "user_1", organizationId: "org_a", role: { slug: role }, status: "active" }] }));

const PRESETS = ["today", "yesterday", "7d", "30d", "90d", "all"] as const;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  memberships.mockReset();
  clearMembershipCache();

  // The published flow from tests/mcp-metrics.test.ts's fixtures: a partial
  // byRange (only "7d" and "all" stored) — exercises a MISSING slot for
  // every other preset.
  const [flow] = await db.insert(flows).values({ orgId: "org_a", name: "Bookings", status: "published", publishedVersion: 1 }).returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: "org_a", version: 1, graph: { nodes: [], edges: [], metrics: [] } });
  await db.insert(flowResults).values({
    orgId: "org_a",
    flowId: flow.id,
    version: 1,
    outputNodeId: "n1",
    status: "fresh",
    computedAt: new Date(),
    tile: { name: "Bookings", format: "number", value: 9, byRange: { "7d": { value: 3 }, all: { value: 9 } } },
    provenance: { streams: [{ connectionId: "c1", source: "calendly" }] },
  });

  const metricDef = AggregateSchema.parse({ kind: "aggregate", eventType: "replied" });
  await db.insert(metrics).values({ orgId: "org_a", name: "Replies", kind: "aggregate", display: "number", definition: metricDef });

  // A second published flow whose tile has every byRange slot filled —
  // exercises a PRESENT value for every preset.
  const [full] = await db.insert(flows).values({ orgId: "org_a", name: "Full", status: "published", publishedVersion: 1 }).returning();
  await db.insert(flowVersions).values({ flowId: full.id, orgId: "org_a", version: 1, graph: { nodes: [], edges: [], metrics: [] } });
  await db.insert(flowResults).values({
    orgId: "org_a",
    flowId: full.id,
    version: 1,
    outputNodeId: "n1",
    status: "fresh",
    computedAt: new Date(),
    tile: {
      name: "Full",
      format: "number",
      value: 9,
      byRange: { today: { value: 1 }, yesterday: { value: 2 }, "7d": { value: 3 }, "30d": { value: 4 }, "90d": { value: 5 }, all: { value: 9 } },
    },
    provenance: { streams: [] },
  });

  // A third published flow whose "30d" slot is unavailable — exercises the
  // UNAVAILABLE case.
  const [unavail] = await db.insert(flows).values({ orgId: "org_a", name: "Unavailable", status: "published", publishedVersion: 1 }).returning();
  await db.insert(flowVersions).values({ flowId: unavail.id, orgId: "org_a", version: 1, graph: { nodes: [], edges: [], metrics: [] } });
  await db.insert(flowResults).values({
    orgId: "org_a",
    flowId: unavail.id,
    version: 1,
    outputNodeId: "n1",
    status: "fresh",
    computedAt: new Date(),
    tile: {
      name: "Unavailable",
      format: "number",
      value: 9,
      byRange: { all: { value: 9 }, "30d": { unavailable: "No dated records in this range." } },
    },
    provenance: { streams: [] },
  });
});
afterEach(async () => { await close(); });

describe("get_metric / stored-tile parity", () => {
  it("get_metric answers exactly the stored slot for every published flow and every preset", async () => {
    member("admin");
    const tiles = await publishedFlowTiles(db, "org_a");
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      for (const range of PRESETS) {
        const tile = t.tile as { value?: number; byRange?: Record<string, { value?: number; unavailable?: string }> };
        const slot = tile.byRange?.[range];
        const expected = slot?.value ?? (range === "all" ? (tile.value ?? null) : null);
        const s = (await getMetricTool.handler({ id: `flow:${t.flowId}:${t.outputNodeId}`, range } as never, { authInfo: authInfo() })).structuredContent as Record<string, unknown>;
        expect(s.value, `${t.flowId} ${range}`).toBe(expected);
        expect(s.unavailable, `${t.flowId} ${range}`).toBe(slot?.unavailable);
      }
    }
  });
});
