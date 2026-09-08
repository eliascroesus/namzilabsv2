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
  VerifyWebhookArgs,
  VerifyWebhookResult,
} from "./types";
import { asObject, holdsWindowContinuation, parseDate, str } from "./field-utils";
import { HttpError, type ObservedRateLimit } from "@/lib/http-client";
import {
  eventId,
  headerKeyClient,
  hmacHeaderVerify,
  isoOrNull,
  parseWalkCursor,
  requireCredential,
  walkImportProgress,
  windowedWalk,
} from "./kit";

/**
 * Shopify (Admin API, REST). Three credentials, because Shopify splits the two
 * jobs across two secrets and puts the store in the URL: an Admin API access
 * token for outbound requests, the app's CLIENT SECRET (API secret key) which
 * is the only thing that can verify an inbound delivery, and the store's
 * `*.myshopify.com` domain, which is the API's host.
 *
 * MONEY IS A DECIMAL STRING, not minor units — `"total_price": "409.94"` means
 * $409.94. Dividing by 100 here would understate every store's revenue by 100x.
 * Verified against the live examples on the Order resource page (and against
 * `total_price_set.shop_money.amount`, which restates the same figure in the
 * SHOP's currency next to a `presentment_money` in the buyer's). We read shop
 * money: it is the merchant's own books, and it is the axis their Shopify
 * reports already use.
 *
 * THE WEBHOOK CARRIES NO EVENT TYPE IN ITS BODY. `orders/create` and
 * `orders/paid` deliver the same Order JSON and differ only by the
 * `X-Shopify-Topic` header, which is NOT covered by the signature. That would
 * be a hole if the topic decided the mapping — a captured `orders/create` body
 * could be relabelled `orders/paid` and replayed. It does not: every order
 * topic runs the SAME fan-out, and whether a payment row exists is decided by
 * the signed payload's own `financial_status`. Relabelling the header changes
 * nothing. It also means the webhook and the poll produce byte-identical rows,
 * so a delivery and the reconciliation that follows it land on one row instead
 * of two (the Paddle lesson).
 *
 * Docs read 8 Sep 2026, one fact each:
 * - https://shopify.dev/docs/api/admin-rest — "The REST Admin API is a legacy
 *   API as of October 1, 2024. Starting April 1, 2025, all new public apps must
 *   be built exclusively with the GraphQL Admin API." No sunset date is stated
 *   anywhere, and a custom app is not a public app, so REST is used here — see
 *   API_VERSION for why that is a deliberate choice and not an oversight.
 * - https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens —
 *   "authenticates requests with a token sent in the `X-Shopify-Access-Token`
 *   header". Every curl example on the Order page uses that exact header.
 * - https://shopify.dev/docs/apps/build/authentication-authorization/legacy/admin-custom-apps —
 *   "You can no longer create new admin-created custom apps. Existing apps are
 *   unaffected and continue to work", and "You can't rotate the API key or
 *   secret for an admin-created custom app." THE BRIEF'S PREMISE IS HALF GONE:
 *   a merchant without one already must now create the app in the Dev Dashboard
 *   or CLI instead. The three credentials are the same either way, which is why
 *   this connector is unaffected; only the connect instructions change.
 * - https://shopify.dev/docs/apps/build/webhooks/verify-deliveries — "Each
 *   HTTPS delivery includes a base64-encoded HMAC signature in the
 *   `X-Shopify-Hmac-SHA256` header" generated "using your app's client secret
 *   and the raw request body". BASE64, not hex. No timestamp is in the scheme,
 *   so there is no staleness to check. "If you rotate your app's client secret,
 *   it can take up to an hour for the HMAC digest to be generated using the new
 *   secret."
 * - https://shopify.dev/docs/apps/build/webhooks/subscribe/https — "Shopify has
 *   a one-second connection timeout and a five-second timeout for the entire
 *   request", and "If Shopify receives no response or an error, it retries 8
 *   times over the next 4 hours. After 8 consecutive failures, the subscription
 *   is automatically deleted." That last sentence is why
 *   `verifyWebhookSubscription` exists: a Shopify connection can go webhook-dead
 *   with nothing on either side to say so.
 * - https://shopify.dev/docs/api/admin-rest/latest/resources/order — list
 *   parameters `created_at_min/max`, `processed_at_min/max`, `status`
 *   ("**default open**"), `financial_status` (default any), `limit`
 *   ("≤ 250", "default 50"), `fields`, `ids`, `since_id`, `name`,
 *   `attribution_app_id`; `updated_at_min` is documented on the sibling count
 *   endpoint as "Orders last updated after date specified" and the list page's
 *   own example is `orders.json?updated_at_min=2005-07-31T15%3A57%3A11-04%3A00`.
 *   ALSO: "Only the last 60 days' worth of orders from a store are accessible
 *   from the Order resource by default" — the window this connector's first
 *   sync and `retention` are both sized to.
 * - https://shopify.dev/docs/api/admin-graphql/latest/objects/Order — the field
 *   semantics REST shares: `processedAt` is "The date and time … when the order
 *   was processed. This date and time might not match the date and time when
 *   the order was created"; `updatedAt` is "when the order was last modified".
 *   `cancelled_at` (REST) is "The date and time when the order was canceled.
 *   Returns `null` if the order isn't canceled."
 * - https://shopify.dev/docs/api/admin-rest/latest/resources/refund — a Refund
 *   is `{ id, order_id, created_at, processed_at, transactions, … }`;
 *   `processed_at` is "when the refund was imported … can be set to a date in
 *   the past when importing from other systems"; a refund transaction reads
 *   `{"kind":"refund","status":"success","amount":"41.94","currency":"USD"}` —
 *   a decimal STRING again.
 * - https://shopify.dev/docs/api/admin-rest/latest/resources/abandoned-checkouts —
 *   a checkout carries `id`, `token`, `created_at`, `currency` and
 *   `total_price` ("379.69"), and needs the `orders` scope.
 * - https://shopify.dev/docs/api/admin-rest/latest/resources/customer — a
 *   customer carries `id`, `email`, `created_at`.
 * - https://shopify.dev/docs/api/admin-rest/usage/pagination — the `Link`
 *   header carries `rel="next"`/`rel="previous"`; `page_info` "can't be
 *   modified and must be used exactly as it appears in the link header URL",
 *   and "a request that includes the `page_info` parameter can't include any
 *   other parameters except for `limit` and `fields`". That constraint shapes
 *   `fetchPage` below: the FIRST request carries the window, every later one
 *   carries only limit + page_info.
 * - https://shopify.dev/docs/api/admin-rest/usage/rate-limits — Standard and
 *   Advanced: "Bucket size: `40 requests/app/store`", "Leak rate: `2/second`";
 *   Plus: 400 and 20/second. "You can check how many requests you've already
 *   made using the Shopify `X-Shopify-Shop-Api-Call-Limit` header"; a 429
 *   carries `Retry-After` in seconds.
 * - https://shopify.dev/docs/api/admin-rest/latest/resources/webhook — POST
 *   `/admin/api/<version>/webhooks.json` with `{"webhook":{"topic","address","format"}}`
 *   → 201 and the created subscription. THE RESPONSE CARRIES NO SECRET, which
 *   is exactly why the client secret is a pasted credential. `GET
 *   /webhooks.json?address=…` — "Retrieve webhook subscriptions that send the
 *   POST request to this URI" — and `DELETE /webhooks/{id}.json`.
 * - https://shopify.dev/docs/api/usage/access-scopes — `read_orders` for orders
 *   and abandoned checkouts, `read_customers` for customers; `read_all_orders`
 *   lifts the 60-day window and "requires approval from Shopify".
 * - https://shopify.dev/docs/apps/launch/protected-customer-data — the review
 *   gate is for PUBLIC apps; custom apps read "Always available" (Level 2 on an
 *   admin-created custom app reads "Varies by plan"). Orders and abandoned
 *   checkouts are protected customer data either way, which is worth knowing
 *   about what lands in `properties`.
 */

