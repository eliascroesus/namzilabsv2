import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { mcpCalls, mcpGrants } from "@/db/schema";
import type { DB } from "@/db/types";

const memberships = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: (a: unknown) => memberships(a) }, organizations: { getOrganization: async (id: string) => ({ id, name: `Org ${id}` }) } }),
}));
let db: DB; let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

import { withToolContext } from "@/lib/mcp/context";
import { ok } from "@/lib/mcp/result";
import { clearMembershipCache } from "@/lib/mcp/workspace";
import { listWorkspacesTool, selectWorkspaceTool } from "@/lib/mcp/tools/workspaces";

const authInfo = (over = {}) => ({ token: "t", clientId: "client:c1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { userId: "user_1", orgIdClaim: "org_a", bindingKey: "client:c1", ...over } });

beforeEach(async () => { ({ db, close } = await createTestDb()); memberships.mockReset(); clearMembershipCache(); });
afterEach(async () => { await close(); });

const rows = (...orgs: string[]) => ({ data: orgs.map((o) => ({ organizationId: o, organizationName: `Org ${o}`, role: { slug: "member" } })) });

it("lists the person's workspaces without needing one selected", async () => {
  memberships.mockImplementation(async () => rows("org_a", "org_b"));
  const r = await listWorkspacesTool.handler({} as never, { authInfo: authInfo({ orgIdClaim: null }) });
  expect(r.structuredContent).toEqual({ workspaces: [{ id: "org_a", name: "Org org_a" }, { id: "org_b", name: "Org org_b" }] });
});
it("selects a workspace the person belongs to and refuses one they do not", async () => {
  memberships.mockImplementation(async (a: { organizationId?: string }) => (a.organizationId === "org_a" || !a.organizationId ? rows("org_a") : { data: [] }));
  expect((await selectWorkspaceTool.handler({ workspaceId: "org_a" } as never, { authInfo: authInfo({ orgIdClaim: null }) })).structuredContent).toEqual({ workspace: { id: "org_a", name: "Org org_a" } });
  expect((await selectWorkspaceTool.handler({ workspaceId: "org_z" } as never, { authInfo: authInfo({ orgIdClaim: null }) })).content[0].text).toMatch(/not a member/);
});
it("writes an audit row for both pre-workspace tools, attributing select_workspace to its choice", async () => {
  memberships.mockImplementation(async () => rows("org_a"));
  await listWorkspacesTool.handler({} as never, { authInfo: authInfo({ orgIdClaim: null }) });
  await selectWorkspaceTool.handler({ workspaceId: "org_a" } as never, { authInfo: authInfo({ orgIdClaim: null }) });
  const calls = await db.select().from(mcpCalls);
  expect(calls.map((c) => [c.tool, c.orgId, c.userId])).toEqual([["list_workspaces", "", "user_1"], ["select_workspace", "org_a", "user_1"]]);
});
it("reconnects a revoked grant only through select_workspace", async () => {
  memberships.mockImplementation(async () => rows("org_a"));
  await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "claim", revokedAt: new Date() });
  const probe = withToolContext("probe", {}, async (ctx) => ok({ orgId: ctx.orgId }));
  expect((await probe({}, { authInfo: authInfo() })).content[0].text).toMatch(/select_workspace/);
  expect((await selectWorkspaceTool.handler({ workspaceId: "org_a" } as never, { authInfo: authInfo() })).isError).toBeFalsy();
  expect((await probe({}, { authInfo: authInfo() })).structuredContent).toEqual({ orgId: "org_a" });
});
