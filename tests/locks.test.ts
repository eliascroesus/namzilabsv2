import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { advisoryLockKey, advisoryLocksEnabled, withStreamWriteLock } from "@/lib/sync/locks";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * C.1 prep: the advisory-lock primitives. Full cross-connection contention is
 * proven by scripts/verify-pool-driver.ts against the real pool driver
 * (PGlite is single-session); here we pin key derivation and both execution
 * paths of withStreamWriteLock.
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;
const OLD_DRIVER = process.env.DB_DRIVER;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db);
});
afterEach(async () => {
  process.env.DB_DRIVER = OLD_DRIVER;
  if (OLD_DRIVER === undefined) delete process.env.DB_DRIVER;
  await close();
});

describe("advisoryLockKey", () => {
  it("is deterministic, scope-sensitive, and spans the signed 64-bit space", () => {
    const a = advisoryLockKey("conn-1:stream-a");
    expect(advisoryLockKey("conn-1:stream-a")).toBe(a);
    expect(advisoryLockKey("conn-1:stream-b")).not.toBe(a);
    expect(typeof a).toBe("bigint");
    expect(a >= -(2n ** 63n) && a < 2n ** 63n).toBe(true);
  });
});

describe("withStreamWriteLock", () => {
  const insertOne = async (tx: DB) => {
    await tx.insert(events).values({
      eventId: `lock:conn:${Math.random()}`,
      orgId: "org_test",
      connectionId,
      source: "webhook",
      eventType: "t",
      occurredAt: new Date(),
      properties: {},
    });
    return "done";
  };

  it("http driver (default): runs the body directly, no lock claimed", async () => {
    delete process.env.DB_DRIVER;
    expect(advisoryLocksEnabled()).toBe(false);
    const r = await withStreamWriteLock(db, "conn-1:stream-a", insertOne);
    expect(r).toEqual({ acquired: true, result: "done" });
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("pool driver: takes the advisory lock inside a transaction and commits the body", async () => {
    process.env.DB_DRIVER = "pool";
    expect(advisoryLocksEnabled()).toBe(true);
    const r = await withStreamWriteLock(db, "conn-1:stream-a", insertOne);
    expect(r).toEqual({ acquired: true, result: "done" });
    expect(await db.select().from(events)).toHaveLength(1);

    // xact-scoped lock released with the transaction → a second run acquires.
    const again = await withStreamWriteLock(db, "conn-1:stream-a", insertOne);
    expect(again.acquired).toBe(true);
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("pool driver: a throwing body rolls the whole critical section back", async () => {
    process.env.DB_DRIVER = "pool";
    await expect(
      withStreamWriteLock(db, "conn-1:stream-a", async (tx) => {
        await insertOne(tx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(events)).toHaveLength(0); // nothing persisted
  });
});
