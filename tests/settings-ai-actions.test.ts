import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { mcpGrants, workspaceSettings, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB; let close: () => Promise<void>;
let ctx: { orgId: string; userId: string; role?: string };
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@workos-inc/authkit-nextjs", () => ({ getWorkOS: () => ({ userManagement: { listOrganizationMemberships: async () => ({ data: [] }) }, organizations: { getOrganization: async (id: string) => ({ id, name: id }) } }) }));

import { setAiAssistantsEnabledAction, disconnectAssistantAction } from "@/app/dashboard/settings/ai-actions";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(mcpGrants).values([{ userId: "u_member", orgId: "org_a", source: "selected" }, { userId: "u_other", orgId: "org_a", source: "selected" }, { userId: "u_member", orgId: "org_b", source: "selected" }]);
});
afterEach(async () => { await close(); });

describe("setAiAssistantsEnabledAction", () => {
  it("refuses a plain member", async () => {
    ctx = { orgId: "org_a", userId: "u_member" };
    expect(await setAiAssistantsEnabledAction(false)).toMatchObject({ ok: false });
    expect(await db.select().from(workspaceSettings)).toHaveLength(0);
  });
  it("lets a WorkOS admin flip it, and the row lands for this org only", async () => {
    ctx = { orgId: "org_a", userId: "u_admin", role: "admin" };
    expect(await setAiAssistantsEnabledAction(false)).toEqual({ ok: true });
    const rows = await db.select().from(workspaceSettings);
    expect(rows).toEqual([expect.objectContaining({ orgId: "org_a", aiAssistantsEnabled: false })]);
  });
});

describe("disconnectAssistantAction", () => {
  it("lets a member disconnect their own assistant but not another person's", async () => {
    ctx = { orgId: "org_a", userId: "u_member" };
    expect(await disconnectAssistantAction("u_member")).toEqual({ ok: true });
    expect(await disconnectAssistantAction("u_other")).toMatchObject({ ok: false });
    const [own] = await db.select().from(mcpGrants).where(and(eq(mcpGrants.userId, "u_member"), eq(mcpGrants.orgId, "org_a")));
    const [other] = await db.select().from(mcpGrants).where(and(eq(mcpGrants.userId, "u_other"), eq(mcpGrants.orgId, "org_a")));
    const [elsewhere] = await db.select().from(mcpGrants).where(and(eq(mcpGrants.userId, "u_member"), eq(mcpGrants.orgId, "org_b")));
    expect(own.revokedAt).not.toBeNull(); expect(other.revokedAt).toBeNull(); expect(elsewhere.revokedAt).toBeNull();
  });
  it("lets the workspace owner disconnect anyone in this workspace", async () => {
    await db.insert(workspaceOwners).values({ orgId: "org_a", userId: "u_owner", source: "created" });
    ctx = { orgId: "org_a", userId: "u_owner" };
    expect(await disconnectAssistantAction("u_other")).toEqual({ ok: true });
    const [other] = await db.select().from(mcpGrants).where(and(eq(mcpGrants.userId, "u_other"), eq(mcpGrants.orgId, "org_a")));
    expect(other.revokedAt).not.toBeNull();
  });
});
