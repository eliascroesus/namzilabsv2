# Namzilabs

Unify your tools' data into one reliable interface. A Zapier-grade data-tracking
SaaS: connect many external apps, ingest their data live and reliably, normalize
everything into one canonical event model, then build custom metrics and watch
them on one dashboard.

> **Status — Phases 1–3 complete.** The source-agnostic ingestion engine
> (Phase 1), the integrations layer (Phase 2: six connectors + the Zapier-style
> connect → preview UX), and the no-code metric builder + live dashboard
> (Phase 3) are built and verified. See
> [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the full three-phase spec.

## Metrics & dashboard (Phase 3)

A no-code builder over the canonical `events` table (`src/lib/metrics/`):

- **Aggregate metrics** — `count` / `sum(value)` / `count distinct`, optional
  filter rules (columns or `properties.*`, AND/OR), and time-bucketed **trends**.
- **Funnels** — ordered stages counting distinct subjects, with per-stage
  conversion and the **biggest drop-off (bottleneck)** flagged.
- **Builder UX** — `/dashboard/metrics/new` and `/dashboard/funnels/new` show a
  **live preview** (value + latest matching records) from your real data before saving.
- **Dashboard** (`/dashboard`) — metric tiles, trend bars, funnel views, **goal
  vs. target** bars, a date-range + source filter across the board, and
  **drill-down** to the underlying real events.

Metrics compute **on-read** over the org-scoped, indexed `events` table (correct
and simple); incremental materialization into a `metric_values` table is the
next scale optimization. Every query is tenant-isolated.

## Integrations (Phase 2)

Connectors live in `src/connectors/`, each implementing the `Connector` contract
(`verifySignature` + `normalize` for the instant path; `poll` / `testFetchLatest`
for backfill and preview). Adding one is additive — the engine never changes.

| Source | Instant (webhook) | Signature | Poll / backfill | Auto-registers webhook |
|---|---|---|---|---|
| **Calendly** | ✔ invitee.*/no-show | HMAC `t=,v1=` over `t.body` | ✔ scheduled events | ✔ (subscription API) |
| **Close** | ✔ event log | HMAC `close-sig-hash` over `ts+body` | ✔ event log | ✔ (webhook API) |
| **Instantly** | ✔ email/reply events | optional HMAC `x-instantly-signature` | — | manual URL + secret |
| **Google Sheets** | (Apps Script push, optional) | HMAC | ✔ **poll-primary**, row cursor | n/a (OAuth) |
| **Google Calendar** | — | — | ✔ incremental `syncToken` | n/a (OAuth) |
| **Whop** | ✔ Standard Webhooks | `webhook-signature` v1 over `id.ts.body`, five-minute window | ✔ payments by `updated_after`, memberships by `created_after`, first sync 90 days | manual URL + your own signing secret |
| **Custom Webhook** | ✔ any app | optional HMAC | — | manual URL + secret |

**Connect UX:** `/integrations` (gallery) → connect via API key or Google OAuth →
webhook auto-registers where supported → `/connections/[id]` shows health, the
inbound URL + signing secret, a **"Preview latest records"** pull, **Re-sync now**
(fires reconciliation), and Disconnect. All connection data is org-scoped.

### Connect an assistant

An MCP server (`/api/mcp`, behind `MCP_ENABLED`) lets Claude or ChatGPT read a
workspace's dashboard directly — list its metrics, pull one metric for a range
or a single day, and list the connected data sources with their sync state.
Settings → **AI assistants** shows the connection URL and every connected
assistant — an admin sees every member's assistant there, a member sees only
their own.

- **Claude:** Customize → Connectors → Add custom connector → paste the URL.
- **ChatGPT:** Settings → Apps → Advanced → Developer mode → Create → paste
  the URL.

An assistant sees exactly what the connecting person's role can see — the
metrics their role can view, and data sources if their role can view
integrations — and never a credential: every tool projects an explicit column
list, so an encrypted secret is never in scope to leak. No tool writes
workspace data; `select_workspace` records the assistant's own choice of
workspace, and every call is audited. Removing someone from the workspace cuts
off their assistant within a minute.

## Stack

- **Next.js 16** (App Router, TypeScript) on **Vercel**
- **Neon Postgres** via **Drizzle ORM** (migrations in `drizzle/`)
- **Inngest** for durable execution — retries with exponential backoff, cron,
  step memoization, dead-letter handling (the reliability backbone)
- **WorkOS AuthKit** for auth + organizations (the tenant/workspace model)
- **AES-256-GCM** encryption for all stored third-party credentials/secrets
- **Vitest + PGlite** (real in-process Postgres) for the test suite

## The reliability model (why it doesn't lose data)

Every inbound event flows through a 7-layer pipeline, mirroring how Zapier and the
major providers actually behave:

1. **Verify signature** — HMAC-SHA256, constant-time compare (`src/lib/signatures.ts`)
2. **Fast-ack** — persist the raw payload to the immutable `raw_events` table and
   return `202` immediately (`src/app/api/webhooks/[connectionId]/route.ts`)
3. **Enqueue** — hand off to Inngest (`ingest/raw.received`)
4. **Idempotent processing** — dedup on a stable `eventId` via `ON CONFLICT DO
   NOTHING`, so at-least-once delivery collapses to exactly-once (`src/ingestion/pipeline.ts`)
5. **Retries w/ exponential backoff** — Inngest, `retries: 5` (`src/inngest/functions/process-event.ts`)
6. **Dead-letter queue** — exhausted events land in `dead_letter`, never dropped,
   and are replayable: each connection's page lists its unresolved rows with a
   Replay button (`/connections/[id]`), and `/api/replay` is the same code
   path for API callers
7. **Reconciliation / backfill** — a 10-minute cron re-polls each connection and
   dedups, catching anything a webhook missed (`src/ingestion/reconcile.ts`)

Both trigger models Zapier uses are supported: **instant** (webhook) and
**polling** (reconciliation). Every connector implements both where the source
API allows.

## Project layout

```
src/
  db/           schema (canonical `events` + raw + DLQ + sync state), client, migrate
  lib/          crypto, ids, signatures, http, auth (WorkOS), credentials,
                oauth-state, connections, google-oauth, metrics/ (types, compute, store)
  connectors/   Connector interface + 6 connectors + catch-hook + catalog + registry
  ingestion/    raw-store, pipeline (dedup/DLQ/replay), reconcile
  inngest/      durable functions: process-event, reconcile
  components/   app header, organization switcher, funnel view
  proxy.ts      Next.js 16 proxy: WorkOS AuthKit + route protection
  app/          marketing (/ , /terms, /privacy), auth (/callback, /onboarding),
                integrations gallery, connection detail, dashboard + metric/funnel
                builders + drill-down, API routes (webhooks, inngest, replay,
                health, google oauth)
drizzle/        generated SQL migrations
tests/          178 files / 2,434 tests: crypto, ids, signatures, dedup, DLQ+replay,
                reconciliation (incl. credential decrypt), tenant isolation,
                per-connector signature/normalize/poll, oauth-state, metric
                compute + funnels
```

## Auth & tenancy (WorkOS AuthKit)

- **Organizations are the tenant/workspace model.** Every domain row carries an
  `orgId`, and `orgId` is derived **only** from the authenticated WorkOS session
  (`src/lib/auth.ts`) — never from the browser. Every user-facing query is
  org-scoped; a cross-tenant replay is refused and covered by a test.
- **Route protection** lives in `src/proxy.ts`: `/dashboard`, `/onboarding` and
  protected `/api/*` routes require a session; the machine endpoints
  (`/api/webhooks`, `/api/inngest`, `/api/health`) and the marketing/legal pages
  are public.
- **Flows:** sign-in / sign-up (hosted AuthKit), sign-out, organization creation
  (`/onboarding`), and organization switching (header switcher) — all via the
  WorkOS SDK (`getWorkOS()`) and `switchToOrganization`.
- Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+ chars),
  and `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (→ `/callback`). See `.env.example`.

## Getting started

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL + ENCRYPTION_KEY at minimum
pnpm db:generate              # (already generated; regenerate after schema edits)
# Migrations are applied BY HAND: paste the blocks from drizzle/HAND_APPLY.md
# into the Neon SQL Editor, then verify with the Schema drift check Action.
# There is deliberately NO migrator script — the drizzle tracker has never
# matched this database, so a migrator run would replay migrations the
# database already has (tests/db-migrate-guard.test.ts pins its absence).
pnpm dev                      # Next.js
pnpm inngest:dev              # Inngest dev server (separate terminal)
```

