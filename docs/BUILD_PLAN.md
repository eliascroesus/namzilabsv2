# Namzilabs — Production Build Plan
### A Zapier-grade data-unification SaaS (multi-source ingestion → unified metrics → live dashboard)

**Domain:** namzilabs.co · **Host:** Vercel · **DB:** Neon (Postgres) · **Repo:** GitHub

---

## 0. What we are building (in one paragraph)

A SaaS that connects to many external tools (Calendly, Close CRM, Instantly, Sendblue, Google Sheets, Google Calendar, and a generic "catch-any-webhook" connector), **ingests their data reliably and live**, **normalizes it into one canonical event model**, and lets a company **build custom metrics** on top of that unified stream and **watch everything on one dashboard**. The product's entire value depends on one thing: **the integrations must pull accurate data every time and never silently drop events** — exactly the reliability contract Zapier provides. Everything else (metrics, dashboard) sits on top of that engine.

---

## 1. Research grounding — how the reliability actually works

> These are verified facts (with sources) so the build has **no guesswork**. The reliability model below is copied from how Zapier, Close, Calendly, Instantly, Sendblue and Google actually behave in production.

### 1.1 Zapier uses exactly two trigger models — we will implement both

| Model | How it works | Latency | Dedup responsibility |
|---|---|---|---|
| **Instant trigger (REST hook / webhook)** | When a connection is turned on, we register **our** HTTPS URL with the source app. The app **pushes** a payload the moment an event happens. | Near-instant | The **source app** guarantees it only sends new events, so instant triggers *do not* dedup. We still dedup defensively. |
| **Polling trigger** | We call the app's list endpoint on a schedule (Zapier polls **every 1–15 min** depending on plan) and diff against what we've seen. | 1–15 min | **We** dedup, using a stable `id` (or a configured dedup key), expecting results **sorted reverse-chronologically** with a unique `id` per record. |

