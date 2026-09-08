import { randomBytes } from "node:crypto";
import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  RegisterWebhookArgs,
  RegisterWebhookResult,
  UnregisterWebhookArgs,
} from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { fetchJson, HttpError } from "@/lib/http-client";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, walkImportProgress, windowedWalk } from "./kit";

/**
 * Help Scout (Mailbox API v2). A conversation carries createdAt and closedAt;
 * its threads say who wrote and when, so "customer replied" / "agent replied"
 * — and therefore first-response time — fall out of the data with no
 * heuristics.
 *
 * Docs read 8 Sep 2026:
 * - https://developer.helpscout.com/mailbox-api/overview/authentication/ —
 *   client-credentials flow: `curl -X POST https://api.helpscout.net/v2/oauth2/token
 *   --data "grant_type=client_credentials" --data "client_id=…" --data
 *   "client_secret=…"` → `{"token_type":"bearer","access_token":…,"expires_in":172800}`,
 *   "valid for 2 days". FORM-ENCODED, not JSON — the plan said JSON, the docs win.
 * - https://developer.helpscout.com/mailbox-api/endpoints/conversations/list/ —
 *   GET /v2/conversations; `modifiedSince` "Filters conversations modified after
 *   this timestamp"; `status` defaults to `active`, so `all` is stated;
 *   `sortField=modifiedAt` + `sortOrder=asc`; `page`; the envelope is
 *   `{_embedded:{conversations:[…]}, page:{number,size,totalElements,totalPages}}`
 *   with a page size of 25.
 * - https://developer.helpscout.com/mailbox-api/endpoints/conversations/get/ —
 *   the conversation object. THERE IS NO `modifiedAt` OR `updatedAt` FIELD: the
 *   timestamps are `createdAt`, `closedAt`, `userUpdatedAt` ("UTC time when the
 *   last user update occurred; equal to customerWaitingSince if no user action
 *   since last customer action") and `customerWaitingSince` (`{time, friendly}`).
 *   So the watermark is the NEWEST of those four (see `modifiedAt` below): each
 *   one is a moment the conversation was modified, so their maximum can only
 *   LAG the field `modifiedSince` bounds, never lead it. Lagging costs a re-read
 *   that dedup by eventId absorbs; leading would strand a record, which is the
 *   one thing the watermark rule forbids.
 * - https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/list/ —
 *   GET /v2/conversations/{id}/threads; thread `type` ∈ customer, message, note,
 *   lineitem, phone, chat, beaconchat, forwardparent, forwardchild ("lineitem
 *   represents a change of state on the conversation"); `state` ∈ published,
 *   draft, bounced, hidden, review.
 * - https://developer.helpscout.com/webhooks/ — `X-HelpScout-Signature` is the
 *   base64 HMAC-**SHA1** of "the raw request body passed to your servers by Help
 *   Scout", keyed on the webhook secret; `X-HelpScout-Event` names the event;
 *   convo.created, convo.customer.reply.created, convo.agent.reply.created,
 *   convo.status and convo.assigned all exist. No timestamp in the scheme, so
 *   there is no replay window to check.
 * - https://developer.helpscout.com/mailbox-api/endpoints/webhooks/create/ —
 *   POST /v2/webhooks { url, events, secret ("a randomly-generated (by you)
 *   string of 40 characters or less"), payloadVersion V2|V3, label } → 201 with
 *   the new id in the `Resource-ID` RESPONSE HEADER (nothing in the body).
 *   .../webhooks/delete/ — DELETE /v2/webhooks/{id} → 204.
 * - https://developer.helpscout.com/mailbox-api/overview/rate-limiting/ — "Your
 *   current rate limit depends on your plan"; headers `X-RateLimit-Limit-Minute`,
 *   `X-RateLimit-Remaining-Minute`, `X-RateLimit-Retry-After`; "Write requests
 *   (POST, PUT, DELETE, PATCH) count as 2 requests toward the rate limit." The
 *   plan numbers live one link away, in docs.helpscout.com/article/1140-mailbox-api
 *   (read 8 Sep 2026): Standard "Up to 200 calls per minute", Plus 400, Pro 800.
 */
