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
import { bearerClient, eventId, isoOrNull, requireCredential, timestampedHmacVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * Paddle BILLING (v2 — not Classic). The delivery envelope is nearly our own
 * shape already (`event_id`, `event_type`, `occurred_at`, `data`), and money is
 * a STRING of minor units, so every amount goes through `major()` before it is
 * counted. `details.totals` answers "revenue" three honest ways — total,
 * earnings (total minus Paddle's fee) and subtotal — so `value` is the total
 * the customer was charged and the other two ride in `properties` as `*_major`.
 *
 * Docs read 8 Sep 2026, one fact each:
 * - https://developer.paddle.com/sdks/sandbox — base URLs: live
 *   `https://api.paddle.com`, sandbox `https://sandbox-api.paddle.com`; a
 *   sandbox key ("contains `_sdbx`") against the live URL is a forbidden error,
 *   which is why the environment is a credential field and not a guess.
 * - https://developer.paddle.com/api-reference/about/authentication — "pass
 *   your Paddle API key using the `Authorization` header and the `Bearer`
 *   prefix"; keys are `pdl_live_apikey_…` / `pdl_sdbx_apikey_…`.
 * - https://developer.paddle.com/api-reference/transactions/list-transactions —
 *   `billed_at` "Return entities billed at a specific time… or use `[LT]`,
 *   `[LTE]`, `[GT]`, or `[GTE]` operators"; `order_by` valid fields are
 *   billed_at | created_at | id | updated_at; `status` "Use a comma-separated
 *   list to specify multiple status values"; `per_page` "Maximum: `30`" (the
 *   plan said 200 — THE DOCS WIN, see PAGE); transaction `billed_at` is
 *   "RFC 3339 datetime string of when this transaction was marked as `billed`";
 *   `details.totals.fee` / `.earnings` are "`null` until the transaction is
 *   `completed`".
 * - https://developer.paddle.com/api-reference/about/pagination —
 *   `meta.pagination` = { per_page, next, has_more, estimated_total }; `next`
 *   is a full URL "using the `after` parameter", which is "the Paddle ID of the
 *   last entity in the current page".
 * - https://developer.paddle.com/webhooks/signature-verification —
 *   `Paddle-Signature: ts=1671552777;h1=eb4d0dc…` (SEMICOLON between the pairs),
 *   HMAC-SHA256 in HEX over `{ts}:{raw body}` (COLON), keyed on the
 *   destination's `pdl_ntfset_…` endpoint secret key.
 * - https://developer.paddle.com/webhooks/about/how-webhooks-work — the
 *   envelope is { event_id, event_type, occurred_at, notification_id, data },
 *   `occurred_at` being "RFC 3339 timestamp of when the event occurred".
 * - https://developer.paddle.com/api-reference/events/list-events — "Events
 *   older than 90 days aren't retained." Hence the entry's historyNote — and
 *   hence this connector does NOT poll /events: /transactions has no such wall.
 * - https://developer.paddle.com/api-reference/about/rate-limiting — "An IP
 *   address can make up to 240 requests per minute."
 * - https://developer.paddle.com/api-reference/notification-settings/create-notification-setting —
 *   POST /notification-settings { description, destination, type,
 *   subscribed_events } → data.id (`ntfset_…`) and data.endpoint_secret_key
 *   (`pdl_ntfset_…`, "Used for signature verification").
 * - https://developer.paddle.com/api-reference/notification-settings/delete-notification-setting —
 *   DELETE /notification-settings/{notification_setting_id}.
 * - https://developer.paddle.com/webhooks/adjustments/adjustment-created — the
 *   seven `action` values (credit, refund, chargeback, chargeback_reverse,
 *   chargeback_warning, chargeback_warning_reverse, credit_reverse); only two
 *   of them are money leaving, which is why the mapping reads `action`.
 * - https://developer.paddle.com/webhooks/subscriptions/subscription-canceled —
 *   `canceled_at` "RFC 3339 datetime string of when this subscription was
 *   canceled"; `next_billed_at` becomes null. The FUTURE dates on a
 *   subscription (`next_billed_at`, `current_billing_period.ends_at`) are never
 *   `occurredAt`; they stay in `properties`.
 * - https://developer.paddle.com/concepts/sell/supported-currencies — the
 *   payment-currencies table's Decimals column: CLP, JPY, KRW and VND are 0.
 */
const LIVE = "https://api.paddle.com";
const SANDBOX = "https://sandbox-api.paddle.com";

/**
 * `per_page` maximum is 30 on /transactions — a THIRTIETH of the 200 the plan
 * assumed, so the page budget buys far less history per call than it looks.
 * That is why the walk's page ceiling stays at 20 rather than 3: a first sync
 * of 90 days needs the pages.
 */
const PAGE = 30;
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

/**
 * Currencies with no minor unit, so their amounts are ALREADY major units.
 * Dividing JPY by 100 understates a Japanese customer's revenue by 100x, and
 * nothing downstream could tell.
 */
const ZERO_DECIMAL = new Set(["clp", "jpy", "krw", "vnd"]);

/**
 * Paddle event types we count → our vocabulary, and the exact list handed to
 * `subscribed_events` at registration.
 *
 * `transaction.paid` and `transaction.completed` BOTH map to
 * `payment_succeeded` and both key on the TRANSACTION id, not the event id.
 * They are two moments of one payment (paid = the money arrived; completed =
 * Paddle finished processing and `fee`/`earnings` stop being null), and the
 * poll re-reads that same transaction a third time. Three writes, one row that
 * updates — key any of them on the event id instead and one sale is counted
 * two or three times.
 */
export const PADDLE_EVENT_TYPES: Record<string, string> = {
  "transaction.completed": "payment_succeeded",
  "transaction.paid": "payment_succeeded",
  "adjustment.created": "payment_refunded",
  "subscription.created": "subscription_created",
  "subscription.activated": "subscription_activated",
  "subscription.updated": "subscription_updated",
  "subscription.canceled": "subscription_canceled",
};
const SUBSCRIBED = Object.keys(PADDLE_EVENT_TYPES);

/**
 * The adjustment actions that are money LEAVING. A `credit` reduces what is
 * owed on a manually-billed transaction, a `chargeback_reverse` is a dispute
 * won and the money coming back — calling either a refund would put a negative
 * on a dashboard where a positive belongs, so they wear the neutral
 * `adjustment_created` and carry their `action` in properties.
 */
const REFUND_ACTIONS = new Set(["refund", "chargeback"]);

const api = (c?: Record<string, unknown> | null) =>
  bearerClient(str(c?.["sandbox"])?.trim().toLowerCase() === "yes" ? SANDBOX : LIVE, requireCredential(c, "apiKey", "Paddle"), "Paddle");

/** A Paddle money string (minor units) as major units, honouring zero-decimal currencies. */
function major(minor: unknown, currency: string | null): number | null {
  const raw = typeof minor === "string" ? minor.trim() : typeof minor === "number" ? String(minor) : "";
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return ZERO_DECIMAL.has((currency ?? "").toLowerCase()) ? n : n / 100;
}

/** The recurring price of a subscription: Σ unit_price.amount × quantity, in major units. */
function subscriptionValue(sub: Record<string, unknown>, currency: string | null): number | null {
  const items = Array.isArray(sub["items"]) ? (sub["items"] as unknown[]).map(asObject) : [];
  let minor = 0;
  let counted = 0;
  let itemCurrency: string | null = null;
  for (const it of items) {
    const unit = asObject(asObject(it["price"])["unit_price"]);
    const raw = unit["amount"];
    const amount = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(amount)) continue;
    minor += amount * (Number(it["quantity"] ?? 1) || 1);
    itemCurrency = itemCurrency ?? str(unit["currency_code"]);
    counted += 1;
  }
  // No priced item is "we do not know", not "zero" — a subscription worth 0 and
  // one whose price we failed to read must not read the same on a dashboard.
  return counted ? major(minor, currency ?? itemCurrency) : null;
}

