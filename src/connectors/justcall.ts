import type { ObservedRateLimit } from "@/lib/http-client";
import type { CanonicalEvent, Connector, PollArgs, PollResult, VerifyArgs } from "./types";
import { asObject, str } from "./field-utils";
import { eventId, headerKeyClient, parseWalkCursor, requireCredential, walkImportProgress, windowedWalk } from "./kit";

/**
 * JustCall (v2.1). One call carries FOUR durations, so the one that means
 * "time two people spent talking" has to be named: `conversation_time` is the
 * `value`, and the other three sit in `properties`.
 *
 * POLL ONLY, deliberately: JustCall's webhook signature is computed over the
 * SUBSCRIPTION URL, which a receiver cannot reconstruct from the request it is
 * handed, so `verifySignature` can never say yes and this connector does not
 * pretend to have an inbound path.
 *
 * Docs read 8 Sep 2026:
 * - https://developer.justcall.io/reference/call_list_v21 — GET /v2.1/calls
 *   (the plan said POST; the OpenAPI says `"/v2.1/calls": { "get": … }`, and
 *   the docs win), `servers: [{ url: "https://api.justcall.io" }]`; `per_page`
 *   "Default value is 20 and maximum value is 100"; `sort` is one of "id" |
 *   "datetime" (default "id") and `order` "asc" | "desc" (default "desc") — so
 *   the plan's `sort: "call_date"` is not an accepted value; `from_datetime` /
 *   `to_datetime` are "yyyy-mm-dd hh:mm:ss" or "yyyy-mm-dd" **in user's
 *   timezone**; and "History for the last 3 months can be accessed via API",
 *   which is the `retention` and the entry's historyNote.
 * - https://developer.justcall.io/reference/call_list_v21 (same page, schemas) —
 *   `call_date` "Date of call in UTC" and `call_time` "Timestamp of call in
 *   UTC", against `call_user_date` / `call_user_time` "in users timezone". The
 *   plan had this backwards ("timestamps arrive in the ACCOUNT time zone");
 *   composing call_date + call_time as UTC is therefore not an assumption but
 *   what the field says. `conversation_time` is "Total duration without the
 *   Hold time" — the talk time — while `total_duration` is "conversation_time+
 *   hold_time" and `handle_time` is "Total duration + Wrap up time"; `ring_time`
 *   is a fourth, separate figure. (The plan said total_duration includes ring
 *   time; per the schema it does not, and either way it is not talk time.)
 * - https://developer.justcall.io/reference/contacts_list_v21 — the shape of a
 *   v2.1 list response, which the calls page omits: `{ status, count,
 *   current_page, per_page, data[], next_page_link, prev_page_link }`, and
 *   "Page number '0' indicates first page containing records" — hence no page
 *   index is ever assumed here (see `nextPage`).
 * - https://developer.justcall.io/reference/authentication — "Authorization:
 *   api_key:api_secret". No scheme word, no base64.
 * - https://developer.justcall.io/docs/rate-limits — per plan: Team 1800/hour
 *   and 30/minute burst, Pro 3600/60, Business and SalesPro 5400/90. The entry
 *   declares the LOWEST tier — 30/min, not the plan document's 60, which is
 *   the middle tier. Responses carry X-Rate-Limit-Limit / -Remaining / -Reset
 *   and the -Burst- triple, "in UTC epoch seconds"; 429 when either is spent.
 * - https://developer.justcall.io/docs/dynamic-webhook-signatures — the
 *   deferral, in the provider's own words: the signed payload is
 *   `${secret}|${encodeURIComponent(body.webhook_url)}|${body.type}|${headers["x-justcall-request-timestamp"]}`,
 *   HMAC-SHA256 hex, keyed on the API secret, in `x-justcall-signature`. The
 *   body's `webhook_url` is attacker-supplied, so verifying against it proves
 *   nothing, and the real subscription URL is not something `verifySignature`
 *   is given.
 * - https://developer.justcall.io/docs/call-events — the event catalogue we
 *   would subscribe to if that changed, and the delivery headers
 *   (x-justcall-signature / -signature-version / -request-timestamp).
 */
const API = "https://api.justcall.io/v2.1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 100;

