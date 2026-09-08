import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Tally. Submissions carry submittedAt and an explicit isCompleted, so
 * completed vs partial is a field, not a heuristic. One form per step.
 *
 * Docs read 8 Sep 2026:
 * - developers.tally.so/api-reference/introduction — https://api.tally.so,
 *   `Authorization: Bearer`, "100 per minute".
 * - …/endpoint/forms/submissions/list — GET /forms/{formId}/submissions with
 *   `page`, `limit` (max 500), `filter` ∈ all | completed | partial,
 *   `startDate` "submitted on or after", `endDate`; response { page, limit,
 *   hasMore, submissions[{ id, formId, isCompleted, submittedAt, responses[
 *   { questionId, answer }] }], questions[{ id, title, type }] }.
 * - …/endpoint/forms/list — GET /forms → { items[{ id, name }], hasMore }.
 * - …/endpoint/webhooks/post — POST /webhooks, requestBody
 *   `"required": ["formId", "url", "eventTypes"]` (openapi.json), with
 *   `signingSecret` "Optional secret used to sign webhook payloads"
 *   (nullable) — so a secret WE mint is accepted. 201 returns
 *   { id, url, eventTypes, isEnabled, createdAt } and NOT the secret.
 * - …/endpoint/webhooks/get — GET /webhooks does return each webhook's
 *   `signingSecret` ("Secret used to sign webhook payloads", nullable).
 * - …/endpoint/webhooks/delete — DELETE /webhooks/{webhookId} → 204, 404
 *   "Webhook not found".
 * - tally.so/help/webhooks — "Publish your form and go to the Integrations
 *   tab. Click Connect to Webhooks."; `Tally-Signature` = base64 HMAC-SHA256
 *   over JSON.stringify(payload) keyed on the signing secret; delivery
 *   { eventId, eventType, createdAt, data: { responseId, submissionId,
 *   respondentId, formId, formName, createdAt, fields[{ key, label, type, value }] } }.
 *
 * NO `registerWebhook`, AND THE REASON IS THE SHAPE OF THE PROVIDER, NOT AN
 * OMISSION. Tally has no account- or workspace-wide subscription: every
 * webhook belongs to ONE form, and `formId` is required on the create call.
 * This connector is STREAM-SCOPED (`isStreamScoped("tally")` is true — its
 * only flowField, `formId`, carries no readFilter), so the form is chosen
 * inside a flow's Get data step, long after connecting. At connect time the
 * one required argument does not exist yet, and `createConnection` is the
 * only caller `registerWebhook` has. Registering across every form the key
 * can see would be a different promise than the one the customer made — it
 * would plant subscriptions on forms no step reads, and still miss every
 * form created afterwards.
 *
 * So the signing secret stays a credential field, and it is honestly
 * OPTIONAL: `poll` reads the same submissions with `filter: "all"`, so
 * completed AND partial arrive without any webhook at all. The webhook is a
 * doorbell that makes them instant. Blank means `createConnection` mints one
 * (`entry.instant`) for the customer to paste into Tally's own field.
 *
 * If a stream-creation hook ever lands, everything it needs is already
 * documented above: `formId` is known by then, POST accepts our minted
 * `signingSecret` (and GET reads one back), `externalSubscriber` can carry
 * the stream id, and DELETE tears it down.
 */
const API = "https://api.tally.so";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 500;

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Tally"), "Tally");

function byLabel(fields: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of Array.isArray(fields) ? fields.map(asObject) : []) {
    const label = str(f["label"]) ?? str(f["key"]);
    if (label) out[label] = f["value"];
  }
  return out;
}

function emailIn(values: Record<string, unknown>): string | null {
  for (const v of Object.values(values)) if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  return null;
}

function fromSubmission(s: Record<string, unknown>, questions: Map<string, string>, connectionId: string): CanonicalEvent | null {
  const id = str(s["id"]);
  const formId = str(s["formId"]) ?? "form";
  const at = parseDate(str(s["submittedAt"]), "submittedAt");
  if (!id || !at) return null;
  const values: Record<string, unknown> = {};
  for (const r of Array.isArray(s["responses"]) ? (s["responses"] as unknown[]).map(asObject) : []) {
    const q = str(r["questionId"]);
    if (q) values[questions.get(q) ?? q] = r["answer"];
  }
  const completed = s["isCompleted"] !== false;
  return {
    eventId: eventId("tally", connectionId, formId, id),
    eventType: completed ? "form_submitted" : "form_partial",
    subject: emailIn(values) ?? str(s["respondentId"]),
    occurredAt: at,
    properties: { ...s, fields_by_label: values },
  };
}

export const tallyConnector: Connector = {
  source: "tally",
  authType: "apiKey",
  operations: ["submissions.list"] as const,
  operationFor: () => "submissions.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    // Tally's own example signs JSON.stringify(payload). That is the raw body
    // when Tally serialises compactly; the re-serialised form is tried second
    // in case a proxy re-indented it.
    if (hmacHeaderVerify({ rawBody, headers, secret }, { header: "tally-signature", encoding: "base64" })) return true;
    try {
      const compact = JSON.stringify(JSON.parse(rawBody));
      return compact !== rawBody && hmacHeaderVerify({ rawBody: compact, headers, secret }, { header: "tally-signature", encoding: "base64" });
    } catch {
      return false;
    }
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    if (str(body["eventType"]) !== "FORM_RESPONSE") return [];
    const d = asObject(body["data"]);
    const id = str(d["submissionId"]) ?? str(d["responseId"]);
    const formId = str(d["formId"]) ?? "form";
    const at = parseDate(str(d["createdAt"]), "createdAt") ?? parseDate(str(body["createdAt"]), "createdAt") ?? ctx.fallbackOccurredAt ?? new Date();
    if (!id) return [];
    const values = byLabel(d["fields"]);
    return [{ eventId: eventId("tally", ctx.connectionId, formId, id), eventType: "form_submitted", subject: emailIn(values) ?? str(d["respondentId"]), occurredAt: at, properties: { ...d, fields_by_label: values } }];
  },
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "formId") return [];
    const res = await api(args.credentials).get<{ items?: unknown[] }>("/forms", { page: 1, limit: 500 });
    return (res.items ?? []).map(asObject).map((f) => ({ value: str(f["id"]) ?? "", label: str(f["name"]) ?? str(f["id"]) ?? "Untitled form" })).filter((o) => o.value);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const formId = str(args.config?.["formId"]);
    if (!formId) return { records: [], nextCursor: null };
    const client = api(args.credentials);
    const questions = new Map<string, string>();
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = cont ? Number(cont) || 1 : 1;
        const res = await client.get<{ hasMore?: boolean; submissions?: unknown[]; questions?: unknown[] }>(`/forms/${encodeURIComponent(formId)}/submissions`, {
          page,
          limit: PAGE,
          filter: "all",
          startDate: since.toISOString(),
        });
        for (const q of (res.questions ?? []).map(asObject)) {
          const id = str(q["id"]);
          const title = str(q["title"]);
          if (id && title) questions.set(id, title);
        }
        return { rows: (res.submissions ?? []).map(asObject), next: res.hasMore ? String(page + 1) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (s) => isoOrNull(s["submittedAt"]),
      map: (s) => fromSubmission(s, questions, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
