# Connectors Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nineteen API-key and secret-signed connectors — Stripe, Cal.com, Aircall, Pipedrive, Typeform, Tally, Smartlead, Help Scout, Attio, Lemlist, Paddle, JustCall, OnceHub, SavvyCal, Thinkific, ThriveCart, Retell, Customer.io, Airtable — each built on the connector kit from live provider documentation, with fixture tests and a generated live prober.

**Architecture:** Every connector is one module composed from `src/connectors/kit/` (`windowedWalk`, a signature verifier, a provider client), one `CONNECTOR_CATALOG` entry carrying `brand`, `docs` and `verified`, one registry line, one test file and one prober. Webhook and poll paths normalise to the same `CanonicalEvent` shape; `eventId` is `source:connectionId:providerId` on both so the two paths dedupe against each other. Stream-scoped sources (a form, a campaign, a base) declare `flowFields` and answer `listOptions`.

**Tech Stack:** TypeScript, the connector kit, vitest with `vi.stubGlobal("fetch", …)`, `tsx` probers, WebFetch to read each provider's documentation at build time.

**Spec:** `docs/superpowers/specs/2026-09-07-connector-kit-and-first-twenty-design.md` (Part 7). Prerequisite: `docs/superpowers/plans/2026-09-07-connector-kit-infra.md` is complete and on `main`.

## Global Constraints

- READ THE DOCS FIRST, LIVE. Before writing a connector, fetch its `docsUrl` and `webhookDocsUrl` (listed in the task's Facts) with WebFetch and confirm: base URL, list endpoint, the time-filter parameter, the changed-at and happened-at fields, page size and pagination, the signature header and construction, rate limits, retention. The Facts below were researched on 7 Sep 2026 and are the starting point, not the authority. Where the docs contradict a Fact, the docs win and the connector's comment says so. Where a Fact is marked UNCONFIRMED and the docs do not settle it, the connector fails closed and the entry's `verified.live` stays null.
- `docs.readOn` is the date you actually read the pages. Every `rateLimits` figure carries a comment citing the page.
- Date by when it HAPPENED. A scheduled start, a forecast close, an SLA deadline, a `next_billed_at` goes in `properties`, never in `occurredAt`.
- The watermark (`changedAt`) is the field the provider FILTERS on with the walk's `since`. Never bound on one field and advance on another.
- `verifySignature` returns `false` without a secret. Timestamps in signed messages must be fresh.
- `eventId` is `eventId(source, connectionId, providerId)`; a stream-scoped source whose ids can repeat across resources embeds `streamHash`.
- Money: convert minor units to major (`/100`, except zero-decimal currencies) and set `currency` uppercase. Durations: seconds as the `value`; note the unit in the catalog description.
- Each task removes the kit-export allowlist entries in `scripts/check-orphans.ts` that name it as first consumer, and `pnpm check:orphans` must pass at each commit.
- Gates at every commit: `pnpm typecheck`, `pnpm vitest run tests/<source>.test.ts tests/connector-population.test.ts tests/connectors-signatures.test.ts tests/held-continuation.test.ts tests/budget-operations.test.ts tests/event-type-labels.test.ts`, `pnpm check:orphans`, `pnpm check:ui`. Every four connectors: the full `pnpm test` (dev server stopped) and a push to `origin/main`.
- Reuse the existing event-type vocabulary and its labels exactly where a key already exists: `booked`, `canceled`, `no_show` (Calendly); `call_logged` "Call logged", `call_connected` "Call connected", `call_completed` "Call completed", `meeting_held` "Meeting held", `lead_created`, `opportunity_created` (Close); `email_sent` "Email sent", `reply` "Reply received", `email_opened`, `email_clicked`, `bounced`, `unsubscribed` (Instantly); `row_added` (Sheets).
- Commit messages: one line of intent, a body that says why, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Worktree `.claude/worktrees/figma-overview-match`; never bare `git stash`.

---

## Task 0: the procedure every connector task follows

Each task below is the same nine steps with different facts and code. The steps, so no task has to restate them:

1. **Fetch the docs** named in the task's Facts with WebFetch. Note the read date. Reconcile every Fact.
2. **Scaffold:** `pnpm connector:new <source> --name "<Name>" --auth <apiKey|secret> [--instant] [--poll] [--stream <key>]`. It writes `src/connectors/<source>.ts`, `tests/<source>.test.ts`, `scripts/verify-<source>.ts` and prints the catalog entry and registry line.
3. **Write the test file** from the task (replace the scaffold's). Run it: it must FAIL (module body is the scaffold's placeholder).
4. **Write the module** from the task (replace the scaffold's). Paste the task's catalog entry into `CONNECTOR_CATALOG` in `src/connectors/catalog.ts` (alphabetical among the new entries, after `webhook`) and the registry import plus array line into `src/connectors/registry.ts`.
5. **Write the prober** delta from the task into `scripts/verify-<source>.ts`.
6. **Remove this connector's allowlist entries** from `scripts/check-orphans.ts`.
7. **Run the gates** (Global Constraints). All green.
8. **Sabotage once:** make `verifySignature` return `true` when `!secret`; `tests/<source>.test.ts` AND `tests/connector-population.test.ts` must fail. Revert.
9. **Commit** with the task's message.

The test-file skeleton shared by every task (each task fills the four `describe`s with its own fixtures):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { <name>Connector } from "@/connectors/<source>";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";

/** A fetch stub that answers a queue of JSON bodies in order and records every request. */
function stubFetch(bodies: unknown[], headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: true, status: 200, statusText: "OK", headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }));
  return calls;
}

describe("<source>: registration", () => {
  it("is in the catalog and the registry with dated provenance", () => {
    expect(getConnector("<source>")).toBe(<name>Connector);
    const e = catalogEntry("<source>")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
  });
});
```

---

### Task 1: Stripe

**Files:**
- Create: `src/connectors/stripe.ts`, `tests/stripe.test.ts`, `scripts/verify-stripe.ts`
- Modify: `src/connectors/catalog.ts` (entry), `src/connectors/registry.ts` (import + array), `scripts/check-orphans.ts` (remove `windowedWalk`, `parseWalkCursor`, `serializeWalkCursor`, `walkImportProgress`, `timestampedHmacVerify`, `providerClient`, `bearerClient`, `requireCredential`, `eventId`, `epochToDate`)

**Facts (read 7 Sep 2026; re-read at build):** docs `https://docs.stripe.com/api`, webhooks `https://docs.stripe.com/webhooks`. Auth: secret or restricted key as Bearer. Signature: `Stripe-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over `"{t}.{raw_body}"`, keyed on the endpoint's `whsec_…` secret, 5-minute tolerance, several `v1=` possible. List: `GET /v1/events?created[gte]=<unix>&limit=100&types[]=…&starting_after=<id>` → `{ data: Event[], has_more }`, newest first; events retained 30 days. Rate limits: 100 req/s live, 25 req/s per endpoint (`https://docs.stripe.com/rate-limits`). Money: integer minor units; zero-decimal currencies exist (`https://docs.stripe.com/currencies#zero-decimal`). Dating traps: `current_period_end`, `trial_end`, `cancel_at`, `invoice.upcoming` are future. `charge.succeeded` and `payment_intent.succeeded` describe one payment — emit only `charge.succeeded`. `refund.created` and `charge.refunded` describe one refund — emit only `refund.created`.

**Interfaces:**
- Produces: `stripeConnector: Connector` (`source: "stripe"`, `authType: "apiKey"`), `STRIPE_EVENT_TYPES` (exported for the test).

- [ ] **Step 1: Write the failing test**

```ts
// tests/stripe.test.ts — after the shared skeleton (Task 0), with <source>=stripe, <name>=stripe
const SECRET = "whsec_test_secret";
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (t: string, body: string) => createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
const event = (type: string, object: Record<string, unknown>, id = "evt_1", created = 1_757_200_000) => ({ id, object: "event", type, created, data: { object } });

describe("stripe: signature", () => {
  it("accepts t=,v1= over `${t}.${body}`, with several v1 entries, and fails closed", () => {
    const body = JSON.stringify(event("charge.succeeded", {}));
    const t = String(nowSec());
    const ok = { rawBody: body, headers: { "stripe-signature": `t=${t},v1=deadbeef,v1=${sign(t, body)}` }, secret: SECRET };
    expect(stripeConnector.verifySignature(ok)).toBe(true);
    expect(stripeConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(stripeConnector.verifySignature({ ...ok, secret: "whsec_other" })).toBe(false);
    expect(stripeConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    const old = String(nowSec() - 3600);
    expect(stripeConnector.verifySignature({ ...ok, headers: { "stripe-signature": `t=${old},v1=${sign(old, body)}` } })).toBe(false);
  });
});

describe("stripe: normalize", () => {
  it("a charge becomes payment_succeeded in major units with the currency uppercased", () => {
    const [ev] = stripeConnector.normalize!(event("charge.succeeded", { id: "ch_1", amount: 1234, currency: "usd", created: 1_757_200_100, billing_details: { email: "a@b.io" }, customer: "cus_1" }), { connectionId: CONN });
    expect(ev).toMatchObject({ eventId: "stripe:conn_1:evt_1", eventType: "payment_succeeded", subject: "a@b.io", value: 12.34, currency: "USD" });
    expect(ev.occurredAt.toISOString()).toBe(new Date(1_757_200_100 * 1000).toISOString());
  });
  it("a zero-decimal currency is not divided; an invoice dates by paid_at; a refund keeps a positive amount", () => {
    const [jpy] = stripeConnector.normalize!(event("charge.succeeded", { id: "ch_2", amount: 5000, currency: "jpy", created: 1 }), { connectionId: CONN });
    expect(jpy.value).toBe(5000);
    const [inv] = stripeConnector.normalize!(event("invoice.paid", { id: "in_1", amount_paid: 9900, currency: "eur", created: 1, customer_email: "c@d.io", status_transitions: { paid_at: 1_757_300_000 } }), { connectionId: CONN });
    expect(inv.eventType).toBe("invoice_paid");
    expect(inv.occurredAt.toISOString()).toBe(new Date(1_757_300_000 * 1000).toISOString());
    const [ref] = stripeConnector.normalize!(event("refund.created", { id: "re_1", amount: 500, currency: "usd", created: 2, charge: "ch_1" }), { connectionId: CONN });
    expect(ref).toMatchObject({ eventType: "payment_refunded", value: 5, subject: "ch_1" });
  });
  it("a subscription's value is the sum of its items; deletion dates by canceled_at; unknown types are dropped", () => {
    const sub = { id: "sub_1", customer: "cus_1", created: 10, canceled_at: 20, items: { data: [{ quantity: 2, price: { unit_amount: 1000, currency: "usd", recurring: { interval: "month" } } }] } };
    const [created] = stripeConnector.normalize!(event("customer.subscription.created", sub), { connectionId: CONN });
    expect(created).toMatchObject({ eventType: "subscription_created", value: 20, currency: "USD", subject: "cus_1" });
    const [deleted] = stripeConnector.normalize!(event("customer.subscription.deleted", sub, "evt_2"), { connectionId: CONN });
    expect(deleted.eventType).toBe("subscription_canceled");
    expect(deleted.occurredAt.toISOString()).toBe(new Date(20 * 1000).toISOString());
    expect(stripeConnector.normalize!(event("payment_intent.succeeded", { id: "pi_1" }), { connectionId: CONN })).toEqual([]);
    expect(stripeConnector.normalize!(event("invoice.upcoming", { id: "in_2" }), { connectionId: CONN })).toEqual([]);
  });
});

describe("stripe: poll", () => {
  it("walks /v1/events bounded by created[gte], follows starting_after, and settles on the newest created", async () => {
    const e1 = event("charge.succeeded", { id: "ch_a", amount: 100, currency: "usd", created: 1_757_200_300 }, "evt_a", 1_757_200_300);
    const e2 = event("charge.succeeded", { id: "ch_b", amount: 100, currency: "usd", created: 1_757_200_200 }, "evt_b", 1_757_200_200);
    const calls = stubFetch([{ data: [e1], has_more: true }, { data: [e2], has_more: false }]);
    const res = await stripeConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "rk_test" } });
    expect(res.records.map((r) => r.eventId)).toEqual(["stripe:conn_1:evt_a", "stripe:conn_1:evt_b"]);
    expect(res.nextCursor).toBe(new Date(1_757_200_300 * 1000).toISOString());
    expect(res.incomplete).toBeUndefined();
    const u1 = new URL(calls[0].url);
    expect(u1.pathname).toBe("/v1/events");
    expect(u1.searchParams.get("limit")).toBe("100");
    expect(u1.searchParams.getAll("types[]")).toContain("charge.succeeded");
    expect(Number(u1.searchParams.get("created[gte]"))).toBeGreaterThan(0);
    expect(new URL(calls[1].url).searchParams.get("starting_after")).toBe("evt_a");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer rk_test");
  });
  it("declares its retention and reads the watermark from a walk cursor", () => {
    expect(stripeConnector.retention).toMatchObject({ days: 30, alarmAfterDays: 25 });
    expect(stripeConnector.retention!.watermarkOf("2026-09-01T00:00:00.000Z")).toBe("2026-09-01T00:00:00.000Z");
    expect(stripeConnector.importProgress).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it** — `pnpm vitest run tests/stripe.test.ts` → FAIL (scaffold body).

- [ ] **Step 3: Write the module and the catalog entry**

```ts
// src/connectors/stripe.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, str } from "./field-utils";
import { bearerClient, epochToDate, eventId, parseWalkCursor, requireCredential, timestampedHmacVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * Stripe. Every money movement is an immutable, signed, dated Event; the
 * webhook and the poll both hand us Event objects, so one `toCanonical`
 * serves both and `eventId` = the Stripe event id dedupes across paths.
 * Docs read 7 Sep 2026: https://docs.stripe.com/api/events/list,
 * https://docs.stripe.com/webhooks (signature), https://docs.stripe.com/rate-limits.
 * /v1/events retains 30 days — hence `retention` and the entry's historyNote.
 */
const API = "https://api.stripe.com/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
/** https://docs.stripe.com/currencies#zero-decimal — amounts already in major units. */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** Stripe event types we count → our vocabulary. One per business fact: charge not payment_intent, refund.created not charge.refunded. */
export const STRIPE_EVENT_TYPES: Record<string, string> = {
  "charge.succeeded": "payment_succeeded",
  "checkout.session.completed": "checkout_completed",
  "invoice.paid": "invoice_paid",
  "refund.created": "payment_refunded",
  "customer.subscription.created": "subscription_created",
  "customer.subscription.updated": "subscription_updated",
  "customer.subscription.deleted": "subscription_canceled",
};

function money(amount: unknown, currency: unknown): { value: number | null; currency: string | null } {
  const cur = str(currency)?.toLowerCase() ?? null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || !cur) return { value: null, currency: cur ? cur.toUpperCase() : null };
  return { value: ZERO_DECIMAL.has(cur) ? n : n / 100, currency: cur.toUpperCase() };
}

function subscriptionValue(sub: Record<string, unknown>): { value: number | null; currency: string | null } {
  const items = asObject(sub["items"]);
  const rows = Array.isArray(items["data"]) ? (items["data"] as unknown[]).map(asObject) : [];
  let total = 0;
  let currency: unknown = null;
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
      subject = str(asObject(obj["customer_details"])["email"]) ?? subject;
      amount = money(obj["amount_total"], obj["currency"]);
      break;
    }
    case "invoice.paid": {
      occurredAt = epochToDate(asObject(obj["status_transitions"])["paid_at"], "s") ?? occurredAt;
      subject = str(obj["customer_email"]) ?? subject;
      amount = money(obj["amount_paid"], obj["currency"]);
      break;
    }
    case "refund.created": {
      subject = str(obj["charge"]) ?? subject;
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
};
```

Catalog entry (paste after the `webhook` entry):

```ts
  {
    source: "stripe",
    name: "Stripe",
    description: "Payments, refunds, invoices paid, checkouts, subscriptions started and cancelled.",
    brand: { color: "#635BFF", short: "St" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    historyNote: "Stripe keeps 30 days of events, so the first import reaches back 30 days.",
    autoWebhook: false,
    docs: { url: "https://docs.stripe.com/api/events/list", readOn: "2026-09-07", webhooks: "https://docs.stripe.com/webhooks" },
    verified: { live: null },
    // https://docs.stripe.com/rate-limits (read 2026-09-07): 25 requests/second per
    // endpoint in live mode = 1,500/min; the account-wide 100/s is never the binding one.
    rateLimits: { "events.list": { requestsPerMinute: 1_500 } },
    credentialFields: [
      { key: "apiKey", label: "Restricted or secret key", placeholder: "rk_live_…" },
      { key: "webhookSecret", label: "Webhook signing secret (from the endpoint you add in Stripe)", placeholder: "whsec_…" },
    ],
    eventTypeLabels: {
      payment_succeeded: "Payment succeeded",
      checkout_completed: "Checkout completed",
      invoice_paid: "Invoice paid",
      payment_refunded: "Refund",
      subscription_created: "Subscription started",
      subscription_updated: "Subscription changed",
      subscription_canceled: "Subscription cancelled",
    },
    commonFields: ["type", "data.object.amount", "data.object.currency", "data.object.customer", "data.object.status", "livemode"],
    webhookSetup:
      "In Stripe → Developers → Webhooks, add an endpoint with the URL below, select the events charge.succeeded, " +
      "checkout.session.completed, invoice.paid, refund.created and customer.subscription.*, and paste the endpoint's " +
      "signing secret (whsec_…) as the webhook signing secret on this connection. Polling covers the last 30 days either way.",
  },
```

Registry: `import { stripeConnector } from "./stripe";` and `stripeConnector,` in the array.

- [ ] **Step 4: Prober delta** — in `scripts/verify-stripe.ts` set `const API = "https://api.stripe.com/v1";`, list URL `${API}/events?limit=5`, bounded URL `${API}/events?limit=50&created[gte]=1900000000` (a far-future bound must return zero rows), and note the `Stripe-Rate-Limited-Reason` header if present.

- [ ] **Step 5–8:** remove the ten allowlist entries; run the gates; sabotage; then:

```bash
git add src/connectors/stripe.ts src/connectors/catalog.ts src/connectors/registry.ts tests/stripe.test.ts scripts/verify-stripe.ts scripts/check-orphans.ts
git commit -m "Add Stripe: one normaliser for the webhook and the 30-day event walk

Charges, checkouts, paid invoices, refunds and subscription movements, dated
by when the money moved. The event id is the dedup key on both paths.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cal.com

**Files:** create `src/connectors/calcom.ts`, `tests/calcom.test.ts`, `scripts/verify-calcom.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `hmacHeaderVerify`, `isoOrNull`).

**Facts (7 Sep 2026):** docs `https://cal.com/docs/api-reference/v2/introduction`, bookings `https://cal.com/docs/api-reference/v2/bookings/get-all-bookings`, webhooks `https://cal.com/docs/developing/guides/automation/webhooks`. Auth: `Authorization: Bearer <api key>`; header `cal-api-version: 2024-08-13` is mandatory on `/v2/bookings` (the research saw `2026-05-01` documented — confirm the current value at build and pin it in a constant). List: `GET /v2/bookings?afterUpdatedAt=<ISO>&sortUpdatedAt=asc&take=100&skip=<n>` → `{ data: Booking[], pagination: { totalItems, remainingItems, itemsPerPage, currentPage, totalPages, hasNextPage } }` — confirm whether paging is `take/skip` or `cursor/limit` at build; the module below uses `take/skip` and the prober measures it. Booking: `uid`, `status` (`accepted|pending|cancelled|rejected|rescheduled`), `createdAt`, `updatedAt`, `start`, `end`, `attendees[]{email}`, `eventType{id,slug}`, `rescheduledFromUid`, `cancellationReason`. Webhook: `x-cal-signature-256` = hex HMAC-SHA256 over the raw body keyed on the webhook secret; payload `{ triggerEvent, createdAt, payload: {...booking-ish fields, uid, startTime, endTime, attendees, status} }`; triggers include `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`, `BOOKING_NO_SHOW_UPDATED`, `MEETING_ENDED`. Self-registration: `POST /v2/webhooks { subscriberUrl, triggers[], active, secret }` → `{ data: { id } }`; `DELETE /v2/webhooks/{id}`. Rate limit 120/min (`https://cal.com/docs/api-reference/v2/rate-limits`). Self-hosted instances have another base URL — a `baseUrl` credential field, optional.

**Interfaces:** `calcomConnector` (`source: "calcom"`, `authType: "apiKey"`), `CALCOM_TRIGGERS`.

- [ ] **Step 1: Write the failing test** (shared skeleton with `<source>=calcom`, `<name>=calcom`, then:)

```ts
const SECRET = "cal_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const booking = (over: Record<string, unknown> = {}) => ({ uid: "bk_1", status: "accepted", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", start: "2026-09-10T14:00:00.000Z", end: "2026-09-10T14:30:00.000Z", attendees: [{ email: "lead@x.io", name: "Lead" }], eventType: { id: 7, slug: "intro" }, ...over });

describe("calcom: signature", () => {
  it("hex HMAC over the raw body in x-cal-signature-256; fails closed", () => {
    const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: booking() });
    expect(calcomConnector.verifySignature({ rawBody: body, headers: { "x-cal-signature-256": sign(body) }, secret: SECRET })).toBe(true);
    expect(calcomConnector.verifySignature({ rawBody: body, headers: { "x-cal-signature-256": sign(body) }, secret: null })).toBe(false);
    expect(calcomConnector.verifySignature({ rawBody: body + " ", headers: { "x-cal-signature-256": sign(body) }, secret: SECRET })).toBe(false);
  });
});

describe("calcom: normalize", () => {
  it("BOOKING_CREATED is booked, dated by the booking's createdAt — not the slot, not the webhook's createdAt", () => {
    const [ev] = calcomConnector.normalize!({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-09-01T10:00:05.000Z", payload: booking() }, { connectionId: CONN });
    expect(ev).toMatchObject({ eventId: "calcom:conn_1:bk_1", eventType: "booked", subject: "lead@x.io" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(ev.properties).toMatchObject({ start: "2026-09-10T14:00:00.000Z" });
  });
  it("cancelled, rescheduled, no-show and meeting ended carry their own ids and dates", () => {
    const [c] = calcomConnector.normalize!({ triggerEvent: "BOOKING_CANCELLED", payload: booking({ status: "cancelled", updatedAt: "2026-09-02T09:00:00.000Z" }) }, { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "calcom:conn_1:bk_1:canceled", eventType: "canceled" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    const [r] = calcomConnector.normalize!({ triggerEvent: "BOOKING_RESCHEDULED", payload: booking({ uid: "bk_2", rescheduledFromUid: "bk_1", updatedAt: "2026-09-03T09:00:00.000Z" }) }, { connectionId: CONN });
    expect(r).toMatchObject({ eventId: "calcom:conn_1:bk_2:rescheduled", eventType: "rescheduled" });
    const [n] = calcomConnector.normalize!({ triggerEvent: "BOOKING_NO_SHOW_UPDATED", payload: booking({ noShowHost: false, attendees: [{ email: "lead@x.io", noShow: true }] }) }, { connectionId: CONN });
    expect(n).toMatchObject({ eventId: "calcom:conn_1:bk_1:no_show", eventType: "no_show" });
    const [m] = calcomConnector.normalize!({ triggerEvent: "MEETING_ENDED", payload: booking({ endTime: "2026-09-10T14:30:00.000Z" }) }, { connectionId: CONN });
    expect(m).toMatchObject({ eventId: "calcom:conn_1:bk_1:held", eventType: "meeting_held" });
    expect(m.occurredAt.toISOString()).toBe("2026-09-10T14:30:00.000Z");
    expect(calcomConnector.normalize!({ triggerEvent: "RECORDING_READY", payload: booking() }, { connectionId: CONN })).toEqual([]);
  });
});

describe("calcom: poll", () => {
  it("walks bookings by afterUpdatedAt, emits booked/canceled from status, and settles on the newest updatedAt", async () => {
    const calls = stubFetch([
      { data: [booking(), booking({ uid: "bk_9", status: "cancelled", updatedAt: "2026-09-02T09:00:00.000Z" })], pagination: { hasNextPage: false } },
    ]);
    const res = await calcomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "cal_key" } });
    expect(res.records.map((r) => `${r.eventType}@${r.occurredAt.toISOString()}`)).toEqual(["booked@2026-09-01T10:00:00.000Z", "booked@2026-09-01T10:00:00.000Z", "canceled@2026-09-02T09:00:00.000Z"]);
    expect(res.nextCursor).toBe("2026-09-02T09:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v2/bookings");
    expect(u.searchParams.get("sortUpdatedAt")).toBe("asc");
    expect(u.searchParams.get("afterUpdatedAt")).toMatch(/^\d{4}-/);
    expect((calls[0].init.headers as Record<string, string>)["cal-api-version"]).toBe(calcomConnector.apiVersion);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer cal_key");
  });
  it("registers and removes a webhook with our secret", async () => {
    const calls = stubFetch([{ data: { id: 42 } }, {}]);
    const reg = await calcomConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "k" } });
    expect(reg.externalId).toBe("42");
    expect(reg.signingSecret).toMatch(/^whsec_/);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ subscriberUrl: "https://app/api/webhooks/conn_1", active: true, triggers: expect.arrayContaining(["BOOKING_CREATED"]) });
    await calcomConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "k" }, externalId: "42" });
    expect(calls[1].init.method).toBe("DELETE");
  });
});
```

(`apiVersion` is a documented extra property on the connector object — see the module — so the test pins the header without re-spelling the date.)

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/calcom.ts
import { randomBytes } from "node:crypto";
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Cal.com (API v2). A booking carries createdAt (when it was booked) and
 * start/end (when it happens); we date `booked` by createdAt and keep the
 * slot in properties. Docs read 7 Sep 2026: /v2/bookings filters with
 * afterUpdatedAt and sorts with sortUpdatedAt, so the watermark is updatedAt.
 * The cal-api-version header is mandatory and changes response shape — pinned.
 */
const DEFAULT_API = "https://api.cal.com/v2";
const API_VERSION = "2024-08-13";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 100;

export const CALCOM_TRIGGERS = ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "BOOKING_NO_SHOW_UPDATED", "MEETING_ENDED"] as const;

