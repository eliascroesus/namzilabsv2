import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * B.1: the partial composite indexes must actually be CHOSEN by the planner
 * for the hot production query shapes — an index nobody uses is pure write
 * cost. Real Postgres planner (PGlite), a realistically multi-tenant fixture
 * (many orgs and connections, so per-predicate selectivity differentiates the
 * candidate paths), ANALYZE'd statistics, and the EXACT query shapes the code
 * runs (engine execApp, classic-metrics baseWhere, resync sweeps, the mirror
 * absent-id delete scope).
 */

let db: DB;
let close: () => Promise<void>;
let connA: string; // stream-scoped connection under test
let connB: string; // connection-scoped connection under test
const ORG = "org_idx_target";
const HASH_A = "streamhashaaaaaa";
const HASH_B = "streamhashbbbbbb";

async function explain(query: ReturnType<typeof sql>): Promise<string> {
  const res = await db.execute(sql`explain (format text) ${query}`);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (res as unknown as Array<Record<string, unknown>>);
  return rows.map((r) => String(Object.values(r)[0])).join("\n");
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  const mk = (o: {
    i: number;
    orgId: string;
    connectionId: string;
    streamHash: string | null;
    deleted?: boolean;
    gen?: number;
  }): typeof events.$inferInsert => ({
    eventId: `idx:${o.connectionId}:${o.streamHash ?? "x"}:${o.i}`,
    orgId: o.orgId,
    connectionId: o.connectionId,
    source: o.streamHash ? "gsheets" : "close",
    eventType: "row_added",
    occurredAt: new Date(Date.parse("2026-01-01T00:00:00Z") + (o.i % 100) * 86_400_000),
    properties: { i: o.i },
    streamHash: o.streamHash,
    syncGeneration: o.gen ?? 3,
    deletedAt: o.deleted ? new Date() : null,
  });

  const rows: (typeof events.$inferInsert)[] = [];
  // Noise: 8 other orgs × 1 connection × 400 rows each = 3200 rows, so the
  // org/connection predicates are genuinely selective (~1/9 each).
  for (let org = 0; org < 8; org++) {
    const noiseConn = await seedConnection(db, { orgId: `org_noise_${org}`, source: "close" });
    for (let i = 0; i < 400; i++) rows.push(mk({ i, orgId: `org_noise_${org}`, connectionId: noiseConn, streamHash: null }));
  }
  // The org under test: two streams on connection A (10% tombstones on A),
  // and connection-scoped B where — as in steady state — only a FEW rows
  // linger below the current generation (what the sweep hunts for).
  connA = await seedConnection(db, { orgId: ORG, source: "gsheets" });
  connB = await seedConnection(db, { orgId: ORG, source: "close" });
  for (let i = 0; i < 1200; i++) rows.push(mk({ i, orgId: ORG, connectionId: connA, streamHash: HASH_A, deleted: i % 10 === 0 }));
  for (let i = 0; i < 1200; i++) rows.push(mk({ i: i + 10_000, orgId: ORG, connectionId: connA, streamHash: HASH_B }));
  for (let i = 0; i < 1200; i++) rows.push(mk({ i: i + 20_000, orgId: ORG, connectionId: connB, streamHash: null, gen: i % 30 === 0 ? 2 : 3 }));

  for (let at = 0; at < rows.length; at += 500) {
    await db.insert(events).values(rows.slice(at, at + 500));
  }
  await db.execute(sql`analyze events`);
});

afterAll(async () => {
  await close();
});

describe("B.1 indexes are chosen by the planner", () => {
  it("engine Get-data read (org + conn + stream + live, newest-first, capped) uses events_conn_stream_live_idx", async () => {
    // Exact execApp shape (engine.ts): appConds + ORDER BY occurred_at DESC + LIMIT.
    const plan = await explain(
      sql`select * from events
          where org_id = ${ORG} and deleted_at is null
            and connection_id = ${connA} and stream_hash = ${HASH_A}
          order by occurred_at desc
          limit 500`,
    );
    expect(plan).toContain("events_conn_stream_live_idx");
    expect(plan).not.toContain("Seq Scan");
  });

  it("classic-metrics read (org + live + time range) uses events_org_live_occurred_idx", async () => {
    const plan = await explain(
      sql`select count(*) from events
          where org_id = ${ORG} and deleted_at is null
            and occurred_at >= ${new Date("2026-01-01T00:00:00Z")}
            and occurred_at <= ${new Date("2026-01-08T00:00:00Z")}`,
    );
    expect(plan).toContain("events_org_live_occurred_idx");
    expect(plan).not.toContain("Seq Scan");
  });

  it("full-resync sweep (conn + generation floor + live) uses events_conn_gen_live_idx", async () => {
    // Exact shape of the connection-scoped retire (resync.ts): the few rows
    // still below the new generation.
    const plan = await explain(
      sql`select id from events
          where connection_id = ${connB}
            and sync_generation >= 1 and sync_generation < 3
            and deleted_at is null`,
    );
    expect(plan).toContain("events_conn_gen_live_idx");
    expect(plan).not.toContain("Seq Scan");
  });

  it("mirror absent-id soft-delete scope (conn + stream + live) uses events_conn_stream_live_idx", async () => {
    const plan = await explain(
      sql`select id from events
          where connection_id = ${connA} and stream_hash = ${HASH_B} and deleted_at is null`,
    );
    expect(plan).toContain("events_conn_stream_live_idx");
    expect(plan).not.toContain("Seq Scan");
  });

  it("record-type listing (one connection's distinct live types) uses events_conn_type_live_idx", async () => {
    // Exact shape of distinctConnectionEventTypes (compute.ts) — the Configure
    // panel runs this on every open, so it must not aggregate the connection's
    // whole live history off a seq scan or the org-wide index.
    const plan = await explain(
      sql`select distinct event_type from events
          where org_id = ${ORG} and connection_id = ${connB} and deleted_at is null`,
    );
    expect(plan).toContain("events_conn_type_live_idx");
    expect(plan).not.toContain("Seq Scan");
  });

  it("whole-connection read (no stream chosen) still runs on a live index, not a seq scan", async () => {
    const plan = await explain(
      sql`select * from events
          where org_id = ${ORG} and deleted_at is null and connection_id = ${connA}
          order by occurred_at desc
          limit 500`,
    );
    // For a cross-stream time-ordered read the stream composite is NOT
    // presorted globally, so the planner correctly walks
    // events_org_live_occurred_idx backward (presorted, zero sort) and
    // filters by connection — the dropped single-column connection index is
    // not missed. Accept either live index; reject a sequential scan.
    expect(plan).toMatch(/events_(conn_stream|org)_live/);
    expect(plan).not.toContain("Seq Scan");
  });
});