Generate an encryption key: `openssl rand -base64 32`.

## Verify it works

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # 2,434 tests against a real Postgres (PGlite) — proves dedup,
                 # idempotency, DLQ + replay, reconciliation, signatures, crypto
pnpm build       # production build
```

To exercise the live path end-to-end: create a `webhook`-source connection,
then POST JSON to `/api/webhooks/<connectionId>`. With a signing secret set,
sign the body with `X-Namzilabs-Signature: sha256=<hex hmac>`. The event appears,
deduped, in the canonical `events` table (visible at `/dashboard`). Replaying the
same payload is a no-op; a forced failure lands in the DLQ and is replayable via
`/api/replay`.

## Deploy (Vercel + Neon + Inngest)

1. Create a Neon project; set `DATABASE_URL` (**pooled**, host has `-pooler`) and
   `DATABASE_MIGRATION_URL` (**direct**, no `-pooler`) in Vercel env.
2. Set `ENCRYPTION_KEY`, `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` / `WORKOS_COOKIE_PASSWORD` /
   `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and
   (for prod) `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`. In the WorkOS dashboard, set the
   redirect URI to `https://<domain>/callback` and the post-sign-out redirect to your home URL.
3. Apply migrations by pasting the blocks from `drizzle/HAND_APPLY.md` into the
   Neon SQL Editor, then verify with the Schema drift check Action (or
   `scripts/schema-audit.sql`). There is no migrator script, deliberately — see HAND_APPLY.md.