function api(credentials?: Record<string, unknown> | null) {
  const base = str(credentials?.["baseUrl"]) || DEFAULT_API;
  return bearerClient(base, requireCredential(credentials, "apiKey", "Cal.com"), "Cal.com", { "cal-api-version": API_VERSION });
}

const attendeeEmail = (b: Record<string, unknown>): string | null => {
  const a = Array.isArray(b["attendees"]) ? asObject((b["attendees"] as unknown[])[0]) : {};
  return str(a["email"]);
};

type Kind = "booked" | "canceled" | "rescheduled" | "no_show" | "meeting_held";

function bookingEvent(b: Record<string, unknown>, kind: Kind, connectionId: string, at: Date | null, fallback?: Date): CanonicalEvent | null {
  const uid = str(b["uid"]) ?? str(b["id"]);
  if (!uid) return null;
  const suffix = kind === "booked" ? "" : kind === "meeting_held" ? ":held" : `:${kind}`;
  return {
    eventId: eventId("calcom", connectionId, uid) + suffix,
    eventType: kind,
    subject: attendeeEmail(b),
    occurredAt: at ?? fallback ?? new Date(),
    properties: b,
  };
}

const iso = (v: unknown, field: string): Date | null => parseDate(str(v), field);

export const calcomConnector: Connector & { apiVersion: string } = {
  source: "calcom",
  authType: "apiKey",
  apiVersion: API_VERSION,
  operations: ["bookings.list"] as const,
  operationFor: () => "bookings.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-cal-signature-256", encoding: "hex" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const trigger = str(body["triggerEvent"]);
    const b = asObject(body["payload"]);
    let ev: CanonicalEvent | null = null;
    switch (trigger) {
      case "BOOKING_CREATED":
        ev = bookingEvent(b, "booked", ctx.connectionId, iso(b["createdAt"], "createdAt"), ctx.fallbackOccurredAt);
        break;
      case "BOOKING_CANCELLED":
        ev = bookingEvent(b, "canceled", ctx.connectionId, iso(b["updatedAt"], "updatedAt") ?? iso(b["cancelledAt"], "cancelledAt"), ctx.fallbackOccurredAt);
        break;
      case "BOOKING_RESCHEDULED":
        ev = bookingEvent(b, "rescheduled", ctx.connectionId, iso(b["updatedAt"], "updatedAt") ?? iso(b["createdAt"], "createdAt"), ctx.fallbackOccurredAt);
        break;
      case "BOOKING_NO_SHOW_UPDATED":
        ev = bookingEvent(b, "no_show", ctx.connectionId, iso(b["updatedAt"], "updatedAt") ?? iso(b["startTime"], "startTime") ?? iso(b["start"], "start"), ctx.fallbackOccurredAt);
        break;
      case "MEETING_ENDED":
        ev = bookingEvent(b, "meeting_held", ctx.connectionId, iso(b["endTime"], "endTime") ?? iso(b["end"], "end"), ctx.fallbackOccurredAt);
        break;
      default:
        return [];
    }
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    let skip = 0;
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        skip = cont ? Number(cont) || 0 : 0;
        const page = await client.get<{ data?: unknown[]; pagination?: { hasNextPage?: boolean } }>("/bookings", {
          afterUpdatedAt: since.toISOString(),
          sortUpdatedAt: "asc",
          take: PAGE,
          skip,
        });
        const rows = (page.data ?? []).map(asObject);
        const more = page.pagination?.hasNextPage === true && rows.length > 0;
        return { rows, next: more ? String(skip + rows.length) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (b) => isoOrNull(b["updatedAt"]),
      happenedAt: (b) => isoOrNull(b["createdAt"]),
      map: (b) => {
        // Poll sees the booking's CURRENT status: every booking was booked, and
        // a cancelled one also gets its cancellation. Reschedules and no-shows
        // arrive by webhook; the poll keeps the walk honest for the counts a
        // customer defends (booked, cancelled).
        const status = str(b["status"]);
        const created = bookingEvent(b, "booked", args.connectionId, iso(b["createdAt"], "createdAt"));
        if (status !== "cancelled" && status !== "rejected") return created;
        return created; // the cancellation is emitted through `extra` below
      },
    }).then(async (res) => {
      // Second pass for cancellations: windowedWalk maps one row to one event.
      // Cancelled bookings are rare enough that re-deriving from the records'
      // properties costs nothing and keeps `map` single-valued.
      const extra: CanonicalEvent[] = [];
      for (const r of res.records) {
        const b = r.properties ?? {};
        const status = str(b["status"]);
        if (status === "cancelled" || status === "rejected") {
          const c = bookingEvent(b, "canceled", args.connectionId, iso(b["updatedAt"], "updatedAt"));
          if (c) extra.push(c);
        }
      }
      return { ...res, records: [...res.records, ...extra] };
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const client = api(args.credentials);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const res = await client.post<{ data?: { id?: number | string } }>("/webhooks", {
      subscriberUrl: args.webhookUrl,
      triggers: [...CALCOM_TRIGGERS],
      active: true,
      secret,
    });
    const id = res.data?.id;
    return { signingSecret: secret, externalId: id != null ? String(id) : undefined };
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
```

Catalog entry:

```ts
  {
    source: "calcom",
    name: "Cal.com",
    description: "Meetings booked, cancelled, rescheduled, marked no-show, and held.",
    brand: { color: "#292929", short: "Cal" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    webhookOptional: true,
    docs: { url: "https://cal.com/docs/api-reference/v2/bookings/get-all-bookings", readOn: "2026-09-07", webhooks: "https://cal.com/docs/developing/guides/automation/webhooks" },
    verified: { live: null },
    // https://cal.com/docs/api-reference/v2/rate-limits (read 2026-09-07): 120 requests/minute by default.
    rateLimits: { "bookings.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiKey", label: "API key", placeholder: "cal_live_…" },
      { key: "baseUrl", label: "API base URL (self-hosted only)", placeholder: "https://api.cal.com/v2" },
    ],
    eventTypeLabels: { booked: "Meeting booked", canceled: "Meeting cancelled", rescheduled: "Meeting rescheduled", no_show: "No-show", meeting_held: "Meeting held" },
    commonFields: ["status", "start", "end", "eventType.slug", "attendees.0.email", "createdAt"],
  },
```

`booked`/`canceled`/`no_show` are Calendly's keys; check Calendly's `eventTypeLabels` at build and copy its strings verbatim for those three (the label-collision test allows disagreement, but agreement is the honest reading).

- [ ] **Step 4: Prober** — `API = "https://api.cal.com/v2"`, header `cal-api-version`, list `${API}/bookings?take=5`, bounded `${API}/bookings?take=50&afterUpdatedAt=2030-01-01T00:00:00.000Z`; note which of `take/skip` and `cursor/limit` the response's `pagination` block reflects.

- [ ] **Steps 5–8**, then:

```bash
git add src/connectors/calcom.ts src/connectors/catalog.ts src/connectors/registry.ts tests/calcom.test.ts scripts/verify-calcom.ts scripts/check-orphans.ts
git commit -m "Add Cal.com: booked by createdAt, held by endTime, webhook registered with our secret

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Aircall

**Files:** create `src/connectors/aircall.ts`, `tests/aircall.test.ts`, `scripts/verify-aircall.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `basicClient`).

**Facts (7 Sep 2026):** reference `https://developers.aircall.io/api-references`, webhooks `https://developer.aircall.io/tutorials/webhooks-guide/`. Auth: HTTP Basic, `api_id` as username and `api_token` as password. List: `GET https://api.aircall.io/v1/calls?from=<unix>&to=<unix>&order=asc&per_page=50&page=<n>` → `{ calls: Call[], meta: { count, total, current_page, per_page, next_page_link } }`; Call: `id`, `direction` (`inbound|outbound`), `status` (`initial|answered|done`), `started_at`, `answered_at`, `ended_at` (unix seconds; `answered_at` null when missed), `duration` (seconds, INCLUDES ring time), `missed_call_reason`, `user{ id, email }`, `number{ digits }`, `contact{ … }`, `tags[]`. `from/to` filter on the call's creation (`started_at`). Webhooks: `POST /v1/webhooks { custom_name, url, events[] }` → `{ webhook: { webhook_id, token } }`; every delivery body is `{ resource, event, timestamp, token, data: Call }`. Verification per first-party docs = compare the delivery's `token` with the one returned at registration. An `X-Aircall-Signature` HMAC is claimed by third parties only — UNCONFIRMED; not built. Events: `call.created`, `call.answered`, `call.ended`, `call.tagged`, `call.voicemail_left`, `call.archived`. Rate limit 120/min per company (`X-AircallApi-Limit/-Remaining/-Reset` headers). Talk time = `ended_at − answered_at`, computed here.

**Interfaces:** `aircallConnector` (`authType: "apiKey"`; the connection's signing secret IS the registration token).

- [ ] **Step 1: Failing test** (skeleton with calcom→aircall, then:)

```ts
const call = (over: Record<string, unknown> = {}) => ({ id: 771, direction: "inbound", status: "done", started_at: 1_757_200_000, answered_at: 1_757_200_012, ended_at: 1_757_200_312, duration: 312, missed_call_reason: null, user: { id: 9, email: "rep@x.io" }, number: { digits: "+1555" }, raw_digits: "+1444", tags: [], ...over });
const delivery = (event: string, data: Record<string, unknown>, token = "tok_abc") => JSON.stringify({ resource: "call", event, timestamp: 1_757_200_400, token, data });

describe("aircall: signature", () => {
  it("is the registration token in the body, compared in constant time; fails closed", () => {
    const body = delivery("call.created", call());
    expect(aircallConnector.verifySignature({ rawBody: body, headers: {}, secret: "tok_abc" })).toBe(true);
    expect(aircallConnector.verifySignature({ rawBody: body, headers: {}, secret: "tok_other" })).toBe(false);
    expect(aircallConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(false);
    expect(aircallConnector.verifySignature({ rawBody: "not json", headers: {}, secret: "tok_abc" })).toBe(false);
  });
});

describe("aircall: normalize", () => {
  it("created → call_logged at started_at; answered → call_connected at answered_at; ended → call_completed with talk time as the value", () => {
    const [a] = aircallConnector.normalize!(JSON.parse(delivery("call.created", call())), { connectionId: CONN });
    expect(a).toMatchObject({ eventId: "aircall:conn_1:771", eventType: "call_logged", subject: "rep@x.io" });
    expect(a.occurredAt.toISOString()).toBe(new Date(1_757_200_000 * 1000).toISOString());
    const [b] = aircallConnector.normalize!(JSON.parse(delivery("call.answered", call())), { connectionId: CONN });
    expect(b).toMatchObject({ eventId: "aircall:conn_1:771:connected", eventType: "call_connected" });
    const [c] = aircallConnector.normalize!(JSON.parse(delivery("call.ended", call())), { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "aircall:conn_1:771:completed", eventType: "call_completed", value: 300 });
    expect(c.properties).toMatchObject({ talk_seconds: 300, ring_seconds: 12 });
  });
  it("a missed call ends as call_missed with a zero value; tagged and voicemail are their own events", () => {
    const [m] = aircallConnector.normalize!(JSON.parse(delivery("call.ended", call({ answered_at: null, missed_call_reason: "no_available_agent", duration: 20 }))), { connectionId: CONN });
    expect(m).toMatchObject({ eventType: "call_missed", value: 0 });
    const [t] = aircallConnector.normalize!(JSON.parse(delivery("call.tagged", call({ tags: [{ name: "Qualified" }] }))), { connectionId: CONN });
    expect(t).toMatchObject({ eventId: "aircall:conn_1:771:tagged", eventType: "call_tagged" });
    const [v] = aircallConnector.normalize!(JSON.parse(delivery("call.voicemail_left", call())), { connectionId: CONN });
    expect(v.eventType).toBe("voicemail_left");
  });
});

describe("aircall: poll", () => {
  it("lists calls between from/to with basic auth and emits the full lifecycle per call", async () => {
    const calls = stubFetch([{ calls: [call()], meta: { next_page_link: null } }]);
    const res = await aircallConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiId: "id", apiToken: "tok" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["call_completed", "call_connected", "call_logged"]);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/calls");
    expect(u.searchParams.get("order")).toBe("asc");
    expect(Number(u.searchParams.get("from"))).toBeGreaterThan(0);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("id:tok").toString("base64")}`);
    expect(res.nextCursor).toBe(new Date(1_757_200_000 * 1000).toISOString());
  });
  it("registers a webhook and stores Aircall's token as the signing secret", async () => {
    const calls = stubFetch([{ webhook: { webhook_id: "wh_1", token: "tok_new" } }]);
    const reg = await aircallConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiId: "id", apiToken: "tok" } });
    expect(reg).toEqual({ signingSecret: "tok_new", externalId: "wh_1" });
    expect(JSON.parse(String(calls[0].init.body)).events).toContain("call.ended");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/aircall.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { basicClient, epochToDate, eventId, requireCredential, sharedTokenVerify, windowedWalk } from "./kit";

/**
 * Aircall. Calls carry started_at / answered_at / ended_at separately, so
 * pickup rate is "answered_at is not null" and talk time is a subtraction
 * (`duration` includes ring time — never use it as talk time). Docs read
 * 7 Sep 2026: developers.aircall.io/api-references (calls list, webhooks).
 * Verification is the registration token echoed in every delivery — the
 * only scheme in Aircall's own docs.
 */
const API = "https://api.aircall.io/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
export const AIRCALL_EVENTS = ["call.created", "call.answered", "call.ended", "call.tagged", "call.voicemail_left"] as const;

const api = (c?: Record<string, unknown> | null) => basicClient(API, requireCredential(c, "apiId", "Aircall"), requireCredential(c, "apiToken", "Aircall"), "Aircall");
const secs = (v: unknown) => epochToDate(v, "s");

