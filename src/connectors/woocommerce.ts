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
import { basicAuth, HttpError } from "@/lib/http-client";
import { eventId, hmacHeaderVerify, isoOrNull, providerClient, requireCredential, walkImportProgress, windowedWalk } from "./kit";

/**
 * WooCommerce — the store is the CUSTOMER'S OWN WordPress server, which is what
 * makes this connector different from every other commerce one here. There is
 * no vendor base URL (the store's URL is a third credential), no published rate
 * limit to obey (the ceiling is the merchant's PHP workers), and no vendor
 * clock: every timestamp in the API is a NAIVE string whose meaning depends on
 * a WordPress setting, so the whole connector is built on the `*_gmt` twins.
 *
 * Docs read 8 September 2026, one fact each:
 * - https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication —
 *   "You may use HTTP Basic Auth by providing the REST API Consumer Key as the
 *   username and the REST API Consumer Secret as the password"; the query-string
 *   form is offered only for "servers that fail to parse Authorization headers"
 *   (see BASIC ONLY below). Keys come from WooCommerce → Settings → Advanced →
 *   REST API, and carry a Read / Write / Read-Write permission.
 * - https://woocommerce.github.io/woocommerce-rest-api-docs/#pagination —
 *   "Requests that return multiple items will be paginated to 10 items by
 *   default"; "The total number of resources and pages are always included in
 *   the `X-WP-Total` and `X-WP-TotalPages` HTTP headers." No rate-limit section
 *   anywhere on the page — see RATE LIMITS below.
 * - https://raw.githubusercontent.com/woocommerce/woocommerce-rest-api-docs/trunk/source/includes/wp-api-v3/_orders.md —
 *   list parameters: `after` "Limit response to resources published after a
 *   given ISO8601 compliant date", `modified_after` "…resources modified
 *   after…", `dates_are_gmt` "Whether to interpret dates as GMT when limiting
 *   response by published or modified date", `orderby` "Options: `date`,
 *   `modified`, `id`, `include`, `title` and `slug`", `order` default `desc`.
 *   Order properties: `date_created_gmt` "The date the order was created, as
 *   GMT", `date_paid_gmt`, `date_modified_gmt`, `total` "Grand total" as a
 *   STRING, `currency` "in ISO format", `customer_id` "0 for guests". The
 *   example order in that file shows the shape of every date the API emits:
 *   `"date_created_gmt": "2017-03-22T19:28:02"` — no `Z`, no offset — and
 *   `"total": "29.35"`, a DECIMAL string in MAJOR units. Nothing here is
 *   divided by 100; doing so would understate every order by 100x.
 * - .../includes/rest-api/Controllers/Version3/class-wc-rest-crud-controller.php —
 *   `prepare_objects_query` builds the date query as
 *   `'column' => $use_gmt ? 'post_date_gmt' : 'post_date'` for `after`, and
 *   `'post_modified_gmt' : 'post_modified'` for `modified_after`. Same file:
 *   `orderby` enum `'date', 'id', 'include', 'title', 'slug', 'modified'`,
 *   `per_page` default 10, minimum 1, MAXIMUM 100. Its `get_items()` sets
 *   `X-WP-Total` / `X-WP-TotalPages` and — unlike WP core's posts controller —
 *   returns an EMPTY ARRAY rather than a 400 for a page past the end, which is
 *   why the walk below can simply run off the end of the pages.
 * - .../src/Internal/DataStores/Orders/OrdersTableQuery.php (HPOS, the default
 *   order storage since WooCommerce 8.2) — `maybe_remap_args` maps
 *   `'post_date_gmt' => 'date_created_gmt'` and `'post_modified_gmt' =>
 *   'date_updated_gmt'`; `sanitize_order_orderby` maps `'modified' =>
 *   '…orders.date_updated_gmt'`; the date query is handed to the stock
 *   `new \WP_Date_Query(...)`, and only the GMT columns are in its
 *   `$table_mapping`. So `dates_are_gmt=true` is not a nicety: it is the only
 *   spelling both storage backends agree on.
 * - https://developer.wordpress.org/reference/classes/wp_date_query/build_mysql_datetime/ —
 *   THE BOUND FORMAT, and the trap. A bound string that matches none of the
 *   `Y`, `Y-m`, `Y-m-d`, `Y-m-d H:i` patterns is read as
 *   `date_create( $datetime, wp_timezone() )` and then
 *   `->setTimezone( wp_timezone() )->format( 'Y-m-d H:i:s' )`. Send
 *   `2026-09-01T09:55:00Z` and the `Z` wins, so WordPress converts it into the
 *   STORE'S local wall clock and compares that against the GMT column — the
 *   bound lands hours off, in whichever direction the merchant's timezone
 *   points, and on a UTC+ store the walk silently skips that many hours of
 *   orders. Send the same instant NAIVE and the two `wp_timezone()` calls
 *   cancel: the string is returned unchanged and compared, wall clock to wall
 *   clock, against `date_*_gmt`. Hence `wpDate()`. The same page: `after` is
 *   EXCLUSIVE (`$inclusive = ! empty( $query['inclusive'] )`, so `>` not `>=`),
 *   which the walk's overlap already covers.
 * - .../includes/class-wc-webhook.php — `generate_signature` is
 *   `base64_encode( hash_hmac( $hash_algo, $payload, wp_specialchars_decode(
 *   $this->get_secret(), ENT_QUOTES ), true ) )` with `$hash_algo` defaulting
 *   to `'sha256'`, over the delivered body (`'body' => trim( wp_json_encode(
 *   $payload ) )`). `get_default_topic_hooks()`: `order.created` →
 *   `woocommerce_new_order`, `order.updated` → `woocommerce_update_order` +
 *   `woocommerce_order_refunded`, `order.deleted` → `wp_trash_post` +
 *   `woocommerce_trash_order`. `build_payload()` "If a resource has been
 *   deleted, just include the ID in the payload" — see WHY DELETIONS ARE NOT
 *   EVENTS. A live payload is fetched through the REST endpoint itself
 *   (`get_wp_api_payload` → `/wc/{$version}/{$resource}s/{$resource_id}`), so a
 *   delivered order is byte-for-byte the resource the poll reads.
 * - .../includes/rest-api/Controllers/Version2/class-wc-rest-webhooks-v2-controller.php —
 *   the `secret` schema entry: "Secret key used to generate a hash of the
 *   delivered webhook and provided in the request headers. This will default to
 *   a MD5 hash from the current user's ID|username if not provided." A default
 *   derived from a user id is guessable, so WE ALWAYS SUPPLY ONE.
 * - .../includes/rest-api/Controllers/Version1/class-wc-rest-webhooks-v1-controller.php —
 *   `create_item()` ends `// Send ping. $webhook->deliver_ping(); return
 *   $response;` — the ping's result is NOT checked and the status is NOT
 *   changed by it, so the unsigned ping our route will refuse (see PING) costs
 *   nothing. `delete_item()` requires force: without it, `WP_Error(
 *   'woocommerce_rest_trash_not_supported', 'Webhooks do not support
 *   trashing.', 501 )`.
 * - https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks —
 *   "`X-WC-Webhook-Signature`… a base64 encoded HMAC-SHA256 hash of the
 *   payload", alongside `X-WC-Webhook-Source`, `-Topic`, `-Resource`, `-Event`,
 *   `-ID` and `-Delivery-ID`. Order topics are `order.created`,
 *   `order.updated`, `order.deleted`.
 * - .../src/Enums/OrderStatus.php — the statuses, including `CHECKOUT_DRAFT =
 *   'checkout-draft'`: "Checkout Draft orders are created when customers start
 *   the checkout process while the block version of the checkout is in place."
 *   A started checkout is not an order; see NOT-AN-ORDER STATUSES.
 * - https://developer.woocommerce.com/docs/apis/store-api/rate-limiting/ — the
 *   only rate limiting WooCommerce ships is for the STORE API (cart/checkout),
 *   is opt-in, and defaults to 25 requests per 10 seconds. It does not apply to
 *   `wc/v3`. See RATE LIMITS.
 *
 * BASIC ONLY. The consumer secret goes in an `Authorization: Basic` header over
 * HTTPS and nowhere else. WooCommerce also documents putting the key and secret
 * in the QUERY STRING, but only as a workaround "for servers that fail to parse
 * Authorization headers" — i.e. for plain HTTP — and a secret in a URL is a
 * secret in the store's access log, in any proxy in front of it, and in our own
 * `HttpError` messages, which quote the URL. So a non-HTTPS store URL is
 * refused outright rather than downgraded, and a store whose host strips the
 * Authorization header cannot connect until that host is fixed (the docs call
 * that out as "a server issue").
 *
 * RATE LIMITS. There is no published limit for `wc/v3`, and the entry declares
 * none, because inventing one would be a claim about a server we have never
 * seen. That leaves the connector on the default budget (60/min × 0.7 = 42
 * calls/min), which is the point: politeness here is measured in a merchant's
 * PHP workers, not in a vendor's quota, and 42/min with PAGE=50 is a page of
 * fifty orders every 1.4 seconds at the absolute ceiling.
 */
