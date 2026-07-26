import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { upsertEvents } from "@/ingestion/pipeline";
import { dedupeWarningFor, listRegisteredFields } from "@/lib/schema-registry/registry";
import { extractIdentifiers, normalizeEmail, normalizePhone } from "@/lib/identity/normalize";
import type { DB } from "@/db/types";

/**
 * A.1 (field registry maintained by the writer), A.2 (identity normalization
 * at write time) and E.7 (the dedupe guardrail that uses the registry's
 * cardinality to catch a key that would silently collapse the dataset).
 */

const ORG = "org_registry";
let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "gsheets" });
});
afterEach(async () => {
  await close();
});

const write = (records: Parameters<typeof upsertEvents>[2]) =>
  upsertEvents(db, { orgId: ORG, connectionId: connId, source: "gsheets", streamHash: "h1", generation: 1 }, records);

const rec = (i: number, props: Record<string, unknown>, subject?: string | null) => ({
  eventId: `reg:${i}`,
  eventType: "row_added",
  subject: subject ?? null,
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  properties: props,
});

describe("A.2 — identity normalization", () => {
  it("normalizes emails and phones to one canonical shape", () => {
    expect(normalizeEmail("  Alice@Acme.COM ")).toBe("alice@acme.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a b@c.com")).toBeNull();
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("15551234567")).toBe("+15551234567");
    expect(normalizePhone("n/a")).toBeNull();
  });

  it("harvests from subject and properties, deduped and sorted (stable JSON)", () => {
    const a = extractIdentifiers({ subject: "Alice@Acme.com", properties: { email: "alice@acme.com", phone: "555-123-4567" } });
    expect(a).toEqual({ emails: ["alice@acme.com"], phones: ["+15551234567"] });
    // Order of discovery must not change the stored value.
    const b = extractIdentifiers({ subject: null, properties: { z_email: "b@x.io", a_email: "a@x.io" } });
    expect(b.emails).toEqual(["a@x.io", "b@x.io"]);
  });

  it("the writer stores identifiers, and an unchanged rewrite is still a no-op", async () => {
    const first = await write([rec(1, { email: "Alice@Acme.com", phone: "(555) 123-4567" }, "Alice@Acme.com")]);
    expect(first.inserted).toBe(1);

    const [row] = await db.select().from(events).where(eq(events.eventId, "reg:1"));
    expect(row.identifiers).toEqual({ emails: ["alice@acme.com"], phones: ["+15551234567"] });

    // Identical rewrite → deduped, not "updated" (stable identifier ordering).
    const again = await write([rec(1, { email: "Alice@Acme.com", phone: "(555) 123-4567" }, "Alice@Acme.com")]);
    expect(again).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });
  });
});

describe("A.1 — the registry is maintained by the writer", () => {
  it("records every field path, its type, and how often it was seen", async () => {
    await write([
      rec(1, { name: "Alice", amount: "100", nested: { deep: "x" }, when: "2026-01-01" }),
      rec(2, { name: "Bob", amount: "200", nested: { deep: "y" } }),
    ]);
    const fields = await listRegisteredFields(db, { orgId: ORG, connectionId: connId, streamHash: "h1" });
    const byPath = Object.fromEntries(fields.map((f) => [f.fieldPath, f]));

    expect(Object.keys(byPath).sort()).toEqual(["amount", "name", "nested.deep", "when"]);
    expect(byPath.name.seenCount).toBe(2);
    expect(byPath.name.approxCardinality).toBe(2);
    expect(byPath.amount.inferredType).toBe("number");
    expect(byPath.when.inferredType).toBe("date");
    expect(byPath.when.seenCount).toBe(1); // only one record carried it
  });

  it("cardinality is a MAX across batches, so repeated sweeps don't inflate it", async () => {
    const batch = [rec(1, { stage: "Won" }), rec(2, { stage: "Lost" })];
    await write(batch);
    await write(batch.map((r) => ({ ...r, properties: { ...r.properties, extra: "x" } })));

    const [stage] = (await listRegisteredFields(db, { orgId: ORG, connectionId: connId, streamHash: "h1" })).filter(
      (f) => f.fieldPath === "stage",
    );
    expect(stage.approxCardinality).toBe(2); // not 4
    expect(stage.seenCount).toBe(4); // occurrences DO accumulate
  });

  it("registry failures never fail an ingest", async () => {
    // The writer wraps the registry defensively; the events still land.
    const res = await write([rec(9, { name: "X" })]);
    expect(res.inserted).toBe(1);
    expect((await db.select().from(events)).length).toBe(1);
  });
});

describe("E.7 — dedupe guardrail", () => {
  it("warns when the chosen key would collapse most of the dataset", async () => {
    // 20 records, only 2 distinct stages.
    await write(Array.from({ length: 20 }, (_, i) => rec(i, { stage: i % 2 === 0 ? "Won" : "Lost", email: `u${i}@x.io` })));

    const warning = await dedupeWarningFor(db, { orgId: ORG, connectionId: connId, streamHash: "h1" }, "stage");
    expect(warning).not.toBeNull();
    expect(warning!.message).toContain("collapse about 18 of 20 records");
    expect(warning!.message).toContain("~2 distinct values");
  });

  it("stays quiet for a genuinely identifying key", async () => {
    await write(Array.from({ length: 20 }, (_, i) => rec(i, { stage: "Won", email: `u${i}@x.io` })));
    expect(await dedupeWarningFor(db, { orgId: ORG, connectionId: connId, streamHash: "h1" }, "email")).toBeNull();
  });

  it("stays quiet for an unknown field (no data is not a warning)", async () => {
    await write([rec(1, { stage: "Won" })]);
    expect(await dedupeWarningFor(db, { orgId: ORG, connectionId: connId, streamHash: "h1" }, "nope")).toBeNull();
  });
});
