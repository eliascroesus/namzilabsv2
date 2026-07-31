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
  stored time is pinned. Used by (a) the webhook pipeline, so redelivery of a payload with no
  timestamp can't drift the time, and (b) mirror sources, which re-read the whole resource every
  sweep and must not shift the event time of a row they are merely restating.
  Consequence: reprocessing raw events never shifts `occurred_at` of existing rows.

  **This rule used to justify itself in a circle.** It read "mirror sources, whose read-time
  timestamps are synthetic" — but they were synthetic only because the connector had stamped
  `new Date()`, and the pin was what made that permanent. Sheets was the live case: a spreadsheet
  row has no timestamp of its own, so `occurred_at` became the import moment, the pin froze it,
  and every time-based metric over a sheet was measuring when the data was imported. The pin was
  never the bug — reading the wrong value was — but the pin is why the wrong value could not be
  corrected, including by a full re-sync, which still upserts on `event_id` with the pin in force.

  The fix is a real value plus one exit: `source_streams.date_field` names the column that holds
  a row's event time (or `date_field_locked = false` — the default — lets each read detect one),
  and `source_streams.restamp_requested_at` marks the single sweep that writes without the pin. `events.received_at` is the recoverable first-seen for rows with no usable date
  — it is in neither the insert list nor the conflict-update set, so nothing has ever moved it.
  See `src/lib/sync/streams.ts` (`restampRecords`) for the three cases.
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
| **mirror** | Every sweep re-reads the ENTIRE resource, refreshes rows in place and soft-deletes rows no longer present. Stored live rows ≡ source after every sweep. Row identity = sheet row number (per stream); blank rows mirror as deleted; `occurred_at` = the stream's date column — chosen or detected — else first-seen (see below). | Google Sheets |
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

### Sheets: which column is the event time

A spreadsheet row has no timestamp of its own, so the stream decides where one
comes from. **Detected by default**, because a sheet with an obvious date column
sitting on import time until somebody notices is broken by default — the same
defect one layer up from the one this feature exists to fix.

Three states, and `date_field` alone cannot express them, which is why
`date_field_locked` exists:

| `date_field` | `locked` | Meaning |
|---|---|---|
| NULL | false | Nobody has answered. Every read looks for a column. **The default.** |
| NULL | true | The user chose "use import time". Detection stays out of it. |
| `'X'` | true | The user chose `X`. |

**Detection is stored nowhere.** It is recomputed from the header row and the
values on every read, so `date_field` keeps exactly one meaning — the user's
answer — and the sweep never writes to a column the picker owns. What a read
actually used goes in `date_field_state`
(`{column, source, presentInHeader, dated, undated, candidates?, at}`), which
already means "what happened".

**Two gates, and the second is the one that matters.** A date-hinted NAME is not
evidence: "Start", "Closed" and "Notes on" all read as date-like, and a column
called "Closed" may hold yes/no. So a column qualifies only when a majority of
its non-empty sampled values actually parse. Name proposes, values decide
(`detectDateColumn`, `src/lib/normalize-dates.ts`).

**Several qualifying columns is not a tie to break.** A sheet with "Booked on"
and "Closed on" has two real answers and picking either is a coin toss the user
cannot see, so nothing is used and both names go into the question. That is the
only case where choosing is anybody's job.

**A detection announces itself** — *Dating rows from "Booked on" (detected)* —
because a guess nobody can see is not fixable. And a detection restamps existing
rows exactly like a pick does: a stream that gains one would otherwise date new
rows from the column while old rows kept their import time, disagreeing with
themselves inside the same number.

Four more things that are easy to get wrong:

- **It is not `TimeConfigSchema.dateField`, and the names are unrelated.** The
  flow-level one (`TimeConfigSchema`, `FilterDateRangeSchema`, default
  `"occurredAt"`) picks which field of an ALREADY-STORED record a Time or Filter
  step windows on — a per-flow reading choice with no ingest effect. The stream
  one decides what `occurred_at` IS, once, at write time, for every flow. Set
  both and they compose: the flow can window on `occurredAt` (now the sheet's
  date) or on some raw property instead.
- **A published tile has no such choice.** `src/lib/metrics/compute.ts` ranges
  and buckets on `events.occurred_at` and nothing else. So for a dashboard
  number, the stream's column IS the time axis — there is no second lever
  downstream to correct it with.
