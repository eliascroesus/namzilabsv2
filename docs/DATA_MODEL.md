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
| **derived-mirror** | Numbers **computed by the provider**, re-read on a schedule and refreshed in place. Faithful to what the provider reports — including restatements of recent periods, which are normal, not edits. Reads declare a `mirrorScope` (the span they enumerate completely), so a row that disappears from inside the window is retired while history behind it is untouched. | Instantly (campaign analytics) |
| **incremental** | Cursor-forward polling with an overlap window; nothing is stranded (windows are drained to their end, deeper windows resume next sweep). Edits older than the overlap surface on a full re-sync. | Close (5-min overlap, continuation cursor), Google Calendar (sync token, ±window bound on first sync), Calendly, Sendblue (30-day first-sweep bound), Instantly raw-emails streams |
| **webhook-only** | No list endpoint to reconcile against: data is as complete as the webhooks that arrived. Weakest class; the connection UI must say so. | Custom webhook |

### What `derived-mirror` does NOT promise

The other classes mirror *records we hold*. This one mirrors *the provider's
answer*, which differs in four ways worth stating plainly:

1. **We cannot verify it.** There is no local recount that confirms
   "sent = 412" — we are repeating what the provider said.
2. **Restatement is expected.** Today's row legitimately changes as the day
   progresses. In a record mirror, a changed row means someone edited the
   source; here it means nothing at all.
3. **Identity is synthetic** — `(campaign, date)`, not a provider record id.
4. **Their definitions govern.** A provider's "sent" need not equal a count of
   our `email_sent` events. **A flow that mixes provider totals with raw
   records can double-count**; prefer one or the other per number.

### Instantly: stated assumptions

Two things were decided conservatively rather than verified, because being
wrong in the cheap direction would have been silent:

- **One analytics call per campaign.** We do not know whether the daily
  endpoint accepts several campaign ids at once. Asking per-campaign is correct
  either way; batching would only be cheaper. The connector logs
  `[instantly-probe]` lines recording what the response actually contains, so
  this can be settled from production logs rather than another guess — and it
  warns loudly if rows come back for campaigns we did not ask for, which would
  mean the filter is being ignored.
- **Analytics shares the emails-list budget (20/min).** That is the only
  published figure we have. Each endpoint now has its own enforced bucket, so
  raising any one of them later is a one-line change.

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
- **One-time reconciliation — BUILT, awaiting its production run.** For stream-scoped connections,
  it retires (soft-deletes) rows with `sync_generation >= 1 AND stream_hash IS NULL`; generation-0
  stream rows are handled structurally by the scoped sweep (which keys on `stream_hash`, not
  generation), so they need no separate pass. Implementation:
  `src/lib/sync/legacy-reconciliation.ts` + `scripts/reconcile-legacy-rows.ts` (inspect by
  default, `--apply` to write; batched and idempotent, so an interrupted run is safely
  re-runnable). Connection-scoped connections are never touched — there a null `stream_hash` is
  correct for every row. **Ordering:** PRE_LAUNCH_CHECKLIST.md item 5 — run after the production
  deploy and BEFORE any fleet backfill or `reprocessConnection` replay.

## The compute engines (P5 build track)

Two engines exist, deliberately, with a one-way door between them.

**The JS flow engine** (`src/lib/flow/engine.ts`) is the source of truth and the
ORACLE. Every operator's meaning is defined by `evalRule`, not by a spec.

**The compiled path** (`src/lib/flow/compile/*`) pushes a Get-data step's
downstream filter chain into SQL. It is opt-in per flow (`EngineCtx.compile`)
and gated absolutely: `tests/engine-parity.test.ts` runs both implementations
over the same rows and they must agree exactly. Nothing flips without that.

What is compiled, and what deliberately is not:

| | |
|---|---|
| **Compiled (14 ops)** | equals, not_equals, contains, not_contains, starts_with, ends_with, gt, lt, gte, lte, is_empty, is_not_empty, is_one_of, is_not_one_of |
| **Never compiled (3 ops)** | before, after, between — `Date.parse` accepts grammars SQL cannot reproduce (`"42"` is the year 2042, `"100"` is the year 100). A flow using them stays on the JS engine. |
| **Not folded** | filters after a fan-out, filters with more than one input, rules whose right side is an unresolved upstream field. |

Two properties make this safe rather than clever:

- **The pushdown cannot change an answer.** Folded filters STILL run in JS
  afterwards; the SQL predicate only reduces what is loaded. A compiler bug can
  cost work, never correctness.
- **Truncation is visible.** `APP_LOAD_CAP = 20_000` — which silently dropped
  every row past the newest 20k and produced confidently wrong numbers — is
  gone. A very high safety ceiling remains, and crossing it marks the node
  `truncated`, surfaced rather than swallowed.

**Ordering (E.3):** reads are `(occurred_at DESC, id DESC)` — a total order, so
"the newest duplicate" and any ceiling are deterministic rather than arbitrary.

**Incremental computation policy (E.6):** full recompute is the default and the
only path currently enabled. Deltas are permitted ONLY for additive aggregates
(count, sum) over append-only data, and are forbidden for count-distinct,
dedupe, min/max, and any mirror source — where a soft-delete or in-place edit
makes an increment wrong. Any delta path must be verified against a periodic
full recompute before it is trusted.

**Provenance (E.5):** a compiled run records, per Get-data node, which filter
nodes were folded and how many rows were loaded (`EngineCtx.provenance`).

## Field registry and identity (A.1 / A.2)

- `stream_fields` is maintained by the WRITER: one row per (connection, stream,
  field path) with an inferred type, an approximate cardinality and an
  occurrence count. Field pickers read an index instead of scanning a sample,
  and the answer covers everything ever seen. Cardinality is a MAX across
  batches (repeated mirror sweeps must not inflate it) while counts accumulate.
- `events.identifiers` holds normalized handles harvested at write time —
  emails lowercased, phones E.164 — sorted and deduplicated so an unchanged
  record stays byte-identical to the writer's change detection. This is
  format normalization only: deciding two handles are the same person is a
  separate, later decision that will not need a schema change or a re-ingest.
- **E.7 dedupe guardrail:** `dedupeWarningFor` uses the registry's cardinality
  to catch a "match duplicates by" key that would collapse most of the dataset
  — the failure mode that produces a plausible-looking wrong number.
