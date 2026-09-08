import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { epochToDate, eventId, sharedTokenVerify } from "./kit";

/**
 * ThriveCart. Webhook-only: there is no order-list endpoint on the public API,
 * so a delivery is the only door and history starts at connect. Every delivery
 * is a dated money event; the account's order-validation secret rides IN THE
 * BODY (there is no HMAC and no signature header at all), so it is compared in
 * constant time and stripped before anything is stored.
 *
 * Docs read 8 Sep 2026:
 * - https://support.thrivecart.com/help/using-webhook-notifications/ — the
 *   account webhook. "Webhooks are `x-www-form-urlencoded`" with PHP bracket
 *   nesting (`customer[email]`, `order[charges][0][name]`), NOT JSON — hence
 *   `decodeBody` below. Events: order.success, order.refund, cart.abandoned,
 *   order.subscription_payment, order.subscription_cancelled,
 *   order.subscription_paused, order.subscription_resumed, order.rebill_failed,
 *   affiliate.commission_earned/payout/refund. `thrivecart_secret` "will match
 *   up with the 'Secret word' … under your Account → Settings > API & Webhooks
 *   > ThriveCart order validation area", and you "hard-code this at your end …
 *   to ensure nobody else is posting to your URL". Top-level keys: event, mode,
 *   mode_int, thrivecart_account, thrivecart_secret, base_product, order_id,
 *   invoice_id, order_date, order_timestamp, currency, customer_id,
 *   customer_identifier, customer, order, purchases, purchase_map,
 *   purchase_map_flat, fulfillment, transactions, subscriptions. Price fields
 *   are in minor units ("$14.99" transmits as 1499).
 * - https://developers.thrivecart.com/documentation/event_subscription/intro/ —
 *   the newer Event Subscription API, which "always receive[s] JSON" and uses
 *   UNDERSCORED event keys (order_created, order_rebill, order_rebill_failed,
 *   order_rebill_cancelled, order_refund_product/bump/upsell/downsell,
 *   subscription_paused, subscription_resumed, cart_abandoned,
 *   affiliate_commission_earned …). Both families are mapped, because a
 *   customer may be on either and the payload body is otherwise the same.
 * - https://developers.thrivecart.com/documentation/event_subscription/order_refund_product/
 *   and .../cart_abandoned/ — `mode_int` is "1 for test mode only, 2 for live
 *   mode only". THE PLAN SAID mode_int 0 MEANS TEST; the docs say 1, and the
 *   docs win. See `isLive`.
 * - https://developers.thrivecart.com/documentation/intro/index/ — "your use of
 *   the API will be rate limited to 60 requests per minute, per account that
 *   you are connected to". Cited on the catalog entry; this connector makes no
 *   provider calls at all, so it never spends it.
 *
 * UNCONFIRMED, and therefore failed closed rather than guessed: no page
 * documents an example payload for the affiliate events, so the commission
 * AMOUNT has no field name we can name — `commission_earned` carries the whole
 * payload in `properties` and a null `value` instead of an invented one.
 */

/**
 * Provider event name → our vocabulary. Both name families, one map.
 *
 * ONE EVENT PER BUSINESS FACT, the same rule Stripe's connector follows. The
 * Event Subscription API also emits `order_payment_product|bump|upsell|downsell`
 * per line item alongside `order_created`, which "will trigger once per order" —
 * counting both would count one order's revenue twice, so only the once-per-order
 * event is mapped. `order_rebill_completed` (the subscription reached its final
 * payment), `affiliate_approved`, `affiliate_rejected`,
 * `affiliate_commission_payout` and `affiliate_commission_refund` are documented
 * and deliberately unmapped: none is a sale, and an unmapped event is dropped
 * rather than stored under a guessed meaning.
 */
export const THRIVECART_EVENTS: Record<string, string> = {
  // Account webhooks (form-encoded, dotted names).
  "order.success": "order_created",
  "order.subscription_payment": "rebill",
  "order.rebill_failed": "rebill_failed",
  "order.refund": "payment_refunded",
  "order.subscription_cancelled": "subscription_canceled",
  "order.subscription_paused": "subscription_paused",
  "order.subscription_resumed": "subscription_resumed",
  "cart.abandoned": "cart_abandoned",
  "affiliate.commission_earned": "commission_earned",
  // Event Subscription API (JSON, underscored names).
  order_created: "order_created",
  order_rebill: "rebill",
  order_rebill_failed: "rebill_failed",
  order_rebill_cancelled: "subscription_canceled",
  order_refund: "payment_refunded",
  order_refund_product: "payment_refunded",
  order_refund_bump: "payment_refunded",
  order_refund_upsell: "payment_refunded",
  order_refund_downsell: "payment_refunded",
  subscription_paused: "subscription_paused",
  subscription_resumed: "subscription_resumed",
  cart_abandoned: "cart_abandoned",
  affiliate_commission_earned: "commission_earned",
};

/** The events whose payload total IS the money that moved. */
const MONEY_EVENTS = new Set(["order_created", "rebill", "rebill_failed", "payment_refunded"]);

/**
 * Zero-decimal currencies, as Stripe lists them. ThriveCart documents only
 * that "price fields are in hundreds" and says nothing about currencies that
 * have no minor unit; house style governs (`docs/ADDING_A_CONNECTOR.md`), and
 * the processors underneath ThriveCart use this same convention.
 */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** A string or a number as a string — form values arrive as strings, JSON's as numbers. */
