import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { connections, rawEvents } from "@/db/schema";
import type { DB } from "@/db/types";
import { detectDateKey, normalizeDateValue, type EventTimeTier } from "@/lib/normalize-dates";
import { processRawEvent } from "@/ingestion/pipeline";

/**
 * WHEN A WEBHOOK EVENT HAPPENED, for the catch-hook connector.
 *
 * A custom webhook takes arbitrary JSON with no schema, which is the same
 * problem a spreadsheet row has: nothing in the payload is guaranteed to say
 * when the thing happened. `catch-hook.ts` looked in seven fixed keys and fell
 * back to DELIVERY TIME, `processRawEvent` pinned that with `preserveOccurredAt`,
 * and nothing anywhere said which of the two a given connection was using. A
 * payload keyed `booked_on` got the moment it arrived, permanently and silently.
 *
 * THE STATE LIVES IN `connections.config`, not in a new column, and that is a
 * checked fact rather than a hope: the field is jsonb, NOT NULL, defaulted to
 * `{}`, and has exactly three writers — `createConnection` seeds it, the Google
 * OAuth callback sets `{}`, and one patch adds `externalId` by SPREADING. It is
 * read only as `PollArgs.config` and by `pollOperation`, and the `webhook`
 * connector has neither `poll` nor `operationFor`, so for a catch-hook
 * connection nothing consumes it at all. It is never rendered and never
 * round-tripped through a form.
 *
 * That whole design rests on every writer spreading. `tests/webhook-event-time.
 * test.ts` pins it, because one wholesale `set({ config: … })` would drop this
 * silently and the only symptom would be a connection quietly reverting to
 * delivery time.
 *
 * Namespaced under one key so it can never collide with a provider config key,
 * and named to match `source_streams` field for field — `key`/`locked`/`state`/
 * `restampRequestedAt` against `date_field`/`date_field_locked`/
 * `date_field_state`/`restamp_requested_at`. Same concepts, same words.
 */

export const EVENT_TIME_KEY = "eventTime";

export type EventTimeState = {
  /** The key the last detection would use, or null when there is nothing to use. */
  key: string | null;
  source: "user" | "detected";
  tier: EventTimeTier | null;
  /** Payloads sampled that carried a usable value at `key`, and that did not. */
  dated: number;
  undated: number;
  /**
   * How much of the RESTAMPABLE range carries the key at all — not just the
   * sample. A provider that changed its webhook format leaves the chosen key in
   * recent payloads only, and a restamp would then re-date the recent ones
   * correctly and drop everything older to delivery time. Same number, two
   * different meanings inside it, and nothing on screen to say so.
   */
  coverage: { withKey: number; total: number; oldestWithKey: string | null };
  /** Several keys tied inside the winning tier: the names are the question. */
  candidates?: string[];
  /**
   * Every key that holds real dates, ranked — what the PICKER offers.
   *
   * Wider than `candidates` on purpose. The ranking exists so nobody has to
   * think about `updated_at`; this list exists so somebody who HAS thought about
   * it can still choose it. A user overruling the ranking is a decision; the
   * detector making the same choice quietly is not.
   */
  options?: string[];
  at: string;
};

export type EventTimeConfig = {
  /**
   * The user's answer. Null means "detect" or "use delivery time" — see
   * `locked`.
   *
   * NOTHING WRITES THESE TWO YET, and that is stated rather than hidden: the
   * override is honoured everywhere it matters (`effectiveEventTimeKey` reads
   * it, the scan leaves an answered connection's dating alone, the note says
   * what a human chose) but no picker sets it. It lands with the connection-page
   * control, on the same three-answer shape the sheet's picker uses. Until then
   * the ambiguous case is answered by choosing in the database, which is exactly
   * as unsatisfying as it sounds and is why this is written down.
   */
  key?: string | null;
  /** Whether a human has answered. False (the default) lets detection decide. */
  locked?: boolean;
  state?: EventTimeState;
  restampRequestedAt?: string;
  /**
   * When this connection was last brought ONTO the resolved dating.
   *
   * Absent means it is still on the frozen pre-feature path, whatever the gate
   * says — which is why the first run after the gate opens restamps every
   * connection rather than only the ones whose key changed. The parser changed
   * too, so "the key is the same" does not mean "the answer is the same": a
   * payload holding "21/07/2026" was undated before and is dated now.
   */
  restampedAt?: string;
};

/**
 * What the picker can say. Three answers, not two — `auto` and `none` both leave
 * `key` null and mean opposite things: find one for me, versus stop looking.
 */
export type EventTimeChoice = { kind: "auto" } | { kind: "none" } | { kind: "key"; key: string };

