import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, syncState } from "@/db/schema";
import { primeConnection, runSync } from "@/lib/sync/resync";
import { reconcileConnection } from "@/ingestion/reconcile";
import {
  awaitConnectionSyncLock,
  connectionLockScope,
  releaseConnectionSyncLock,
  tryConnectionSyncLock,
} from "@/lib/sync/locks";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * C.1 at connection scope.
 *
 * A connection-scoped source (Sendblue, Close) has no streams, so the per-stream
 * lock cannot cover it — and until now nothing else did either. Inngest's keys
 * look like they should: `sync-connection` carries
 * `concurrency: {key: connectionId, limit: 1}` and `reconcile-one-connection`
 * carries `singleton: {key: connectionId, mode: "skip"}`. But those scope PER
 * FUNCTION, so the two never exclude each other, and the inline Test path
 * (`primeConnection`, added when Test stopped skipping these sources) does not
 * go through Inngest at all.
 *
 * The failure that leaves: a Test and a sweep read the same cursor, both call
 * the provider for the same page, and both write a cursor — so the connection's
 * high-water mark can move BACKWARDS, and the next sweep re-reads a window that
 * was already consumed. The lease closes it for all three entry points.
 */

const ORG = "org_lock";
const KEY = randomBytes(32).toString("base64");

let db: DB;
let close: () => Promise<void>;
let connId: string;

/** Every provider call this test run made, in order, with the cursor it sent. */
let polls: Array<{ cursor: string | null; at: number }>;
/**
 * When armed, a poll parks on this until the test opens it — modelling a slow
 * provider, so a second writer provably arrives while the first is mid-flight.
 */
let pollGate: Promise<void> | null;

/**
 * THE FIXTURES ARE ANCHORED TO THE RUN, not to a date.
 *
 * This used to read `Date.parse("2026-07-01T12:00:00Z")`, and the connectors
 * bound their first sync to the last 30 days — so the fixtures aged out of the
 * window the code asks for and the suite began failing on a DATE, exactly 30
 * days later, for a reason with nothing to do with the behaviour under test. It
 * cost a verification pass to rule out as a real regression.
 *
 * A base captured once at module load keeps every relative offset stable within
 * a run while never drifting out of any window. Faking the clock would work too
 * and is what `tests/close-poll.test.ts` does — but that file touches no
 * database, and here a faked JS `Date` would disagree with PGlite's own `now()`
 * inside the sync lease.
 */
const BASE = Date.now();
const T = (mins: number) => new Date(BASE + mins * 60_000).toISOString();

const message = (handle: string, mins: number) => ({
  message_handle: handle,
  status: "DELIVERED",
  is_outbound: true,
  to_number: "+15551234567",
  date_sent: T(mins),
});

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  polls = [];
  pollGate = null;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      // The webhook-health check the sweep runs first — not a message poll.
      if (url.pathname.includes("/account/webhooks")) {
        return json({ webhooks: [] });
      }
      polls.push({ cursor: url.searchParams.get("offset"), at: Date.now() });
      if (pollGate) await pollGate;
      return json({ messages: [message("h1", -5), message("h2", -3)] });
    }),
  );

  const [row] = await db
    .insert(connections)
    .values({
      orgId: ORG,
      source: "sendblue",
      name: "Sendblue",
      status: "active",
      authType: "secret",
      credentialsEncrypted: encrypt(JSON.stringify({ apiKey: "kid", apiSecret: "ksec" }), Buffer.from(KEY, "base64")),
    })
    .returning({ id: connections.id });
  connId = row.id;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

