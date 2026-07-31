import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, rawEvents } from "@/db/schema";
import { detectDateKey, normalizeDateValue } from "@/lib/normalize-dates";
import { parseDate } from "@/connectors/field-utils";
import { catchHookConnector } from "@/connectors/catch-hook";
import { processRawEvent } from "@/ingestion/pipeline";
import {
  detectEventTime,
  eventTimeChoice,
  eventTimeNote,
  patchEventTime,
  readEventTime,
  restampWebhookEvents,
  scanWebhookEventTime,
  setEventTime,
} from "@/lib/webhooks/event-time";
// The note is rendered on the Integrations row — the surface that makes
// "delivery time" visible instead of merely true.
import type { DB } from "@/db/types";

/**
 * WHEN A WEBHOOK EVENT HAPPENED.
 *
 * The custom webhook takes arbitrary JSON with no schema — the same problem a
 * spreadsheet row has. `catch-hook.ts` looked in seven fixed keys, fell back to
 * DELIVERY TIME, and `preserveOccurredAt` pinned that forever with nothing
 * anywhere saying which of the two a connection was using. A payload keyed
 * `booked_on` got the moment it arrived, permanently and silently.
 */

const ORG = "org_hook";
const DAY = 86_400_000;

let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  delete process.env.WEBHOOK_EVENT_TIME_LIVE;
  const [c] = await db
    .insert(connections)
    .values({ orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "secret" })
    .returning();
  connId = c.id;
});
afterEach(async () => {
  delete process.env.WEBHOOK_EVENT_TIME_LIVE;
  await close();
});

const live = () => {
  process.env.WEBHOOK_EVENT_TIME_LIVE = "1";
};

async function deliver(payload: Record<string, unknown>, receivedAt = new Date()) {
  const [r] = await db
    .insert(rawEvents)
    .values({ orgId: ORG, connectionId: connId, source: "webhook", payload, receivedAt, signatureValid: true })
    .returning();
  return r;
}

const config = async () => readEventTime((await db.select().from(connections).where(eq(connections.id, connId)))[0].config);

async function storedTimes(): Promise<string[]> {
  const rows = await db.select().from(events).where(eq(events.connectionId, connId));
  return rows.sort((a, b) => a.eventId.localeCompare(b.eventId)).map((r) => r.occurredAt.toISOString());
}

/**
 * THE TIERS. A flat list of conventional names lets `updated_at` win — it parses
 * cleanly, it reads as date-hinted, and it is the one key guaranteed to move
 * under you, because a record edited today re-dates an event from March.
 */