function text(v: unknown): string | null {
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** `customer[email]` → ["customer","email"]; `order[charges][0][name]` → ["order","charges","0","name"]. */
function keyPath(key: string): string[] {
  const head = key.indexOf("[");
  if (head < 0) return [key];
  const path = [key.slice(0, head)];
  for (const m of key.slice(head).matchAll(/\[([^\]]*)\]/g)) path.push(m[1]);
  return path;
}

function assignPath(root: Record<string, unknown>, path: string[], value: string): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const next = node[seg];
    if (!next || typeof next !== "object") node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

/**
 * `{ "0": …, "1": … }` → `[…, …]`, recursively.
 *
 * The two doors must produce the SAME `properties`: the Event Subscription API
 * sends `order.charges` as a JSON array, and the account webhook sends the same
 * data as `order[charges][0][…]`. Without this, one customer's flow would read
 * `order.charges.0.name` and another's `order.charges[0].name` for one field.
 */
function compact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = compact(obj[k]);
  const isList = keys.length > 0 && keys.every((k, i) => k === String(i));
  return isList ? keys.map((k) => out[k]) : out;
}

/** URL-encoded form body → the nested object its PHP bracket keys describe. */
function decodeForm(raw: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!key) continue;
    any = true;
    assignPath(out, keyPath(key), value);
  }
  return any ? asObject(compact(out)) : null;
}

/** A delivery body in either encoding — JSON first, then `x-www-form-urlencoded`. */
function decodeBody(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return asObject(JSON.parse(trimmed));
    } catch {
      return {};
    }
  }
  return decodeForm(raw) ?? {};
}

/**
 * The payload as an object, whichever way it reached us.
 *
 * The webhook route JSON-parses the raw body and, when that fails, hands the
 * connector `{ _raw: <body> }` — which is exactly what happens to every
 * form-encoded ThriveCart delivery. Left unhandled, the whole payload would be
 * one unreadable string field.
 */
function payloadOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") return decodeBody(raw);
  const obj = asObject(raw);
  const inner = str(obj["_raw"]);
  return inner ? decodeBody(inner) : obj;
}

/**
 * Live money only.
 *
 * `mode` is "live" or "test" and `mode_int` is 2 (live) or 1 (test) — the plan
 * said 0 for test and the docs say 1, so the docs win and both are refused.
 * AFFIRMATIVE LIVE IS REQUIRED: a delivery that says neither is dropped, because
 * the failure this connector exists to prevent is a test sale landing in a
 * revenue figure, and silence is not evidence of a live sale. Both keys are
 * documented as always present.
 */
function isLive(body: Record<string, unknown>): boolean {
  const mode = text(body["mode"])?.toLowerCase() ?? null;
  const modeInt = num(body["mode_int"]);
  if (mode === "test" || modeInt === 1) return false;
  return mode === "live" || modeInt === 2;
}

/** Minor units → major, unless the currency has no minor unit. */
function money(total: unknown, currency: string | null): number | null {
  const n = num(total);
  if (n === null) return null;
  return currency && ZERO_DECIMAL.has(currency.toLowerCase()) ? n : n / 100;
}

export const thrivecartConnector: Connector = {
  source: "thrivecart",
  authType: "secret",
  /**
   * There is no signature: ThriveCart proves itself with a shared secret in the
   * body, so this is a constant-time compare and nothing more — the body's
   * integrity is not attested, which is why the entry says the secret is the
   * whole of the authentication.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const token = text(decodeBody(rawBody)["thrivecart_secret"]);
    return sharedTokenVerify({ rawBody, headers, secret }, { token });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = payloadOf(rawPayload);
    const event = text(body["event"]);
    const ours = event ? THRIVECART_EVENTS[event] : undefined;
    if (!event || !ours) return [];
    if (!isLive(body)) return [];

    const order = asObject(body["order"]);
    const customer = asObject(body["customer"]);
    // The account webhook sends `order_id` at the top level and the Event
    // Subscription API nests it; an abandoned cart has no order at all, so the
    // delivery's own id is the last rung.
    const id = text(order["id"]) ?? text(body["order_id"]) ?? text(body["invoice_id"]) ?? text(body["event_id"]);
    if (!id) return [];

    // WHEN IT HAPPENED. `order_timestamp` is unix seconds; `order_date` is the
    // same instant as text. Nothing here is a future date — ThriveCart's
    // forward-looking fields (next rebill dates) stay in `properties`.
    const occurredAt =
      epochToDate(body["order_timestamp"], "s") ??
      epochToDate(order["date_unix"], "s") ??
      parseDate(text(body["order_date"]), "order_date") ??
      ctx.fallbackOccurredAt ??
      new Date();

    // `currency` is a TOP-LEVEL key on the delivery (the plan put it under
    // `order`); the nested one is kept as a fallback.
    const currency = text(body["currency"]) ?? text(order["currency"]);
    const { thrivecart_secret: _secret, ...properties } = body;

    return [
      {
        eventId: eventId("thrivecart", ctx.connectionId, id, event),
        eventType: ours,
        subject: text(customer["email"]) ?? text(body["customer_identifier"]) ?? text(customer["id"]),
        occurredAt,
        // An abandoned cart, a pause, a resume and a cancellation moved no
        // money — the order total on those payloads is the ORIGINAL sale, and
        // counting it again as new value would inflate revenue. Affiliate
        // commissions have no documented amount field, so they too stay null
        // rather than carry a guess; the payload is in `properties` either way.
        value: MONEY_EVENTS.has(ours) ? money(order["total"], currency) : null,
        currency: MONEY_EVENTS.has(ours) ? (currency?.toUpperCase() ?? null) : null,
        properties,
      },
    ];
  },
};