/**
 * One transaction as one canonical event — the shape BOTH paths produce.
 *
 * Dated by `billed_at`, which is also the field the list request bounds with
 * `billed_at[GTE]`: the window and the watermark are the same axis, so no
 * record can sit outside a window that claims to cover it. `created_at` is when
 * the transaction record was opened (a draft can precede the sale by days) and
 * is not that moment.
 */
function transactionEvent(t: Record<string, unknown>, connectionId: string, fallback: Date | null): CanonicalEvent | null {
  const id = str(t["id"]);
  if (!id) return null;
  const totals = asObject(asObject(t["details"])["totals"]);
  const currency = str(t["currency_code"]) ?? str(totals["currency_code"]);
  const occurredAt = parseDate(str(t["billed_at"]), "paddle.billed_at") ?? fallback;
  if (!occurredAt) return null;
  return {
    eventId: eventId("paddle", connectionId, "txn", id),
    eventType: "payment_succeeded",
    subject: str(t["customer_id"]) ?? id,
    occurredAt,
    value: major(totals["total"], currency),
    currency: currency?.toUpperCase() ?? null,
    properties: {
      ...t,
      // The other honest answers to "revenue", pre-divided so a metric never
      // has to know that Paddle sends money as a string of pennies.
      subtotal_major: major(totals["subtotal"], currency),
      tax_major: major(totals["tax"], currency),
      fee_major: major(totals["fee"], currency),
      earnings_major: major(totals["earnings"], currency),
      grand_total_major: major(totals["grand_total"], currency),
    },
  };
}

