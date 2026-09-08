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
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, providerClient, requireCredential, walkImportProgress, windowedWalk } from "./kit";

/**
 * Thinkific. Commerce and learning arrive as signed webhooks, each one a past
 * fact carrying its own timestamp; orders are ALSO listable, so they are the
 * one resource a poll can reconcile.
 *
 * THE ORDERS LIST HAS NO TIME FILTER. `GET /orders` takes `page` and `limit`
 * and nothing else, so the window is applied CLIENT-side on `created_at` —
 * which keeps the watermark rule honest (the walk bounds and advances on the
 * same field), but leaves the walk depending on the list being newest-first.
 * The docs never say it is. So the stop rule is the weakest one that works:
 * keep every row inside the window, and stop at the first page where NOTHING
 * is inside it — not at the first page that merely CONTAINS an older row,
 * which a single out-of-order row would truncate. If the list ever turns out
 * to be oldest-first, page 1 is all-older and this reads nothing at all:
 * under-read, never mis-read. `scripts/verify-thinkific.ts` prints the first
 * and last `created_at` of page 1 so one live key settles it, and
 * `verified.live` stays null until it does.
 *
 * Docs read 8 Sep 2026:
 * - https://developers.thinkific.com/api/api-documentation — "The base address
 *   of the Admin API is https://api.thinkific.com/api/public/v1".
 * - https://developers.thinkific.com/openapi/thinkific-admin-api-v1.yaml —
 *   `GET /orders` parameters are exactly `page` and `limit`: no date filter, no
 *   sort. OrderResponse: id, user_id, user_email, user_name, product_name,
 *   product_id, amount_cents (number), amount_dollars ("The Order amount in
 *   dollars", typed string), subscription, coupon_code, items[], status — and
 *   NO currency. Its date property is spelled "created at" in that one schema,
 *   a typo unique to it (every other schema says created_at); both keys are
 *   read here, and the prober prints which one the API actually sends.
 * - https://support.thinkific.dev/hc/en-us/articles/4422657425431 (Authorization
 *   using API Key) — headers `X-Auth-API-Key` + `X-Auth-Subdomain`; a 401 also
 *   means "this site's plan does not allow API access" (Grow/Pro + Growth up).
 * - https://support.thinkific.dev/hc/en-us/articles/4422657182743 (REST API
 *   Response Format) — `{ items, meta: { pagination: { current_page, next_page,
 *   prev_page, total_pages, total_items } } }`; `limit` defaults to 25, max 250.
 * - https://support.thinkific.dev/hc/en-us/articles/4422684774935 (REST API Rate
 *   Limits) — "REST API requests are limited to 120 requests per minute", and a
 *   maximum of 10 concurrent requests.
 * - https://support.thinkific.dev/hc/en-us/articles/4422685850775 (Using Webhooks)
 *   — a "hexadecimal-encoded X-Thinkific-Hmac-Sha256 header" over the raw body,
 *   keyed on the site's API key (or an app's client secret), verified in their
 *   own sample with `OpenSSL::HMAC.hexdigest`. No timestamp rides in the scheme,
 *   so there is no staleness check to make. Only webhooks CREATED THROUGH THE
 *   API are documented as verifiable — hence autoWebhook, rather than asking a
 *   customer to hand-make one in the admin UI that may arrive unsigned.
 * - https://support.thinkific.dev/hc/en-us/articles/4422658311703 (Webhooks
 *   Documentation) — envelope `{ id, resource, action, tenant_id, created_at,
 *   timestamp, payload }`, and the payload examples this module's dating
 *   follows. Two traps live in there: the subscription example's `action` is
 *   "canceled" though its topic is `subscription.cancelled` (both spellings are
 *   accepted below), and an order_transaction payload's own `created_at` is the
 *   TRANSACTION's, so a refund dated by it would land on the original purchase.
 * - https://developers.thinkific.com/api/webhooks-api/ — Webhooks API base
 *   "https://api.thinkific.com/api/v2" with `Authorization: Bearer <api key>`;
 *   POST /webhooks { topic, target_url } → { id }, DELETE /webhooks/{id}. (The
 *   published openapi/thinkific-webhooks-v2.yaml still lists an older
 *   `platform.thinkific.com` server; the reference page's base is used.)
 * - https://developers.thinkific.com/changelog/payments-webhooks — the
 *   transaction and subscription topics "won't be triggered for customers using
 *   Stripe Payments or Paypal", which is what the entry's syncNote says.
 */