const API_PATH = "/wp-json/wc/v3";

/**
 * Half the documented `per_page` maximum of 100.
 *
 * An order resource is not small — line items, two addresses, taxes, refunds
 * and every meta row a plugin has ever written — so 100 of them can be a
 * multi-megabyte JSON encode on a shared host that is also serving the shop.
 * Fifty is five times the default of 10, which is what actually matters for the
 * number of round trips, at half the peak memory of the ceiling.
 */
const PAGE = 50;

const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

/**
 * NOT-AN-ORDER STATUSES — rows the list endpoint will hand back that no one
 * ordered anything in.
 *
 * `checkout-draft` is the one that matters: WooCommerce's block checkout opens
 * one the moment a customer lands on the checkout page, so a store with an
 * ordinary abandonment rate has more of them than real orders. Counting those
 * as orders placed would overstate a shop's order count by whatever its
 * abandonment rate happens to be. The other three are WordPress's own
 * placeholder states.
 *
 * Dropped in the MAPPING rather than by a `status` request parameter, and
 * deliberately: the documented status list is the seven core ones, and stores
 * routinely add their own (`awaiting-shipment`, `partially-paid`). Sending an
 * explicit allow-list would silently discard every order a plugin had moved to
 * a status we had never heard of, which is a far worse failure than reading a
 * few drafts and dropping them here.
 */
