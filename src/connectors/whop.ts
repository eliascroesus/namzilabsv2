import { createHmac } from "node:crypto";
import type { CanonicalEvent, Connector, NormalizeContext, PollArgs, PollResult, VerifyArgs } from "./types";
import { safeEqual, timestampFreshness } from "@/lib/signatures";
import { fetchJson, HttpError } from "@/lib/http-client";
import { parseDate } from "./field-utils";

/**
 * Whop — payments and memberships from a creator's Whop company.
 *
 * EVERY FACT BELOW WAS READ OFF WHOP'S OWN DOCS, and the two places their docs
 * contradict themselves are handled rather than guessed at (see
 * `verifySignature`). Sources, all fetched while writing this:
 *  - Base URL + auth: docs.whop.com/developer/api/getting-started —
 *    `curl https://api.whop.com/api/v1/payments?company_id=biz_xxx
 *     -H "Authorization: Bearer YOUR_API_KEY"`
 *  - Payments list: docs.whop.com/api-reference/payments/list-payments
 *  - Memberships list: docs.whop.com/api-reference/memberships/list-memberships
 *  - Webhook signing: docs.whop.com/developer/guides/webhooks
 *
 * Connection-scoped, like Close: the API key IS the resource, so a Get data
 * step needs no per-flow choice and both collections arrive under one
 * connection, told apart by Record type.
 */

const API = "https://api.whop.com/api/v1";

/**
 * Rows per page. Whop documents `first` with no stated maximum, and a live
 * probe could not settle one either — the sandbox validates the parameter's
 * TYPE (`first=abc` → 400 `parameter_invalid`) but accepted `first=1000`
 * without complaint against an empty collection, which proves nothing about
 * where truncation begins. 50 is therefore a conservative choice, not a
 * reading of their ceiling.
 *
 * Also measured: Whop IGNORES unknown query parameters silently (a made-up
 * one returns 200). So a parameter this connector sends that the endpoint
 * does not support would be accepted and quietly dropped, and the walk would
 * behave as though it had never been filtered — which is exactly why the
 * memberships walk below does not send `updated_after` merely because
 * payments has one.
 */
const PAGE_SIZE = 50;
/** Pages per poll when no ledger budget is supplied (legacy callers, tests). */
const PAGES_PER_POLL = 3;
/** Hard ceiling per poll even with budget headroom — bounds memory per sweep. */
const MAX_PAGES_PER_POLL = 20;

/**
 * How far back a re-read reaches on every sweep, per collection.
 *
 * Payments MUTATE after the fact — a refund changes `refunded_amount` and the
 * status — and `/payments` exposes `updated_after`, so that collection is
 * walked on its UPDATE axis and no window is needed. `/memberships` documents
 * `created_after`/`created_before` and NO `updated_after` (verified on the
 * reference page), so a membership that changes status later cannot be found
 * by asking for new ones. Two things cover that: the `membership.*` webhooks,
 * and this overlap, which re-reads the recent tail every sweep so an ordinary
 * lifecycle change is picked up without a full re-sync.
 */
const MEMBERSHIP_OVERLAP_MS = 7 * 86_400_000;
/** Payments' update axis needs only enough overlap to cover clock skew. */
const PAYMENT_OVERLAP_MS = 5 * 60_000;

/**
 * How far back the FIRST sweep of a new connection reaches — and, for this
 * connector, the only reach there is, period.
 *
 * Not a nicety — without it the first request carries no date bound at all
 * and pages forward from the company's oldest record, 50 rows at a time.
 * Close pins the same constant for the same reason, and its docblock names
 * the failure: "an unbounded request every time, wearing a bound". The one
 * that bites hardest here is subtler than duration: while a long walk is in
 * progress the account keeps changing, and a payment refunded behind the
 * page the walk has already passed would never be re-read. Bounding the
 * first sweep keeps the walk short enough that the mark below is honest.
 *
 * A full re-sync does NOT reach any deeper than this. It clears the cursor
 * (resync.ts) and polls again from scratch, and a null/unusable mark falls
 * back to exactly this constant in `since` below — `windowFloor`, the one
 * mechanism that could ask for MORE, is never set for a connection-scoped
 * source like this one (see the note on it further down, beside `since`).
 * So 90 days is this connector's ceiling, not a floor a re-sync can push
 * past, which is exactly why the catalog's `historyNote` states it as a
 * plain fact rather than a starting point.
 */
const FIRST_SYNC_DAYS = 90;