describe("ranking the keys", () => {
  const many = (obj: Record<string, unknown>) => Array.from({ length: 5 }, () => obj);

  it("prefers an event time over a creation time", () => {
    const d = detectDateKey(many({ occurred_at: "2026-07-21T10:00:00Z", created_at: "2026-07-22T10:00:00Z" }));
    expect(d).toEqual({ key: "occurred_at", tier: "event", candidates: ["occurred_at"], qualified: ["occurred_at", "created_at"] });
  });

  it("prefers a creation time over a mutation time, always", () => {
    const d = detectDateKey(many({ created_at: "2026-07-21T10:00:00Z", updated_at: "2026-07-22T10:00:00Z" }));
    expect(d.key).toBe("created_at");
    expect(d.tier).toBe("creation");
  });

  /**
   * Usable, and never quiet. Refusing it outright would strand a payload that
   * genuinely only carries `updated_at` on delivery time forever; using it
   * silently would put a moving timestamp behind a number nobody was told about.
   */
  it("returns a mutation key flagged as one, rather than refusing or hiding it", () => {
    const d = detectDateKey(many({ updated_at: "2026-07-22T10:00:00Z", name: "Ana" }));
    expect(d).toEqual({ key: "updated_at", tier: "mutation", candidates: ["updated_at"], qualified: ["updated_at"] });
    expect(eventTimeNote({ state: { ...state(), key: "updated_at", tier: "mutation" } })).toContain("record-CHANGE time");
  });

  it("beats an invented name with a conventional one", () => {
    const d = detectDateKey(many({ created_at: "2026-07-21T10:00:00Z", signed_on: "2026-07-22T10:00:00Z" }));
    expect(d.key).toBe("created_at");
  });

  it("ties inside a tier, and the names are the question", () => {
    const d = detectDateKey(many({ occurred_at: "2026-07-21T10:00:00Z", timestamp: "2026-07-22T10:00:00Z" }));
    expect(d.key).toBeNull();
    expect(d.candidates.sort()).toEqual(["occurred_at", "timestamp"]);
  });

  it("looks one level down, and ranks the leaf name", () => {
    const d = detectDateKey(many({ id: "x", data: { created_at: "2026-07-21T10:00:00Z", updated_at: "2026-07-22T10:00:00Z" } }));
    expect(d).toEqual({
      key: "data.created_at",
      tier: "creation",
      candidates: ["data.created_at"],
      qualified: ["data.created_at", "data.updated_at"],
    });
  });

  it("still refuses a date-hinted key that holds text", () => {
    expect(detectDateKey(many({ created_at: "pending", name: "Ana" }))).toEqual({ key: null, tier: null, candidates: [], qualified: [] });
  });

  it("says nothing about a connection with no payloads", () => {
    expect(detectDateKey([])).toEqual({ key: null, tier: null, candidates: [], qualified: [] });
  });
});

/**
 * THE PARSER DISAGREEMENT. Two answers to "is this a date" on the same value —
 * one per door the data came through — is its own bug, and the webhook door was
 * the one using the looser, wronger parser.
 */
