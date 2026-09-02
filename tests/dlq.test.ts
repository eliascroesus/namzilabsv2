import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { storeRawEvent } from "@/ingestion/raw-store";
import { deadLetterRawEvent, replayRawEvent } from "@/ingestion/pipeline";
import { unresolvedDeadLetters, unresolvedDeadLetterCountsByConnection } from "@/lib/dead-letter";
import { deadLetter, deliveryLog, connections, events, flows, flowResults, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

/**
 * Mocks below back the `replayDeadLetterAction` describe block further down
 * (the C.10 recompute-kick test for the server-action caller). They are
 * file-scoped, but inert for every other test in this file: `replayRawEvent`
 * and `deadLetterRawEvent` take `db` as an explicit argument and never call
 * `getDb()`, so nothing above changes behaviour.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db }));

let orgCtx: { orgId: string; userId: string; role?: string } = { orgId: "org_test", userId: "user_1" };
vi.mock("@/lib/auth", () => ({ requireOrg: async () => orgCtx }));

const hoistedRedirect = vi.hoisted(() => ({ url: null as unknown }));
vi.mock("next/navigation", () => ({
  redirect: (u: unknown) => {
    hoistedRedirect.url = u;
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const sentByAction: Array<{ name: string; data: Record<string, unknown> }> = [];
let actionSendShouldFail = false;
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: { name: string; data: Record<string, unknown> }) => {
      if (actionSendShouldFail) throw new Error("inngest unreachable");
      sentByAction.push(e);
    },
  },
}));

const { replayDeadLetterAction } = await import("@/app/integrations/actions");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  orgCtx = { orgId: "org_test", userId: "user_1" };
  hoistedRedirect.url = null;
  sentByAction.length = 0;
  actionSendShouldFail = false;
});
afterEach(async () => {
  await close();
});

describe("dead-letter queue + replay", () => {
  it("parks an exhausted event in the DLQ and keeps the connection in the sweep", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });

    await deadLetterRawEvent(db, raw.id, 6, "processing blew up");

    const dlq = await db.select().from(deadLetter).where(isNull(deadLetter.resolvedAt));
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error).toBe("processing blew up");

    const failed = await db.select().from(deliveryLog).where(eq(deliveryLog.status, "failed"));
    expect(failed).toHaveLength(1);

    /**
     * THE CONNECTION MUST STAY ACTIVE. `status = "error"` has no expiry and no
     * probe — `dueConnectionsForSweep` selects only active, and the only writer
     * back to active runs inside the sweep — so the old behaviour (flip to
     * error here) meant one malformed webhook body silently ended polling
     * forever on a connection whose poll path was healthy. The DLQ row plus
     * `lastError` is the record; the sweep keeps running.
     */
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("active");
    expect(conn.lastError).toContain("processing blew up");
    expect(conn.lastError).toContain("dead-lettered");
  });

  it("a successful replay un-parks a connection stuck at status=error from the old behaviour", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 6, "was parked by the pre-fix code");
    // Simulate a row written by the OLD dead-letter path, which set status=error.
    await db.update(connections).set({ status: "error" }).where(eq(connections.id, connectionId));

    await replayRawEvent(db, raw.id, "org_test");

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("active");
    expect(conn.lastError).toBeNull();
  });

  it("a replay never flips a DISABLED connection back on", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 6, "boom");
    // The user's off switch is not ours to flip on a replay.
    await db.update(connections).set({ status: "disabled" }).where(eq(connections.id, connectionId));

    await replayRawEvent(db, raw.id, "org_test");

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("disabled");
  });

  it("replays a dead-lettered event: it processes and the DLQ row resolves", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 6, "transient outage");

    const res = await replayRawEvent(db, raw.id, "org_test");
    expect(res.inserted).toBe(1);
    expect(await db.select().from(events)).toHaveLength(1);

    const unresolved = await db.select().from(deadLetter).where(isNull(deadLetter.resolvedAt));
    expect(unresolved).toHaveLength(0);
  });

  /**
   * A REPLAY THAT CHANGED SOMETHING IS DATA ARRIVING, and the tiles computed
   * from it must find out. The blanket ten-minute recompute used to surface a
   * replayed event by accident; tiles now recompute only when something says
   * they must, so the replay says it. REVERT THE MARK IN replayRawEvent AND
   * THIS FAILS: the user replays a dead-lettered payment, the UI confirms it,
   * and the revenue tile keeps serving the old number as "fresh" for hours.
   *
   * Seeded with an EXISTING event the replay UPDATES (same natural id, new
   * type), because updates are the half that was silently dropped everywhere:
   * "inserted > 0" gates read as "new data" and a changed record is not new.
   */
  it("a replay that inserts or updates marks dependent tiles stale", async () => {
    const connectionId = await seedConnection(db);
    const graph = {
      nodes: [{ id: "a1", type: "app", data: { config: { connectionId, source: "webhook" } } }],
      edges: [],
      metrics: [],
    };
    const [flow] = await db
      .insert(flows)
      .values({ orgId: "org_test", name: "revenue", draftGraph: graph, status: "published", publishedVersion: 1 })
      .returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: "org_test", version: 1, graph });
    await db.insert(flowResults).values({
      orgId: "org_test",
      flowId: flow.id,
      version: 1,
      outputNodeId: "o1",
      tile: { name: "revenue", value: 5000 },
      status: "fresh",
      computedAt: new Date(),
    });

    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    // First replay INSERTS the event and must mark.
    await replayRawEvent(db, raw.id, "org_test");
    let [r] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(r.status).toBe("stale");

    // Recompute happened elsewhere; the tile is fresh again.
    await db.update(flowResults).set({ status: "fresh" }).where(eq(flowResults.flowId, flow.id));

    // A redelivery of the SAME record with changed content is an UPDATE
    // (inserted: 0, updated: 1) — and it must mark just the same.
    const raw2 = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "rescheduled" },
      signatureValid: true,
    });
    const res = await replayRawEvent(db, raw2.id, "org_test");
    expect(res.inserted).toBe(0);
    expect(res.updated).toBe(1);
    [r] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(r.status).toBe("stale");
  });

  it("refuses a cross-tenant replay (organization isolation)", async () => {
    const connectionId = await seedConnection(db, { orgId: "org_a" });
    const raw = await storeRawEvent(db, {
      orgId: "org_a",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    // A caller from a different org must not be able to replay this event.
    await expect(replayRawEvent(db, raw.id, "org_b")).rejects.toThrow(/forbidden/);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});

/**
 * The DLQ's read surface — the door the red dashboard count never had. The
 * replay behavior above is the mechanism; these pin that the LISTS the pages
 * render are org-scoped, connection-scoped and unresolved-only, so the door
 * can never show a neighbour's failures or a failure already fixed.
 */
describe("dead-letter read surface", () => {
  it("lists only the caller's unresolved rows for the named connection", async () => {
    const mine = await seedConnection(db, { orgId: "org_a", name: "Mine" });
    const sibling = await seedConnection(db, { orgId: "org_a", name: "Sibling" });
    const theirs = await seedConnection(db, { orgId: "org_b", name: "Theirs" });
    await db.insert(deadLetter).values([
      { orgId: "org_a", connectionId: mine, error: "mine-unresolved", attempts: 3 },
      { orgId: "org_a", connectionId: mine, error: "mine-resolved", attempts: 3, resolvedAt: new Date() },
      { orgId: "org_a", connectionId: sibling, error: "sibling-row", attempts: 1 },
      { orgId: "org_b", connectionId: theirs, error: "foreign-row", attempts: 1 },
    ]);

    const rows = await unresolvedDeadLetters(db, "org_a", mine);

    // Sabotage pins: drop the org predicate → foreign-row appears for a
    // forged connection id; drop resolvedAt → the fixed row reappears; drop
    // the connection predicate → the sibling's row leaks into this page.
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe("mine-unresolved");
  });

  it("counts by connection with names, org-scoped, unresolved only", async () => {
    const a = await seedConnection(db, { orgId: "org_a", name: "Webhook A" });
    const b = await seedConnection(db, { orgId: "org_a", name: "Webhook B" });
    const foreign = await seedConnection(db, { orgId: "org_b", name: "Foreign" });
    await db.insert(deadLetter).values([
      { orgId: "org_a", connectionId: a, error: "x", attempts: 1 },
      { orgId: "org_a", connectionId: a, error: "y", attempts: 1 },
      { orgId: "org_a", connectionId: b, error: "z", attempts: 1 },
      { orgId: "org_a", connectionId: b, error: "fixed", attempts: 1, resolvedAt: new Date() },
      { orgId: "org_b", connectionId: foreign, error: "not-yours", attempts: 1 },
    ]);

    const counts = await unresolvedDeadLetterCountsByConnection(db, "org_a");

    expect(counts).toEqual([
      { connectionId: a, name: "Webhook A", count: 2 },
      { connectionId: b, name: "Webhook B", count: 1 },
    ]);
  });
});

/**
 * C.10 — the connection-page replay button is a THIN CALLER of the same
 * `replayRawEvent` exercised above, and it needs the same fix: a replay that
 * changed something must kick a recompute, or the repaired record sits
 * "fixed" in the DB while its tile keeps serving the old number until the
 * next age-backstop sweep. REVERT THE KICK IN `replayDeadLetterAction` AND
 * THIS FAILS.
 */
describe("replayDeadLetterAction kicks a recompute on success", () => {
  const fd = (rawEventId: string, connectionId: string) => {
    const f = new FormData();
    f.set("rawEventId", rawEventId);
    f.set("connectionId", connectionId);
    return f;
  };

  it("sends flow/recompute.requested for the org after a successful replay", async () => {
    const connectionId = await seedConnection(db, { orgId: "org_test" });
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 3, "transient outage");

    await expect(replayDeadLetterAction(fd(raw.id, connectionId))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(String(hoistedRedirect.url)).toContain("replay=ok");
    const recomputes = sentByAction.filter((e) => e.name === "flow/recompute.requested");
    expect(recomputes).toHaveLength(1);
    expect(recomputes[0].data).toEqual({ orgId: "org_test" });
  });

  it("does not send a recompute when the replay fails", async () => {
    const connectionId = await seedConnection(db, { orgId: "org_test" });

    await expect(
      replayDeadLetterAction(fd("00000000-0000-0000-0000-000000000000", connectionId)),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(String(hoistedRedirect.url)).toContain("replay=failed");
    expect(sentByAction.filter((e) => e.name === "flow/recompute.requested")).toHaveLength(0);
  });

  it("a failed recompute kick does not fail the action (best-effort)", async () => {
    const connectionId = await seedConnection(db, { orgId: "org_test" });
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 3, "transient outage");
    actionSendShouldFail = true;

    await expect(replayDeadLetterAction(fd(raw.id, connectionId))).rejects.toThrow(/NEXT_REDIRECT/);

    // Still redirects to the OK path — the failed inngest.send never surfaces.
    expect(String(hoistedRedirect.url)).toContain("replay=ok");
  });
});