function json(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

async function liveEventCount(): Promise<number> {
  const rows = await db.select().from(events).where(and(eq(events.connectionId, connId), isNull(events.deletedAt)));
  return rows.length;
}

async function lockRow() {
  const [row] = await db.select().from(syncState).where(eq(syncState.connectionId, connId)).limit(1);
  return row ?? null;
}

describe("connection sync lease — the Test/sweep race", () => {
  /**
   * THE regression. Both entry points are driven for real, concurrently, on one
   * connection: the sweep (`reconcileConnection`) and the inline Test path
   * (`primeConnection`). Exactly one may reach the provider.
   */
  it("a Test racing the sweep produces ONE provider poll, not two", async () => {
    const [sweep, test] = await Promise.all([
      reconcileConnection(db, connId),
      primeConnection(db, ORG, connId),
    ]);

    expect(polls).toHaveLength(1);

    // Whoever lost stood down cleanly — no error, no duplicate write.
    expect(test.ok).toBe(true);
    expect(sweep.skipped === true || sweep.polled).toBe(true);

    // One poll's worth of records, deduped either way.
    expect(await liveEventCount()).toBe(2);
  });

  /**
   * The cursor is the thing a duplicate poll corrupts. Two writers that both
   * read cursor X, poll, and write their own next-cursor can leave the stored
   * mark BEHIND where one of them already consumed — so the next sweep re-reads
   * a window it has already seen, or worse, skips one.
   */
  it("never interleaves cursor writes — the stored mark comes from one writer", async () => {
    await Promise.all([reconcileConnection(db, connId), primeConnection(db, ORG, connId)]);
    const after = await lockRow();

    // Exactly one poll happened, so exactly one cursor was written from it.
    expect(polls).toHaveLength(1);
    expect(after?.lastPolledAt).not.toBeNull();
    // And the lease is handed back, whichever writer held it.
    expect(after?.syncLockUntil ?? null).toBeNull();
    expect(after?.syncLockToken ?? null).toBeNull();
  });

  it("the sweep stands down rather than waiting when a sync is in flight", async () => {
    const held = await tryConnectionSyncLock(db, connId);
    expect(held).not.toBeNull();

    const r = await reconcileConnection(db, connId);
    expect(r.skipped).toBe(true);
    expect(r.polled).toBe(false);
    expect(polls).toHaveLength(0); // no provider call, and no budget spent

    await releaseConnectionSyncLock(db, connId, held!.token);
  });

  /**
   * Q6: the person is watching a spinner. A Test that collides must not skip
   * (stale data) or error (blaming them for timing) — it waits for the writer
   * that is already fetching exactly what they asked for, then adopts it.
   */
  it("a Test adopts an in-flight sync's result instead of polling again", async () => {
    // Park the sweep inside its provider call, so the Test provably starts
    // while the sweep holds the lease.
    let openGate!: () => void;
    pollGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const sweepPromise = reconcileConnection(db, connId);
    await vi.waitFor(() => expect(polls).toHaveLength(1));

    const testPromise = primeConnection(db, ORG, connId);
    // Give the Test time to reach the lease and start waiting on it.
    await new Promise((r) => setTimeout(r, 50));
    openGate();

    const [, test] = await Promise.all([sweepPromise, testPromise]);

    expect(test).toEqual({ ok: true, refreshed: true });
    expect(polls).toHaveLength(1); // adopted, NOT re-polled
    expect(await liveEventCount()).toBe(2);
  });

  it("runSync reports a skip rather than silently doing nothing", async () => {
    const held = await tryConnectionSyncLock(db, connId);
    const res = await runSync(db, connId, "incremental");

    expect(res.skipped).toBe(true);
    expect(res.polled).toBe(false);
    expect(polls).toHaveLength(0);
    // A skipped run leaves no trace — least of all a status the winner must fix.
    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    expect(conn.syncStatus).not.toBe("importing");

    await releaseConnectionSyncLock(db, connId, held!.token);
  });
});

describe("connection sync lease — the primitive", () => {
  it("is keyed per connection, and says so in the row it writes", async () => {
    expect(connectionLockScope(connId)).toBe(`connection:${connId}`);

    // A stuck lease has to be legible to whoever finds it.
    const held = await tryConnectionSyncLock(db, connId);
    const row = await lockRow();
    expect(row?.syncLockToken).toBe(held!.token);
    expect(row?.syncLockToken).toMatch(new RegExp(`^connection:${connId}:`));
    await releaseConnectionSyncLock(db, connId, held!.token);
  });

  it("excludes a second holder, and admits one after release", async () => {
    const first = await tryConnectionSyncLock(db, connId);
    expect(first).not.toBeNull();
    expect(await tryConnectionSyncLock(db, connId)).toBeNull();

    await releaseConnectionSyncLock(db, connId, first!.token);
    const second = await tryConnectionSyncLock(db, connId);
    expect(second).not.toBeNull();
    await releaseConnectionSyncLock(db, connId, second!.token);
  });

  /**
   * The reason this is a lease and not a session lock: a serverless container
   * killed mid-poll leaves no session to die with. Without an expiry the
   * connection would be locked out forever by a process that no longer exists.
   */
  it("expires, so a holder killed mid-sync cannot lock the connection out forever", async () => {
    const past = new Date(Date.now() - 10 * 60_000);
    const abandoned = await tryConnectionSyncLock(db, connId, past); // TTL already elapsed
    expect(abandoned).not.toBeNull();

    // A live caller takes it over rather than waiting on a dead holder.
    expect(await tryConnectionSyncLock(db, connId)).not.toBeNull();
  });

  /**
   * Fencing. A waiter that gave up and proceeded anyway must not release the
   * lease of the writer it gave up on — that would let a third writer in while
   * the second is still mid-poll, which is the race with extra steps.
   */
  it("a stale token cannot release someone else's lease", async () => {
    const mine = await tryConnectionSyncLock(db, connId);
    await releaseConnectionSyncLock(db, connId, "not-my-token");

    expect(await tryConnectionSyncLock(db, connId)).toBeNull(); // still held
    await releaseConnectionSyncLock(db, connId, mine!.token);
    expect(await tryConnectionSyncLock(db, connId)).not.toBeNull();
  });

  it("await returns immediately when nothing holds the connection", async () => {
    expect(await awaitConnectionSyncLock(db, connId, 1_000)).toBe("free");
  });

  it("await gives up on a wedged holder rather than hanging the editor", async () => {
    await tryConnectionSyncLock(db, connId);
    const t0 = Date.now();
    expect(await awaitConnectionSyncLock(db, connId, 300, 50)).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it("a sync that throws hands the lease back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "boom" }, 500)));
    await expect(runSync(db, connId, "incremental")).rejects.toThrow();

    const row = await lockRow();
    expect(row?.syncLockUntil ?? null).toBeNull();
    // Provably reusable, not merely null-looking.
    expect(await tryConnectionSyncLock(db, connId)).not.toBeNull();
  });
});