const API = "https://api.thinkific.com/api/public/v1";
const WEBHOOKS_API = "https://api.thinkific.com/api/v2";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 250;

/** The topics registerWebhook subscribes to — every one this module maps. */
export const THINKIFIC_TOPICS = [
  "order.created",
  "order_transaction.succeeded",
  "order_transaction.refunded",
  "subscription.cancelled",
  "enrollment.created",
  "enrollment.completed",
  "user.signup",
  "lead.created",
] as const;

const api = (c?: Record<string, unknown> | null) =>
  providerClient({
    baseUrl: API,
    provider: "Thinkific",
    headers: {
      "x-auth-api-key": requireCredential(c, "apiKey", "Thinkific"),
      "x-auth-subdomain": requireCredential(c, "subdomain", "Thinkific"),
    },
    reconnectHint:
      "Thinkific rejected this API key — open the connection and reconnect, and check the site is on Grow/Pro + Growth or above (API access is plan-gated).",
  });

const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : str(v));

const numeric = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The Admin API's order schema spells its date "created at"; every payload sends created_at. */
const createdAt = (o: Record<string, unknown>): unknown => o["created_at"] ?? o["created at"];

/**
 * Money in MAJOR units. `amount_dollars` is Thinkific's own major-unit figure
 * (a number in webhooks, a string in the Admin API), so it is preferred over
 * dividing `amount_cents` — which would be wrong on a zero-decimal currency.
 * The order carries no currency of its own: `presentment_currency` describes
 * the buyer-facing `presentment_amount`, NOT `amount_dollars`, so pairing them
 * would state a figure in a currency it is not in. It stays in properties.
 */
function money(o: Record<string, unknown>): number | null {
  const major = numeric(o["amount_dollars"]);
  if (major != null) return major;
  const cents = numeric(o["amount_cents"]);
  return cents == null ? null : cents / 100;
}

/** The buyer, wherever this payload keeps them — a transaction nests the order. */
function emailOf(p: Record<string, unknown>): string | null {
  return str(asObject(p["user"])["email"]) ?? str(p["user_email"]) ?? str(p["email"]) ?? str(asObject(asObject(p["order"])["user"])["email"]);
}

/**
 * One webhook payload (or one listed order) → one canonical event.
 *
 * `envelopeAt` is the delivery's own `created_at`: the moment the event fired.
 * It is the fallback everywhere, and the ANSWER wherever the payload's own
 * `created_at` describes something other than the fact being recorded — a
 * refund's payload dates the original charge, a cancellation's dates the start
 * of the subscription. Undated with no envelope (a listed order missing
 * created_at) returns null rather than being stamped with the import moment.
 */
