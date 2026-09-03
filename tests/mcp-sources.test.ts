import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, deadLetter, rawEvents, workspaceRanks, rankAssignments } from "@/db/schema";
import type { DB } from "@/db/types";

vi.mock("server-only", () => ({}));
const memberships = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: (a: unknown) => memberships(a) }, organizations: { getOrganization: async (id: string) => ({ id, name: `Org ${id}` }) } }),
}));
let db: DB; let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

import { listSourcesTool } from "@/lib/mcp/tools/sources";
import { clearMembershipCache } from "@/lib/mcp/workspace";

const authInfo = (over = {}) => ({ token: "t", clientId: "client:c1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { userId: "user_1", orgIdClaim: "org_a", bindingKey: "client:c1", ...over } });
const member = (role = "member") => memberships.mockImplementation(async () => ({ data: [{ id: "m", userId: "user_1", organizationId: "org_a", role: { slug: role }, status: "active" }] }));

beforeEach(async () => { ({ db, close } = await createTestDb()); memberships.mockReset(); clearMembershipCache(); });
afterEach(async () => { await close(); });

describe("list_sources", () => {
  it("projects safe columns only and counts unresolved dead letters", async () => {
    member("admin");
    const id = await seedConnection(db, { orgId: "org_a", source: "close", name: "Close CRM" });
    await db.update(connections).set({ credentialsEncrypted: "SECRET-CREDS", signingSecretEncrypted: "SECRET-SIGN", lastError: "webhook subscription check failed" }).where(eq(connections.id, id));
    const [raw] = await db.insert(rawEvents).values({ orgId: "org_a", connectionId: id, source: "close", payload: {} }).returning({ id: rawEvents.id });
    await db.insert(deadLetter).values({ orgId: "org_a", connectionId: id, rawEventId: raw.id, error: "boom", attempts: 6 });
    const r = await listSourcesTool.handler({} as never, { authInfo: authInfo() });
    const s = r.structuredContent as { sources: Array<Record<string, unknown>> };
    expect(s.sources).toHaveLength(1);
    expect(s.sources[0]).toMatchObject({ id, name: "Close CRM", source: "close", status: "active", deadLetters: 1, lastError: "webhook subscription check failed" });
    expect(r.content[0].text).not.toMatch(/SECRET|credential|signing/i);
    expect(Object.keys(s.sources[0])).not.toContain("credentialsEncrypted");
  });
  it("shows only this workspace's connections", async () => {
    member("admin");
    await seedConnection(db, { orgId: "org_b", source: "close", name: "Other org" });
    const s = (await listSourcesTool.handler({} as never, { authInfo: authInfo() })).structuredContent as { sources: unknown[] };
    expect(s.sources).toHaveLength(0);
  });
  it("needs view_integrations", async () => {
    await db.insert(workspaceRanks).values({ id: "r1", orgId: "org_a", name: "Builder", permissions: ["use_ai_assistants", "create_flows"], metricKeys: [], allMetrics: true });
    await db.insert(rankAssignments).values({ orgId: "org_a", userId: "user_1", rankId: "r1" });
    member("member");
    const r = await listSourcesTool.handler({} as never, { authInfo: authInfo() });
    expect(r.isError).toBe(true); expect(r.content[0].text).toMatch(/data sources/);
  });
  it("still needs use_ai_assistants when the rank has view_integrations", async () => {
    await db.insert(workspaceRanks).values({ id: "r2", orgId: "org_a", name: "Ops", permissions: ["view_integrations"], metricKeys: [], allMetrics: true });
    await db.insert(rankAssignments).values({ orgId: "org_a", userId: "user_1", rankId: "r2" });
    member("member");
    const r = await listSourcesTool.handler({} as never, { authInfo: authInfo() });
    expect(r.isError).toBe(true); expect(r.content[0].text).toMatch(/AI assistants/);
  });
});
