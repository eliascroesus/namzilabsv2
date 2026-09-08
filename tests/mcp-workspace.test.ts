import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
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
    if (!r.ok) {
      expect(r.reason).toBe("workspace_required");
      // Narrowed on the reason because a refusal is no longer one shape: a
      // token-pinned connection refuses with the workspace it is pinned TO
      // rather than a list to choose from.
      if (r.reason === "workspace_required") {
        expect(r.workspaces).toEqual([{ orgId: "org_a", name: "Org org_a" }, { orgId: "org_b", name: "Org org_b" }]);
      }
    }
  });
  it("uses the one un-revoked grant and writes a binding", async () => {
    member(["org_a", "org_b"]);
    await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "selected" });
    const r = await resolveWorkspace(db, auth());
    expect(r).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
    // The stored key folds the user in ("<userId>|<bindingKey>") so two users
    // sharing one client_id can never collide on one row — see storedBindingKey.
    expect((await db.select().from(mcpBindings))[0]).toMatchObject({ bindingKey: "user_1|client:c1", userId: "user_1", orgId: "org_a" });
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
  it("refreshes a client's binding on every consultation, even when the answer is revoked", async () => {
    member(["org_a"]);
    await selectWorkspace(db, auth({ bindingKey: "client:c1" }), "org_a");
    await revokeGrant(db, "org_a", "user_1");
    // Force the stored row to look about to expire, as if it had sat untouched
    // since the original select — the exact situation the fix protects
    // against: without a refresh, the NEXT call after this would find no
    // binding at all and could fall through to a different workspace.
    await db.update(mcpBindings).set({ expiresAt: new Date(Date.now() + 500) }).where(eq(mcpBindings.userId, "user_1"));
    const r = await resolveWorkspace(db, auth({ bindingKey: "client:c1" }));
    expect(r).toMatchObject({ ok: false, reason: "revoked" });
    const after = (await db.select().from(mcpBindings))[0].expiresAt.getTime();
    expect(after).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });
  it("writes a binding on a successful claim, so a claim-connected client counts as a client in Settings", async () => {
    member(["org_a"]);
    await resolveWorkspace(db, auth({ orgIdClaim: "org_a", bindingKey: "client:c9" }));
    expect((await listGrants(db, "org_a"))[0]).toMatchObject({ userId: "user_1", clients: 1 });
  });
  it("keeps two users' bindings independent even when they share one client bindingKey", async () => {
    const orgsByUser: Record<string, string[]> = { user_1: ["org_a", "org_c"], user_2: ["org_b"] };
    memberships.mockImplementation(async (a: { userId?: string; organizationId?: string }) => ({
      data: (orgsByUser[a.userId ?? ""] ?? [])
        .filter((o) => !a.organizationId || a.organizationId === o)
        .map((o) => ({ organizationId: o, organizationName: `Org ${o}`, role: { slug: "member" } })),
    }));
    await selectWorkspace(db, auth({ userId: "user_1", bindingKey: "client:shared" }), "org_a");
    // A second live grant for user_1, so if their binding were EVER lost the
    // fallback would land on "workspace_required" rather than an accidental
    // correct guess — the failure mode must be unmistakable, not masked.
    await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_c", source: "selected" });
    // user_2 selects using the SAME raw client bindingKey. mcp_bindings'
    // primary key is bindingKey alone, so without storedBindingKey composing
    // the user in, this upsert would silently overwrite user_1's row.
    await selectWorkspace(db, auth({ userId: "user_2", bindingKey: "client:shared" }), "org_b");
    expect(await resolveWorkspace(db, auth({ userId: "user_1", bindingKey: "client:shared" }))).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
    expect(await resolveWorkspace(db, auth({ userId: "user_2", bindingKey: "client:shared" }))).toMatchObject({ ok: true, ws: { orgId: "org_b" } });
    expect(await db.select().from(mcpBindings)).toHaveLength(2);
  });
  it("does not trust a membership row for a different org than the one asked about", async () => {
    // I5: a well-behaved SDK filters server-side, but `membership()` must not
    // take `res.data[0]` on faith — a test double (or a future looser API)
    // that ignores the org filter and returns a row for org_other must not be
    // treated as proof the user belongs to org_a.
    memberships.mockImplementation(async () => ({
      data: [{ id: "m", userId: "user_1", organizationId: "org_other", organizationName: "Org other", role: { slug: "admin" }, status: "active" }],
    }));
    expect(await resolveWorkspace(db, auth({ orgIdClaim: "org_a" }))).toEqual({ ok: false, reason: "not_member" });
  });
  it("ignores an expired binding and falls through past it", async () => {
    member(["org_a", "org_b"]);
    await db.insert(mcpGrants).values({ userId: "user_1", orgId: "org_a", source: "selected" });
    // Points at org_b, but expired a second ago — must not be honoured.
    await db.insert(mcpBindings).values({ bindingKey: "user_1|client:c9", userId: "user_1", orgId: "org_b", expiresAt: new Date(Date.now() - 1000) });
    const r = await resolveWorkspace(db, auth({ bindingKey: "client:c9" }));
    expect(r).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
  });
});

