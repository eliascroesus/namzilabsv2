import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { upsertEvents } from "@/ingestion/pipeline";
import { events, streamFields } from "@/db/schema";
import type { CanonicalEvent } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * The single-writer contract (docs/DATA_MODEL.md). The old split-writer design
 * shipped a resurrection/downgrade bug: the re-sync writer unconditionally set
 * deletedAt=null and overwrote generation + occurred_at, so a late-delivered
 * older-generation page would resurrect tombstones and downgrade rows. These
 * tests pin the guarded semantics that replace it.
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;

const rec = (id: string, over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  eventId: `uni:conn:${id}`,
  eventType: "lead",
  subject: id,
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  properties: { id },
  ...over,
});

const meta = (over: Record<string, unknown> = {}) =>
  ({ orgId: "org_test", connectionId, source: "webhook", ...over }) as Parameters<typeof upsertEvents>[1];

async function row(id: string) {
  const [r] = await db.select().from(events).where(eq(events.eventId, `uni:conn:${id}`));
  return r;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db);
});
afterEach(async () => {
  await close();
});

describe("unified upsertEvents — guarded conflict semantics", () => {
  it("counts precisely: insert, then identical redelivery dedupes, then a real change updates", async () => {
    const first = await upsertEvents(db, meta({ generation: 1 }), [rec("a")]);
    expect(first).toEqual({ inserted: 1, updated: 0, deduped: 0, total: 1 });

    const again = await upsertEvents(db, meta({ generation: 1 }), [rec("a")]);
    expect(again).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });

    const changed = await upsertEvents(db, meta({ generation: 1 }), [rec("a", { properties: { id: "a", stage: "won" } })]);
    expect(changed).toEqual({ inserted: 0, updated: 1, deduped: 0, total: 1 });
    expect(((await row("a")).properties as Record<string, unknown>).stage).toBe("won");
  });

  it("a late OLDER-generation page cannot resurrect a tombstone, downgrade the generation, or overwrite data", async () => {
    await upsertEvents(db, meta({ generation: 3 }), [rec("a", { properties: { id: "a", v: "new" } })]);
    // The row was retired by a later full re-sync.
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.eventId, "uni:conn:a"));

    // A stale gen-2 page redelivers the record (network delays, retries).
    const stale = await upsertEvents(db, meta({ generation: 2 }), [rec("a", { properties: { id: "a", v: "stale" } })]);
    expect(stale).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });

    const r = await row("a");
    expect(r.deletedAt).not.toBeNull(); // tombstone survived
    expect(r.syncGeneration).toBe(3); // no downgrade
    expect((r.properties as Record<string, unknown>).v).toBe("new"); // no overwrite
  });

  it("a record re-seen at the CURRENT generation resurrects (it exists upstream again)", async () => {
    await upsertEvents(db, meta({ generation: 2 }), [rec("a")]);
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.eventId, "uni:conn:a"));

    const back = await upsertEvents(db, meta({ generation: 2 }), [rec("a")]);
    expect(back.updated).toBe(1);
    expect((await row("a")).deletedAt).toBeNull();
  });

  it("generation only ratchets up (GREATEST), and a pure gen bump counts as an update", async () => {
    await upsertEvents(db, meta({ generation: 1 }), [rec("a")]);
    const bump = await upsertEvents(db, meta({ generation: 5 }), [rec("a")]);
    expect(bump.updated).toBe(1);
    expect((await row("a")).syncGeneration).toBe(5);

    // Same content at a lower generation afterwards: untouched.
    const lower = await upsertEvents(db, meta({ generation: 4 }), [rec("a")]);
    expect(lower).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });
    expect((await row("a")).syncGeneration).toBe(5);
  });

  it("preserveOccurredAt pins the first-seen time; without it the source's time wins", async () => {
    const t1 = new Date("2026-03-01T10:00:00Z");
    const t2 = new Date("2026-03-02T10:00:00Z");
    await upsertEvents(db, meta({ generation: 1, preserveOccurredAt: true }), [rec("a", { occurredAt: t1 })]);

    // Mirror-style rewrite with a shifted synthetic time and changed content.
    const res = await upsertEvents(db, meta({ generation: 1, preserveOccurredAt: true }), [
      rec("a", { occurredAt: t2, properties: { id: "a", edited: true } }),
    ]);
    expect(res.updated).toBe(1);
    expect((await row("a")).occurredAt.toISOString()).toBe(t1.toISOString());

    // A source with real timestamps propagates a reschedule.
    await upsertEvents(db, meta({ generation: 1 }), [rec("b", { occurredAt: t1 })]);
    await upsertEvents(db, meta({ generation: 1 }), [rec("b", { occurredAt: t2 })]);
    expect((await row("b")).occurredAt.toISOString()).toBe(t2.toISOString());
  });

  it("webhook writes (generation 0) conflict-noop against poll-managed rows", async () => {
    await upsertEvents(db, meta({ generation: 4 }), [rec("a", { properties: { id: "a", v: "poll" } })]);
    const wh = await upsertEvents(db, meta(), [rec("a", { properties: { id: "a", v: "webhook" } })]);
    expect(wh).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });
    expect(((await row("a")).properties as Record<string, unknown>).v).toBe("poll");
  });

  it("chunks large batches (multi-row VALUES) and collapses duplicate ids within a batch", async () => {
    const batch: CanonicalEvent[] = [];
    for (let i = 0; i < 1203; i++) batch.push(rec(`bulk-${i}`));
    batch.push(rec("bulk-0")); // duplicate inside the batch: last write wins, no error
    const res = await upsertEvents(db, meta({ generation: 1 }), batch);
    expect(res.inserted).toBe(1203);
    expect(res.deduped).toBe(1);
    expect((await db.select().from(events)).length).toBe(1203);
  });
});

