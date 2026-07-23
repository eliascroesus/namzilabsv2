# Data model — how namzilabs keeps stored data 1:1 with every source

This is the contract the whole product stands on: **after any completed sync
pass, the live rows of a synced resource are exactly what the source holds
right now.** Dashboards, flows and (later) AI analysis all read the same
canonical `events` table, so accuracy is enforced once, at the storage layer —
not per feature.

## Two kinds of data, two sync strategies

Warehouse practice (Fivetran, Airbyte, Kimball modeling) distinguishes exactly
two shapes of data, and each gets its own sync strategy — declared per
connector as `Connector.syncStrategy`:

| Kind | What it is | Strategy | How it syncs |
|---|---|---|---|
| **Mutable state** | Things that *exist and change*: a sheet row, a booking | `mirror` | Re-read the ENTIRE resource every pass; refresh every row in place; soft-delete rows the source no longer has |
| **Immutable events** | Things that *happened*: an email sent, a lead created | `incremental` | Walk a cursor/change feed; append new records; re-seen records refresh in place |

Per connector:

| Source | Strategy | Notes |
|---|---|---|
| `gsheets` | mirror | Sheets have no changelog API — every sweep is a full tab read (one API call; the Fivetran model). Positional row ids; blank rows skipped without renumbering; `preserveOccurredAt`. |
| `calendly` | mirror | Bookings are edited in place (reschedules). Rolling ±400-day meeting-time window; `inMirrorScope` protects out-of-window rows. |
| `gcal` | incremental | Google's own change feed (`nextSyncToken`): updates and cancellations arrive as deltas. Pagination followed to the end; a 410 resets for a full relist. |
| `close`, `instantly`, `sendblue`, `webhook` | incremental | Append + refresh-on-conflict. |

## The single writer: `upsertEvents`

Every path that writes canonical events — webhook delivery, cursor walks,
mirror passes, full re-syncs — funnels through **one** batched
`INSERT … ON CONFLICT (event_id) DO UPDATE` (`src/ingestion/pipeline.ts`):

- **Updatable on conflict:** `eventType`, `subject`, `value`, `currency`,
  `properties`, `streamHash`, `occurredAt` (unless the connector sets
  `preserveOccurredAt`), `deletedAt := null` (**re-seen ⇒ alive**), and
  `syncGeneration := GREATEST(stored, incoming)` (a gen-0 webhook redelivery
  can never downgrade a poll-managed row).
- **Insert-only (provenance, never churned):** `id`, `receivedAt`,
  `rawEventId`, `orgId`, `connectionId`, `source`.
- **Source-reported deletions** (`CanonicalEvent.deleted`, e.g. a Calendar
  cancellation skeleton): a *narrow* update — only `deletedAt` + generation.
  The skeleton payload never clobbers the stored record; a never-seen deletion
  inserts as an invisible tombstone.
- Batched 500 rows per statement; intra-batch duplicate ids collapse
  (last wins); insert-vs-update counted via `xmax = 0`.

Date-looking property values are canonicalized at ingest
(`normalizeDatesDeep`) so every stored event speaks one date format;
`raw_events` keeps the original payload byte-for-byte.

## Mirror passes and generations

A mirror pass (`mirrorStream`, `src/lib/sync/streams.ts`) delivers the 1:1
invariant per **stream** (a stream = one configured resource: one spreadsheet
tab, one calendar, one Calendly scope — keyed by `configHash`):

1. `gen = stream.syncGeneration + 1`
2. Full poll from a null cursor, following pagination (`pollAll`).
3. Upsert everything read at `gen` — edits refresh, returned rows resurrect.
4. **Only if the scan was complete:** soft-delete the stream's live rows still
   below `gen`, filtered through `connector.inMirrorScope`. Then bump the
   stream's generation.

Safety rails, in priority order:

- **A partial scan never deletes and never bumps.** Page budgets (inline Test
  refreshes) refresh what they read at the *current* generation; deletion
  requires a complete scan — an incomplete read proves nothing about what is
  gone.
- **`inMirrorScope` protects the unseen.** A bounded rescan window (Calendly
  ±400d) cannot see an old meeting; rows outside the window — or whose
  `start_time` cannot even be parsed — are never delete candidates.
- **Webhook rows are untouchable.** Stream-scoped deletion filters on
  `streamHash`, and webhook/instant rows never carry one. For
  connection-scoped sources (Close), webhook rows live at generation 0 and the
  full-re-sync delete keeps a `generation >= 1` floor.
- **Soft-delete only.** `deletedAt` hides a row from flows; nothing is ever
  hard-deleted, and a row that reappears upstream comes back alive with its
  history (`receivedAt`, first-seen `occurredAt`) intact.
- **Self-healing back-compat:** within a stream's scope there is deliberately
  *no* generation floor, so rows from the legacy append-only sync (stale
  tails, phantom blank-row events) are cleaned up by the first complete pass.

## Freshness model

- **Every 10 minutes** (`reconcile-connections` cron): `sweepConnection` per
  active connection — mirror streams full-refresh, incremental streams walk
  their cursors, each stream isolated by its own try/catch and error status.
  If anything changed, dependent published flows are marked stale and stale
  dashboard tiles are recomputed in the same cycle — a sheet edit reaches the
  dashboard with no user action.
- **On explicit user action** (Test this step, opening a field picker):
  `ensureFreshStream` — registers the stream on first use and re-syncs inline
  when the last poll is older than 60s (a sheet = exactly one API call; an
  over-budget scan refreshes without deleting). A user who edits their sheet
  and hits Test sees the current sheet.
- **Webhooks** land instantly through the same upsert (raw payload stored
  first, normalization re-runnable via `reprocessConnection`).

## Identity

`eventId` is the global dedup key:

- Sheets: `gsheets:{connectionId}:{streamHash}:row:{n}` — positional. Set-level
  1:1 is what metrics consume; content-hash ids would collapse genuinely
  duplicated rows and break it. Sorts/deletes shuffle positions, and the mirror
  pass converges the SET to the sheet every sweep.
- Calendly: the scheduled-event URI (stream-tagged) — a reschedule refreshes
  the same row; a cancellation also emits its own `canceled` event row.
- Calendar: Google's event id (stream-tagged).
- Webhook sources: the provider's natural id.

## Scaling notes (300k+ users)

- Streams are independent units of work — per-stream cursors, generations and
  errors — so syncs fan out horizontally and one broken resource never blocks
  a tenant's others.
- All writes are batched multi-row upserts (500/statement); mirror deletion is
  chunked `IN` updates. A 10k-row sheet is one API call + ~20 statements.
- `events` is indexed by `(orgId, occurredAt)` and `eventId` unique; flows read
  through `APP_LOAD_CAP` with per-stream scoping.
- Future headroom (documented, not yet needed): Drive `modifiedTime` pre-check
  to skip unchanged sheets, per-stream Inngest fan-out, provider-quota jitter.

## The acceptance test

`tests/mirror-sheets.test.ts` drives a **living spreadsheet** (edited, sorted,
pruned, blanked between sweeps) through the real production sweep path and
asserts stored live rows ≡ the sheet after every pass — including the exact
user-reported scenarios that motivated this architecture (a `booked` cell
flipped below the old cursor's high-water mark; `utm_source = ig AND booked
not empty` = 2). Companion suites: `mirror-calendly` (reschedules, windows),
`gcal-sync` (pagination, tokens, tombstones), `upsert-unified` (field matrix),
`reconcile` (dispatch, isolation, partial-scan safety).