/** The stored setting as the three-way answer the picker speaks in. */
export function eventTimeChoice(cfg: EventTimeConfig): EventTimeChoice {
  if (!cfg.locked) return { kind: "auto" };
  return cfg.key ? { kind: "key", key: cfg.key } : { kind: "none" };
}

/**
 * Answer the event-time question for this CONNECTION.
 *
 * Org-scoped like every write here. Returns whether anything changed, because an
 * unchanged answer must not look like a reason to restamp a settled connection —
 * and a restamp is a full reprocess of every stored payload.
 *
 * The marker is set here and acted on by the scan, rather than restamping
 * inline: a reprocess of a busy connection is not something to do inside a
 * click, and while the rollout gate is shut it must not happen at all. The
 * answer is recorded either way, so flipping the gate honours what was chosen
 * in the meantime.
 */
export async function setEventTime(
  db: DB,
  orgId: string,
  connectionId: string,
  choice: EventTimeChoice,
): Promise<{ changed: boolean }> {
  const key = choice.kind === "key" && choice.key.trim() !== "" ? choice.key : null;
  const locked = choice.kind !== "auto";
  const [conn] = await db
    .select({ config: connections.config })
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
    .limit(1);
  if (!conn) return { changed: false };
  const current = readEventTime(conn.config);
  if ((current.key ?? null) === key && (current.locked ?? false) === locked) return { changed: false };
  await patchEventTime(db, connectionId, { key, locked, restampRequestedAt: new Date().toISOString() }, orgId);
  return { changed: true };
}

/** How many recent payloads a detection samples. */
const SAMPLE = 200;

/**
 * THE ROLLOUT GATE.
 *
 * Off by default, and while it is off detection RECORDS what it would pick and
 * changes nothing about how events are dated. That is the whole point: widening
 * the key list without restamping would date events from before the change by
 * delivery time and events after it properly, inside one metric, silently —
 * uniformly wrong is better than incoherent. So the gate flips both halves at
 * once, and until it does, `scripts/webhook-event-time.sql` says what each
 * connection would pick.
 *
 * Temporary by design. Once the fleet has been looked at and flipped, this
 * function and its callers' branches come out.
 */
export function eventTimeLive(): boolean {
  return process.env.WEBHOOK_EVENT_TIME_LIVE === "1";
}

export function readEventTime(config: Record<string, unknown> | null | undefined): EventTimeConfig {
  const raw = (config ?? {})[EVENT_TIME_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as EventTimeConfig) : {};
}

/**
 * Merge a patch into `config.eventTime`, SPREADING at both levels.
 *
 * The read-modify-write is not atomic, and deliberately is not made so: the two
 * writers are a nightly job and a human clicking a picker, they touch different
 * sub-keys, and a lost update means one detection is re-run. Serializing that
 * would cost a lock on the connection for the sake of a race that resolves
 * itself on the next run.
 */
export async function patchEventTime(
  db: DB,
  connectionId: string,
  patch: EventTimeConfig,
  orgId?: string,
): Promise<void> {
  const [conn] = await db
    .select({ config: connections.config })
    .from(connections)
    .where(orgId ? and(eq(connections.id, connectionId), eq(connections.orgId, orgId)) : eq(connections.id, connectionId))
    .limit(1);
  if (!conn) return;
  const next = { ...(conn.config ?? {}), [EVENT_TIME_KEY]: { ...readEventTime(conn.config), ...patch } };
  await db
    .update(connections)
    .set({ config: next, updatedAt: new Date() })
    .where(orgId ? and(eq(connections.id, connectionId), eq(connections.orgId, orgId)) : eq(connections.id, connectionId));
}

/**
 * What this config RESOLVES to: the user's answer if they gave one, else the
 * detection's, else nothing.
 *
 * Deliberately does NOT consult the rollout gate, even though it did at first.
 * The gate is already enforced by both callers — `processRawEvent` skips the
 * lookup entirely, and `scanWebhookEventTime` skips the restamp — so a third
 * check here was defence that could not be made to fail: every test still
 * passed with it deleted. Two authorities and one echo is worse than two
 * authorities, because the echo is what someone trusts when they refactor.
 */
export function effectiveEventTimeKey(cfg: EventTimeConfig): string | null {
  if (cfg.locked) return cfg.key ?? null;
  return cfg.state?.source === "detected" ? (cfg.state.key ?? null) : null;
}

/**
 * Look at a connection's stored payloads and work out which key holds the event
 * time — plus how much of the restampable range would actually be covered by it.
 *
 * READS ONLY. Two queries: a sample of recent payloads for the detection, and
 * one aggregate for the coverage. No provider calls, ever — the payloads are
 * already ours.
 */
