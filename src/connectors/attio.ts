import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  PollArgs,
  PollResult,
  ListOptionsArgs,
  SourceOption,
  RegisterWebhookArgs,
  RegisterWebhookResult,
  UnregisterWebhookArgs,
} from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, walkImportProgress, windowedWalk } from "./kit";

/**
 * Attio. Every record carries `created_at`, and every attribute VALUE carries
 * `active_from` — the moment that value started being true — so a deal's
 * current stage is dated by when the deal entered it, not by when we read it.
 *
 * STREAM-SCOPED ON THE OBJECT, and that follows from the webhook rather than
 * from taste. Attio's delivery carries ids and an actor and nothing else: no
 * timestamp, no attribute values, and the object as a bare UUID that cannot be
 * resolved without a second request. There is nothing a `normalize` could store
 * from it that would not be undated and unclassifiable, so this connector
 * declares none and the inbound hook is a DOORBELL — the webhook route answers
 * `isStreamScoped` after verifying the signature, rings the connection and
 * returns, and the poll below does the reading with correct stream attribution.
 * (The plan for this connector assumed the delivery embedded the record body;
 * the OpenAPI schema says it does not. The docs win.)
 *
 * Docs read 8 Sep 2026:
 * - https://docs.attio.com/rest-api/endpoint-reference/records/list-records —
 *   `POST /v2/objects/{object}/records/query`; body `{ filter, sorts, limit, offset }`,
 *   "limit … Defaults to 500", offset "Defaults to 0"; rows are
 *   `{ id: { workspace_id, object_id, record_id }, created_at, web_url, values }`.
 * - https://docs.attio.com/rest-api/attribute-types/attribute-types-timestamp —
 *   "Every Attio object has a `created_at` timestamp attribute", filtered with
 *   `$gte`/`$lt` ("remembering to use the inclusive `$gte` for the earlier
 *   bound"). THE WATERMARK: the request bounds `created_at` and the cursor
 *   advances on `created_at`, so the two cannot drift apart.
 * - https://docs.attio.com/rest-api/guides/filtering-and-sorting — a sort is
 *   `{ direction, attribute }` where `attribute` is "a slug or ID"; `created_at`
 *   is such a slug, hence `{ direction: "asc", attribute: "created_at" }`.
 * - https://docs.attio.com/rest-api/guides/pagination — limit/offset: "If the
 *   number of results you receive is less than the value of the `limit`
 *   parameter … you have reached the end of the result set".
 * - https://docs.attio.com/rest-api/attribute-types/attribute-types-status —
 *   "There's only one predefined status attribute, available on the deal object
 *   as `stage`"; a status value reads `{ active_from, status: { title } }`.
 * - https://docs.attio.com/rest-api/attribute-types/attribute-types-currency —
 *   `currency_value` + `currency_code`; the documented example returns
 *   `"currency_value": "499.00"` for $499, so the figure is ALREADY in major
 *   units (no division) and arrives as a string (hence the Number coercion).
 * - https://docs.attio.com/rest-api/attribute-types/attribute-types-personal-name
 *   and …-email-address — a person's `name` has `full_name`; `email_addresses`
 *   is multiselect with `email_address`. A company's `name` is a TEXT attribute,
 *   so it reads `value` instead.
 * - https://docs.attio.com/rest-api/guides/webhooks — `"Attio-Signature"`
 *   (duplicated as `"X-Attio-Signature"` for legacy support) = "SHA256 HMAC of
 *   the request body using your webhook secret", encoded "as a hexadecimal
 *   string"; only "the request body, which we interpret as a UTF-8 string" is
 *   signed. No timestamp in the scheme, so there is no staleness to check.
 * - https://api.attio.com/openapi/webhooks — a delivery is
 *   `{ webhook_id, events: [ { event_type, id: { … uuids }, actor } ] }`;
 *   "Currently, each delivery contains exactly one event, but this may change in
 *   the future to support batching". No timestamp and no values anywhere in it.
 * - https://docs.attio.com/rest-api/endpoint-reference/webhooks/create-a-webhook —
 *   `POST /v2/webhooks { data: { target_url, subscriptions: [{ event_type, filter }] } }`
 *   → `data.id.webhook_id` and `data.secret`; `record.created` is in the enum.
 * - https://docs.attio.com/rest-api/endpoint-reference/webhooks/delete-a-webhook —
 *   `DELETE /v2/webhooks/{webhook_id}`.
 * - https://docs.attio.com/rest-api/endpoint-reference/objects/list-objects —
 *   `GET /v2/objects` → `{ data: [{ id: { object_id }, api_slug, singular_noun,
 *   plural_noun }] }`, "all system-defined and user-defined objects".
 * - https://docs.attio.com/rest-api/guides/rate-limiting — "Read requests: 100
 *   requests per second"; list-records additionally scores each query against
 *   "a sliding window algorithm with a 10 second window".
 */
const API = "https://api.attio.com/v2";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 90, overlapMs: 5 * 60_000 };
/** The endpoint's own default page size; the walk pages by offset until a short page. */
const PAGE = 500;

/**
 * ONLY `record.created`, deliberately.
 *
 * The doorbell is worth ringing exactly when an immediate poll would see
 * something new, and the poll is bounded by `created_at`: a fresh record lands
 * inside the window, an edit to an older one never does. Subscribing to
 * `record.updated` would ring for every keystroke in the CRM and change
 * nothing that gets read.
 */
export const ATTIO_SUBSCRIPTIONS = ["record.created"] as const;

