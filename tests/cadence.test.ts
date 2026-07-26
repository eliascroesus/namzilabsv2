import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections } from "@/db/schema";
import {
  BASE_INTERVAL_MS,
  WEBHOOK_BACKSTOP_INTERVAL_MS,
  applyCadence,
  decideCadence,
  promoteToBaseCadence,
} from "@/lib/sync/cadence";
import { dueConnectionsForSweep } from "@/ingestion/reconcile";
import type { DB } from "@/db/types";

/**
 * H.1/H.2 (idle demotion, no-op-cheap sweeps) and F.5 (work-avoidance where a
 * healthy webhook already covers the source). The product rule these encode:
 * background cost tracks the DATA-CHANGE RATE, never the tenant count — and
 * demotion never means "stop", only "later".
 */

const NOW = new Date("2026-07-01T12:00:00Z");
let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("H.1/H.2 — cadence policy", () => {
  it("a sweep that changed data returns to base cadence and clears the streak", () => {
    const d = decideCadence({ changed: true, previousNoOps: 40, now: NOW });
    expect(d.intervalMs).toBe(BASE_INTERVAL_MS);
    expect(d.consecutiveNoOpSweeps).toBe(0);
    expect(d.reason).toBe("changed");
  });

  it("quiet connections widen through the tiers (10min → 30min → 2h → 6h → daily)", () => {
    const at = (noOps: number) => decideCadence({ changed: false, previousNoOps: noOps, now: NOW }).intervalMs;
    expect(at(0)).toBe(10 * 60_000); // base
    expect(at(5)).toBe(30 * 60_000); // crosses the 6-no-op tier
    expect(at(17)).toBe(2 * 60 * 60_000);
    expect(at(39)).toBe(6 * 60 * 60_000);
    expect(at(200)).toBe(24 * 60 * 60_000); // saturates at daily — still polls
  });

  it("the streak only grows on genuinely no-op sweeps", () => {
    expect(decideCadence({ changed: false, previousNoOps: 3, now: NOW }).consecutiveNoOpSweeps).toBe(4);
    expect(decideCadence({ changed: true, previousNoOps: 3, now: NOW }).consecutiveNoOpSweeps).toBe(0);
  });
});

describe("F.5 — a healthy webhook demotes polling to a backstop", () => {
  it("widens the floor while the subscription was recently verified healthy", () => {
    const d = decideCadence({ changed: false, previousNoOps: 0, webhookHealthyAt: NOW, now: NOW });
    expect(d.intervalMs).toBe(WEBHOOK_BACKSTOP_INTERVAL_MS); // 10min → 1h
    expect(d.reason).toBe("webhook-backstop");
  });

  it("a STALE health check does not demote — an unverified webhook covers nothing", () => {
    const old = new Date(NOW.getTime() - 6 * 60 * 60_000);
    const d = decideCadence({ changed: false, previousNoOps: 0, webhookHealthyAt: old, now: NOW });
    expect(d.intervalMs).toBe(BASE_INTERVAL_MS);
    expect(d.reason).toBe("idle-tier");
  });

  it("never SHORTENS an already-longer idle interval (backstop is a floor, not an override)", () => {
    const d = decideCadence({ changed: false, previousNoOps: 200, webhookHealthyAt: NOW, now: NOW });
    expect(d.intervalMs).toBe(24 * 60 * 60_000); // daily tier wins over the 1h floor
  });

  it("a change still beats webhook coverage — live data returns to base cadence", () => {
    const d = decideCadence({ changed: true, previousNoOps: 50, webhookHealthyAt: NOW, now: NOW });
    expect(d.intervalMs).toBe(BASE_INTERVAL_MS);
  });
});

describe("cadence is enforced by the sweep filter", () => {
  it("only connections whose next_sweep_at has arrived are dispatched", async () => {
    const fresh = await seedConnection(db, { source: "close" }); // never swept → due
    const due = await seedConnection(db, { source: "close" });
    const notDue = await seedConnection(db, { source: "close" });

    await applyCadence(db, due, decideCadence({ changed: false, previousNoOps: 0, now: new Date(NOW.getTime() - 60 * 60_000) }), false);
    await applyCadence(db, notDue, decideCadence({ changed: false, previousNoOps: 100, now: NOW }), false);

    const ids = (await dueConnectionsForSweep(db, NOW)).map((c) => c.id);
    expect(ids).toContain(fresh); // null next_sweep_at = due immediately
    expect(ids).toContain(due); // its interval elapsed
    expect(ids).not.toContain(notDue); // demoted to daily, not yet due
  });

  it("promoteToBaseCadence makes an idle connection due at once (webhook / user action)", async () => {
    const id = await seedConnection(db, { source: "close" });
    await applyCadence(db, id, decideCadence({ changed: false, previousNoOps: 200, now: NOW }), false);
    expect((await dueConnectionsForSweep(db, NOW)).map((c) => c.id)).not.toContain(id);

    await promoteToBaseCadence(db, id, NOW);
    expect((await dueConnectionsForSweep(db, NOW)).map((c) => c.id)).toContain(id);

    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(row.consecutiveNoOpSweeps).toBe(0); // the streak resets too
  });

  it("applyCadence stamps webhook health only when it was verified this sweep", async () => {
    const id = await seedConnection(db, { source: "sendblue" });
    await applyCadence(db, id, decideCadence({ changed: false, previousNoOps: 0, now: NOW }), false, NOW);
    let [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(row.webhookHealthyAt).toBeNull();

    await applyCadence(db, id, decideCadence({ changed: false, previousNoOps: 1, now: NOW }), true, NOW);
    [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(row.webhookHealthyAt).not.toBeNull();
  });

  /**
   * A stream still telling us it has more to fetch is the opposite of idle.
   *
   * `changed` counts inserts, updates and soft-deletes — and a re-scan of an
   * unchanged window produces only dedups, so a part-finished walk read as an
   * idle connection and slid down the tier ladder. It compounds: each demotion
   * makes the remaining pages arrive more slowly, so a big Calendly window
   * reached the 6-hour tier and its numbers never caught up.
   */
  it("holds base cadence while a scan is incomplete, however long the no-op streak", () => {
    const idle = decideCadence({ changed: false, previousNoOps: 50, now: NOW });
    expect(idle.intervalMs).toBe(6 * 60 * 60_000); // would have been demoted…
    expect(idle.consecutiveNoOpSweeps).toBe(51);

    const midScan = decideCadence({ changed: false, incomplete: true, previousNoOps: 50, now: NOW });
    expect(midScan.intervalMs).toBe(BASE_INTERVAL_MS);
    expect(midScan.reason).toBe("scan-incomplete");
    // …and the streak is HELD, not advanced: sweeps that were still working
    // must not push the connection further down the ladder.
    expect(midScan.consecutiveNoOpSweeps).toBe(50);
  });

  it("a real change still wins over an incomplete scan", () => {
    const d = decideCadence({ changed: true, incomplete: true, previousNoOps: 9, now: NOW });
    expect(d.reason).toBe("changed");
    expect(d.consecutiveNoOpSweeps).toBe(0);
  });
});