const NOT_AN_ORDER = new Set(["checkout-draft", "auto-draft", "draft", "trash"]);

/**
 * One webhook per topic — WooCommerce's `topic` is a single string, not a list,
 * so covering orders takes TWO subscriptions.
 *
 * Both are needed and neither is redundant. `order.created` hangs off
 * `woocommerce_new_order` alone, so it is the only one that fires for an order
 * that is created and never touched again (a `pending` bank-transfer order, a
 * `failed` card). `order.updated` hangs off `woocommerce_update_order` and
 * `woocommerce_order_refunded`, so it is the one that fires when payment lands
 * and `date_paid_gmt` finally appears. Both deliver the same full order
 * resource and both key on the ORDER, so an order that fires both lands on one
 * row rather than being counted twice.
 */
export const WOOCOMMERCE_TOPICS = ["order.created", "order.updated"] as const;

/**
 * WHY DELETIONS ARE NOT EVENTS. `order.deleted` is deliberately not subscribed
 * to. Its payload is `array( 'id' => $resource_id )` and nothing else — no
 * total, no currency, and above all no date. The only timestamp available for
 * such a delivery is the moment it reached us, and dating an event by when we
 * received it is the one thing this codebase does not do. A subscription whose
 * every delivery we would have to drop is dead config, so it is not created.
 */

