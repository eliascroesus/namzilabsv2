import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { basicClient, epochToDate, eventId, requireCredential, sharedTokenVerify, windowedWalk } from "./kit";

/**
 * Aircall. Calls carry started_at / answered_at / ended_at separately, so
 * pickup rate is "answered_at is not null" and talk time is a subtraction
 * (`duration` is documented as ended_at − started_at, so it INCLUDES ring
 * time — never talk time).
 *
 * Docs read 8 Sep 2026 (developers.aircall.io/api-references):
 * - Basic auth, api_id:api_token. 120 requests/minute per company, with
 *   X-AircallApi-Limit / -Remaining / -Reset headers.
 * - GET /v1/calls?from&to (UNIX seconds, on the call's creation)&order=asc
 *   &page&per_page (1–50) → { meta: { next_page_link, … }, calls: [] }.
 * - POST /v1/webhooks { custom_name, url, events } → webhook_id + token;
 *   DELETE /v1/webhooks/:id. The token "is sent with each webhook delivery
 *   for verification purposes" — the only scheme in Aircall's own docs; the
 *   third-party HMAC header claim is not built.
 * - Delivery body: { resource, event, timestamp, token, data }.
 */
const API = "https://api.aircall.io/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
export const AIRCALL_EVENTS = ["call.created", "call.answered", "call.ended", "call.tagged", "call.voicemail_left"] as const;

const api = (c?: Record<string, unknown> | null) => basicClient(API, requireCredential(c, "apiId", "Aircall"), requireCredential(c, "apiToken", "Aircall"), "Aircall");
const secs = (v: unknown) => epochToDate(v, "s");
const idOf = (v: unknown) => (typeof v === "number" ? String(v) : str(v));

function events(call: Record<string, unknown>, connectionId: string, only?: string): CanonicalEvent[] {
  const id = idOf(call["id"]);
  if (!id) return [];
  const rep = str(asObject(call["user"])["email"]);
  const started = secs(call["started_at"]);
  const answered = secs(call["answered_at"]);
  const ended = secs(call["ended_at"]);
  const talk = answered && ended ? Math.max(0, (ended.getTime() - answered.getTime()) / 1000) : 0;
  const ring = started && answered ? Math.max(0, (answered.getTime() - started.getTime()) / 1000) : null;
  const props = { ...call, talk_seconds: talk, ring_seconds: ring };
  const base = eventId("aircall", connectionId, id);
  const out: CanonicalEvent[] = [];
  const want = (e: string) => !only || only === e;
  if (want("call.created") && started) out.push({ eventId: base, eventType: "call_logged", subject: rep, occurredAt: started, properties: props });
  if (want("call.answered") && answered) out.push({ eventId: `${base}:connected`, eventType: "call_connected", subject: rep, occurredAt: answered, properties: props });
  if (want("call.ended") && ended) {
    out.push(
      answered
        ? { eventId: `${base}:completed`, eventType: "call_completed", subject: rep, occurredAt: ended, value: talk, properties: props }
        : { eventId: `${base}:completed`, eventType: "call_missed", subject: rep, occurredAt: ended, value: 0, properties: props },
    );
  }
  if (only === "call.tagged") out.push({ eventId: `${base}:tagged`, eventType: "call_tagged", subject: rep, occurredAt: ended ?? started ?? new Date(), properties: props });
  if (only === "call.voicemail_left") out.push({ eventId: `${base}:voicemail`, eventType: "voicemail_left", subject: rep, occurredAt: ended ?? started ?? new Date(), properties: props });
  return out;
}

export const aircallConnector: Connector = {
  source: "aircall",
  authType: "apiKey",
  operations: ["calls.list"] as const,
  operationFor: () => "calls.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    let token: string | null = null;
    try {
      token = str(asObject(JSON.parse(rawBody))["token"]);
    } catch {
      return false;
    }
    return sharedTokenVerify({ rawBody, headers, secret }, { token });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const event = str(body["event"]);
    if (!event) return [];
    return events(asObject(body["data"]), ctx.connectionId, event);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const now = Math.floor(Date.now() / 1000);
    // One row → up to three events; windowedWalk maps one-to-one, so the
    // lifecycle is fanned out after the walk from the records' properties.
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = cont ? Number(cont) || 1 : 1;
        const res = await client.get<{ calls?: unknown[]; meta?: { next_page_link?: string | null } }>("/calls", {
          from: Math.floor(since.getTime() / 1000),
          to: now,
          order: "asc",
          per_page: 50,
          page,
        });
        const rows = (res.calls ?? []).map(asObject);
        return { rows, next: res.meta?.next_page_link ? String(page + 1) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (c) => secs(c["started_at"])?.toISOString() ?? null,
      map: (c) => events(c, args.connectionId, "call.created")[0] ?? null,
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...events(r.properties ?? {}, args.connectionId));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const res = await api(args.credentials).post<{ webhook?: { webhook_id?: string; token?: string }; webhook_id?: string; token?: string }>("/webhooks", {
      custom_name: "Namzilabs",
      url: args.webhookUrl,
      events: [...AIRCALL_EVENTS],
    });
    const w = res.webhook ?? res;
    return { signingSecret: w.token, externalId: w.webhook_id };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
