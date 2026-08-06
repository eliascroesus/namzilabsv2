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
