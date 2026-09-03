import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { mcpGrants, mcpBindings } from "@/db/schema";
import type { DB } from "@/db/types";
import type { McpAuth } from "@/lib/mcp/auth";

const memberships = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({
  // getOrganization throws on purpose: workspace names must come off the membership row, never a second round trip.
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: (a: unknown) => memberships(a) }, organizations: { getOrganization: async () => { throw new Error("read organizationName off the membership instead"); } } }),
}));

import { resolveWorkspace, selectWorkspace, revokeGrant, listGrants, clearMembershipCache } from "@/lib/mcp/workspace";

let db: DB; let close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await createTestDb()); memberships.mockReset(); clearMembershipCache(); });
afterEach(async () => { await close(); });

const auth = (over: Partial<McpAuth["extra"]> = {}): McpAuth => ({
  token: "t", clientId: "client:c1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600,
  extra: { userId: "user_1", orgIdClaim: null, bindingKey: "client:c1", ...over },
});
const member = (orgIds: string[], role = "member") =>
  memberships.mockImplementation(async (a: { organizationId?: string }) => ({
    data: orgIds.filter((o) => !a.organizationId || a.organizationId === o).map((o) => ({ id: `m_${o}`, userId: "user_1", organizationId: o, organizationName: `Org ${o}`, role: { slug: role }, status: "active" })),
  }));

describe("resolveWorkspace", () => {
  it("uses the org_id claim when the user is a member, and captures the role slug", async () => {
    member(["org_a"], "admin");
    const r = await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }));
    expect(r).toMatchObject({ ok: true, ws: { orgId: "org_a", userId: "user_1", role: "admin", grantSource: "claim" } });
    expect((await db.select().from(mcpGrants)).length).toBe(1);
  });
  it("refuses a claim for an org the user is not a member of", async () => {
    member(["org_b"]);
    expect(await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }))).toEqual({ ok: false, reason: "not_member" });
  });
  it("asks for a workspace when there is no claim and no single grant", async () => {
    member(["org_a", "org_b"]);
    const r = await resolveWorkspace(db, auth());
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("workspace_required"); expect(r.workspaces).toEqual([{ orgId: "org_a", name: "Org org_a" }, { orgId: "org_b", name: "Org org_b" }]); }
  });
  it("uses the one un-revoked grant and writes a binding", async () => {
    member(["org_a", "org_b"]);
    await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "selected" });
    const r = await resolveWorkspace(db, auth());
    expect(r).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
    expect((await db.select().from(mcpBindings))[0]).toMatchObject({ bindingKey: "client:c1", orgId: "org_a" });
  });
  it("keeps two clients bound to two workspaces independently", async () => {
    member(["org_a", "org_b"]);
    await selectWorkspace(db, auth({ bindingKey: "client:c1" }), "org_a");
    await selectWorkspace(db, auth({ bindingKey: "client:c2" }), "org_b");
    expect(await resolveWorkspace(db, auth({ bindingKey: "client:c1" }))).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
    expect(await resolveWorkspace(db, auth({ bindingKey: "client:c2" }))).toMatchObject({ ok: true, ws: { orgId: "org_b" } });
    await revokeGrant(db, "org_b", "user_1");
    expect(await resolveWorkspace(db, auth({ bindingKey: "client:c2" }))).toMatchObject({ ok: false, reason: "revoked" });
    expect(await resolveWorkspace(db, auth({ bindingKey: "client:c1" }))).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
  });
  it("refuses a revoked grant even on the claim path", async () => {
    member(["org_a"]);
    await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "claim", revokedAt: new Date() });
    expect(await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }))).toMatchObject({ ok: false, reason: "revoked" });
  });
  it("lets an explicit select_workspace reconnect a revoked grant, and counts that client", async () => {
    member(["org_a"]);
    await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "claim", revokedAt: new Date() });
    expect(await selectWorkspace(db, auth(), "org_a")).toMatchObject({ ok: true, ws: { orgId: "org_a", grantSource: "selected" } });
    expect(await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }))).toMatchObject({ ok: true });
    expect((await listGrants(db, "org_a"))[0]).toMatchObject({ userId: "user_1", revokedAt: null, clients: 1 });
    await selectWorkspace(db, auth({ bindingKey: "client:c2" }), "org_a");
    expect((await listGrants(db, "org_a", "user_1"))[0].clients).toBe(2);
    expect(await listGrants(db, "org_b")).toEqual([]);
  });
  it("re-checks membership after the cache window", async () => {
    member(["org_a"]);
    await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }));
    memberships.mockImplementation(async () => ({ data: [] }));
    expect(await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }))).toMatchObject({ ok: true }); // cached
    clearMembershipCache();
    expect(await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }))).toEqual({ ok: false, reason: "not_member" });
  });
});