function envelopeEvent(env: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const eid = str(env["event_id"]);
  const type = str(env["event_type"]);
  const ours = type ? PADDLE_EVENT_TYPES[type] : undefined;
  if (!eid || !type || !ours) return null;
  const data = asObject(env["data"]);
  const occurred = parseDate(str(env["occurred_at"]), "paddle.occurred_at") ?? fallback ?? new Date();

  // Keyed on the transaction, never the delivery — see PADDLE_EVENT_TYPES.
  if (type.startsWith("transaction.")) return transactionEvent(data, connectionId, occurred);

  if (type === "adjustment.created") {
    const action = str(data["action"]);
    const totals = asObject(data["totals"]);
    const currency = str(data["currency_code"]) ?? str(totals["currency_code"]);
    return {
      // One adjustment is one fact and the poll never re-reads it, so the
      // adjustment's own id keys it — a redelivery lands on the same row.
      eventId: eventId("paddle", connectionId, "adj", str(data["id"]) ?? eid),
      eventType: action && REFUND_ACTIONS.has(action) ? ours : "adjustment_created",
      subject: str(data["customer_id"]),
      occurredAt: parseDate(str(data["created_at"]), "paddle.adjustment.created_at") ?? occurred,
      value: major(totals["total"], currency),
      currency: currency?.toUpperCase() ?? null,
      properties: data,
    };
  }

  // subscription.*: four distinct facts about one subscription, so the event id
  // keys them (the subscription id would collapse them onto one row). Paddle
  // redelivers a retry under the same event_id, so dedup still holds.
  const currency = str(data["currency_code"]);
  const at =
    type === "subscription.canceled"
      ? (parseDate(str(data["canceled_at"]), "paddle.canceled_at") ?? occurred)
      : type === "subscription.created"
        ? (parseDate(str(data["created_at"]), "paddle.subscription.created_at") ?? occurred)
        : occurred;
  return {
    eventId: eventId("paddle", connectionId, eid),
    eventType: ours,
    subject: str(data["customer_id"]),
    occurredAt: at,
    value: subscriptionValue(data, currency),
    currency: currency?.toUpperCase() ?? null,
    properties: data,
  };
}

/** The `after` id out of the pagination's own `next` URL; the last row's id is the fallback. */
function afterOf(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    return new URL(next).searchParams.get("after");
  } catch {
    return null;
  }
}

export const paddleConnector: Connector = {
  source: "paddle",
  authType: "apiKey",
  operations: ["transactions.list"] as const,
  operationFor: () => "transactions.list",
  importProgress: walkImportProgress,
  /**
   * NO `retention` declared, deliberately. Paddle forgets EVENTS after 90 days,
   * but this connector reconciles against /transactions, which has no such
   * wall — declaring a 90-day retention here would alarm on a watermark that is
   * still perfectly fetchable. The 90-day fact is stated to the customer as the
   * entry's historyNote, where it is true: a webhook missed by more than 90 days
   * cannot be recovered from the event log.
   */
  /**
   * Tolerance is the house 5 minutes (WEBHOOK_TIMESTAMP_TOLERANCE_MS), not the
   * five seconds Paddle's own SDK helpers default to. Deliberate: ingest is
   * idempotent on eventId, so a wide replay window costs nothing, while a
   * five-second window rejects real deliveries on ordinary queueing or drift.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify(
      { rawBody, headers, secret },
      {
        header: "paddle-signature",
        // `ts=…;h1=…` — a SEMICOLON between the pairs (Stripe's is a comma) and
        // a COLON inside the signed string (Stripe's is a dot). Both wrong by
        // one character rejects 100% of deliveries.
        pairSeparator: ";",
        timestampKey: "ts",
        signatureKey: "h1",
        message: (ts, body) => `${ts}:${body}`,
      },
    );
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const ev = envelopeEvent(asObject(rawPayload), ctx.connectionId, ctx.fallbackOccurredAt);
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
        const page = await client.get<{ data?: unknown[]; meta?: { pagination?: { has_more?: boolean; next?: string } } }>("/transactions", {
          "billed_at[GTE]": since.toISOString(),
          order_by: "billed_at[ASC]",
          per_page: PAGE,
          // Money that has arrived. `paid` is the moment of payment and
          // `completed` the moment Paddle finished with it; both are the same
          // sale and land on the same row. Anything earlier (draft, ready,
          // billed) has no billed_at and would be excluded by the bound anyway.
          status: "completed,paid",
          after: cont ?? undefined,
        });
        const rows = (page.data ?? []).map(asObject);
        const pagination = page.meta?.pagination;
        const last = rows.length ? str(rows[rows.length - 1]["id"]) : null;
        const next = pagination?.has_more ? (afterOf(pagination.next) ?? last) : null;
        return { rows, next, rateLimit: client.rateLimit() };
      },
      // The watermark IS the bound: `billed_at[GTE]` filters on billed_at, so
      // billed_at is what may advance the mark.
      changedAt: (t) => isoOrNull(t["billed_at"]),
      map: (t) => transactionEvent(t, args.connectionId, null),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const res = await api(args.credentials).post<{ data?: { id?: string; endpoint_secret_key?: string } }>("/notification-settings", {
      description: "Namzilabs",
      destination: args.webhookUrl,
      type: "url",
      subscribed_events: SUBSCRIBED,
    });
    return { signingSecret: res.data?.endpoint_secret_key, externalId: res.data?.id };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/notification-settings/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      // Already gone IS the goal — "stop delivering here" is already true.
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
