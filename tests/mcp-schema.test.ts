import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { mcpGrants, mcpBindings, workspaceSettings, mcpCalls } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB; let close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await createTestDb()); });
afterEach(async () => { await close(); });

describe("migration 0031", () => {
  it("creates the four MCP tables with their keys", async () => {
    const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('mcp_grants','mcp_bindings','workspace_settings','mcp_calls') order by 1`);
    expect((rows.rows as Array<{ table_name: string }>).map((r) => r.table_name)).toEqual(["mcp_bindings", "mcp_calls", "mcp_grants", "workspace_settings"]);
  });
  it("keys a grant by (user, workspace) so one user can hold two", async () => {
    await db.insert(mcpGrants).values([{ userId: "u1", orgId: "org_a", source: "selected" }, { userId: "u1", orgId: "org_b", source: "claim" }]);
    await expect(db.insert(mcpGrants).values({ userId: "u1", orgId: "org_a", source: "selected" })).rejects.toThrow();
  });
  it("defaults a workspace to assistants enabled and a call to zero counters", async () => {
    await db.insert(workspaceSettings).values({ orgId: "org_a" });
    const [s] = await db.select().from(workspaceSettings);
    expect(s.aiAssistantsEnabled).toBe(true);
    await db.insert(mcpCalls).values({ orgId: "org_a", userId: "u1", tool: "list_metrics" });
    const [c] = await db.select().from(mcpCalls);
    expect(c.rows).toBe(0); expect(c.revealContacts).toBe(false); expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    await db.insert(mcpBindings).values({ bindingKey: "k1", userId: "u1", orgId: "org_a", expiresAt: new Date(Date.now() + 3600_000) });
    expect((await db.select().from(mcpBindings)).length).toBe(1);
  });
});
