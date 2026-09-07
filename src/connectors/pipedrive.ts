import { randomBytes } from "node:crypto";
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError, basicAuth } from "@/lib/http-client";
import { safeEqual } from "@/lib/signatures";
import { eventId, headerKeyClient, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Pipedrive. The deal itself carries add_time, stage_change_time, won_time
 * and lost_time, so both paths date events by when they happened;
 * expected_close_date is a forecast and stays in properties.
 *
 * Docs read 8 Sep 2026:
 * - pipedrive.readme.io/docs/core-api-concepts-authentication — "The API token
 *   must be provided in the `x-api-token` header"; base URL
 *   https://{companydomain}.pipedrive.com/api/v2 (api.pipedrive.com routes by token).
 * - developers.pipedrive.com/docs/api/v1/Deals (GET /api/v2/deals) — `updated_since`
 *   (RFC3339, "at or after"), `sort_by` ∈ id | update_time | add_time,
 *   `sort_direction`, `limit` ≤ 500, `cursor` → additional_data.next_cursor.
 *   So the watermark is update_time.
 * - pipedrive.readme.io/docs/guide-for-webhooks-v2 — POST /v1/webhooks
 *   { subscription_url, event_action, event_object, version: "2.0",
 *   http_auth_user, http_auth_password }; deliveries carry meta + data +
 *   previous ("only the fields that have changed"). No signature: HTTP Basic
 *   on our endpoint is the whole verification, so the signing secret is the
 *   password we set at registration.
 */
const DEFAULT_API = "https://api.pipedrive.com";
const BASIC_USER = "namzilabs";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

function api(c?: Record<string, unknown> | null) {
  const domain = str(c?.["companyDomain"])?.replace(/^https?:\/\//, "").replace(/\.pipedrive\.com.*$/, "").trim();
  const base = domain ? `https://${domain}.pipedrive.com` : DEFAULT_API;
  return headerKeyClient(base, "x-api-token", requireCredential(c, "apiToken", "Pipedrive"), "Pipedrive");
}
const at = (v: unknown, f: string) => parseDate(str(v), f);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const idOf = (v: unknown) => (typeof v === "number" ? String(v) : str(v));

function personEmail(p: Record<string, unknown>): string | null {
  const emails = Array.isArray(p["emails"]) ? (p["emails"] as unknown[]).map(asObject) : [];
  return str(emails.find((e) => e["primary"] === true)?.["value"]) ?? str(emails[0]?.["value"]) ?? str(p["email"]);
}

function dealEvents(d: Record<string, unknown>, connectionId: string, opts: { created: boolean; stage: boolean; outcome: boolean; previousStage?: unknown }): CanonicalEvent[] {
  const id = idOf(d["id"]);
  if (!id) return [];
  const base = eventId("pipedrive", connectionId, "deal", id);
  const subject = idOf(d["person_id"]);
  const value = num(d["value"]);
  const currency = str(d["currency"])?.toUpperCase() ?? null;
  const out: CanonicalEvent[] = [];
  const created = at(d["add_time"], "add_time");
  if (opts.created && created) out.push({ eventId: base, eventType: "opportunity_created", subject, occurredAt: created, value, currency, properties: d });
  const stage = idOf(d["stage_id"]);
  const stageAt = at(d["stage_change_time"], "stage_change_time");
  if (opts.stage && stage && stageAt) {
    out.push({ eventId: `${base}:stage:${stage}`, eventType: "deal_stage_changed", subject, occurredAt: stageAt, value, currency, properties: { ...d, previous_stage_id: opts.previousStage ?? null } });
  }
  if (opts.outcome) {
    const won = at(d["won_time"], "won_time");
    const lost = at(d["lost_time"], "lost_time");
    if (d["status"] === "won" && won) out.push({ eventId: `${base}:won`, eventType: "deal_won", subject, occurredAt: won, value, currency, properties: d });
    if (d["status"] === "lost" && lost) out.push({ eventId: `${base}:lost`, eventType: "deal_lost", subject, occurredAt: lost, value, currency, properties: d });
  }
  return out;
}

export const pipedriveConnector: Connector = {
  source: "pipedrive",
  authType: "apiKey",
  operations: ["deals.list"] as const,
  operationFor: () => "deals.list",
  verifySignature({ headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const provided = headers["authorization"];
    if (!provided) return false;
    return safeEqual(provided, basicAuth(BASIC_USER, secret));
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const meta = asObject(body["meta"]);
    const data = asObject(body["data"]);
    const previous = asObject(body["previous"]);
    const entity = str(meta["entity"]);
    const action = str(meta["action"]);
    if (entity === "person" && action === "create") {
      const id = idOf(data["id"]);
      const created = at(data["add_time"], "add_time");
      return id && created ? [{ eventId: eventId("pipedrive", ctx.connectionId, "person", id), eventType: "lead_created", subject: personEmail(data), occurredAt: created, properties: data }] : [];
    }
    if (entity !== "deal") return [];
    if (action === "create") return dealEvents(data, ctx.connectionId, { created: true, stage: false, outcome: false });
    if (action !== "change") return [];
    const stageMoved = "stage_id" in previous;
    const statusMoved = "status" in previous;
    return dealEvents(data, ctx.connectionId, { created: false, stage: stageMoved, outcome: statusMoved, previousStage: previous["stage_id"] });
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ data?: unknown[]; additional_data?: { next_cursor?: string | null } }>("/api/v2/deals", {
          updated_since: since.toISOString().replace(/\.\d{3}Z$/, "Z"),
          sort_by: "update_time",
          sort_direction: "asc",
          limit: 100,
          cursor: cont ?? undefined,
        });
        return { rows: (page.data ?? []).map(asObject), next: page.additional_data?.next_cursor ?? null, rateLimit: client.rateLimit() };
      },
      changedAt: (d) => isoOrNull(d["update_time"]),
      happenedAt: (d) => isoOrNull(d["add_time"]),
      map: (d) => dealEvents(d, args.connectionId, { created: true, stage: false, outcome: false })[0] ?? null,
    });
    // The poll sees the deal's CURRENT stage and outcome; the webhook carries
    // each hop. Fan out after the walk from the records' own properties.
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...dealEvents(r.properties ?? {}, args.connectionId, { created: true, stage: true, outcome: true }));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const password = randomBytes(24).toString("base64url");
    const res = await api(args.credentials).post<{ data?: { id?: number | string } }>("/v1/webhooks", {
      subscription_url: args.webhookUrl,
      event_action: "*",
      event_object: "deal",
      version: "2.0",
      name: "Namzilabs",
      http_auth_user: BASIC_USER,
      http_auth_password: password,
    });
    const id = res.data?.id;
    return { signingSecret: password, externalId: id != null ? String(id) : undefined };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/v1/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
