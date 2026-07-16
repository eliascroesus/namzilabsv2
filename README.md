# Namzilabs

Unify your tools' data into one reliable interface. A Zapier-grade data-tracking
SaaS: connect many external apps, ingest their data live and reliably, normalize
everything into one canonical event model, then build custom metrics and watch
them on one dashboard.

> **Status — Phase 1 (Reliability Core) complete.** The source-agnostic
> ingestion engine is built and verified. Integrations (Phase 2) and the metric
> builder + dashboard (Phase 3) plug into it without touching the core. See
> [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the full three-phase spec.

## Stack

- **Next.js 16** (App Router, TypeScript) on **Vercel**
- **Neon Postgres** via **Drizzle ORM** (migrations in `drizzle/`)
- **Inngest** for durable execution — retries with exponential backoff, cron,
  step memoization, dead-letter handling (the reliability backbone)
- **Clerk** for auth + organizations (bypassed automatically when keys are unset)
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
   and are replayable (`/api/replay`)
7. **Reconciliation / backfill** — a 10-minute cron re-polls each connection and
   dedups, catching anything a webhook missed (`src/ingestion/reconcile.ts`)

Both trigger models Zapier uses are supported: **instant** (webhook) and
**polling** (reconciliation). Every connector implements both where the source
API allows.

## Project layout

```
src/
  db/           schema (canonical `events` + raw + DLQ + sync state), client, migrate
  lib/          crypto (AES-256-GCM), stable ids, HMAC signatures, http
  connectors/   Connector interface + generic Catch-Hook + registry
  ingestion/    raw-store, pipeline (dedup/DLQ/replay), reconcile
  inngest/      durable functions: process-event, reconcile
  app/          API routes (webhooks, inngest, replay, health) + admin observability
drizzle/        generated SQL migrations
tests/          27 tests: crypto, ids, signatures, dedup, DLQ+replay, reconciliation
```

## Getting started

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL + ENCRYPTION_KEY at minimum
pnpm db:generate              # (already generated; regenerate after schema edits)
pnpm db:migrate               # apply migrations to your Neon database
pnpm dev                      # Next.js
pnpm inngest:dev              # Inngest dev server (separate terminal)
```

Generate an encryption key: `openssl rand -base64 32`.

## Verify it works

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # 27 tests against a real Postgres (PGlite) — proves dedup,
                 # idempotency, DLQ + replay, reconciliation, signatures, crypto
pnpm build       # production build
```

To exercise the live path end-to-end: create a `webhook`-source connection,
then POST JSON to `/api/webhooks/<connectionId>`. With a signing secret set,
sign the body with `X-Namzilabs-Signature: sha256=<hex hmac>`. The event appears,
deduped, in the canonical `events` table (visible at `/admin`). Replaying the
same payload is a no-op; a forced failure lands in the DLQ and is replayable via
`/api/replay`.

## Deploy (Vercel + Neon + Inngest)

1. Create a Neon project; set `DATABASE_URL` (pooled) in Vercel env.
2. Set `ENCRYPTION_KEY`, and (for prod) `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`,
   Clerk keys, `INTERNAL_API_SECRET`.
3. Run `pnpm db:migrate` against Neon (locally or as a deploy step).
4. Register the Inngest app pointing at `https://<domain>/api/inngest`. The
   reconciliation cron is scheduled by Inngest — no Vercel Cron needed.

## What's next (from `docs/BUILD_PLAN.md`)

- **Phase 2 — Integrations:** Calendly, Close, Instantly, Sendblue, Google
  Sheets/Calendar connectors + the Zapier-style connect → preview-latest UX.
  Each is an additive `Connector` module; the core doesn't change.
- **Phase 3 — Product:** metric builder + live dashboard over the canonical events.
