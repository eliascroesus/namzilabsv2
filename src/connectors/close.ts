import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  RegisterWebhookArgs,
  RegisterWebhookResult,
} from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson, basicAuth, HttpError, parseRateLimit, type ObservedRateLimit } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

const API = "https://api.close.com/api/v1";

/** Event Log page size (the endpoint's documented maximum). */
const EVENT_LOG_LIMIT = 50;
/** Pages walked per poll() call; deeper windows resume next sweep via the stored continuation. */
const PAGES_PER_POLL = 4;
/**
 * Re-read cushion below the high-water mark. Close's Events API docs recommend
 * re-scanning the latest five minutes because events can surface out of order;
 * event_id dedup makes the wider overlap free.
 */
const OVERLAP_MS = 5 * 60_000;
/**
 * How far back a FIRST sync reaches.
 *
 * Without this the first poll sent no `date_created__gte` at all — and because
 * `hw` only advances once a window drains, "the first window" was the entire
 * workspace event log. A mature account walked it 200 records at a time,
 * forever, and since every sweep inserted rows the cadence ladder never
 * demoted it: it simply ran for days. Close is the highest-volume connector
 * here and a mature workspace is the likeliest day-one account, so the
 * unbounded case was the default case.
 *
 * Thirty days matches Sendblue (`FIRST_SYNC_DAYS` there) and is a floor on the
 * first REQUEST, not a statement about how much history we will ever hold.
 * Reaching further back is a one-time historical import — see
 * PRE_LAUNCH_CHECKLIST.md item 9a (the E.8 backfill lane).
 */
const FIRST_SYNC_DAYS = 30;

/**
 * Poll cursor for the Close Event Log. Serialized as the plain high-water
 * date string when no page walk is in flight (back-compat with cursors stored
 * by the old single-page poll), or as JSON mid-walk:
 * - `hw`      — newest fully-ingested `date_created` from the LAST completed
 *               window; the lower bound (with overlap) of the current window.
 * - `cont`    — the provider's `cursor_next`, resuming a partially-walked window.
 * - `maxSeen` — newest `date_created` seen so far in the current walk; becomes
 *               the new `hw` only once the window is fully drained.
 * - `floor`   — the first sync's lower bound, PINNED when the walk starts.
 *               Recomputing `now - FIRST_SYNC_DAYS` each sweep would creep the
 *               boundary forward while the walk pages backwards, so the depth
 *               reached would depend on how long the walk took. Only meaningful
 *               before `hw` exists; after that `hw - overlap` governs and this
 *               is dropped.
 * - `minSeen` — oldest `date_created` ingested in the current walk. Carries no
 *               sync semantics at all: it is how far back the import has got,
 *               so the editor can say "covering 12 of 30 days" instead of
 *               showing a number that climbs for a day with no explanation.
 */
type CloseCursor = {
  hw: string | null;
  cont: string | null;
  maxSeen: string | null;
  floor?: string | null;
  minSeen?: string | null;
};

function parseCloseCursor(cursor: string | null): CloseCursor {
  if (!cursor) return { hw: null, cont: null, maxSeen: null };
  if (cursor.startsWith("{")) {
    try {
      const parsed = JSON.parse(cursor) as Partial<CloseCursor>;
      return {
        hw: parsed.hw ?? null,
        cont: parsed.cont ?? null,
        maxSeen: parsed.maxSeen ?? null,
        floor: parsed.floor ?? null,
        minSeen: parsed.minSeen ?? null,
      };
    } catch {
      return { hw: null, cont: null, maxSeen: null };
    }
  }
  return { hw: cursor, cont: null, maxSeen: null };
}

function serializeCloseCursor(c: CloseCursor): string | null {
  if (c.cont) return JSON.stringify(c);
  return c.maxSeen ?? c.hw;
}