describe("selectWorkspace", () => {
  it("refuses an org the user does not belong to", async () => {
    member(["org_a"]);
    expect(await selectWorkspace(db, auth(), "org_z")).toEqual({ ok: false, reason: "not_member" });
  });
});

describe("a token-pinned connection cannot select, and says so", () => {
  /**
   * FOUND LIVE, 8 Sep 2026. `select_workspace` was called for the second
   * workspace, answered `{ok: true}` naming it, and every read afterwards came
   * back from the first one.
   *
   * `resolveWorkspace` answers the `org_id` claim FIRST and returns before it
   * reads any binding — and re-binds to the claim's org on the way. So for a
   * client whose token carries a claim, `selectWorkspace` wrote a grant, moved
   * the binding, reported success, and the very next tool call silently undid
   * all of it. An assistant would then answer about the workspace the person
   * believed they had left, with numbers that are real and an attribution that
   * is wrong — which is worse than an error, because nothing looks broken.
   *
   * The claim must keep winning: it is a verified WorkOS claim naming the
   * organization the token was ISSUED FOR, and a tool argument overriding it
   * would read outside the scope the authorization granted. What these tests
   * pin is that the refusal is visible and names the pinned workspace.
   */
  it("refuses a switch away from the pinned workspace instead of pretending", async () => {
    member(["org_a", "org_b"]);
    const r = await selectWorkspace(db, auth({ orgIdClaim: "org_a" }), "org_b");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("pinned");
      if (r.reason === "pinned") expect(r.pinnedTo).toBe("org_a");
    }
  });

  it("writes NOTHING on a refused switch — no grant, no rebinding", async () => {
    // The silent no-op was not merely useless: it moved the binding and minted
    // a grant for a workspace this connection can never read.
    member(["org_a", "org_b"]);
    await selectWorkspace(db, auth({ orgIdClaim: "org_a" }), "org_b");
    expect(await db.select().from(mcpGrants)).toEqual([]);
    expect(await db.select().from(mcpBindings)).toEqual([]);
  });

  it("still allows selecting the workspace it is already pinned to", async () => {
    // A no-op that is honestly a no-op. Refusing this would break the ordinary
    // flow where a client selects the workspace it was authorized for.
    member(["org_a"]);
    const r = await selectWorkspace(db, auth({ orgIdClaim: "org_a" }), "org_a");
    expect(r).toMatchObject({ ok: true, ws: { orgId: "org_a" } });
  });

  it("leaves an unpinned connection free to switch, which is the normal case", async () => {
    member(["org_a", "org_b"]);
    const r = await selectWorkspace(db, auth(), "org_b");
    expect(r).toMatchObject({ ok: true, ws: { orgId: "org_b" } });
    const [binding] = await db.select().from(mcpBindings);
    expect(binding.orgId).toBe("org_b");
  });

  it("refuses BEFORE the membership check, because pinning is about the connection", async () => {
    // A member of both would otherwise sail past every other guard into the
    // silent no-op — which is exactly the case this was found in.
    member(["org_a", "org_b"]);
    const r = await selectWorkspace(db, auth({ orgIdClaim: "org_a" }), "org_b");
    if (!r.ok) expect(r.reason).toBe("pinned");
  });
});