function topicEvent(resource: string, action: string, p: Record<string, unknown>, connectionId: string, envelopeAt?: Date): CanonicalEvent | null {
  const id = idOf(p["id"]);
  if (!id) return null;
  const created = parseDate(str(createdAt(p)), "created_at");
  const order = asObject(p["order"]);
  const subject = emailOf(p);
  const currency = str(p["currency"])?.toUpperCase() ?? null;
  const ev = (
    parts: Array<string | number>,
    eventType: string,
    occurredAt: Date | null,
    extra: { value?: number | null; currency?: string | null } = {},
  ): CanonicalEvent | null =>
    occurredAt
      ? {
          eventId: eventId("thinkific", connectionId, ...parts),
          eventType,
          subject,
          occurredAt,
          value: extra.value ?? null,
          currency: extra.currency ?? null,
          properties: p,
        }
      : null;

  switch (`${resource}.${action}`) {
    case "order.created":
      return ev(["order", id], "order_created", created ?? envelopeAt ?? null, { value: money(p) });
    case "order_transaction.succeeded":
      // The transaction's own `amount` has no documented unit; the order it
      // belongs to states both cents and dollars, so the charge is valued from
      // there and the raw figures stay in properties.
      return ev(["transaction", id], "payment_succeeded", created ?? envelopeAt ?? null, { value: money(order), currency });
    case "order_transaction.refunded":
      // Dated by the DELIVERY: the payload's created_at is the original charge.
      return ev(["transaction", id, "refunded"], "payment_refunded", envelopeAt ?? created ?? null, { value: money(order), currency });
    case "subscription.cancelled":
    case "subscription.canceled":
      // `cancelled_at` is when it ended; `scheduled_cancellation_at` is a future
      // date and stays in properties, where a forecast belongs.
      return ev(["subscription", id, "canceled"], "subscription_canceled", parseDate(str(p["cancelled_at"]), "cancelled_at") ?? envelopeAt ?? null);
    case "enrollment.created":
      return ev(["enrollment", id], "enrollment_created", created ?? envelopeAt ?? null);
    case "enrollment.completed":
      return ev(["enrollment", id, "completed"], "enrollment_completed", parseDate(str(p["completed_at"]), "completed_at") ?? envelopeAt ?? null);
    case "user.signup":
      return ev(["user", id], "user_signup", created ?? envelopeAt ?? null);
    case "lead.created":
      return ev(["lead", id], "lead_created", created ?? envelopeAt ?? null);
    default:
      return null;
  }
}

export const thinkificConnector: Connector = {
  source: "thinkific",
  authType: "apiKey",
  operations: ["orders.list"] as const,
  operationFor: () => "orders.list",
  importProgress: walkImportProgress,
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-thinkific-hmac-sha256", encoding: "hex" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const envelope = asObject(rawPayload);
    const ev = topicEvent(
      str(envelope["resource"]) ?? "",
      str(envelope["action"]) ?? "",
      asObject(envelope["payload"]),
      ctx.connectionId,
      parseDate(str(envelope["created_at"]), "created_at") ?? ctx.fallbackOccurredAt,
    );
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = Number(cont) || 1;
        const res = await client.get<{ items?: unknown[]; meta?: unknown }>("/orders", { page, limit: PAGE });
        const all = (res.items ?? []).map(asObject);
        const rows = all.filter((o) => {
          const ms = Date.parse(str(createdAt(o)) ?? "");
          return Number.isFinite(ms) && ms >= since.getTime();
        });
        const pagination = asObject(asObject(res.meta)["pagination"]);
        const nextPage = numeric(pagination["next_page"]) ?? (page < (numeric(pagination["total_pages"]) ?? 1) ? page + 1 : null);
        // A page with nothing in the window ends the walk: windowedWalk settles
        // on an empty page, which is exactly the stop rule this list needs.
        return { rows, next: rows.length > 0 && nextPage != null ? String(nextPage) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (o) => isoOrNull(createdAt(o)),
      map: (o) => topicEvent("order", "created", o, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const key = requireCredential(args.credentials, "apiKey", "Thinkific");
    const hooks = bearerClient(WEBHOOKS_API, key, "Thinkific");
    const ids: string[] = [];
    for (const topic of THINKIFIC_TOPICS) {
      const res = await hooks.post<{ id?: string | number }>("/webhooks", { topic, target_url: args.webhookUrl });
      const id = idOf(res.id);
      if (id) ids.push(id);
    }
    // Thinkific signs with the site API key itself — there is no per-hook secret to mint.
    return { signingSecret: key, externalId: ids.join(",") };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    const hooks = bearerClient(WEBHOOKS_API, requireCredential(args.credentials, "apiKey", "Thinkific"), "Thinkific");
    for (const id of args.externalId.split(",").map((s) => s.trim()).filter(Boolean)) {
      try {
        await hooks.del(`/webhooks/${encodeURIComponent(id)}`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) continue; // already gone is success
        throw e;
      }
    }
  },
};
