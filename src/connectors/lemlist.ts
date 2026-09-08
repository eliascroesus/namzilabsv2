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
import { HttpError } from "@/lib/http-client";
import { basicClient, eventId, isoOrNull, requireCredential, sharedTokenVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * lemlist. ONE dated activity feed serves both paths: a webhook delivery IS an
 * activity object (plus the shared secret), and `GET /activities` lists the
 * same objects — so `toCanonical` is written once and `_id` dedupes the two
 * paths against each other.
 *
 * Docs read 8 Sep 2026:
 * - api-reference/getting-started/overview — "All API routes live at
 *   `https://api.lemlist.com/api`."
 * - api-reference/getting-started/authentication — HTTP Basic, username EMPTY,
 *   API key as the password: "THERE IS A COLON before your API key", i.e.
 *   `Authorization: Basic base64(":KEY")`. No header alternative.
 * - api-reference/getting-started/rate-limits — "20 requests per 2 seconds" per
 *   API key, across all routes (= 600/min, what the entry declares).
 *   `X-RateLimit-Limit/-Remaining/-Reset` + `Retry-After`; the RESET is a
 *   human-readable date, so `parseRateLimit` reads remaining and leaves reset
 *   null rather than inventing a number of seconds.
 * - api-reference/getting-started/version — v1 is deprecated but "the default
 *   version in our API is still v1 for *some* endpoints", so `version=v2` is
 *   sent explicitly on every request.
 * - api-reference/endpoints/activities/get-many-activities — GET /activities;
 *   `version` "API version. v2 is mandatory"; `minDate` "Filter activities by
 *   `createdAt >= minDate`" and `maxDate` "`createdAt <= maxDate`" (Unix
 *   seconds or ISO 8601) — so createdAt is BOTH the watermark and the event
 *   time; `limit` default 100, max 100; `offset` "Number of records to skip.
 *   Note: This is not traditional cursor-based pagination. To retrieve all
 *   activities, increment offset by the limit value on each request"; the
 *   response is a bare JSON array of activities.
 * - api-reference/endpoints/webhooks/add-webhook — POST /hooks
 *   { targetUrl, type?, secret? } → { _id, targetUrl, createdAt, type }.
 *   `type` is ONE event type and "When omitted, all events are sent", so the
 *   hook is registered untyped and `normalize` does the selection. The secret
 *   is "Sent back to your endpoint as a `secret` field in the JSON body of
 *   every webhook call so you can verify the request originated from lemlist",
 *   is "immutable once set" and is never returned by GET.
 * - api-reference/endpoints/webhooks/delete-webhook — DELETE /hooks/{hookId};
 *   a missing hook answers 404 "Webhook not found" — already gone IS success.
 *
 * NO HMAC ANYWHERE IN LEMLIST'S OWN DOCS. Third-party integration guides
 * describe an `x-lemlist-signature` header; lemlist's webhook page documents
 * only the echoed `secret` and no delivery headers at all, so that is the
 * scheme implemented — authentication, not body integrity — and the `secret`
 * property is STRIPPED before anything is stored.
 */
const API = "https://api.lemlist.com/api";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
/** `limit`: default 100, maximum 100 (get-many-activities, read 8 Sep 2026). */
const PAGE = 100;

/**
 * The EMAIL activity types only, mapped to the shared outreach vocabulary.
 *
 * lemlist's ActivityType enum carries ~120 values, and three families of them
 * describe the same fact a second time: the LinkedIn/WhatsApp/SMS siblings
 * (`linkedinSent`, `whatsappMessageSent`, `smsSent`…) are other channels of
 * one sequence, and the lead-state groups (`contacted`, `hooked`, `interested`,
 * `notInterested`…) are a lead's rolled-up STATE, emitted alongside the
 * activity that caused it. Counting either beside the email events would make
 * one send read as two. Everything unmapped is dropped, and its raw `type`
 * survives in `properties` for anyone who wants it later.
 *
 * `emailsFailed` shares the `bounced` key: both are non-deliveries, and the
 * provider's own `type` stays in `properties` (and in `commonFields`) so a
 * flow that needs the two apart can split on it.
 */
