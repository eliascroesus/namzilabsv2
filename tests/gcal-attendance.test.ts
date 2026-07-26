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
 * The binding constraint on those counts is that they must equal the line Google
 * itself prints on the event ("4 guests · 2 yes, 2 awaiting"). Every case below
 * is written as that comparison, because the first implementation lost it: it
 * discounted the organizer and the calendar owner as "not guests", and on a real
 * meeting where those two were the only acceptances it reported zero.
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
  /**
   * The regression that started this. A real event, synced onto a personal
   * calendar, organized by someone else:
   *
   *   Google Calendar says:  4 guests · 2 yes, 2 awaiting
   *     tristan@namzigrowing.com   Organizer   accepted
   *     eliascroesus@gmail.com     (me)        accepted
   *     afeefuddin2007@gmail.com               awaiting
   *     marielle@devigal.com                   awaiting
   *
   * The first implementation excluded `organizer` and `self` from the counts, so
   * the only two people who had accepted were both discarded and it reported
   * `guests_accepted: 0` for a meeting the user could see two green ticks on.
   */
  it("reports exactly what Google's own guest line says", async () => {
    const p = await propsFor(
      evt(
        [
          { email: "tristan@namzigrowing.com", organizer: true, responseStatus: "accepted" },
          { email: "eliascroesus@gmail.com", self: true, responseStatus: "accepted" },
          { email: "afeefuddin2007@gmail.com", responseStatus: "needsAction" },
          { email: "marielle@devigal.com", responseStatus: "needsAction" },
        ],
        "tristan@namzigrowing.com",
      ),
    );

    expect(p.guests_total).toBe(4); // "4 guests"
    expect(p.guests_accepted).toBe(2); // "2 yes"
    expect(p.guests_pending).toBe(2); // "2 awaiting"
    expect(p.guests_declined).toBe(0);
    expect(p.guests_tentative).toBe(0);
  });

  it("counts the organizer's own acceptance like anyone else's", async () => {
    // The user's filter recipe depends on this: a 1:1 where only the closer has
    // auto-accepted reads 1, and rises to 2 the moment the lead accepts — so
    // `guests_accepted > 1` means "someone other than the host said yes".
    const closerOnly = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "needsAction" },
      ]),
    );
    expect(closerOnly.guests_accepted).toBe(1);

    const bothAccepted = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "accepted" },
      ]),
    );
    expect(bothAccepted.guests_accepted).toBe(2);
  });

  it("separates every RSVP state", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "a@prospect.io", responseStatus: "accepted" },
        { email: "b@prospect.io", responseStatus: "declined" },
        { email: "c@prospect.io", responseStatus: "tentative" },
        { email: "d@prospect.io", responseStatus: "needsAction" },
        { email: "e@prospect.io" }, // Google omits the key entirely when untouched
      ]),
    );
    expect(p.guests_total).toBe(6);
    expect(p.guests_accepted).toBe(2);
    expect(p.guests_declined).toBe(1);
    expect(p.guests_tentative).toBe(1);
    expect(p.guests_pending).toBe(2); // needsAction + the missing key
  });

  it("separates the prospect from the colleague you added to the call", async () => {
    // The assumption-free version of "did the lead show intent": it needs no
    // premise about the host auto-accepting.
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "teammate@acme.com", responseStatus: "accepted" }, // same company
        { email: "lead@prospect.io", responseStatus: "accepted" }, // the actual prospect
      ]),
    );

    expect(p.guests_total).toBe(3);
    expect(p.guests_accepted).toBe(3);
    // THE number for a sales team: only the outside party counts.
    expect(p.guests_external).toBe(1);
    expect(p.guests_external_accepted).toBe(1);
    expect(p.is_external_meeting).toBe(true);
    expect(p.organizer_domain).toBe("acme.com");
    expect(p.organizer_email).toBe("closer@acme.com");
  });

  it("does not credit the prospect when only the closer's side accepted", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "teammate@acme.com", responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "needsAction" },
      ]),
    );
    expect(p.guests_accepted).toBe(2); // faithful to Google
    expect(p.guests_external).toBe(1);
    expect(p.guests_external_accepted).toBe(0); // but the lead has not replied
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
    expect(p.guests_accepted).toBe(2);
  });

  it("never counts a meeting room as a person who accepted", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "room-4@resource.calendar.google.com", resource: true, responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "needsAction" },
      ]),
    );
    // The room is an attendee to Google's API, but not a person who said yes.
    expect(p.guests_total).toBe(2);
    expect(p.guests_accepted).toBe(1);
  });

  it("reports no acceptance rate rather than zero when nobody was invited", async () => {
    // A solo focus block must not drag an average acceptance rate toward zero.
    const p = await propsFor({ id: "e2", summary: "Focus", start: { dateTime: "2026-07-26T16:00:00Z" } });
    expect(p.guests_total).toBe(0);
    expect(p.guest_acceptance_rate).toBeNull();
    expect(p.is_external_meeting).toBe(false);
  });

  it("gives a usable rate when guests exist", async () => {
    const p = await propsFor(
      evt([
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "a@prospect.io", responseStatus: "accepted" },
        { email: "b@prospect.io", responseStatus: "declined" },
        { email: "c@prospect.io", responseStatus: "needsAction" },
      ]),
    );
    expect(p.guest_acceptance_rate).toBeCloseTo(0.5, 5); // 2 of 4
  });

  it("falls back to the attendee flagged organizer when the event has no organizer block", async () => {
    const p = await propsFor({
      id: "e3",
      summary: "Sales call",
      start: { dateTime: "2026-07-26T16:00:00Z" },
      attendees: [
        { email: "closer@acme.com", organizer: true, responseStatus: "accepted" },
        { email: "lead@prospect.io", responseStatus: "accepted" },
      ],
    });
    expect(p.organizer_domain).toBe("acme.com");
    expect(p.guests_external_accepted).toBe(1);
  });

  it("treats nobody as external when the organizer cannot be identified", async () => {
    // Never guess: with no organizer domain there is no inside to be outside of.
    const p = await propsFor({
      id: "e4",
      summary: "Imported",
      start: { dateTime: "2026-07-26T16:00:00Z" },
      attendees: [{ email: "a@prospect.io", responseStatus: "accepted" }],
    });
    expect(p.guests_accepted).toBe(1);
    expect(p.guests_external).toBe(0);
    expect(p.is_external_meeting).toBe(false);
    expect(p.organizer_email).toBeNull();
  });

  it("leaves the raw attendee list intact alongside the counts", async () => {
    const p = await propsFor(evt([{ email: "lead@prospect.io", responseStatus: "accepted" }]));
    expect(Array.isArray(p.attendees)).toBe(true);
    expect((p.attendees as unknown[]).length).toBe(1);
  });
});