/**
 * A WooCommerce GMT timestamp as something `Date` can be trusted with.
 *
 * The API emits `"2017-03-22T19:28:02"` for `date_created_gmt` — an ISO
 * date-time with NO timezone designator, which ECMAScript reads as LOCAL time.
 * On a UTC container that is right by accident; on anything else every order in
 * the store shifts by the container's offset, and nothing downstream can tell.
 * The field is documented "as GMT", so the `Z` is not an assumption — it is the
 * designator WordPress omitted.
 */
function gmt(v: unknown): string | null {
  const s = str(v)?.trim();
  if (!s) return null;
  // Already carries a designator (`Z`, `+02:00`, `-0500`) — leave it alone.
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`;
}

/**
 * An instant as a bound WordPress will compare literally — see the
 * `build_mysql_datetime` note in the header. Seconds precision, no `Z`.
 */
function wpDate(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/**
 * A WooCommerce money string as a number, in the units it was already in.
 *
 * `total` is `"29.35"` — a decimal string of MAJOR units, formatted to the
 * store's decimal places. There is no minor-unit conversion to do here and
 * doing one anyway would divide every revenue figure by 100.
 */
function money(v: unknown): number | null {
  const raw = typeof v === "number" ? String(v) : str(v)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The store's `wc/v3` base, from whatever the customer pasted.
 *
 * Tolerates a trailing slash and a URL they have already appended `/wp-json` or
 * `/wp-json/wc/v3` to (both are what a person copies out of the docs), keeps a
 * subdirectory install's path, and REFUSES anything that is not HTTPS — see
 * BASIC ONLY. The error names the field and the fix, because this is the one
 * credential a customer types rather than pastes.
 */
export function storeApiBase(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`WooCommerce: "${raw.trim().slice(0, 120)}" is not a store URL — it must start with https:// (for example https://shop.example.com).`);
  }
  if (u.protocol !== "https:") {
    throw new Error(
      "WooCommerce: the store URL must be https. The consumer key and secret travel in an Authorization header on every request, " +
        "and WooCommerce only documents sending them over plain HTTP as a workaround for broken servers — we will not do that.",
    );
  }
  const path = u.pathname.replace(/\/+$/, "").replace(/\/wp-json(?:\/wc\/v\d+)?$/i, "");
  return `${u.origin}${path}${API_PATH}`;
}

/**
 * The store client, plus the pagination header the walk stops on.
 *
 * `X-WP-TotalPages` is documented as always present, and reading it saves the
 * one wasted request a "page until it comes back short" walk always makes. It
 * is an OPTIMISATION and not the termination condition: a host that strips the
 * header leaves it null, the walk falls back to the short page, and a page past
 * the end returns `[]` rather than a 400 (the CRUD controller's `get_items`
 * sets the headers and never errors on an over-range page), so both endings are
 * safe.
 */
function storeApi(credentials?: Record<string, unknown> | null) {
  const base = storeApiBase(requireCredential(credentials, "storeUrl", "WooCommerce"));
  const key = requireCredential(credentials, "consumerKey", "WooCommerce");
  const secret = requireCredential(credentials, "consumerSecret", "WooCommerce");
  let totalPages: number | null = null;
  const client = providerClient({
    baseUrl: base,
    provider: "WooCommerce",
    headers: { authorization: basicAuth(key, secret) },
    reconnectHint:
      "WooCommerce rejected this consumer key — check the key still exists under WooCommerce → Settings → Advanced → REST API, then open the connection and reconnect.",
    fetchOptions: {
      onResponse: (res) => {
        const v = res.headers.get("x-wp-totalpages");
        const n = v == null ? NaN : Number(v);
        totalPages = Number.isFinite(n) ? n : null;
      },
    },
  });
  return { client, totalPages: () => totalPages };
}

