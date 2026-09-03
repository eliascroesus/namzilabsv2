import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { readFileSync } from "node:fs";
import { mcpBindings, mcpCalls } from "@/db/schema";
import type { DB } from "@/db/types";
import { recordCall, checkRateLimit, summarizeArgs, pruneMcpTables, USER_PER_MINUTE } from "@/lib/mcp/audit";

let db: DB; let close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await createTestDb()); });
afterEach(async () => { await close(); });

describe("mcp audit", () => {
  it("writes one row per call with the summary, never free text", async () => {
    await recordCall(db, { orgId: "org_a", userId: "u1", tool: "get_metric", argsSummary: summarizeArgs({ id: "flow:f1:n1", range: "7d", note: "please find John Smith" }), rows: 1, bytes: 120, durationMs: 9 });
    const [row] = await db.select().from(mcpCalls);
    expect(row.argsSummary).toEqual({ id: "flow:f1:n1", range: "7d", note: "<text>" });
    expect(JSON.stringify(row.argsSummary)).not.toContain("John");
  });
  it("trips the per-user limit at the 61st call in a minute and says when to retry", async () => {
    for (let i = 0; i < USER_PER_MINUTE; i++) await recordCall(db, { orgId: "org_a", userId: "u1", tool: "list_metrics", argsSummary: {}, rows: 0, bytes: 0, durationMs: 1 });
    const r = await checkRateLimit(db, { orgId: "org_a", userId: "u1", tool: "list_metrics" });
    expect(r.allowed).toBe(false);
    if (!r.allowed) { expect(r.retryAfterSeconds).toBeGreaterThan(0); expect(r.reason).toMatch(/minute/); }
    expect((await checkRateLimit(db, { orgId: "org_a", userId: "u2", tool: "list_metrics" })).allowed).toBe(true);
  });
  it("counts only this workspace for the per-workspace limit", async () => {
    for (let i = 0; i < 5; i++) await recordCall(db, { orgId: "org_b", userId: "u1", tool: "list_metrics", argsSummary: {}, rows: 0, bytes: 0, durationMs: 1 });
    expect((await checkRateLimit(db, { orgId: "org_a", userId: "u9", tool: "list_metrics" })).allowed).toBe(true);
  });
  it("applies only the per-user limit to pre-workspace calls (empty orgId)", async () => {
    for (let i = 0; i < USER_PER_MINUTE; i++) await recordCall(db, { orgId: "", userId: "u3", tool: "list_workspaces", argsSummary: {}, rows: 0, bytes: 0, durationMs: 1 });
    expect((await checkRateLimit(db, { orgId: "", userId: "u3", tool: "list_workspaces" })).allowed).toBe(false);
    expect((await checkRateLimit(db, { orgId: "", userId: "u4", tool: "list_workspaces" })).allowed).toBe(true);
  });
  it("prunes calls older than 90 days and expired bindings, and only counts in inspect mode", async () => {
    const now = new Date("2026-09-03T03:17:00Z");
    const old = new Date(now.getTime() - 91 * 86_400_000);
    await db.insert(mcpCalls).values([{ orgId: "org_a", userId: "u1", tool: "t", at: old }, { orgId: "org_a", userId: "u1", tool: "t", at: now }]);
    await db.insert(mcpBindings).values([
      { bindingKey: "k_old", userId: "u1", orgId: "org_a", expiresAt: new Date(now.getTime() - 1000) },
      { bindingKey: "k_live", userId: "u1", orgId: "org_a", expiresAt: new Date(now.getTime() + 1000) },
    ]);
    expect(await pruneMcpTables(db, { inspect: true, now })).toEqual({ inspected: true, callsPastRetention: 1, bindingsExpired: 1, callsDeleted: 0, bindingsDeleted: 0 });
    expect(await db.select().from(mcpCalls)).toHaveLength(2);
    expect(await pruneMcpTables(db, { now })).toEqual({ inspected: false, callsPastRetention: 1, bindingsExpired: 1, callsDeleted: 1, bindingsDeleted: 1 });
    expect((await db.select().from(mcpCalls)).map((c) => c.at.toISOString())).toEqual([now.toISOString()]);
    expect((await db.select().from(mcpBindings)).map((b) => b.bindingKey)).toEqual(["k_live"]);
  });
  it("runs from the nightly prune-storage function under its inspect gate", () => {
    const src = readFileSync("src/inngest/functions/sync.ts", "utf8");
    expect(src).toMatch(/step\.run\("prune-mcp-tables", \(\) => pruneMcpTables\(getDb\(\), \{ inspect \}\)\)/);
  });
});