type Cursor = {
  /**
   * The moment each collection's last COMPLETED walk began — not the newest
   * row it saw. That distinction is the fix for a silent data loss the review
   * caught: rows are ordered by `created_at` (Whop offers no `updated_at`
   * ordering), so a payment refunded DURING a walk keeps its old position and
   * may sit behind the page the walk already read. Marking "newest row seen"
   * would put the next window past that refund forever. Marking "when the
   * walk started" cannot: anything mutated during the walk has an
   * `updated_at` at or after that instant, so the next sweep asks for it.
   */
  payHw?: string | null;
  memHw?: string | null;
  /** In-flight page cursor, when a walk stopped on its page budget. */
  payCont?: string | null;
  memCont?: string | null;
  /**
   * Set once both walks have drained. Its presence is what tells the import
   * banner this connection has finished its history (`cursorSaysImporting`
   * in sync/import-status.ts reads exactly this key); without it a Whop
   * connection said "Still importing history" forever, because that helper
   * looks for `hw` and ours were named per collection.
   */
  hw?: string | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function parseCursor(raw: string | null): Cursor {
  if (!raw) return {};
  try {
    const c = JSON.parse(raw) as unknown;
    return c && typeof c === "object" ? (c as Cursor) : {};
  } catch {
    return {};
  }
}

/**
 * Whop's error envelope, and why it is parsed rather than pattern-matched on
 * the STATUS.
 *
 * Measured against the live sandbox API, not assumed: Whop answers a
 * permission failure with **HTTP 400**, not 401 or 403. A key missing a scope
 * returns `{"error":{"type":"bad_request","message":"Unauthorized: Actor is
 * missing all required permissions: company:basic:read"}}`, and a key that
 * cannot see a collection returns `"You are not authorized - ensure that you
 * have access to this resource"`. Mapping only 401/403 — which is what this
 * did first — would have surfaced the single most likely setup mistake as a
 * raw "HTTP 400" with no hint at all, on a provider whose whole connect story
 * is "tick the right permission boxes".
 */
function whopError(e: unknown): string | null {
  if (!(e instanceof HttpError)) return null;
  let message = "";
  let type = "";
  try {
    const parsed = obj(JSON.parse(e.body) as unknown);
    const err = obj(parsed["error"]);
    message = str(err["message"]);
    type = str(err["type"]);
  } catch {
    message = e.body.slice(0, 200);
  }

  // Whop names the exact permission it wanted; passing that through is the
  // difference between a shrug and a two-click fix.
  if (/not authorized|missing all required permissions|unauthorized/i.test(message)) {
    return `Whop refused this API key: ${message} Open the connection and reconnect with a key that has the payment and member read permissions (Whop → Developer → API keys).`;
  }
  // A company id that does not belong to the key. Verified live: /payments
  // answers "This Bot was not found" for an unknown company.
  if (e.status === 404 || /not found/i.test(message)) {
    return `Whop could not find that company: ${message} Check the Company ID on this connection — it looks like biz_… and must be the company the API key belongs to.`;
  }
  if (type === "invalid_request_error") return `Whop rejected the request: ${message}`;
  return null;
}

async function getJson<T>(path: string, credentials?: Record<string, unknown> | null): Promise<T> {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("Whop: this connection has no API key — open it and reconnect.");
  try {
    return await fetchJson<T>(`${API}${path}`, { headers: { authorization: `Bearer ${key}` } });
  } catch (e) {
    const friendly = whopError(e);
    if (friendly) throw new Error(friendly);
    throw e;
  }
}

/** Base64 HMAC-SHA256, keyed by RAW BYTES the caller supplies (see verifySignature). */
function hmacBase64(key: Buffer | string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("base64");
}

/**
 * Whop follows the Standard Webhooks spec: headers `webhook-id`,
 * `webhook-timestamp` (unix seconds) and `webhook-signature` holding
 * `v1,<base64>`, over the signed string `{id}.{timestamp}.{raw body}`, HMAC
 * SHA-256, with deliveries older than five minutes rejected.
 *
 * THE KEY BYTES ARE DOCUMENTED TWO WAYS, so both are accepted. The webhooks
 * guide says "The key is your `ws_...` secret" — i.e. the string itself —
 * while the Standard Webhooks spec this follows base64-decodes the secret
 * after stripping its prefix, and the API reference shows the secret as
 * `whsec_abc123def456`. Trying both costs one extra HMAC and settles a
 * contradiction we cannot settle from the docs; it weakens nothing, because
 * an attacker needs the same secret either way. Getting this wrong in one
 * direction rejects 100% of a customer's deliveries — the exact failure
 * `hmacSha256Hex`'s own docblock records for Close.
 */
function signatureCandidates(secret: string): Array<Buffer | string> {
  const out: Array<Buffer | string> = [secret];
  const bare = secret.replace(/^(whsec_|ws_)/, "");
  if (bare !== secret || /^[A-Za-z0-9+/=_-]+$/.test(secret)) {
    try {
      const decoded = Buffer.from(bare, "base64");
      if (decoded.length > 0) out.push(decoded);
    } catch {
      // Not base64 — the raw string candidate above stands alone.
    }
  }
  return out;
}

export const whopConnector: Connector = {
  source: "whop",
  authType: "apiKey",

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    // Fails CLOSED: Whop returns the signing secret when the webhook is
    // created, so an unsigned endpoint is a misconfiguration, not a mode.
    if (!secret) return false;
    const id = headers["webhook-id"];
    const ts = headers["webhook-timestamp"];
    const sig = headers["webhook-signature"];
    if (!id || !ts || !sig) return false;
    // Replay window, stated by Whop as five minutes either way.
    if (timestampFreshness(ts) !== "fresh") return false;

    const signed = `${id}.${ts}.${rawBody}`;
    const expected = signatureCandidates(secret).map((k) => hmacBase64(k, signed));
    // The header carries space-delimited `v<n>,<sig>` pairs — more than one
    // while a secret is being rotated. Any v1 entry matching any candidate
    // key is a valid delivery.
    for (const part of sig.split(" ")) {
      const [version, value] = part.split(",");
      if (version !== "v1" || !value) continue;
      for (const e of expected) if (safeEqual(value, e)) return true;
    }
    return false;
  },

  /**
   * A delivery becomes the SAME record the poll produces — same eventId, so
   * the two paths upsert one row rather than racing to create two.
   *
   * Whop's delivery ENVELOPE is the one shape their docs never show: the
   * event-type pages describe when an event fires and the webhook object
   * schema describes the subscription, but no page fetched while writing this
   * printed a delivery body. So nothing here assumes a fixed envelope — the
   * resource is taken from `data` when that is an object, else the payload
   * itself, and the event name from whichever of `type`/`event`/`action`
   * carries a string. The Whop id prefix (`pay_`, `mem_`) is the fallback and
   * is what actually decides the record type, because it is a property of the
   * resource rather than of the envelope.
   */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const payload = obj(rawPayload);
    const inner = obj(payload["data"]);
    const resource = Object.keys(inner).length > 0 ? inner : payload;
    const id = str(resource["id"]);
    if (!id) return [];

    const declared = str(payload["type"]) || str(payload["event"]) || str(payload["action"]);
    const kind = recordKind(id, declared);
    if (!kind) return [];
    return [toCanonical(kind, resource, ctx.connectionId, declared, ctx.fallbackOccurredAt)];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const companyId = str(args.credentials?.["companyId"]);
    if (!companyId) {
      throw new Error("Whop: this connection has no company id — open it and reconnect with the company it should read.");
    }
    const cur = parseCursor(args.cursor);
    const records: CanonicalEvent[] = [];
    let providerCalls = 0;

    // Budget-driven paging, same shape as close/instantly: ledger headroom
    // capped by the memory ceiling, wall clock checked between pages.
    const pageCap = args.budget ? Math.min(MAX_PAGES_PER_POLL, Math.max(1, args.budget.maxCalls)) : PAGES_PER_POLL;
    const nowMs = args.budget?.nowMs ?? Date.now;
    const deadlineMs = args.budget?.deadlineMs;
    const outOfTime = () => deadlineMs != null && nowMs() >= deadlineMs;

    /**
     * How far back this sweep reaches.
     *
     * A stored mark, minus that collection's overlap — and when there is no
     * usable mark, FIRST_SYNC_DAYS rather than nothing. "No usable" includes
     * a mark that will not parse: falling through to an unbounded request on
     * a corrupt cursor is how one bad write turns into re-walking all of
     * history on every sweep, forever.
     *
     * `windowFloor` deepens it when something asks for more history. It is
     * only ever set for stream-scoped sources today, so for this
     * connection-scoped connector it is always null — wired anyway, because
     * the alternative is a silent surprise the day that changes.
     */
    const walkStart = new Date();
    const floorMs = args.windowFloor ? args.windowFloor.getTime() : null;
    const firstSyncMs = walkStart.getTime() - FIRST_SYNC_DAYS * 86_400_000;
    const since = (hw: string | null | undefined, overlapMs: number): string => {
      const parsed = hw ? Date.parse(hw) : NaN;
      const fromHw = Number.isFinite(parsed) ? parsed - overlapMs : firstSyncMs;
      const ms = floorMs != null ? Math.min(fromHw, floorMs) : fromHw;
      return new Date(ms).toISOString();
    };

    const next: Cursor = { ...cur };
    let pagesLeft = pageCap;

    /** Walk one collection forward, oldest-first, until its pages run out. */
    const walk = async (
      kind: "payment" | "membership",
      sinceIso: string,
      cont: string | null | undefined,
    ): Promise<{ cont: string | null }> => {
      const dateParam = kind === "payment" ? "updated_after" : "created_after";
      let after = cont ?? null;

      while (pagesLeft > 0) {
        if (outOfTime()) break;
        const params = new URLSearchParams({
          company_id: companyId,
          first: String(PAGE_SIZE),
          order: "created_at",
          direction: "asc",
        });
        params.set(dateParam, sinceIso);
        if (after) params.set("after", after);

        pagesLeft -= 1;
        providerCalls += 1;
        const body = await getJson<{ data?: unknown[]; page_info?: Record<string, unknown> }>(
          `/${kind === "payment" ? "payments" : "memberships"}?${params.toString()}`,
          args.credentials,
        );

        const rows = Array.isArray(body.data) ? body.data : [];
        for (const row of rows) {
          const r = obj(row);
          const id = str(r["id"]);
          if (!id) continue;
          records.push(toCanonical(kind, r, args.connectionId, null, undefined));
        }

        const info = obj(body.page_info);
        const hasNext = info["has_next_page"] === true;
        const endCursor = str(info["end_cursor"]);
        after = hasNext && endCursor ? endCursor : null;
        if (!after) break;
      }
      return { cont: after };
    };

    const pay = await walk("payment", since(cur.payHw, PAYMENT_OVERLAP_MS), cur.payCont);
    next.payCont = pay.cont;
    /**
     * The mark advances only when the walk FINISHED, and it advances to when
     * the walk STARTED. Mid-walk promotion would strand the unread remainder
     * (a bug this codebase has fixed twice elsewhere); promoting to the
     * newest row seen would strand every row mutated behind the walk, since
     * Whop cannot order by update time.
     */
    if (pay.cont == null) next.payHw = walkStart.toISOString();

    const mem = await walk("membership", since(cur.memHw, MEMBERSHIP_OVERLAP_MS), cur.memCont);
    next.memCont = mem.cont;
    if (mem.cont == null) next.memHw = walkStart.toISOString();

    // Both drained ⇒ the first import is over, and the banner may say so.
    next.hw = next.payCont == null && next.memCont == null ? walkStart.toISOString() : null;

    return {
      records,
      // Never null: a settled mark is state we must keep. `holdsContinuation`
      // below tells the cadence layer whether we are mid-walk.
      nextCursor: JSON.stringify(next),
      providerCalls,
      incomplete: pay.cont != null || mem.cont != null,
    };
  },

  /**
   * Whop publishes one limit — 600 requests per minute per API credential —
   * so every call shares one bucket rather than being split per endpoint. One
   * declared ceiling that is certainly right beats two that split a limit
   * whose scoping ("per operation") their docs never define.
   */
  operationFor: () => "api.request",
  operations: ["api.request"],

  /** A stored page cursor is a live continuation: come back before the next sweep. */
  holdsContinuation(cursor: string | null): boolean {
    const c = parseCursor(cursor);
    return c.payCont != null || c.memCont != null;
  },
};