/**
 * The walk's continuation: `"<page>|<frozen upper bound>"`.
 *
 * WooCommerce paginates by PAGE NUMBER and offers no stable cursor, and a page
 * number over a set that is still being written to strands rows. Sort ascending
 * by `modified` and an order edited mid-walk jumps to the END of the ordering,
 * which shifts every row after it back by one — so the row that was about to be
 * page 3's first is never returned by any page, while the mark sails past its
 * timestamp. Freezing `modified_before` at the moment the walk started removes
 * the class outright: the result set cannot change while we page through it,
 * and everything modified during the walk is simply the next window's problem,
 * picked up from the settled mark minus the overlap.
 *
 * The bound is carried in the continuation rather than recomputed per poll
 * because a walk that spans several polls has to keep paging the SAME frozen
 * set. It can therefore go stale, and that is harmless: a stale bound only
 * means the frozen window closed earlier, and the next window opens at the
 * mark. Nothing is stranded, which is why this is a page counter and not a
 * provider-issued continuation with a lifetime — hence no `holdsContinuation`.
 */
function parseCont(cont: string | null, nowMs: () => number): { page: number; before: Date } {
  const i = cont ? cont.indexOf("|") : -1;
  if (cont && i > 0) {
    const page = Number(cont.slice(0, i));
    const before = new Date(cont.slice(i + 1));
    if (Number.isInteger(page) && page >= 1 && Number.isFinite(before.getTime())) return { page, before };
  }
  return { page: 1, before: new Date(nowMs()) };
}

/**
 * One order → the canonical events it is evidence of.
 *
 * TWO facts, not one, and they are dated differently. An order was PLACED at
 * `date_created_gmt`; it was PAID at `date_paid_gmt`, which on a bank transfer
 * or a cheque can be days later and on an unpaid order never arrives at all.
 * Collapsing them onto a single row would force one of two lies: a payment
 * dated when the cart was submitted, or an order that appears in the day's
 * count only once the money clears.
 *
 * The two share the order's id, so the poll and both webhook topics converge on
 * the same two rows however many times an order is re-read or redelivered, and
 * an unpaid order simply has no second row until it acquires one.
 *
 * `total` is the grand total the customer was charged — tax and shipping
 * included, discounts already deducted. The components stay in `properties` as
 * the strings WooCommerce sent, because they are decimal strings in major units
 * already and there is nothing to convert.
 */
function orderEvents(order: Record<string, unknown>, connectionId: string): CanonicalEvent[] {
  const rawId = order["id"];
  const id = typeof rawId === "number" && Number.isFinite(rawId) ? String(rawId) : str(rawId);
  if (!id) return [];

  const status = str(order["status"]);
  if (status && NOT_AN_ORDER.has(status)) return [];

  const placed = parseDate(gmt(order["date_created_gmt"]), "woocommerce.date_created_gmt");
  if (!placed) return [];

  const currency = str(order["currency"])?.toUpperCase() ?? null;
  const value = money(order["total"]);
  // A guest checkout has `customer_id: 0` and no account, so the billing email
  // is the only thing that identifies the buyer across their orders.
  const billing = asObject(order["billing"]);
  const customerId = typeof order["customer_id"] === "number" && order["customer_id"] > 0 ? String(order["customer_id"]) : null;
  const subject = str(billing["email"]) ?? customerId ?? id;

  const events: CanonicalEvent[] = [
    {
      eventId: eventId("woocommerce", connectionId, "order", id),
      eventType: "order_created",
      subject,
      occurredAt: placed,
      value,
      currency,
      properties: order,
    },
  ];

  const paid = parseDate(gmt(order["date_paid_gmt"]), "woocommerce.date_paid_gmt");
  if (paid) {
    events.push({
      eventId: eventId("woocommerce", connectionId, "order", id, "paid"),
      eventType: "payment_succeeded",
      subject,
      occurredAt: paid,
      value,
      currency,
      properties: order,
    });
  }
  return events;
}