/**
 * PINNED, not "latest" — Shopify has no `latest` path alias, and a dated
 * version is the only way to know what shape arrives. Shopify ships a version
 * quarterly and supports each for at least 12 months; when this one falls out
 * of support Shopify "falls forward and responds … with the same behaviour as
 * the oldest supported stable version" rather than erroring, so the failure
 * mode of forgetting to bump is drift, not an outage. Bump it deliberately.
 */
const API_VERSION = "2026-07";

/** `limit` maxes at 250 (default 50); pulling the max is what makes a 60-day first sync affordable at 2 req/s. */
const PAGE = 250;

/**
 * `firstSyncDays: 60` is not a taste call — it is the documented ceiling. The
 * Order resource returns "only the last 60 days' worth of orders" without the
 * approval-gated `read_all_orders` scope, so a deeper floor would spend calls
 * asking for records the API will not return.
 */
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 60, overlapMs: 5 * 60_000 };

/**
 * The topics this connector subscribes to, and the exact list handed to
 * `POST /webhooks.json` one at a time (Shopify creates ONE subscription per
 * topic, so six topics are six ids — hence the joined `externalId`).
 *
 * `orders/updated` is deliberately absent. Every order topic runs the same
 * fan-out, so subscribing to updates would ring for a fulfilment note or a tag
 * edit and re-write rows that did not change; the poll's `updated_at` window
 * already re-reads real edits inside the 60-day window.
 */