- **`normalize-dates.ts` is the single date parser.** `normalizeDateValue` reads
  the column, and the HEADER NAME is passed as the field name so its gate on
  purely-numeric values still applies: a column of epoch seconds parses when it
  is called "Created" and does not when it is called "Ref". Nominating a column
  says WHICH column holds the date, not that its values may be read more loosely
  than anywhere else.
- **A window-scoped retire judges on this axis.** `retireAbsent` with a
  `mirrorScope` only considers rows whose `occurred_at` falls inside the window
  (`streams.ts`). Sheets is unaffected — a whole-resource mirror declares no
  scope — but any future source that BOTH declares a `mirrorScope` and honours
  `dateField` would be retiring by a boundary the user chose, so the two must be
  designed together or the window silently stops meaning what it says.

### The custom webhook: which payload key is the event time

Same problem as a sheet row — arbitrary JSON, nothing guaranteed to say when the
thing happened — and `catch-hook.ts` answered it with seven fixed keys and a
fallback to DELIVERY time, pinned forever by `preserveOccurredAt`, with nothing
anywhere saying which of the two a connection was on.

**The state lives in `connections.config.eventTime`, not in a column.** That is
a checked fact: the field is jsonb, `NOT NULL`, defaulted `{}`, and has exactly
three writers — `createConnection` seeds it, the Google OAuth callback sets `{}`,
and one patch adds `externalId` by spreading. It is read only as
`PollArgs.config` and by `pollOperation`, and the `webhook` connector has
neither, so nothing consumes it for a catch-hook connection. It is never
rendered and never round-tripped through a form.

The whole design rests on every writer spreading, so
`tests/webhook-event-time.test.ts` pins it twice — once behaviourally and once
by scanning the source for a wholesale `set({ config: … })`. One such write
would drop the setting silently, and the only symptom would be a connection
quietly reverting to delivery time.

Shape: `{ key, locked, state, restampRequestedAt, restampedAt }` — the same four
concepts and the same words as `source_streams`' `date_field`,
`date_field_locked`, `date_field_state`, `restamp_requested_at`.

**Three tiers, not one list.** Webhook keys are conventional in a way sheet
column names are not, so ties are broken by meaning rather than handed to the
user:

| tier | keys | why |
|---|---|---|
| event | `occurred_at`, `timestamp`, `time`, `date`, `event_date`, `booked_on` | when the thing happened |
| creation | `created_at`, `date_created` | when the record was made — a good proxy |
| mutation | `updated_at`, `modified_at` | when the record last changed — a bad proxy |

A lower tier never beats a higher one. A mutation key IS returned when it is the
only candidate — refusing it would strand such a payload on delivery time
forever — but it is flagged and the note says so out loud, because it is the one
answer that moves under you: a record edited today re-dates an event from March.
Ties inside a tier go to the user, exactly as for a sheet. One level of nesting
is scanned (`data.created_at`), ranked by the leaf name.

**Coverage is measured over the whole restampable range, not the sample.** A
provider that changed their webhook format leaves the chosen key in recent
payloads only, so a detection over the last 200 deliveries reports "200 of 200
dated" while a restamp would silently drop everything older to delivery time.
`state.coverage` counts key-presence across every stored payload and records the
oldest one that has it.

**The restamp is a reprocess.** `reprocessConnection`'s machinery already walks
`raw_events` and re-runs `processRawEvent`; the restamp is that with
`preserveOccurredAt: false`. Better than the sheet's equivalent, because the
evidence survived — a spreadsheet row's past is gone and has to be reconstructed
from `events.received_at`, where here the original JSON is still on disk and the
value is re-derived exactly. Payloads the key cannot date land on the delivery
moment, which the caller supplies as `NormalizeContext.fallbackOccurredAt`
(`new Date()` is only the delivery moment on the first pass — a reprocess would
otherwise stamp the reprocess).

**⚠ IT DEPENDS ON `raw_events` SURVIVING.** Nothing prunes them for an active
connection today, and batch 5 is the first code that deletes them at all — at
day 30, and only for connections DISABLED that long. That boundary is
load-bearing: **if retention ever reaches active connections, webhook
restamping dies with it** and the event-time answer becomes a one-way door,
correct for everything that arrives afterwards and permanently wrong for
everything before. Anyone widening that policy has to decide what replaces this
first. (The sheet path has no such coupling — a mirror re-reads its whole
resource, so its restamp needs nothing but the next sweep.)

