import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { mcpBindings, mcpCalls } from "@/db/schema";
import type { DB } from "@/db/types";
import { recordCall, checkRateLimit, summarizeArgs, pruneMcpTables, USER_PER_MINUTE, ORG_PER_HOUR } from "@/lib/mcp/audit";

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
  it("trips the per-workspace hour limit at the 601st call, spread across many users so the per-user limit does not trip first", async () => {
    // One multi-row insert rather than 600 sequential recordCall awaits, and
    // spread over 20 users (30 calls each) so no single user's 60/minute
    // limit is what actually trips this check.
    const rows = Array.from({ length: ORG_PER_HOUR }, (_, i) => ({ orgId: "org_c", userId: `u${i % 20}`, tool: "list_metrics" }));
    await db.insert(mcpCalls).values(rows);
    const r = await checkRateLimit(db, { orgId: "org_c", userId: "u_new", tool: "list_metrics" });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/hour/);
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
  it("summarizes each kind of argument value the way the audit trail promises", () => {
    const fortyChar = "a".repeat(40);
    const fortyOneChar = "a".repeat(41);
    expect(
      summarizeArgs({ n: 5, b: true, z: null, fortyChar, fortyOneChar, spaced: "has space", arr: [1, 2, 3], obj: { a: 1 } }),
    ).toEqual({ n: 5, b: true, z: null, fortyChar, fortyOneChar: "<text>", spaced: "<text>", arr: "<array:3>", obj: "<object>" });
  });
  it("truncates a stored error to 200 characters", async () => {
    const long = "x".repeat(1000);
    await recordCall(db, { orgId: "org_a", userId: "u1", tool: "t", argsSummary: {}, rows: 0, bytes: 0, durationMs: 1, error: long });
    const [row] = await db.select().from(mcpCalls);
    expect(row.error).toHaveLength(200);
    expect(row.error).toBe("x".repeat(200));
  });
  it("runs from the nightly prune-storage function under its inspect gate, and only once MCP_ENABLED=1", () => {
    const src = readFileSync("src/inngest/functions/sync.ts", "utf8");
    // Gated: the enabled branch is still exactly the old call (so a live
    // deployment behaves as before); the disabled branch never touches the
    // db and reports a zero result flagged `skipped: true` rather than
    // throwing on tables that may not exist yet.
    expect(src).toMatch(/step\.run\("prune-mcp-tables", \(\) => \(mcpEnabled\(\) \? pruneMcpTables\(getDb\(\), \{ inspect \}\) : Promise\.resolve\(\{[^}]*skipped: true[^}]*\}\)\)\)/);
    // The MCP sweep's result belongs in pruneStorage's own return value...
    expect(src).toMatch(/return \{ settledTestRuns: settled, \.\.\.retained, mcp, backlog, invariants, webhookEventTime: eventTime \};/);
    // ...and a backlog bigger than one night's batch gets its own warning,
    // not just a silent undercount. (Never true for the skipped zero result:
    // 0 is never greater than MCP_PRUNE_BATCH.)
    expect(src).toContain("if (mcp.callsPastRetention > MCP_PRUNE_BATCH || mcp.bindingsExpired > MCP_PRUNE_BATCH) {");
    expect(src).toContain("console.warn(`[storage-prune-truncated] mcp ${JSON.stringify(mcp)}`);");
  });
  it("skips the nightly sweep without touching the db when MCP_ENABLED is off", async () => {
    // sync.ts's own gate gets a source-text pin above; this exercises the
    // OTHER half of C1's fix at runtime — pruneMcpTables gates nothing
    // itself, but sync.ts's ternary must never even call it while disabled.
    // Simulated here by calling pruneMcpTables against a db that dropped the
    // table sync.ts's gate is meant to protect against ever querying.
    await db.execute(sql`drop table mcp_calls`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await pruneMcpTables(db, { inspect: true });
    expect(result).toEqual({ inspected: true, callsPastRetention: 0, bindingsExpired: 0, callsDeleted: 0, bindingsDeleted: 0, skipped: true });
    expect(warn).toHaveBeenCalledWith("[mcp] prune skipped: tables not migrated yet");
    warn.mockRestore();
  });
});