export const SHOPIFY_TOPICS = [
  "orders/create",
  "orders/paid",
  "orders/cancelled",
  "refunds/create",
  "checkouts/create",
  "customers/create",
] as const;

/**
 * The `financial_status` values that mean MONEY ARRIVED.
 *
 * `refunded` and `partially_refunded` are in the set on purpose: both describe
 * an order that WAS paid, and the money going back out is its own
 * `payment_refunded` row. Leave them out and an order paid between two sweeps
 * and refunded before the second one loses its payment row entirely, so the
 * refund shows up with nothing to net against. `partially_paid` is left out for
 * the opposite reason — some of the money arrived and the order carries no
 * field saying how much, so counting `total_price` there would overstate.
 */
const PAID_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

/** REST ids arrive as JSON numbers (`"id": 450789469`), so `str` alone drops them. */
const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : str(v));

/**
 * `https://<shop>.myshopify.com/admin/api/<version>` — and the domain is
 * VALIDATED, not merely trimmed.
 *
 * `shopDomain` is customer-pasted text that becomes the host of a request
 * carrying that customer's Admin API token. Interpolating it unchecked is how
 * a token gets sent to somebody else's server, so anything that is not a bare
 * `*.myshopify.com` host is refused outright. A pasted `https://acme.myshopify.com/admin`
 * is normalised rather than rejected, because that is what a person copies out
 * of their browser bar.
 */
export function shopifyBaseUrl(credentials: Record<string, unknown> | null | undefined): string {
  const raw = requireCredential(credentials, "shopDomain", "Shopify");
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    throw new Error(`Shopify: "${raw}" is not a store domain — it must look like acme.myshopify.com.`);
  }
  return `https://${host}/admin/api/${API_VERSION}`;
}

/**
 * `X-Shopify-Shop-Api-Call-Limit: 32/40` — "32 is the current request count and
 * 40 is the bucket size". The shared `parseRateLimit` only knows the
 * `ratelimit-*` / `x-ratelimit-*` spellings and Shopify uses neither, so the
 * remaining budget is read here or not at all.
 */
export function parseShopifyCallLimit(header: string | null | undefined): ObservedRateLimit | null {
  if (!header) return null;
  const [usedRaw, sizeRaw] = header.split("/");
  const used = Number((usedRaw ?? "").trim());
  const size = Number((sizeRaw ?? "").trim());
  if (!Number.isFinite(used) || !Number.isFinite(size)) return null;
  return { limit: size, remaining: Math.max(0, size - used), resetSeconds: null };
}

/** The `page_info` token out of the `Link` header's `rel="next"` entry; null at the end of the walk. */
export function nextPageInfo(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link);
  if (!m) return null;
  try {
    return new URL(m[1]).searchParams.get("page_info");
  } catch {
    return null;
  }
}

/**
 * The store client, plus the two response headers Shopify answers on that the
 * shared client cannot see: the `Link` that paginates and the call-limit that
 * paces. Both are captured through `onResponse` and read after each call.
 */