**The rollout is gated, and the gate covers everything.** With
`WEBHOOK_EVENT_TIME_LIVE` unset, the nightly scan records what each connection
WOULD pick and the connector dates new events byte-for-byte as it always did —
frozen key order, frozen parser. Dating new events better while old ones keep
their old answer would put two meanings inside one metric with nothing on screen
to say so; uniformly wrong beats incoherent. `scripts/webhook-event-time.sql` is
where you look before flipping it.

The first run after the gate opens restamps EVERY catch-hook connection, not
only the ones whose key changed — because the parser changed too, so "same key"
does not mean "same answer". `config.eventTime.restampedAt` records that it
happened; after that, only a change of key restamps.

**The picker is on the connection page**, under Inbound webhook, and it exists
because a detector that can be wrong needs a fix a person can reach — the
alternative was editing the database, which is not a fix. Three answers, the same
shape as the sheet's: detect automatically, use delivery time, or a named key.
Its options are every key the last scan found to hold real dates, ranked —
wider than what the detector chose, because the ranking exists so nobody has to
think about `updated_at` and the list exists so somebody who has thought about it
can still say yes.

A pick records the answer and a restamp marker; the nightly pass does the work.
A reprocess of a busy connection is not something to run inside a click, and
while the gate is shut it must not run at all — so a pick made today is honoured
the first night after the gate opens. The marker is cleared by comparison, after
the reprocess returns, so a second pick mid-run survives and an interrupted run
leaves the request standing.

### The other connectors keep `parseDate`, and that is deliberate

Every connector ends in `parseDate(...) ?? new Date()`, but for
Calendly/Close/Instantly/Sendblue/Calendar the key it reads is the provider's
own documented field — always ISO — so the fallback is an edge case rather than
a routine outcome. Only the catch-hook takes arbitrary JSON with no schema,
which is why it is the one that behaved like a sheet and the one that moved to
`normalizeDateValue`.

The two parsers genuinely disagree, and the full list of input classes where
they do is tabulated above `parseDate` in `src/connectors/field-utils.ts` —
measured, not recalled, and pinned by a test so it cannot go stale. Three
groups: shapes they agree on, shapes only `normalizeDateValue` reads
(`"21/07/2026"`, `"20260722"`, epoch strings), and shapes bare `new Date`
accepts that it should not. That last group is why unifying them is a decision
rather than a tidy-up — `new Date("2026-02-30")` does not fail, it returns March
2nd, so a provider that ever emits one is currently believed.

Unify when someone is willing to re-verify the five connectors against that
table. Until then the split is deliberate, the table is the boundary — and the
question of whether any provider has ever actually SENT one of those shapes is
now answered with evidence instead of a guess.

`parseDate` checks every value against both parsers and logs the disagreements
as `[parse-drift]`. Its own answer is what gets used, always: not one stored
timestamp changes. Three kinds:

| kind | meaning |
|---|---|
| `loose-accept` | `new Date` read it, the strict parser refused. **The one that matters** — "2026-02-30" becomes March 2nd, "2026" becomes January 1st. None of them fail; all of them lie. |
| `divergent` | both read it, different instants. Should be impossible; if it fires, the table is wrong. |
| `strict-only` | the strict parser read what `new Date` refused. A gain not being taken — real data currently landing on `new Date()`. |

**What silence proves, and what it does not.** A period with no `[parse-drift]`
lines means no value PARSED in that period disagreed. It does not cover a
provider that went quiet, and it cannot be totalled from here — these run in
ephemeral invocations with no shared process to hold a count. "Confirmed for the
traffic we saw" is the honest reading; "confirmed" is not.

The field name is passed at every call site so the strict parser's numeric gate
applies as it does everywhere else. Without it, every epoch-second string a
provider sends would report as a disagreement that exists only because the
comparison was set up wrong — a test scans the five connectors for a call that
forgot it.

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

A third, since it shows up in the UI: **a campaign total has no timestamp.** It
is a running number, not something that happened at a moment. The connector uses
the campaign's own creation date when the API supplies one and otherwise sets
`preserveOccurredAt`, which pins first-seen. Both alternatives were visibly
wrong: the epoch put *1970* in front of the user, and `now` made the row march
forward every sweep — reordering it and making each unchanged sweep look like a
change, which defeats the no-op skip that keeps dashboards from recomputing.

## Derived fields: when a connector computes rather than copies

A connector normally copies the provider's payload into `properties`. Sometimes
that payload cannot answer the question the integration exists to answer, and no
amount of picker cleverness fixes it. Then the connector computes the answer
once, at read time, and the whole existing filter/aggregate vocabulary works on
it unchanged.

