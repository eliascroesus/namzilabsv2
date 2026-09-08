import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { syncStream } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import { connections, events, sourceStreams } from "@/db/schema";
import type { Connector, CanonicalEvent, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * A MIRROR THAT COULD NOT SEE EVERYTHING MUST NOT DELETE WHAT IT MISSED.
 *
 * `retireAbsent` tombstones every stored row a mirror read did not return,
 * because a mirror's promise is "this IS the resource". Google Sheets could
 * always keep that promise — a tab is read whole — so the runner assumed every
 * mirror could, and destructured `records, nextCursor, mirrorScope, unchanged`
 * from the poll result while dropping `incomplete` on the floor. The paged
 * branch of the same function had already been fixed for exactly this omission.
 *
 * Airtable is the first mirror that can come back TRUNCATED: its walk stops at
 * a page cap and reports `incomplete: read.offset != null`, and Airtable's docs
 * say a request carrying neither `sort` nor `view` returns records "in an
 * arbitrary order". So a base past the cap handed the runner an arbitrary
 * prefix, and every row outside that prefix was soft-deleted — every sweep,
 * with no error and no drift alarm, because the alarm compared the prefix
 * against the post-retire count and found them equal.
 *
 * The source here is "airtable" because the branch is chosen by the CATALOG
 * (`isMirrorSource` reads `sync: "mirror"`), so a fictional source name would
 * silently exercise the paged branch instead and prove nothing.
 */

let db: DB;
let close: () => Promise<void>;

/** What the fake base currently returns, and whether the read reached the end. */
let ROWS: CanonicalEvent[] = [];
let TRUNCATED = false;

const row = (id: string): CanonicalEvent => ({
  eventId: `airtable:rec${id}`,
  eventType: "record_created",
  subject: id,
  occurredAt: new Date("2026-03-01T00:00:00Z"),
  properties: { id },
});

registerConnector({
  source: "airtable",
  authType: "apiKey",
  verifySignature: () => false,
  poll: async (): Promise<PollResult> => ({ records: ROWS, nextCursor: null, incomplete: TRUNCATED }),
} as Connector);

async function setup() {
  const connectionId = await seedConnection(db, { source: "airtable" });
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: "org_test", connectionId, configHash: "hash-a", config: { tableId: "tbl1" } })
    .returning();
  return { conn, stream };
}

const live = async () => {
  const rows = await db.select().from(events).where(isNull(events.deletedAt));
  return rows.map((r) => r.subject).sort();
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ROWS = [];
  TRUNCATED = false;
});
afterEach(async () => {
  await close();
});

describe("a truncated mirror read retires nothing", () => {
  it("keeps the rows a capped read could not reach, sweep after sweep", async () => {
    const { conn, stream } = await setup();

    // A complete read seeds three records.
    ROWS = [row("a"), row("b"), row("c")];
    await syncStream(db, conn, stream);
    expect(await live()).toEqual(["a", "b", "c"]);

    // The base grows past the page cap. The read now returns an arbitrary
    // prefix and says so. Before the fix, b and c were tombstoned here — and a
    // "Records created in March" metric that read 3 read 1 the next morning.
    ROWS = [row("a")];
    TRUNCATED = true;
    const res = await syncStream(db, conn, stream);
    expect(res.softDeleted).toBe(0);
    expect(await live()).toEqual(["a", "b", "c"]);

    // And it does not erode over repeated sweeps, which is how the loss would
    // have been noticed far too late to explain.
    await syncStream(db, conn, stream);
    await syncStream(db, conn, stream);
    expect(await live()).toEqual(["a", "b", "c"]);
  });

  it("still reports the sweep as incomplete, so cadence and the UI know", async () => {
    const { conn, stream } = await setup();
    ROWS = [row("a")];
    TRUNCATED = true;
    const res = await syncStream(db, conn, stream);
    // The flag was being read by nobody on this path; a partial scan that
    // reports itself settled is how the truncation stayed invisible.
    expect(res.incomplete).toBe(true);
  });

  it("a row that vanishes from a COMPLETE read is still retired", async () => {
    // The guard must not turn the mirror into an append-only store: when the
    // read really is whole, absence really does mean gone.
    const { conn, stream } = await setup();
    ROWS = [row("a"), row("b")];
    await syncStream(db, conn, stream);
    expect(await live()).toEqual(["a", "b"]);

    ROWS = [row("a")];
    TRUNCATED = false;
    const res = await syncStream(db, conn, stream);
    expect(res.softDeleted).toBe(1);
    expect(await live()).toEqual(["a"]);
  });

  it("upserts what a truncated read DID return, rather than skipping the sweep", async () => {
    // Partial is not useless: the rows that arrived are still the freshest
    // truth about themselves.
    const { conn, stream } = await setup();
    ROWS = [row("a")];
    TRUNCATED = true;
    await syncStream(db, conn, stream);
    expect(await live()).toEqual(["a"]);
  });
});