function api(credentials: Record<string, unknown> | null | undefined) {
  let link: string | null = null;
  let limit: ObservedRateLimit | null = null;
  const client = headerKeyClient(
    shopifyBaseUrl(credentials),
    "x-shopify-access-token",
    requireCredential(credentials, "accessToken", "Shopify"),
    "Shopify",
    {},
    {
      onResponse: (res) => {
        // Reset per response: a page with no Link header is the end of the walk,
        // and a stale one would loop the last page forever.
        link = res.headers.get("link");
        limit = parseShopifyCallLimit(res.headers.get("x-shopify-shop-api-call-limit")) ?? limit;
      },
    },
  );
  return { ...client, link: () => link, rateLimit: () => limit };
}

/** Shop money if the `*_set` is there, else the plain pair; both are already MAJOR units. */
function shopMoney(set: unknown, amount: unknown, currency: unknown): { value: number | null; currency: string | null } {
  const shop = asObject(asObject(set)["shop_money"]);
  const rawAmount = shop["amount"] ?? amount;
  const rawCurrency = str(shop["currency_code"]) ?? str(currency);
  const n = typeof rawAmount === "number" ? rawAmount : Number(str(rawAmount) ?? "");
  return { value: Number.isFinite(n) ? n : null, currency: rawCurrency?.toUpperCase() ?? null };
}

/**
 * One refund → one `payment_refunded`, valued at the money that actually moved.
 *
 * The amount is summed from the refund's own transactions rather than read off
 * a total, because a Refund has no total field: it carries `refund_line_items`
 * (what was returned) and `transactions` (what was paid back), and only the
 * second is cash. `kind === "refund"` and `status === "success"` are both
 * required — a failed or pending refund transaction is money that did not move.
 * No successful transaction at all means "we do not know", which is null and
 * not zero: a refund worth nothing and a refund we failed to read must not look
 * the same on a dashboard.
 *
 * Dated by `processed_at`, falling back to `created_at`. `processed_at` is the
 * one that can be backdated when a merchant imports history from another
 * platform, which is exactly the moment the refund HAPPENED; `created_at` is
 * when the row appeared in Shopify.
 */
export function shopifyRefundEvent(
  refund: Record<string, unknown>,
  connectionId: string,
  orderCurrency?: unknown,
): CanonicalEvent | null {
  const id = idOf(refund["id"]);
  const occurredAt =
    parseDate(str(refund["processed_at"]), "shopify.refund.processed_at") ??
    parseDate(str(refund["created_at"]), "shopify.refund.created_at");
  if (!id || !occurredAt) return null;

  let total = 0;
  let counted = 0;
  let currency: string | null = null;
  for (const t of Array.isArray(refund["transactions"]) ? (refund["transactions"] as unknown[]) : []) {
    const tx = asObject(t);
    if (str(tx["kind"])?.toLowerCase() !== "refund") continue;
    if (str(tx["status"])?.toLowerCase() !== "success") continue;
    const raw = tx["amount"];
    const n = typeof raw === "number" ? raw : Number(str(raw) ?? "");
    if (!Number.isFinite(n)) continue;
    total += n;
    counted += 1;
    currency = currency ?? str(tx["currency"]);
  }

  return {
    // Refund ids are unique store-wide, so the refund alone keys the row; the
    // event type rides along because an order id and a refund id are different
    // namespaces and a reader should not have to know that.
    eventId: eventId("shopify", connectionId, "refund", id, "payment_refunded"),
    eventType: "payment_refunded",
    subject: idOf(refund["order_id"]),
    occurredAt,
    // toFixed(6) removes binary-float noise (41.94 + 5 lands on
    // 46.940000000000005) without touching a real three-decimal currency.
    value: counted ? Number(total.toFixed(6)) : null,
    currency: (currency ?? str(orderCurrency))?.toUpperCase() ?? null,
    properties: refund,
  };
}