The rule for adding one: it must be **derivable from the same payload**
(so it needs no extra provider call and re-derives identically on a re-sync),
and it must answer a question a **list cannot** — because a list of objects can
only be offered positionally in the builder, and position is rarely meaningful.

### Google Calendar attendance

"How many invited people accepted?" is the question a calendar is bought for,
and `attendees` cannot answer it: it is a list, so the builder can only offer
*Item 1, Item 2*. Every meeting has different people, **Google does not
guarantee attendee order**, and the organizer is not reliably first — so a
metric on "Item 1's response status" measures a different person on every row.

`attendanceRollup` (`src/connectors/google-calendar.ts`) flattens it into counts.
The raw `attendees` list is left untouched alongside them.

| Field | Meaning |
|---|---|
| `guests_total` | Every invited person, organizer included; rooms excluded |
| `guests_accepted` / `_declined` / `_pending` | Those guests by RSVP |
| `guests_external` | Guests whose email domain differs from the organizer's |
| `guests_external_accepted` | …of those, the ones who accepted |
| `is_external_meeting` | Someone outside the organizer's company was invited |
| `organizer_email` / `organizer_domain` | Provenance for the external split |

There is no `guests_tentative` and no per-event `guest_acceptance_rate`. "Maybe"
is not a state anyone builds a number on, and a per-event rate is the wrong
shape: averaging it weights a 2-person call the same as a 20-person one. Ask
Calculate for `sum(guests_accepted) ÷ sum(guests_total)` instead. One consequence
worth knowing: a tentative guest is inside `guests_total` but in none of the
buckets, so the parts sum to the whole only when nobody answered Maybe.

**The counts must equal the line Google prints on the event.** Open it in Google
Calendar and it reads *"4 guests · 2 yes, 2 awaiting"*; `guests_total`,
`guests_accepted` and `guests_pending` are that line, field for field. That is
the whole constraint, and it is written down because the first version broke it:
it excluded `organizer` and `self` on the theory that the closer's automatic
acceptance would make every meeting look accepted. On a real event where the
organizer and the calendar owner were the only two who *had* accepted, it
reported **0** — a number the user could disprove at a glance. A definition that
cannot be checked against the source is not worth its cleverness.

What survives:

1. **Rooms are not people.** `resource: true` attendees are dropped before
   anything is counted — Google lists them, its own guest line does not.
2. **External = a different domain from the organizer.** This separates the
   prospect from the colleague added to the call. When no organizer can be
   identified there is no inside to be outside of, so nobody is external — the
   rollup never guesses.
3. **Missing means pending.** Google omits `responseStatus` entirely for someone
   who has not replied; that counts as `needsAction`.

`guest_acceptance_rate` is null rather than 0 on a solo block so that averaging
it over a calendar is not dragged down by focus time.

Two ways to ask "did the other side accept", differing in what they assume:

- `guests_accepted > 1` — cheap and reads naturally, but assumes the host always
  auto-accepts. A host who leaves their own invite unanswered makes a genuinely
  accepted meeting read as 1.
- `guests_external_accepted >= 1` — no assumption at all, and the right one when
  the meeting is with someone outside the company.

## Test must actually re-read the source — including sources with no resource

Sources split in two, and only one half was being refreshed.

**Stream-scoped** sources pick a resource inside the flow: a Sheets tab, a
calendar, an Instantly campaign. That choice is the step's `sourceConfig`, which
is what `primeStream` keys on.

**Connection-scoped** sources — Sendblue, Close — have no such choice. The
account IS the resource, so the Get data step's config is empty. And
`primeStreamsForTest` skipped any step whose config was empty:

```ts
if (!connectionId || !hasStreamConfig(sourceConfig)) continue;   // ← Sendblue, Close
```

So Test never contacted those providers. It ran the flow over whatever storage
happened to hold and printed *"0 loaded · No records returned"* — indistinguishable
from a source that genuinely is empty, and undebuggable, because the request that
would have failed was never made. It also made connector work look inert:
changing a poll cannot change a Test that does not call it.

`primeConnection` (`src/lib/sync/resync.ts`) closes it, running
`runSync(…, "incremental")` behind the same pause and budget guards `primeStream`
applies. A provider error now reaches the user as an error. An empty account and
an old account still legitimately return zero.

The general rule this leaves behind: **every branch that can produce "no data"
must be reachable only when we actually asked.** A skip that looks like an empty
result is the most expensive bug shape in this codebase — it has now appeared in
the migration tracker, the flow Test, and both layers of the Sendblue poll.