export async function detectEventTime(db: DB, connectionId: string, now = new Date()): Promise<EventTimeState | null> {
  const sample = await db
    .select({ payload: rawEvents.payload })
    .from(rawEvents)
    .where(eq(rawEvents.connectionId, connectionId))
    .orderBy(desc(rawEvents.receivedAt))
    .limit(SAMPLE);
  if (sample.length === 0) return null;

  const detection = detectDateKey(sample.map((r) => r.payload));
  const key = detection.key;

  let dated = 0;
  let undated = 0;
  if (key) {
    for (const { payload } of sample) {
      const value = valueAtPath(payload, key);
      if (value != null && normalizeDateValue(value, leafOf(key)) != null) dated += 1;
      else undated += 1;
    }
  }

  return {
    key,
    source: "detected",
    tier: detection.tier,
    dated,
    undated,
    coverage: key ? await keyCoverage(db, connectionId, key) : { withKey: 0, total: 0, oldestWithKey: null },
    ...(detection.candidates.length > 1 ? { candidates: detection.candidates } : {}),
    options: detection.qualified,
    at: now.toISOString(),
  };
}

/**
 * How many of this connection's stored payloads carry `key` AT ALL, across the
 * whole range — and the oldest one that does.
 *
 * The sample cannot answer this and must not be asked to. A provider that
 * changed its webhook format six months ago leaves the new key present in every
 * recent payload and absent from everything before, so a detection over the last
 * 200 deliveries reports "dated 200 of 200" while a restamp would silently drop
 * years of events to delivery time. The number that matters is the one over the
 * range the restamp will actually touch.
 *
 * `?` on a jsonb column is key-existence and is index-free here, but this runs
 * once per connection per night, not per event.
 */
async function keyCoverage(db: DB, connectionId: string, key: string): Promise<EventTimeState["coverage"]> {
  const path = key.split(".");
  const expr =
    path.length === 1
      ? sql`${rawEvents.payload} ? ${path[0]}`
      : sql`(${rawEvents.payload} -> ${path[0]}) ? ${path[1]}`;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withKey: sql<number>`count(*) filter (where ${expr})::int`,
      oldestWithKey: sql<string | null>`min(${rawEvents.receivedAt}) filter (where ${expr})`,
    })
    .from(rawEvents)
    .where(eq(rawEvents.connectionId, connectionId));
  return {
    total: row?.total ?? 0,
    withKey: row?.withKey ?? 0,
    oldestWithKey: row?.oldestWithKey ? new Date(row.oldestWithKey).toISOString() : null,
  };
}

/** The last segment of a path — the name the parser's numeric gate is keyed on. */
export function leafOf(path: string): string {
  return path.split(".").pop() ?? path;
}

/** The value at a one-level path, or undefined. */
export function valueAtPath(payload: unknown, path: string): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const [head, tail] = path.split(".");
  const top = (payload as Record<string, unknown>)[head];
  if (tail == null) return top;
  return top && typeof top === "object" ? (top as Record<string, unknown>)[tail] : undefined;
}

/**
 * The one sentence, everywhere — same rule as the sheet's `dateColumnNote`.
 *
 * Delivery time is a defensible answer for a payload that carries no timestamp;
 * delivery time presented AS the event time is not. So every state says which it
 * is, and three of them say something a user has to act on.
 */
export function eventTimeNote(cfg: EventTimeConfig): string {
  const state = cfg.state ?? null;
  if (cfg.locked) {
    if (!cfg.key) return "No timestamp field selected — timing uses when each event was delivered.";
    return `Timing uses "${cfg.key}".`;
  }
  if (!state) return "Timing uses when each event was delivered, until a scan finds a timestamp field.";

  if (state.candidates && state.candidates.length > 1) {
    const names = state.candidates.map((c) => `"${c}"`).join(", ");
    return `More than one field could be the event time — ${names}. Choose one; until then timing uses when each event was delivered.`;
  }
  if (!state.key) return "No field in these payloads holds a usable timestamp — timing uses when each event was delivered.";

  const live = eventTimeLive();
  const verb = live ? "Timing uses" : "Would use";
  // A MUTATION KEY IS NEVER QUIET. It is the one class of answer that moves
  // under you — a record edited today re-dates an event from March — so it is
  // usable, flagged, and never presented as if it were the event's own time.
  const tier =
    state.tier === "mutation"
      ? ` — this is a record-CHANGE time, not an event time, so it moves when the record is edited`
      : state.tier === "creation"
        ? ` (record creation time)`
        : "";
  const gap = state.coverage.total - state.coverage.withKey;
  const missing =
    gap > 0
      ? ` ${gap} of ${state.coverage.total} stored payloads do not carry it and would fall back to delivery time.`
      : "";
  return `${verb} "${state.key}" (detected)${tier}.${missing}`;
}

