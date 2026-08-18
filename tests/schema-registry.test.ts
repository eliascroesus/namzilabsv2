import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { streamFields } from "@/db/schema";
import { recordFields } from "@/lib/schema-registry/registry";
import type { CanonicalEvent } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * The field registry sits on the WRITE PATH of every connector — it runs
 * after every page of every poll. Two costs had crept in:
 *
 * 1. One awaited INSERT … ON CONFLICT per distinct field path: a 60-column
 *    sheet was 60 sequential round trips per page. Now one multi-row
 *    statement per 500 fields.
 * 2. `flatten` recursed without a depth bound, so a deeply-nested payload
 *    produced unbounded dotted paths (and, with #1, unbounded round trips).
 *    Now bounded at 4 — mirroring normalize-dates.ts's MAX_DEPTH, because a
 *    path deeper than the normalizer visits describes values the engine
 *    would read un-normalized.
 */

let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: "org_reg", source: "webhook" });
});
afterEach(async () => {
  await close();
  vi.restoreAllMocks();
});

const scope = () => ({ orgId: "org_reg", connectionId: connId, streamHash: "h-reg" });
const ev = (properties: Record<string, unknown>): CanonicalEvent => ({
  eventId: `e-${Math.abs(JSON.stringify(properties).split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 1e9}`,
  eventType: "row",
  occurredAt: new Date("2026-06-01T00:00:00Z"),
  properties,
});

async function stored(): Promise<Map<string, typeof streamFields.$inferSelect>> {
  const rows = await db.select().from(streamFields).where(eq(streamFields.connectionId, connId));
  return new Map(rows.map((r) => [r.fieldPath, r]));
}

describe("recordFields batches its writes", () => {
  it("60 distinct fields land in ONE insert statement, not 60", async () => {
    const props = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`col_${i}`, `v${i}`]));
    const insert = vi.spyOn(db, "insert");

    const n = await recordFields(db, scope(), [ev(props)]);

    expect(n).toBe(60);
    // THE regression: this was one round trip per field path.
    expect(insert).toHaveBeenCalledTimes(1);
    expect((await stored()).size).toBe(60);
  });

  it("chunks past 500 fields", async () => {
    const props = Object.fromEntries(Array.from({ length: 1_100 }, (_, i) => [`c${i}`, i]));
    const insert = vi.spyOn(db, "insert");

    await recordFields(db, scope(), [ev(props)]);

    expect(insert).toHaveBeenCalledTimes(3); // 500 + 500 + 100
    expect((await stored()).size).toBe(1_100);
  });

  it("aggregates across batches exactly as the per-field loop did", async () => {
    // Batch 1: an empty cell brands `status` null-typed, two distinct emails.
    await recordFields(db, scope(), [
      ev({ email: "a@x.com", status: null }),
      ev({ email: "b@x.com", status: null }),
    ]);
    // Batch 2: status gains a real type; one email recurs.
    await recordFields(db, scope(), [ev({ email: "a@x.com", status: "won" })]);

    const fields = await stored();
    const email = fields.get("email")!;
    expect(email.seenCount).toBe(3); // summed across batches
    expect(email.approxCardinality).toBe(2); // MAX across batches, not a sum
    const status = fields.get("status")!;
    expect(status.inferredType).toBe("string"); // null promoted by the later batch
    expect(status.lastSeen.getTime()).toBeGreaterThanOrEqual(email.firstSeen.getTime());
  });
});

describe("null-hash scopes upsert instead of accumulating (migration 0021)", () => {
  /**
   * `stream_hash` is NULL for connection-scoped sources, and a default unique
   * index treats NULLs as distinct — so ON CONFLICT never fired for those
   * scopes and EVERY batch inserted a fresh row per field path: unbounded
   * duplicate rows on the write path of every poll, an inflated field list,
   * and a dedupe warning computed off one fragment of the counts. Migration
   * 0021 collapses the duplicates and rebuilds the index NULLS NOT DISTINCT;
   * the test DB replays that migration, so this pins the real index.
   */
  it("two batches on a connection-scoped source fold into ONE row per field", async () => {
    const nullScope = { orgId: "org_reg", connectionId: connId, streamHash: null };
    await recordFields(db, nullScope, [ev({ email: "a@x.com" })]);
    await recordFields(db, nullScope, [ev({ email: "b@x.com" })]);

    const rows = await db.select().from(streamFields).where(eq(streamFields.connectionId, connId));
    // THE regression: before 0021 this was two rows, and one more per batch forever.
    expect(rows).toHaveLength(1);
    expect(rows[0].fieldPath).toBe("email");
    expect(rows[0].streamHash).toBeNull();
    expect(rows[0].seenCount).toBe(2); // folded, not fragmented
  });

  it("distinct non-null hashes still keep separate rows — NULLS NOT DISTINCT tightened nothing else", async () => {
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: "h-1" }, [ev({ email: "a@x.com" })]);
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: "h-2" }, [ev({ email: "a@x.com" })]);

    const rows = await db.select().from(streamFields).where(eq(streamFields.connectionId, connId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.streamHash))).toEqual(new Set(["h-1", "h-2"]));
  });
});

