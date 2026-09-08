import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Typeform. A response carries landed_at (started) and submitted_at
 * (completed), so one row yields the lead AND the funnel-top event; the
 * year-1 sentinel on submitted_at means "not completed". Stream-scoped:
 * each flow reads one form.
 *
 * Docs read 8 Sep 2026:
 * - developers/responses/reference/retrieve-responses — GET /forms/{form_id}/responses;
 *   `since` "Filters by submitted_at for completed" responses (the default
 *   response_type), so submitted_at is the watermark; `after` is an exclusive
 *   cursor (the last token); `page_size` up to 1000; `sort` defaults to
 *   submitted_at,desc; "0001-01-01T00:00:00Z" for incomplete responses.
 * - developers/webhooks/secure-your-webhooks — `Typeform-Signature: sha256=<base64
 *   HMAC-SHA256 over the raw body>`, keyed on the webhook's `secret`.
 * - developers/webhooks/example-payload — { event_id, event_type: "form_response",
 *   form_response: { form_id, token, landed_at, submitted_at, answers[], hidden } };
 *   "The answers array is populated only with answered questions."
 * - developers/get-started — "two requests per second, per Typeform account".
 * - developers/webhooks/reference/create-or-update-webhook — PUT
 *   /forms/{form_id}/webhooks/{tag} { url, enabled, event_types, secret,
 *   verify_ssl }; `secret` is "If specified, will be used to sign the webhook
 *   payload with HMAC SHA256" and is echoed back on the response object
 *   (created_at, enabled, event_types, form_id, id, secret, tag, updated_at,
 *   url, verify_ssl). WE choose that string — Typeform never mints one.
 * - developers/webhooks/reference/delete-webhook — DELETE
 *   /forms/{form_id}/webhooks/{tag}; "204 No content" on success,
 *   "404 Not found — Webhook or form not found".
 *
 * NO CONNECT-TIME AUTO-REGISTRATION, and the reason is the path itself: every
 * webhook endpoint Typeform publishes lives under /forms/{form_id}, and the
 * form is a flowField chosen inside a step, not at connect
 * (`isStreamScoped("typeform")` is true). At connect time there is no form to
 * register against, so `autoWebhook` stays false and no `registerWebhook`
 * exists here. Registering at STREAM creation would be entirely feasible and is
 * the place to build it if it is ever wanted: a connection holds ONE signing
 * secret, `secret` is ours to supply rather than the provider's to mint, so a
 * PUT per form carrying that same secret makes every form's deliveries verify
 * against the one stored value, and DELETE with the same tag tears it down
 * (404 = already gone = success).
 *
 * What the webhook buys is a DOORBELL, not data. The inbound route answers
 * `isStreamScoped` before it stores anything — it promotes cadence and asks for
 * a sweep — so a delivery only decides WHEN the poll runs, and `normalize`
 * below has no production caller today. The poll is the sole ingest path, which
 * is why the secret is optional: with none set, deliveries 401 and the only
 * thing lost is freshness.
 */
const API = "https://api.typeform.com";
const SENTINEL = "0001-01-01T00:00:00Z";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 1000;

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Typeform"), "Typeform");

/** Answers keyed by the field's ref (the author's name for it) or id, with the typed value unwrapped. */
function answersByField(answers: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of Array.isArray(answers) ? answers.map(asObject) : []) {
    const field = asObject(a["field"]);
    const id = str(field["ref"]) ?? str(field["id"]);
    if (!id) continue;
    const type = str(a["type"]);
    const raw = type ? a[type] : undefined;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const o = asObject(raw);
      out[id] = o["label"] ?? o["labels"] ?? raw;
    } else out[id] = raw;
  }
  return out;
}

function events(r: Record<string, unknown>, formId: string, connectionId: string): CanonicalEvent[] {
  const token = str(r["token"]) ?? str(r["response_id"]);
  if (!token) return [];
  const answers = Array.isArray(r["answers"]) ? (r["answers"] as unknown[]).map(asObject) : [];
  const email = str(answers.find((a) => a["type"] === "email")?.["email"]);
  const props = { ...r, form_id: formId, answers_by_field: answersByField(r["answers"]) };
  const base = eventId("typeform", connectionId, formId, token);
  const out: CanonicalEvent[] = [];
  const submitted = str(r["submitted_at"]);
  const submittedAt = submitted && submitted !== SENTINEL ? parseDate(submitted, "submitted_at") : null;
  if (submittedAt) out.push({ eventId: base, eventType: "form_submitted", subject: email ?? token, occurredAt: submittedAt, properties: props });
  const landed = parseDate(str(r["landed_at"]), "landed_at");
  if (landed) out.push({ eventId: `${base}:started`, eventType: "form_started", subject: email ?? token, occurredAt: landed, properties: props });
  return out;
}

export const typeformConnector: Connector = {
  source: "typeform",
  authType: "apiKey",
  operations: ["responses.list"] as const,
  operationFor: () => "responses.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "typeform-signature", encoding: "base64", prefix: "sha256=" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const fr = asObject(body["form_response"]);
    const formId = str(fr["form_id"]) ?? "form";
    return events(fr, formId, ctx.connectionId);
  },
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "formId") return [];
    const res = await api(args.credentials).get<{ items?: unknown[] }>("/forms", { page_size: 200 });
    return (res.items ?? []).map(asObject).map((f) => ({ value: str(f["id"]) ?? "", label: str(f["title"]) ?? str(f["id"]) ?? "Untitled form" })).filter((o) => o.value);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const formId = str(args.config?.["formId"]);
    if (!formId) return { records: [], nextCursor: null };
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ items?: unknown[] }>(`/forms/${encodeURIComponent(formId)}/responses`, {
          page_size: PAGE,
          since: since.toISOString(),
          sort: "submitted_at,asc",
          after: cont ?? undefined,
        });
        const rows = (page.items ?? []).map(asObject);
        const last = rows.length ? str(rows[rows.length - 1]["token"]) : null;
        return { rows, next: rows.length === PAGE && last ? last : null, rateLimit: client.rateLimit() };
      },
      changedAt: (r) => (str(r["submitted_at"]) === SENTINEL ? isoOrNull(r["landed_at"]) : isoOrNull(r["submitted_at"])),
      map: (r) => events(r, formId, args.connectionId)[0] ?? null,
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...events(r.properties ?? {}, formId, args.connectionId));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
