import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { inspectLegacyRows, legacyRowsByConnection, reconcileLegacyRows } from "@/lib/sync/legacy-reconciliation";
import type { DB } from "@/db/types";

/**
 * The one-time legacy-row reconciliation (the P5 gate). Three properties must
 * hold before this is ever pointed at production:
 *
 *   1. it tombstones EXACTLY the intended rows and nothing else;
 *   2. connection-scoped connections are untouched (there, a null stream_hash
 *      is the correct steady state for every row — deleting them would erase
 *      live customer data);
 *   3. it is idempotent, so an interrupted run is safely re-runnable.
 */

const ORG = "org_legacy";
let db: DB;
let close: () => Promise<void>;
let sheetsConn: string; // stream-scoped
let calConn: string; // stream-scoped
let closeConn: string; // connection-scoped
let webhookConn: string; // connection-scoped

type Row = { conn: string; source: string; gen: number; hash: string | null; label: string };

async function seedEvent(r: Row) {
  await db.insert(events).values({
    eventId: `legacy:${r.label}`,
    orgId: ORG,
    connectionId: r.conn,
    source: r.source,
    eventType: "row_added",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    properties: { label: r.label },
    streamHash: r.hash,
    syncGeneration: r.gen,
  });
}

async function liveLabels(): Promise<string[]> {
  const rows = await db.select().from(events).where(isNull(events.deletedAt));
  return rows.map((r) => String((r.properties as Record<string, unknown>).label)).sort();
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  sheetsConn = await seedConnection(db, { orgId: ORG, source: "gsheets" });
  calConn = await seedConnection(db, { orgId: ORG, source: "gcal" });
  closeConn = await seedConnection(db, { orgId: ORG, source: "close" });
  webhookConn = await seedConnection(db, { orgId: ORG, source: "webhook" });

  await seedEvent({ conn: sheetsConn, source: "gsheets", gen: 2, hash: null, label: "GHOST-sheets" });
  await seedEvent({ conn: calConn, source: "gcal", gen: 1, hash: null, label: "GHOST-cal" });
  // Same connections, rows that must SURVIVE:
  await seedEvent({ conn: sheetsConn, source: "gsheets", gen: 2, hash: "hash_a", label: "keep-sheets-stream" });
  await seedEvent({ conn: sheetsConn, source: "gsheets", gen: 0, hash: null, label: "keep-sheets-webhook-gen0" });
  await seedEvent({ conn: calConn, source: "gcal", gen: 0, hash: "hash_b", label: "keep-cal-gen0-stream" });
  // Connection-scoped sources: null hash is CORRECT for every row here.
  await seedEvent({ conn: closeConn, source: "close", gen: 3, hash: null, label: "keep-close-poll" });
  await seedEvent({ conn: closeConn, source: "close", gen: 0, hash: null, label: "keep-close-webhook" });
  await seedEvent({ conn: webhookConn, source: "webhook", gen: 0, hash: null, label: "keep-webhook" });
  await seedEvent({ conn: webhookConn, source: "webhook", gen: 1, hash: null, label: "keep-webhook-poll" });
});

afterEach(async () => {
  await close();
});

describe("legacy-row reconciliation", () => {
  it("property 1 — tombstones EXACTLY the legacy ghost rows and nothing else", async () => {
    const before = await inspectLegacyRows(db);
    expect(before.streamScopedConnections).toBe(2); // gsheets + gcal only
    expect(before.candidates).toBe(2); // the two GHOST rows
    expect(before.tombstoned).toBe(0); // inspect writes nothing

    const result = await reconcileLegacyRows(db);
    expect(result.tombstoned).toBe(2);

    expect(await liveLabels()).toEqual([
      "keep-cal-gen0-stream",
      "keep-close-poll",
      "keep-close-webhook",
      "keep-sheets-stream",
      "keep-sheets-webhook-gen0",
      "keep-webhook",
      "keep-webhook-poll",
    ]);
    // The ghosts are soft-deleted, not hard-deleted (recoverable, auditable).
    const ghosts = await db.select().from(events).where(eq(events.eventId, "legacy:GHOST-sheets"));
    expect(ghosts[0].deletedAt).not.toBeNull();
  });

  it("property 2 — connection-scoped connections are never touched, whatever the generation", async () => {
    await reconcileLegacyRows(db);
    const survivors = await db
      .select()
      .from(events)
      .where(and(eq(events.connectionId, closeConn), isNull(events.deletedAt)));
    expect(survivors).toHaveLength(2); // poll row AND webhook row both live

    const webhookSurvivors = await db
      .select()
      .from(events)
      .where(and(eq(events.connectionId, webhookConn), isNull(events.deletedAt)));
    expect(webhookSurvivors).toHaveLength(2);
  });

  it("property 3 — idempotent: a second run is a no-op (so an interrupted run is safely re-runnable)", async () => {
    const first = await reconcileLegacyRows(db);
    expect(first.tombstoned).toBe(2);

    const second = await reconcileLegacyRows(db);
    expect(second.candidates).toBe(0);
    expect(second.tombstoned).toBe(0);

    const third = await reconcileLegacyRows(db);
    expect(third.tombstoned).toBe(0);
    expect(await liveLabels()).toHaveLength(7); // unchanged after three runs
  });

  it("dry run reports without writing", async () => {
    const dry = await reconcileLegacyRows(db, { dryRun: true });
    expect(dry.candidates).toBe(2);
    expect(dry.tombstoned).toBe(0);
    expect(dry.dryRun).toBe(true);
    expect(await liveLabels()).toHaveLength(9); // nothing retired
  });

  it("reports a per-connection breakdown for the operator", async () => {
    const rows = await legacyRowsByConnection(db);
    expect(rows.map((r) => r.source).sort()).toEqual(["gcal", "gsheets"]);
    expect(rows.every((r) => r.rows === 1)).toBe(true);
    // Connection-scoped connections never appear.
    expect(rows.some((r) => r.source === "close" || r.source === "webhook")).toBe(false);
  });

  it("a clean install (no legacy rows) reports nothing to do", async () => {
    await reconcileLegacyRows(db);
    const report = await inspectLegacyRows(db);
    expect(report.candidates).toBe(0);
  });
});