**The critical design rule (straight from Zapier's own platform):** every ingested record must carry a **stable unique `id`** used as the deduplication primary key. If the source has no `id`, we assign a deterministic one (hash of the natural key). Instant triggers get a webhook; **polling is the fallback/reconciliation path that catches anything a webhook missed.** Every connector implements *both* where the API allows it.

Sources: [How Zap triggers work](https://help.zapier.com/hc/en-us/articles/8496244568589-How-Zap-triggers-work) · [Trigger Zaps from polling webhooks](https://help.zapier.com/hc/en-us/articles/8496274719757-Trigger-Zaps-from-polling-webhooks) · [How Zapier handles duplicate data](https://help.zapier.com/hc/en-us/articles/8496260269965-How-Zapier-handles-duplicate-data-in-Zap-workflows) · [Zapier deduplication (platform docs)](https://docs.zapier.com/platform/build/deduplication)

### 1.2 The 7-layer reliability stack (this is the heart of the product)

Reliable webhook ingestion is not one trick — it is a small stack of layers, applied **in this order** on every inbound event:

1. **Verify signature** — reject anything not cryptographically signed by the source (HMAC-SHA256). Prevents spoofing.
2. **Fast-ack** — persist the *raw* payload to Neon and return `200` immediately (well under the source's timeout). Never do slow work inside the webhook request.
3. **Enqueue** — hand the raw event to a **durable queue/worker** (Vercel functions are short-lived and cannot run long jobs, so processing happens out-of-band).
4. **Idempotent processing** — dedup on the **stable event id** with a store that outlives the source's retry window; processing the same event twice must produce the same result exactly once.
5. **Retries with exponential backoff + jitter** — transient failures retry fast, then back off geometrically, with random jitter to avoid a thundering herd.
6. **Dead-letter queue (DLQ)** — events that exhaust retries go to a monitored DLQ, never silently lost; they are visible and replayable.
7. **Reconciliation / backfill polling** — on a schedule, re-pull recent records from each source's API and fill any gaps, so an event that *never arrived by webhook* is still captured. This is the safety net that makes "never breaks" true.

Sources: [Webhook reliability: idempotency & retries (2026)](https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026) · [Webhook governance for Zapier](https://www.kriv.ai/articles/webhook-governance-for-zapier-verification-retries-and-idempotency) · [Scaling webhooks: fan-out, DLQs & idempotency](https://medium.com/@bhagyarana80/scaling-webhooks-fan-out-dlqs-idempotency-ebe412ae55d1)

### 1.3 Per-app integration facts (verified — build against these exact behaviors)

| App | Auth | Instant (webhook) | Signature | Polling / backfill | Notes |
|---|---|---|---|---|---|
| **Calendly** | OAuth2 or Personal Access Token | Webhook subscriptions (v2 API). Events: `invitee.created`, `invitee.canceled`, `invitee_no_show.created/deleted`, `routing_form_submission.created`, `contact.created/updated/deleted` | HMAC-SHA256 of `timestamp + body` with the **signing key returned when you create the subscription**, sent in the `Calendly-Webhook-Signature` header (`t=…,v1=…`); guards against replay | List scheduled events endpoint | [Webhooks overview](https://help.calendly.com/hc/en-us/articles/223195488-Webhooks-overview) · [Create subscription](https://developer.calendly.com/api-docs/b3A6NTkxNDI1-create-webhook-subscription) · [Signatures](https://developer.calendly.com/api-docs/4c305798a61d3-webhook-signatures) |
| **Close CRM** | API key | Webhook subscriptions on Event Log: pick `object_type` + `action`; supports **filters** | `close-sig-hash` header = SHA256 HMAC of `close-sig-timestamp + payload`, keyed by the `signature_key` returned at subscription creation | Event Log / object list endpoints | **Retries with exp. backoff up to every 20 min, for up to 72 h, then drops.** Max **40** subscriptions/org (up to 500 for automation platforms). [Webhooks](https://developer.close.com/topics/webhooks/) · [Subscriptions](https://developer.close.com/resources/webhook-subscriptions/) |
| **Instantly** | API key (v2) | Webhooks. Events: `email_sent`, `email_opened`, `email_link_clicked`, `reply_received`, `email_bounced`, `lead_unsubscribed`, `campaign_completed`, `account_error`, `lead_neutral`, … | Shared secret / verify at endpoint (add retries + idempotency **on our side** — their docs say so) | Campaign / analytics list endpoints | [Webhook events](https://developer.instantly.ai/guides/webhook-events) · [Event types](https://developer.instantly.ai/api/v2/webhook/listwebhookeventtypes) · [Create webhook](https://developer.instantly.ai/api/v2/webhook/createwebhook) |
| **Sendblue** | API key/secret | Webhook types: `receive`, `outbound` (status), `typing_indicator`, `call_log`, `line_blocked`, `line_assigned`, `contact_created`. Status values: `QUEUED` → `SENT` → `DELIVERED` | Configure a **secret**; Sendblue includes it in webhook headers to verify | `status_callback` is **per-message** (no global default) or configure a single `outbound` webhook for all status updates | **Retries up to 3× on 5xx, 45 s timeout.** [Webhooks](https://docs.sendblue.com/getting-started/webhooks/) · [Status](https://docs.sendblue.com/docs/status/) |
| **Google Sheets** | Google OAuth (already have Drive+Sheets scope on namzilabs.co) | **No native "new row" webhook.** Options: Drive API `files.watch` push, or an Apps Script `onEdit/onChange` POST | n/a (Drive channel token) | **Polling with a row cursor is the reliable primary.** | Drive push: HTTPS + valid SSL required, **domain must be verified in Google Cloud**, channels **expire (≤7 days for file changes; default 1 h if unset), no auto-renew — must re-`watch`**, notifications only ~every 3 min (batched) and **don't say what changed** → you still read the sheet. Sheets read quota ~100 req/100 s. [Drive push](https://developers.google.com/workspace/drive/api/guides/push) |
| **Google Calendar** | Google OAuth | `events.watch` push channel + **incremental sync via `syncToken`** | n/a (channel token) | `events.list` with `syncToken` for gap-free incremental sync | Same channel-expiry/renewal caveats as Drive; sync tokens make backfill exact. |
| **Generic "Catch Hook"** | our per-endpoint secret | We mint a unique inbound URL per connection; any app can POST to it (Zapier's "Catch Hook" equivalent) | Optional shared secret / HMAC | n/a | The universal escape hatch so *any* tool with outbound webhooks works on day one. |

> ⚠️ **Assumption to confirm:** "Sendblue" = **Sendblue.co** (iMessage/SMS). If you meant **Brevo (formerly Sendinblue)** — an email platform — the connector spec changes (their transactional/marketing webhook events instead). Everything else in the plan is unaffected.

---

## 2. Recommended architecture & stack (decisive — fits Vercel + Neon)

The **one architectural fact that shapes everything:** Vercel serverless functions are short-lived and cannot run long-lived pollers or slow webhook processing. So we split into (a) thin, fast HTTP handlers and (b) a **durable execution layer** that does retries, backoff, scheduling and DLQ for us. That durable layer *is* the Zapier-reliability backbone.

| Concern | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router, TypeScript)** on Vercel | One repo for UI + API routes; native to Vercel. |
| Database | **Neon Postgres + Drizzle ORM** | Type-safe schema + migrations; serverless-friendly Postgres. |
| **Durable execution / queue** | **Inngest** (primary recommendation) — or Upstash QStash + Vercel Cron | Gives us out-of-the-box: retries with backoff, concurrency limits, **scheduled functions (the polling + reconciliation loops)**, step-level idempotency, and a DLQ view. This is the reliability engine; do not hand-roll it. |
| Auth & multi-tenancy | **WorkOS AuthKit** (Organizations = workspaces) | Enterprise-grade SSO/orgs out of the box; `orgId` derived only from the session. |
| Secret/token storage | **AES-256-GCM encryption at rest** for all OAuth tokens & API keys; key in env/KMS | Never store third-party credentials in plaintext. |
| UI | **Tailwind + shadcn/ui**, charts via **Tremor / Recharts** | Clean, simple, fast to build; Zapier-level polish. |
| Validation | **Zod** at every boundary (webhooks, API, forms) | No malformed data ever enters the pipeline. |

**Data model (canonical, source-agnostic):**
- `organizations`, `users`, `memberships`
- `connections` — one per connected account (app type, auth, status, health)
- `webhook_endpoints` — minted inbound URLs + secrets
- `raw_events` — **immutable** exact payloads (the source of truth; enables replay)
- `events` — **normalized canonical events** (see below) all sources map into
- `metrics` — user-defined metric definitions (rules/filters/aggregation)
- `metric_values` — materialized results for the dashboard
- `sync_state` — per-connection cursors (poll position, syncToken, Drive channel id/expiry)
- `delivery_log` / `dead_letter` — every attempt, for observability + replay

**The canonical `events` schema** (everything normalizes into this — the "unify the data" core):
```
event_id (stable, dedup PK) · org_id · connection_id · source (calendly|close|instantly|sendblue|gsheets|gcal|webhook)
· event_type (booked|canceled|reply|email_sent|sms_sent|sms_delivered|call|row_added|…)
· subject (person/lead identifier: email/phone/name)
· occurred_at · received_at
· value (numeric, optional) · currency (optional)
· properties (jsonb: source-specific fields, preserved)
· raw_event_id (FK to immutable raw)
```
This single table is what makes "one platform, all the data" possible — every KPI (booked leads, calls, SMS sent, replies) is a query/aggregation over `events`.

---

## 3. The three build prompts

> Each block below is **self-contained** — paste it into a fresh build session in order. Build **Prompt 1 first and prove it works before Prompt 2.** The reliability engine must be real before any connector is added.

---

### ▐ PROMPT 1 — Foundation & Reliability Core (the Integration Engine)

```
You are building the reliability core of a data-unification SaaS on Next.js (App Router,
TypeScript) + Neon Postgres (Drizzle ORM) + Inngest (durable execution), deployed on Vercel.
Multi-tenant with WorkOS AuthKit Organizations. This phase builds NO product UI and NO specific
integrations yet — it builds the source-agnostic engine every future integration plugs into.
Correctness and reliability are the only goals. Do not cut corners on the pipeline.

GOAL: A generic ingestion → normalization → storage engine with Zapier-grade reliability.

Build, in order:
1. Project scaffold: Next.js + TS + Tailwind + shadcn/ui + Drizzle + Zod + WorkOS AuthKit + Inngest,
   with env validation and a health endpoint. Wire Neon + Inngest locally and on Vercel.
2. Database schema (Drizzle migrations) exactly as: organizations, users, memberships,
   connections, webhook_endpoints, raw_events (IMMUTABLE), events (canonical), sync_state,
   delivery_log, dead_letter. Canonical `events` schema:
     event_id (stable dedup PK), org_id, connection_id, source, event_type, subject,
     occurred_at, received_at, value, currency, properties(jsonb), raw_event_id.
3. The inbound webhook handler pattern (one reusable route): (a) verify HMAC signature via a
   per-source verifier interface, (b) persist the raw payload to raw_events, (c) return 200
   FAST, (d) emit an Inngest event to process out-of-band. Never do slow work in the request.
4. The processing pipeline as an Inngest function with: idempotent dedup on event_id (unique
   constraint + upsert), a `normalize(source, rawPayload) -> CanonicalEvent[]` interface,
   retries with exponential backoff + jitter (use Inngest's retry config), and a dead_letter
   path when retries exhaust. Log every attempt to delivery_log.
5. A scheduled reconciliation/backfill Inngest cron: for each active connection, call a
   `poll(connection, cursor) -> {records, nextCursor}` interface, dedup against events, and
   advance sync_state. This is the safety net that catches anything webhooks missed.
6. A generic "Catch Hook" connector: mint a unique inbound URL + secret per connection so any
   external app can POST events immediately, normalized via a pass-through mapping.
7. A replay endpoint: re-run processing for any raw_event or dead_letter entry by id.
8. Observability: a minimal internal /admin page listing connections, recent deliveries,
   DLQ contents, and per-connection health (last success, error rate).

CONTRACTS the connectors (Prompt 2) will implement — define these interfaces now:
  Connector = { auth, verifySignature(req)->bool, normalize(raw)->CanonicalEvent[],
                poll(cursor)->{records,nextCursor}, testFetchLatest(n)->CanonicalEvent[] }

HARD REQUIREMENTS:
- Every event has a stable unique id used as the dedup primary key; if the source lacks one,
  derive it deterministically (hash of natural key). Processing must be exactly-once in effect.
- At-least-once delivery assumed: duplicates must be harmless.
- No event is ever silently lost: everything lands in raw_events first; failures go to DLQ.
- All third-party tokens/keys encrypted at rest (AES-256-GCM).
- Zod-validate every boundary. TypeScript strict. Write tests for: dedup, retry→DLQ,
  signature verify (pass+fail), reconciliation gap-fill, replay.

DELIVERABLE: a working engine I can prove by POSTing a signed test payload to a Catch Hook
URL and seeing it appear, deduped, in the canonical events table — plus a forced-failure
test that lands in the DLQ and can be replayed. Show me how to run and verify it.
```

---

### ▐ PROMPT 2 — Integrations Layer (connectors + the Zapier "connect an app" UX)

```
Building on the reliability core (canonical events, Inngest pipeline, Connector interface,
Catch Hook, reconciliation), implement real connectors AND the Zapier-style connect flow.
The connect experience must be as simple as Zapier's: connect account → auto-register webhook
→ preview the 2–3 latest real records → done. Every connector implements BOTH an instant
webhook AND a polling/backfill path where the API allows, and maps into the canonical events
schema. Do not invent API behavior — implement against these verified specs:

CONNECTORS (v1):
- Calendly: OAuth2 (or PAT). Create webhook subscription (events: invitee.created,
  invitee.canceled, invitee_no_show.created/deleted, routing_form_submission.created).
  Verify HMAC-SHA256 of timestamp+body using the signing key returned at subscription
  creation, from the Calendly-Webhook-Signature header (t=,v1=). Backfill via list scheduled
  events. Map invitee.created -> event_type "booked", invitee.canceled -> "canceled".
- Close CRM: API key. Create webhook subscription on the Event Log (object_type+action, with
  filters). Verify close-sig-hash = SHA256 HMAC of close-sig-timestamp+payload using the
  signature_key from subscription creation. Respect their retry model. Backfill via Event Log.
  Map lead/opportunity/call/sms events to canonical event_types.
- Instantly (v2): API key. Create webhook (events: email_sent, reply_received, email_opened,
  email_bounced, lead_unsubscribed, campaign_completed, …). Add idempotency + retries on our
  side (their docs require it). Map email_sent -> "email_sent", reply_received -> "reply".
- Sendblue (iMessage/SMS): configure webhooks (receive; outbound status QUEUED/SENT/DELIVERED;
  contact_created). Verify via the configured secret in headers. Note status_callback is
  per-message OR one outbound webhook for all statuses. Map to "sms_sent"/"sms_delivered".
- Google Sheets: use the existing Google OAuth (Drive+Sheets scope, namzilabs.co domain,
  verified in Google Cloud). PRIMARY path = reliable polling with a row cursor in sync_state;
  OPTIONAL low-latency Drive files.watch push (remember: channels expire ≤7 days, no
  auto-renew so schedule re-watch; pushes are batched ~3 min and don't say what changed, so
  read the sheet on notify). Map "new row" -> "row_added" with columns in properties.
- Google Calendar: OAuth. events.watch push + events.list incremental sync via syncToken
  stored in sync_state (gap-free). Same channel-renewal caveat as Drive.

CONNECT-AN-APP UX (mirror Zapier exactly, keep it dead simple):
1. Integrations gallery: cards per app, "Connect" button, connection status badge.
2. Connect: run OAuth or collect API key in a clean modal; on success, auto-register the
   webhook subscription and store the encrypted credential + signing secret.
3. **Preview latest records**: immediately call the connector's testFetchLatest(3) and show
   the 2–3 most recent REAL records in a clean table so the user sees live data landed. This
   is the trust-builder — same as Zapier's "test trigger / pull in samples".
4. Per-connection health page: last event received, last successful poll, error rate,
   webhook status, and a "re-sync / backfill now" button (triggers reconciliation).
5. Auto-renew scheduler for expiring Google channels; token refresh for OAuth connectors.

HARD REQUIREMENTS:
- Each connector is a self-contained module implementing the Connector interface from Prompt 1.
- Signature verification is mandatory and tested (valid + tampered payloads) per source.
- OAuth token refresh + failure surfacing (a broken connection is loudly visible, never silent).
- Adding a new connector must be additive: no changes to the core pipeline.
- Tests per connector: signature verify, normalize mapping fidelity, poll cursor advance,
  testFetchLatest against a recorded fixture.

DELIVERABLE: I can connect each app from the UI, watch its webhook auto-register, see the
2–3 latest real records previewed, and see events flowing into the unified events table with a
live health indicator per connection. Prove one instant (Calendly) and one poll-primary
(Google Sheets) end-to-end.
```

---

### ▐ PROMPT 3 — Data Unification, Metric Builder & Dashboard (the product & UX)

```
Building on the unified canonical events table fed by all connectors, build the product layer:
a Zapier-simple metric builder and a single live dashboard where a company sees every KPI
across all their tools in one place and finds bottlenecks. UX bar: a non-technical operator at
a large company must build a metric and read the dashboard with zero confusion. Simple, calm,
never chaotic.

METRIC BUILDER (Zapier-style, rules-based, no code):
1. Pick a source (or "All sources") and an event_type (booked, reply, sms_sent, call, …) —
   populated live from what has actually been ingested, with a preview of the latest 2–3
   matching events so the user always sees real data while building (like Zapier's sample).
2. Add filter rules (field = properties/subject/value; operators: equals, contains, >, <,
   between, in) combined with AND/OR groups.
3. Choose aggregation: count / sum(value) / count distinct(subject) / rate (A÷B across two
   event_types) / time-bucketed trend (day/week/month).
4. Name it, pick a display (number, trend line, bar, funnel) and unit; save. Metrics
   materialize via an Inngest function into metric_values incrementally (recompute on new
   matching events, not full scans).
5. Funnels: ordered stages across event_types (e.g. sms_sent → booked → showed) with
   per-stage counts and conversion %, so bottlenecks are obvious.

DASHBOARD (one screen, live):
- A clean grid of metric tiles + trends; org-level, auto-refreshing (or realtime).
- Filter the whole board by date range and by source.
- A "bottleneck view": funnel stages with the biggest drop-off surfaced first, and goal/KPI
  targets with progress vs target so a company instantly sees what is off-track.
- Drill-down: click any metric to see the underlying real events (with source + timestamp).
- Empty/onboarding states that guide a new user from zero connections to first metric.

UX PRINCIPLES (hold the line on these):
- Zapier-level simplicity: one obvious primary action per screen, plain language, generous
  spacing, no jargon. Every builder step shows live sample data so nothing feels abstract.
- Trust: always show data provenance (which source, when received) and connection health so
  numbers are believable to a billion-dollar company.
- Fast: dashboard reads from materialized metric_values, never recomputes on page load.

HARD REQUIREMENTS:
- Metrics compute only over the canonical events table (source-agnostic) — adding a new
  connector automatically makes its data available to the builder with no dashboard changes.
- Incremental materialization; correct results under duplicate/at-least-once delivery.
- All queries are org-scoped (tenant isolation enforced at the data layer).
- Tests: metric definition → correct value on a seeded event set; funnel conversion math;
  date-range + source filtering; tenant isolation.

DELIVERABLE: I can define a metric like "booked leads this week" and a funnel
"sms_sent → booked → showed" from real ingested data, see them live on the dashboard, filter
by date/source, and drill into the underlying events. Show me the full path from a connected
app to a number on the dashboard.
```

---

## 4. Build order, milestones & what I need from you

**Order (do not reorder):**
1. **Prompt 1** — prove the engine with the Catch Hook + a forced DLQ replay. *Milestone: an event survives signature-verify → dedup → normalize → store, and a failure is replayable.*
2. **Prompt 2** — one instant connector (Calendly) + one poll-primary connector (Google Sheets) fully working with live preview. *Milestone: real records from two real apps in the unified table with health indicators.* Then add Close, Instantly, Sendblue, Google Calendar.
3. **Prompt 3** — metric builder + dashboard on top. *Milestone: a real KPI and a funnel live on one screen, drill-down to real events.*

**Decisions to confirm before/while building (defaults chosen so you're not blocked):**
- **Sendblue vs Brevo** — I assumed Sendblue.co (iMessage/SMS). Confirm.
- **Auth:** WorkOS AuthKit (chosen) — organizations as the workspace/tenant model.
- **Durable layer:** Inngest (recommended) vs Upstash QStash + Vercel Cron.
- **v1 connector set:** the six above + Catch Hook — confirm nothing critical is missing.

**Why this will hold up in production:**
- It copies Zapier's exact two-model design (instant webhook + polling fallback) instead of trusting webhooks alone.
- Reconciliation polling means a missed webhook is *always* caught on the next sweep — the source of "never breaks."
- Immutable raw store + DLQ + replay means no data is ever lost and any failure is recoverable.
- One canonical event model means every new integration is additive and the dashboard never needs rework.