4. Register the Inngest app pointing at `https://<domain>/api/inngest`. The
   reconciliation cron is scheduled by Inngest — no Vercel Cron needed.
5. Run `docs/SMOKE_TEST.md` against the deploy.

## Visual flow builder (in progress)

Replacing the form-based metric/funnel builders with a drag-and-drop node canvas
(App → Filter → Aggregate → Output, plus advanced nodes). Delivered in milestones —
see `.claude/plans/` and the code under `src/lib/flow/`.

- **M1 (done):** `flows` / `flow_versions` / `flow_results` tables; the flow graph
  types + **validation** (`src/lib/flow/validate.ts`); the execution **engine**
  (`src/lib/flow/engine.ts`) for the core App/Filter/Aggregate/Output nodes over
  synced `events`; **draft vs immutable published version** store
  (`src/lib/flow/store.ts`); a **materializer** (`src/lib/flow/materialize.ts` +
  Inngest) that stores each Output's latest result in `flow_results`; and the
  dashboard rendering those **stored** results (fast — no live recompute) alongside
  existing metric tiles. Editing a draft never changes the live dashboard until
  republish.
- **M2 (done):** the React Flow canvas at `/dashboard/flows` — a **managed
  top-to-bottom layout** (steps are numbered and placed for you; nodes are
  deliberately NOT draggable and ports are NOT hand-connectable — the flow is a
  numbered list that happens to be drawn), scroll-to-pan and pinch-to-zoom, the
  step cards, a config panel (Configure / Test), **per-node live testing on real
  synced data** (records-in/out + samples), a **variable picker** (fields from
  previous steps), autosave-to-draft, undo/redo, **Test flow** (runs every step
  top to bottom), and **Publish** (validates → snapshots an immutable version →
  materializes tiles). "New flow" is the only advertised way to build a metric;
  the classic form builder's routes still open existing metrics but are no longer
  linked from the dashboard.
- **M3 (done, since simplified):** advanced nodes with engine executors, config
  UI, and tests — **Calculate** (one unified step: dataset aggregations
  count/count-unique/sum/avg/min/max with an optional time split, OR two-number
  comparisons add/subtract/multiply/divide/percentage/percent-change/ratio, with
  divide-by-zero errors), **Unite** (join lanes back into one line), and
  **Paths** (conditional branches with per-branch entry modes + fallback).
  Validation enforces per-node input shapes across all node types.
- **Simplifications (post-M3):** the Combine node is gone — **de-duplication is
  a checkbox on the Get data step** (field-matched, newest copy wins, applied
  before anything else runs); the Clean-up-values node is gone — **date-looking
  values are detected and canonicalized automatically** at ingest and on read
  (`src/lib/normalize-dates.ts`), so every date speaks ISO and the Review &
  publish **time-reference picker lists only date fields**; the Count node is
  merged into Calculate. Stored graphs from before migrate losslessly on load
  (`parseGraph`): Count → Calculate, Combine/Clean-up → pass-through Filters.
- **UX pass (done):** see [`docs/UX_AUDIT.md`](docs/UX_AUDIT.md) for the full
  findings, every defect and its status. Landed: Flows in the header nav; one
  advertised builder; a real empty-canvas first-run whose only first step is Get
  data; a distinguishable blocking-vs-non-blocking step status; auto-test on
  Continue; **Test flow** (every step, top to bottom); a cancellable test with
  elapsed time; an undo notice on delete; **the step picker split from a list of
  node types into a list of jobs** (Summarise records / Compare two numbers,
  Combine data / Match against a list — one engine node, two doors each,
  display-layer only); the time period promoted to the top of Filter; a
  plain-English summary of its own config on every step; **selection-scoped
  reference edges** so a Compare step's inputs are visible; a **"goes to your
  dashboard"** badge on the steps that publish; zoom/fit controls; Review &
  publish behind progressive disclosure; and a responsive panel + field browser.
  **No starter templates** — the product ships none by design.
- **Next:** M4 sync system (historical backfill, live/importing/outdated statuses,
  versioned/safe full re-sync, Reprocess).

## Other follow-ups

- **Live webhook round-trips:** connector poll/webhook logic is unit-tested
  against each provider's documented payloads; exercising the real OAuth/webhook
  flows needs live provider credentials (see `.env.example` and `docs/SMOKE_TEST.md`).