const API = "https://api.helpscout.net";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 30, overlapMs: 5 * 60_000 };
/** Help Scout's fixed page size, and therefore the threads calls one page costs. */
const PAGE = 25;
/** The token exchange is a request to the provider like any other; poll counts it. */
const TOKEN_CALLS = 1;

/** The subscription we create. Every one is documented on developer.helpscout.com/webhooks. */
export const HELPSCOUT_EVENTS = [
  "convo.created",
  "convo.customer.reply.created",
  "convo.agent.reply.created",
  "convo.status",
  "convo.assigned",
] as const;

/** OAuth2 client credentials → a 2-day bearer token. Form-encoded, per the auth doc. */
async function accessToken(credentials?: Record<string, unknown> | null): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: requireCredential(credentials, "appId", "Help Scout"),
    client_secret: requireCredential(credentials, "appSecret", "Help Scout"),
  });
  const res = await fetchJson<{ access_token?: string }>(`${API}/v2/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const token = str(res?.access_token);
  if (!token) throw new Error("Help Scout rejected the app credentials — open the connection and reconnect.");
  return token;
}

const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : str(v));
const customerEmail = (c: Record<string, unknown>): string | null => str(asObject(c["primaryCustomer"])["email"]);
/** `customerWaitingSince` is `{time, friendly}` in the API and a bare string in some payloads. */
const timeOf = (v: unknown): string | null => (typeof v === "string" ? isoOrNull(v) : isoOrNull(asObject(v)["time"]));

function latest(...values: Array<string | null>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = v;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * THE WATERMARK. `modifiedSince` filters on a modification time the object
 * never exposes, so this is the newest modification Help Scout does show. It
 * can only sit at or behind the true value — see the header comment.
 */
const modifiedAt = (c: Record<string, unknown>): string | null =>
  latest(isoOrNull(c["userUpdatedAt"]), timeOf(c["customerWaitingSince"]), isoOrNull(c["closedAt"]), isoOrNull(c["createdAt"]));

/** HAL `_links` is a wall of hrefs nobody can build anything from. */
function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out = { ...o };
  delete out["_links"];
  return out;
}

const threadsOf = (c: Record<string, unknown>): Array<Record<string, unknown>> => {
  const embedded = asObject(c["_embedded"])["threads"];
  return Array.isArray(embedded) ? embedded.map(asObject) : [];
};

/**
 * Which of our two reply types this thread is, or null when it is not a message
 * at all — a `note` is internal, a `lineitem` "represents a change of state on
 * the conversation", and a draft or hidden thread was never sent.
 */
function threadKind(t: Record<string, unknown>): "customer_replied" | "agent_replied" | null {
  const state = str(t["state"]);
  if (state === "draft" || state === "hidden") return null;
  const type = str(t["type"]);
  if (type === "customer") return "customer_replied";
  if (type === "message") return "agent_replied";
  // chat / phone / beaconchat can be written by either side; `source.via` and
  // `createdBy.type` both say which.
  if (type === "chat" || type === "phone" || type === "beaconchat") {
    const via = str(asObject(t["source"])["via"]) ?? str(asObject(t["createdBy"])["type"]);
    return via === "customer" ? "customer_replied" : "agent_replied";
  }
  return null;
}

function threadEvent(c: Record<string, unknown>, t: Record<string, unknown>, connectionId: string): CanonicalEvent | null {
  const cid = idOf(c["id"]);
  const tid = idOf(t["id"]);
  const at = parseDate(str(t["createdAt"]), "createdAt");
  const kind = threadKind(t);
  if (!cid || !tid || !at || !kind) return null;
  const by = asObject(t["createdBy"]);
  return {
    eventId: eventId("helpscout", connectionId, cid, "thread", tid),
    eventType: kind,
    subject: str(by["email"]) ?? (kind === "customer_replied" ? customerEmail(c) : null),
    occurredAt: at,
    properties: {
      ...clean(t),
      conversation_id: cid,
      conversation_subject: str(c["subject"]),
      conversation_status: str(c["status"]),
      mailbox_id: idOf(c["mailboxId"]),
    },
  };
}

/**
 * Which conversation-level facts to emit. `created` / `closed` / `assigned` are
 * the webhook's answers (the delivery names the fact); `all` is the poll's, and
 * deliberately excludes `assigned` — see the connector's `poll`.
 */
function conversationEvents(c: Record<string, unknown>, connectionId: string, which: "created" | "closed" | "assigned" | "all"): CanonicalEvent[] {
  const cid = idOf(c["id"]);
  if (!cid) return [];
  const base = eventId("helpscout", connectionId, cid);
  const props = clean(c);
  const out: CanonicalEvent[] = [];

  const created = parseDate(str(c["createdAt"]), "createdAt");
  if ((which === "created" || which === "all") && created) {
    out.push({ eventId: base, eventType: "conversation_created", subject: customerEmail(c), occurredAt: created, properties: props });
  }

  // A closed conversation without closedAt (older records) is dated by the last
  // user action, which is the close. `status` is what makes it a closure.
  const closed = parseDate(str(c["closedAt"]), "closedAt") ?? parseDate(str(c["userUpdatedAt"]), "userUpdatedAt");
  if ((which === "closed" || which === "all") && c["status"] === "closed" && closed) {
    out.push({ eventId: `${base}:closed`, eventType: "conversation_closed", subject: customerEmail(c), occurredAt: closed, properties: props });
  }

  const assignee = str(asObject(c["assignee"])["email"]);
  const assignedAt = parseDate(str(c["userUpdatedAt"]), "userUpdatedAt");
  if (which === "assigned" && assignee && assignedAt) {
    out.push({ eventId: `${base}:assigned:${assignee}`, eventType: "conversation_assigned", subject: assignee, occurredAt: assignedAt, properties: props });
  }
  return out;
}

/** The newest thread of one kind — what a reply delivery is announcing. */
function newestOfKind(c: Record<string, unknown>, kind: "customer_replied" | "agent_replied", connectionId: string): CanonicalEvent | null {
  let best: CanonicalEvent | null = null;
  for (const t of threadsOf(c)) {
    const ev = threadEvent(c, t, connectionId);
    if (!ev || ev.eventType !== kind) continue;
    if (!best || ev.occurredAt.getTime() > best.occurredAt.getTime()) best = ev;
  }
  return best;
}

export const helpscoutConnector: Connector = {
  source: "helpscout",
  authType: "apiKey",
  operations: ["conversations.list"] as const,
  // Help Scout charges ONE per-plan bucket across every endpoint, so the threads
  // reads are counted into the same operation rather than attributed away.
  operationFor: () => "conversations.list",
  importProgress: walkImportProgress,
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-helpscout-signature", encoding: "base64", algorithm: "sha1" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const c = asObject(rawPayload);
    // V2 deliveries are the bare object; the event name lives in the header.
    const event = ctx.headers?.["x-helpscout-event"] ?? "";
    if (event === "convo.created") return conversationEvents(c, ctx.connectionId, "created");
    if (event === "convo.status") return conversationEvents(c, ctx.connectionId, "closed");
    if (event === "convo.assigned") return conversationEvents(c, ctx.connectionId, "assigned");
    if (event === "convo.customer.reply.created" || event === "convo.agent.reply.created") {
      // The delivery ASSERTS a reply, so no opening-message filter here (the
      // poll has to infer it; see below). Newest of the named kind, because the
      // payload may embed the whole thread history in an unspecified order.
      const kind = event === "convo.customer.reply.created" ? "customer_replied" : "agent_replied";
      const ev = newestOfKind(c, kind, ctx.connectionId);
      return ev ? [ev] : [];
    }
    return [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const api = bearerClient(API, await accessToken(args.credentials), "Help Scout");
    // One page costs 1 + up to PAGE threads calls, so a budget counted in CALLS
    // has to be divided down before it is spent as PAGES — otherwise a ceiling
    // of 10 calls authorises 260.
    const budget = args.budget ? { ...args.budget, maxCalls: Math.max(1, Math.floor(args.budget.maxCalls / (PAGE + 1))) } : undefined;
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = cont ? Number(cont) || 1 : 1;
        const body = await api.get<{ _embedded?: { conversations?: unknown[] }; page?: { totalPages?: number } }>("/v2/conversations", {
          status: "all",
          // The docs' own example is second-precision (2018-05-04T12:00:03Z).
          modifiedSince: since.toISOString().replace(/\.\d{3}Z$/, "Z"),
          sortField: "modifiedAt",
          sortOrder: "asc",
          page,
        });
        const rows = (body._embedded?.conversations ?? []).map(asObject);
        // Threads are the conversation's timeline and the list endpoint does not
        // carry them; one extra call per conversation, counted below.
        for (const c of rows) {
          const cid = idOf(c["id"]);
          if (!cid) continue;
          try {
            const th = await api.get<{ _embedded?: { threads?: unknown[] } }>(`/v2/conversations/${encodeURIComponent(cid)}/threads`);
            c["_embedded"] = { threads: th._embedded?.threads ?? [] };
          } catch (e) {
            // A conversation listed but no longer readable must not wedge the
            // walk on this page forever; take it without its timeline.
            if (!(e instanceof HttpError && e.status === 404)) throw e;
            c["_embedded"] = { threads: [] };
          }
        }
        const more = page < (body.page?.totalPages ?? 1);
        // Null today: the kit reads `X-RateLimit-Remaining`, and Help Scout's
        // header is `X-RateLimit-Remaining-Minute`. The declared budget governs.
        return { rows, next: more ? String(page + 1) : null, rateLimit: api.rateLimit() };
      },
      changedAt: modifiedAt,
      happenedAt: (c) => isoOrNull(c["createdAt"]),
      map: (c) => conversationEvents(c, args.connectionId, "created")[0] ?? null,
    });

    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) {
      const c = r.properties ?? {};
      fanned.push(...conversationEvents(c, args.connectionId, "all"));
      // The conversation's OPENING message is already counted as
      // conversation_created; counting it again as a reply would inflate every
      // reply metric and would disagree with the webhook path, which never
      // sends one. Every genuine reply is strictly after the creation moment.
      const openedAt = Date.parse(str(c["createdAt"]) ?? "");
      for (const t of threadsOf(c)) {
        const ev = threadEvent(c, t, args.connectionId);
        if (!ev) continue;
        if (Number.isFinite(openedAt) && ev.occurredAt.getTime() <= openedAt) continue;
        fanned.push(ev);
      }
    }
    // `conversation_assigned` is deliberately absent from the poll: nothing in a
    // conversation says WHEN it was assigned — `userUpdatedAt` is the last user
    // action of any kind — so a polled assignment would be dated by whatever the
    // agent last did. The webhook names the fact and carries the moment.
    return { ...res, records: fanned, providerCalls: TOKEN_CALLS + api.calls() };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: PAGE + 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    // "40 characters or less" — 24 random bytes is 32 base64url characters.
    const secret = randomBytes(24).toString("base64url");
    let resourceId: string | undefined;
    // The created id comes back ONLY in a response header, so the client's
    // onResponse hook is the only place it can be read.
    const api = bearerClient(API, await accessToken(args.credentials), "Help Scout", {}, {
      onResponse: (res) => {
        resourceId = res.headers?.get?.("resource-id") ?? resourceId;
      },
    });
    await api.post("/v2/webhooks", {
      url: args.webhookUrl,
      events: [...HELPSCOUT_EVENTS],
      secret,
      payloadVersion: "V2",
      label: "Namzilabs",
    });
    return { signingSecret: secret, externalId: resourceId };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    const api = bearerClient(API, await accessToken(args.credentials), "Help Scout");
    try {
      await api.del(`/v2/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return; // already gone is success
      throw e;
    }
  },
};