/** Which record type an id belongs to. The prefix is the authority; a declared
 *  event name only helps when the id is unfamiliar. */
function recordKind(id: string, declared: string): "payment" | "membership" | null {
  if (id.startsWith("pay_")) return "payment";
  if (id.startsWith("mem_")) return "membership";
  if (declared.startsWith("payment.")) return "payment";
  if (declared.startsWith("membership.")) return "membership";
  return null;
}

/**
 * One Whop resource as a canonical event.
 *
 * `eventId` is the RESOURCE id, not the delivery id: a payment that arrives by
 * webhook and is later re-read by the poll must be one row that updates, not
 * two rows that both count. `eventType` is the resource kind and stays put
 * across a lifecycle — the status lives in `properties.status`, so "how many
 * payments succeeded" is a Filter, and a refund updating a row does not
 * silently move it to a different record type.
 */
function toCanonical(
  kind: "payment" | "membership",
  r: Record<string, unknown>,
  connectionId: string,
  declared: string | null,
  fallbackOccurredAt?: Date,
): CanonicalEvent {
  const id = str(r["id"]);
  const user = obj(r["user"]);
  const product = obj(r["product"]);
  // Payments are dated by when the money moved when Whop says so, and by
  // creation otherwise; a membership by when it began.
  const when =
    parseDate(str(r["paid_at"]) || null, "whop.paid_at") ??
    parseDate(str(r["created_at"]) || null, "whop.created_at") ??
    fallbackOccurredAt ??
    new Date();
  const amount = kind === "payment" ? num(r["total"]) : null;

  return {
    eventId: `whop:${connectionId}:${id}`,
    eventType: kind,
    subject: str(user["email"]) || str(user["username"]) || str(product["title"]) || id,
    occurredAt: when,
    value: amount,
    currency: kind === "payment" ? str(r["currency"]).toUpperCase() || null : null,
    properties: {
      ...r,
      // What the delivery called itself, when it came from a webhook. Kept
      // beside the resource rather than replacing `eventType`, so a filter can
      // still ask "was this the failure event" without the record type moving.
      ...(declared ? { webhook_event: declared } : {}),
    },
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