describe("flatten is depth-bounded", () => {
  it("stores no path deeper than 4 segments; the depth-4 value is an object leaf", async () => {
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: "buried" } } } } } };
    await recordFields(db, scope(), [ev(deep)]);

    const fields = await stored();
    const paths = [...fields.keys()];
    expect(paths).toEqual(["l1.l2.l3.l4"]);
    for (const p of paths) expect(p.split(".").length).toBeLessThanOrEqual(4);
    // At the bound the object ITSELF is the leaf, honestly typed.
    expect(fields.get("l1.l2.l3.l4")!.inferredType).toBe("object");
  });

  it("shallow payloads are untouched by the bound", async () => {
    await recordFields(db, scope(), [ev({ a: 1, b: { c: "x" }, d: { e: { f: true } } })]);
    const paths = [...(await stored()).keys()].sort();
    expect(paths).toEqual(["a", "b.c", "d.e.f"]);
  });
});

/**
 * The registry answers the picker on a step that has never been tested. A
 * provider ships every optional column whether the account fills it or not,
 * so it must not offer a path that has never once held a value.
 */
describe("the untested picker skips columns that have never held a value", () => {
  it("drops never-populated paths, but never the one already chosen", async () => {
    const { sampleAppFields } = await import("@/lib/flow/engine");
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: null }, [
      ev({ phone: "+1914", recording_url: null, address_id: null }),
      ev({ phone: "+1475", recording_url: null, address_id: null }),
    ]);

    const paths = async (dedupeField?: string) =>
      (await sampleAppFields({ db, orgId: "org_reg" }, { connectionId: connId, source: "webhook", ...(dedupeField ? { dedupe: true, dedupeField } : {}) })).map((f) => f.path);

    const offered = await paths();
    expect(offered).toContain("properties.phone");
    // Sabotage: keep approxCardinality-0 rows and the picker opens on columns
    // this account has never used — 87 of 491 on a real Close connection.
    expect(offered).not.toContain("properties.recording_url");

    // A step already configured on one of them must still see its own value,
    // or the picker looks broken the moment it opens.
    expect(await paths("properties.recording_url")).toContain("properties.recording_url");
  });
});

/**
 * "Has this field ever held a value" is the one question the picker asks the
 * registry. A blank cell is not a value — and the write path used to think it
 * was, so a column an account never fills scored one distinct value and was
 * offered forever.
 */
describe("a blank is not a value", () => {
  const paths = async (extra: Record<string, unknown> = {}) => {
    const { sampleAppFields } = await import("@/lib/flow/engine");
    return (await sampleAppFields({ db, orgId: "org_reg" }, { connectionId: connId, source: "webhook", ...extra })).map((f) => f.path);
  };

  it("a column blank on every record is not offered", async () => {
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: null }, [
      ev({ phone: "+1914", note: "" }),
      ev({ phone: "+1475", note: "   " }),
    ]);
    // Sabotage: go back to `value != null` on the distinct add and "" scores
    // one distinct value, so the column is offered forever.
    expect(await paths()).not.toContain("properties.note");
    expect(await paths()).toContain("properties.phone");
  });

  it("an empty object and an empty array are not values either", async () => {
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: null }, [ev({ phone: "+1914", meta: {}, tags: [] })]);
    // Sabotage: String(value) turns {} into "[object Object]" and [] into "",
    // both of which counted — the write path's other two blind spots.
    const p = await paths();
    expect(p).not.toContain("properties.meta");
    expect(p).not.toContain("properties.tags");
  });

  it("a row written before the fix is repaired on read", async () => {
    await db.insert(streamFields).values({
      orgId: "org_reg",
      connectionId: connId,
      streamHash: null,
      fieldPath: "legacy_blank",
      inferredType: "string",
      approxCardinality: 1,
      seenCount: 40,
      sample: { value: "" },
    });
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: null }, [ev({ phone: "+1914" })]);
    // Sabotage: drop the read-time repair and every row written before the
    // write-path fix keeps its phantom value forever — the upsert's
    // greatest() can only ever raise a cardinality, never lower one.
    expect(await paths()).not.toContain("properties.legacy_blank");
    // ...unless a step already points at it, in which case it always shows.
    expect(await paths({ dedupe: true, dedupeField: "properties.legacy_blank" })).toContain("properties.legacy_blank");
  });
});

