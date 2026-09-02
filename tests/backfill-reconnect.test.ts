import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { backfillJobs, connections, sourceStreams } from "@/db/schema";
import { DISCONNECTED_DETAIL, checkpointJob, finishJob, requestBackfill } from "@/lib/backfill/jobs";
import type { DB } from "@/db/types";

/**
 * C11 — a backfill cut short by a disconnect must not block re-import forever.
 *
 * `runBackfillSlice` (run.ts) ends a job `partial` with `DISCONNECTED_DETAIL`
 * when a slice finds the connection `disabled` (see backfill-lane.test.ts,
 * "ends cleanly when the connection was disconnected"). `requestBackfill`
 * treats ANY `queued|running|complete|partial` job as satisfying a request at
 * least that deep — right for a `partial` stopped by the row ceiling or an
 * exhausted source, which really are done, and wrong for this one: nobody
 * asked the import to stop, the account did, so it must not look finished
 * forever once the account comes back.
 *
 * `reconnectConnection` is the one place that knows the disconnect is over, so
 * it is the one place that revives these jobs. It lives behind
 * `getDb()`/`server-only`, hence the mocks — same recipe as org-caps.test.ts
 * and calendly-webhook.test.ts.
 */

let db: DB;
let close: () => Promise<void>;

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const ORG = "org_reconnect_bf";
const NOW = new Date("2026-07-01T00:00:00Z");
const back = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let connId = "";
let streamId = "";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  connId = await seedConnection(db, { orgId: ORG, source: "close" });
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId: connId, configHash: "hash-a", config: {} })
    .returning();
  streamId = stream.id;
});
afterEach(async () => {
  await close();
});

const ask = (days = 90) =>
  requestBackfill(db, { id: streamId, orgId: ORG, connectionId: connId, configHash: "hash-a" }, "close", back(days));
const reload = async (id: string) => (await db.select().from(backfillJobs).where(eq(backfillJobs.id, id)))[0];
const disable = () =>
  db.update(connections).set({ status: "disabled", disabledAt: NOW }).where(eq(connections.id, connId));

describe("reconnecting revives a job the disconnect cut short", () => {
  it("queues a partial job stopped by DISCONNECTED_DETAIL again, keeping its checkpoint", async () => {
    const { job } = await ask(90);
    await checkpointJob(db, job.id, { checkpoint: "cursor-9", oldestSeen: back(40), rowsImported: 120 }, NOW);
    await finishJob(db, job.id, { status: "partial", detail: DISCONNECTED_DETAIL }, NOW);
    await disable();

    const { reconnectConnection } = await import("@/lib/connections");
    await reconnectConnection(ORG, connId);

    const revived = await reload(job.id);
    expect(revived.status).toBe("queued");
    expect(revived.detail).toBeNull();
    expect(revived.finishedAt).toBeNull();
    // Resume, not restart — the whole point of keeping these.
    expect(revived.checkpoint).toBe("cursor-9");
    expect(revived.reachedFloor!.getTime()).toBe(back(40).getTime());
    expect(revived.rowsImported).toBe(120);
  });

  it("leaves a job finished partial for any other reason exactly alone", async () => {
    const { job } = await ask(90);
    await checkpointJob(db, job.id, { checkpoint: "cursor-3", oldestSeen: back(20), rowsImported: 30 }, NOW);
    const otherDetail = "Reached this stream's 25,000-row limit before the full window.";
    await finishJob(db, job.id, { status: "partial", detail: otherDetail }, NOW);
    await disable();

    const { reconnectConnection } = await import("@/lib/connections");
    await reconnectConnection(ORG, connId);

    // This job is genuinely done — the row ceiling is not a symptom of the
    // account being disconnected, and reviving it would re-walk work that
    // already correctly stopped.
    const untouched = await reload(job.id);
    expect(untouched.status).toBe("partial");
    expect(untouched.detail).toBe(otherDetail);
    expect(untouched.checkpoint).toBe("cursor-3");
  });

  it("requestBackfill after reconnect hands back the revived, runnable job — not a stuck partial one", async () => {
    const { job } = await ask(90);
    await checkpointJob(db, job.id, { checkpoint: "cursor-1", oldestSeen: back(10), rowsImported: 5 }, NOW);
    await finishJob(db, job.id, { status: "partial", detail: DISCONNECTED_DETAIL }, NOW);
    await disable();

    const { reconnectConnection } = await import("@/lib/connections");
    await reconnectConnection(ORG, connId);

    const again = await ask(90);
    expect(again.created).toBe(false); // still the same unit of work, not a new row
    expect(again.job.id).toBe(job.id);
    // The property that matters: it is QUEUED, so the sweep will actually pick
    // it up again — not `partial`, which the sweep can never resume.
    expect(again.job.status).toBe("queued");
  });
});