export const LEMLIST_TYPES: Record<string, string> = {
  emailsSent: "email_sent",
  emailsOpened: "email_opened",
  emailsClicked: "email_clicked",
  emailsReplied: "reply",
  emailsBounced: "bounced",
  emailsFailed: "bounced",
  emailsInterested: "lead_interested",
  emailsUnsubscribed: "unsubscribed",
};

const api = (c?: Record<string, unknown> | null) => basicClient(API, "", requireCredential(c, "apiKey", "lemlist"), "lemlist");

/**
 * One activity → one canonical event, or null when it is a type we do not
 * count, has no id, or carries no `createdAt` to be dated by. `createdAt` is
 * "Timestamp when activity occurred" AND the field `minDate`/`maxDate` filter
 * on, so the watermark and the event time are the same field by construction.
 */
function toCanonical(a: Record<string, unknown>, connectionId: string): CanonicalEvent | null {
  const id = str(a["_id"]) ?? str(a["id"]);
  const ours = LEMLIST_TYPES[str(a["type"]) ?? ""];
  const at = parseDate(str(a["createdAt"]), "createdAt");
  if (!id || !ours || !at) return null;
  // The shared secret is a CREDENTIAL that arrives in the payload. It is
  // verified above and must never reach storage, a field picker, or a log.
  const { secret: _secret, ...rest } = a;
  return {
    eventId: eventId("lemlist", connectionId, id),
    eventType: ours,
    subject: str(a["leadEmail"]) ?? str(a["leadId"]),
    occurredAt: at,
    properties: rest,
  };
}

export const lemlistConnector: Connector = {
  source: "lemlist",
  authType: "apiKey",
  operations: ["activities.list"] as const,
  operationFor: () => "activities.list",
  importProgress: walkImportProgress,
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    // There is no HMAC and no timestamp in the scheme: the token is a field of
    // the body itself, so it is read here and compared in constant time. That
    // authenticates the SENDER and says nothing about the body's integrity —
    // which is why the connector never trusts a payload to name its own
    // connection, and why the secret is minted by us at registration.
    let token: string | null = null;
    try {
      token = str(asObject(JSON.parse(rawBody))["secret"]);
    } catch {
      return false;
    }
    return sharedTokenVerify({ rawBody, headers, secret }, { token });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const ev = toCanonical(asObject(rawPayload), ctx.connectionId);
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    /**
     * The upper bound is pinned at the start of the walk, and that is what
     * makes OFFSET paging safe here: lemlist documents no sort order, so a
     * window still open at its top could shift rows between pages as new
     * activities land (skipping one row per arrival if the feed is
     * newest-first). Bounded on both ends, the page set is fixed whichever way
     * the provider sorts, and the next poll picks the rest up from the mark.
     */
    const maxDate = new Date().toISOString();
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const offset = cont ? Number(cont) || 0 : 0;
        const res = await client.get<unknown>("/activities", {
          version: "v2",
          limit: PAGE,
          offset,
          minDate: since.toISOString(),
          maxDate,
        });
        // Documented as a bare array; anything else is treated as no rows
        // rather than guessed at.
        const rows = Array.isArray(res) ? res.map(asObject) : [];
        return { rows, next: rows.length === PAGE ? String(offset + PAGE) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (a) => isoOrNull(a["createdAt"]),
      map: (a) => toCanonical(a, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    // OURS, not theirs: lemlist mints nothing and stores what we send
    // ("immutable once set", never readable back), so the only way this
    // connection can ever have a secret is for us to generate one here.
    const secret = randomBytes(24).toString("base64url");
    // No `type`: a hook subscribes to ONE type, and "When omitted, all events
    // are sent" — one hook, filtered by LEMLIST_TYPES, beats eight hooks.
    const res = await api(args.credentials).post<{ _id?: string }>("/hooks", { targetUrl: args.webhookUrl, secret });
    return { signingSecret: secret, externalId: res._id };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/hooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      // 404 "Webhook not found": the goal — stop delivering here — is true.
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