export const woocommerceConnector: Connector = {
  source: "woocommerce",
  authType: "apiKey",
  importProgress: walkImportProgress,
  /**
   * No `retention`: the orders live in the merchant's own database and
   * WooCommerce forgets nothing, so a watermark can sit as long as it likes
   * without anything behind it becoming unfetchable.
   */

  /**
   * `X-WC-Webhook-Signature` — base64 of the raw HMAC-SHA256 over the delivered
   * body, keyed on the secret we supplied at registration.
   *
   * NO TIMESTAMP anywhere in the scheme, so unlike Paddle or Standard Webhooks
   * there is no staleness to check and a replay is indistinguishable from the
   * original; dedup on `eventId` is what makes that harmless. Fails closed
   * without a secret, and closed again without the header — an unsigned POST to
   * this endpoint (WooCommerce's own activation ping is one, body
   * `webhook_id=<id>`) is refused rather than believed.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-wc-webhook-signature", encoding: "base64", algorithm: "sha256" });
  },

  /**
   * A delivery for `order.created` / `order.updated` is the order resource
   * itself, fetched by WooCommerce through its own REST endpoint before
   * sending — so this is the same object the poll maps, and `orderEvents` is
   * the single place either path decides what an order means.
   *
   * A payload with no `id` or no `date_created_gmt` produces nothing: that
   * covers the deletion payload (`{"id": 123}` and no date), the activation
   * ping's form body, and anything else that reaches this route unrecognised.
   * `ctx.fallbackOccurredAt` is deliberately NOT used as a substitute — an
   * order we cannot date is one we decline to count, not one we date by its
   * arrival.
   */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    return orderEvents(asObject(rawPayload), ctx.connectionId);
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const { client, totalPages } = storeApi(args.credentials);
    const nowMs = args.budget?.nowMs ?? Date.now;

    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      now: nowMs,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const { page, before } = parseCont(cont, nowMs);
        const rows = (
          (await client.get<unknown[]>("/orders", {
            // THE WATERMARK. The request filters on `modified_after` and the
            // cursor advances on `date_modified_gmt`: one axis, so an order
            // whose status changes a month after it was placed comes back
            // round and gets re-read. Bounding on `after` instead — which is
            // what "list orders since X" reads like, and what the plan
            // assumed — would filter on `post_date`, and every payment that
            // landed after the order was created would be invisible forever.
            modified_after: wpDate(since),
            // The frozen upper bound; see parseCont.
            modified_before: wpDate(before),
            // Not optional. Without it the bounds are compared against the
            // store's LOCAL date columns while `changedAt` below reads the GMT
            // field, and under HPOS the local columns are not even in the date
            // query's table mapping.
            dates_are_gmt: true,
            // Sorted on the same field it is filtered on, oldest first, so the
            // walk moves forward through the window instead of re-reading its
            // newest page.
            orderby: "modified",
            order: "asc",
            per_page: PAGE,
            page,
          })) ?? []
        ).map(asObject);
        const pages = totalPages();
        const more = rows.length === PAGE && (pages == null || page < pages);
        return { rows, next: more ? `${page + 1}|${before.toISOString()}` : null, rateLimit: client.rateLimit() };
      },
      // The field the request bounds — see THE WATERMARK above.
      changedAt: (o) => isoOrNull(gmt(o["date_modified_gmt"])),
      // …and the field that says when the thing happened, which is what the
      // coverage span is measured on. An order edited today can have been
      // placed a year ago, and the import note must not claim a year of
      // coverage because of one edit (the walk clamps that).
      happenedAt: (o) => isoOrNull(gmt(o["date_created_gmt"])),
      map: (o) => orderEvents(o, args.connectionId)[0] ?? null,
    });

    // The walk maps one event per row; an order that has been paid is evidence
    // of two. Fan out from the rows the walk kept, the way Cal.com and
    // Pipedrive do, so the extra events cannot drift from the walked set.
    return { ...res, records: res.records.flatMap((r) => orderEvents(r.properties ?? {}, args.connectionId)) };
  },

  /**
   * NOT the walk's first page. The walk runs oldest-first inside its window, so
   * its first page is a customer's OLDEST orders — exactly the wrong thing to
   * show under "latest records". One descending request answers the question
   * that was actually asked.
   */
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { client } = storeApi(args.credentials);
    const rows =
      (await client.get<unknown[]>("/orders", {
        orderby: "modified",
        order: "desc",
        per_page: Math.max(1, Math.min(n, PAGE)),
      })) ?? [];
    return rows.flatMap((r) => orderEvents(asObject(r), args.connectionId)).slice(0, n);
  },

  /**
   * WE MINT THE SECRET, always. WooCommerce's own default is "a MD5 hash from
   * the current user's ID|username" — derived entirely from values an attacker
   * can guess or read — so a webhook created without one is signed with a key
   * that is not a secret at all.
   *
   * base64url is not incidental: WooCommerce runs the stored secret through
   * `wp_specialchars_decode( …, ENT_QUOTES )` before keying the HMAC, so a
   * secret containing an HTML entity would sign with different bytes than the
   * ones we hold. base64url's alphabet (`A-Za-z0-9_-`) cannot spell one.
   *
   * TWO SUBSCRIPTIONS, one per topic (see WOOCOMMERCE_TOPICS), joined into one
   * `externalId` because that is the field the connection has to tear down
   * later. If the second creation fails, the first is deleted before the error
   * is re-thrown — a half-registered connection would deliver `order.created`
   * with a secret nothing had stored.
   *
   * PING: WooCommerce POSTs `webhook_id=<id>`, unsigned, to the delivery URL
   * immediately after creating a webhook, and our route correctly refuses it —
   * one rejected delivery is logged at connect time and nothing else happens,
   * because the REST controller ignores `deliver_ping()`'s result and leaves
   * the webhook active. (The ADMIN UI does not; a webhook made by hand in
   * wp-admin against this URL would be disabled on the spot. That is one more
   * reason registration goes through the API.)
   */
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const { client } = storeApi(args.credentials);
    const secret = randomBytes(24).toString("base64url");
    const created: string[] = [];
    try {
      for (const topic of WOOCOMMERCE_TOPICS) {
        const res = await client.post<{ id?: number | string }>("/webhooks", {
          name: `Namzilabs (${topic})`,
          topic,
          delivery_url: args.webhookUrl,
          secret,
          status: "active",
        });
        if (res?.id != null) created.push(String(res.id));
      }
    } catch (e) {
      for (const id of created) await deleteWebhook(client, id).catch(() => {});
      throw e;
    }
    return { signingSecret: secret, externalId: created.length ? created.join(",") : undefined };
  },

  /**
   * `force=true` is REQUIRED: without it WooCommerce answers 501
   * "Webhooks do not support trashing." and the subscription keeps delivering.
   *
   * Every id in the stored list is attempted even when one of them fails, and
   * an already-deleted webhook IS success — "stop delivering to this
   * connection" is the goal, and a 404 means it is already true.
   */
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    const { client } = storeApi(args.credentials);
    let failure: unknown = null;
    for (const id of args.externalId.split(",").map((s) => s.trim()).filter(Boolean)) {
      try {
        await deleteWebhook(client, id);
      } catch (e) {
        failure = failure ?? e;
      }
    }
    if (failure) throw failure;
  },
};

async function deleteWebhook(client: { del: (path: string, params?: Record<string, string | number | boolean>) => Promise<unknown> }, id: string): Promise<void> {
  try {
    await client.del(`/webhooks/${encodeURIComponent(id)}`, { force: true });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return;
    throw e;
  }
}