/**
 * One order → every countable fact it currently states. The SAME function
 * serves the webhook and the poll, which is what keeps the two paths on one row
 * apiece.
 *
 * Dating, field by field, and why none of them is "now":
 * - `order_created` at `created_at` — when the order was created.
 * - `payment_succeeded` at `processed_at`, falling back to `created_at`.
 *   Shopify exposes NO payment timestamp on an order (transactions are a
 *   separate resource, one extra request per order), and `processed_at` is the
 *   nearest true thing it does expose: "the date and time when the order was
 *   processed … might not match the date and time when the order was created",
 *   and the field a merchant backdates when importing historical orders. Using
 *   the delivery moment instead would date an imported year of history to the
 *   afternoon we imported it.
 * - `order_cancelled` at `cancelled_at`, which is null unless cancelled.
 * - one `payment_refunded` per embedded refund, dated by the refund.
 *
 * `closed_at` and `updated_at` are deliberately not events: closing an order is
 * housekeeping, and "modified" is the watermark axis, not something that
 * happened to a customer.
 */
export function shopifyOrderEvents(
  order: Record<string, unknown>,
  connectionId: string,
  fallback?: Date,
): CanonicalEvent[] {
  const id = idOf(order["id"]);
  const createdAt = parseDate(str(order["created_at"]), "shopify.order.created_at") ?? fallback ?? null;
  if (!id || !createdAt) return [];

  const { value, currency } = shopMoney(order["total_price_set"], order["total_price"], order["currency"]);
  // `email` is the order's contact address; `contact_email` is the one Shopify
  // keeps when a guest checkout has no customer record. Falling through to the
  // order NAME (#1001) keeps a row identifiable when both are withheld.
  const subject =
    str(order["email"]) ?? str(order["contact_email"]) ?? idOf(asObject(order["customer"])["id"]) ?? str(order["name"]);

  const out: CanonicalEvent[] = [
    {
      eventId: eventId("shopify", connectionId, "order", id, "order_created"),
      eventType: "order_created",
      subject,
      occurredAt: createdAt,
      value,
      currency,
      properties: order,
    },
  ];

  if (PAID_STATUSES.has((str(order["financial_status"]) ?? "").toLowerCase())) {
    out.push({
      eventId: eventId("shopify", connectionId, "order", id, "payment_succeeded"),
      eventType: "payment_succeeded",
      subject,
      occurredAt: parseDate(str(order["processed_at"]), "shopify.order.processed_at") ?? createdAt,
      value,
      currency,
      properties: order,
    });
  }

  const cancelledAt = parseDate(str(order["cancelled_at"]), "shopify.order.cancelled_at");
  if (cancelledAt) {
    out.push({
      eventId: eventId("shopify", connectionId, "order", id, "order_cancelled"),
      eventType: "order_cancelled",
      subject,
      occurredAt: cancelledAt,
      value,
      currency,
      properties: order,
    });
  }

  for (const r of Array.isArray(order["refunds"]) ? (order["refunds"] as unknown[]) : []) {
    const ev = shopifyRefundEvent(asObject(r), connectionId, order["currency"]);
    if (ev) out.push(ev);
  }
  return out;
}

function checkoutEvent(checkout: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  // A checkout has both a numeric id and a token; the id is what the abandoned
  // checkouts list returns, the token is the fallback for a payload without one.
  const id = idOf(checkout["id"]) ?? str(checkout["token"]);
  const occurredAt = parseDate(str(checkout["created_at"]), "shopify.checkout.created_at") ?? fallback ?? null;
  if (!id || !occurredAt) return null;
  const { value, currency } = shopMoney(checkout["total_price_set"], checkout["total_price"], checkout["currency"]);
  return {
    eventId: eventId("shopify", connectionId, "checkout", id, "checkout_created"),
    eventType: "checkout_created",
    subject: str(checkout["email"]) ?? idOf(asObject(checkout["customer"])["id"]),
    occurredAt,
    // The cart's value at the moment checkout started — a funnel figure, not
    // revenue. Nothing here says it was ever paid; that is `payment_succeeded`.
    value,
    currency,
    properties: checkout,
  };
}

function customerEvent(customer: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const id = idOf(customer["id"]);
  const occurredAt = parseDate(str(customer["created_at"]), "shopify.customer.created_at") ?? fallback ?? null;
  if (!id || !occurredAt) return null;
  return {
    eventId: eventId("shopify", connectionId, "customer", id, "customer_created"),
    eventType: "customer_created",
    // No `value`: a customer record is not money. Their lifetime spend lives in
    // `properties` and belongs to whatever metric asks for it, not to this row.
    subject: str(customer["email"]) ?? id,
    occurredAt,
    value: null,
    currency: null,
    properties: customer,
  };
}