### One writer per connection (C.1, connection scope)

Adding `primeConnection` opened a race: the Test now syncs inline, so a Test and
the 10-minute sweep could both read the connection cursor, both call the
provider for the same page, and both write a cursor — leaving the stored
high-water mark behind what one of them had already consumed.

**Inngest's keys do not cover it**, though they look like they should.
`sync-connection` carries `concurrency: {key: connectionId, limit: 1}` and
`reconcile-one-connection` carries `singleton: {key: connectionId, mode: skip}` —
but those scope **per function**, so the two never exclude each other, and the
inline Test path does not go through Inngest at all. Three entry points, no
shared guard.

`sync_state.sync_lock_until` / `sync_lock_token` is that guard: a lease over the
whole read-poll-write span, taken by `runSync` and by the sweep's
connection-scoped branch alike.

| Contender | On collision |
|---|---|
| Sweep (`reconcileConnection`) | **Skips.** No poll, no budget spent, no cadence change — the holder is doing this work. |
| Sync now / full re-sync (`runSync`) | **Skips**, reporting `skipped: true` rather than a silent no-op. |
| Test (`primeConnection`) | **Waits, then adopts** (Q6). If a sync lands while it waits, its read is the answer — no second provider call. |

**Why a lease and not an advisory lock.** The section has to span the provider
poll — excluding only the write still lets both writers read the same cursor and
call out — and holding a transaction across an HTTP call is exactly what the
header of `src/lib/sync/locks.ts` forbids. Advisory locks also need sessions, so
they are inert until `DB_DRIVER=pool`, while this race is live on the http
driver today. And a serverless container killed mid-poll (`maxDuration = 60`)
leaves no session to die with, so the deadline is what makes recovery automatic.
The lease is one `INSERT … ON CONFLICT DO UPDATE … WHERE`, hence atomic on every
driver. The token fences release, so a Test that timed out and proceeded cannot
clear the lease of the writer it gave up on.

### Sendblue: the messages ARE the analytics

Sendblue's own dashboard shows response rate, messages sent/received, unresponded
conversations, speed to dial and average rep response time. None of those come
from an analytics API — their product computes them from message history, which
is the same history this connector already polls. So Sendblue is the mirror image
of Instantly: there, per-email rows are 37.9K against the tightest rate bucket in
the catalog and provider-computed analytics are the only sane read; here the
whole account is on the order of a thousand messages and every dashboard tile is
a Filter + Calculate away. Adding an analytics stream would add a second source
of truth for numbers we can already derive.

The connector's own response parsing is still **unverified against the live API**
(`API_BASE`, the message-list envelope and the date field are all assumptions —
see the header comment in `src/connectors/sendblue.ts`). `docs.sendblue.com` is
blocked by this environment's egress policy, so it has not been possible to
confirm them from the documentation. Confirm against a live account before
trusting Sendblue numbers.

## `nextCursor: null` means START OVER

The connector contract's most expensive ambiguity, now settled in
`PollResult.nextCursor`. A connector that means *"nothing changed, keep what you
had"* returns `args.cursor` — the value it was handed. `null` means *"begin from
scratch next time"*.

The runner used to implement the other reading (`cursor = nextCursor ?? cursor`),
and two connectors had already assumed reset:

- **Calendly** returns null when a scan reaches its last page. Folded back, the
  cursor stayed pinned to that final page token and every later sweep re-fetched
  the same last page — **no booking made after the first sweep was ever
  ingested.** Consistent with a Calendly connection whose ingested event types
  never grew past empty.
- **Google Calendar** returns null on a 410 ("this sync token is dead"). Folded
  back, it re-sent the dead token forever, so one expiry meant permanent 410s
  with no recovery short of a manual full re-sync.

Both are one-line `return null` sites, which is why the ambiguity stayed
invisible. `tests/cursor-contract.test.ts` drives the real connector through the
real runner for each case.

## A setting either shapes the request or narrows the read

A per-flow setting is one of two things, and conflating them is expensive:

- **It changes the REQUEST** (Calendly's scope and status, Sheets' spreadsheet
  and tab): fewer API calls, and it must be part of `streamConfigHash`, because
  two different requests are two different syncs.
- **The provider cannot act on it** (Calendly's meeting type — `/scheduled_events`
  has no `event_type` parameter): the same pages are fetched either way. It
  belongs in `FlowConfigField.readFilter`, which keeps it OUT of the stream
  identity and applies it as a WHERE clause in `appConds`.

