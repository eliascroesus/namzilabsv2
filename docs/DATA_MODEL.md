# Data model & sync semantics

The product promise is **accurate numbers that match the source, always**. This document is the
contract that keeps that true: how data enters, how it is stored, what each connector guarantees,
and the exact rules of the single writer. Tests pin every rule stated here
(`tests/upsert-unified.test.ts`, `tests/acceptance-living-sheet.test.ts`, `tests/sync-resync.test.ts`,
`tests/resync-stream-scope.test.ts`).

## The shape of the system

```
provider ──webhook──▶ raw_events (immutable) ──normalize──▶ ┐
                                                            ├──▶ upsertEvents ──▶ events ──▶ flows / metrics
provider ──poll (sweep, re-sync, Test)──▶ connector.poll ──▶ ┘
```

- **`raw_events` is sacred.** Every inbound webhook body is stored verbatim before any processing.
  Normalization can always be re-run from it (`reprocessConnection`); nothing upstream is ever lost.
- **`events` is the single canonical table** every dashboard number is computed from. One row per
  real-world record, deduplicated globally by `event_id` (namespaced `source:connection[:stream]:natural-id`).
- **Streams** (`source_streams`) are the unit of sync for connectors whose resource is chosen per
  flow (which spreadsheet + tab, which calendar). Events of a stream carry its `stream_hash`.
  Webhook/instant rows carry `stream_hash = NULL`.

## The single writer: `upsertEvents`

Every write into `events` goes through `upsertEvents` (`src/ingestion/pipeline.ts`) — the webhook
pipeline, the 10-minute sweep, full re-syncs, backfills and the user's explicit Test all share it.
It is a chunked multi-row upsert (~500 rows/statement) with guarded conflict semantics:

| Situation (conflict on `event_id`) | Outcome |
|---|---|
| Incoming generation **<** stored generation (late/stale page) | **No-op.** Cannot resurrect a tombstone, downgrade the generation, or overwrite newer data. |
| Incoming generation **≥** stored, content identical | **No-op** (`deduped`). Idempotent redelivery; no staleness, no recompute. |
| Incoming generation **≥** stored, content differs | **Update in place**, `deleted_at` cleared (the record verifiably exists upstream), generation ratchets via `GREATEST`. |
| New `event_id` | **Insert** at the write's generation. |

Field rules on update:
- `occurred_at` follows the source **unless** the write sets `preserveOccurredAt` — then the
  first-seen time is pinned. Used by (a) mirror sources, whose read-time timestamps are synthetic,
  and (b) the webhook pipeline, so redelivery of a payload with no timestamp can't drift the time.
  Consequence: reprocessing raw events never shifts `occurred_at` of existing rows.
- `raw_event_id` keeps its first value (provenance of the original ingest).
- `properties` are date-normalized (`normalizeDatesDeep`) before compare/write, so byte-noise in
  date formats never counts as a change.

The writer reports precise counts — `inserted / updated / deduped` — and **staleness is driven by
`inserted + updated + softDeleted > 0`**: an edit-only or delete-only sweep refreshes dashboards,
an unchanged sweep costs no recompute.

## The generation model

`events.sync_generation` classifies who owns a row's lifecycle:

- **Generation 0 — append-only.** Webhook/instant rows. **Never** touched by any sweep's
  soft-delete; a full re-sync cannot retire them. Conflicting poll writes at generation ≥ 1 may
  refresh their content (the poll saw the same record), but nothing deletes them except upstream
  tombstones delivered as data.
- **Generation ≥ 1 — poll-managed.** Rows written by sweeps/re-syncs at the connection's current
  generation. A **full re-sync** bumps the connection's generation to N, re-imports everything at
  N, and only then soft-deletes rows still at an older generation — **scoped to the streams it
  actually re-polled** (`resync.ts`), so a paused/disabled stream's rows survive other streams'
  re-syncs.
- Deletes are **soft-only** (`deleted_at`); every reader filters `deleted_at IS NULL`. Resurrection
  happens only through the guarded writer path above.
- **Query convention (load-bearing):** the composite indexes on `events` are PARTIAL over live rows
  (`WHERE deleted_at IS NULL`) and the non-partial fallbacks were dropped — a new query that omits
  the predicate is both semantically wrong (counts records the source deleted) and un-indexed
  (sequential scan at scale). Only `event_id` lookups (unique index) and deliberate tombstone
  inspection are exempt. See the convention note on the table in `src/db/schema.ts`.

## Guarantee classes per connector

Declared in `src/connectors/catalog.ts` (`sync` field; UI copy states the class):

| Class | Meaning | Connectors |
|---|---|---|
| **mirror** | Every sweep re-reads the ENTIRE resource, refreshes rows in place and soft-deletes rows no longer present. Stored live rows ≡ source after every sweep. Row identity = sheet row number (per stream); blank rows mirror as deleted; `occurred_at` = first-seen. | Google Sheets |
| **incremental** | Cursor-forward polling with an overlap window; nothing is stranded (windows are drained to their end, deeper windows resume next sweep). Edits older than the overlap surface on a full re-sync. | Close (5-min overlap, continuation cursor), Google Calendar (sync token, page-token drain), Calendly |
| **webhook-only** | No list endpoint to reconcile against: data is as complete as the webhooks that arrived. Weakest class; the connection UI must say so. | Instantly, Sendblue, custom webhook |

## Freshness rules

- The user's explicit **Test always forces a fresh read** of its streams (`primeStream` with
  `force: true`) — there is no staleness window on Test. Passive surfaces (field pickers) may skip
  within a small `maxAge` (60s) and re-poll after it.
- The 10-minute sweep (`reconcileAll`) emits `flow/data.changed` for any connection whose sweep
  **changed** data (insert, update or soft-delete), which marks dependent published flows stale for
  recompute. Webhooks and full re-syncs emit the same signal.

## Known legacy state (pre-unification)

Rows written before the unified writer:
- Stream-polled rows may sit at **generation 0** (the old stream writer never set a generation) and
  webhook-era poll rows may have **`stream_hash = NULL` with generation ≥ 1**. The scoped full-resync
  delete intentionally never touches null-hash rows, so those legacy rows can linger and are
  reachable via connection-wide reads (a Get data step with no resource selected; classic metrics).
- **One-time reconciliation (planned, before any fleet backfill):** for stream-scoped connections,
  retire (soft-delete) rows with `sync_generation >= 1 AND stream_hash IS NULL`, and let mirror
  sweeps re-key generation-0 stream rows — after which every poll-managed row carries its stream
  and a real generation. Tracked in the hardening plan; must land before `reprocessConnection`
  replays or registry backfills run at fleet scale.