/**
 * How far the request's lower bound is pushed behind the mark.
 *
 * `from_datetime` is read "in user's timezone" while `call_date`/`call_time`
 * come back in UTC, and nothing on this endpoint says what that time zone is.
 * Rendering a UTC instant as the filter string therefore denotes an instant up
 * to 12 hours LATER than intended (an account at UTC−12), which would strand
 * every call in the gap. Twelve hours behind the mark covers every offset on
 * earth — −12 through +14 — under either reading of the parameter, so the
 * bound can only ever be too generous.
 *
 * No `to_datetime` is sent at all, for the same reason pointing the other way:
 * an upper bound in an unknown zone can only HIDE the most recent calls, and
 * "no upper bound" is exactly what a forward walk wants.
 *
 * The margin also buys back what a single timestamp per call costs us: a call
 * that was still in progress, or whose disposition and notes were typed in
 * afterwards, is re-read on the next poll under its own unchanged
 * `call_date`, and the fan-out restates it in place.
 */
const TZ_MARGIN_MS = 12 * 3_600_000;

const text = (v: unknown): string | null => (typeof v === "number" ? String(v) : str(v));
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "yyyy-mm-dd hh:mm:ss", the only shape `from_datetime` documents. */
const stamp = (d: Date): string => new Date(d.getTime() - TZ_MARGIN_MS).toISOString().slice(0, 19).replace("T", " ");

/**
 * The call's own instant: `call_date` + `call_time`, both documented as UTC.
 * The hour comes back unpadded in JustCall's own example ("8:25:43"), which
 * `Date.parse` refuses, so each part is padded before parsing.
 */
