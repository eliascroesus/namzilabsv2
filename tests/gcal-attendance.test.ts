import { describe, it, expect, vi, afterEach } from "vitest";
import { googleCalendarConnector } from "@/connectors/google-calendar";

/**
 * "How many invited people accepted?" — the question a calendar is actually
 * bought for, and the one the raw payload cannot answer.
 *
 * `attendees` is a list of objects, so the flow builder can only offer it
 * POSITIONALLY: Item 1, Item 2. That is useless here. Every sales call has
 * different people, Google guarantees no ordering, and the organizer is not
 * reliably first — so "Item 1's response status" measures a different person on
 * every row. Chasing a smarter picker is the wrong fix; the question is about
 * COUNTS, so the connector computes counts.
 *
 * These cases pin the definitions that make the sales case work by default:
 * the closer's own acceptance never inflates the number, rooms are not people,
 * and "external" means a different domain from the organizer.
 */

const evt = (attendees: Array<Record<string, unknown>>, organizerEmail = "closer@acme.com") => ({
  id: "e1",
  summary: "Sales call",
  start: { dateTime: "2026-07-26T16:00:00Z" },
  organizer: { email: organizerEmail },
  attendees,
});

async function propsFor(ev: Record<string, unknown>): Promise<Record<string, unknown>> {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => ({ items: [ev], nextSyncToken: "tok" }),
    text: async () => "",
  } as unknown as Response)));
  const { records } = await googleCalendarConnector.poll!({
    connectionId: "c1",
    cursor: null,
    credentials: { accessToken: "t" },
    config: { calendarId: "primary" },
  });
  return records[0].properties as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendar attendance is countable, not positional", () => {
  it("counts guests by response, ignoring the organizer's own acceptance", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "accepted" },
        { email: "other@prospect.io", responseStatus: "declined" },
        { email: "third@prospect.io", responseStatus: "needsAction" },
      ]),
    );

    // 3 guests — the organizer is not a guest, however he replied.
    expect(p.guests_total).toBe(3);
    expect(p.guests_accepted).toBe(1);
    expect(p.guests_declined).toBe(1);
    expect(p.guests_pending).toBe(1);
    expect(p.any_guest_accepted).toBe(true);
  });

  it("separates the prospect from the colleague you added to the call", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "teammate@acme.com", responseStatus: "accepted" }, // same company
        { email: "lead@prospect.io", responseStatus: "accepted" }, // the actual prospect
      ]),
    );

    expect(p.guests_total).toBe(2); // teammate + lead
    expect(p.guests_accepted).toBe(2);
    // THE number for a sales team: only the outside party counts.
    expect(p.guests_external).toBe(1);
    expect(p.guests_external_accepted).toBe(1);
    expect(p.is_external_meeting).toBe(true);
    expect(p.organizer_domain).toBe("acme.com");
  });

  it("marks an internal-only meeting so it can be filtered out entirely", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "teammate@acme.com", responseStatus: "accepted" },
      ]),
    );
    expect(p.is_external_meeting).toBe(false);
    expect(p.guests_external).toBe(0);
    // Still countable as an internal meeting — the data isn't lost, just labelled.
    expect(p.guests_accepted).toBe(1);
  });

  it("never counts a meeting room as a person who accepted", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "room-4@resource.calendar.google.com", resource: true, responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "needsAction" },
      ]),
    );
    expect(p.attendee_count).toBe(2); // organizer + lead; the room is not a person
    expect(p.guests_total).toBe(1);
    expect(p.guests_accepted).toBe(0);
  });

  it("excludes the calendar owner even when they are not the organizer", async () => {
    // Someone else's meeting that landed on my calendar: my own RSVP is not a
    // signal about whether the invitees showed intent.
    const p = await propsFor(
      evt(
        [
          { email: "host@partner.com", organizer: true, responseStatus: "accepted" },
          { email: "me@acme.com", self: true, responseStatus: "accepted" },
          { email: "lead@prospect.io", responseStatus: "declined" },
        ],
        "host@partner.com",
      ),
    );
    expect(p.guests_total).toBe(1); // only the lead
    expect(p.guests_accepted).toBe(0);
    expect(p.guests_declined).toBe(1);
  });

  it("reports no acceptance rate rather than zero when there were no guests", async () => {
    // A solo focus block must not drag an average acceptance rate toward zero.
    const p = await propsFor(evt([{ email: "closer@acme.com", organizer: true, responseStatus: "accepted" }]));
    expect(p.guests_total).toBe(0);
    expect(p.guest_acceptance_rate).toBeNull();
    expect(p.any_guest_accepted).toBe(false);
  });

  it("gives a usable rate when guests exist", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "a@prospect.io", responseStatus: "accepted" },
        { email: "b@prospect.io", responseStatus: "accepted" },
        { email: "c@prospect.io", responseStatus: "declined" },
        { email: "d@prospect.io", responseStatus: "needsAction" },
      ]),
    );
    expect(p.guest_acceptance_rate).toBeCloseTo(0.5, 5); // 2 of 4
  });

  it("leaves the raw attendee list intact alongside the counts", async () => {
    const p = await propsFor(evt([{ email: "lead@prospect.io", responseStatus: "accepted" }]));
    expect(Array.isArray(p.attendees)).toBe(true);
    expect((p.attendees as unknown[]).length).toBe(1);
  });

  it("handles an event with no attendees at all", async () => {
    const p = await propsFor({ id: "e2", summary: "Focus", start: { dateTime: "2026-07-26T16:00:00Z" } });
    expect(p.guests_total).toBe(0);
    expect(p.attendee_count).toBe(0);
    expect(p.is_external_meeting).toBe(false);
  });
});
