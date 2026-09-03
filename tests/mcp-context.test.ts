import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { mcpGrants, mcpCalls, workspaceSettings, workspaceRanks, rankAssignments } from "@/db/schema";
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

const authInfo = (over = {}) => ({ token: "t", clientId: "client:c1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { userId: "user_1", orgIdClaim: "org_a", bindingKey: "client:c1", ...over } });
const member = (role = "member") => memberships.mockImplementation(async () => ({ data: [{ id: "m", userId: "user_1", organizationId: "org_a", role: { slug: role }, status: "active" }] }));

beforeEach(async () => { ({ db, close } = await createTestDb()); memberships.mockReset(); clearMembershipCache(); });
afterEach(async () => { await close(); });

describe("withToolContext", () => {
  const echo = withToolContext("echo", {}, async (ctx, args) => ok({ orgId: ctx.orgId, role: ctx.role ?? null, args }));

  it("runs the tool with the resolved org and writes an audit row", async () => {
    member("admin");
    const r = await echo({ x: 1 }, { authInfo: authInfo() });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ orgId: "org_a", role: "admin" });
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
    const [call] = await db.select().from(mcpCalls);
    expect(call).toMatchObject({ orgId: "org_a", userId: "user_1", tool: "echo", argsSummary: { x: 1 } });
  });
  it("fails plainly without a token, and never throws", async () => {
    const r = await echo({}, {});
    expect(r.isError).toBe(true); expect(r.content[0].text).toMatch(/token/);
  });
  it("returns the workspace_required shape when nothing names a workspace", async () => {
    memberships.mockImplementation(async () => ({ data: [{ organizationId: "org_a", role: { slug: "member" } }, { organizationId: "org_b", role: { slug: "member" } }] }));
    const r = await echo({}, { authInfo: authInfo({ orgIdClaim: null }) });
    expect(r.structuredContent).toMatchObject({ code: "workspace_required" });
  });
  it("blocks when the workspace switch is off", async () => {
    member(); await db.insert(workspaceSettings).values({ orgId: "org_a", aiAssistantsEnabled: false });
    const r = await echo({}, { authInfo: authInfo() });
    expect(r.isError).toBe(true); expect(r.content[0].text).toMatch(/turned off/);
  });
  it("blocks a ranked member without use_ai_assistants and lets a WorkOS admin through despite a rank", async () => {
    await db.insert(workspaceRanks).values({ id: "r1", orgId: "org_a", name: "Viewer", permissions: ["create_flows"], metricKeys: [] });
    await db.insert(rankAssignments).values({ orgId: "org_a", userId: "user_1", rankId: "r1" });
    member("member");
    expect((await echo({}, { authInfo: authInfo() })).isError).toBe(true);
    clearMembershipCache(); member("admin");
    expect((await echo({}, { authInfo: authInfo() })).isError).toBeFalsy();
  });
  it("blocks a revoked grant", async () => {
    member(); await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "claim", revokedAt: new Date() });
    expect((await echo({}, { authInfo: authInfo() })).content[0].text).toMatch(/disconnected/);
  });
  it("reads auth from ctx.http.authInfo when the host puts it there", async () => {
    member();
    const r = await echo({}, { http: { authInfo: authInfo() } });
    expect(r.isError).toBeFalsy();
  });
  it("audits, limits and logs a pre-workspace tool too, and never throws from it", async () => {
    const pre = withToolContext("pre", { needsWorkspace: false }, async () => { throw new Error("boom"); });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await pre({ note: "please find John Smith" }, { authInfo: authInfo() });
    expect(r.isError).toBe(true);
    const [call] = await db.select().from(mcpCalls);
    expect(call).toMatchObject({ orgId: "", userId: "user_1", tool: "pre", argsSummary: { note: "<text>" } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/"mcp":"pre"/);
    expect(log.mock.calls[0][0]).not.toMatch(/John/);
    log.mockRestore(); err.mockRestore();
  });
  it("attributes a pre-workspace tool's audit row to the workspace its result names", async () => {
    const pick = withToolContext<{ workspaceId: string }>("pick", { needsWorkspace: false }, async (_c, a) => ok({ workspace: { id: a.workspaceId, name: "A" } }));
    await pick({ workspaceId: "org_a" }, { authInfo: authInfo({ orgIdClaim: null }) });
    expect((await db.select().from(mcpCalls))[0]).toMatchObject({ orgId: "org_a", tool: "pick" });
  });
  it("requires every listed permission and names the missing one", async () => {
    await db.insert(workspaceRanks).values({ id: "r1", orgId: "org_a", name: "Ops", permissions: ["view_integrations"], metricKeys: [] });
    await db.insert(rankAssignments).values({ orgId: "org_a", userId: "user_1", rankId: "r1" });
    member("member");
    const both = withToolContext("both", { permissions: ["use_ai_assistants", "view_integrations"] }, async () => ok({}));
    expect((await both({}, { authInfo: authInfo() })).content[0].text).toMatch(/AI assistants/);
    await db.update(workspaceRanks).set({ permissions: ["use_ai_assistants"] });
    clearMembershipCache();
    expect((await both({}, { authInfo: authInfo() })).content[0].text).toMatch(/data sources/);
  });
  it("gives up on a slow tool at the deadline with one sentence", async () => {
    member("admin");
    const slow = withToolContext("slow", { deadlineMs: 50 }, () => new Promise((resolve) => setTimeout(() => resolve(ok({})), 500)));
    const r = await slow({}, { authInfo: authInfo() });
    expect(r.isError).toBe(true); expect(r.content[0].text).toMatch(/too long/);
  });
});