export const shopifyConnector: Connector = {
  source: "shopify",
  authType: "apiKey",
  operations: ["orders.list"] as const,
  operationFor: () => "orders.list",
  importProgress: walkImportProgress,
  holdsContinuation: holdsWindowContinuation,
  /**
   * The 60-day wall is Shopify's, not ours: without the approval-gated
   * `read_all_orders` scope the Order resource simply does not return anything
   * older, so a connection whose mark falls that far behind has history it can
   * never fetch. Declared conservatively — a store that HAS been granted
   * `read_all_orders` has no such wall, and nothing in the API response says
   * which kind of store this is, so the alarm fires for the one we can prove.
   */
  retention: { days: 60, alarmAfterDays: 50, watermarkOf: (cursor) => parseWalkCursor(cursor).hw },

  /**
   * Base64, and no timestamp anywhere in the scheme — so there is no staleness
   * to check and nothing but the body is signed. Fails closed without a secret,
   * which for Shopify means without the app's client secret: the create call
   * mints nothing, so an empty secret field is the difference between verifying
   * deliveries and refusing all of them.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-shopify-hmac-sha256", encoding: "base64" });
  },

  /**
   * The topic lives in a HEADER, so a delivery whose `X-Shopify-Topic` is
   * missing cannot be classified at all and maps to nothing. Saying that out
   * loud beats guessing "it looks like an order": the same JSON shape arrives
   * under six topics, and a guess would silently file a customer record as a
   * sale.
   */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const topic = (ctx.headers?.["x-shopify-topic"] ?? "").trim().toLowerCase();
    const payload = asObject(rawPayload);
    // Every order topic, one mapping — see the header. The payload decides what
    // is countable; the (unsigned) header only says which resource arrived.
    if (topic.startsWith("orders/")) return shopifyOrderEvents(payload, ctx.connectionId, ctx.fallbackOccurredAt);
    if (topic === "refunds/create") {
      const ev = shopifyRefundEvent(payload, ctx.connectionId);
      return ev ? [ev] : [];
    }
    if (topic === "checkouts/create") {
      const ev = checkoutEvent(payload, ctx.connectionId, ctx.fallbackOccurredAt);
      return ev ? [ev] : [];
    }
    if (topic === "customers/create") {
      const ev = customerEvent(payload, ctx.connectionId, ctx.fallbackOccurredAt);
      return ev ? [ev] : [];
    }
    return [];
  },

  /**
   * Walks `/orders.json` bounded by `updated_at_min`.
   *
   * THE WATERMARK IS `updated_at` BECAUSE THE REQUEST FILTERS ON `updated_at`.
   * The two-axis split is the point: the window advances on modification time
   * so an order edited today is re-read even though it was placed last month,
   * while every event this produces is dated by when it HAPPENED — creation,
   * processing, cancellation, refund. `windowedWalk`'s `happenedAt` keeps the
   * coverage figure honest about that second axis.
   *
   * `status: "any"` is load-bearing. The endpoint's `status` DEFAULTS TO
   * `open`, so without it every cancelled, archived and closed order is
   * invisible — cancellations would never be seen and the paid rows behind them
   * would quietly stop being reconciled.
   *
   * Only ONE event per order goes through `map`, so the mark advances once per
   * row; the rest of the order's facts are fanned back out afterwards from the
   * raw row `map` kept in `properties`.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        // A page_info request "can't include any other parameters except for
        // limit and fields" — send the window again and Shopify 400s.
        const page = cont
          ? await client.get<{ orders?: unknown[] }>("/orders.json", { limit: PAGE, page_info: cont })
          : await client.get<{ orders?: unknown[] }>("/orders.json", {
              limit: PAGE,
              status: "any",
              updated_at_min: since.toISOString(),
            });
        return { rows: (page.orders ?? []).map(asObject), next: nextPageInfo(client.link()), rateLimit: client.rateLimit() };
      },
      changedAt: (o) => isoOrNull(o["updated_at"]),
      happenedAt: (o) => isoOrNull(o["processed_at"]) ?? isoOrNull(o["created_at"]),
      map: (o) => shopifyOrderEvents(o, args.connectionId)[0] ?? null,
      // Shopify does not document a page_info lifetime. If one expires the walk
      // must resume from the mark rather than wedge on a token it can never
      // use; a 400 naming the parameter is the only signal there is.
      expiredContinuation: (e) => e instanceof HttpError && e.status === 400 && /page_info/i.test(e.body),
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...shopifyOrderEvents(r.properties ?? {}, args.connectionId));
    return { ...res, records: fanned };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },

  /**
   * Shopify signs with the app's CLIENT SECRET and the create response carries
   * no secret of its own, so the credential the customer pasted is handed
   * straight back as the signing secret — the same shape Thinkific uses for its
   * site API key. Nothing is minted: a minted secret could never match a real
   * delivery, because there is nowhere in Shopify to paste one back.
   *
   * The secret is demanded BEFORE the first POST, so a connection that cannot
   * verify deliveries does not first leave six subscriptions behind.
   *
   * One subscription per topic, so six ids; a partial failure throws and leaves
   * whatever was created in place, which `verifyWebhookSubscription` then
   * reconciles by listing on our address and creating only what is missing.
   */
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const secret = requireCredential(args.credentials, "apiSecretKey", "Shopify");
    const client = api(args.credentials);
    const ids: string[] = [];
    for (const topic of SHOPIFY_TOPICS) {
      const res = await client.post<{ webhook?: { id?: unknown } }>("/webhooks.json", {
        webhook: { topic, address: args.webhookUrl, format: "json" },
      });
      const id = idOf(res.webhook?.id);
      if (id) ids.push(id);
    }
    return { signingSecret: secret, externalId: ids.join(",") };
  },

  /**
   * Shopify DELETES a subscription after 8 consecutive delivery failures over
   * four hours. That is the whole reason this exists: the endpoint stops
   * receiving with nothing on either side to say so, and the poll silently
   * becomes the only path.
   *
   * No `signingSecret` is ever returned, even on re-creation — the client
   * secret is the customer's, unchanged by anything we do here, so there is
   * nothing new to persist. And a missing subscription is NOT re-created while
   * our endpoint is known to be refusing deliveries: that just restarts the
   * eight-failure countdown that deleted it.
   */
  async verifyWebhookSubscription(args: VerifyWebhookArgs): Promise<VerifyWebhookResult> {
    try {
      const client = api(args.credentials);
      const list = await client.get<{ webhooks?: unknown[] }>("/webhooks.json", { address: args.webhookUrl, limit: PAGE });
      const mine = (list.webhooks ?? []).map(asObject);
      const have = new Set(mine.map((w) => str(w["topic"])?.toLowerCase()).filter(Boolean));
      const missing = SHOPIFY_TOPICS.filter((t) => !have.has(t));
      if (missing.length === 0) return { healthy: true, reregistered: false };

      if (args.recentlyRejecting) {
        return {
          healthy: false,
          reregistered: false,
          detail: `Shopify is missing ${missing.length} subscription(s), and recent deliveries were refused — fix the endpoint before re-subscribing.`,
        };
      }
      const ids = mine.map((w) => idOf(w["id"])).filter((id): id is string => Boolean(id));
      for (const topic of missing) {
        const res = await client.post<{ webhook?: { id?: unknown } }>("/webhooks.json", {
          webhook: { topic, address: args.webhookUrl, format: "json" },
        });
        const id = idOf(res.webhook?.id);
        if (id) ids.push(id);
      }
      return { healthy: true, reregistered: true, externalId: ids.join(",") };
    } catch (e) {
      return { healthy: false, reregistered: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },

  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    const client = api(args.credentials);
    for (const id of args.externalId
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      try {
        await client.del(`/webhooks/${encodeURIComponent(id)}.json`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) continue; // already gone is success
        throw e;
      }
    }
  },

  /**
   * The connect form asks for the API secret key as an ordinary credential, so
   * this names it rather than letting a minted secret stand — and it tells the
   * connection page not to offer a live client secret as a "copy me into your
   * provider" value, because there is no box in Shopify to paste it into.
   */
  webhookSecretFromCredentials(credentials: Record<string, unknown>): string | null {
    return str(credentials["apiSecretKey"]);
  },
};
