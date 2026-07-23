import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { mirrorStream } from "@/lib/sync/streams";
import { encrypt } from "@/lib/crypto";
import { connections, events, sourceStreams } from "@/db/schema";
import { streamConfigHash, normalizeStreamConfig } from "@/lib/sync/stream-hash";
import type { DB } from "@/db/types";

/**
 * Calendly as a MIRROR source: bookings are mutable state (reschedules edit the
 * meeting in place at the same URI), scanned over a rolling ±400-day window.
 * The mirror invariant applies WITHIN the window; `inMirrorScope` protects
 * everything a bounded rescan could not have seen — meetings outside the
 * window, or rows whose start_time can't even be parsed — from soft-delete.
 */

const KEY = randomBytes(32).toString("base64");
const CONFIG = { scope: "user" };
const HASH = streamConfigHash(CONFIG);

// The live Calendly account: mutate between passes.
let MEETINGS: Array<Record<string, unknown>> = [];

const meeting = (n: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  uri: `https://api.calendly.com/scheduled_events/${n}`,
  name: `Call ${n}`,
  status: "active",
  start_time: "2026-08-01T10:00:00Z",
  created_at: "2026-07-01T08:00:00Z",
  updated_at: "2026-07-01T08:00:00Z",
  ...over,
});

let db: DB;
let close: () => Promise<void>;
let connectionId: string;
let conn: typeof connections.$inferSelect;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  MEETINGS = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const json = (data: unknown) =>
        ({ ok: true, status: 200, statusText: "OK", json: async () => data, text: async () => "" }) as unknown as Response;
      if (url.includes("/users/me")) return json({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
      if (url.includes("/scheduled_events")) return json({ collection: MEETINGS, pagination: { next_page_token: null } });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );

  connectionId = await seedConnection(db, { source: "calendly" });
  await db
    .update(connections)
    .set({ credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")) })
    .where(eq(connections.id, connectionId));
  await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: HASH, config: normalizeStreamConfig(CONFIG) });
  [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

const stream = async () => (await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, HASH)))[0];
const pass = async () => mirrorStream(db, conn, await stream());
const storedByUri = async (n: string) =>
  (await db.select().from(events).where(eq(events.eventId, `calendly:${connectionId}:${HASH}:https://api.calendly.com/scheduled_events/${n}`)))[0];

describe("Calendly mirror passes", () => {
  it("a RESCHEDULE (same URI, new start_time) refreshes the stored booking in place", async () => {
    MEETINGS = [meeting("M1", { start_time: "2026-08-01T10:00:00Z" })];
    await pass();
    let m1 = await storedByUri("M1");
    expect((m1.properties as Record<string, unknown>).start_time).toBe("2026-08-01T10:00:00.000Z");

    // The invitee moves the call — Calendly edits the SAME scheduled_event.
    MEETINGS = [meeting("M1", { start_time: "2026-08-15T14:00:00Z", updated_at: "2026-07-10T09:00:00Z" })];
    const r = await pass();
    expect(r).toMatchObject({ inserted: 0, updated: 1, softDeleted: 0 });
    m1 = await storedByUri("M1");
    expect((m1.properties as Record<string, unknown>).start_time).toBe("2026-08-15T14:00:00.000Z");
    expect(m1.deletedAt).toBeNull();
    expect(await db.select().from(events)).toHaveLength(1); // no duplicate row
  });

  it("a meeting deleted upstream (inside the window) is soft-deleted; a cancellation keeps both rows", async () => {
    MEETINGS = [meeting("GONE"), meeting("CANCELED")];
    await pass();

    // GONE vanishes entirely; CANCELED flips status (Calendly keeps canceled
    // meetings in the list, and the connector ALSO emits a "canceled" event).
    MEETINGS = [meeting("CANCELED", { status: "canceled", updated_at: "2026-07-12T00:00:00Z" })];
    const r = await pass();
    expect(r.softDeleted).toBe(1); // only GONE

    expect((await storedByUri("GONE")).deletedAt).not.toBeNull();
    const canceledBooking = await storedByUri("CANCELED");
    expect(canceledBooking.deletedAt).toBeNull(); // still listed → still mirrored
    expect((canceledBooking.properties as Record<string, unknown>).status).toBe("canceled");
    // The transition itself is recorded as its own "canceled" event row.
    const all = await db.select().from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)));
    expect(all.some((e) => e.eventType === "canceled" && e.eventId.includes(":canceled:"))).toBe(true);
  });

  it("rows OUTSIDE the rolling window survive a complete pass (the scan never saw them — they are not gone)", async () => {
    // A meeting from years ago, synced back when it was in-window.
    await db.insert(events).values({
      eventId: `calendly:${connectionId}:${HASH}:https://api.calendly.com/scheduled_events/OLD`,
      orgId: "org_test",
      connectionId,
      source: "calendly",
      eventType: "booked",
      occurredAt: new Date("2023-01-05T10:00:00Z"),
      properties: { uri: "https://api.calendly.com/scheduled_events/OLD", start_time: "2023-01-10T10:00:00Z" },
      streamHash: HASH,
      syncGeneration: 1,
    });
    MEETINGS = [meeting("NEW")];
    const r = await pass();
    expect(r.softDeleted).toBe(0);
    expect((await storedByUri("OLD")).deletedAt).toBeNull(); // ancient history preserved
  });

  it("rows whose start_time can't be parsed are NEVER soft-deleted (fail safe, keep data)", async () => {
    await db.insert(events).values({
      eventId: `calendly:${connectionId}:${HASH}:https://api.calendly.com/scheduled_events/WEIRD`,
      orgId: "org_test",
      connectionId,
      source: "calendly",
      eventType: "booked",
      occurredAt: new Date("2026-07-01T00:00:00Z"),
      properties: { uri: "https://api.calendly.com/scheduled_events/WEIRD", start_time: "not-a-date" },
      streamHash: HASH,
      syncGeneration: 1,
    });
    MEETINGS = [meeting("NEW")];
    const r = await pass();
    expect(r.softDeleted).toBe(0);
    expect((await storedByUri("WEIRD")).deletedAt).toBeNull();
  });
});
