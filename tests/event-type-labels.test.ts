import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { CONNECTOR_CATALOG, eventTypeLabel } from "@/connectors/catalog";
import { distinctConnectionEventTypes } from "@/lib/metrics/compute";
import type { DB } from "@/db/types";

/**
 * Display names are PRESENTATION ONLY — the deferred "Close canonicalType
 * naming" decision landed as a label map precisely so no stored string ever
 * changes (a rename silently zeroes every flow filtering on the old name; a
 * label cannot break anything). These pin the map, the humanizer that covers
 * the unbounded raw fallthrough, and the invariant the null-source lookup
 * leans on.
 */
describe("eventTypeLabel", () => {
  it("names all 11 of Close's mapped types", () => {
    const expected: Record<string, string> = {
      sms_sent: "SMS sent",
      email_sent: "Email sent",
      call_logged: "Call logged",
      call_connected: "Call connected",
      call_completed: "Call completed",
      meeting_scheduled: "Meeting scheduled",
      meeting_logged: "Meeting logged",
      meeting_held: "Meeting held",
      lead_created: "Lead created",
      opportunity_created: "Opportunity created",
      task_completed: "Task completed",
    };
    for (const [type, label] of Object.entries(expected)) {
      expect(eventTypeLabel("close", type)).toBe(label);
    }
  });

  it("humanizes the raw objectType.action fallthrough instead of leaking it", () => {
    // The unmapped set is unbounded (close.ts stores every pair verbatim), so
    // the DISPLAY has to cover what the map never will.
    expect(eventTypeLabel("close", "activity.email_thread.updated")).toBe("Email thread updated");
    expect(eventTypeLabel("close", "custom_object.whatever")).toBe("Custom object whatever");
    expect(eventTypeLabel("calendly", "booked")).toBe("Booked");
    expect(eventTypeLabel(null, "row_added")).toBe("Row added");
  });

  it("null-source lookup is safe: no two sources declare the same key with different labels", () => {
    // The org-wide dropdowns (metrics/funnels) look a type up WITHOUT its
    // source and take the first declared match. That is only honest while
    // this invariant holds — break it and one source's label silently
    // describes another source's data.
    const seen = new Map<string, { source: string; label: string }>();
    for (const entry of CONNECTOR_CATALOG) {
      for (const [key, label] of Object.entries(entry.eventTypeLabels ?? {})) {
        const prior = seen.get(key);
        if (prior) expect(`${key}: ${prior.label} (${prior.source})`).toBe(`${key}: ${label} (${entry.source})`);
        seen.set(key, { source: entry.source, label });
      }
    }
  });
});

describe("distinctConnectionEventTypes", () => {
  let db: DB;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  const seed = async (connectionId: string, orgId: string, eventType: string, deleted = false) => {
    await db.insert(events).values({
      eventId: `t:${randomUUID()}`,
      orgId,
      connectionId,
      source: "close",
      eventType,
      occurredAt: new Date(),
      properties: {},
      deletedAt: deleted ? new Date() : null,
    });
  };

  it("lists ONE connection's live types, sorted — org-walled, tombstones excluded", async () => {
    const mine = await seedConnection(db, { orgId: "org_a", source: "close" });
    const other = await seedConnection(db, { orgId: "org_a", source: "close" });
    const foreign = await seedConnection(db, { orgId: "org_b", source: "close" });
    await seed(mine, "org_a", "sms_sent");
    await seed(mine, "org_a", "email_sent");
    await seed(mine, "org_a", "email_sent"); // duplicate type → one option
    await seed(mine, "org_a", "lead_created", true); // tombstone → invisible
    await seed(other, "org_a", "call_logged"); // other connection → invisible
    await seed(foreign, "org_b", "meeting_held"); // other org → invisible

    expect(await distinctConnectionEventTypes(db, "org_a", mine)).toEqual(["email_sent", "sms_sent"]);
    // The wall from the other side: the foreign org asking about MY
    // connection id gets nothing, not my types.
    expect(await distinctConnectionEventTypes(db, "org_b", mine)).toEqual([]);
  });
});