function when(c: Record<string, unknown>): Date | null {
  const day = str(c["call_date"]);
  if (!day) return null;
  const [h = "", m = "", s = ""] = (str(c["call_time"]) ?? "00:00:00").split(":");
  const pad = (v: string, fallback: string) => (/^\d{1,2}$/.test(v.trim()) ? v.trim().padStart(2, "0") : fallback);
  const ms = Date.parse(`${day}T${pad(h, "00")}:${pad(m, "00")}:${pad(s, "00")}Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * One call → the lifecycle events it evidences, all at the SAME instant
 * because JustCall gives a call one timestamp (Aircall's separate
 * started/answered/ended is a luxury this API does not offer).
 *
 * "In Progress" is a call whose outcome does not exist yet, so it yields no
 * completion — the next poll, which re-reads the whole `TZ_MARGIN_MS` window,
 * emits `call_completed` or `call_missed` once JustCall has decided.
 */
function events(c: Record<string, unknown>, connectionId: string): CanonicalEvent[] {
  const id = text(c["id"]);
  const at = when(c);
  if (!id || !at) return [];
  const info = asObject(c["call_info"]);
  const dur = asObject(c["call_duration"]);
  const type = (str(info["type"]) ?? "").trim();
  const talk = num(dur["conversation_time"]) ?? 0;
  const answered = /^answered$/i.test(type) || talk > 0;
  const settled = !/^in\s*progress$/i.test(type);
  const props = {
    ...c,
    direction: text(info["direction"]),
    call_type: text(info["type"]),
    disposition: text(info["disposition"]),
    missed_call_reason: text(info["missed_call_reason"]),
    agent_email: text(c["agent_email"]),
    contact_number: text(c["contact_number"]),
    talk_seconds: talk,
    ring_seconds: num(dur["ring_time"]),
    hold_seconds: num(dur["hold_time"]),
    total_seconds: num(dur["total_duration"]),
    time_note: "occurred_at is call_date + call_time, which JustCall documents as UTC; call_user_date / call_user_time are the same call in the account's own time zone.",
  };
  const subject = text(c["agent_email"]) ?? text(c["contact_number"]);
  const base = eventId("justcall", connectionId, id);
  const out: CanonicalEvent[] = [{ eventId: base, eventType: "call_logged", subject, occurredAt: at, properties: props }];
  if (answered) out.push({ eventId: `${base}:connected`, eventType: "call_connected", subject, occurredAt: at, properties: props });
  if (settled) {
    out.push(
      answered
        ? { eventId: `${base}:completed`, eventType: "call_completed", subject, occurredAt: at, value: talk, properties: props }
        : { eventId: `${base}:completed`, eventType: "call_missed", subject, occurredAt: at, value: 0, properties: props },
    );
  }
  return out;
}

type CallsPage = { data?: unknown[]; count?: number; current_page?: number; next_page_link?: string | null };

/**
 * The next page, as a page NUMBER read out of the provider's own
 * `next_page_link` — the link is not followed verbatim because the documented
 * example (`…/contacts?page=3&per_page=10`) carries no filters, and a
 * continuation that silently dropped `from_datetime` would walk the account's
 * whole history. Taking only the index re-sends this walk's own bound.
 *
 * Falling back to `current_page + 1` on a full page keeps a long burst
 * draining if the envelope ever omits the link; JustCall's own contacts
 * endpoint documents page 0 as the first page, so the index is only ever
 * incremented, never assumed.
 */
function nextPage(body: CallsPage, got: number): string | null {
  const link = str(body.next_page_link);
  if (link) {
    try {
      const p = new URL(link).searchParams.get("page");
      if (p) return p;
    } catch {
      // A link we cannot parse is no link at all; fall through.
    }
  }
  const current = typeof body.current_page === "number" ? body.current_page : null;
  return got >= PAGE && current != null ? String(current + 1) : null;
}

/**
 * JustCall spells its budget headers `X-Rate-Limit-*` — neither of the two
 * families `parseRateLimit` reads — and its reset headers are ABSOLUTE "UTC
 * epoch seconds" where `ObservedRateLimit.resetSeconds` is a delay. Both are
 * this provider's quirks, so both are handled here rather than in the shared
 * parser. The tighter of the hourly and burst windows is the one reported: a
 * `remaining` of 0 defers this connection until its own reset.
 */
function observedLimit(headers: Headers, nowMs: number): ObservedRateLimit | null {
  const read = (k: string): number | null => {
    const v = headers.get?.(k);
    if (v == null) return null;
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  };
  const delay = (epoch: number | null): number | null => (epoch == null ? null : Math.max(0, Math.round(epoch - nowMs / 1000)));
  const burst = read("x-rate-limit-burst-remaining");
  const hourly = read("x-rate-limit-remaining");
  if (burst != null && (hourly == null || burst <= hourly)) {
    return { limit: read("x-rate-limit-burst-limit"), remaining: burst, resetSeconds: delay(read("x-rate-limit-burst-reset")) };
  }
  if (hourly != null) return { limit: read("x-rate-limit-limit"), remaining: hourly, resetSeconds: delay(read("x-rate-limit-reset")) };
  return null;
}

export const justcallConnector: Connector = {
  source: "justcall",
  authType: "apiKey",
  operations: ["calls.list"] as const,
  operationFor: () => "calls.list",
  importProgress: walkImportProgress,
  // "History for the last 3 months can be accessed via API" (call_list_v21).
  retention: { days: 90, alarmAfterDays: 80, watermarkOf: (cursor) => parseWalkCursor(cursor).hw },
  /**
   * Always false, and not as a placeholder. JustCall signs
   * `secret|urlencoded(webhook_url)|type|timestamp`: the only copy of the
   * subscription URL reaching us is the one INSIDE the body being verified, so
   * a forger supplies both halves and the check proves nothing. Until the URL
   * arrives from somewhere the sender does not control, there is no honest
   * yes — and polling already carries this source.
   */
  verifySignature({ secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return false;
  },
  async poll(args: PollArgs): Promise<PollResult> {
    // Held in an object so the closure's writes are visible to the walk.
    const seen: { limit: ObservedRateLimit | null } = { limit: null };
    const client = headerKeyClient(
      API,
      "authorization",
      `${requireCredential(args.credentials, "apiKey", "JustCall")}:${requireCredential(args.credentials, "apiSecret", "JustCall")}`,
      "JustCall",
      {},
      { onResponse: (res) => (seen.limit = observedLimit(res.headers, Date.now()) ?? seen.limit) },
    );
    // One row → up to three events; windowedWalk maps one-to-one, so the
    // lifecycle is fanned out after the walk from the records' properties.
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const body = await client.get<CallsPage>("/calls", {
          from_datetime: stamp(since),
          per_page: PAGE,
          sort: "datetime",
          order: "asc",
          page: cont ?? undefined,
        });
        const rows = (body.data ?? []).map(asObject);
        return { rows, next: nextPage(body, rows.length), rateLimit: seen.limit };
      },
      // The bound and the mark are one axis: the call's own date and time. The
      // request states it in the account's zone (widened by TZ_MARGIN_MS) and
      // the row states it in UTC; `call_user_date` is the decoy, and it is
      // user-editable besides.
      changedAt: (c) => when(c)?.toISOString() ?? null,
      map: (c) => events(c, args.connectionId)[0] ?? null,
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...events(r.properties ?? {}, args.connectionId));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