function events(call: Record<string, unknown>, connectionId: string, only?: string): CanonicalEvent[] {
  const id = str(call["id"]) ?? (typeof call["id"] === "number" ? String(call["id"]) : null);
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
  if (want("call.tagged") && only === "call.tagged") out.push({ eventId: `${base}:tagged`, eventType: "call_tagged", subject: rep, occurredAt: ended ?? started ?? new Date(), properties: props });
  if (want("call.voicemail_left") && only === "call.voicemail_left") out.push({ eventId: `${base}:voicemail`, eventType: "voicemail_left", subject: rep, occurredAt: ended ?? started ?? new Date(), properties: props });
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
    const res = await api(args.credentials).post<{ webhook?: { webhook_id?: string; token?: string } }>("/webhooks", {
      custom_name: "Namzilabs",
      url: args.webhookUrl,
      events: [...AIRCALL_EVENTS],
    });
    return { signingSecret: res.webhook?.token, externalId: res.webhook?.webhook_id };
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
```

Catalog entry:

```ts
  {
    source: "aircall",
    name: "Aircall",
    description: "Calls dialled, answered, completed (talk time in seconds), missed, tagged.",
    brand: { color: "#00B388", short: "Ai" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    docs: { url: "https://developers.aircall.io/api-references", readOn: "2026-09-07", webhooks: "https://developer.aircall.io/tutorials/webhooks-guide/" },
    verified: { live: null },
    // developers.aircall.io/api-references (read 2026-09-07): 120 requests/minute per company.
    rateLimits: { "calls.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiId", label: "API ID", placeholder: "…" },
      { key: "apiToken", label: "API token", placeholder: "…" },
    ],
    eventTypeLabels: { call_logged: "Call logged", call_connected: "Call connected", call_completed: "Call completed", call_missed: "Call missed", call_tagged: "Call tagged", voicemail_left: "Voicemail left" },
    commonFields: ["direction", "status", "user.email", "missed_call_reason", "talk_seconds", "ring_seconds", "tags"],
  },
```

- [ ] **Step 4: Prober** — Basic auth from `AIRCALL_API_KEY` in the form `id:token`; list `${API}/calls?per_page=5`; bounded `from=1900000000`; print `X-AircallApi-*` headers; and NOTE whether a delivery header named `x-aircall-signature` exists by printing all headers of a `GET /v1/ping` response (it will not — the note records the absence).

- [ ] **Commit:** `Add Aircall: pickup and talk time from three timestamps, verified by the registration token`

---

### Task 4: Pipedrive

**Files:** create `src/connectors/pipedrive.ts`, `tests/pipedrive.test.ts`, `scripts/verify-pipedrive.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developers.pipedrive.com/docs/api/v1`, webhooks v2 `https://pipedrive.readme.io/docs/guide-for-webhooks-v2`. Auth: `api_token` query param (or `x-api-token` header — confirm; the module uses the header if the docs list it, else the query param). Deals v2: `GET https://api.pipedrive.com/api/v2/deals?updated_since=<ISO>&sort_by=update_time&sort_direction=asc&limit=100&cursor=<c>` → `{ data: Deal[], additional_data: { next_cursor } }`; Deal: `id`, `title`, `value`, `currency`, `status` (`open|won|lost`), `stage_id`, `pipeline_id`, `person_id`, `add_time`, `update_time`, `stage_change_time`, `won_time`, `lost_time`, `close_time`, `expected_close_date` (FORECAST — never occurredAt). Webhooks v2: `POST /v1/webhooks { subscription_url, event_action: "*", event_object: "deal", version: "2.0", http_auth_user, http_auth_password }` — verification is HTTP Basic on OUR endpoint (no HMAC). Delivery: `{ meta: { action, entity, entity_id, timestamp, version }, data: Deal, previous: { changed fields } }`. Persons: `GET /api/v2/persons?updated_since…` similarly; `person.created` from `add_time`. Rate limits: daily token budget per company (30,000 × plan × seats); v2 endpoints cost less; 429 until midnight — declare a conservative 100/min and rely on the observed layer.

**Interfaces:** `pipedriveConnector` (`authType: "apiKey"`); the signing secret is the basic-auth password we set at registration under the fixed user `namzilabs`.

- [ ] **Step 1: Failing test**

```ts
const deal = (over: Record<string, unknown> = {}) => ({ id: 5, title: "Acme", value: 1200, currency: "USD", status: "open", stage_id: 3, pipeline_id: 1, person_id: 77, add_time: "2026-09-01T10:00:00Z", update_time: "2026-09-02T11:00:00Z", stage_change_time: "2026-09-02T11:00:00Z", won_time: null, lost_time: null, expected_close_date: "2026-12-31", ...over });
const basic = (pw: string) => `Basic ${Buffer.from(`namzilabs:${pw}`).toString("base64")}`;

describe("pipedrive: signature", () => {
  it("is the basic-auth credential we registered; fails closed", () => {
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: { authorization: basic("pw1") }, secret: "pw1" })).toBe(true);
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: { authorization: basic("pw2") }, secret: "pw1" })).toBe(false);
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: {}, secret: "pw1" })).toBe(false);
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: { authorization: basic("pw1") }, secret: null })).toBe(false);
  });
});

describe("pipedrive: normalize", () => {
  it("a created deal is opportunity_created at add_time; a stage change is deal_stage_changed at stage_change_time with previous stage", () => {
    const [c] = pipedriveConnector.normalize!({ meta: { action: "create", entity: "deal", entity_id: 5, timestamp: "2026-09-01T10:00:01Z" }, data: deal() }, { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "pipedrive:conn_1:deal:5", eventType: "opportunity_created", value: 1200, currency: "USD", subject: "77" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    const [s] = pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5, timestamp: "2026-09-02T11:00:01Z" }, data: deal(), previous: { stage_id: 2 } }, { connectionId: CONN });
    expect(s).toMatchObject({ eventId: "pipedrive:conn_1:deal:5:stage:3", eventType: "deal_stage_changed" });
    expect(s.occurredAt.toISOString()).toBe("2026-09-02T11:00:00.000Z");
    expect(s.properties).toMatchObject({ previous_stage_id: 2 });
  });
  it("won and lost date by won_time / lost_time, never by expected_close_date; a change with no stage or status move is dropped", () => {
    const [w] = pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5 }, data: deal({ status: "won", won_time: "2026-09-03T12:00:00Z" }), previous: { status: "open" } }, { connectionId: CONN });
    expect(w).toMatchObject({ eventId: "pipedrive:conn_1:deal:5:won", eventType: "deal_won", value: 1200 });
    expect(w.occurredAt.toISOString()).toBe("2026-09-03T12:00:00.000Z");
    const [l] = pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5 }, data: deal({ status: "lost", lost_time: "2026-09-04T12:00:00Z", lost_reason: "price" }), previous: { status: "open" } }, { connectionId: CONN });
    expect(l).toMatchObject({ eventType: "deal_lost" });
    expect(pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5 }, data: deal(), previous: { title: "Old" } }, { connectionId: CONN })).toEqual([]);
    const [p] = pipedriveConnector.normalize!({ meta: { action: "create", entity: "person", entity_id: 77 }, data: { id: 77, add_time: "2026-09-01T09:00:00Z", emails: [{ value: "p@x.io", primary: true }] } }, { connectionId: CONN });
    expect(p).toMatchObject({ eventId: "pipedrive:conn_1:person:77", eventType: "lead_created", subject: "p@x.io" });
  });
});

describe("pipedrive: poll", () => {
  it("walks v2 deals by updated_since with the token, emits created plus the current stage/outcome, settles on update_time", async () => {
    const calls = stubFetch([{ data: [deal({ status: "won", won_time: "2026-09-03T12:00:00Z" })], additional_data: { next_cursor: null } }]);
    const res = await pipedriveConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiToken: "t0k" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["deal_stage_changed", "deal_won", "opportunity_created"]);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/api/v2/deals");
    expect(u.searchParams.get("sort_by")).toBe("update_time");
    expect(u.searchParams.get("updated_since")).toMatch(/^\d{4}-/);
    expect((calls[0].init.headers as Record<string, string>)["x-api-token"]).toBe("t0k");
    expect(res.nextCursor).toBe("2026-09-02T11:00:00.000Z");
  });
  it("registers a v2 deal webhook with basic auth and returns the password as the signing secret", async () => {
    const calls = stubFetch([{ data: { id: 31 } }]);
    const reg = await pipedriveConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiToken: "t" } });
    expect(reg.externalId).toBe("31");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ subscription_url: "https://app/api/webhooks/conn_1", event_action: "*", event_object: "deal", version: "2.0", http_auth_user: "namzilabs" });
    expect(body.http_auth_password).toBe(reg.signingSecret);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/pipedrive.ts
import { randomBytes } from "node:crypto";
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError, basicAuth } from "@/lib/http-client";
import { safeEqual } from "@/lib/signatures";
import { eventId, headerKeyClient, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Pipedrive. The deal itself carries add_time, stage_change_time, won_time
 * and lost_time, so both paths date events by when they happened.
 * expected_close_date is a forecast and stays in properties. Docs read
 * 7 Sep 2026: developers.pipedrive.com/docs/api/v1 (v2 deals list) and
 * pipedrive.readme.io/docs/guide-for-webhooks-v2. Webhooks v2 authenticate
 * with HTTP Basic on our endpoint — there is no HMAC — so the signing secret
 * is the password we set at registration.
 */
const API = "https://api.pipedrive.com";
const BASIC_USER = "namzilabs";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

const api = (c?: Record<string, unknown> | null) => headerKeyClient(API, "x-api-token", requireCredential(c, "apiToken", "Pipedrive"), "Pipedrive");
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
```

Catalog entry:

```ts
  {
    source: "pipedrive",
    name: "Pipedrive",
    description: "Deals created, moved between stages, won and lost; people added.",
    brand: { color: "#017737", short: "Pd" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote: "The poll sees each deal's current stage; every intermediate hop arrives by webhook. Archived deals are not listed.",
    autoWebhook: true,
    webhookOptional: true,
    docs: { url: "https://developers.pipedrive.com/docs/api/v1", readOn: "2026-09-07", webhooks: "https://pipedrive.readme.io/docs/guide-for-webhooks-v2" },
    verified: { live: null },
    // Pipedrive budgets by daily tokens per company, not requests per minute
    // (developers.pipedrive.com/docs/api/v1/rate-limiting, read 2026-09-07);
    // 100/min keeps a busy sweep well inside a 30,000-token day and the
    // observed layer handles 429.
    rateLimits: { "deals.list": { requestsPerMinute: 100 } },
    credentialFields: [{ key: "apiToken", label: "API token (Settings → Personal preferences → API)", placeholder: "…" }],
    eventTypeLabels: { opportunity_created: "Deal created", deal_stage_changed: "Deal moved stage", deal_won: "Deal won", deal_lost: "Deal lost", lead_created: "Person added" },
    commonFields: ["status", "stage_id", "pipeline_id", "value", "currency", "person_id", "previous_stage_id", "lost_reason"],
  },
```

(`lead_created` and `opportunity_created` are Close's keys; Close declares no label for them, so these labels stand alone — confirm with `tests/event-type-labels.test.ts`.)

- [ ] **Step 4: Prober** — header `x-api-token`; list `${API}/api/v2/deals?limit=5`; bounded `updated_since=2030-01-01T00:00:00Z`; also request `/v1/webhooks` and note the response's version field so the "v2 is default" fact is measured.

- [ ] **Commit:** `Add Pipedrive: deals dated by the times the deal itself carries, webhooks by basic auth`

---

### Task 5: Typeform

**Files:** create `src/connectors/typeform.ts`, `tests/typeform.test.ts`, `scripts/verify-typeform.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `naturalOrHash`, `ymd`).

**Facts (7 Sep 2026):** webhooks `https://www.typeform.com/developers/webhooks/`, signing `https://www.typeform.com/developers/webhooks/secure-your-webhooks/`, responses `https://www.typeform.com/developers/responses/reference/retrieve-responses/`. Auth: personal access token as Bearer at `https://api.typeform.com`. Forms: `GET /forms?page_size=200` → `{ items: [{ id, title }] }`. Responses: `GET /forms/{form_id}/responses?page_size=1000&since=<ISO>&sort=submitted_at,asc&after=<token>` → `{ total_items, page_count, items: [{ response_id, token, landed_at, submitted_at, answers[], hidden, metadata }] }` (`since` filters on `submitted_at`; incomplete responses carry `submitted_at: "0001-01-01T00:00:00Z"`). Webhook: `Typeform-Signature: sha256=<base64 HMAC-SHA256 over raw body>` — only when a `secret` was set on the webhook; payload `{ event_id, event_type: "form_response", form_response: { form_id, token, landed_at, submitted_at, answers[] } }`. Rate limit: 2 req/s per account (120/min). Stream-scoped: one form per Get-data step.

**Interfaces:** `typeformConnector` (`authType: "apiKey"`, stream field `formId`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "tf_secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("base64")}`;
const response = (over: Record<string, unknown> = {}) => ({ response_id: "r1", token: "tok1", landed_at: "2026-09-01T10:00:00Z", submitted_at: "2026-09-01T10:03:00Z", answers: [{ type: "email", email: "lead@x.io", field: { id: "f1", type: "email" } }, { type: "text", text: "hi", field: { id: "f2", type: "short_text" } }], hidden: { utm: "x" }, ...over });

describe("typeform: signature", () => {
  it("base64 HMAC over the raw body behind sha256=; fails closed", () => {
    const body = JSON.stringify({ event_id: "e1", event_type: "form_response", form_response: response() });
    expect(typeformConnector.verifySignature({ rawBody: body, headers: { "typeform-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(typeformConnector.verifySignature({ rawBody: body, headers: { "typeform-signature": sign(body) }, secret: null })).toBe(false);
    expect(typeformConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("typeform: normalize", () => {
  it("a submission is form_submitted at submitted_at with the email answer as subject, plus form_started at landed_at", () => {
    const evs = typeformConnector.normalize!({ event_id: "e1", event_type: "form_response", form_response: { form_id: "F1", ...response() } }, { connectionId: CONN });
    expect(evs.map((e) => e.eventType)).toEqual(["form_submitted", "form_started"]);
    expect(evs[0]).toMatchObject({ eventId: "typeform:conn_1:F1:tok1", subject: "lead@x.io" });
    expect(evs[0].occurredAt.toISOString()).toBe("2026-09-01T10:03:00.000Z");
    expect(evs[1]).toMatchObject({ eventId: "typeform:conn_1:F1:tok1:started" });
    expect(evs[1].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(evs[0].properties).toMatchObject({ answers_by_field: { f1: "lead@x.io", f2: "hi" }, hidden: { utm: "x" } });
  });
  it("the year-1 sentinel means not submitted: only form_started is emitted", () => {
    const evs = typeformConnector.normalize!({ event_id: "e2", event_type: "form_response", form_response: { form_id: "F1", ...response({ submitted_at: "0001-01-01T00:00:00Z" }) } }, { connectionId: CONN });
    expect(evs.map((e) => e.eventType)).toEqual(["form_started"]);
  });
});

describe("typeform: poll (stream = one form)", () => {
  it("lists a form's responses since the mark, sorted ascending, and settles on the newest submitted_at", async () => {
    const calls = stubFetch([{ total_items: 1, page_count: 1, items: [response()] }]);
    const res = await typeformConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pat" }, config: { formId: "F1" }, streamHash: "h1" });
    expect(res.records.map((r) => r.eventType)).toEqual(["form_submitted", "form_started"]);
    expect(res.nextCursor).toBe("2026-09-01T10:03:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/forms/F1/responses");
    expect(u.searchParams.get("sort")).toBe("submitted_at,asc");
    expect(u.searchParams.get("since")).toMatch(/^\d{4}-/);
  });
  it("without a form there is nothing to read; listOptions names the forms", async () => {
    expect(await typeformConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pat" }, config: {} })).toEqual({ records: [], nextCursor: null });
    stubFetch([{ items: [{ id: "F1", title: "Intro call" }] }]);
    expect(await typeformConnector.listOptions!("formId", { connectionId: CONN, credentials: { apiKey: "pat" } })).toEqual([{ value: "F1", label: "Intro call" }]);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/typeform.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Typeform. A response carries landed_at (started) and submitted_at
 * (completed), so one row yields the lead AND the funnel-top event; the
 * year-1 sentinel on submitted_at means "not completed". Stream-scoped:
 * each flow reads one form. Docs read 7 Sep 2026: developers/responses
 * (since filters on submitted_at) and developers/webhooks (sha256= base64).
 */
const API = "https://api.typeform.com";
const SENTINEL = "0001-01-01T00:00:00Z";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Typeform"), "Typeform");

function answersByField(answers: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of Array.isArray(answers) ? answers.map(asObject) : []) {
    const field = asObject(a["field"]);
    const id = str(field["ref"]) ?? str(field["id"]);
    if (!id) continue;
    const type = str(a["type"]);
    const raw = type ? a[type] : undefined;
    out[id] = raw !== null && typeof raw === "object" ? (asObject(raw)["label"] ?? asObject(raw)["labels"] ?? raw) : raw;
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
        const page = await client.get<{ items?: unknown[]; page_count?: number }>(`/forms/${encodeURIComponent(formId)}/responses`, {
          page_size: 1000,
          since: since.toISOString(),
          sort: "submitted_at,asc",
          after: cont ?? undefined,
        });
        const rows = (page.items ?? []).map(asObject);
        const last = rows.length ? str(rows[rows.length - 1]["token"]) : null;
        return { rows, next: rows.length === 1000 && last ? last : null, rateLimit: client.rateLimit() };
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
```

Catalog entry:

```ts
  {
    source: "typeform",
    name: "Typeform",
    description: "Form submissions (and forms started, for a completion rate), one form per step.",
    brand: { color: "#262627", short: "Tf" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: false,
    docs: { url: "https://www.typeform.com/developers/responses/reference/retrieve-responses/", readOn: "2026-09-07", webhooks: "https://www.typeform.com/developers/webhooks/secure-your-webhooks/" },
    verified: { live: null },
    // developers/get-started/rate-limits (read 2026-09-07): 2 requests/second per account.
    rateLimits: { "responses.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiKey", label: "Personal access token", placeholder: "tfp_…" },
      { key: "webhookSecret", label: "Webhook secret (the one you set on the form's webhook)", placeholder: "…" },
    ],
    flowFields: [{ key: "formId", label: "Form", required: true, dynamic: true, placeholder: "Choose a form…", hint: "Each step reads one form." }],
    eventTypeLabels: { form_submitted: "Form submitted", form_started: "Form started" },
    commonFields: ["form_id", "answers_by_field", "hidden", "metadata.referer", "landed_at", "submitted_at"],
    webhookSetup:
      "In Typeform, open the form → Connect → Webhooks, add the URL below and set a secret; paste the same secret " +
      "as the webhook secret on this connection. A delivery triggers an immediate refresh of that form's step.",
  },
```

- [ ] **Step 4: Prober** — list `${API}/forms?page_size=5`; for the first form, `responses?page_size=5` unbounded vs `since=2030-01-01T00:00:00Z`; note whether `submitted_at` ever equals the sentinel in the sample.

- [ ] **Commit:** `Add Typeform: submitted and started from one response, one form per step`

---

### Task 6: Tally

**Files:** create `src/connectors/tally.ts`, `tests/tally.test.ts`, `scripts/verify-tally.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developers.tally.so/api-reference/introduction`, webhooks `https://developers.tally.so/api-reference/endpoint/webhooks/post`. Auth: `Authorization: Bearer <key>` at `https://api.tally.so`; free on every plan. Forms: `GET /forms?page=1&limit=100` → `{ items: [{ id, name }] }`. Submissions: `GET /forms/{formId}/submissions?page=<n>&limit=500&filter=all&startDate=<ISO>` → `{ page, limit, hasMore, submissions: [{ id, formId, isCompleted, submittedAt, respondentId, responses: [{ questionId, answer }] }], questions: [{ id, title, type }] }`. Webhook: `POST /webhooks { formId, url, eventTypes: ["FORM_RESPONSE"], signingSecret }`; delivery `{ eventId, eventType: "FORM_RESPONSE", createdAt, data: { responseId, submissionId, respondentId, formId, formName, createdAt, fields: [{ key, label, type, value }] } }`; header `tally-signature` = base64 HMAC-SHA256 — construction over the raw body is the documented reading but UNCONFIRMED. Rate limit 100/min. Stream-scoped (one form per step); `instant: true` rings the doorbell.

**Interfaces:** `tallyConnector` (`authType: "apiKey"`, stream field `formId`, `autoWebhook: false`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "tally_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64");
const delivery = { eventId: "ev1", eventType: "FORM_RESPONSE", createdAt: "2026-09-01T10:00:00.000Z", data: { responseId: "s1", submissionId: "s1", respondentId: "resp1", formId: "F1", formName: "Lead", createdAt: "2026-09-01T10:00:00.000Z", fields: [{ key: "q_email", label: "Email", type: "INPUT_EMAIL", value: "lead@x.io" }, { key: "q_name", label: "Name", type: "INPUT_TEXT", value: "Lee" }] } };
const submission = (over: Record<string, unknown> = {}) => ({ id: "s1", formId: "F1", isCompleted: true, submittedAt: "2026-09-01T10:00:00.000Z", respondentId: "resp1", responses: [{ questionId: "q_email", answer: "lead@x.io" }], ...over });

describe("tally: signature", () => {
  it("base64 HMAC over the raw body in tally-signature; fails closed", () => {
    const body = JSON.stringify(delivery);
    expect(tallyConnector.verifySignature({ rawBody: body, headers: { "tally-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(tallyConnector.verifySignature({ rawBody: body, headers: { "tally-signature": sign(body) }, secret: null })).toBe(false);
    expect(tallyConnector.verifySignature({ rawBody: body, headers: { "tally-signature": sign("x") }, secret: SECRET })).toBe(false);
  });
});

describe("tally: normalize", () => {
  it("FORM_RESPONSE is form_submitted at data.createdAt, keyed by submission id, subject from the email field", () => {
    const [ev] = tallyConnector.normalize!(delivery, { connectionId: CONN });
    expect(ev).toMatchObject({ eventId: "tally:conn_1:F1:s1", eventType: "form_submitted", subject: "lead@x.io" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(ev.properties).toMatchObject({ fields_by_label: { Email: "lead@x.io", Name: "Lee" }, formName: "Lead" });
  });
});

describe("tally: poll (stream = one form)", () => {
  it("pages submissions from startDate, labels partials, and settles on the newest submittedAt", async () => {
    const calls = stubFetch([{ page: 1, limit: 500, hasMore: false, submissions: [submission(), submission({ id: "s2", isCompleted: false, submittedAt: "2026-09-01T11:00:00.000Z" })], questions: [{ id: "q_email", title: "Email", type: "INPUT_EMAIL" }] }]);
    const res = await tallyConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" }, config: { formId: "F1" } });
    expect(res.records.map((r) => `${r.eventType}:${r.eventId}`)).toEqual(["form_submitted:tally:conn_1:F1:s1", "form_partial:tally:conn_1:F1:s2"]);
    expect(res.records[0].properties).toMatchObject({ fields_by_label: { Email: "lead@x.io" } });
    expect(res.nextCursor).toBe("2026-09-01T11:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/forms/F1/submissions");
    expect(u.searchParams.get("filter")).toBe("all");
    expect(u.searchParams.get("startDate")).toMatch(/^\d{4}-/);
  });
  it("listOptions names the forms", async () => {
    stubFetch([{ items: [{ id: "F1", name: "Lead" }] }]);
    expect(await tallyConnector.listOptions!("formId", { connectionId: CONN, credentials: { apiKey: "k" } })).toEqual([{ value: "F1", label: "Lead" }]);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/tally.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Tally. Submissions carry submittedAt and an explicit isCompleted, so
 * completed vs partial is a field, not a heuristic. One form per step.
 * Docs read 7 Sep 2026: developers.tally.so (submissions list, webhooks).
 * The signature construction (base64 HMAC-SHA256 over the raw body) is the
 * documented reading but not spelled out — confirm on a live delivery.
 */
const API = "https://api.tally.so";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

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
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "tally-signature", encoding: "base64" });
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
    const res = await api(args.credentials).get<{ items?: unknown[] }>("/forms", { page: 1, limit: 100 });
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
          limit: 500,
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
```

Catalog entry:

```ts
  {
    source: "tally",
    name: "Tally",
    description: "Form submissions, completed and partial, one form per step.",
    brand: { color: "#0D0D0D", short: "Ta" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: false,
    docs: { url: "https://developers.tally.so/api-reference/introduction", readOn: "2026-09-07", webhooks: "https://developers.tally.so/api-reference/endpoint/webhooks/post" },
    verified: { live: null },
    // developers.tally.so/api-reference/introduction (read 2026-09-07): 100 requests/minute.
    rateLimits: { "submissions.list": { requestsPerMinute: 100 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → API keys)", placeholder: "tly-…" },
      { key: "webhookSecret", label: "Webhook signing secret (the one you set on the form's webhook)", placeholder: "…" },
    ],
    flowFields: [{ key: "formId", label: "Form", required: true, dynamic: true, placeholder: "Choose a form…", hint: "Each step reads one form." }],
    eventTypeLabels: { form_submitted: "Form submitted", form_partial: "Form partially filled" },
    commonFields: ["formId", "isCompleted", "fields_by_label", "respondentId", "submittedAt"],
    webhookSetup:
      "In Tally, open the form → Integrations → Webhooks, add the URL below with a signing secret, and paste the same " +
      "secret as the webhook signing secret on this connection. A delivery triggers an immediate refresh of that form's step.",
  },
```

- [ ] **Step 4: Prober** — list `${API}/forms?limit=5`; first form's `submissions?limit=5` unbounded vs `startDate=2030-01-01T00:00:00.000Z`; print `hasMore` and `totalNumberOfSubmissionsPerFilter`.

- [ ] **Commit:** `Add Tally: completed and partial submissions, one form per step`

> **Checkpoint after Task 6:** full `pnpm test` with the dev server stopped, `pnpm build`, then `git push origin worktree-figma-overview-match:main`.

---

### Task 7: Smartlead

**Files:** create `src/connectors/smartlead.ts`, `tests/smartlead.test.ts`, `scripts/verify-smartlead.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `pace`).

**Facts (7 Sep 2026):** docs `https://api.smartlead.ai/introduction`, webhook events `https://api.smartlead.ai/api-reference/webhooks/events`. Auth: `api_key` QUERY PARAMETER on every request (never log URLs). Base `https://server.smartlead.ai/api/v1`. Campaigns: `GET /campaigns?api_key=…` → `[{ id, name, status }]`. Per-lead statistics: `GET /campaigns/{id}/statistics?api_key=…&offset=<n>&limit=100` → `{ total_stats, data: [{ lead_email, sent_time, open_time, click_time, reply_time, email_subject, sequence_number, stats_id }] }` (confirm field names at build). Webhook events: `EMAIL_SENT` (`time_sent`), `EMAIL_OPEN` (`time_opened`), `EMAIL_LINK_CLICK` (`time_clicked`), `EMAIL_REPLY` (`time_replied`), `EMAIL_BOUNCE`, `LEAD_UNSUBSCRIBED`, `LEAD_CATEGORY_UPDATED`; body carries `event_type`, `campaign_id`, `to_email`/`lead_email`, `stats_id`/`email_stats_id`, `sequence_number`, `webhook_id`. Signature: the docs show `hmac.new(secret, payload, sha256).hexdigest()` but never name the header — UNCONFIRMED; accept the hex digest from any of `x-smartlead-signature`, `x-signature`, `signature`, else fail closed. Rate limits unpublished (plan-gated): declare 30/min and let the observed layer widen. Stream-scoped per campaign; webhooks register per user/client so new campaigns are covered (`association_type: 1`).

**Interfaces:** `smartleadConnector` (`authType: "apiKey"`, stream `campaignId`, `SMARTLEAD_SIGNATURE_HEADERS`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "sl_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const row = (over: Record<string, unknown> = {}) => ({ stats_id: "st1", lead_email: "lead@x.io", sequence_number: 1, sent_time: "2026-09-01T10:00:00.000Z", open_time: "2026-09-01T11:00:00.000Z", click_time: null, reply_time: "2026-09-02T09:00:00.000Z", email_subject: "Hi", ...over });

describe("smartlead: signature", () => {
  it("hex HMAC over the raw body in any of the candidate headers; fails closed", () => {
    const body = JSON.stringify({ event_type: "EMAIL_REPLY", campaign_id: 7, stats_id: "st1", to_email: "lead@x.io", time_replied: "2026-09-02T09:00:00.000Z" });
    for (const h of ["x-smartlead-signature", "x-signature", "signature"]) expect(smartleadConnector.verifySignature({ rawBody: body, headers: { [h]: sign(body) }, secret: SECRET }), h).toBe(true);
    expect(smartleadConnector.verifySignature({ rawBody: body, headers: { "x-signature": sign(body) }, secret: null })).toBe(false);
    expect(smartleadConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("smartlead: normalize", () => {
  it("maps each event type to the outreach vocabulary, dated by its own time field", () => {
    const cases: Array<[string, string, string]> = [["EMAIL_SENT", "time_sent", "email_sent"], ["EMAIL_OPEN", "time_opened", "email_opened"], ["EMAIL_LINK_CLICK", "time_clicked", "email_clicked"], ["EMAIL_REPLY", "time_replied", "reply"], ["EMAIL_BOUNCE", "time_sent", "bounced"], ["LEAD_UNSUBSCRIBED", "time_sent", "unsubscribed"]];
    for (const [type, field, ours] of cases) {
      const [ev] = smartleadConnector.normalize!({ event_type: type, campaign_id: 7, stats_id: "st1", to_email: "lead@x.io", [field]: "2026-09-02T09:00:00.000Z" }, { connectionId: CONN });
      expect(ev, type).toMatchObject({ eventType: ours, subject: "lead@x.io" });
      expect(ev.eventId, type).toBe(`smartlead:conn_1:7:st1:${ours}`);
      expect(ev.occurredAt.toISOString(), type).toBe("2026-09-02T09:00:00.000Z");
    }
    const [cat] = smartleadConnector.normalize!({ event_type: "LEAD_CATEGORY_UPDATED", campaign_id: 7, lead_email: "lead@x.io", lead_category: "Interested" }, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-03T00:00:00Z") });
    expect(cat).toMatchObject({ eventType: "lead_interested" });
    expect(cat.occurredAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });
});

describe("smartlead: poll (stream = one campaign)", () => {
  it("pages campaign statistics with the key in the query, fans one row into sent/open/reply, settles on the newest time", async () => {
    const calls = stubFetch([{ data: [row()] }, { data: [] }]);
    const res = await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" }, config: { campaignId: "7" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["email_opened", "email_sent", "reply"]);
    expect(res.nextCursor).toBe("2026-09-02T09:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/api/v1/campaigns/7/statistics");
    expect(u.searchParams.get("api_key")).toBe("K");
    expect(u.searchParams.get("offset")).toBe("0");
  });
  it("listOptions names the campaigns", async () => {
    stubFetch([[{ id: 7, name: "Q3 outbound", status: "ACTIVE" }]]);
    expect(await smartleadConnector.listOptions!("campaignId", { connectionId: CONN, credentials: { apiKey: "K" } })).toEqual([{ value: "7", label: "Q3 outbound" }]);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/smartlead.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { eventId, hmacHeaderVerify, isoOrNull, providerClient, requireCredential, windowedWalk } from "./kit";

/**
 * Smartlead — the same shape as Instantly: one dated row per send, open,
 * click and reply. The API key travels in the query string, so URLs are
 * never logged. Docs read 7 Sep 2026: api.smartlead.ai. The signature
 * header is not named in the docs; the hex digest is accepted from three
 * candidate headers and the prober records which one a live delivery uses.
 */
const API = "https://server.smartlead.ai/api/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
const PAGE = 100;
export const SMARTLEAD_SIGNATURE_HEADERS = ["x-smartlead-signature", "x-signature", "signature"] as const;

const EVENTS: Record<string, { ours: string; time: string }> = {
  EMAIL_SENT: { ours: "email_sent", time: "time_sent" },
  FIRST_EMAIL_SENT: { ours: "email_sent", time: "time_sent" },
  EMAIL_OPEN: { ours: "email_opened", time: "time_opened" },
  EMAIL_LINK_CLICK: { ours: "email_clicked", time: "time_clicked" },
  EMAIL_REPLY: { ours: "reply", time: "time_replied" },
  EMAIL_BOUNCE: { ours: "bounced", time: "time_sent" },
  LEAD_UNSUBSCRIBED: { ours: "unsubscribed", time: "time_sent" },
};

function client(credentials?: Record<string, unknown> | null) {
  const key = requireCredential(credentials, "apiKey", "Smartlead");
  const base = providerClient({ baseUrl: API, headers: {}, provider: "Smartlead" });
  return {
    get: <T,>(path: string, params: Record<string, string | number | undefined> = {}) => base.get<T>(path, { ...params, api_key: key }),
    rateLimit: base.rateLimit,
  };
}

const idOf = (v: unknown) => (typeof v === "number" ? String(v) : str(v));

function rowEvents(r: Record<string, unknown>, campaignId: string, connectionId: string): CanonicalEvent[] {
  const id = idOf(r["stats_id"]) ?? idOf(r["email_stats_id"]) ?? idOf(r["id"]);
  if (!id) return [];
  const email = str(r["lead_email"]) ?? str(r["to_email"]);
  const out: CanonicalEvent[] = [];
  const push = (ours: string, field: string) => {
    const at = parseDate(str(r[field]), field);
    if (at) out.push({ eventId: eventId("smartlead", connectionId, campaignId, id, ours), eventType: ours, subject: email, occurredAt: at, properties: { ...r, campaign_id: campaignId } });
  };
  push("email_sent", "sent_time");
  push("email_opened", "open_time");
  push("email_clicked", "click_time");
  push("reply", "reply_time");
  return out;
}

export const smartleadConnector: Connector = {
  source: "smartlead",
  authType: "apiKey",
  operations: ["campaigns.statistics"] as const,
  operationFor: () => "campaigns.statistics",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return SMARTLEAD_SIGNATURE_HEADERS.some((header) => hmacHeaderVerify({ rawBody, headers, secret }, { header, encoding: "hex" }));
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const b = asObject(rawPayload);
    const type = str(b["event_type"]);
    const campaignId = idOf(b["campaign_id"]) ?? "campaign";
    const email = str(b["to_email"]) ?? str(b["lead_email"]);
    if (type === "LEAD_CATEGORY_UPDATED") {
      const category = str(b["lead_category"]) ?? str(b["category"]) ?? "";
      const at = parseDate(str(b["event_timestamp"]), "event_timestamp") ?? ctx.fallbackOccurredAt ?? new Date();
      const id = idOf(b["stats_id"]) ?? email ?? "lead";
      return [{ eventId: eventId("smartlead", ctx.connectionId, campaignId, id, "category", category.toLowerCase()), eventType: /interest|meeting|positive/i.test(category) ? "lead_interested" : "lead_category_updated", subject: email, occurredAt: at, properties: b }];
    }
    const spec = type ? EVENTS[type] : undefined;
    if (!spec) return [];
    const id = idOf(b["stats_id"]) ?? idOf(b["email_stats_id"]) ?? idOf(b["webhook_id"]);
    if (!id) return [];
    const at = parseDate(str(b[spec.time]), spec.time) ?? parseDate(str(b["event_timestamp"]), "event_timestamp") ?? ctx.fallbackOccurredAt ?? new Date();
    return [{ eventId: eventId("smartlead", ctx.connectionId, campaignId, id, spec.ours), eventType: spec.ours, subject: email, occurredAt: at, properties: b }];
  },
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "campaignId") return [];
    const res = await client(args.credentials).get<unknown>("/campaigns");
    const rows = Array.isArray(res) ? res.map(asObject) : (asObject(res)["data"] as unknown[] | undefined)?.map(asObject) ?? [];
    return rows.map((c) => ({ value: idOf(c["id"]) ?? "", label: str(c["name"]) ?? idOf(c["id"]) ?? "Untitled campaign" })).filter((o) => o.value);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const campaignId = str(args.config?.["campaignId"]);
    if (!campaignId) return { records: [], nextCursor: null };
    const api = client(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const offset = cont ? Number(cont) || 0 : 0;
        const page = await api.get<{ data?: unknown[] }>(`/campaigns/${encodeURIComponent(campaignId)}/statistics`, { offset, limit: PAGE });
        // No server-side date filter: keep rows whose newest time is inside the window,
        // and stop paging once a whole page predates it.
        const all = (page.data ?? []).map(asObject);
        const newest = (r: Record<string, unknown>) => Math.max(...["sent_time", "open_time", "click_time", "reply_time"].map((f) => Date.parse(str(r[f]) ?? "") || 0));
        const rows = all.filter((r) => newest(r) >= since.getTime());
        const exhausted = all.length < PAGE || (all.length > 0 && rows.length === 0);
        return { rows, next: exhausted ? null : String(offset + all.length), rateLimit: api.rateLimit() };
      },
      changedAt: (r) => {
        const times = ["sent_time", "open_time", "click_time", "reply_time"].map((f) => isoOrNull(r[f])).filter((x): x is string => !!x);
        return times.sort().pop() ?? null;
      },
      map: (r) => rowEvents(r, campaignId, args.connectionId)[0] ?? null,
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...rowEvents(r.properties ?? {}, campaignId, args.connectionId));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
```

Catalog entry:

```ts
  {
    source: "smartlead",
    name: "Smartlead",
    description: "Cold email sent, opened, clicked, replied, bounced — per campaign.",
    brand: { color: "#5B5FEF", short: "Sl" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: false,
    docs: { url: "https://api.smartlead.ai/introduction", readOn: "2026-09-07", webhooks: "https://api.smartlead.ai/api-reference/webhooks/events" },
    verified: { live: null },
    // Unpublished and plan-gated ("contact support", api.smartlead.ai read 2026-09-07):
    // 30/min is a floor the observed layer widens from real headers.
    rateLimits: { "campaigns.statistics": { requestsPerMinute: 30 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → API)", placeholder: "…" },
      { key: "webhookSecret", label: "Webhook secret (set on the webhook in Smartlead)", placeholder: "…" },
    ],
    flowFields: [{ key: "campaignId", label: "Campaign", required: true, dynamic: true, placeholder: "Choose a campaign…", hint: "Each step reads one campaign." }],
    eventTypeLabels: { email_sent: "Email sent", reply: "Reply received", lead_interested: "Lead marked interested", lead_category_updated: "Lead category updated" },
    commonFields: ["campaign_id", "lead_email", "sequence_number", "email_subject", "lead_category"],
    webhookSetup:
      "In Smartlead → Settings → Webhooks, add the URL below for the whole workspace (not one campaign) with a secret, and paste " +
      "the same secret as the webhook secret on this connection. A delivery triggers an immediate refresh of the campaign's step.",
  },
```

- [ ] **Step 4: Prober** — use `pace(2100)` between requests (the docs ask for ≥2 s); list campaigns; first campaign's `statistics?limit=5`; print the response's field names so `sent_time/open_time/click_time/reply_time` are confirmed or corrected; print every header of any response for a future signature capture.

- [ ] **Commit:** `Add Smartlead: one dated row per send, open, click and reply, one campaign per step`

---

### Task 8: Help Scout

**Files:** create `src/connectors/helpscout.ts`, `tests/helpscout.test.ts`, `scripts/verify-helpscout.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developer.helpscout.com/mailbox-api/`, auth `https://developer.helpscout.com/mailbox-api/overview/authentication/`, webhooks `https://developer.helpscout.com/webhooks/`. Auth: OAuth2 client credentials — `POST https://api.helpscout.net/v2/oauth2/token { grant_type: "client_credentials", client_id, client_secret }` → `{ access_token, expires_in }` (48 h); then Bearer. Conversations: `GET /v2/conversations?status=all&modifiedSince=<ISO>&sortField=modifiedAt&sortOrder=asc&page=<n>` → `{ _embedded: { conversations: [{ id, number, subject, status, createdAt, closedAt, userUpdatedAt, customerWaitingSince, primaryCustomer: { email }, assignee: { email } }] }, page: { totalPages, number } }`. Threads: `GET /v2/conversations/{id}/threads` → `{ _embedded: { threads: [{ id, type: "customer"|"message"|"note", createdAt, createdBy: { type, email } }] } }`. Webhook: `X-HelpScout-Signature` = base64 HMAC-**SHA1** over the raw body keyed on the secret; events `convo.created`, `convo.customer.reply.created`, `convo.agent.reply.created`, `convo.status`, `convo.assigned`; header `X-HelpScout-Event`. Registration: `POST /v2/webhooks { url, events[], secret, payloadVersion: "V2" }` → `Resource-ID` response header. Rate limit: per plan (~200–800/min), headers `X-RateLimit-*`; declare 200.

**Interfaces:** `helpscoutConnector` (`authType: "apiKey"`, credentials `appId` + `appSecret`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "hs_secret";
const sign = (body: string) => createHmac("sha1", SECRET).update(body).digest("base64");
const convo = (over: Record<string, unknown> = {}) => ({ id: 101, number: 55, subject: "Help", status: "active", createdAt: "2026-09-01T10:00:00Z", closedAt: null, userUpdatedAt: "2026-09-01T10:00:00Z", primaryCustomer: { email: "cust@x.io" }, assignee: null, ...over });

describe("helpscout: signature", () => {
  it("base64 HMAC-SHA1 over the raw body; fails closed", () => {
    const body = JSON.stringify(convo());
    expect(helpscoutConnector.verifySignature({ rawBody: body, headers: { "x-helpscout-signature": sign(body), "x-helpscout-event": "convo.created" }, secret: SECRET })).toBe(true);
    expect(helpscoutConnector.verifySignature({ rawBody: body, headers: { "x-helpscout-signature": sign(body) }, secret: null })).toBe(false);
    expect(helpscoutConnector.verifySignature({ rawBody: body + "x", headers: { "x-helpscout-signature": sign(body) }, secret: SECRET })).toBe(false);
  });
});

describe("helpscout: normalize (event named by the X-HelpScout-Event header)", () => {
  it("created, customer reply, agent reply, closed, assigned", () => {
    const h = (event: string) => ({ connectionId: CONN, headers: { "x-helpscout-event": event } });
    const [c] = helpscoutConnector.normalize!(convo(), h("convo.created"));
    expect(c).toMatchObject({ eventId: "helpscout:conn_1:101", eventType: "conversation_created", subject: "cust@x.io" });
    const [r] = helpscoutConnector.normalize!(convo({ _embedded: { threads: [{ id: 9, type: "customer", createdAt: "2026-09-01T12:00:00Z", createdBy: { email: "cust@x.io" } }] } }), h("convo.customer.reply.created"));
    expect(r).toMatchObject({ eventId: "helpscout:conn_1:101:thread:9", eventType: "customer_replied" });
    expect(r.occurredAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    const [a] = helpscoutConnector.normalize!(convo({ _embedded: { threads: [{ id: 10, type: "message", createdAt: "2026-09-01T12:30:00Z", createdBy: { type: "user", email: "agent@x.io" } }] } }), h("convo.agent.reply.created"));
    expect(a).toMatchObject({ eventId: "helpscout:conn_1:101:thread:10", eventType: "agent_replied", subject: "agent@x.io" });
    const [z] = helpscoutConnector.normalize!(convo({ status: "closed", closedAt: "2026-09-02T08:00:00Z" }), h("convo.status"));
    expect(z).toMatchObject({ eventId: "helpscout:conn_1:101:closed", eventType: "conversation_closed" });
    expect(z.occurredAt.toISOString()).toBe("2026-09-02T08:00:00.000Z");
    const [s] = helpscoutConnector.normalize!(convo({ assignee: { email: "agent@x.io" }, userUpdatedAt: "2026-09-01T10:05:00Z" }), h("convo.assigned"));
    expect(s).toMatchObject({ eventType: "conversation_assigned", subject: "agent@x.io" });
    expect(helpscoutConnector.normalize!(convo({ status: "active" }), h("convo.status"))).toEqual([]);
  });
});

describe("helpscout: poll", () => {
  it("exchanges the app credentials for a token, walks conversations by modifiedSince, reads each one's threads", async () => {
    const calls = stubFetch([
      { access_token: "tok", expires_in: 172800 },
      { _embedded: { conversations: [convo({ status: "closed", closedAt: "2026-09-02T08:00:00Z", userUpdatedAt: "2026-09-02T08:00:00Z" })] }, page: { totalPages: 1, number: 1 } },
      { _embedded: { threads: [{ id: 9, type: "customer", createdAt: "2026-09-01T10:00:00Z", createdBy: { email: "cust@x.io" } }, { id: 10, type: "message", createdAt: "2026-09-01T10:20:00Z", createdBy: { type: "user", email: "agent@x.io" } }] } },
    ]);
    const res = await helpscoutConnector.poll!({ connectionId: CONN, cursor: null, credentials: { appId: "id", appSecret: "sec" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["agent_replied", "conversation_closed", "conversation_created", "customer_replied"]);
    expect(res.providerCalls).toBe(2);
    expect(res.nextCursor).toBe("2026-09-02T08:00:00.000Z");
    expect(new URL(calls[0].url).pathname).toBe("/v2/oauth2/token");
    const u = new URL(calls[1].url);
    expect(u.pathname).toBe("/v2/conversations");
    expect(u.searchParams.get("modifiedSince")).toMatch(/^\d{4}-/);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("registers a webhook with our secret and reads the Resource-ID header", async () => {
    const calls = stubFetch([{ access_token: "tok", expires_in: 1 }, {}], { "resource-id": "77" });
    const reg = await helpscoutConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { appId: "id", appSecret: "sec" } });
    expect(reg.externalId).toBe("77");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ url: "https://app/api/webhooks/conn_1", secret: reg.signingSecret, payloadVersion: "V2" });
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/helpscout.ts
import { randomBytes } from "node:crypto";
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { fetchJson, HttpError } from "@/lib/http-client";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk, type ProviderClient } from "./kit";

/**
 * Help Scout. Conversations carry createdAt, closedAt and userUpdatedAt;
 * threads say who replied and when, so first response falls out with no
 * heuristics. Docs read 7 Sep 2026: developer.helpscout.com/mailbox-api
 * (client-credentials token, conversations, threads) and /webhooks
 * (X-HelpScout-Signature, base64 HMAC-SHA1 over the raw body).
 * modifiedSince is an UPDATE cursor: an edited old conversation reappears
 * with its old createdAt, which dedup by id absorbs.
 */
const API = "https://api.helpscout.net";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 30, overlapMs: 5 * 60_000 };
export const HELPSCOUT_EVENTS = ["convo.created", "convo.customer.reply.created", "convo.agent.reply.created", "convo.status", "convo.assigned"] as const;

async function token(credentials?: Record<string, unknown> | null): Promise<string> {
  const res = await fetchJson<{ access_token?: string }>(`${API}/v2/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: requireCredential(credentials, "appId", "Help Scout"), client_secret: requireCredential(credentials, "appSecret", "Help Scout") }),
  });
  if (!res.access_token) throw new Error("Help Scout rejected the app credentials — open the connection and reconnect.");
  return res.access_token;
}
const client = async (c?: Record<string, unknown> | null): Promise<ProviderClient> => bearerClient(API, await token(c), "Help Scout");

const idOf = (v: unknown) => (typeof v === "number" ? String(v) : str(v));
const customer = (c: Record<string, unknown>) => str(asObject(c["primaryCustomer"])["email"]);
const threadsOf = (c: Record<string, unknown>) => (Array.isArray(asObject(c["_embedded"])["threads"]) ? (asObject(c["_embedded"])["threads"] as unknown[]).map(asObject) : []);

function threadEvent(c: Record<string, unknown>, t: Record<string, unknown>, connectionId: string): CanonicalEvent | null {
  const cid = idOf(c["id"]);
  const tid = idOf(t["id"]);
  const at = parseDate(str(t["createdAt"]), "createdAt");
  if (!cid || !tid || !at) return null;
  const by = asObject(t["createdBy"]);
  const type = str(t["type"]);
  if (type === "customer") return { eventId: eventId("helpscout", connectionId, cid, "thread", tid), eventType: "customer_replied", subject: str(by["email"]) ?? customer(c), occurredAt: at, properties: { ...t, conversation_id: cid } };
  if (type === "message") return { eventId: eventId("helpscout", connectionId, cid, "thread", tid), eventType: "agent_replied", subject: str(by["email"]), occurredAt: at, properties: { ...t, conversation_id: cid } };
  return null;
}

function conversationEvents(c: Record<string, unknown>, connectionId: string, which: "created" | "closed" | "assigned" | "all"): CanonicalEvent[] {
  const cid = idOf(c["id"]);
  if (!cid) return [];
  const base = eventId("helpscout", connectionId, cid);
  const out: CanonicalEvent[] = [];
  const created = parseDate(str(c["createdAt"]), "createdAt");
  if ((which === "created" || which === "all") && created) out.push({ eventId: base, eventType: "conversation_created", subject: customer(c), occurredAt: created, properties: c });
  const closed = parseDate(str(c["closedAt"]), "closedAt") ?? (c["status"] === "closed" ? parseDate(str(c["userUpdatedAt"]), "userUpdatedAt") : null);
  if ((which === "closed" || which === "all") && c["status"] === "closed" && closed) out.push({ eventId: `${base}:closed`, eventType: "conversation_closed", subject: customer(c), occurredAt: closed, properties: c });
  const assignee = str(asObject(c["assignee"])["email"]);
  const assignedAt = parseDate(str(c["userUpdatedAt"]), "userUpdatedAt");
  if (which === "assigned" && assignee && assignedAt) out.push({ eventId: `${base}:assigned:${assignee}`, eventType: "conversation_assigned", subject: assignee, occurredAt: assignedAt, properties: c });
  return out;
}

export const helpscoutConnector: Connector = {
  source: "helpscout",
  authType: "apiKey",
  operations: ["conversations.list"] as const,
  operationFor: () => "conversations.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-helpscout-signature", encoding: "base64", algorithm: "sha1" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const c = asObject(rawPayload);
    const event = ctx.headers?.["x-helpscout-event"] ?? "";
    if (event === "convo.created") return conversationEvents(c, ctx.connectionId, "created");
    if (event === "convo.status") return conversationEvents(c, ctx.connectionId, "closed");
    if (event === "convo.assigned") return conversationEvents(c, ctx.connectionId, "assigned");
    if (event === "convo.customer.reply.created" || event === "convo.agent.reply.created") {
      const threads = threadsOf(c);
      const latest = threads[threads.length - 1];
      const ev = latest ? threadEvent(c, latest, ctx.connectionId) : null;
      return ev ? [ev] : [];
    }
    return [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const api = await client(args.credentials);
    let extraCalls = 0;
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = cont ? Number(cont) || 1 : 1;
        const res = await api.get<{ _embedded?: { conversations?: unknown[] }; page?: { totalPages?: number; number?: number } }>("/v2/conversations", {
          status: "all",
          modifiedSince: since.toISOString().replace(/\.\d{3}Z$/, "Z"),
          sortField: "modifiedAt",
          sortOrder: "asc",
          page,
        });
        const rows = (res._embedded?.conversations ?? []).map(asObject);
        // Threads are the timeline; one extra call per conversation, counted.
        for (const c of rows) {
          const cid = idOf(c["id"]);
          if (!cid) continue;
          const th = await api.get<{ _embedded?: { threads?: unknown[] } }>(`/v2/conversations/${cid}/threads`);
          extraCalls += 1;
          c["_embedded"] = { threads: th._embedded?.threads ?? [] };
        }
        const more = (res.page?.number ?? page) < (res.page?.totalPages ?? 1);
        return { rows, next: more ? String(page + 1) : null, rateLimit: api.rateLimit() };
      },
      changedAt: (c) => isoOrNull(c["userUpdatedAt"]) ?? isoOrNull(c["createdAt"]),
      happenedAt: (c) => isoOrNull(c["createdAt"]),
      map: (c) => conversationEvents(c, args.connectionId, "created")[0] ?? null,
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) {
      const c = r.properties ?? {};
      fanned.push(...conversationEvents(c, args.connectionId, "all"));
      for (const t of threadsOf(c)) {
        const ev = threadEvent(c, t, args.connectionId);
        if (ev) fanned.push(ev);
      }
    }
    return { ...res, records: fanned, providerCalls: (res.providerCalls ?? 0) + extraCalls };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const secret = randomBytes(24).toString("base64url");
    let resourceId: string | undefined;
    const api = bearerClient(API, await token(args.credentials), "Help Scout", {}, { onResponse: (res) => { resourceId = res.headers.get("resource-id") ?? undefined; } } as never);
    await api.post("/v2/webhooks", { url: args.webhookUrl, events: [...HELPSCOUT_EVENTS], secret, payloadVersion: "V2", label: "Namzilabs" });
    return { signingSecret: secret, externalId: resourceId };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      (await client(args.credentials)).del(`/v2/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
```

`registerWebhook` needs the `Resource-ID` response header; `ClientOpts.fetchOptions` omits `onResponse`, so in the kit (Task 3 of the infra plan) `providerClient` composes a caller-supplied `onResponse` when `fetchOptions` carries one: change the kit's `onResponse` line to `onResponse: (res) => { observed = parseRateLimit(res.headers) ?? observed; o.fetchOptions?.onResponse?.(res); }` and widen `ClientOpts.fetchOptions` to `Omit<FetchJsonOptions, "headers" | "method" | "body">`. Add to `tests/kit-http.test.ts`: `it("forwards onResponse", …)` asserting the caller's hook sees the Response. Drop the `as never` once that lands.

Catalog entry:

```ts
  {
    source: "helpscout",
    name: "Help Scout",
    description: "Conversations opened, customer and agent replies, closed, assigned — response time from the threads.",
    brand: { color: "#1292EE", short: "Hs" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    docs: { url: "https://developer.helpscout.com/mailbox-api/", readOn: "2026-09-07", webhooks: "https://developer.helpscout.com/webhooks/" },
    verified: { live: null },
    // Per plan and shared across the account's apps (developer.helpscout.com/mailbox-api/overview/rate-limiting,
    // read 2026-09-07: "depends on your plan"); 200/min is the Standard-plan figure reported by integrators.
    rateLimits: { "conversations.list": { requestsPerMinute: 200 } },
    credentialFields: [
      { key: "appId", label: "App ID (My Apps → Create app)", placeholder: "…" },
      { key: "appSecret", label: "App secret", placeholder: "…" },
    ],
    eventTypeLabels: { conversation_created: "Conversation opened", customer_replied: "Customer replied", agent_replied: "Agent replied", conversation_closed: "Conversation closed", conversation_assigned: "Conversation assigned" },
    commonFields: ["status", "subject", "primaryCustomer.email", "assignee.email", "mailboxId", "conversation_id"],
  },
```

- [ ] **Step 4: Prober** — `HELPSCOUT_API_KEY` in the form `appId:appSecret`; exchange the token; list `conversations?status=all` unbounded vs `modifiedSince=2030-01-01T00:00:00Z`; print `X-RateLimit-*` headers.

- [ ] **Commit:** `Add Help Scout: first response from the threads, closed from the conversation`

---

### Task 9: Attio

**Files:** create `src/connectors/attio.ts`, `tests/attio.test.ts`, `scripts/verify-attio.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://docs.attio.com/rest-api/overview`, webhooks `https://docs.attio.com/rest-api/guides/webhooks`. Auth: `Authorization: Bearer <access token>` at `https://api.attio.com/v2`. Records query: `POST /v2/objects/{object}/records/query { filter: { created_at: { $gte: "<ISO>" } }, sorts: [{ attribute: "created_at", direction: "asc" }], limit: 500, offset: <n> }` → `{ data: [{ id: { record_id }, created_at, values: { name: [{ value }], email_addresses: [{ email_address }], stage: [{ status: { title } , active_from }], value: [{ currency_value, currency_code }] } }] }` (confirm the filter/sort syntax at build). Webhook: `Attio-Signature` (also `X-Attio-Signature`) = hex HMAC-SHA256 over the raw body; delivery `{ webhook_id, events: [{ event_type: "record.created"|"record.updated"|"list-entry.created"|…, id: { workspace_id, object_id, record_id, attribute_id? }, actor, … }] }`; `Idempotency-Key` header. Registration: `POST /v2/webhooks { data: { target_url, subscriptions: [{ event_type, filter: null }] } }` → `{ data: { id: { webhook_id }, secret } }`. Rate limits 100 reads/s. Stage lives on the deal's `stage` status attribute (or on a list entry); the poll emits created events; stage changes arrive by webhook as `record.updated` on the stage attribute (re-fetched).

**Interfaces:** `attioConnector` (`authType: "apiKey"`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "attio_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const deal = (over: Record<string, unknown> = {}) => ({ id: { record_id: "rec_1", object_id: "deals" }, created_at: "2026-09-01T10:00:00.000000000Z", values: { name: [{ value: "Acme" }], stage: [{ status: { title: "Qualified" }, active_from: "2026-09-02T09:00:00.000000000Z" }], value: [{ currency_value: 1200, currency_code: "USD" }] }, ...over });
const person = { id: { record_id: "rec_p", object_id: "people" }, created_at: "2026-09-01T08:00:00.000000000Z", values: { email_addresses: [{ email_address: "p@x.io" }] } };

describe("attio: signature", () => {
  it("hex HMAC over the raw body in attio-signature (or x-attio-signature); fails closed", () => {
    const body = JSON.stringify({ webhook_id: "wh", events: [] });
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "attio-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "x-attio-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "attio-signature": sign(body) }, secret: null })).toBe(false);
    expect(attioConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("attio: normalize", () => {
  it("record.created on deals is opportunity_created; on people is lead_created; record.updated on the stage attribute is deal_stage_changed keyed by the stage", () => {
    const evs = attioConnector.normalize!({ webhook_id: "wh", events: [
      { event_type: "record.created", id: { object_id: "deals", record_id: "rec_1" }, record: deal(), occurred_at: "2026-09-01T10:00:00Z" },
      { event_type: "record.created", id: { object_id: "people", record_id: "rec_p" }, record: person },
      { event_type: "record.updated", id: { object_id: "deals", record_id: "rec_1", attribute_id: "stage" }, record: deal() },
      { event_type: "note.created", id: { note_id: "n1" } },
    ] }, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-03T00:00:00Z") });
    expect(evs.map((e) => `${e.eventType}:${e.eventId}`)).toEqual(["opportunity_created:attio:conn_1:deals:rec_1", "lead_created:attio:conn_1:people:rec_p", "deal_stage_changed:attio:conn_1:deals:rec_1:stage:qualified"]);
    expect(evs[0]).toMatchObject({ value: 1200, currency: "USD", subject: "Acme" });
    expect(evs[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(evs[1].subject).toBe("p@x.io");
    expect(evs[2].occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
  });
});

describe("attio: poll", () => {
  it("queries deals then people created since the mark, and settles on the newest created_at", async () => {
    const calls = stubFetch([{ data: [deal()] }, { data: [person] }]);
    const res = await attioConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "tok" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["deal_stage_changed", "lead_created", "opportunity_created"]);
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    expect(new URL(calls[0].url).pathname).toBe("/v2/objects/deals/records/query");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ sorts: [{ attribute: "created_at", direction: "asc" }], limit: 500, offset: 0 });
    expect(new URL(calls[1].url).pathname).toBe("/v2/objects/people/records/query");
  });
  it("registers a webhook and returns Attio's secret", async () => {
    const calls = stubFetch([{ data: { id: { webhook_id: "wh_9" }, secret: "s9" } }]);
    expect(await attioConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "tok" } })).toEqual({ signingSecret: "s9", externalId: "wh_9" });
    expect(JSON.parse(String(calls[0].init.body)).data.target_url).toBe("https://app/api/webhooks/conn_1");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/attio.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Attio. Records carry created_at; a status attribute's current value
 * carries active_from — exactly when that stage began. Docs read 7 Sep
 * 2026: docs.attio.com/rest-api (records query, webhooks). Pipelines
 * modelled as lists arrive as list-entry.* events, mapped here to the same
 * vocabulary. Stage changes come by webhook; the poll covers creations.
 */
const API = "https://api.attio.com/v2";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const OBJECTS = ["deals", "people"] as const;
export const ATTIO_SUBSCRIPTIONS = ["record.created", "record.updated", "list-entry.created"] as const;

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Attio"), "Attio");
const first = (values: Record<string, unknown>, key: string) => (Array.isArray(values[key]) ? asObject((values[key] as unknown[])[0]) : {});
const nameOf = (v: Record<string, unknown>) => str(first(v, "name")["value"]) ?? str(first(v, "name")["full_name"]);
const emailOf = (v: Record<string, unknown>) => str(first(v, "email_addresses")["email_address"]);

function recordEvents(objectId: string, rec: Record<string, unknown>, connectionId: string, which: "created" | "stage"): CanonicalEvent[] {
  const id = str(asObject(rec["id"])["record_id"]);
  if (!id) return [];
  const values = asObject(rec["values"]);
  const base = eventId("attio", connectionId, objectId, id);
  const money = first(values, "value");
  const value = typeof money["currency_value"] === "number" ? money["currency_value"] : null;
  const currency = str(money["currency_code"])?.toUpperCase() ?? null;
  const out: CanonicalEvent[] = [];
  if (which === "created") {
    const at = parseDate(str(rec["created_at"]), "created_at");
    if (!at) return [];
    if (objectId === "deals") out.push({ eventId: base, eventType: "opportunity_created", subject: nameOf(values), occurredAt: at, value, currency, properties: rec });
    else out.push({ eventId: base, eventType: "lead_created", subject: emailOf(values) ?? nameOf(values), occurredAt: at, properties: rec });
  } else {
    const stage = first(values, "stage");
    const title = str(asObject(stage["status"])["title"]) ?? str(stage["title"]);
    const at = parseDate(str(stage["active_from"]), "active_from");
    if (title && at) out.push({ eventId: `${base}:stage:${title.toLowerCase().replace(/\s+/g, "_")}`, eventType: "deal_stage_changed", subject: nameOf(values), occurredAt: at, value, currency, properties: { ...rec, stage: title } });
  }
  return out;
}

export const attioConnector: Connector = {
  source: "attio",
  authType: "apiKey",
  operations: ["records.query"] as const,
  operationFor: () => "records.query",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return ["attio-signature", "x-attio-signature"].some((header) => hmacHeaderVerify({ rawBody, headers, secret }, { header, encoding: "hex" }));
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const out: CanonicalEvent[] = [];
    for (const e of Array.isArray(body["events"]) ? (body["events"] as unknown[]).map(asObject) : []) {
      const type = str(e["event_type"]);
      const id = asObject(e["id"]);
      const objectId = str(id["object_id"]) ?? "";
      const rec = asObject(e["record"]);
      if (type === "record.created" && Object.keys(rec).length) out.push(...recordEvents(objectId, rec, ctx.connectionId, "created"));
      else if (type === "record.updated" && objectId === "deals" && Object.keys(rec).length) out.push(...recordEvents(objectId, rec, ctx.connectionId, "stage"));
      else if (type === "list-entry.created") {
        const entryId = str(id["entry_id"]);
        const at = parseDate(str(e["occurred_at"]), "occurred_at") ?? ctx.fallbackOccurredAt ?? new Date();
        if (entryId) out.push({ eventId: eventId("attio", ctx.connectionId, "list", str(id["list_id"]) ?? "list", entryId), eventType: "deal_stage_changed", subject: str(id["parent_record_id"]), occurredAt: at, properties: e });
      }
    }
    return out;
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    // Two objects, one cursor: the walk runs per object in sequence and the
    // later mark wins — creations are monotone, so the union is complete.
    const all: CanonicalEvent[] = [];
    let last: PollResult = { records: [], nextCursor: args.cursor };
    for (const object of OBJECTS) {
      last = await windowedWalk<Record<string, unknown>>({
        cursor: args.cursor,
        budget: args.budget,
        windowFloor: args.windowFloor,
        defaults: DEFAULTS,
        fetchPage: async ({ since, cont }) => {
          const offset = cont ? Number(cont) || 0 : 0;
          const page = await client.post<{ data?: unknown[] }>(`/objects/${object}/records/query`, {
            filter: { created_at: { $gte: since.toISOString() } },
            sorts: [{ attribute: "created_at", direction: "asc" }],
            limit: 500,
            offset,
          });
          const rows = (page.data ?? []).map(asObject);
          return { rows, next: rows.length === 500 ? String(offset + 500) : null, rateLimit: client.rateLimit() };
        },
        changedAt: (r) => isoOrNull(r["created_at"]),
        map: (r) => recordEvents(object, r, args.connectionId, "created")[0] ?? null,
      });
      for (const r of last.records) {
        all.push(...recordEvents(object, r.properties ?? {}, args.connectionId, "created"));
        if (object === "deals") all.push(...recordEvents(object, r.properties ?? {}, args.connectionId, "stage"));
      }
    }
    return { ...last, records: all };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const res = await api(args.credentials).post<{ data?: { id?: { webhook_id?: string }; secret?: string } }>("/webhooks", {
      data: { target_url: args.webhookUrl, subscriptions: ATTIO_SUBSCRIPTIONS.map((event_type) => ({ event_type, filter: null })) },
    });
    return { signingSecret: res.data?.secret, externalId: res.data?.id?.webhook_id };
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
```

Catalog entry:

```ts
  {
    source: "attio",
    name: "Attio",
    description: "Deals and people created, deal stage changes dated by when the stage began.",
    brand: { color: "#000000", short: "At" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote: "The poll imports creations and each deal's current stage; every stage hop arrives by webhook.",
    autoWebhook: true,
    docs: { url: "https://docs.attio.com/rest-api/overview", readOn: "2026-09-07", webhooks: "https://docs.attio.com/rest-api/guides/webhooks" },
    verified: { live: null },
    // docs.attio.com/rest-api/overview (read 2026-09-07): 100 read requests/second; the query
    // endpoint adds a complexity score, so 600/min leaves room under both.
    rateLimits: { "records.query": { requestsPerMinute: 600 } },
    credentialFields: [{ key: "apiKey", label: "Access token (Workspace settings → Developers)", placeholder: "…" }],
    eventTypeLabels: { opportunity_created: "Deal created", lead_created: "Person added", deal_stage_changed: "Deal moved stage" },
    commonFields: ["stage", "values.value.0.currency_value", "values.name.0.value", "values.email_addresses.0.email_address", "created_at"],
  },
```

(`opportunity_created`/`lead_created` labels must match Pipedrive's strings exactly — "Deal created", "Person added" — or the collision test will note disagreement.)

- [ ] **Step 4: Prober** — `POST /v2/objects/deals/records/query` with `limit: 5` unbounded vs `filter: { created_at: { $gte: "2030-01-01T00:00:00Z" } }`; also `GET /v2/objects/deals/attributes` and print which attribute is the status/stage one and whether the workspace uses lists (`GET /v2/lists`).

- [ ] **Commit:** `Add Attio: creations by created_at, stages by active_from`

---

### Task 10: Lemlist

**Files:** create `src/connectors/lemlist.ts`, `tests/lemlist.test.ts`, `scripts/verify-lemlist.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `sharedTokenVerify`).

**Facts (7 Sep 2026):** docs `https://developer.lemlist.com/`, webhooks `https://developer.lemlist.com/api-reference/endpoints/webhooks/add-webhook`. Auth: HTTP Basic with an EMPTY username and the API key as password (`Authorization: Basic base64(":KEY")`) at `https://api.lemlist.com/api`. Activities: `GET /activities?version=v2&limit=100&offset=<n>&minDate=<ISO>&maxDate=<ISO>` → `[{ _id, type, createdAt, leadEmail, campaignId, campaignName, sequenceStep, isFirst, stepId? }]` (`version=v2` is REQUIRED). Types: `emailsSent`, `emailsOpened`, `emailsClicked`, `emailsReplied`, `emailsBounced`, `emailsFailed`, `emailsInterested`, `emailsUnsubscribed`, plus LinkedIn/WhatsApp siblings. Webhook: `POST /hooks { targetUrl, type?, campaignId?, isFirst?, secret? }` → `{ _id }`; deliveries are the activity object with `secret` echoed in the body — no HMAC. Rate limit 20 requests per 2 s per key (600/min); headers `X-RateLimit-*` with a human-readable reset.

**Interfaces:** `lemlistConnector` (`authType: "apiKey"`).

- [ ] **Step 1: Failing test**

```ts
const activity = (over: Record<string, unknown> = {}) => ({ _id: "act_1", type: "emailsReplied", createdAt: "2026-09-02T09:00:00.000Z", leadEmail: "lead@x.io", campaignId: "cmp_1", campaignName: "Q3", sequenceStep: 2, isFirst: false, ...over });

describe("lemlist: signature", () => {
  it("is the shared secret echoed in the body, constant-time; fails closed", () => {
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify({ ...activity(), secret: "s1" }), headers: {}, secret: "s1" })).toBe(true);
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify({ ...activity(), secret: "s2" }), headers: {}, secret: "s1" })).toBe(false);
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify(activity()), headers: {}, secret: "s1" })).toBe(false);
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify({ ...activity(), secret: "s1" }), headers: {}, secret: null })).toBe(false);
  });
});

describe("lemlist: normalize", () => {
  it("maps activity types to the outreach vocabulary at createdAt", () => {
    const cases: Array<[string, string]> = [["emailsSent", "email_sent"], ["emailsOpened", "email_opened"], ["emailsClicked", "email_clicked"], ["emailsReplied", "reply"], ["emailsBounced", "bounced"], ["emailsInterested", "lead_interested"], ["emailsUnsubscribed", "unsubscribed"]];
    for (const [type, ours] of cases) {
      const [ev] = lemlistConnector.normalize!({ ...activity({ type }), secret: "x" }, { connectionId: CONN });
      expect(ev, type).toMatchObject({ eventId: "lemlist:conn_1:act_1", eventType: ours, subject: "lead@x.io" });
      expect(ev.occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
      expect(ev.properties).not.toHaveProperty("secret");
    }
    expect(lemlistConnector.normalize!(activity({ type: "linkedinVisitDone" }), { connectionId: CONN })).toEqual([]);
  });
});

describe("lemlist: poll", () => {
  it("lists v2 activities between minDate and maxDate with basic auth, offset-paged, and settles on the newest createdAt", async () => {
    const calls = stubFetch([[activity(), activity({ _id: "act_0", type: "emailsSent", createdAt: "2026-09-01T09:00:00.000Z" })], []]);
    const res = await lemlistConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });
    expect(res.records.map((r) => r.eventType)).toEqual(["reply", "email_sent"]);
    expect(res.nextCursor).toBe("2026-09-02T09:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/api/activities");
    expect(u.searchParams.get("version")).toBe("v2");
    expect(u.searchParams.get("offset")).toBe("0");
    expect(u.searchParams.get("minDate")).toMatch(/^\d{4}-/);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(":K").toString("base64")}`);
  });
  it("registers a hook with our secret", async () => {
    const calls = stubFetch([{ _id: "hook_1" }]);
    const reg = await lemlistConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "K" } });
    expect(reg.externalId).toBe("hook_1");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ targetUrl: "https://app/api/webhooks/conn_1", secret: reg.signingSecret });
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/lemlist.ts
import { randomBytes } from "node:crypto";
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { basicClient, eventId, isoOrNull, requireCredential, sharedTokenVerify, windowedWalk } from "./kit";

/**
 * lemlist. One dated activity feed serves both the webhook and the poll:
 * /activities?version=v2 filters on createdAt with minDate/maxDate, and a
 * delivery is the same activity object. There is no HMAC — the secret is
 * echoed in the body, so verification is authentication only, and the
 * property is stripped before storage. Docs read 7 Sep 2026:
 * developer.lemlist.com (activities, webhooks, rate limits 20 per 2 s).
 */
const API = "https://api.lemlist.com/api";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
const PAGE = 100;
export const LEMLIST_TYPES: Record<string, string> = {
  emailsSent: "email_sent",
  emailsOpened: "email_opened",
  emailsClicked: "email_clicked",
  emailsReplied: "reply",
  emailsBounced: "bounced",
  emailsFailed: "bounced",
  emailsInterested: "lead_interested",
  emailsUnsubscribed: "unsubscribed",
};

const api = (c?: Record<string, unknown> | null) => basicClient(API, "", requireCredential(c, "apiKey", "lemlist"), "lemlist");

function toCanonical(a: Record<string, unknown>, connectionId: string): CanonicalEvent | null {
  const id = str(a["_id"]) ?? str(a["id"]);
  const ours = LEMLIST_TYPES[str(a["type"]) ?? ""];
  const at = parseDate(str(a["createdAt"]), "createdAt");
  if (!id || !ours || !at) return null;
  const { secret: _secret, ...rest } = a;
  return { eventId: eventId("lemlist", connectionId, id), eventType: ours, subject: str(a["leadEmail"]), occurredAt: at, properties: rest };
}

export const lemlistConnector: Connector = {
  source: "lemlist",
  authType: "apiKey",
  operations: ["activities.list"] as const,
  operationFor: () => "activities.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    let token: string | null = null;
    try {
      token = str(asObject(JSON.parse(rawBody))["secret"]);
    } catch {
      return false;
    }
    return sharedTokenVerify({ rawBody, headers, secret }, { token });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const ev = toCanonical(asObject(rawPayload), ctx.connectionId);
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const maxDate = new Date().toISOString();
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const offset = cont ? Number(cont) || 0 : 0;
        const res = await client.get<unknown>("/activities", { version: "v2", limit: PAGE, offset, minDate: since.toISOString(), maxDate });
        const rows = Array.isArray(res) ? res.map(asObject) : [];
        return { rows, next: rows.length === PAGE ? String(offset + PAGE) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (a) => isoOrNull(a["createdAt"]),
      map: (a) => toCanonical(a, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const secret = randomBytes(24).toString("base64url");
    const res = await api(args.credentials).post<{ _id?: string }>("/hooks", { targetUrl: args.webhookUrl, secret });
    return { signingSecret: secret, externalId: res._id };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/hooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
```

Catalog entry:

```ts
  {
    source: "lemlist",
    name: "lemlist",
    description: "Outreach emails sent, opened, clicked, replied, bounced, marked interested.",
    brand: { color: "#316BFF", short: "Le" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    docs: { url: "https://developer.lemlist.com/", readOn: "2026-09-07", webhooks: "https://developer.lemlist.com/api-reference/endpoints/webhooks/add-webhook" },
    verified: { live: null },
    // developer.lemlist.com rate limits (read 2026-09-07): 20 requests per 2 seconds per key.
    rateLimits: { "activities.list": { requestsPerMinute: 600 } },
    credentialFields: [{ key: "apiKey", label: "API key (Settings → Integrations → API)", placeholder: "…" }],
    eventTypeLabels: { email_sent: "Email sent", reply: "Reply received", lead_interested: "Lead marked interested" },
    commonFields: ["type", "campaignName", "campaignId", "leadEmail", "sequenceStep", "isFirst"],
  },
```

- [ ] **Step 4: Prober** — Basic `:KEY`; `activities?version=v2&limit=5` unbounded vs `minDate=2030-01-01T00:00:00.000Z`; a request WITHOUT `version=v2` to record how the shape differs; print `X-RateLimit-*`.

- [ ] **Commit:** `Add lemlist: one activity feed for the webhook and the walk`

> **Checkpoint after Task 10:** full `pnpm test` (dev server stopped), `pnpm build`, push to `origin/main`.

---

### Task 11: Paddle

**Files:** create `src/connectors/paddle.ts`, `tests/paddle.test.ts`, `scripts/verify-paddle.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developer.paddle.com/api-reference/`, signature `https://developer.paddle.com/webhooks/signature-verification`. Paddle BILLING (not Classic). Auth: `Authorization: Bearer <api key>` at `https://api.paddle.com` (sandbox `https://sandbox-api.paddle.com` — a `sandbox` credential toggle). Signature: `Paddle-Signature: ts=<unix>;h1=<hex>`, HMAC-SHA256 over `"{ts}:{raw_body}"`, keyed on the notification destination's `pdl_ntfset_…` secret. Events: `transaction.completed`, `transaction.paid`, `subscription.created`, `subscription.activated`, `subscription.canceled`, `subscription.updated`, `adjustment.created` (refunds, credits, chargebacks); envelope `{ event_id, event_type, occurred_at, data }`; money is a STRING of minor units with `currency_code`; `details.totals.{subtotal,tax,total,fee,earnings}`. Transactions list: `GET /transactions?billed_at[GTE]=<ISO>&order_by=billed_at[ASC]&per_page=200&after=<id>&status=completed,paid` → `{ data, meta: { pagination: { has_more, next } } }`. Registration: `POST /notification-settings { description, destination, type: "url", subscribed_events[] }` → `{ data: { id, endpoint_secret_key } }`. Rate limit 240/min per IP; events retained 90 days. Dating traps: `next_billed_at`, `current_billing_period.ends_at`.

**Interfaces:** `paddleConnector` (`authType: "apiKey"`), `PADDLE_EVENT_TYPES`.

- [ ] **Step 1: Failing test**

```ts
const SECRET = "pdl_ntfset_secret";
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (ts: string, body: string) => createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");
const tx = (over: Record<string, unknown> = {}) => ({ id: "txn_1", status: "completed", customer_id: "ctm_1", currency_code: "USD", billed_at: "2026-09-01T10:00:00.000Z", details: { totals: { subtotal: "10000", tax: "2000", total: "12000", fee: "600", earnings: "9400" } }, ...over });
const envelope = (event_type: string, data: Record<string, unknown>, event_id = "evt_1", occurred_at = "2026-09-01T10:00:01.000Z") => ({ event_id, event_type, occurred_at, data });

describe("paddle: signature", () => {
  it("ts;h1 over `${ts}:${body}`; fails closed and refuses a stale ts", () => {
    const body = JSON.stringify(envelope("transaction.completed", tx()));
    const ts = String(nowSec());
    expect(paddleConnector.verifySignature({ rawBody: body, headers: { "paddle-signature": `ts=${ts};h1=${sign(ts, body)}` }, secret: SECRET })).toBe(true);
    expect(paddleConnector.verifySignature({ rawBody: body, headers: { "paddle-signature": `ts=${ts};h1=${sign(ts, body)}` }, secret: null })).toBe(false);
    const old = String(nowSec() - 3600);
    expect(paddleConnector.verifySignature({ rawBody: body, headers: { "paddle-signature": `ts=${old};h1=${sign(old, body)}` }, secret: SECRET })).toBe(false);
  });
});

describe("paddle: normalize", () => {
  it("transaction.completed is payment_succeeded at billed_at with total in major units; adjustments are refunds; subscriptions by occurred_at", () => {
    const [p] = paddleConnector.normalize!(envelope("transaction.completed", tx()), { connectionId: CONN });
    expect(p).toMatchObject({ eventId: "paddle:conn_1:evt_1", eventType: "payment_succeeded", subject: "ctm_1", value: 120, currency: "USD" });
    expect(p.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(p.properties).toMatchObject({ earnings_major: 94, fee_major: 6 });
    const [r] = paddleConnector.normalize!(envelope("adjustment.created", { id: "adj_1", action: "refund", customer_id: "ctm_1", currency_code: "USD", totals: { total: "1200" }, created_at: "2026-09-02T00:00:00.000Z" }, "evt_2"), { connectionId: CONN });
    expect(r).toMatchObject({ eventType: "payment_refunded", value: 12 });
    const [s] = paddleConnector.normalize!(envelope("subscription.canceled", { id: "sub_1", customer_id: "ctm_1", currency_code: "USD", canceled_at: "2026-09-03T00:00:00.000Z", next_billed_at: "2026-10-01T00:00:00.000Z", items: [{ quantity: 1, price: { unit_price: { amount: "2000", currency_code: "USD" } } }] }, "evt_3"), { connectionId: CONN });
    expect(s).toMatchObject({ eventType: "subscription_canceled", value: 20 });
    expect(s.occurredAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(paddleConnector.normalize!(envelope("transaction.paid", tx(), "evt_4"), { connectionId: CONN })[0].eventType).toBe("transaction_paid");
    expect(paddleConnector.normalize!(envelope("transaction.created", tx(), "evt_5"), { connectionId: CONN })).toEqual([]);
  });
});

describe("paddle: poll", () => {
  it("walks completed transactions by billed_at with Bearer auth, follows `after`, settles on the newest billed_at", async () => {
    const calls = stubFetch([{ data: [tx()], meta: { pagination: { has_more: true, next: "https://api.paddle.com/transactions?after=txn_1" } } }, { data: [], meta: { pagination: { has_more: false } } }]);
    const res = await paddleConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pdl" } });
    expect(res.records.map((r) => r.eventId)).toEqual(["paddle:conn_1:txn:txn_1"]);
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/transactions");
    expect(u.searchParams.get("order_by")).toBe("billed_at[ASC]");
    expect(u.searchParams.get("billed_at[GTE]")).toMatch(/^\d{4}-/);
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("txn_1");
  });
  it("registers a notification destination and returns the endpoint secret", async () => {
    const calls = stubFetch([{ data: { id: "ntfset_1", endpoint_secret_key: "pdl_ntfset_x" } }]);
    expect(await paddleConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "pdl" } })).toEqual({ signingSecret: "pdl_ntfset_x", externalId: "ntfset_1" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ destination: "https://app/api/webhooks/conn_1", type: "url" });
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/paddle.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { bearerClient, eventId, isoOrNull, requireCredential, timestampedHmacVerify, windowedWalk } from "./kit";

/**
 * Paddle Billing. The event envelope is nearly the CanonicalEvent shape
 * (event_id, event_type, occurred_at, data). Money is a string of minor
 * units; total, subtotal and earnings are three honest answers to "revenue",
 * so `value` is total and the others ride in properties as *_major.
 * Docs read 7 Sep 2026: developer.paddle.com (events, transactions list,
 * signature ts;h1 over "ts:body"). Events are retained 90 days; the poll
 * walks /transactions by billed_at instead, which has no such wall.
 */
const LIVE = "https://api.paddle.com";
const SANDBOX = "https://sandbox-api.paddle.com";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
export const PADDLE_EVENT_TYPES: Record<string, string> = {
  "transaction.completed": "payment_succeeded",
  "transaction.paid": "transaction_paid",
  "adjustment.created": "payment_refunded",
  "subscription.created": "subscription_created",
  "subscription.activated": "subscription_activated",
  "subscription.updated": "subscription_updated",
  "subscription.canceled": "subscription_canceled",
};
const SUBSCRIBED = Object.keys(PADDLE_EVENT_TYPES);

const api = (c?: Record<string, unknown> | null) => bearerClient(c?.["sandbox"] === "yes" ? SANDBOX : LIVE, requireCredential(c, "apiKey", "Paddle"), "Paddle");
const major = (minor: unknown): number | null => {
  const n = typeof minor === "string" ? Number(minor) : typeof minor === "number" ? minor : NaN;
  return Number.isFinite(n) ? n / 100 : null;
};

function subscriptionValue(sub: Record<string, unknown>): number | null {
  const items = Array.isArray(sub["items"]) ? (sub["items"] as unknown[]).map(asObject) : [];
  if (!items.length) return null;
  let total = 0;
  for (const it of items) total += (Number(asObject(asObject(it["price"])["unit_price"])["amount"]) || 0) * (Number(it["quantity"]) || 1);
  return total / 100;
}

function transactionEvent(t: Record<string, unknown>, connectionId: string, id: string, ours: string, at: Date | null): CanonicalEvent | null {
  const totals = asObject(asObject(t["details"])["totals"]);
  const occurredAt = parseDate(str(t["billed_at"]), "billed_at") ?? at;
  if (!occurredAt) return null;
  return {
    eventId: id,
    eventType: ours,
    subject: str(t["customer_id"]),
    occurredAt,
    value: major(totals["total"]),
    currency: str(t["currency_code"])?.toUpperCase() ?? null,
    properties: { ...t, earnings_major: major(totals["earnings"]), fee_major: major(totals["fee"]), subtotal_major: major(totals["subtotal"]), tax_major: major(totals["tax"]) },
  };
}

function envelopeEvent(env: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const eid = str(env["event_id"]);
  const type = str(env["event_type"]);
  const ours = type ? PADDLE_EVENT_TYPES[type] : undefined;
  if (!eid || !type || !ours) return null;
  const data = asObject(env["data"]);
  const occurred = parseDate(str(env["occurred_at"]), "occurred_at") ?? fallback ?? new Date();
  const id = eventId("paddle", connectionId, eid);
  if (type.startsWith("transaction.")) return transactionEvent(data, connectionId, id, ours, occurred);
  if (type === "adjustment.created") {
    return { eventId: id, eventType: ours, subject: str(data["customer_id"]), occurredAt: parseDate(str(data["created_at"]), "created_at") ?? occurred, value: major(asObject(data["totals"])["total"]), currency: str(data["currency_code"])?.toUpperCase() ?? null, properties: data };
  }
  const at = type === "subscription.canceled" ? (parseDate(str(data["canceled_at"]), "canceled_at") ?? occurred) : occurred;
  return { eventId: id, eventType: ours, subject: str(data["customer_id"]), occurredAt: at, value: subscriptionValue(data), currency: str(data["currency_code"])?.toUpperCase() ?? null, properties: data };
}

export const paddleConnector: Connector = {
  source: "paddle",
  authType: "apiKey",
  operations: ["transactions.list"] as const,
  operationFor: () => "transactions.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify({ rawBody, headers, secret }, { header: "paddle-signature", pairSeparator: ";", timestampKey: "ts", signatureKey: "h1", message: (ts, body) => `${ts}:${body}` });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const ev = envelopeEvent(asObject(rawPayload), ctx.connectionId, ctx.fallbackOccurredAt);
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ data?: unknown[]; meta?: { pagination?: { has_more?: boolean; next?: string } } }>("/transactions", {
          "billed_at[GTE]": since.toISOString(),
          order_by: "billed_at[ASC]",
          per_page: 200,
          status: "completed,paid",
          after: cont ?? undefined,
        });
        const rows = (page.data ?? []).map(asObject);
        const last = rows.length ? str(rows[rows.length - 1]["id"]) : null;
        return { rows, next: page.meta?.pagination?.has_more && last ? last : null, rateLimit: client.rateLimit() };
      },
      changedAt: (t) => isoOrNull(t["billed_at"]),
      // A polled transaction is keyed by ITS id, a webhook by the event id: the two
      // paths can each land once. Dedup is by our own re-read (same txn id twice).
      map: (t) => transactionEvent(t, args.connectionId, eventId("paddle", args.connectionId, "txn", str(t["id"]) ?? "?"), "payment_succeeded", null),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const res = await api(args.credentials).post<{ data?: { id?: string; endpoint_secret_key?: string } }>("/notification-settings", {
      description: "Namzilabs",
      destination: args.webhookUrl,
      type: "url",
      subscribed_events: SUBSCRIBED,
    });
    return { signingSecret: res.data?.endpoint_secret_key, externalId: res.data?.id };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/notification-settings/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};
```

The webhook's `payment_succeeded` (keyed by event id) and the poll's (keyed by transaction id) would double count one transaction. Guard in `catalog`: `syncNote` says the poll is the spine; and in the module, `normalize` for `transaction.completed` uses `eventId("paddle", conn, "txn", data.id)` instead of the event id — change `transactionEvent`'s call in `envelopeEvent` to pass `eventId("paddle", connectionId, "txn", str(data["id"]) ?? eid)` for `transaction.completed` only. Add to the normalize test: `expect(p.eventId).toBe("paddle:conn_1:txn:txn_1")`.

Catalog entry:

```ts
  {
    source: "paddle",
    name: "Paddle",
    description: "Transactions completed (total, with earnings and fee alongside), refunds and adjustments, subscriptions started and cancelled.",
    brand: { color: "#FDDD35", short: "Pa" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote: "Completed transactions are reconciled by polling; refunds and subscription changes arrive by webhook.",
    autoWebhook: true,
    docs: { url: "https://developer.paddle.com/api-reference/transactions/list-transactions", readOn: "2026-09-07", webhooks: "https://developer.paddle.com/webhooks/signature-verification" },
    verified: { live: null },
    // developer.paddle.com/api-reference/about/rate-limiting (read 2026-09-07): 240 requests/minute per IP.
    rateLimits: { "transactions.list": { requestsPerMinute: 240 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Developer tools → Authentication)", placeholder: "pdl_live_…" },
      { key: "sandbox", label: "Sandbox account? (type yes)", placeholder: "no" },
    ],
    eventTypeLabels: { payment_succeeded: "Payment succeeded", transaction_paid: "Transaction paid", payment_refunded: "Refund", subscription_created: "Subscription started", subscription_activated: "Subscription activated", subscription_updated: "Subscription changed", subscription_canceled: "Subscription cancelled" },
    commonFields: ["status", "customer_id", "currency_code", "details.totals.total", "earnings_major", "fee_major", "billed_at"],
  },
```

- [ ] **Step 4: Prober** — `transactions?per_page=5` unbounded vs `billed_at[GTE]=2030-01-01T00:00:00Z`; `events?per_page=5` and note the oldest `occurred_at` returned (the 90-day wall, measured).

- [ ] **Commit:** `Add Paddle: total as the value, earnings and fee alongside, transactions walked by billed_at`

---

### Task 12: JustCall (poll only in this batch)

**Files:** create `src/connectors/justcall.ts`, `tests/justcall.test.ts`, `scripts/verify-justcall.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developer.justcall.io/` (Mintlify; `https://developer.justcall.io/llms.txt` indexes every page), calls `https://developer.justcall.io/api-reference/calls/call_list_v21` (confirm path), events `https://developer.justcall.io/docs/call-events`. Auth v2.1: `Authorization: <api_key>:<api_secret>`. List: `POST https://api.justcall.io/v2.1/calls` (or GET — confirm) with `{ from_datetime, to_datetime, page, per_page (≤100), sort: "call_date", order: "asc" }` → `{ data: [{ id, contact_number, contact_name, agent_email, call_info: { direction, type, disposition, status, missed_call_reason, notes }, call_date, call_time, call_user_date, call_user_time, call_duration: { total_duration, conversation_time, ring_time, handle_time, hold_time } }], total, page }`. Timestamps are split (`call_date` + `call_time`) in the ACCOUNT time zone; the connector composes them as UTC and records the assumption. Webhook signature signs `secret|urlencoded(url)|event_type|timestamp` — the URL is not available to `verifySignature`, so webhooks are deferred: `instant: false` here, with `webhookSetup` absent and a `syncNote` saying polling is the path.

**Interfaces:** `justcallConnector` (`authType: "apiKey"`, credentials `apiKey`, `apiSecret`).

- [ ] **Step 1: Failing test**

```ts
const call = (over: Record<string, unknown> = {}) => ({ id: 9001, contact_number: "+15550001", contact_name: "Lead", agent_email: "rep@x.io", call_info: { direction: "Outgoing", type: "Answered", disposition: "Sales: Lead", missed_call_reason: null }, call_date: "2026-09-01", call_time: "10:00:00", call_duration: { total_duration: 200, conversation_time: 150, ring_time: 20, handle_time: 180 }, ...over });

describe("justcall: signature", () => {
  it("has no webhook path in this batch and fails closed", () => {
    expect(justcallConnector.verifySignature({ rawBody: "{}", headers: {}, secret: "s" })).toBe(false);
    expect(justcallConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(false);
  });
});

describe("justcall: poll", () => {
  it("lists calls between from/to with the key:secret header, fans out logged/connected/completed, and dates by call_date+call_time as UTC", async () => {
    const calls = stubFetch([{ data: [call(), call({ id: 9002, call_info: { direction: "Incoming", type: "Missed", missed_call_reason: "No answer" }, call_duration: { total_duration: 15, conversation_time: 0, ring_time: 15 } })], total: 2, page: 1 }]);
    const res = await justcallConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k", apiSecret: "s" } });
    expect(res.records.map((r) => `${r.eventType}:${r.eventId}`).sort()).toEqual(["call_completed:justcall:conn_1:9001:completed", "call_connected:justcall:conn_1:9001:connected", "call_logged:justcall:conn_1:9001", "call_logged:justcall:conn_1:9002", "call_missed:justcall:conn_1:9002:completed"]);
    const completed = res.records.find((r) => r.eventType === "call_completed")!;
    expect(completed.value).toBe(150);
    expect(completed.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(completed.properties).toMatchObject({ disposition: "Sales: Lead" });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("k:s");
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/justcall.ts
import type { Connector, CanonicalEvent, PollArgs, PollResult } from "./types";
import { asObject, str } from "./field-utils";
import { eventId, headerKeyClient, requireCredential, windowedWalk } from "./kit";

/**
 * JustCall (v2.1). Four durations per call — conversation_time is talk
 * time, total_duration includes ring and hold — so `value` is
 * conversation_time. Timestamps arrive split (call_date + call_time) in the
 * account's time zone; composed here as UTC and said so in the entry.
 * Docs read 7 Sep 2026: developer.justcall.io (llms.txt → call list v2.1).
 * The webhook signature signs the subscription URL, which verifySignature
 * cannot see, so this batch is poll-only.
 */
const API = "https://api.justcall.io/v2.1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
const PAGE = 100;

const api = (c?: Record<string, unknown> | null) => headerKeyClient(API, "authorization", `${requireCredential(c, "apiKey", "JustCall")}:${requireCredential(c, "apiSecret", "JustCall")}`, "JustCall");
const idOf = (v: unknown) => (typeof v === "number" ? String(v) : str(v));

function when(c: Record<string, unknown>): Date | null {
  const d = str(c["call_date"]);
  const t = str(c["call_time"]) ?? "00:00:00";
  if (!d) return null;
  const ms = Date.parse(`${d}T${t}Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function events(c: Record<string, unknown>, connectionId: string): CanonicalEvent[] {
  const id = idOf(c["id"]);
  const at = when(c);
  if (!id || !at) return [];
  const info = asObject(c["call_info"]);
  const dur = asObject(c["call_duration"]);
  const talk = Number(dur["conversation_time"]) || 0;
  const answered = talk > 0 || /answered/i.test(str(info["type"]) ?? "");
  const props = { ...c, disposition: str(info["disposition"]), direction: str(info["direction"]), talk_seconds: talk, ring_seconds: Number(dur["ring_time"]) || null, timezone_note: "call_date/call_time composed as UTC" };
  const base = eventId("justcall", connectionId, id);
  const subject = str(c["agent_email"]) ?? str(c["contact_number"]);
  const out: CanonicalEvent[] = [{ eventId: base, eventType: "call_logged", subject, occurredAt: at, properties: props }];
  if (answered) out.push({ eventId: `${base}:connected`, eventType: "call_connected", subject, occurredAt: at, properties: props });
  out.push({ eventId: `${base}:completed`, eventType: answered ? "call_completed" : "call_missed", subject, occurredAt: at, value: answered ? talk : 0, properties: props });
  return out;
}

export const justcallConnector: Connector = {
  source: "justcall",
  authType: "apiKey",
  operations: ["calls.list"] as const,
  operationFor: () => "calls.list",
  verifySignature(): boolean {
    return false; // no webhook path in this batch: the signature signs the subscription URL
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = cont ? Number(cont) || 1 : 1;
        const body = await client.post<{ data?: unknown[]; total?: number }>("/calls", {
          from_datetime: since.toISOString().slice(0, 19).replace("T", " "),
          to_datetime: new Date().toISOString().slice(0, 19).replace("T", " "),
          page,
          per_page: PAGE,
          sort: "call_date",
          order: "asc",
        });
        const rows = (body.data ?? []).map(asObject);
        return { rows, next: rows.length === PAGE ? String(page + 1) : null, rateLimit: client.rateLimit() };
      },
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
```

Catalog entry:

```ts
  {
    source: "justcall",
    name: "JustCall",
    description: "Calls logged, connected, completed (talk time in seconds) and missed, with disposition.",
    brand: { color: "#3B5BDB", short: "Jc" },
    connect: "apiKey",
    instant: false,
    poll: true,
    sync: "incremental",
    syncNote: "Synced by polling. Call times are composed from the account's call_date and call_time as UTC.",
    autoWebhook: false,
    docs: { url: "https://developer.justcall.io/", readOn: "2026-09-07", webhooks: "https://developer.justcall.io/docs/call-events" },
    verified: { live: null },
    // developer.justcall.io/docs/rate-limits (read 2026-09-07): per plan; 60/min is the lowest tier.
    rateLimits: { "calls.list": { requestsPerMinute: 60 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → Developers)", placeholder: "…" },
      { key: "apiSecret", label: "API secret", placeholder: "…" },
    ],
    eventTypeLabels: { call_logged: "Call logged", call_connected: "Call connected", call_completed: "Call completed", call_missed: "Call missed" },
    commonFields: ["direction", "disposition", "agent_email", "contact_number", "talk_seconds", "ring_seconds"],
  },
```

- [ ] **Step 4: Prober** — `JUSTCALL_API_KEY` as `key:secret`; POST `/calls` with `per_page: 5`; the same with `from_datetime: "2030-01-01 00:00:00"`; print the response's top-level keys and the first call's `call_date`/`call_time`/`call_user_date` so the time-zone assumption is measured.

- [ ] **Commit:** `Add JustCall: talk time as the value, calls walked by call_date (poll only until the URL-bound signature is confirmed)`

---

### Task 13: OnceHub

**Files:** create `src/connectors/oncehub.ts`, `tests/oncehub.test.ts`, `scripts/verify-oncehub.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `headerKeyClient`).

**Facts (7 Sep 2026):** docs `https://help.oncehub.com/developers/overview/introduction` (developers.oncehub.com 301s here), signatures `https://help.oncehub.com/developers/webhooks/webhook-signatures/`. Auth: `API-Key: <key>` header at `https://api.oncehub.com`. Bookings: `GET /bookings?limit=100&after=<id>&creation_time.gt=<ISO>` — confirm the filter/cursor names at build; the module uses `limit`/`after`/`creation_time.gt` and filters client-side as well. Booking: `id`, `status` (`scheduled|rescheduled|canceled|completed|no_show`), `creation_time`, `starting_time`, `tracking_id`, `customer: { email }`, `owner: { email }`. Webhook (v2 subscriptions only): `Oncehub-Signature: t=<unix>,s=<hex>`, HMAC-SHA256 over `"{t}.{raw_body}"`; envelope `{ id, object: "event", type: "booking.scheduled"|"booking.rescheduled"|"booking.canceled"|"booking.completed"|"booking.no_show", creation_time, data: Booking }`. Registration: `POST /subscriptions { url, events[] }` → `{ id, secret }` (v2). Rate limits: documented section, figures not stated — declare 60/min.

**Interfaces:** `oncehubConnector` (`authType: "apiKey"`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "oh_secret";
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (t: string, body: string) => createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
const booking = (over: Record<string, unknown> = {}) => ({ id: "BKNG-1", status: "scheduled", creation_time: "2026-09-01T10:00:00Z", starting_time: "2026-09-10T14:00:00Z", tracking_id: "trk1", customer: { email: "lead@x.io" }, owner: { email: "rep@x.io" }, ...over });
const env = (type: string, data: Record<string, unknown>, id = "evt_1") => ({ id, object: "event", type, creation_time: "2026-09-01T10:00:01Z", data });

describe("oncehub: signature", () => {
  it("t=,s= over `${t}.${body}`; fails closed", () => {
    const body = JSON.stringify(env("booking.scheduled", booking()));
    const t = String(nowSec());
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: { "oncehub-signature": `t=${t},s=${sign(t, body)}` }, secret: SECRET })).toBe(true);
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: { "oncehub-signature": `t=${t},s=${sign(t, body)}` }, secret: null })).toBe(false);
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("oncehub: normalize", () => {
  it("scheduled → booked at creation_time; canceled/rescheduled at the event's creation_time; completed → meeting_held at starting_time; no_show", () => {
    const [b] = oncehubConnector.normalize!(env("booking.scheduled", booking()), { connectionId: CONN });
    expect(b).toMatchObject({ eventId: "oncehub:conn_1:BKNG-1", eventType: "booked", subject: "lead@x.io" });
    expect(b.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    const [c] = oncehubConnector.normalize!(env("booking.canceled", booking({ status: "canceled" }), "evt_2"), { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "oncehub:conn_1:BKNG-1:canceled", eventType: "canceled" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-01T10:00:01.000Z");
    const [h] = oncehubConnector.normalize!(env("booking.completed", booking({ status: "completed" }), "evt_3"), { connectionId: CONN });
    expect(h).toMatchObject({ eventId: "oncehub:conn_1:BKNG-1:held", eventType: "meeting_held" });
    expect(h.occurredAt.toISOString()).toBe("2026-09-10T14:00:00.000Z");
    expect(oncehubConnector.normalize!(env("booking.no_show", booking({ status: "no_show" }), "evt_4"), { connectionId: CONN })[0].eventType).toBe("no_show");
    expect(oncehubConnector.normalize!(env("booking.rescheduled", booking(), "evt_5"), { connectionId: CONN })[0].eventType).toBe("rescheduled");
  });
});

describe("oncehub: poll", () => {
  it("lists bookings with the API-Key header from creation_time, emits booked plus the current outcome, settles on the newest creation_time", async () => {
    const calls = stubFetch([{ data: [booking(), booking({ id: "BKNG-2", status: "canceled", creation_time: "2026-09-02T10:00:00Z" })], has_more: false }]);
    const res = await oncehubConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["booked", "booked", "canceled"]);
    expect(res.nextCursor).toBe("2026-09-02T10:00:00.000Z");
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("K");
    expect(new URL(calls[0].url).pathname).toBe("/bookings");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/oncehub.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { eventId, headerKeyClient, isoOrNull, requireCredential, timestampedHmacVerify, windowedWalk } from "./kit";

/**
 * OnceHub (ScheduleOnce). A booking carries creation_time (booked) and
 * starting_time (the slot) side by side. Docs read 7 Sep 2026:
 * help.oncehub.com/developers (the old developers.oncehub.com host 301s).
 * Only v2 subscriptions are signed (t=,s= over "t.body"); an unsigned v1
 * delivery fails closed by design.
 */
const API = "https://api.oncehub.com";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

const api = (c?: Record<string, unknown> | null) => headerKeyClient(API, "api-key", requireCredential(c, "apiKey", "OnceHub"), "OnceHub");
const email = (b: Record<string, unknown>) => str(asObject(b["customer"])["email"]);

function bookingEvent(b: Record<string, unknown>, connectionId: string, kind: "booked" | "canceled" | "rescheduled" | "meeting_held" | "no_show", at: Date | null, fallback?: Date): CanonicalEvent | null {
  const id = str(b["id"]);
  if (!id) return null;
  const suffix = kind === "booked" ? "" : kind === "meeting_held" ? ":held" : `:${kind}`;
  return { eventId: eventId("oncehub", connectionId, id) + suffix, eventType: kind, subject: email(b), occurredAt: at ?? fallback ?? new Date(), properties: b };
}

export const oncehubConnector: Connector = {
  source: "oncehub",
  authType: "apiKey",
  operations: ["bookings.list"] as const,
  operationFor: () => "bookings.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify({ rawBody, headers, secret }, { header: "oncehub-signature", timestampKey: "t", signatureKey: "s", message: (t, body) => `${t}.${body}` });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const env = asObject(rawPayload);
    const b = asObject(env["data"]);
    const at = parseDate(str(env["creation_time"]), "creation_time");
    let ev: CanonicalEvent | null = null;
    switch (str(env["type"])) {
      case "booking.scheduled":
        ev = bookingEvent(b, ctx.connectionId, "booked", parseDate(str(b["creation_time"]), "creation_time") ?? at, ctx.fallbackOccurredAt);
        break;
      case "booking.canceled":
        ev = bookingEvent(b, ctx.connectionId, "canceled", at, ctx.fallbackOccurredAt);
        break;
      case "booking.rescheduled":
        ev = bookingEvent(b, ctx.connectionId, "rescheduled", at, ctx.fallbackOccurredAt);
        break;
      case "booking.completed":
        ev = bookingEvent(b, ctx.connectionId, "meeting_held", parseDate(str(b["starting_time"]), "starting_time") ?? at, ctx.fallbackOccurredAt);
        break;
      case "booking.no_show":
        ev = bookingEvent(b, ctx.connectionId, "no_show", parseDate(str(b["starting_time"]), "starting_time") ?? at, ctx.fallbackOccurredAt);
        break;
      default:
        return [];
    }
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ data?: unknown[]; has_more?: boolean }>("/bookings", { limit: 100, after: cont ?? undefined, "creation_time.gt": since.toISOString() });
        const rows = (page.data ?? []).map(asObject).filter((b) => (Date.parse(str(b["creation_time"]) ?? "") || 0) >= since.getTime());
        const last = rows.length ? str(rows[rows.length - 1]["id"]) : null;
        return { rows, next: page.has_more && last ? last : null, rateLimit: client.rateLimit() };
      },
      changedAt: (b) => isoOrNull(b["creation_time"]),
      map: (b) => bookingEvent(b, args.connectionId, "booked", parseDate(str(b["creation_time"]), "creation_time")),
    });
    const extra: CanonicalEvent[] = [];
    for (const r of res.records) {
      const b = r.properties ?? {};
      const status = str(b["status"]);
      if (status === "canceled") extra.push(bookingEvent(b, args.connectionId, "canceled", parseDate(str(b["last_updated_time"]), "last_updated_time") ?? r.occurredAt)!);
      if (status === "completed") extra.push(bookingEvent(b, args.connectionId, "meeting_held", parseDate(str(b["starting_time"]), "starting_time"))!);
      if (status === "no_show") extra.push(bookingEvent(b, args.connectionId, "no_show", parseDate(str(b["starting_time"]), "starting_time"))!);
    }
    return { ...res, records: [...res.records, ...extra] };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
```

Catalog entry:

```ts
  {
    source: "oncehub",
    name: "OnceHub",
    description: "Bookings made, cancelled, rescheduled, held and no-shows.",
    brand: { color: "#006DF0", short: "Oh" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: false,
    docs: { url: "https://help.oncehub.com/developers/overview/introduction", readOn: "2026-09-07", webhooks: "https://help.oncehub.com/developers/webhooks/webhook-signatures/" },
    verified: { live: null },
    // help.oncehub.com/developers "Rate limits" (read 2026-09-07) states no figure; 60/min until measured.
    rateLimits: { "bookings.list": { requestsPerMinute: 60 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → API & Webhooks)", placeholder: "…" },
      { key: "webhookSecret", label: "Webhook signing secret (View secret on the v2 subscription)", placeholder: "…" },
    ],
    eventTypeLabels: { booked: "Meeting booked", canceled: "Meeting cancelled", rescheduled: "Meeting rescheduled", no_show: "No-show", meeting_held: "Meeting held" },
    commonFields: ["status", "starting_time", "creation_time", "customer.email", "owner.email", "tracking_id"],
    webhookSetup:
      "In OnceHub → Settings → API & Webhooks, create a v2 subscription for booking events pointing at the URL below, open " +
      "View secret and paste it as the webhook signing secret on this connection. Unsigned v1 subscriptions are rejected.",
  },
```

- [ ] **Step 4: Prober** — header `API-Key`; `bookings?limit=5` unbounded vs `creation_time.gt=2030-01-01T00:00:00Z`; print the response's top-level keys so `data`/`has_more`/`after` are confirmed or corrected.

- [ ] **Commit:** `Add OnceHub: booked by creation_time, held by starting_time, signed v2 deliveries only`

---

### Task 14: SavvyCal

**Files:** create `src/connectors/savvycal.ts`, `tests/savvycal.test.ts`, `scripts/verify-savvycal.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developers.savvycal.com/` (Meetings, not Appointments), webhooks `https://developers.savvycal.com/webhooks`. Auth: `Authorization: Bearer pt_secret_…` at `https://api.savvycal.com/v1`. Events: `GET /v1/events?limit=100&after=<cursor>&created_after=<ISO>` — confirm the filter name; the module filters client-side on `created_at` too. Event: `id`, `state` (`confirmed|canceled|requested`), `created_at`, `start_at`, `end_at`, `canceled_at`, `cancel_reason`, `original_start_at`, `attendees: [{ email }]`, `payment: { amount (cents), currency, state }`. Webhook: `x-savvycal-signature: sha256=<hex HMAC over raw body>`; envelope `{ type: "event.created"|"event.rescheduled"|"event.canceled"|"event.approved"|…, payload: Event }`. Registration `POST /v1/webhooks { url, events[] }` → `{ id, secret }`. Rate limits undocumented — declare 60/min.

**Interfaces:** `savvycalConnector` (`authType: "apiKey"`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "sc_secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const ev = (over: Record<string, unknown> = {}) => ({ id: "ev_1", state: "confirmed", created_at: "2026-09-01T10:00:00Z", start_at: "2026-09-10T14:00:00Z", end_at: "2026-09-10T14:30:00Z", canceled_at: null, attendees: [{ email: "lead@x.io" }], payment: { amount: 5000, currency: "usd", state: "paid" }, ...over });

describe("savvycal: signature", () => {
  it("sha256= hex over the raw body; fails closed", () => {
    const body = JSON.stringify({ type: "event.created", payload: ev() });
    expect(savvycalConnector.verifySignature({ rawBody: body, headers: { "x-savvycal-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(savvycalConnector.verifySignature({ rawBody: body, headers: { "x-savvycal-signature": sign(body) }, secret: null })).toBe(false);
    expect(savvycalConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("savvycal: normalize", () => {
  it("created → booked at created_at with paid revenue as value; canceled at canceled_at; rescheduled; approved; requested is not booked", () => {
    const [b] = savvycalConnector.normalize!({ type: "event.created", payload: ev() }, { connectionId: CONN });
    expect(b).toMatchObject({ eventId: "savvycal:conn_1:ev_1", eventType: "booked", subject: "lead@x.io", value: 50, currency: "USD" });
    expect(b.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    const [u] = savvycalConnector.normalize!({ type: "event.created", payload: ev({ payment: { amount: 5000, currency: "usd", state: "awaiting_checkout" } }) }, { connectionId: CONN });
    expect(u.value).toBeNull();
    const [c] = savvycalConnector.normalize!({ type: "event.canceled", payload: ev({ state: "canceled", canceled_at: "2026-09-02T09:00:00Z" }) }, { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "savvycal:conn_1:ev_1:canceled", eventType: "canceled" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    expect(savvycalConnector.normalize!({ type: "event.rescheduled", payload: ev({ original_start_at: "2026-09-09T14:00:00Z" }) }, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-03T00:00:00Z") })[0]).toMatchObject({ eventType: "rescheduled" });
    expect(savvycalConnector.normalize!({ type: "event.approved", payload: ev() }, { connectionId: CONN })[0].eventType).toBe("booked");
    expect(savvycalConnector.normalize!({ type: "event.requested", payload: ev({ state: "requested" }) }, { connectionId: CONN })).toEqual([]);
  });
});

describe("savvycal: poll", () => {
  it("lists events since the mark with Bearer auth and settles on the newest created_at", async () => {
    const calls = stubFetch([{ entries: [ev(), ev({ id: "ev_2", state: "canceled", created_at: "2026-09-02T10:00:00Z", canceled_at: "2026-09-03T10:00:00Z" })], metadata: { after: null } }]);
    const res = await savvycalConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pt_secret_x" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["booked", "booked", "canceled"]);
    expect(res.nextCursor).toBe("2026-09-02T10:00:00.000Z");
    expect(new URL(calls[0].url).pathname).toBe("/v1/events");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer pt_secret_x");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/savvycal.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * SavvyCal (Meetings). created_at is "when the event was created", so
 * booked-last-week is exact; start_at is the slot and rides in properties;
 * payment.amount is cents and counts only when state is paid.
 * Docs read 7 Sep 2026: developers.savvycal.com (events, webhooks).
 */
const API = "https://api.savvycal.com/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "SavvyCal"), "SavvyCal");
const email = (e: Record<string, unknown>) => (Array.isArray(e["attendees"]) ? str(asObject((e["attendees"] as unknown[])[0])["email"]) : null);

function paid(e: Record<string, unknown>): { value: number | null; currency: string | null } {
  const p = asObject(e["payment"]);
  if (p["state"] !== "paid" || typeof p["amount"] !== "number") return { value: null, currency: null };
  return { value: p["amount"] / 100, currency: str(p["currency"])?.toUpperCase() ?? null };
}

function meetingEvent(e: Record<string, unknown>, connectionId: string, kind: "booked" | "canceled" | "rescheduled", at: Date | null, fallback?: Date): CanonicalEvent | null {
  const id = str(e["id"]);
  if (!id) return null;
  const money = kind === "booked" ? paid(e) : { value: null, currency: null };
  return { eventId: eventId("savvycal", connectionId, id) + (kind === "booked" ? "" : `:${kind}`), eventType: kind, subject: email(e), occurredAt: at ?? fallback ?? new Date(), ...money, properties: e };
}

export const savvycalConnector: Connector = {
  source: "savvycal",
  authType: "apiKey",
  operations: ["events.list"] as const,
  operationFor: () => "events.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-savvycal-signature", encoding: "hex", prefix: "sha256=" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const env = asObject(rawPayload);
    const e = asObject(env["payload"]);
    let ev: CanonicalEvent | null = null;
    switch (str(env["type"])) {
      case "event.created":
      case "event.approved":
        if (e["state"] === "requested") return [];
        ev = meetingEvent(e, ctx.connectionId, "booked", parseDate(str(e["created_at"]), "created_at"), ctx.fallbackOccurredAt);
        break;
      case "event.canceled":
        ev = meetingEvent(e, ctx.connectionId, "canceled", parseDate(str(e["canceled_at"]), "canceled_at"), ctx.fallbackOccurredAt);
        break;
      case "event.rescheduled":
        ev = meetingEvent(e, ctx.connectionId, "rescheduled", parseDate(str(e["updated_at"]), "updated_at"), ctx.fallbackOccurredAt);
        break;
      default:
        return [];
    }
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ entries?: unknown[]; metadata?: { after?: string | null } }>("/events", { limit: 100, after: cont ?? undefined, created_after: since.toISOString() });
        const rows = (page.entries ?? []).map(asObject).filter((e) => (Date.parse(str(e["created_at"]) ?? "") || 0) >= since.getTime());
        return { rows, next: page.metadata?.after ?? null, rateLimit: client.rateLimit() };
      },
      changedAt: (e) => isoOrNull(e["created_at"]),
      map: (e) => (e["state"] === "requested" ? null : meetingEvent(e, args.connectionId, "booked", parseDate(str(e["created_at"]), "created_at"))),
    });
    const extra: CanonicalEvent[] = [];
    for (const r of res.records) {
      const e = r.properties ?? {};
      if (e["state"] === "canceled") {
        const c = meetingEvent(e, args.connectionId, "canceled", parseDate(str(e["canceled_at"]), "canceled_at"));
        if (c) extra.push(c);
      }
    }
    return { ...res, records: [...res.records, ...extra] };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
```

Catalog entry:

```ts
  {
    source: "savvycal",
    name: "SavvyCal",
    description: "Meetings booked (with paid revenue), cancelled and rescheduled.",
    brand: { color: "#7C3AED", short: "Sv" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: false,
    docs: { url: "https://developers.savvycal.com/", readOn: "2026-09-07", webhooks: "https://developers.savvycal.com/webhooks" },
    verified: { live: null },
    // developers.savvycal.com (read 2026-09-07) publishes no figure; 60/min until measured.
    rateLimits: { "events.list": { requestsPerMinute: 60 } },
    credentialFields: [
      { key: "apiKey", label: "Personal access token (Settings → Developers)", placeholder: "pt_secret_…" },
      { key: "webhookSecret", label: "Webhook secret (from the webhook you add in SavvyCal)", placeholder: "…" },
    ],
    eventTypeLabels: { booked: "Meeting booked", canceled: "Meeting cancelled", rescheduled: "Meeting rescheduled" },
    commonFields: ["state", "start_at", "end_at", "created_at", "attendees.0.email", "payment.state", "cancel_reason"],
    webhookSetup: "In SavvyCal → Settings → Developers → Webhooks, add the URL below for event.* and paste its secret as the webhook secret on this connection.",
  },
```

- [ ] **Step 4: Prober** — `events?limit=5` unbounded vs `created_after=2030-01-01T00:00:00Z`; print the envelope keys (`entries`/`metadata`) and the first event's field names.

- [ ] **Commit:** `Add SavvyCal: booked by created_at, revenue only when paid`

> **Checkpoint after Task 14:** full `pnpm test` (dev server stopped), `pnpm build`, push to `origin/main`.

---

### Task 15: Thinkific

**Files:** create `src/connectors/thinkific.ts`, `tests/thinkific.test.ts`, `scripts/verify-thinkific.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://developers.thinkific.com/api/api-documentation`, webhooks `https://support.thinkific.dev/hc/en-us/articles/4422658311703-Webhooks-Documentation` (Zendesk; 403s to crawlers — read via the help-center JSON API `…/api/v2/help_center/articles/4422658311703.json`). Auth: headers `X-Auth-API-Key` + `X-Auth-Subdomain` at `https://api.thinkific.com/api/public/v1`; API access is Grow/Pro+Growth plans and up. Orders: `GET /orders?page=<n>&limit=250` → `{ items: [{ id, created_at, user_email, user_id, product_name, amount_cents, amount_dollars, status, coupon_code, items[] }], meta: { pagination: { current_page, total_pages } } }` (newest first; no date filter — client-side, stop when a page is all older). Webhook: `X-Thinkific-Hmac-Sha256` = hex HMAC-SHA256 over the raw body keyed on the site API key; `X-Thinkific-Topic`; envelope `{ id, resource, action, created_at, payload }`; topics `order.created`, `order_transaction.succeeded|failed|refunded` (Thinkific Payments only), `subscription.cancelled`, `enrollment.created|completed`, `user.signup`, `lead.created`. Registration: `POST https://api.thinkific.com/api/v2/webhooks { topic, target_url }` with `Authorization: Bearer <api key>`. Rate limit 120/min per site, 10 concurrent.

**Interfaces:** `thinkificConnector` (`authType: "apiKey"`, credentials `apiKey`, `subdomain`; the signing secret is the API key — the entry's `webhookSecret` label says so).

- [ ] **Step 1: Failing test**

```ts
const KEY = "thinkific_api_key";
const sign = (body: string) => createHmac("sha256", KEY).update(body).digest("hex");
const env = (resource: string, action: string, payload: Record<string, unknown>, id = "wh_1") => ({ id, resource, action, created_at: "2026-09-01T10:00:00Z", payload });
const order = (over: Record<string, unknown> = {}) => ({ id: 501, created_at: "2026-09-01T10:00:00Z", user: { email: "s@x.io" }, user_email: "s@x.io", product_name: "Course", amount_cents: 19900, amount_dollars: 199, status: "Complete", ...over });

describe("thinkific: signature", () => {
  it("hex HMAC over the raw body keyed on the API key; fails closed", () => {
    const body = JSON.stringify(env("order", "created", order()));
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: { "x-thinkific-hmac-sha256": sign(body) }, secret: KEY })).toBe(true);
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: { "x-thinkific-hmac-sha256": sign(body) }, secret: null })).toBe(false);
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: {}, secret: KEY })).toBe(false);
  });
});

describe("thinkific: normalize", () => {
  it("maps topics to purchases, refunds, churn, enrolments and signups, dated by the payload's created_at, money in dollars", () => {
    const [o] = thinkificConnector.normalize!(env("order", "created", order()), { connectionId: CONN });
    expect(o).toMatchObject({ eventId: "thinkific:conn_1:order:501", eventType: "order_created", subject: "s@x.io", value: 199, currency: null });
    expect(o.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    const [r] = thinkificConnector.normalize!(env("order_transaction", "refunded", { id: 77, order_id: 501, amount_cents: 19900, created_at: "2026-09-05T10:00:00Z", user: { email: "s@x.io" } }), { connectionId: CONN });
    expect(r).toMatchObject({ eventId: "thinkific:conn_1:transaction:77:refunded", eventType: "payment_refunded", value: 199 });
    const [e] = thinkificConnector.normalize!(env("enrollment", "completed", { id: 9, user: { email: "s@x.io" }, course_name: "C", completed_at: "2026-09-06T10:00:00Z", created_at: "2026-09-01T10:00:00Z" }), { connectionId: CONN });
    expect(e).toMatchObject({ eventId: "thinkific:conn_1:enrollment:9:completed", eventType: "enrollment_completed" });
    expect(e.occurredAt.toISOString()).toBe("2026-09-06T10:00:00.000Z");
    expect(thinkificConnector.normalize!(env("user", "signup", { id: 3, email: "n@x.io", created_at: "2026-09-01T10:00:00Z" }), { connectionId: CONN })[0]).toMatchObject({ eventType: "user_signup", subject: "n@x.io" });
    expect(thinkificConnector.normalize!(env("subscription", "cancelled", { id: 4, user: { email: "s@x.io" }, created_at: "2026-09-01T10:00:00Z" }), { connectionId: CONN })[0].eventType).toBe("subscription_canceled");
    expect(thinkificConnector.normalize!(env("lesson", "completed", { id: 1 }), { connectionId: CONN })).toEqual([]);
  });
});

describe("thinkific: poll", () => {
  it("pages orders newest-first with both auth headers, keeps those inside the window, settles on the newest created_at", async () => {
    const calls = stubFetch([{ items: [order(), order({ id: 500, created_at: "2020-01-01T00:00:00Z" })], meta: { pagination: { current_page: 1, total_pages: 3 } } }]);
    const res = await thinkificConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY, subdomain: "acme" } });
    expect(res.records.map((r) => r.eventId)).toEqual(["thinkific:conn_1:order:501"]);
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["x-auth-api-key"]).toBe(KEY);
    expect(h["x-auth-subdomain"]).toBe("acme");
    expect(new URL(calls[0].url).pathname).toBe("/api/public/v1/orders");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/thinkific.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, providerClient, requireCredential, windowedWalk } from "./kit";

/**
 * Thinkific. Every commerce and learning action is a past-dated webhook
 * with created_at on both envelope and payload. Orders list newest-first
 * with no date filter, so the walk keeps rows inside the window and stops
 * at the first page that is all older. Docs read 7 Sep 2026:
 * developers.thinkific.com (Admin API), support.thinkific.dev webhooks
 * article (X-Thinkific-Hmac-Sha256 keyed on the site API key).
 * order_transaction.* and subscription.* fire only on Thinkific Payments —
 * a merchant on external Stripe emits fewer events, said on the entry.
 */
const API = "https://api.thinkific.com/api/public/v1";
const WEBHOOKS_API = "https://api.thinkific.com/api/v2";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 250;
export const THINKIFIC_TOPICS = ["order.created", "order_transaction.succeeded", "order_transaction.refunded", "subscription.cancelled", "enrollment.created", "enrollment.completed", "user.signup", "lead.created"] as const;

const api = (c?: Record<string, unknown> | null) => providerClient({ baseUrl: API, provider: "Thinkific", headers: { "x-auth-api-key": requireCredential(c, "apiKey", "Thinkific"), "x-auth-subdomain": requireCredential(c, "subdomain", "Thinkific") } });
const idOf = (v: unknown) => (typeof v === "number" ? String(v) : str(v));
const email = (p: Record<string, unknown>) => str(asObject(p["user"])["email"]) ?? str(p["user_email"]) ?? str(p["email"]);
const dollars = (p: Record<string, unknown>): number | null => (typeof p["amount_dollars"] === "number" ? p["amount_dollars"] : typeof p["amount_cents"] === "number" ? p["amount_cents"] / 100 : null);

function topicEvent(resource: string, action: string, p: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const id = idOf(p["id"]);
  if (!id) return null;
  const at = (field: string) => parseDate(str(p[field]), field);
  const created = at("created_at") ?? fallback ?? new Date();
  const key = `${resource}.${action}`;
  switch (key) {
    case "order.created":
      return { eventId: eventId("thinkific", connectionId, "order", id), eventType: "order_created", subject: email(p), occurredAt: created, value: dollars(p), currency: null, properties: p };
    case "order_transaction.succeeded":
      return { eventId: eventId("thinkific", connectionId, "transaction", id), eventType: "payment_succeeded", subject: email(p), occurredAt: created, value: dollars(p), currency: null, properties: p };
    case "order_transaction.refunded":
      return { eventId: eventId("thinkific", connectionId, "transaction", id, "refunded"), eventType: "payment_refunded", subject: email(p), occurredAt: created, value: dollars(p), currency: null, properties: p };
    case "subscription.cancelled":
      return { eventId: eventId("thinkific", connectionId, "subscription", id, "canceled"), eventType: "subscription_canceled", subject: email(p), occurredAt: created, properties: p };
    case "enrollment.created":
      return { eventId: eventId("thinkific", connectionId, "enrollment", id), eventType: "enrollment_created", subject: email(p), occurredAt: created, properties: p };
    case "enrollment.completed":
      return { eventId: eventId("thinkific", connectionId, "enrollment", id, "completed"), eventType: "enrollment_completed", subject: email(p), occurredAt: at("completed_at") ?? created, properties: p };
    case "user.signup":
      return { eventId: eventId("thinkific", connectionId, "user", id), eventType: "user_signup", subject: email(p), occurredAt: created, properties: p };
    case "lead.created":
      return { eventId: eventId("thinkific", connectionId, "lead", id), eventType: "lead_created", subject: email(p), occurredAt: created, properties: p };
    default:
      return null;
  }
}

export const thinkificConnector: Connector = {
  source: "thinkific",
  authType: "apiKey",
  operations: ["orders.list"] as const,
  operationFor: () => "orders.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-thinkific-hmac-sha256", encoding: "hex" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const env = asObject(rawPayload);
    const ev = topicEvent(str(env["resource"]) ?? "", str(env["action"]) ?? "", asObject(env["payload"]), ctx.connectionId, parseDate(str(env["created_at"]), "created_at") ?? ctx.fallbackOccurredAt);
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = cont ? Number(cont) || 1 : 1;
        const res = await client.get<{ items?: unknown[]; meta?: { pagination?: { current_page?: number; total_pages?: number } } }>("/orders", { page, limit: PAGE });
        const all = (res.items ?? []).map(asObject);
        const rows = all.filter((o) => (Date.parse(str(o["created_at"]) ?? "") || 0) >= since.getTime());
        const older = all.length > 0 && rows.length < all.length; // newest-first: the first older row ends the window
        const more = !older && (res.meta?.pagination?.current_page ?? page) < (res.meta?.pagination?.total_pages ?? 1);
        return { rows, next: more ? String(page + 1) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (o) => isoOrNull(o["created_at"]),
      map: (o) => topicEvent("order", "created", o, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const key = requireCredential(args.credentials, "apiKey", "Thinkific");
    const hooks = bearerClient(WEBHOOKS_API, key, "Thinkific");
    const ids: string[] = [];
    for (const topic of THINKIFIC_TOPICS) {
      const res = await hooks.post<{ id?: string }>("/webhooks", { topic, target_url: args.webhookUrl });
      if (res.id) ids.push(res.id);
    }
    // Thinkific signs with the site API key itself.
    return { signingSecret: key, externalId: ids.join(",") };
  },
};
```

`unregisterWebhook` is omitted: the external id is a comma-separated list and the delete-connection path treats a missing `unregisterWebhook` as nothing to do. Add it when the population test grows a rule for `autoWebhook ⇒ unregisterWebhook`.

Catalog entry:

```ts
  {
    source: "thinkific",
    name: "Thinkific",
    description: "Orders, payments and refunds (Thinkific Payments), subscriptions cancelled, enrolments started and completed, signups, leads.",
    brand: { color: "#2A2B3A", short: "Th" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote: "Orders are reconciled by polling; transactions, enrolments and signups arrive by webhook. Transaction and subscription events fire only for sites on Thinkific Payments.",
    autoWebhook: true,
    webhookOptional: true,
    docs: { url: "https://developers.thinkific.com/api/api-documentation", readOn: "2026-09-07", webhooks: "https://support.thinkific.dev/hc/en-us/articles/4422658311703-Webhooks-Documentation" },
    verified: { live: null },
    // developers.thinkific.com rate limits (read 2026-09-07): 120 requests/minute per site.
    rateLimits: { "orders.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → Code & analytics → API)", placeholder: "…" },
      { key: "subdomain", label: "Site subdomain (the part before .thinkific.com)", placeholder: "acme" },
    ],
    eventTypeLabels: { order_created: "Order placed", payment_succeeded: "Payment succeeded", payment_refunded: "Refund", subscription_canceled: "Subscription cancelled", enrollment_created: "Enrolment started", enrollment_completed: "Course completed", user_signup: "Signed up", lead_created: "Lead captured" },
    commonFields: ["product_name", "amount_dollars", "status", "user_email", "coupon_code", "course_name"],
  },
```

(`payment_succeeded`/`payment_refunded`/`subscription_canceled`/`lead_created` labels must match Stripe's/Paddle's/Pipedrive's strings exactly.)

- [ ] **Step 4: Prober** — `THINKIFIC_API_KEY` as `key:subdomain`; `orders?limit=5`; print the first order's `created_at`, whether `amount_dollars` is present, and `meta.pagination`.

- [ ] **Commit:** `Add Thinkific: orders walked newest-first inside the window, everything else by signed webhook`

---

### Task 16: ThriveCart (webhook-only)

**Files:** create `src/connectors/thrivecart.ts`, `tests/thrivecart.test.ts`; modify catalog, registry. (No prober: no read API is used.)

**Facts (7 Sep 2026):** docs `https://developers.thrivecart.com/documentation/`, event subscriptions `https://developers.thrivecart.com/documentation/event_subscription/intro/`. Deliveries POST a JSON body with `event` (`order.success`, `order.subscription_payment`, `order.subscription_payment_failed`, `order.refund`, `order.subscription_cancelled`, `order.abandoned`, `affiliate.commission` — confirm names at build), `mode` (`live|test`), `mode_int`, `thrivecart_secret` (the account's "order validation" secret), `event_id`, `webhook_id`, `order_timestamp` (unix) / `order[date_unix]`, `customer: { email }`, `order: { id, total (cents), currency, charges[] }`, `base_product_name`. No HMAC: verification is a constant-time compare of `thrivecart_secret`. Test-mode orders must be dropped.

**Interfaces:** `thrivecartConnector` (`authType: "secret"`, `instant: true`, `poll: false`, `sync: "webhook-only"`).

- [ ] **Step 1: Failing test**

```ts
const body = (over: Record<string, unknown> = {}) => ({ event: "order.success", mode: "live", mode_int: 1, thrivecart_secret: "TCSECRET", event_id: "e1", webhook_id: "w1", order_timestamp: 1_757_200_000, customer: { email: "b@x.io" }, order: { id: "O-1", total: 9700, currency: "USD" }, base_product_name: "Course", ...over });

describe("thrivecart: signature", () => {
  it("compares the body's thrivecart_secret in constant time; fails closed", () => {
    expect(thrivecartConnector.verifySignature({ rawBody: JSON.stringify(body()), headers: {}, secret: "TCSECRET" })).toBe(true);
    expect(thrivecartConnector.verifySignature({ rawBody: JSON.stringify(body({ thrivecart_secret: "no" })), headers: {}, secret: "TCSECRET" })).toBe(false);
    expect(thrivecartConnector.verifySignature({ rawBody: JSON.stringify(body()), headers: {}, secret: null })).toBe(false);
    expect(thrivecartConnector.verifySignature({ rawBody: "{", headers: {}, secret: "TCSECRET" })).toBe(false);
  });
});

describe("thrivecart: normalize", () => {
  it("live orders become order_created at order_timestamp in major units; rebills, failures, refunds, cancellations, abandons, commissions; test mode is dropped; the secret is stripped", () => {
    const [o] = thrivecartConnector.normalize!(body(), { connectionId: CONN });
    expect(o).toMatchObject({ eventId: "thrivecart:conn_1:O-1:order.success", eventType: "order_created", subject: "b@x.io", value: 97, currency: "USD" });
    expect(o.occurredAt.toISOString()).toBe(new Date(1_757_200_000 * 1000).toISOString());
    expect(o.properties).not.toHaveProperty("thrivecart_secret");
    const cases: Array<[string, string]> = [["order.subscription_payment", "rebill"], ["order.subscription_payment_failed", "rebill_failed"], ["order.refund", "payment_refunded"], ["order.subscription_cancelled", "subscription_canceled"], ["order.abandoned", "cart_abandoned"], ["affiliate.commission", "commission_earned"]];
    for (const [event, ours] of cases) expect(thrivecartConnector.normalize!(body({ event, event_id: `e_${ours}` }), { connectionId: CONN })[0].eventType, event).toBe(ours);
    expect(thrivecartConnector.normalize!(body({ mode: "test", mode_int: 0 }), { connectionId: CONN })).toEqual([]);
    expect(thrivecartConnector.normalize!(body({ event: "something.else" }), { connectionId: CONN })).toEqual([]);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/thrivecart.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { asObject, str } from "./field-utils";
import { epochToDate, eventId, sharedTokenVerify } from "./kit";

/**
 * ThriveCart. Webhook-only: every delivery is a dated money event with a
 * unix order_timestamp. There is no HMAC — the account's order-validation
 * secret rides in the body, compared in constant time and stripped before
 * storage. Test-mode orders are dropped, because a wrong revenue figure is
 * the failure this product exists to prevent. Docs read 7 Sep 2026:
 * developers.thrivecart.com (event subscriptions).
 */
export const THRIVECART_EVENTS: Record<string, string> = {
  "order.success": "order_created",
  "order.subscription_payment": "rebill",
  "order.subscription_payment_failed": "rebill_failed",
  "order.refund": "payment_refunded",
  "order.subscription_cancelled": "subscription_canceled",
  "order.abandoned": "cart_abandoned",
  "affiliate.commission": "commission_earned",
};

export const thrivecartConnector: Connector = {
  source: "thrivecart",
  authType: "secret",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    let token: string | null = null;
    try {
      token = str(asObject(JSON.parse(rawBody))["thrivecart_secret"]);
    } catch {
      return false;
    }
    return sharedTokenVerify({ rawBody, headers, secret }, { token });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const b = asObject(rawPayload);
    const ours = THRIVECART_EVENTS[str(b["event"]) ?? ""];
    if (!ours) return [];
    if (b["mode"] === "test" || b["mode_int"] === 0) return [];
    const order = asObject(b["order"]);
    const orderId = str(order["id"]) ?? str(b["order_id"]) ?? str(b["event_id"]);
    if (!orderId) return [];
    const at = epochToDate(b["order_timestamp"], "s") ?? epochToDate(asObject(b["order"])["date_unix"], "s") ?? ctx.fallbackOccurredAt ?? new Date();
    const total = typeof order["total"] === "number" ? order["total"] / 100 : null;
    const { thrivecart_secret: _s, ...rest } = b;
    return [{
      eventId: eventId("thrivecart", ctx.connectionId, orderId, str(b["event"]) ?? ours),
      eventType: ours,
      subject: str(asObject(b["customer"])["email"]),
      occurredAt: at,
      value: ours === "cart_abandoned" ? null : total,
      currency: str(order["currency"])?.toUpperCase() ?? null,
      properties: rest,
    }];
  },
};
```

Catalog entry:

```ts
  {
    source: "thrivecart",
    name: "ThriveCart",
    description: "Orders, rebills and failed rebills, refunds, cancellations, abandoned carts, affiliate commissions.",
    brand: { color: "#F5A623", short: "Tc" },
    connect: "apiKey",
    instant: true,
    poll: false,
    sync: "webhook-only",
    autoWebhook: false,
    docs: { url: "https://developers.thrivecart.com/documentation/", readOn: "2026-09-07", webhooks: "https://developers.thrivecart.com/documentation/event_subscription/intro/" },
    verified: { live: null },
    credentialFields: [{ key: "webhookSecret", label: "Order validation secret (Settings → API & Webhooks)", placeholder: "…" }],
    eventTypeLabels: { order_created: "Order placed", rebill: "Rebill collected", rebill_failed: "Rebill failed", payment_refunded: "Refund", subscription_canceled: "Subscription cancelled", cart_abandoned: "Cart abandoned", commission_earned: "Commission earned" },
    commonFields: ["event", "base_product_name", "order.total", "order.currency", "customer.email", "mode"],
    webhookSetup:
      "In ThriveCart → Settings → API & Webhooks, add event subscriptions for order and affiliate events pointing at the URL below, " +
      "and paste the account's order validation secret as the secret on this connection. There is no list API, so history starts at connect.",
  },
```

`connect: "apiKey"` with only a `webhookSecret` field is the same shape as the custom webhook; `connectApiKeyAction` sets `authType: "secret"` only for `source === "webhook"` — extend that line to `entry.credentialFields.every((f) => f.key === "webhookSecret") ? "secret" : "apiKey"` so ThriveCart and Customer.io store `secret`, and pin it in `tests/thrivecart.test.ts` with a `createConnection` case modelled on `tests/whop.test.ts` (the pasted-secret describe).

- [ ] **Commit:** `Add ThriveCart: every delivery a dated money event, test mode dropped, secret stripped`

---

### Task 17: Retell AI

**Files:** create `src/connectors/retell.ts`, `tests/retell.test.ts`, `scripts/verify-retell.ts`; modify catalog, registry, `scripts/check-orphans.ts` (remove `standardWebhooksVerify`).

**Facts (7 Sep 2026):** docs `https://docs.retellai.com/`, webhooks `https://docs.retellai.com/features/webhook`, list `https://docs.retellai.com/api-references/list-calls`. Auth: `Authorization: Bearer <api key>` at `https://api.retellai.com`. List: `POST /v2/list-calls { filter_criteria: { start_timestamp: { lower_threshold: <ms>, upper_threshold: <ms> } }, sort_order: "ascending", limit: 1000, pagination_key: <call_id> }` → `Call[]`; Call: `call_id`, `call_type`, `agent_id`, `call_status`, `start_timestamp`, `end_timestamp` (epoch MILLISECONDS), `duration_ms`, `disconnection_reason`, `from_number`, `to_number`, `direction`, `call_analysis: { call_successful, user_sentiment, call_summary, custom_analysis_data }`, `call_cost` (YOUR spend — never the value). Webhook: `x-retell-signature`; the docs' SDK helper `Retell.verify(body, apiKey, signature)` — confirm the construction at build; the module implements the Standard-Webhooks shape first and the plain hex-HMAC-over-body shape second, keyed on the API key. Events: `call_started`, `call_ended`, `call_analyzed`, `transfer_bridged`. Webhook URL is set per agent in the dashboard (no registration API).

**Interfaces:** `retellConnector` (`authType: "apiKey"`; the entry's `webhookSecret` field says "your API key again").

- [ ] **Step 1: Failing test**

```ts
const KEY = "key_retell";
const call = (over: Record<string, unknown> = {}) => ({ call_id: "call_1", call_type: "phone_call", agent_id: "ag_1", call_status: "ended", start_timestamp: 1_757_200_000_000, end_timestamp: 1_757_200_090_000, duration_ms: 90_000, disconnection_reason: "user_hangup", direction: "outbound", to_number: "+15550001", from_number: "+15550002", call_cost: { combined_cost: 12 }, ...over });
const nowSec = () => Math.floor(Date.now() / 1000);

describe("retell: signature", () => {
  it("accepts a Standard-Webhooks signature keyed on the API key, or a hex HMAC over the body; fails closed", () => {
    const body = JSON.stringify({ event: "call_ended", call: call() });
    const ts = String(nowSec());
    const std = `v1,${createHmac("sha256", KEY).update(`msg_1.${ts}.${body}`).digest("base64")}`;
    expect(retellConnector.verifySignature({ rawBody: body, headers: { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": std }, secret: KEY })).toBe(true);
    expect(retellConnector.verifySignature({ rawBody: body, headers: { "x-retell-signature": createHmac("sha256", KEY).update(body).digest("hex") }, secret: KEY })).toBe(true);
    expect(retellConnector.verifySignature({ rawBody: body, headers: {}, secret: KEY })).toBe(false);
    expect(retellConnector.verifySignature({ rawBody: body, headers: { "x-retell-signature": "x" }, secret: null })).toBe(false);
  });
});

describe("retell: normalize", () => {
  it("started → call_logged at start (ms → Date); ended → call_completed with duration seconds; analyzed → call_analyzed with the outcome; transfer → call_transferred; cost never the value", () => {
    const [s] = retellConnector.normalize!({ event: "call_started", call: call() }, { connectionId: CONN });
    expect(s).toMatchObject({ eventId: "retell:conn_1:call_1", eventType: "call_logged", subject: "+15550001" });
    expect(s.occurredAt.toISOString()).toBe("2026-09-07T00:26:40.000Z");
    const [e] = retellConnector.normalize!({ event: "call_ended", call: call() }, { connectionId: CONN });
    expect(e).toMatchObject({ eventId: "retell:conn_1:call_1:completed", eventType: "call_completed", value: 90 });
    expect(e.occurredAt.toISOString()).toBe("2026-09-07T00:28:10.000Z");
    const [a] = retellConnector.normalize!({ event: "call_analyzed", call: call({ call_analysis: { call_successful: true, user_sentiment: "Positive", custom_analysis_data: { qualified: true } } }) }, { connectionId: CONN });
    expect(a).toMatchObject({ eventId: "retell:conn_1:call_1:analyzed", eventType: "call_analyzed" });
    expect(a.properties).toMatchObject({ call_successful: true, user_sentiment: "Positive" });
    expect(retellConnector.normalize!({ event: "transfer_bridged", call: call() }, { connectionId: CONN })[0].eventType).toBe("call_transferred");
    expect(retellConnector.normalize!({ event: "transcript_updated", call: call() }, { connectionId: CONN })).toEqual([]);
  });
});

describe("retell: poll", () => {
  it("lists calls by start_timestamp between the mark and now, ascending, pagination_key = last call_id, settles on the newest start", async () => {
    const calls = stubFetch([[call(), call({ call_id: "call_2", start_timestamp: 1_757_200_500_000, end_timestamp: 1_757_200_560_000, duration_ms: 60_000 })], []]);
    const res = await retellConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["call_completed", "call_completed", "call_logged", "call_logged"]);
    expect(res.nextCursor).toBe("2026-09-07T00:35:00.000Z");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sort_order).toBe("ascending");
    expect(body.filter_criteria.start_timestamp.lower_threshold).toBeGreaterThan(0);
    expect(new URL(calls[0].url).pathname).toBe("/v2/list-calls");
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/retell.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, str } from "./field-utils";
import { bearerClient, epochToDate, eventId, hmacHeaderVerify, requireCredential, standardWebhooksVerify, windowedWalk } from "./kit";

/**
 * Retell AI. Calls carry start/end in epoch MILLISECONDS and duration_ms;
 * call_analyzed brings a boolean call_successful and the customer's own
 * custom_analysis_data (kept in properties, never normalised into a type).
 * call_ended and call_analyzed describe one call and are keyed apart.
 * call_cost is what the customer PAYS Retell and is never the value.
 * Docs read 7 Sep 2026: docs.retellai.com (list-calls, webhook). Retell
 * signs with the API key; both signature shapes seen in the SDK are tried.
 */
const API = "https://api.retellai.com";
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 30, overlapMs: 5 * 60_000 };
const PAGE = 1000;

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Retell"), "Retell");
const ms = (v: unknown) => epochToDate(v, "ms");

function events(c: Record<string, unknown>, connectionId: string, only?: string): CanonicalEvent[] {
  const id = str(c["call_id"]);
  if (!id) return [];
  const subject = str(c["to_number"]) ?? str(c["from_number"]);
  const start = ms(c["start_timestamp"]);
  const end = ms(c["end_timestamp"]);
  const analysis = asObject(c["call_analysis"]);
  const { call_cost: _cost, ...rest } = c;
  const props = { ...rest, call_successful: analysis["call_successful"] ?? null, user_sentiment: analysis["user_sentiment"] ?? null, custom_analysis_data: analysis["custom_analysis_data"] ?? null };
  const base = eventId("retell", connectionId, id);
  const want = (e: string) => !only || only === e;
  const out: CanonicalEvent[] = [];
  if (want("call_started") && start) out.push({ eventId: base, eventType: "call_logged", subject, occurredAt: start, properties: props });
  if (want("call_ended") && end) out.push({ eventId: `${base}:completed`, eventType: "call_completed", subject, occurredAt: end, value: typeof c["duration_ms"] === "number" ? c["duration_ms"] / 1000 : null, properties: props });
  if (only === "call_analyzed" && (end ?? start)) out.push({ eventId: `${base}:analyzed`, eventType: "call_analyzed", subject, occurredAt: (end ?? start)!, properties: props });
  if (only === "transfer_bridged" && (end ?? start)) out.push({ eventId: `${base}:transferred`, eventType: "call_transferred", subject, occurredAt: (end ?? start)!, properties: props });
  return out;
}

export const retellConnector: Connector = {
  source: "retell",
  authType: "apiKey",
  operations: ["calls.list"] as const,
  operationFor: () => "calls.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    if (standardWebhooksVerify({ rawBody, headers, secret })) return true;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-retell-signature", encoding: "hex" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const event = str(body["event"]);
    if (!event) return [];
    return events(asObject(body["call"]), ctx.connectionId, event);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const rows = (await client.post<unknown>("/v2/list-calls", {
          filter_criteria: { start_timestamp: { lower_threshold: since.getTime(), upper_threshold: Date.now() } },
          sort_order: "ascending",
          limit: PAGE,
          pagination_key: cont ?? undefined,
        })) as unknown;
        const list = Array.isArray(rows) ? rows.map(asObject) : [];
        const last = list.length ? str(list[list.length - 1]["call_id"]) : null;
        return { rows: list, next: list.length === PAGE && last ? last : null, rateLimit: client.rateLimit() };
      },
      changedAt: (c) => ms(c["start_timestamp"])?.toISOString() ?? null,
      map: (c) => events(c, args.connectionId, "call_started")[0] ?? null,
    });
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) {
      const c = { ...(r.properties ?? {}) };
      fanned.push(...events(c, args.connectionId, "call_started"), ...events(c, args.connectionId, "call_ended"));
      if (asObject(c["call_analysis"])["call_successful"] != null || c["call_successful"] != null) fanned.push(...events(c, args.connectionId, "call_analyzed"));
    }
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
```

Catalog entry:

```ts
  {
    source: "retell",
    name: "Retell AI",
    description: "AI calls started, completed (duration in seconds), analysed with the outcome, and transferred to a human.",
    brand: { color: "#1A1A1A", short: "Re" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: false,
    docs: { url: "https://docs.retellai.com/api-references/list-calls", readOn: "2026-09-07", webhooks: "https://docs.retellai.com/features/webhook" },
    verified: { live: null },
    // docs.retellai.com (read 2026-09-07) publishes no figure; 60/min until measured.
    rateLimits: { "calls.list": { requestsPerMinute: 60 } },
    credentialFields: [
      { key: "apiKey", label: "API key", placeholder: "key_…" },
      { key: "webhookSecret", label: "Webhook signing key — Retell signs with your API key, so paste it again", placeholder: "key_…" },
    ],
    eventTypeLabels: { call_logged: "Call logged", call_completed: "Call completed", call_analyzed: "Call analysed", call_transferred: "Call transferred" },
    commonFields: ["direction", "call_status", "disconnection_reason", "call_successful", "user_sentiment", "custom_analysis_data", "agent_id"],
    webhookSetup: "In Retell, set the webhook URL below on each agent (Agent → Webhook settings). Retell signs with your API key.",
  },
```

- [ ] **Step 4: Prober** — POST `/v2/list-calls` with `limit: 5` unbounded vs `lower_threshold: 1_900_000_000_000`; print the first call's `start_timestamp` magnitude (ms vs s) and `call_analysis` keys.

- [ ] **Commit:** `Add Retell: milliseconds honoured, outcome kept, cost never the value`

---

### Task 18: Customer.io (webhook-only)

**Files:** create `src/connectors/customerio.ts`, `tests/customerio.test.ts`; modify catalog, registry, `src/app/integrations/actions.ts` (the `authType` line from Task 16 if not yet done).

**Facts (7 Sep 2026):** webhooks `https://docs.customer.io/integrations/data-out/connections/webhooks/`. Reporting webhooks POST `{ event_id, object_type: "email"|"sms"|"push"|"in_app"|"whatsapp"|"slack"|"webhook"|"customer", metric: "sent"|"delivered"|"opened"|"clicked"|"converted"|"bounced"|"unsubscribed"|"subscribed"|"replied"|…, timestamp (unix seconds — "when the reported thing took place"), data: { customer_id, identifiers: { id, email, cio_id }, delivery_id, campaign_id, action_id, subject, recipient } }`. Signature: `X-CIO-Signature` = hex HMAC-SHA256 over `"v0:{X-CIO-Timestamp}:{raw body}"` keyed on the webhook signing key; `X-CIO-Timestamp` (unix). No bulk activity list on the App API → webhook-only.

**Interfaces:** `customerioConnector` (`authType: "secret"`, `sync: "webhook-only"`).

- [ ] **Step 1: Failing test**

```ts
const SECRET = "cio_signing";
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (ts: string, body: string) => createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
const delivery = (object_type: string, metric: string, over: Record<string, unknown> = {}) => ({ event_id: "01H", object_type, metric, timestamp: 1_757_200_000, data: { customer_id: "c1", identifiers: { email: "u@x.io" }, delivery_id: "d1", campaign_id: 7, subject: "Hi" }, ...over });

describe("customerio: signature", () => {
  it("hex HMAC over v0:ts:body with a fresh X-CIO-Timestamp; fails closed", () => {
    const body = JSON.stringify(delivery("email", "delivered"));
    const ts = String(nowSec());
    expect(customerioConnector.verifySignature({ rawBody: body, headers: { "x-cio-signature": sign(ts, body), "x-cio-timestamp": ts }, secret: SECRET })).toBe(true);
    expect(customerioConnector.verifySignature({ rawBody: body, headers: { "x-cio-signature": sign(ts, body), "x-cio-timestamp": ts }, secret: null })).toBe(false);
    const old = String(nowSec() - 3600);
    expect(customerioConnector.verifySignature({ rawBody: body, headers: { "x-cio-signature": sign(old, body), "x-cio-timestamp": old }, secret: SECRET })).toBe(false);
    expect(customerioConnector.verifySignature({ rawBody: body, headers: { "x-cio-signature": sign(ts, body) }, secret: SECRET })).toBe(false);
  });
});

describe("customerio: normalize", () => {
  it("maps object_type + metric to channel-prefixed types at the delivery timestamp; internal stages are dropped", () => {
    const cases: Array<[string, string, string]> = [["email", "delivered", "email_delivered"], ["email", "opened", "email_opened"], ["email", "clicked", "email_clicked"], ["email", "converted", "email_converted"], ["email", "bounced", "bounced"], ["sms", "replied", "sms_replied"], ["customer", "subscribed", "subscribed"], ["customer", "unsubscribed", "unsubscribed"]];
    for (const [obj, metric, ours] of cases) {
      const [ev] = customerioConnector.normalize!(delivery(obj, metric, { event_id: `${obj}_${metric}` }), { connectionId: CONN });
      expect(ev, `${obj}.${metric}`).toMatchObject({ eventId: `customerio:conn_1:${obj}_${metric}`, eventType: ours, subject: "u@x.io" });
      expect(ev.occurredAt.toISOString()).toBe(new Date(1_757_200_000 * 1000).toISOString());
    }
    expect(customerioConnector.normalize!(delivery("email", "drafted"), { connectionId: CONN })).toEqual([]);
    expect(customerioConnector.normalize!(delivery("email", "attempted"), { connectionId: CONN })).toEqual([]);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/customerio.ts
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { asObject, str } from "./field-utils";
import { timestampFreshness } from "@/lib/signatures";
import { epochToDate, eventId, hmacHeaderVerify } from "./kit";

/**
 * Customer.io reporting webhooks — already an event stream: each delivery
 * is (object_type, metric, timestamp). Internal pipeline stages (drafted,
 * attempted) are not business events and are dropped; open tracking is
 * pixel-based and said so on the entry. No bulk activity list exists on the
 * App API, so this is webhook-only. Docs read 7 Sep 2026:
 * docs.customer.io/integrations/data-out/connections/webhooks
 * (X-CIO-Signature over "v0:ts:body").
 */
const METRICS = new Set(["sent", "delivered", "opened", "clicked", "converted", "bounced", "dropped", "failed", "undeliverable", "unsubscribed", "subscribed", "replied", "suppressed"]);
const UNPREFIXED = new Set(["bounced", "unsubscribed", "subscribed", "suppressed", "dropped", "failed", "undeliverable"]);

export const customerioConnector: Connector = {
  source: "customerio",
  authType: "secret",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const ts = headers["x-cio-timestamp"];
    if (!ts || timestampFreshness(ts) !== "fresh") return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-cio-signature", encoding: "hex", message: (body) => `v0:${ts}:${body}` });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const b = asObject(rawPayload);
    const id = str(b["event_id"]);
    const object = str(b["object_type"]);
    const metric = str(b["metric"]);
    if (!id || !object || !metric || !METRICS.has(metric)) return [];
    const data = asObject(b["data"]);
    const ids = asObject(data["identifiers"]);
    const eventType = UNPREFIXED.has(metric) || object === "customer" ? metric : `${object}_${metric}`;
    return [{
      eventId: eventId("customerio", ctx.connectionId, id),
      eventType,
      subject: str(ids["email"]) ?? str(data["customer_id"]) ?? str(ids["id"]),
      occurredAt: epochToDate(b["timestamp"], "s") ?? ctx.fallbackOccurredAt ?? new Date(),
      properties: { ...b, channel: object },
    }];
  },
};
```

Catalog entry:

```ts
  {
    source: "customerio",
    name: "Customer.io",
    description: "Messages delivered, opened, clicked, converted and replied to; subscribers gained and lost.",
    brand: { color: "#5E5CE6", short: "Ci" },
    connect: "apiKey",
    instant: true,
    poll: false,
    sync: "webhook-only",
    syncNote: "Opens are pixel-based and inflated by privacy proxies; delivered, clicked and converted are the defensible counts.",
    autoWebhook: false,
    docs: { url: "https://docs.customer.io/integrations/data-out/connections/webhooks/", readOn: "2026-09-07", webhooks: "https://docs.customer.io/integrations/data-out/connections/webhooks/" },
    verified: { live: null },
    credentialFields: [{ key: "webhookSecret", label: "Reporting webhook signing key (Data & Integrations → Reporting webhooks)", placeholder: "…" }],
    eventTypeLabels: { email_delivered: "Email delivered", email_opened: "Email opened", email_clicked: "Email clicked", email_converted: "Email converted", sms_replied: "SMS reply received", subscribed: "Subscribed", unsubscribed: "Unsubscribed", bounced: "Bounced" },
    commonFields: ["channel", "metric", "data.campaign_id", "data.subject", "data.identifiers.email", "data.delivery_id"],
    webhookSetup: "In Customer.io → Data & Integrations → Reporting webhooks, add the URL below, choose the metrics you count, and paste the signing key as the secret on this connection.",
  },
```

- [ ] **Commit:** `Add Customer.io: reporting webhooks as they are, internal stages dropped`

---

### Task 19: Airtable (poll mirror per base and table)

**Files:** create `src/connectors/airtable.ts`, `tests/airtable.test.ts`, `scripts/verify-airtable.ts`; modify catalog, registry.

**Facts (7 Sep 2026):** docs `https://airtable.com/developers/web/api/introduction`, list records `https://airtable.com/developers/web/api/list-records`, meta `https://airtable.com/developers/web/api/list-bases` and `get-base-schema`. Auth: `Authorization: Bearer pat…`. Bases: `GET https://api.airtable.com/v0/meta/bases` → `{ bases: [{ id, name }] }`. Tables: `GET /v0/meta/bases/{baseId}/tables` → `{ tables: [{ id, name, fields: [{ id, name, type }] }] }`. Records: `GET /v0/{baseId}/{tableId}?pageSize=100&offset=<o>` → `{ records: [{ id, createdTime, fields }], offset? }`. Rate limit 5 req/s per base. Webhooks are ping-then-fetch with 7-day expiry — deferred; this batch is a POLL MIRROR like Sheets: every sweep re-reads the table (`mirrorScope` over the whole resource), `occurredAt` = `fields[dateField]` when the stream has one, else `createdTime`, and `dateFieldState` reports what was used.

**Interfaces:** `airtableConnector` (`authType: "apiKey"`, stream `baseId` + `tableId`, `sync: "mirror"`).

- [ ] **Step 1: Failing test**

```ts
const rec = (id: string, fields: Record<string, unknown>, createdTime = "2026-09-01T10:00:00.000Z") => ({ id, createdTime, fields });

describe("airtable: registration and scope", () => {
  it("is stream-scoped on base and table, a mirror, and fails closed", () => {
    expect(catalogEntry("airtable")!.sync).toBe("mirror");
    expect(catalogEntry("airtable")!.flowFields!.map((f) => f.key)).toEqual(["baseId", "tableId"]);
    expect(airtableConnector.verifySignature({ rawBody: "{}", headers: {}, secret: "x" })).toBe(false);
  });
});

describe("airtable: listOptions", () => {
  it("lists bases, then tables of the chosen base", async () => {
    stubFetch([{ bases: [{ id: "appA", name: "Pipeline" }] }, { tables: [{ id: "tblL", name: "Leads", fields: [] }] }]);
    expect(await airtableConnector.listOptions!("baseId", { connectionId: CONN, credentials: { apiKey: "pat" } })).toEqual([{ value: "appA", label: "Pipeline" }]);
    expect(await airtableConnector.listOptions!("tableId", { connectionId: CONN, credentials: { apiKey: "pat" }, config: { baseId: "appA" } })).toEqual([{ value: "tblL", label: "Leads" }]);
    expect(await airtableConnector.listOptions!("tableId", { connectionId: CONN, credentials: { apiKey: "pat" }, config: {} })).toEqual([]);
  });
});

describe("airtable: poll (mirror)", () => {
  it("reads the whole table across offsets, dates rows by createdTime, keys by stream and record id, and declares the mirror", async () => {
    const calls = stubFetch([{ records: [rec("recA", { Email: "a@x.io", Amount: 10 })], offset: "o1" }, { records: [rec("recB", { Email: "b@x.io" }, "2026-09-02T10:00:00.000Z")] }]);
    const res = await airtableConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pat" }, config: { baseId: "appA", tableId: "tblL" }, streamHash: "h1" });
    expect(res.records.map((r) => r.eventId)).toEqual(["airtable:conn_1:h1:recA", "airtable:conn_1:h1:recB"]);
    expect(res.records[0]).toMatchObject({ eventType: "row_added", subject: "a@x.io", value: 10 });
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(res.mirrorScope).toBeDefined();
    expect(res.nextCursor).toBeNull();
    expect(res.providerCalls).toBe(2);
    expect(res.dateFieldState).toMatchObject({ column: null, source: "detected", dated: 2, undated: 0 });
    expect(new URL(calls[1].url).searchParams.get("offset")).toBe("o1");
  });
  it("dates rows by the stream's chosen date field and reports the undated ones", async () => {
    stubFetch([{ records: [rec("recA", { Email: "a@x.io", "Closed on": "2026-08-15" }), rec("recB", { Email: "b@x.io" })] }]);
    const res = await airtableConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pat" }, config: { baseId: "appA", tableId: "tblL" }, streamHash: "h1", dateField: "Closed on" });
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(res.dateFieldState).toMatchObject({ column: "Closed on", source: "user", presentInHeader: true, dated: 1, undated: 1 });
    expect(res.undatedEventIds?.has("airtable:conn_1:h1:recB")).toBe(true);
  });
});
```

- [ ] **Step 3: Module + entry**

```ts
// src/connectors/airtable.ts
import type { Connector, CanonicalEvent, ListOptionsArgs, PollArgs, PollResult, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { normalizeDateValue } from "@/lib/normalize-dates";
import { bearerClient, eventId, requireCredential } from "./kit";

/**
 * Airtable — the same job as Google Sheets for the same customers, with a
 * real per-record createdTime. A poll MIRROR per (base, table): every sweep
 * re-reads the table, so stored rows equal the source and deleted rows
 * retire. occurredAt is the stream's chosen date field when it has one,
 * else createdTime; what was used is reported in dateFieldState.
 * Docs read 7 Sep 2026: airtable.com/developers/web/api (list records,
 * meta bases/tables; 5 requests/second per base). Change webhooks (ping,
 * then fetch payloads by cursor; 7-day expiry) are a later step.
 */
const API = "https://api.airtable.com/v0";
const MAX_PAGES = 50; // 5,000 records per sweep

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Airtable"), "Airtable");

function emailIn(fields: Record<string, unknown>): string | null {
  for (const v of Object.values(fields)) if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  return null;
}
function numberIn(fields: Record<string, unknown>): number | null {
  for (const v of Object.values(fields)) if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export const airtableConnector: Connector = {
  source: "airtable",
  authType: "apiKey",
  operations: ["records.list"] as const,
  operationFor: () => "records.list",
  verifySignature(): boolean {
    return false; // no inbound path in this batch
  },
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    const client = api(args.credentials);
    if (key === "baseId") {
      const res = await client.get<{ bases?: unknown[] }>("/meta/bases");
      return (res.bases ?? []).map(asObject).map((b) => ({ value: str(b["id"]) ?? "", label: str(b["name"]) ?? str(b["id"]) ?? "Untitled base" })).filter((o) => o.value);
    }
    if (key === "tableId") {
      const baseId = str(args.config?.["baseId"]);
      if (!baseId) return [];
      const res = await client.get<{ tables?: unknown[] }>(`/meta/bases/${encodeURIComponent(baseId)}/tables`);
      return (res.tables ?? []).map(asObject).map((t) => ({ value: str(t["id"]) ?? "", label: str(t["name"]) ?? str(t["id"]) ?? "Untitled table" })).filter((o) => o.value);
    }
    return [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const baseId = str(args.config?.["baseId"]);
    const tableId = str(args.config?.["tableId"]);
    if (!baseId || !tableId) return { records: [], nextCursor: null };
    const client = api(args.credentials);
    const tag = args.streamHash ?? `${baseId}:${tableId}`;
    const from = new Date(0);
    const to = new Date();
    const records: CanonicalEvent[] = [];
    const undated = new Set<string>();
    let dated = 0;
    let offset: string | null = null;
    let pages = 0;
    let sawColumn = false;
    const column = args.dateField ?? null;
    do {
      const page: { records?: unknown[]; offset?: string } = await client.get(`/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`, { pageSize: 100, offset: offset ?? undefined });
      for (const r of (page.records ?? []).map(asObject)) {
        const id = str(r["id"]);
        if (!id) continue;
        const fields = asObject(r["fields"]);
        if (column && column in fields) sawColumn = true;
        const chosen = column ? normalizeDateValue(fields[column], column) : null;
        const chosenAt = chosen ? new Date(chosen) : null;
        const createdAt = parseDate(str(r["createdTime"]), "createdTime");
        const evId = eventId("airtable", args.connectionId, tag, id);
        const occurredAt = column ? chosenAt : createdAt;
        if (occurredAt) dated += 1;
        else undated.add(evId);
        records.push({ eventId: evId, eventType: "row_added", subject: emailIn(fields), occurredAt: occurredAt ?? createdAt ?? to, value: numberIn(fields), properties: { ...fields, _airtable: { id, createdTime: r["createdTime"], baseId, tableId } } });
      }
      offset = page.offset ?? null;
      pages += 1;
    } while (offset && pages < MAX_PAGES);
    return {
      records,
      nextCursor: null,
      mirrorScope: { from, to },
      providerCalls: pages,
      rateLimit: client.rateLimit() ?? undefined,
      incomplete: offset != null,
      dateFieldState: { column, source: column ? "user" : "detected", presentInHeader: column ? sawColumn : false, dated, undated: undated.size },
      undatedEventIds: undated,
    };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null });
    return records.slice(-n).reverse();
  },
};
```

If a mirror with `offset != null` (more than 5,000 rows) would retire the unread tail, set `mirrorScope` only when `offset == null`; add that guard (`...(offset == null ? { mirrorScope: { from, to } } : {})`) and a test with three pages under a `MAX_PAGES` of 2 via an exported `AIRTABLE_MAX_PAGES` override — the Sheets connector's `retire-absent-chunking` test is the model.

Catalog entry:

```ts
  {
    source: "airtable",
    name: "Airtable",
    description: "Rows of a table, mirrored every sweep — leads, jobs, deliverables, whatever the base models.",
    brand: { color: "#FCB400", short: "At" },
    connect: "apiKey",
    instant: false,
    poll: true,
    sync: "mirror",
    autoWebhook: false,
    docs: { url: "https://airtable.com/developers/web/api/list-records", readOn: "2026-09-07" },
    verified: { live: null },
    // airtable.com/developers/web/api/rate-limits (read 2026-09-07): 5 requests/second per base.
    rateLimits: { "records.list": { requestsPerMinute: 300 } },
    credentialFields: [{ key: "apiKey", label: "Personal access token (scopes: data.records:read, schema.bases:read)", placeholder: "pat…" }],
    flowFields: [
      { key: "baseId", label: "Base", required: true, dynamic: true, placeholder: "Choose a base…" },
      { key: "tableId", label: "Table", required: true, dynamic: true, dependsOn: ["baseId"], placeholder: "Choose a table…" },
    ],
    hiddenFields: ["_airtable.id", "_airtable.baseId", "_airtable.tableId"],
    eventTypeLabels: { row_added: "Row" },
    commonFields: ["_airtable.createdTime"],
  },
```

Airtable shares Sheets' `brand.short` "At" with Attio — change Attio's to "Ao" in Task 9 so the two marks differ; pin both in `tests/source-style.test.ts`'s uniqueness check (add: every `brand.short` is unique across the catalog).

- [ ] **Step 4: Prober** — `meta/bases`; first base's `tables`; first table's records `pageSize=5`; print the `offset` presence and any `Retry-After`.

- [ ] **Commit:** `Add Airtable: a table mirrored per sweep, dated by the chosen column or createdTime`

> **Checkpoint after Task 19:** full `pnpm test` (dev server stopped), `pnpm build`, `pnpm connector:inventory`, push to `origin/main`. Then update the memory file `namzilabs-backend-state.md` with the batch's landing commit and what remains unprobed.

---

## Self-review

**Spec coverage.** Part 7's nineteen connectors → Tasks 1–19 in the spec's build order. Every task carries `docs`, `brand`, `verified: { live: null }`, cited `rateLimits`, `eventTypeLabels`, `commonFields`; stream-scoped ones (Typeform, Tally, Smartlead, Airtable) carry `flowFields` and `listOptions`; those the provider lets us register (Cal.com, Aircall, Pipedrive, Help Scout, Attio, lemlist, Paddle, Thinkific) implement `registerWebhook`. Two deviations from the spec's table, both stated in their tasks: JustCall ships poll-only (its signature signs the subscription URL, which `verifySignature` cannot see) and Airtable ships as a poll mirror without the ping-then-fetch webhooks (7-day expiry needs a renewal job — a later step).

**Placeholders.** None outside the scaffold's `FILL-ME` markers, which the population test rejects.

**Type consistency.** Every module imports from `./kit` the names the infra plan defines (`windowedWalk`, `parseWalkCursor`, `walkImportProgress`, `standardWebhooksVerify`, `timestampedHmacVerify`, `hmacHeaderVerify`, `sharedTokenVerify`, `providerClient`, `bearerClient`, `basicClient`, `headerKeyClient`, `requireCredential`, `eventId`, `naturalOrHash`, `epochToDate`, `ymd`, `isoOrNull`, `parseDate`). Help Scout needs `providerClient` to forward a caller `onResponse` (stated in Task 8, with the kit test to add). `Connector.retention`/`importProgress` (Stripe) match the infra plan's Task 5 signatures. The `connectApiKeyAction` `authType` change (Task 16) is the one edit outside `src/connectors` and `tests`.

## Execution handoff

Plan complete. With the agent limit in force tonight, execution starts inline (superpowers:executing-plans) on the infra plan, then this plan in order; when subagents are available again, remaining connector tasks can run subagent-driven, one per task, with review between them.
