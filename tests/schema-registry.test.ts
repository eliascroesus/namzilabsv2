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
