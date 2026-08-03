import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, sourceStreams } from "@/db/schema";
import { syncStream } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import type { Connector, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * "THERE IS MORE TO FETCH" HAS TO REACH THE RUNNER.
 *
 * `PollResult.incomplete` promises it "feeds two things: the cadence (a
 * connection with work outstanding must not be demoted as idle) and the Test's
 * note". That was true only for CONNECTION-scoped sources, which read it in
 * reconcile.ts. The stream-scoped path destructured five fields off the poll
 * result and not this one, so every stream-scoped connector's `incomplete` was
 * dropped: Calendly, Google Calendar, Sheets, Instantly.
 *
 * What it cost concretely: Calendly's restart alarm sets `incomplete` when a
 * side has restarted twice in a row, and its own comment says that "holds the
 * connection at base cadence rather than letting the ladder widen it to an
 * hour". It never did. The alarm reached the log and stopped there.
 */

const ORG = "org_held";
let db: DB;
let close: () => Promise<void>;

/** What the stub connector reports on its next poll. */
let NEXT: PollResult = { records: [], nextCursor: null };

const stub: Connector = {
  source: "held-stub",
  authType: "none",
  verifySignature: () => true,
  poll: async () => NEXT,
};
registerConnector(stub);

async function setup(source: string) {
  const connectionId = await seedConnection(db, { orgId: ORG, source });
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId, configHash: "hash-held", config: {} })
    .returning();
  return { conn, stream };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  NEXT = { records: [], nextCursor: null };
});
afterEach(async () => {
  await close();
});

describe("the runner reads the connector's own `incomplete`", () => {
  /**
   * A null cursor is deliberate: the walk then breaks BEFORE the runner's own
   * page-budget rule can set `incomplete` itself, so the only way the flag can
   * come back true is if the runner took it from the connector.
   */
  it("surfaces `incomplete` even when the walk ended on its own", async () => {
    const { conn, stream } = await setup("held-stub");
    NEXT = { records: [], nextCursor: null, incomplete: true };

    const res = await syncStream(db, conn, stream);
    expect(res.incomplete).toBe(true);
  });

  it("does not invent `incomplete` for a connector that reported none", async () => {
    const { conn, stream } = await setup("held-stub");
    NEXT = { records: [], nextCursor: null };

    const res = await syncStream(db, conn, stream);
    expect(res.incomplete).toBeFalsy();
  });
});