/**
 * THE RESTAMP: re-derive `occurred_at` for every stored payload of a webhook
 * connection, from the payload itself.
 *
 * Better than the sheet's equivalent, because the evidence survived. A
 * spreadsheet row's past is gone, so that restamp reconstructs first-seen from
 * `events.received_at`; here the original JSON is still in `raw_events`, so the
 * value is re-derived exactly. `received_at` is only the fallback for payloads
 * the chosen key cannot date — and those keep whatever they already have rather
 * than being stamped `new Date()`, which is what an unguarded reprocess would do
 * and would be a fresh wrong answer on top of the old one.
 *
 * IT DEPENDS ON `raw_events` STILL BEING THERE. Nothing prunes them for an
 * active connection today; if retention ever reaches one, webhook restamping
 * dies with it and this becomes a one-way door. Recorded in DATA_MODEL.md under
 * the retention coupling.
 *
 * Idempotent: re-deriving the same payload under the same key produces the same
 * instant, so an interrupted run is finished by the next one.
 */
export async function restampWebhookEvents(
  db: DB,
  connectionId: string,
  dateKey: string | null,
): Promise<{ processed: number; failed: number }> {
  const raws = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(eq(rawEvents.connectionId, connectionId))
    .orderBy(rawEvents.receivedAt);
  let processed = 0;
  let failed = 0;
  for (const r of raws) {
    try {
      await processRawEvent(db, r.id, { eventTime: { key: dateKey }, restamp: true });
      processed += 1;
    } catch {
      // One unparseable payload must not stop the pass; the next run retries it.
      failed += 1;
    }
  }
  return { processed, failed };
}

/**
 * Run the detection across every catch-hook connection, and act on it when the
 * gate is open.
 *
 * TWO HALVES, FLIPPED TOGETHER. With the gate off it writes `state` and nothing
 * else — new events keep being dated exactly as before, so nothing becomes
 * incoherent while somebody looks. With the gate on, a change of key also
 * restamps everything already stored, so the connection's events are dated one
 * way at every moment.
 *
 * The restamp fires on a CHANGE, compared against the key the last recorded
 * state used — the same rule as the sheet's, and for the same reason: a
 * detection that lands for the first time on a connection with a year of events
 * has to reach them too, or new events are right and old ones are not.
 */
export async function scanWebhookEventTime(
  db: DB,
  now = new Date(),
): Promise<Array<{ connectionId: string; key: string | null; tier: EventTimeTier | null; restamped?: number }>> {
  const conns = await db
    .select({ id: connections.id, config: connections.config })
    .from(connections)
    .where(and(eq(connections.source, "webhook"), isNull(connections.disabledAt)));

  const out: Array<{ connectionId: string; key: string | null; tier: EventTimeTier | null; restamped?: number }> = [];
  for (const conn of conns) {
    const cfg = readEventTime(conn.config);
    // An answered connection is not re-decided; the state still records what a
    // detection WOULD say, which is what makes a wrong pick visible.
    const state = await detectEventTime(db, conn.id, now);
    if (!state) continue;
    await patchEventTime(db, conn.id, { state });

    const row: (typeof out)[number] = { connectionId: conn.id, key: state.key, tier: state.tier };
    if (eventTimeLive()) {
      const after = effectiveEventTimeKey({ ...cfg, state });
      /**
       * TWO reasons to restamp, and the first one only happens once.
       *
       * A connection that has never been brought onto the resolved dating is
       * restamped whatever its key turns out to be, because the PARSER changed
       * as well: a payload holding "21/07/2026" was undated under the frozen
       * path and is dated under this one, so "the key did not change" does not
       * mean "the answer did not change". After that, only a change of key.
       */
      const firstTime = cfg.restampedAt == null;
      // …and a THIRD: somebody answered the question by hand. The picker records
      // the answer and leaves the work here, because a reprocess of a busy
      // connection is not something to do inside a click — and while the gate
      // was shut it could not happen at all, so this is where a pick made last
      // week finally lands.
      const requested = cfg.restampRequestedAt ?? null;
      if (firstTime || requested != null || after !== (cfg.state?.key ?? null)) {
        const res = await restampWebhookEvents(db, conn.id, after);
        row.restamped = res.processed;
        await patchEventTime(db, conn.id, { restampedAt: now.toISOString() });
        /**
         * Cleared by COMPARISON, and only after the reprocess returned. A pick
         * made while this run was walking the payloads carries a newer stamp and
         * must survive; a run that dies partway must leave the request standing,
         * because re-running it re-derives the same instants and losing it
         * silently is the failure that matters.
         */
        if (requested != null) {
          const [fresh] = await db
            .select({ config: connections.config })
            .from(connections)
            .where(eq(connections.id, conn.id))
            .limit(1);
          if (readEventTime(fresh?.config).restampRequestedAt === requested) {
            await patchEventTime(db, conn.id, { restampRequestedAt: undefined });
          }
        }
      }
    }
    out.push(row);
  }
  return out;
}
