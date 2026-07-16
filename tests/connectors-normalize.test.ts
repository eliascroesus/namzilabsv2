import { describe, it, expect } from "vitest";
import { calendlyConnector } from "@/connectors/calendly";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";

const ctx = { connectionId: "c1" };

describe("Calendly normalize", () => {
  it("maps invitee.created -> booked with scheduled-event id", () => {
    const [ev] = calendlyConnector.normalize(
      {
        event: "invitee.created",
        created_at: "2026-01-01T10:00:00Z",
        payload: {
          email: "lead@acme.com",
          uri: "https://api.calendly.com/invitees/INV1",
          scheduled_event: { uri: "https://api.calendly.com/scheduled_events/EVT1", start_time: "2026-01-05T15:00:00Z" },
        },
      },
      ctx,
    );
    expect(ev.eventType).toBe("booked");
    expect(ev.eventId).toBe("calendly:c1:https://api.calendly.com/scheduled_events/EVT1");
    expect(ev.subject).toBe("lead@acme.com");
    expect(ev.occurredAt.toISOString()).toBe("2026-01-05T15:00:00.000Z");
  });
  it("maps invitee.canceled -> canceled", () => {
    const [ev] = calendlyConnector.normalize({ event: "invitee.canceled", payload: { uri: "x" } }, ctx);
    expect(ev.eventType).toBe("canceled");
  });
});

describe("Close normalize", () => {
  it("maps activity.sms/created -> sms_sent", () => {
    const [ev] = closeConnector.normalize(
      { event: { id: "ev1", object_type: "activity.sms", action: "created", date_created: "2026-01-02T00:00:00Z", data: { to: "+15551234567" } } },
      ctx,
    );
    expect(ev.eventType).toBe("sms_sent");
    expect(ev.eventId).toBe("close:c1:ev1");
    expect(ev.subject).toBe("+15551234567");
  });
  it("passes through unmapped object.action", () => {
    const [ev] = closeConnector.normalize({ event: { id: "e2", object_type: "note", action: "created" } }, ctx);
    expect(ev.eventType).toBe("note.created");
  });
});

describe("Instantly normalize", () => {
  it("maps reply_received -> reply keyed by email_id", () => {
    const [ev] = instantlyConnector.normalize(
      { event_type: "reply_received", email_id: "em1", lead_email: "p@acme.com", timestamp: "2026-01-03T00:00:00Z" },
      ctx,
    );
    expect(ev.eventType).toBe("reply");
    expect(ev.eventId).toBe("instantly:c1:reply_received:em1");
    expect(ev.subject).toBe("p@acme.com");
  });
});

describe("Sendblue normalize", () => {
  it("maps outbound DELIVERED -> sms_delivered", () => {
    const [ev] = sendblueConnector.normalize(
      { status: "DELIVERED", message_handle: "h1", to_number: "+15550001111", date_sent: "2026-01-04T00:00:00Z" },
      ctx,
    );
    expect(ev.eventType).toBe("sms_delivered");
    expect(ev.eventId).toBe("sendblue:c1:sms_delivered:h1");
    expect(ev.subject).toBe("+15550001111");
  });
  it("maps inbound (no status) -> sms_received", () => {
    const [ev] = sendblueConnector.normalize(
      { message_handle: "h2", from_number: "+15559998888", date_received: "2026-01-04T00:00:00Z" },
      ctx,
    );
    expect(ev.eventType).toBe("sms_received");
  });
});