/**
 * A RENAMED FORM QUESTION MUST NOT LEAVE A GHOST IN EVERY PICKER.
 *
 * The registry remembers every field it has ever seen, deliberately: a column
 * that stopped being FILLED is still a real column, and a sampled scan would
 * drop it. But a column that has been REMOVED is a different thing. Measured
 * live: after a Google Form's wording changed, the sheet's registry held 19
 * fields — the 12 that exist and 7 abandoned headers, identical to their
 * replacements but for a suffix — and the picker showed two of every question.
 *
 * The events themselves were already correct: a mirror re-reads its whole tab
 * and rewrites every row with the current headers, so the old key survived
 * nowhere in the data. It was offered anyway, and a metric built on it would
 * have found nothing.
 */
describe("a whole-resource read retires the columns it no longer sees", () => {
  const scoped = () => ({ orgId: "org_reg", connectionId: connId, streamHash: "h-sheet" });
  const paths = async () =>
    (await db.select().from(streamFields).where(eq(streamFields.streamHash, "h-sheet"))).map((r) => r.fieldPath).sort();

  it("drops a renamed column and keeps the one that replaced it", async () => {
    await recordFields(db, scoped(), [ev({ "How many did you call?": "3", Timestamp: "2026-08-12" })], { wholeResource: true });
    expect(await paths()).toEqual(["How many did you call?", "Timestamp"]);

    // The question is reworded; the mirror's next whole-tab read carries the
    // new header on EVERY row, old responses included.
    await recordFields(db, scoped(), [ev({ "How many did you call? [NUMBER ONLY]": "3", Timestamp: "2026-08-12" })], { wholeResource: true });

    // REVERT THE RETIREMENT AND THIS HOLDS BOTH, which is the reported bug.
    expect(await paths()).toEqual(["How many did you call? [NUMBER ONLY]", "Timestamp"]);
  });

  /**
   * THE SAFETY ARGUMENT, and the reason the flag exists. An incremental source
   * returns only what is NEW, so a field missing from one batch proves nothing:
   * Close's `lost_reason` appears solely on lost opportunities, and a quiet
   * afternoon would otherwise "prove" the column no longer exists and delete it
   * from every picker in the org.
   */
  it("never retires anything on a read that was not the whole resource", async () => {
    await recordFields(db, scoped(), [ev({ subject_line: "a", lost_reason: "budget" })], { wholeResource: true });
    expect(await paths()).toEqual(["lost_reason", "subject_line"]);

    // A later incremental page happens to contain no lost opportunity.
    await recordFields(db, scoped(), [ev({ subject_line: "b" })]);
    expect(await paths()).toEqual(["lost_reason", "subject_line"]);

    // And the default is the safe one — an omitted flag never retires.
    await recordFields(db, scoped(), [ev({ subject_line: "c" })], {});
    expect(await paths()).toEqual(["lost_reason", "subject_line"]);
  });

  it("keeps a column that still exists but is blank in every row", async () => {
    await recordFields(db, scoped(), [ev({ answered: "2", nobody_replied: "" })], { wholeResource: true });
    // The column is present in the header and empty in the data — a real
    // answer of zero, not a removed column.
    await recordFields(db, scoped(), [ev({ answered: "5", nobody_replied: "" })], { wholeResource: true });
    expect(await paths()).toEqual(["answered", "nobody_replied"]);
  });

  /**
   * AN EMPTY PATH SET MUST NOT MEAN "DELETE EVERYTHING". A NOT-IN over an empty
   * list is vacuously true, so a whole-resource read that produced records
   * carrying no fields at all — a tab whose header row is blank — would wipe
   * the stream's registry. REVERT THE `seen.size > 0` GUARD AND THIS EMPTIES.
   */
  it("keeps everything when a whole-resource read produced no fields at all", async () => {
    await recordFields(db, scoped(), [ev({ answered: "2" })], { wholeResource: true });
    expect(await paths()).toEqual(["answered"]);
    await recordFields(db, scoped(), [ev({})], { wholeResource: true });
    expect(await paths()).toEqual(["answered"]);
  });

  it("retires only within its own stream, never a neighbour's", async () => {
    await recordFields(db, scoped(), [ev({ only_here: "1" })], { wholeResource: true });
    await recordFields(db, { orgId: "org_reg", connectionId: connId, streamHash: "h-other" }, [ev({ other_sheet: "1" })], {
      wholeResource: true,
    });
    await recordFields(db, scoped(), [ev({ renamed: "1" })], { wholeResource: true });

    expect(await paths()).toEqual(["renamed"]);
    const other = await db.select().from(streamFields).where(eq(streamFields.streamHash, "h-other"));
    expect(other.map((r) => r.fieldPath)).toEqual(["other_sheet"]);
  });
});