/** Earlier of two provider date strings (by parsed time; unparseable loses). */
function earlierDate(a: string | null, b: string | null): string | null {
  const ta = a ? Date.parse(a) || null : null;
  const tb = b ? Date.parse(b) || null : null;
  if (ta == null) return b;
  if (tb == null) return a;
  return tb < ta ? b : a;
}

/** Later of two provider date strings (by parsed time; unparseable loses). */
function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return (Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a;
}

/** Map Close event log object_type + action to a canonical event type. */
function canonicalType(objectType: string, action: string): string {
  const key = `${objectType}.${action}`;
  const map: Record<string, string> = {
    "activity.sms.created": "sms_sent",
    "activity.call.created": "call",
    "activity.email.created": "email_sent",
    "lead.created": "lead_created",
    "opportunity.created": "opportunity_created",
    "task.completed": "task_completed",
  };
  return map[key] ?? key;
}

/**
 * Close CRM. Instant path: Event Log webhook subscriptions signed as
 * `close-sig-hash = HMAC-SHA256(signatureKey, close-sig-timestamp + body)`.
 * Backfill path: the Event Log list endpoint. Auth: API key as Basic username.
 */
export const closeConnector: Connector = {
  source: "close",
  authType: "apiKey",

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const hash = headers["close-sig-hash"];
    const timestamp = headers["close-sig-timestamp"];
    if (!hash || !timestamp) return false;
    const expected = hmacSha256Hex(secret, `${timestamp}${rawBody}`);
    return safeEqual(hash, expected);
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const event = asObject(body["event"]);
    const objectType = str(event["object_type"]) ?? "object";
    const action = str(event["action"]) ?? "event";
    const naturalId = str(event["id"]) ?? `${str(event["date_created"])}`;
    const data = asObject(event["data"]);
    return [
      {
        eventId: `close:${ctx.connectionId}:${naturalId}`,
        eventType: canonicalType(objectType, action),
        subject:
          str(data["contact_name"]) ??
          str(data["lead_name"]) ??
          str(data["to"]) ??
          str(data["phone"]) ??
          null,
        occurredAt: parseDate(str(event["date_created"])) ?? new Date(),
        properties: event,
      },
    ];
  },

  /**
   * Walk the Event Log window ABOVE the stored high-water mark all the way to
   * its end (Defect #2). The log is newest-first, so the old single-page poll
   * that jumped the cursor to the newest record stranded everything older in a
   * burst > one page — those rows were never queried by anything again. Now:
   * - the window `date_created >= hw - overlap` is paged via the provider's
   *   `cursor_next` until drained (up to PAGES_PER_POLL pages per call);
   * - a deeper window persists its continuation in the cursor and resumes on
   *   the next sweep — nothing is skipped, the sweep just takes another pass;
   * - `hw` only advances once the window is FULLY ingested, and the overlap
   *   re-reads boundary ties (event_id dedup makes that a no-op).
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const key = apiKey_(args.credentials);
    const cur = parseCloseCursor(args.cursor);
    const records: CanonicalEvent[] = [];
    // Close publishes RFC `ratelimit` on EVERY response, so its own account of
    // what is left is available on the way past — no extra request, and no
    // waiting for a 429 to find out.
    let providerCalls = 0;
    let rateLimit: ObservedRateLimit | null = null;

    // The window's lower bound, decided once per walk and never recomputed.
    // A cursor from before this bound existed (`{hw:null, cont:"…"}`, an
    // unbounded walk already in flight) picks one up here, which stops it —
    // deliberately: that walk had no end.
    const floor = cur.hw
      ? new Date((Date.parse(cur.hw) || 0) - OVERLAP_MS)
      : new Date(cur.floor ? Date.parse(cur.floor) || 0 : Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    if (!cur.hw) cur.floor = floor.toISOString();

    for (let page = 0; page < PAGES_PER_POLL; page++) {
      const params = new URLSearchParams({ _limit: String(EVENT_LOG_LIMIT) });
      // Sent on EVERY request now. Omitted on a first sync, this asked for the
      // whole workspace event log and got exactly that.
      params.set("date_created__gte", floor.toISOString());
      if (cur.cont) params.set("_cursor", cur.cont);

      let data: { data: Array<Record<string, unknown>>; cursor_next?: string | null };
      try {
        providerCalls += 1;
        data = await fetchJson(`${API}/event/?${params.toString()}`, {
          headers: { authorization: basicAuth(key) },
          onResponse: (res) => {
            rateLimit = parseRateLimit(res.headers) ?? rateLimit;
          },
        });
      } catch (e) {
        // A dead provider continuation (expired/invalid _cursor) must not wedge
        // the stream forever: drop it and restart the window on the next sweep.
        if (cur.cont && e instanceof HttpError && e.status === 400) {
          return { records, nextCursor: serializeCloseCursor({ ...cur, cont: null }), providerCalls, rateLimit: rateLimit ?? undefined };
        }
        throw e;
      }

      for (const event of data.data) {
        records.push(mapEvent(event, args.connectionId));
        const at = str(event["date_created"]) ?? null;
        cur.maxSeen = laterDate(cur.maxSeen, at);
        cur.minSeen = earlierDate(cur.minSeen ?? null, at);
      }

      const next = data.cursor_next ?? null;
      if (!next || data.data.length === 0) {
        // Window drained: the high-water mark advances to the newest ingested,
        // and the first-sync floor/progress are no longer meaningful.
        return {
          records,
          nextCursor: serializeCloseCursor({ hw: cur.maxSeen ?? cur.hw, cont: null, maxSeen: null }),
          providerCalls,
          rateLimit: rateLimit ?? undefined,
        };
      }
      cur.cont = next;
    }

    // Page budget spent mid-window: persist the continuation (hw unchanged) so
    // the next sweep resumes exactly where this one stopped.
    return {
      records,
      nextCursor: serializeCloseCursor(cur),
      providerCalls,
      rateLimit: rateLimit ?? undefined,
      // There IS more to fetch. Without this the connection-scoped path could
      // not tell a finished import from one that has days left, so the editor
      // showed a climbing number with nothing to explain it.
      incomplete: true,
      importProgress: {
        reachedBack: new Date(cur.minSeen ? Date.parse(cur.minSeen) || floor.getTime() : floor.getTime()),
        targetBack: floor,
      },
    };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const key = apiKey_(args.credentials);
    const params = new URLSearchParams({ _limit: String(Math.min(n, EVENT_LOG_LIMIT)) });
    const data = await fetchJson<{ data: Array<Record<string, unknown>> }>(`${API}/event/?${params.toString()}`, {
      headers: { authorization: basicAuth(key) },
    });
    return data.data.map((event) => mapEvent(event, args.connectionId));
  },

  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const key = apiKey_(args.credentials);
    const res = await fetchJson<{ id: string; signature_key: string }>(`${API}/webhook/`, {
      method: "POST",
      headers: { authorization: basicAuth(key), "content-type": "application/json" },
      body: JSON.stringify({
        url: args.webhookUrl,
        events: [
          { object_type: "activity.sms", action: "created" },
          { object_type: "activity.call", action: "created" },
          { object_type: "activity.email", action: "created" },
          { object_type: "lead", action: "created" },
          { object_type: "opportunity", action: "created" },
        ],
      }),
    });
    return { signingSecret: res.signature_key, externalId: res.id };
  },
};

/** Map one Event Log entry to a canonical event (shared by poll + preview). */
function mapEvent(event: Record<string, unknown>, connectionId: string): CanonicalEvent {
  const objectType = str(event["object_type"]) ?? "object";
  const action = str(event["action"]) ?? "event";
  return {
    eventId: `close:${connectionId}:${str(event["id"])}`,
    eventType: canonicalType(objectType, action),
    subject: null,
    occurredAt: parseDate(str(event["date_created"])) ?? new Date(),
    properties: event,
  };
}

function apiKey_(credentials?: Record<string, unknown> | null): string {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("close: missing API key");
  return key;
}

