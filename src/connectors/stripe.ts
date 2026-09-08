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
import { asObject, str } from "./field-utils";
import { fetchJson, HttpError } from "@/lib/http-client";
import { bearerClient, epochToDate, eventId, parseWalkCursor, requireCredential, timestampedHmacVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * Stripe. Every money movement is an immutable, signed, dated Event; the
 * webhook and the poll both hand us Event objects, so one `toCanonical`
 * serves both and `eventId` = the Stripe event id dedupes across paths.
 *
 * Docs read 8 Sep 2026:
 * - https://docs.stripe.com/api/events/list — "List events, going back up to
 *   30 days"; `created[gte]`, `types[]` (≤ 20), `limit` 1–100, `starting_after`,
 *   `has_more`. Hence `retention` and the entry's historyNote.
 * - https://docs.stripe.com/webhooks — `Stripe-Signature: t=…,v1=…`, HMAC-SHA256
 *   over "{t}.{raw body}" keyed on the `whsec_` secret; several `v1=` during a
 *   secret roll; ignore `v0`; 5-minute tolerance.
 * - https://docs.stripe.com/api/events/types — `charge.refunded` says "Listen to
 *   refund.created for information about the refund", and `charge.succeeded` and
 *   `payment_intent.succeeded` describe one payment: one event type per fact.
 * - https://docs.stripe.com/currencies — zero-decimal list; ISK and UGX are
 *   represented as two-decimal for backward compatibility, so they are NOT here.
 * - https://docs.stripe.com/api/webhook_endpoints/create — POST
 *   /v1/webhook_endpoints, `url` and `enabled_events` both required:
 *   "Returns the webhook endpoint object with the `secret` field populated",
 *   and the sample response carries `"secret": "whsec_…"` beside `"id": "we_…"`.
 *   So the key that already reads /v1/events can mint the endpoint AND its
 *   signing secret in one call — NOBODY PASTES A whsec_ ANY MORE.
 * - https://docs.stripe.com/api/webhook_endpoints/delete — `curl -X DELETE
 *   https://api.stripe.com/v1/webhook_endpoints/{id}`; "Otherwise, this call
 *   raises an error, such as if the webhook endpoint has already been deleted"
 *   — precisely the 404 `unregisterWebhook` swallows as success.
 * - https://docs.stripe.com/api/authentication — "The Stripe API authenticates
 *   requests using HTTP Basic Auth… If you need to authenticate using bearer
 *   auth… use `-H "Authorization: Bearer …"`", so the poll's Bearer header is
 *   good for the write too. The v1 API takes FORM-ENCODED bodies (every sample
 *   is `-d` / `--data-urlencode`) and the kit's client posts JSON — hence
 *   `postForm` below rather than `client.post`.
 * - https://docs.stripe.com/stripe-apps/reference/permissions — "Webhook
 *   Endpoints, Event Destinations | webhook_read, webhook_write … This is a
 *   sensitive permission because it allows subscribing to events across your
 *   entire account." A restricted key scoped to Events: read alone therefore
 *   CANNOT create the endpoint — which is why the catalog marks this webhook
 *   optional: the 30-day poll is the primary path and stands on its own.
 *
 * NOT used: POST /v2/core/event_destinations. It needs a pinned `Stripe-Version`
 * header, an explicit `event_payload: "snapshot"` + `snapshot_api_version` to
 * emit the v1 Event objects this connector normalizes, and its response returns
 * `"signing_secret": null` unless `include: ["webhook_endpoint.signing_secret"]`
 * is asked for (docs.stripe.com/api/v2/core/event_destinations/create, read
 * 8 Sep 2026). Three extra moving parts for the same subscription — v1 wins.
 */
const API = "https://api.stripe.com/v1";
/** Shown beside the endpoint we create, in the customer's own Stripe dashboard. */
const WEBHOOK_DESCRIPTION = "Namzilabs";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** Stripe event types we count → our vocabulary. One per business fact. */
export const STRIPE_EVENT_TYPES: Record<string, string> = {
  "charge.succeeded": "payment_succeeded",
  "checkout.session.completed": "checkout_completed",
  "invoice.paid": "invoice_paid",
  "refund.created": "payment_refunded",
  "customer.subscription.created": "subscription_created",
  "customer.subscription.updated": "subscription_updated",
  "customer.subscription.deleted": "subscription_canceled",
};

/**
 * Stripe v1 speaks `application/x-www-form-urlencoded` and nothing else, while
 * the kit's `providerClient` posts JSON — so the one write this connector makes
 * goes through `fetchJson` directly. A failure keeps Stripe's OWN error body
 * (HttpError quotes it), which for a restricted key names the missing
 * permission far better than anything we could paraphrase.
 */
async function postForm<T>(path: string, apiKey: string, form: URLSearchParams): Promise<T> {
  return fetchJson<T>(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

function money(amount: unknown, currency: unknown): { value: number | null; currency: string | null } {
  const cur = str(currency)?.toLowerCase() ?? null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || !cur) return { value: null, currency: cur ? cur.toUpperCase() : null };
  return { value: ZERO_DECIMAL.has(cur) ? n : n / 100, currency: cur.toUpperCase() };
}

/** Sum of items' unit_amount × quantity, in major units — the plan's recurring price, interval kept in properties. */
function subscriptionValue(sub: Record<string, unknown>): { value: number | null; currency: string | null } {
  const items = asObject(sub["items"]);
  const rows = Array.isArray(items["data"]) ? (items["data"] as unknown[]).map(asObject) : [];
  let total = 0;
  let currency: unknown = sub["currency"] ?? null;
  for (const it of rows) {
    const price = asObject(it["price"]);
    const unit = Number(price["unit_amount"] ?? 0) || 0;
    const qty = Number(it["quantity"] ?? 1) || 1;
    total += unit * qty;
    currency = currency ?? price["currency"];
  }
  return rows.length ? money(total, currency) : { value: null, currency: null };
}

function toCanonical(evt: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const id = str(evt["id"]);
  const type = str(evt["type"]);
  const ours = type ? STRIPE_EVENT_TYPES[type] : undefined;
  if (!id || !type || !ours) return null;
  const obj = asObject(asObject(evt["data"])["object"]);
  const eventCreated = epochToDate(evt["created"], "s");
  let occurredAt: Date | null = epochToDate(obj["created"], "s");
  let subject: string | null = str(obj["customer"]);
  let amount: { value: number | null; currency: string | null } = { value: null, currency: null };
  switch (type) {
    case "charge.succeeded": {
      const billing = asObject(obj["billing_details"]);
      subject = str(billing["email"]) ?? str(obj["receipt_email"]) ?? subject;
      amount = money(obj["amount"], obj["currency"]);
      break;
    }
    case "checkout.session.completed": {
      subject = str(asObject(obj["customer_details"])["email"]) ?? str(obj["customer_email"]) ?? subject;
      // A completed session with a delayed payment method is not yet money;
      // payment_status says so. The count stands, the value waits.
      amount = obj["payment_status"] === "paid" ? money(obj["amount_total"], obj["currency"]) : { value: null, currency: str(obj["currency"])?.toUpperCase() ?? null };
      break;
    }
    case "invoice.paid": {
      occurredAt = epochToDate(asObject(obj["status_transitions"])["paid_at"], "s") ?? occurredAt;
      subject = str(obj["customer_email"]) ?? subject;
      amount = money(obj["amount_paid"], obj["currency"]);
      break;
    }
    case "refund.created": {
      subject = str(obj["charge"]) ?? str(obj["customer"]) ?? subject;
      amount = money(obj["amount"], obj["currency"]);
      break;
    }
    case "customer.subscription.created":
      amount = subscriptionValue(obj);
      break;
    case "customer.subscription.updated":
      occurredAt = eventCreated;
      amount = subscriptionValue(obj);
      break;
    case "customer.subscription.deleted":
      occurredAt = epochToDate(obj["canceled_at"], "s") ?? epochToDate(obj["ended_at"], "s") ?? eventCreated;
      amount = subscriptionValue(obj);
      break;
  }
  return {
    eventId: eventId("stripe", connectionId, id),
    eventType: ours,
    subject,
    occurredAt: occurredAt ?? eventCreated ?? fallback ?? new Date(),
    value: amount.value,
    currency: amount.currency,
    // The Event envelope: type, created, api_version, livemode — and the object under data.object.
    properties: evt,
  };
}

export const stripeConnector: Connector = {
  source: "stripe",
  authType: "apiKey",
  operations: ["events.list"] as const,
  operationFor: () => "events.list",
  importProgress: walkImportProgress,
  retention: { days: 30, alarmAfterDays: 25, watermarkOf: (cursor) => parseWalkCursor(cursor).hw },
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify(
      { rawBody, headers, secret },
      { header: "stripe-signature", timestampKey: "t", signatureKey: "v1", message: (t, body) => `${t}.${body}` },
    );
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const ev = toCanonical(asObject(rawPayload), ctx.connectionId, ctx.fallbackOccurredAt);
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const api = bearerClient(API, requireCredential(args.credentials, "apiKey", "Stripe"), "Stripe");
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        // `types[]` repeats, which URLSearchParams handles; the client's params
        // map cannot, so the query is built here.
        const q = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(since.getTime() / 1000)) });
        for (const t of Object.keys(STRIPE_EVENT_TYPES)) q.append("types[]", t);
        if (cont) q.set("starting_after", cont);
        const page = await api.get<{ data?: unknown[]; has_more?: boolean }>(`/events?${q.toString()}`);
        const rows = (page.data ?? []).map(asObject);
        const last = rows.length ? str(rows[rows.length - 1]["id"]) : null;
        return { rows, next: page.has_more && last ? last : null, rateLimit: api.rateLimit() };
      },
      changedAt: (r) => epochToDate(r["created"], "s")?.toISOString() ?? null,
      map: (r) => toCanonical(r, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const form = new URLSearchParams({ url: args.webhookUrl, description: WEBHOOK_DESCRIPTION });
    // THE SAME seven types the poll asks /v1/events for, read from the one map,
    // so the two paths cannot drift into subscribing to different facts.
    for (const t of Object.keys(STRIPE_EVENT_TYPES)) form.append("enabled_events[]", t);
    // `api_version` is deliberately left unset. Pinning it would render
    // deliveries at a version of OUR choosing while /v1/events keeps answering
    // the poll at the ACCOUNT's default — two shapes for one `toCanonical`, and
    // a silent divergence the day Stripe changes a field. Unset means both
    // paths speak the account's version, whatever it is.
    const res = await postForm<{ id?: unknown; secret?: unknown }>(
      "/webhook_endpoints",
      requireCredential(args.credentials, "apiKey", "Stripe"),
      form,
    );
    return { signingSecret: str(res.secret) ?? undefined, externalId: str(res.id) ?? undefined };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    const api = bearerClient(API, requireCredential(args.credentials, "apiKey", "Stripe"), "Stripe");
    try {
      await api.del(`/webhook_endpoints/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return; // already gone is success
      throw e;
    }
  },
};