The second kind was an ordinary config key once, and every cost landed at the
same time: a fresh stream with a fresh cursor per choice (so a newly-picked
meeting type showed `0 loaded` until its own scan caught up), a duplicate row per
copy, and the same account scanned once per type against one 60/min bucket. None
of it bought a single API call.

`normalizeStreamConfig` therefore takes the SOURCE, and the argument is required
rather than optional on purpose: only the catalog can tell a read filter from a
resource selector, and an un-updated call site would fork the stream silently.

A `readFilter` may name several paths, OR'd together, which is how a value whose
meaning changed stays readable — Calendly's is an event-type URI now and was the
type's name before, and a URI never equals a name.

A flow can slice the same shared sync further with a Filter step, and connectors
make that possible by flattening the narrowing axes onto every record. Calendly
grew `meeting_type`, `host_email` and `host_name` for exactly this — the first
was otherwise reachable only as the ambiguous `name` (and again as "Subject /
person"), and the other two were buried in `event_memberships`, an array a picker
can offer only positionally.

## Streams are retired when no flow reads them

A stream is created when a Get data step declares a resource, and nothing used to
remove it when that step changed — so every edit left the previous one behind,
still returned by `activeStreams`, still polled every sweep, still spending the
connection's budget on data nobody could read.

`pruneOrphanStreams` (run on PUBLISH) disables any stream of the org that no
draft or currently-published graph references. Disabled, never deleted: the sweep
filters on `status`, so the cost stops immediately, and `ensureStreamsForGraph`
re-activates one the moment a flow points at it again.

On publish rather than on save, deliberately. The draft autosaves 900ms after
every canvas change, and this reads every flow's graph in the org — running it
there made dragging a node pay for the whole workspace. It also reads each flow's
CURRENT published version only: `flow_versions` gains a row per publish forever,
each holding a whole graph, so counting all of them scaled the cost with a team's
publishing history instead of with what is running.

It does NOT retire the rows by default. It runs on every draft save, including
half-finished ones, and a user switching a setting to look at something must not
find their import gone; dead rows are unreadable anyway (the read is
stream-scoped) and cost only storage. `scripts/prune-orphan-streams.ts --apply
--retire-rows` is the deliberate cleanup.

## Calendly: what reduces API calls, and what only reduces storage

Calendly is stream-scoped like Instantly — each distinct REQUEST is its own
stream with its own cursor.

`/scheduled_events` accepts `organization` | `user` | `group`, `min_start_time`,
`max_start_time`, `status`, `invitee_email`, `sort`, `count`, `page_token`. That
is the whole list. **There is no `event_type` parameter**, which is why meeting
type is a read filter rather than part of the sync.

| Lever | Effect |
|---|---|
| **Fetch meetings for** (me / group / whole org) | fewer API calls |
| **Meetings to include** (booked / canceled / both) | fewer API calls |
| History window (fixed in the connector) | fewer API calls |
| **Meeting type** | a WHERE clause over the shared sync — instant, and costs nothing |
| Host, and meeting type again | Filter step, on `host_email` / `meeting_type` — nothing extra fetched |

**Whole organization needs an admin or owner token.** A personal access token
from a non-admin member carries user scope only, and an organization-scoped read
from one returns an empty collection — indistinguishable from an account with no
meetings unless you read the `[calendly-probe]` log line, which records
`returned=` straight from the response.

### The scan walks OUTWARD FROM NOW, alternating

A scan pins three boundaries: the window's `floor` and `ceil`, and a `pivot` —
the instant it started. Each poll takes one page from whichever side is due:

| side | request |
|---|---|
| `past` | `min_start_time=floor`, `max_start_time=pivot`, `sort=start_time:desc` |
| `future` | `min_start_time=pivot`, `max_start_time=ceil`, `sort=start_time:asc` |

then hands the turn to the other side. The cursor clears — restarting the whole
thing next sweep — only when BOTH sides are drained.

This was one `start_time:asc` walk from the floor, which meant every partial
state of a scan held the OLDEST meetings in the window and nothing else. On a
busy organization a 4-page Test returned 400 meetings from a month ago: "Latest 3
records" showed appointments two weeks stale, and every upcoming meeting was
missing. A page budget should be spent on the meetings nearest to now in both
directions, because those are the ones anyone is looking at.

### A meeting is dated by when it HAPPENS

`occurred_at` is the meeting's `start_time`, not `created_at`. This matters more
than it sounds: Calendly filters `/scheduled_events` by `start_time`, so the
window is a meeting-time window. While `occurred_at` was booking time the two
axes disagreed, and a standing meeting booked in August 2025 whose next
occurrence is this week sat correctly inside a 30-day window while displaying as
August 2025 — which read as the window not working.

It is also what the phrase means. "The last 30 days and the upcoming ones" is a
statement about when meetings happen; only this axis puts a future meeting in the
future. Booking time is still there as `booked_at` (and `canceled_at`), so
"meetings booked per day" remains a metric anyone can build.

### The window: 30 days back, 90 forward — and stored data tracks it

Both halves are short because the window is the only real lever on volume: with
no event-type filter, pages walked is decided by scope × window and nothing else.
A year forward was a scan a busy organization could not finish between sweeps, so
its numbers never settled; a quarter drains in one or two.

The poll declares that window as `retireOutsideWindow`, and `syncStream` retires
this stream's rows that fall outside it. **A rolling window that only ever adds
is not a window** — narrowing it used to leave the older import stranded behind
the new floor with a gap in between, matching neither the old window nor the new.

`retireOutsideWindow` is the complement of `mirrorScope`, and the distinction is
what makes it safe here. `mirrorScope` asserts the read is COMPLETE for a window,
which licenses retiring rows INSIDE it that the read did not produce — only true
when one call returns the whole window. This asserts nothing about completeness:
it retires rows OUTSIDE the window, which depends on the boundary alone and is
therefore correct on a paginated source where any one call sees a fraction. It is
skipped entirely when a scan was cut short, because a prefix of the window is not
grounds for tombstoning anything.

It requires the connector's `occurred_at` to be on the same axis as the window it
declares. Calendly's is meeting start time and the window filters `start_time`;
were it booking time, this retire would tombstone live meetings booked long ago.

**History accumulates forward from the connect date.** The first sweep imports the
preceding 30 days and every sweep extends the record forward; it never reaches
further back on its own, and rows that age out of the window are retired. Wanting
last year's meetings is a **one-time historical import**, not a wider sweep — see
PRE_LAUNCH_CHECKLIST.md item 9a (the E.8 backfill lane), the gate that has to land
before any deep backfill runs.

`scripts/stream-inventory.sql` (read-only) shows what each stream currently
holds, before and after.

### How a client-side filter used to report zero

Kept as the record of why the rule above exists. Both were found on a real
account where "Just me" worked and "Whole organization" returned nothing.

**A page that filters to nothing is not the end of the data.** `syncStream`'s
walk stopped on `records.length === 0` — sound when a connector returns what the
provider returned, wrong the moment it filters first. Page one of an org-wide
read is other hosts' meetings, so the walk ended there. One person's meetings fit
on page one, which is why the narrow scope looked fine. Fixed: an advancing
cursor means there IS more, and `maxPages` bounds the walk.

**Calendly gives every host their own copy of a shared event type.** An
organization running one programme across three people has three `event_types`
rows with the same name and different URIs — the same label two or three times in
any client's picker, Zapier's included. The picker keys options by URI and labels
them by name (Zapier's split exactly), so two rows can read alike and each still
selects only its own meetings. Collapsing them by name instead made one entry
that pulled both, which is the opposite of what a picker is for.

**A mid-scan sweep is not an idle one.** `reconcileChanged` counts inserts,
updates and soft-deletes, and a re-scan of an unchanged window produces only
dedups — so a part-finished walk read as idle and slid down the cadence ladder
(30 min → 2 h → 6 h → daily). It compounds: each demotion makes the remaining
pages arrive more slowly. `CadenceInput.incomplete` holds the connection at base
cadence, and holds its no-op streak, while any stream still has pages to fetch.

## Never a bare zero while a scan is incomplete

`syncStream` reports `incomplete` when its walk stopped because it ran out of
page budget rather than because the source ran out of data. `primeStream` turns
that into a note and the editor shows it above the result.

"0 loaded" and "0 loaded so far" are different claims. A count taken mid-scan is
a floor, not an answer, and a Test that renders the two identically is the same
silent zero this codebase keeps having to unpick — it has now appeared in the
migration tracker, the flow Test's skipped refresh, both layers of the Sendblue
poll, and Calendly's page walk.

"Meeting type" is deliberately not called "event type": that name already means
the canonical `booked` / `canceled` / `no_show` in this product, and the panel's
own control for that is now labelled **Record type** so the two cannot be
confused.

`GET /users/me` is memoized per connection (5-minute TTL). It answers "who is
this token", which never changes, and it was being called on every poll and every
option listing — an extra provider call per stream per sweep that the budget
layer never counted, since a claim is made per poll rather than per request.

## Hiding fields that answer nothing

`ConnectorCatalogEntry.hiddenFields` lists paths a source carries but nobody can
build on. Two kinds qualify:

1. **Constant on every row** — `kind` is always `"calendar#event"`, `source` is
   always the connector. A condition on a constant passes every record or none.
2. **An exact restatement** — a calendar's canonical `subject` *is* its
   `summary`, listed twice under two names.

Opaque-but-unique values (`etag`, `iCalUID`) are the first kind in practice.

This hides them from the **picker only**. The data is untouched and stored
references still resolve, so a flow already pointing at one keeps working.

`occurredAt` is deliberately **not** hidden on Google Calendar: it is the
meeting's start time and the default date field of every Time-window step. It
only looked like plumbing because its label is humanised like one of ours.

## Custom Webhook: the URL is the product

The catch-hook connector has no credentials — saving a connection mints an
inbound URL and that URL is the entire feature. It used to appear only on
`/connections/[id]`, as plain uncopyable text, so the integrations page's flow
ended at "Save connection" with no next step. The URL now appears on the
connection's row under **Your connections** with a real copy button
(`src/components/copy-field.tsx`), and the card says where to find it.

`webhookUrlFor` builds on `APP_BASE_URL`. Unset, it yields a path with no origin —
which still looks like a URL and pastes cleanly, but can never receive anything.
`CopyField` detects the missing `https://`, disables copying and names the
variable rather than handing over a value that silently does nothing.

**Backfill.** These are computed on write, and Calendar syncs incrementally by
sync token — so events already stored keep their old `properties` until they
change. To populate them across existing history, run **Full re-sync** on the
connection (`/connections/[id]`), which clears the cursor and re-lists the
bounded window.

## Watching for absence, not just for failure

Everything else here asks "did this piece of work succeed?". Nothing was asking
"is any work reaching the question?" — which is the shape of the worst outage
this project has had: migration 0012 was skipped, `withConnectionSyncLock` threw
on every sync entry point for weeks, and the test suite stayed green throughout
because it builds its own database and never looks at the real one.

Three layers, and they are deliberately different kinds of thing:

**At CI — the stranding contract** (`tests/stranding-contract.test.ts`). Each
`poll()` is driven through a synthetic burst larger than `pages × pageSize` and
every record must stay reachable across successive polls. Deterministic, free,
and it is where the "cursor jumped past unread data" class is caught — Sendblue
lost data that way for months while every count looked plausible.

**Nightly — the invariant scan** (`src/lib/health/invariants.ts`, run from
`prune-storage`). Reads only, no provider calls. Streams an active connection
has stopped polling; connections failing on the breaker's own streak counter;
backfills that report `running` and have not moved their checkpoint; dead-letter
rows nobody resolved; mirrors that have been read and hold nothing. Each is
"something that should be moving has stopped", and none of them writes an error
anywhere on its own — a stream that is never polled has nothing to report,
because nothing ran.

Findings are RETURNED from the run and logged as `[invariant-scan]`; they are
deliberately not written to `connections.last_error`, which means "the provider
failed" and is cleared by the next successful poll.

**One check from the original plan is missing, and it is not an oversight.**
"Connections whose cursor has not advanced while records keep arriving" cannot
be answered from stored state: `sync_state.cursor` holds only the current value
and is rewritten every poll, so there is no way to see that it stood still, and
inferring it from stored `occurred_at` would flag every account that had a quiet
month. It needs a column. The CI contract above catches the same class.

**Per sweep — the mirror count** (10c). A mirror's guarantee is "stored live
rows ≡ the source after every sweep", which is the strongest claim any class
here makes and had nothing verifying it. Both halves — the upsert and the
retire — have been wrong before, and when they are, every row still looks right
individually: the failure is a count.

Taken only where it is free. A whole-resource mirror has just read its entire
resource, so the denominator is already in hand and the only cost is one indexed
count. For every other class a "count" means a full pagination — the exact
expense the rate-limit work exists to remove — so Calendly and Close get no
equivalent, and Instantly's analytics stream needs none because the sweep
already re-reads the whole window. A mismatch is reported as `[mirror-drift]`
and on `StreamSyncResult.mirrorDrift`, never corrected: a sweep that quietly
fixed a discrepancy it does not understand would destroy the evidence of the bug
that caused it.

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