/**
 * What "a record was created" MEANS, per object.
 *
 * Attio is object-agnostic — a workspace can invent objects — so the mapping
 * is declared for the three standard ones whose business meaning is not in
 * doubt and left honest for the rest. A company and a person are both someone
 * entering the CRM; a step reads ONE object, so the two never sum unless a
 * metric deliberately spans both.
 */
export const ATTIO_OBJECT_EVENT: Record<string, string> = {
  deals: "opportunity_created",
  people: "lead_created",
  companies: "lead_created",
};

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Attio"), "Attio");

/** Attio returns every attribute as an array of values; the live one is first. */
const first = (values: Record<string, unknown>, key: string): Record<string, unknown> =>
  Array.isArray(values[key]) ? asObject((values[key] as unknown[])[0]) : {};

/** A person's name is a personal-name (`full_name`); a company's or deal's is text (`value`). */
const nameOf = (values: Record<string, unknown>): string | null => str(first(values, "name")["full_name"]) ?? str(first(values, "name")["value"]);
const emailOf = (values: Record<string, unknown>): string | null =>
  str(first(values, "email_addresses")["email_address"]) ?? str(first(values, "email_address")["email_address"]);

/** Attio currency values are already MAJOR units (the docs' $499 reads "499.00"), and arrive as strings. */
function money(values: Record<string, unknown>): { value: number | null; currency: string | null } {
  const c = first(values, "value");
  const raw = c["currency_value"];
  const n = raw == null ? NaN : Number(raw);
  return { value: Number.isFinite(n) ? n : null, currency: str(c["currency_code"])?.toUpperCase() ?? null };
}

const stageKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, "_");

/**
 * One record → its creation, plus the stage it currently sits in.
 *
 * The stage event is dated by the status value's `active_from` — when the deal
 * ENTERED that stage — not by when this poll happened to read it, and its id
 * carries the stage so a deal that moves twice yields two rows rather than one
 * that keeps being rewritten.
 */
export function attioRecordEvents(object: string, rec: Record<string, unknown>, connectionId: string): CanonicalEvent[] {
  const recordId = str(asObject(rec["id"])["record_id"]);
  const createdAt = parseDate(str(rec["created_at"]), "created_at");
  if (!recordId || !createdAt) return [];
  const values = asObject(rec["values"]);
  const base = eventId("attio", connectionId, object, recordId);
  const { value, currency } = money(values);
  const subject = emailOf(values) ?? nameOf(values);
  const out: CanonicalEvent[] = [
    {
      eventId: base,
      eventType: ATTIO_OBJECT_EVENT[object] ?? "record_created",
      subject,
      occurredAt: createdAt,
      value,
      currency,
      properties: rec,
    },
  ];
  const stage = first(values, "stage");
  const title = str(asObject(stage["status"])["title"]);
  const activeFrom = parseDate(str(stage["active_from"]), "active_from");
  if (title && activeFrom) {
    out.push({
      eventId: `${base}:stage:${stageKey(title)}`,
      eventType: "deal_stage_changed",
      subject,
      occurredAt: activeFrom,
      value,
      currency,
      properties: { ...rec, stage: title },
    });
  }
  return out;
}

export const attioConnector: Connector = {
  source: "attio",
  authType: "apiKey",
  operations: ["records.query", "objects.list"] as const,
  operationFor: () => "records.query",
  listOperationFor: (key) => (key === "object" ? "objects.list" : undefined),
  importProgress: walkImportProgress,
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    // Two header names for one scheme: Attio sends both, and a proxy that
    // strips unprefixed vendor headers leaves only the legacy one.
    return ["attio-signature", "x-attio-signature"].some((header) => hmacHeaderVerify({ rawBody, headers, secret }, { header, encoding: "hex" }));
  },
  // No `normalize`: see the header. The delivery has no event to map.
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "object") return [];
    const res = await api(args.credentials).get<{ data?: unknown[] }>("/objects");
    return (res.data ?? [])
      .map(asObject)
      .map((o) => ({ value: str(o["api_slug"]) ?? "", label: str(o["plural_noun"]) ?? str(o["singular_noun"]) ?? str(o["api_slug"]) ?? "Object" }))
      .filter((o) => o.value);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const object = str(args.config?.["object"]);
    if (!object) return { records: [], nextCursor: null };
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const offset = cont ? Number(cont) || 0 : 0;
        const page = await client.post<{ data?: unknown[] }>(`/objects/${encodeURIComponent(object)}/records/query`, {
          filter: { created_at: { $gte: since.toISOString() } },
          sorts: [{ direction: "asc", attribute: "created_at" }],
          limit: PAGE,
          offset,
        });
        const rows = (page.data ?? []).map(asObject);
        // Limit/offset: a short page is the end of the result set.
        return { rows, next: rows.length === PAGE ? String(offset + PAGE) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (r) => isoOrNull(r["created_at"]),
      map: (r) => attioRecordEvents(object, r, args.connectionId)[0] ?? null,
    });
    // The walk keeps ONE event per row so the mark advances once per record;
    // the stage event is fanned back out afterwards from the row it kept.
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...attioRecordEvents(object, r.properties ?? {}, args.connectionId));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const res = await api(args.credentials).post<{ data?: { id?: { webhook_id?: string }; secret?: string } }>("/webhooks", {
      data: {
        target_url: args.webhookUrl,
        subscriptions: ATTIO_SUBSCRIPTIONS.map((event_type) => ({ event_type, filter: null })),
      },
    });
    return { signingSecret: res.data?.secret, externalId: res.data?.id?.webhook_id };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return; // already gone is success
      throw e;
    }
  },
};
