import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * B.3 seam guarantee: the `DB` type's `db.transaction()` works against real
 * Postgres semantics (PGlite here; the Neon `pool` driver in production).
 * The neon-http driver rejects transactions at runtime — this is the behavior
 * the driver migration unlocks, and what the atomic upsert+soft-delete swap
 * and advisory-lock mutual exclusion (C.1, scheduled right after the read
 * soak) will build on.
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;

const row = (id: string) => ({
  eventId: `txn:conn:${id}`,
  orgId: "org_test",
  connectionId,
  source: "webhook",
  eventType: "t",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  properties: {},
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db);
});
afterEach(async () => {
  await close();
});

describe("db.transaction() on the DB seam", () => {
  it("commits all statements together", async () => {
    await db.transaction(async (tx) => {
      await tx.insert(events).values(row("a"));
      await tx.insert(events).values(row("b"));
    });
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("rolls back EVERY statement when the transaction throws", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(events).values(row("a"));
        throw new Error("boom — nothing above may persist");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("tx.rollback() aborts explicitly", async () => {
    await db
      .transaction(async (tx) => {
        await tx.insert(events).values(row("a"));
        tx.rollback();
      })
      .catch(() => {
        // drizzle surfaces rollback as a rejection; the assertion is the empty table.
      });
    expect(await db.select().from(events)).toHaveLength(0);
  });
});
