import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { CONNECTOR_CATALOG, eventTypeLabel, eventTypeOptions } from "@/connectors/catalog";
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
  it("names Close's mapped types — with truth in the logged-vs-sent labels", () => {
    const expected: Record<string, string> = {
      // Close's `created` action fires for inbound + drafts too; the plain
      // "sent" names belong to the `.sent` raw pairs (the true sends).
      sms_sent: "SMS logged (sent or received)",
      email_sent: "Email logged (sent or received)",
      "activity.sms.sent": "SMS sent",
      "activity.email.sent": "Email sent",
      call_logged: "Call logged",
      call_connected: "Call connected",
      call_completed: "Call completed",
      meeting_scheduled: "Meeting scheduled",
      meeting_logged: "Meeting logged",
      meeting_held: "Meeting held",
      lead_created: "Lead created",
      "activity.created.created": "Lead created (timeline)",
      opportunity_created: "Opportunity created",
      // Dead key (Close emits task.SUBTYPE.*); the real signal wears the name.
      task_completed: "Task completed (legacy)",
      "activity.task_completed.created": "Task completed",
      "activity.lead_status_change.created": "Lead status changed",
      "activity.opportunity_status_change.created": "Opportunity status changed",
      "task.missed_call.created": "Missed-call task created",
      "activity.form_submission.created": "Form submitted",
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

  it("strips 'activity' ONLY as the leading segment — custom_fields.activity.* keeps its meaning", () => {
    // Sabotage: restore the any-position filter and "activity" vanishes from
    // the middle, mislabeling this as plain "Custom fields created".
    expect(eventTypeLabel("close", "custom_fields.activity.created")).toBe("Custom fields activity created");
  });

  it("cases acronyms at any word position", () => {
    expect(eventTypeLabel("close", "activity.sms.updated")).toBe("SMS updated");
    expect(eventTypeLabel("close", "activity.whatsapp_message.created")).toBe("WhatsApp message created");
  });

  it("null-source lookup never guesses: agreement wins, disagreement falls back to the humanizer", () => {
    // Two sources CAN share a stored key with different meanings — Close's
    // email_sent counts inbound + drafts, Instantly's is a true send. Each
    // declares its own truth per-source; an org-wide dropdown that can't
    // know the source must not pick a side.
    expect(eventTypeLabel("close", "email_sent")).toBe("Email logged (sent or received)");
    expect(eventTypeLabel("instantly", "email_sent")).toBe("Email sent");
    // Unbound: declarations disagree → neutral humanized form, no source's
    // semantics claimed. (Humanize("email_sent") happens to read "Email
    // sent"; the pin is that it is the HUMANIZER's output, not a pick —
    // sabotage: make the unbound lookup take the first declared match and
    // this returns Close's parenthesized label.)
    expect(eventTypeLabel(null, "email_sent")).toBe("Email sent");
    // Agreement across all declarers → the shared label is safe to use.
    const declarers = CONNECTOR_CATALOG.filter((c) => c.eventTypeLabels?.["call_logged"]);
    expect(declarers).toHaveLength(1);
    expect(eventTypeLabel(null, "call_logged")).toBe("Call logged");
  });

  it("null-source hiding works: org-wide pickers drop every source's declared noise", () => {
    // Sabotage: restore `catalogEntry(source ?? "")` (no null fallback) and
    // the funnels/metrics pickers offer every .deleted cascade again.
    expect(eventTypeOptions(null, ["activity.note.updated", "activity.email.deleted", "call_logged"], null).map((o) => o.value)).toEqual([
      "call_logged",
    ]);
  });

  /**
   * Different keys must never share a label — INCLUDING what the humanizer
   * produces for raw pairs. The declared-map-only check missed both real
   * collisions a customer hit: raw activity.email.sent humanized to exactly
   * "Email sent" beside the mapped email_sent, and "Sms sent" case-collided
   * "SMS sent". The fixture is Close's real storable vocabulary: canonical
   * names plus the raw pairs that fall through unmapped.
   */
  it("no two distinct Close keys produce the same label, case-insensitively (humanizer included)", () => {
    const storable = [
      // canonical (mapped) names
      "sms_sent", "email_sent", "call_logged", "call_connected", "call_completed",
      "meeting_scheduled", "meeting_logged", "meeting_held", "lead_created",
      "opportunity_created", "task_completed",
      // raw fallthrough pairs seen in the census / documented by Close
      "activity.email.sent", "activity.email.updated", "activity.email.deleted",
      "activity.sms.sent", "activity.sms.updated", "activity.sms.deleted",
      "activity.call.updated", "activity.call.deleted",
      "activity.meeting.started", "activity.meeting.canceled", "activity.meeting.updated", "activity.meeting.deleted",
      "activity.created.created", "activity.created.deleted",
      "activity.note.created", "activity.note.updated", "activity.note.deleted",
      "activity.email_thread.created", "activity.email_thread.updated", "activity.email_thread.deleted",
      "activity.task_completed.created", "activity.task_completed.deleted",
      "activity.lead_status_change.created", "activity.opportunity_status_change.created",
      "activity.lead_merge.created", "activity.form_submission.created",
      "activity.whatsapp_message.created", "activity.custom_activity.created",
      "task.lead.created", "task.lead.completed", "task.lead.updated",
      "task.missed_call.created", "task.outbound_call.created",
      "lead.updated", "lead.merged", "lead.deleted",
      "opportunity.updated", "opportunity.deleted",
      "contact.created", "contact.updated", "contact.deleted",
      "custom_fields.activity.created", "custom_fields.lead.created", "custom_fields.shared.updated",
      "custom_object.created", "sequence_subscription.created", "unsubscribed_email.created",
      "status.lead.created", "status.opportunity.updated", "import.completed", "export.lead.completed",
      "membership.activated", "saved_search.created", "phone_number.updated", "comment_thread.updated",
    ];
    const byLabel = new Map<string, string>();
    for (const key of storable) {
      const label = eventTypeLabel("close", key).toLowerCase();
      const prior = byLabel.get(label);
      if (prior) expect(`"${label}" from ${prior}`).toBe(`"${label}" from ${key}`);
      byLabel.set(label, key);
    }
  });
});

describe("eventTypeOptions", () => {
  const TYPES = [
    "email_sent",
    "activity.email.sent",
    "activity.email.deleted", // hidden: .deleted suffix
    "activity.note.updated", // hidden: keystroke noise
    "custom_fields.lead.created", // hidden: admin plane
    "call_logged",
  ];

  it("drops hidden types, keeps the rest, sorted by LABEL not stored string", () => {
    const opts = eventTypeOptions("close", TYPES, null);
    expect(opts.map((o) => o.value)).toEqual([
      "call_logged", // "Call logged"
      "email_sent", // "Email logged (sent or received)"
      "activity.email.sent", // "Email sent" — label-sorted AFTER "Email logged…"
    ]);
  });

  it("a hidden type that is the CURRENT value stays selectable", () => {
    // Deselecting a saved filter because its type was later hidden would
    // silently widen the user's data. Sabotage: drop the current-retention
    // and this fails.
    const opts = eventTypeOptions("close", TYPES, "activity.note.updated");
    expect(opts.some((o) => o.value === "activity.note.updated")).toBe(true);
  });

  it("a current value absent from the fresh list is retained", () => {
    const opts = eventTypeOptions("close", ["email_sent"], "meeting_held");
    expect(opts.some((o) => o.value === "meeting_held")).toBe(true);
  });

  it("carries the raw string as hint only when the label differs", () => {
    const opts = eventTypeOptions("close", ["activity.email.sent"], null);
    expect(opts[0].hint).toBe("activity.email.sent");
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