describe("the two parsers, on the same value", () => {
  it("reads what bare new Date() cannot", () => {
    for (const v of ["21/07/2026", "21.07.2026", "20260722", "1750000000"]) {
      expect(parseDate(v), `${v} under new Date()`).toBeNull();
      expect(normalizeDateValue(v, "created_at"), `${v} under normalizeDateValue`).not.toBeNull();
    }
  });

  /**
   * The dangerous half, and the reason the disagreement table exists: this one
   * does not fail, it becomes March 2nd.
   */
  it("refuses what bare new Date() silently rolls over", () => {
    expect(parseDate("2026-02-30")?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(normalizeDateValue("2026-02-30", "created_at")).toBeNull();
    // …and the other three the table records.
    for (const v of ["2026", "2026-07", "1799-01-01"]) {
      expect(parseDate(v), `${v} under new Date()`).not.toBeNull();
      expect(normalizeDateValue(v, "created_at"), `${v} under normalizeDateValue`).toBeNull();
    }
  });

  /**
   * The RESOLVED path is the one that gets the shared parser, and it is the one
   * that arrives with a restamp attached. The frozen path keeps `parseDate`
   * until the connection is brought over — see the freeze test below.
   */
  it("puts the catch-hook's resolved path on the shared parser", () => {
    const [ev] = catchHookConnector.normalize!(
      { id: "a", created_at: "21/07/2026" },
      { connectionId: connId, eventTime: { key: "created_at" } },
    );
    expect(ev.occurredAt.toISOString()).toBe("2026-07-21T00:00:00.000Z");
  });

  it("pins the table itself, so it cannot quietly go stale", () => {
    const doc = readFileSync("src/connectors/field-utils.ts", "utf8");
    for (const v of ["21/07/2026", "20260722", "2026-02-30", "1799-01-01", "1750000000"]) {
      expect(doc, `${v} is missing from the disagreement table`).toContain(v);
    }
  });
});

describe("the catch-hook itself", () => {
  /**
   * THE FREEZE. Every part of the old chain is improvable — the key order was
   * nobody's decision, the parser is the loose one — and none of it is improved
   * until the connection is also restamped, because a better answer for new
   * events alongside the old answer for old ones is the failure this whole
   * feature is about.
   */
  it("dates exactly as it did before, until the caller says otherwise", () => {
    const payload = { id: "a", created_at: "2026-07-22T00:00:00Z", booked_on: "2026-01-05" };
    // `booked_on` is not in the frozen seven, so the old chain never sees it.
    const [frozen] = catchHookConnector.normalize!(payload, { connectionId: connId });
    expect(frozen.occurredAt.toISOString()).toBe("2026-07-22T00:00:00.000Z");
    // …and neither is the looser parser: "21/07/2026" stays undated.
    const delivered = new Date(Date.now() - 30 * DAY);
    const [eu] = catchHookConnector.normalize!(
      { id: "b", created_at: "21/07/2026" },
      { connectionId: connId, fallbackOccurredAt: delivered },
    );
    expect(eu.occurredAt.toISOString()).toBe(delivered.toISOString());
  });

  it("uses the resolved key once it is given one", () => {
    const payload = { id: "a", created_at: "2026-07-22T00:00:00Z", booked_on: "2026-01-05" };
    const [resolved] = catchHookConnector.normalize!(payload, { connectionId: connId, eventTime: { key: "booked_on" } });
    expect(resolved.occurredAt.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("reads a nested resolved key", () => {
    const [ev] = catchHookConnector.normalize!(
      { id: "a", data: { created_at: "2026-01-05" } },
      { connectionId: connId, eventTime: { key: "data.created_at" } },
    );
    expect(ev.occurredAt.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  /**
   * The resolved path does NOT fall back to the frozen chain. A payload missing
   * the key lands on the delivery moment, which is exactly what
   * `EventTimeState.coverage` counts — so the number that says "20 of 25 would
   * fall back" is the number that happens.
   */
  it("puts a payload without the key on the delivery moment, matching the coverage number", () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    const [ev] = catchHookConnector.normalize!(
      { id: "a", created_at: "2026-07-22T00:00:00Z" },
      { connectionId: connId, eventTime: { key: "booked_on" }, fallbackOccurredAt: delivered },
    );
    expect(ev.occurredAt.toISOString()).toBe(delivered.toISOString());
  });

  /**
   * `new Date()` is only the delivery moment on the FIRST pass. A reprocess
   * would otherwise stamp the reprocess — a fresh wrong answer on top of the old
   * one, and the one a restamp would produce for every undated payload.
   */
  it("falls back to the delivery moment the caller supplies, not to now", () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    const [ev] = catchHookConnector.normalize!({ id: "a", name: "Ana" }, { connectionId: connId, fallbackOccurredAt: delivered });
    expect(ev.occurredAt.toISOString()).toBe(delivered.toISOString());
  });
});

describe("looking at a connection's stored payloads", () => {
  it("reports the key, the tier, and how much of the range carries it", async () => {
    for (let i = 0; i < 5; i++) await deliver({ id: `a${i}`, created_at: "2026-07-21T10:00:00Z" });

    const state = await detectEventTime(db, connId);
    expect(state).toMatchObject({ key: "created_at", tier: "creation", dated: 5, undated: 0 });
    expect(state!.coverage).toMatchObject({ withKey: 5, total: 5 });
  });

  /**
   * PAYLOAD SHAPE DRIFT — the one the sample cannot see. A provider that changed
   * their webhook format leaves the key in recent payloads only, so a detection
   * over the last N deliveries reports "5 of 5 dated" while a restamp would drop
   * everything older to delivery time. The coverage is measured over the whole
   * restampable range for exactly this reason.
   */
  it("counts the key over the WHOLE range, not the sample", async () => {
    const old = new Date(Date.now() - 200 * DAY);
    for (let i = 0; i < 20; i++) await deliver({ id: `old${i}`, ts: "2025-01-05T00:00:00Z" }, new Date(old.getTime() + i));
    for (let i = 0; i < 5; i++) await deliver({ id: `new${i}`, created_at: "2026-07-21T10:00:00Z" });

    const state = await detectEventTime(db, connId);
    expect(state!.key).toBe("created_at");
    // The sample says everything is fine. The range says three quarters of the
    // events would fall back to delivery time.
    expect(state!.dated).toBe(5);
    expect(state!.coverage).toMatchObject({ withKey: 5, total: 25 });
    expect(state!.coverage.oldestWithKey).not.toBeNull();
    expect(eventTimeNote({ state: state! })).toContain("20 of 25 stored payloads do not carry it");
  });

  it("counts coverage for a nested key too", async () => {
    for (let i = 0; i < 3; i++) await deliver({ id: `a${i}`, data: { created_at: "2026-07-21T10:00:00Z" } });
    await deliver({ id: "bare", data: { name: "Ana" } });

    const state = await detectEventTime(db, connId);
    expect(state!.key).toBe("data.created_at");
    expect(state!.coverage).toMatchObject({ withKey: 3, total: 4 });
  });
});

/**
 * THE GATE. Detecting a better key and using it for new events without
 * restamping the old ones would date one metric two different ways — uniformly
 * wrong beats incoherent — so both halves flip together.
 */
describe("the rollout gate", () => {
  it("records a decision and changes nothing while it is off", async () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    // A key the frozen seven never look at, so it lands on delivery time.
    const raw = await deliver({ id: "a", booked_on: "2026-01-05" }, delivered);
    await processRawEvent(db, raw.id);
    expect(await storedTimes()).toEqual([delivered.toISOString()]);

    const before = await storedTimes();

    await scanWebhookEventTime(db);

    expect((await config()).state).toMatchObject({ key: "booked_on", tier: "event" });
    expect(await storedTimes()).toEqual(before); // decided, acted on nothing
  });

  /**
   * The gate has to hold for events arriving AFTER a decision is recorded, not
   * just before one exists. This is the window the whole gate is for: the scan
   * has an opinion, the fleet has been looked at, and nobody has flipped
   * anything — so a webhook landing now must still be dated the old way.
   */
  it("still dates new events the frozen way once a decision is on record", async () => {
    await deliver({ id: "seed", created_at: "21/07/2026" });
    await scanWebhookEventTime(db);
    expect((await config()).state).toMatchObject({ key: "created_at" });

    const delivered = new Date(Date.now() - 5 * DAY);
    await processRawEvent(db, (await deliver({ id: "later", created_at: "21/07/2026" }, delivered)).id);

    // The frozen parser cannot read "21/07/2026", so this lands on delivery
    // time — the same answer every event before it got.
    expect(await storedTimes()).toContain(delivered.toISOString());
  });

  /**
   * THE FIRST FLIP restamps every connection, not only the ones whose key
   * changed — because the PARSER changed too. Here the key is `created_at`
   * before and after; what changes is that "21/07/2026" stops being unreadable.
   */
  it("restamps a connection whose key did not change, the first time it goes live", async () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    await processRawEvent(db, (await deliver({ id: "a", created_at: "21/07/2026" }, delivered)).id);
    await scanWebhookEventTime(db); // gate off: decision recorded, nothing dated
    expect(await storedTimes()).toEqual([delivered.toISOString()]);
    expect((await config()).state).toMatchObject({ key: "created_at" });

    live();
    const res = await scanWebhookEventTime(db);

    expect(res[0].restamped).toBe(1); // the key is identical; the answer is not
    expect(await storedTimes()).toEqual(["2026-07-21T00:00:00.000Z"]);
    expect((await config()).restampedAt).toEqual(expect.any(String));
  });

  it("dates new events and restamps old ones together, once it is on", async () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    const raw = await deliver({ id: "a", booked_on: "2026-01-05" }, delivered);
    await processRawEvent(db, raw.id);
    expect(await storedTimes()).toEqual([delivered.toISOString()]);

    live();
    await scanWebhookEventTime(db);

    expect(await storedTimes()).toEqual(["2026-01-05T00:00:00.000Z"]);
  });

  it("leaves an undated payload on its DELIVERY time, not on the restamp's clock", async () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    await processRawEvent(db, (await deliver({ id: "a", booked_on: "2026-01-05" }, delivered)).id);
    await processRawEvent(db, (await deliver({ id: "b", name: "no date here" }, delivered)).id);

    live();
    await scanWebhookEventTime(db);

    expect((await storedTimes()).sort()).toEqual(["2026-01-05T00:00:00.000Z", delivered.toISOString()].sort());
  });

  it("does not restamp again when the key has not changed", async () => {
    live();
    await processRawEvent(db, (await deliver({ id: "a", booked_on: "2026-01-05" })).id);
    const first = await scanWebhookEventTime(db);
    expect(first[0].restamped).toBeGreaterThan(0);

    const second = await scanWebhookEventTime(db);
    expect(second[0].restamped).toBeUndefined();
  });

  it("is idempotent — re-deriving the same payload gives the same instant", async () => {
    live();
    await processRawEvent(db, (await deliver({ id: "a", booked_on: "2026-01-05" })).id);
    await restampWebhookEvents(db, connId, "booked_on");
    const once = await storedTimes();
    await restampWebhookEvents(db, connId, "booked_on");
    expect(await storedTimes()).toEqual(once);
  });
});

/**
 * THE WHOLE DESIGN RESTS ON THIS. `connections.config` carries the setting
 * instead of a new column because every writer spreads; one wholesale
 * `set({ config: … })` drops it silently, and the only symptom would be a
 * connection quietly reverting to delivery time.
 */
describe("connections.config is only ever written by spreading", () => {
  it("keeps keys it does not know about", async () => {
    await db.update(connections).set({ config: { externalId: "abc" } }).where(eq(connections.id, connId));
    await patchEventTime(db, connId, { key: "booked_on", locked: true });

    const [row] = await db.select().from(connections).where(eq(connections.id, connId));
    expect(row.config).toMatchObject({ externalId: "abc" });
    expect(readEventTime(row.config)).toMatchObject({ key: "booked_on", locked: true });

    // …and a second patch keeps the first.
    await patchEventTime(db, connId, { restampRequestedAt: "2026-07-01T00:00:00.000Z" });
    const [again] = await db.select().from(connections).where(eq(connections.id, connId));
    expect(readEventTime(again.config)).toMatchObject({ key: "booked_on", locked: true, restampRequestedAt: expect.any(String) });
    expect(again.config).toMatchObject({ externalId: "abc" });
  });

  /**
   * The static half. A wholesale write anywhere in the codebase would pass the
   * test above — it only proves the writers this test calls behave — so the
   * source is checked too.
   */
  it("has no writer that replaces the whole object", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        const src = readFileSync(path, "utf8");
        // `config:` inside a `.set({...})` on the connections table. The two
        // legitimate writers spread; anything else is a wholesale replace.
        for (const m of src.matchAll(/\.set\(\{[^}]*\bconfig:\s*([^,}]+)/g)) {
          const value = m[1].trim();
          if (!value.startsWith("{ ...") && !value.startsWith("{...") && value !== "next") offenders.push(`${path}: ${value}`);
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});

describe("what the user is told", () => {
  it("names delivery time rather than saying nothing", () => {
    expect(eventTimeNote({})).toContain("until a scan finds a timestamp field");
    expect(eventTimeNote({ locked: true, key: null })).toContain("No timestamp field selected");
  });

  it("says 'would use' before the gate and 'timing uses' after it", () => {
    const cfg = { state: { ...state(), key: "created_at", tier: "creation" as const } };
    expect(eventTimeNote(cfg)).toContain('Would use "created_at"');
    live();
    expect(eventTimeNote(cfg)).toContain('Timing uses "created_at"');
  });

  it("asks the ambiguous question by name", () => {
    const note = eventTimeNote({ state: { ...state(), key: null, candidates: ["occurred_at", "timestamp"] } });
    expect(note).toContain('"occurred_at", "timestamp"');
    expect(note).toContain("Choose one");
  });
});

/** A minimal state, for the note tests. */
function state() {
  return {
    key: null as string | null,
    source: "detected" as const,
    tier: null,
    dated: 0,
    undated: 0,
    coverage: { withKey: 0, total: 0, oldestWithKey: null },
    at: new Date().toISOString(),
  };
}

/**
 * THE PICKER'S HALF. A detector that can be wrong needs a fix a person can
 * reach, or the honesty of the note is a better-worded dead end — which is
 * exactly what it was until this landed: the ambiguous case was answered by
 * editing the database.
 */
describe("answering the question by hand", () => {
  it("tells the three answers apart, since two of them store no key", async () => {
    expect(await setEventTime(db, ORG, connId, { kind: "key", key: "booked_on" })).toEqual({ changed: true });
    expect(eventTimeChoice(await config())).toEqual({ kind: "key", key: "booked_on" });

    expect(await setEventTime(db, ORG, connId, { kind: "none" })).toEqual({ changed: true });
    expect(eventTimeChoice(await config())).toEqual({ kind: "none" });

    expect(await setEventTime(db, ORG, connId, { kind: "auto" })).toEqual({ changed: true });
    expect(eventTimeChoice(await config())).toEqual({ kind: "auto" });
  });

  it("is a no-op when the answer is unchanged — a restamp is a full reprocess", async () => {
    await setEventTime(db, ORG, connId, { kind: "key", key: "booked_on" });
    expect(await setEventTime(db, ORG, connId, { kind: "key", key: "booked_on" })).toEqual({ changed: false });
  });

  it("is org-scoped", async () => {
    expect(await setEventTime(db, "org_other", connId, { kind: "key", key: "booked_on" })).toEqual({ changed: false });
    expect((await config()).key).toBeUndefined();
  });

  it("beats the detector, and the detector stops re-deciding", async () => {
    live();
    const delivered = new Date(Date.now() - 30 * DAY);
    // The detector ranks `created_at` (creation) above `updated_at` (mutation),
    // which is the whole point of the tiers. A human who knows this provider
    // only touches records when the thing happens can still say otherwise.
    await processRawEvent(
      db,
      (await deliver({ id: "a", created_at: "2026-07-22T00:00:00Z", updated_at: "2026-01-05T00:00:00Z" }, delivered)).id,
    );

    await setEventTime(db, ORG, connId, { kind: "key", key: "updated_at" });
    await scanWebhookEventTime(db);

    expect((await config()).state).toMatchObject({ key: "created_at" }); // still observed
    expect(await storedTimes()).toEqual(["2026-01-05T00:00:00.000Z"]); // the human wins
  });

  /**
   * The pick is recorded while the gate is shut and acted on when it opens.
   * Anything else would either restamp inside a click or lose the answer.
   */
  it("holds a pick made before the gate opened, and honours it after", async () => {
    const delivered = new Date(Date.now() - 30 * DAY);
    await processRawEvent(db, (await deliver({ id: "a", booked_on: "2026-01-05" }, delivered)).id);

    await setEventTime(db, ORG, connId, { kind: "key", key: "booked_on" });
    await scanWebhookEventTime(db);
    expect(await storedTimes()).toEqual([delivered.toISOString()]); // recorded, not acted on
    expect((await config()).restampRequestedAt).toEqual(expect.any(String));

    live();
    await scanWebhookEventTime(db);

    expect(await storedTimes()).toEqual(["2026-01-05T00:00:00.000Z"]);
    expect((await config()).restampRequestedAt).toBeUndefined(); // cleared, once done
  });

  it("offers every key that holds real dates, not only the one it chose", async () => {
    for (let i = 0; i < 4; i++) {
      await deliver({ id: `a${i}`, created_at: "2026-07-21T10:00:00Z", updated_at: "2026-07-22T10:00:00Z", name: "Ana" });
    }
    const state = await detectEventTime(db, connId);
    expect(state!.key).toBe("created_at");
    // …including the mutation key, because a user who has thought about it can
    // still say yes. The ranking is what stops the detector choosing it.
    expect(state!.options).toEqual(["created_at", "updated_at"]);
  });
});

/**
 * THE OBSERVATION, on the five connectors that keep `parseDate`.
 *
 * Their behaviour is unchanged and stays unchanged — a provider's documented ISO
 * field is not worth re-verifying five ways for a shape nobody has sent. But
 * "nobody has sent one" was an assumption, and it is the class of assumption
 * that has been wrong four times here. So every value they parse is checked
 * against the strict parser too and the disagreements are logged, using
 * `parseDate`'s answer regardless.
 */
describe("watching for a provider that sends something the table warns about", () => {
  const drift = () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m: unknown) => void lines.push(String(m)));
    return lines;
  };
  afterEach(() => vi.restoreAllMocks());

  it("says nothing at all for documented ISO, which is the everyday case", () => {
    const lines = drift();
    for (const v of ["2026-07-22T10:30:00Z", "2026-07-22T10:30:00+02:00", "2026-07-22 10:30:00", "2026-07-22"]) {
      parseDate(v, "date_created");
    }
    expect(lines).toEqual([]);
  });

  /** The one that matters: it does not fail, it returns March 2nd. */
  it("flags a rolled-over impossible date, and still returns what it always did", () => {
    const lines = drift();
    const got = parseDate("2026-02-30", "date_created");
    expect(got?.toISOString()).toBe("2026-03-02T00:00:00.000Z"); // behaviour unchanged
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[parse-drift] kind=loose-accept");
    expect(lines[0]).toContain('field=date_created');
    expect(lines[0]).toContain('"2026-02-30"');
  });

  it("flags the other loose-accept shapes the table records", () => {
    for (const v of ["2026", "2026-07", "1799-01-01"]) {
      const lines = drift();
      parseDate(v, "date_created");
      expect(lines[0], v).toContain("kind=loose-accept");
      vi.restoreAllMocks();
    }
  });

  it("flags a value only the strict parser reads — data currently landing on now()", () => {
    const lines = drift();
    expect(parseDate("21/07/2026", "date_created")).toBeNull(); // behaviour unchanged
    expect(lines[0]).toContain("kind=strict-only");
  });

  /**
   * The field name is passed at every call site for this reason: without it the
   * strict parser's numeric gate stays shut, and every epoch-second string a
   * provider sends would report as a disagreement that exists only because the
   * comparison was set up wrong.
   */
  it("does not manufacture a disagreement out of a closed numeric gate", () => {
    const lines = drift();
    parseDate("1750000000", "date_created"); // hinted: both have an opinion
    expect(lines[0]).toContain("kind=strict-only");
    vi.restoreAllMocks();

    const unnamed = drift();
    parseDate("1750000000", "ref"); // not hinted: neither reads it, no disagreement
    expect(unnamed).toEqual([]);
  });

  it("is wired into every connector that parses a provider timestamp", () => {
    // A call site that forgot the name would report gate-closed noise forever,
    // which is the failure that makes an observation useless.
    const sources = ["calendly", "close", "instantly", "sendblue", "google-calendar"];
    for (const name of sources) {
      const src = readFileSync(`src/connectors/${name}.ts`, "utf8");
      let at = src.indexOf("parseDate(");
      let calls = 0;
      while (at !== -1) {
        // Balance the parens: the arguments themselves contain calls, so a
        // regex stops at the wrong bracket and passes a broken call site.
        let depth = 0;
        let end = at + "parseDate".length;
        do {
          if (src[end] === "(") depth += 1;
          else if (src[end] === ")") depth -= 1;
          end += 1;
        } while (depth > 0 && end < src.length);
        const args = src.slice(at + "parseDate(".length, end - 1);
        expect(args, `${name}: parseDate call without a field name`).toMatch(/,\s*"[^"]+"$/);
        calls += 1;
        at = src.indexOf("parseDate(", end);
      }
      expect(calls, `${name}: no parseDate call found — has it been renamed?`).toBeGreaterThan(0);
    }
  });
});