/**
 * FIELD RETIREMENT HAS TO RUN ON A SETTLED RESOURCE, and this is the pipeline
 * half of that.
 *
 * The registry refresh used to be gated on "something changed", which is right
 * for recording fields and wrong for retiring them: the retirement can only
 * happen on a sweep that re-read the whole resource, and a sheet whose columns
 * were renamed last week has nothing changing now. Measured live, that is
 * exactly the state the ghost columns were found in — twelve current headers
 * beside seven abandoned ones, on a sheet nobody had touched in days.
 */
describe("a whole-resource read refreshes the registry even when nothing changed", () => {
  const paths = async () =>
    (await db.select().from(streamFields).where(eq(streamFields.connectionId, connectionId))).map((r) => r.fieldPath).sort();

  it("retires a vanished column on a sweep that wrote no changes at all", async () => {
    const m = meta({ streamHash: "h1", wholeResource: true });
    await upsertEvents(db, m, [rec("r1", { properties: { new_question: "3" } })]);
    expect(await paths()).toEqual(["new_question"]);

    // THE STATE THE BUG WAS FOUND IN: an abandoned header already sitting in
    // the registry from before retirement existed, on a sheet nobody has
    // touched since. Written directly, because that is the only way to
    // reproduce a registry that predates the feature.
    await db.insert(streamFields).values({
      orgId: "org_test",
      connectionId,
      streamHash: "h1",
      fieldPath: "old_question",
      inferredType: "string",
      approxCardinality: 3,
      seenCount: 12,
      sample: { value: "3" },
    });
    expect(await paths()).toEqual(["new_question", "old_question"]);

    // A sweep that writes NOTHING — the steady state of a settled sheet.
    const quiet = await upsertEvents(db, m, [rec("r1", { properties: { new_question: "3" } })]);
    expect(quiet.inserted + quiet.updated).toBe(0);

    // REVERT THE `|| meta.wholeResource` GUARD AND THE GHOST SURVIVES FOREVER:
    // the only sweep that could retire it is one that changed something, and
    // nothing about this sheet is ever going to change again.
    expect(await paths()).toEqual(["new_question"]);
  });

  it("a settled sweep on a NON-whole-resource read still records nothing new and retires nothing", async () => {
    const m = meta({ streamHash: "h2" });
    await upsertEvents(db, m, [rec("r2", { properties: { a: "1", rare: "x" } })]);
    expect(await paths()).toEqual(["a", "rare"]);
    // An incremental page without the rare field must never retire it.
    await upsertEvents(db, m, [rec("r3", { properties: { a: "2" } })]);
    expect(await paths()).toEqual(["a", "rare"]);
  });
});
