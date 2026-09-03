import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, flows, flowVersions, flowResults, metrics } from "@/db/schema";
import type { DB } from "@/db/types";

vi.mock("server-only", () => ({}));
const memberships = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: (a: unknown) => memberships(a) }, organizations: { getOrganization: async (id: string) => ({ id, name: `Org ${id}` }) } }),
}));
let db: DB; let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

import { TOOLS } from "@/lib/mcp/register";
import { clearMembershipCache } from "@/lib/mcp/workspace";
import { AggregateSchema } from "@/lib/metrics/types";

const authInfo = (over = {}) => ({ token: "t", clientId: "client:c1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { userId: "user_1", orgIdClaim: "org_a", bindingKey: "client:c1", ...over } });
const member = (role = "member") => memberships.mockImplementation(async () => ({ data: [{ id: "m", userId: "user_1", organizationId: "org_a", role: { slug: role }, status: "active" }] }));

/**
 * Every registered tool, run once with a minimal valid call and its result
 * scanned for the four things an assistant-facing tool must never surface:
 * an encrypted credential, an ORM field name that would hint at one, a raw
 * webhook payload or sample record, and hand-rolled provenance SQL. A tool
 * added later with no entry in MINIMAL_ARGS fails the roll-call assertion
 * below rather than being silently skipped.
 */
const FORBIDDEN = /SECRET-CREDS|credentialsEncrypted|credentials_encrypted|signingSecret|signing_secret|"payload"|"sample"|select\s+[\s\S]+\s+from\s+events/i;

let flowId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  memberships.mockReset();
  clearMembershipCache();

  const [flow] = await db.insert(flows).values({ orgId: "org_a", name: "Bookings", status: "published", publishedVersion: 1 }).returning();
  flowId = flow.id;
  await db.insert(flowVersions).values({ flowId, orgId: "org_a", version: 1, graph: { nodes: [], edges: [], metrics: [] } });
  await db.insert(flowResults).values({
    orgId: "org_a",
    flowId,
    version: 1,
    outputNodeId: "n1",
    status: "fresh",
    computedAt: new Date(),
    tile: { name: "Bookings", format: "number", value: 9, byRange: { "7d": { value: 3 }, all: { value: 9 } } },
    provenance: { streams: [{ connectionId: "c1", source: "calendly" }] },
  });

  const metricDef = AggregateSchema.parse({ kind: "aggregate", eventType: "replied" });
  await db.insert(metrics).values({ orgId: "org_a", name: "Replies", kind: "aggregate", display: "number", definition: metricDef });

  const connId = await seedConnection(db, { orgId: "org_a", source: "close", name: "Close CRM" });
  await db
    .update(connections)
    .set({ credentialsEncrypted: "SECRET-CREDS", signingSecretEncrypted: "SECRET-SIGN" })
    .where(eq(connections.id, connId));
});
afterEach(async () => { await close(); });

describe("MCP security scan", () => {
  it("no tool's output ever carries a credential, a raw payload, a sample record or provenance SQL", async () => {
    member("admin");
    const MINIMAL_ARGS: Record<string, unknown> = {
      list_workspaces: {},
      select_workspace: { workspaceId: "org_a" },
      list_metrics: {},
      get_metric: { id: `flow:${flowId}:n1`, range: "all", includeSeries: true, includeGroups: true },
      get_metric_days: { id: `flow:${flowId}:n1`, from: "2026-09-01", to: "2026-09-01" },
      list_sources: {},
    };
    // Every registered tool is scanned — a new tool without an entry here fails the suite.
    expect(Object.keys(MINIMAL_ARGS).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of TOOLS) {
      const r = await t.handler(MINIMAL_ARGS[t.name] as never, { authInfo: authInfo() });
      expect(r.isError, t.name).toBeFalsy();
      expect(r.content[0].text, t.name).not.toMatch(FORBIDDEN);
      expect(JSON.stringify(r.structuredContent), t.name).not.toMatch(FORBIDDEN);
    }
  });
});
