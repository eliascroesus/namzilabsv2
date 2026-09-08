# Batch-1 connector review — UNVERIFIED findings

Produced 8 Sep 2026 by a 15-reviewer adversarial pass over the thirteen connectors
added in `4d7b55c`. **The verify phase never ran** — every one of the 45 verifier
agents died on a session limit — so NOTHING here is confirmed. Each item is a
reviewer claim to be refuted or fixed, not a defect of record.

Two were checked by hand and ARE real (see CRITICAL below); the rest are open.
These thirteen connectors are committed but deliberately NOT pushed.

## Status, 8 Sep 2026

**Both criticals are FIXED** in `19f746b`, each re-verified against the vendor's
own documentation first rather than taken on the reviewer's word:

- **ThriveCart rebills.** Confirmed and fixed. The docs' own examples settle it:
  `order.success` and the `order.subscription_payment` that follows both read
  `order_id=1514394`, while `invoice_id` moves `000000004` → `000000004-2` and
  `recurring_payment_idx` counts the payment. A recurring charge is now keyed on
  the invoice; one-off orders keep their ids byte-for-byte so nothing already
  stored re-ingests as a duplicate.
- **Smartlead double-count.** Confirmed as a LATENT defect and removed at the
  root. It could not fire today — the webhook is a doorbell for a stream-scoped
  source, so `normalize` was unreachable — but it would have fired the moment
  anyone made that path reachable, which was exactly the repair the other
  Smartlead finding proposed. The unreachable mapper and its event vocabulary
  are deleted, with a test that fails if either returns before the two paths are
  made to agree on identity. The `lead_interested` label went with it.

A second verification pass then ran, one agent per connector, each told to
default to REFUTED and to confirm nothing it could not back with a concrete
payload, a concrete wrong number, and a line of the vendor's own documentation.
**Thirteen of its fourteen agents died on the same session limit that killed the
first pass**, so it settled one connector before stopping:

- **Airtable's truncated mirror.** CONFIRMED, and fixed in `872ff88`. A mirror
  read promises "this IS the resource" and `retireAbsent` tombstones every
  stored row the read omitted. Airtable is the first mirror that can come back
  truncated — its walk stops at a page cap and sets `incomplete` — and the
  runner's mirror branch never read that flag, so a base past the cap had every
  row outside an *arbitrarily ordered* prefix soft-deleted on every sweep, with
  the drift alarm silenced because it compared the prefix against the
  post-retire count. Airtable's docs supplied the decisive line: with neither
  `sort` nor `view`, record order "is arbitrary".

So **38 of the original 45 remain unverified**. They are hypotheses written by
reviewers who were never checked, not defects of record — the two that have been
examined closely both turned out to be real, which is a reason to finish the
pass rather than a reason to trust the rest. Re-run it after the limit resets:
`Workflow({scriptPath: '<scratchpad>/verify-findings.js', resumeFromRunId: 'wf_bd66272a-a9f'})`
replays Airtable from cache and re-runs the thirteen that died.

The two Smartlead entries further down are superseded by the fix above.


## CRITICAL

### Smartlead webhook and poll key the same send/open/reply on different identities — every outreach event counts twice

`smartlead.ts:121`

**Scenario.** `factKey` prefers `stats_id`/`email_stats_id`, but the module's own header comment records that the webhook deliveries carry "NO stats id, which is why identity falls back to the lead + sequence step". So the two paths can never agree whenever a leads-statistics row actually carries the id the poll code was written (and tested) to expect. Concretely, with campaign 123 and lead lead@example.com at sequence step 1: the EMAIL_SENT webhook produces `smartlead:conn_1:123:lead@example.com:1:email_sent` (tests/smartlead.test.ts:105) while the poll of the same send produces `smartlead:conn_1:7:st1:email_sent` (tests/smartlead.test.ts:197). The catalog has smartlead as `instant: true, poll: true` (catalog.ts:903-904), so both paths write. One email sent lands as two `email_sent` events, one opened as two `email_opened`, one reply as two `reply` — reply rate and send volume are exactly doubled on any campaign whose webhook is wired, and there is nothing on screen to say so.

**Proposed fix.** Key both paths on the identity BOTH can produce: drop the `stats_id`/`email_stats_id` preference from `factKey` and always use `${leadEmail}:${sequence_number}` (falling back to lead_id/message_id). If the stats id is wanted for traceability, put it in `properties`, not in the eventId.

### Every rebill of one subscription collapses onto a single eventId (order id, not invoice id)

`thrivecart.ts:242`

**Scenario.** A $97/mo ThriveCart subscription on order 1514394 bills 12 times. Every `order.subscription_payment` delivery carries the SAME `order_id`/`order.id` (only `invoice_id` changes per charge — ThriveCart documents both as separate top-level keys, and tests/thrivecart.test.ts:151 pins `thrivecart:conn_1:O-1:${event}`). `id` resolves to the order id for all twelve, so all twelve produce eventId `thrivecart:<conn>:1514394:order.subscription_payment`. The ingest upserts on eventId, so twelve $97 payments store as ONE event — recurring revenue is under-reported by 11/12 and never grows. The same collapse hits a second partial refund on one order (`…:order.refund`).

**Proposed fix.** For the per-charge events (`order.subscription_payment`, `order.rebill_failed`, `order.refund` and their `order_rebill*`/`order_refund*` twins) key on the charge, not the order: read `text(body["invoice_id"])` FIRST and fall back to the order id only for `order.success` / `cart.abandoned`.


## HIGH

### Poll dates cancellations and reschedules from last_updated_time, so any later edit silently re-dates a past cancellation

`oncehub.ts:206`

**Scenario.** BKNG-1 is booked 1 Sep and cancelled 2 Sep. The poll emits `oncehub:<conn>:BKNG-1:canceled` at 2 Sep (the webhook path emitted the same id at the envelope's creation_time, also 2 Sep). On 20 Sep the host is reassigned — `booking.reassigned`, an event this connector deliberately does not count — which bumps `last_updated_time` to 20 Sep. The row re-enters the `last_updated_time.gt` window, status is still `canceled`, and lines 211/214 re-emit the SAME eventId with occurredAt = 20 Sep. src/ingestion/pipeline.ts:113 writes `excluded.occurred_at` on conflict because this connector never sets `preserveOccurredAt`, so the stored cancellation moves. September's cancellation count silently drops by one and October's gains one, weeks after the month closed, and the webhook path's correct date is overwritten. I confirmed on help.oncehub.com/developers/api/ (read 8 Sep 2026) that the Booking object has NO cancellation or reschedule timestamp — `cancel_reschedule_information` carries only `reason`, `actioned_by`, `user_id` — so `last_updated_time` genuinely means 'last touched for any reason'.

**Proposed fix.** Return `preserveOccurredAt: true` from `poll` so a re-read cannot move an outcome's date. It is a no-op for `booked` (immutable `creation_time`) and for `meeting_held`/`no_show` (immutable `starting_time`), and it preserves the webhook path's true cancel instant where one was written first.

### A truncated mirror read still retires every stored row past the 5,000-record cap

`airtable.ts:370`

**Scenario.** A base table grows to 6,000 records. `readTable` stops at `maxPages` (50 × 100 = 5,000), sets `read.offset`, withholds `mirrorScope` and returns `incomplete: true` with `nextCursor: null`. The mirror branch in src/lib/sync/streams.ts destructures only `{ records, nextCursor, mirrorScope, unchanged }` (line 632) and calls `retireAbsent(tx, conn, stream, toWrite, mirrorScope)` at line 733 — with `mirrorScope` undefined the scope filter is empty, so EVERY live row of the stream that is not in the 5,000 read is tombstoned. Airtable's list-records order is the default view's, which a user re-sorting in the UI changes, so the retained slice shifts between sweeps and previously-mirrored rows vanish from every metric. The connector's own comment at line 349 concedes "a truncated read cannot protect its own tail by staying silent".

**Proposed fix.** Make the signal load-bearing: destructure `incomplete` in the mirror branch of streams.ts and skip `retireAbsent` when it is true (a prefix read cannot license a retire), or have airtable's poll refuse to return a truncated read at all rather than one that licenses deletion.

### deal_stage_changed is produced by a read bounded on created_at, an axis that can never see a later stage move

`attio.ts:166`

**Scenario.** Deal rec_1 is created 1 Sep and the poll reads it at 10:02 while it sits in "Lead" -> one deal_stage_changed at 1 Sep. On 20 Sep it moves to "Won". Every later poll asks for filter.created_at.$gte = (newest created_at - 5 min) (attio.ts:211, 220; walk.ts:128), so rec_1 is never in a result set again and attio:conn:deals:rec_1:stage:won is never emitted. "Deals won this week" reads 0 while the CRM shows 12, and "Deal moved stage" degenerates into a copy of "deals created". Worse, it is not stably wrong: a full re-sync re-polls from cursor null (src/lib/sync/resync.ts:527), so reconnecting or backfilling suddenly emits every deal's CURRENT stage at its active_from and the same chart gains weeks of history it did not have yesterday. The catalog syncNote (catalog.ts:996) discloses half of this; the event type still ships as a transition the poll can only deliver as a one-time snapshot.

**Proposed fix.** Drop the stage fan-out (attio.ts:160-173) so the connector emits only what its created_at watermark can keep current, or give stage changes a second read on an axis Attio actually filters and declare it. If the fan-out stays, at minimum emit it only when activeFrom >= the window the request bounded, so a full re-sync stops retroactively re-dating history.

### Poll counts a rescheduled meeting as a second `booked`; the webhook never does

`calcom.ts:121`

**Scenario.** Cal.com creates a NEW booking row (new `uid`, `rescheduledFromUid` set) when a meeting is rescheduled, and cancels the old one. Webhook path: BOOKING_CREATED gives `calcom:conn:bk_1` (booked), BOOKING_RESCHEDULED gives `calcom:conn:bk_2:rescheduled` — one booking, one reschedule. Poll path: `map` runs `bookingEvent(b,"booked",…)` unconditionally on every row, so bk_2 also yields `calcom:conn:bk_2` (booked) on top of `calcom:conn:bk_2:rescheduled`. tests/calcom.test.ts:97-101 pins this: three `booked` events for two real meetings, one of which only ever moved. Because eventIds differ (bk_1 vs bk_2), dedup cannot collapse them — a customer who reschedules once shows 2 bookings, and every reschedule permanently inflates the headline booking count on a poll-backed connection.

**Proposed fix.** In the poll's `map`, treat a row carrying `rescheduledFromUid` the way `normalize` treats BOOKING_RESCHEDULED: emit only the `rescheduled` event (or return null and let the fan-out add it), never `booked`.

### Smartlead is stream-scoped, so its webhook stores nothing — bounces, unsubscribes and lead-category changes can never arrive, though the entry promises they will

`catalog.ts:908`

**Scenario.** The `campaignId` flowField carries no `readFilter`, so `isStreamScoped("smartlead")` is true (verified by running it). `src/app/api/webhooks/[connectionId]/route.ts:151` therefore treats every authenticated Smartlead delivery as a doorbell: it promotes cadence, sends `sync/connection.requested`, returns 202 and explicitly does NOT call `storeRawEvent`. `normalize` is only ever invoked from `src/ingestion/pipeline.ts:245` on a stored raw event, so `src/connectors/smartlead.ts:202` is unreachable code — the same trap `types.ts:489` documents for Google Sheets. But `syncNote` (line 908) tells the customer a bounce, an unsubscribe and a lead-category change "reach this connection through the webhook only", `webhookSetup` (line 950) repeats it as "arrive this way and no other", and `eventTypeLabels` (line 945) ships a label for `lead_interested`. Concretely: a customer connects Smartlead, follows the setup text, pastes the signing secret, and builds a bounce-rate metric (`bounced` / `email_sent`) and a "Leads marked interested" count. `email_sent`, `email_opened`, `email_clicked` and `reply` populate from the poll; `bounced`, `unsubscribed`, `lead_interested` and `lead_category_updated` are literally never written by any code path, so the bounce rate reads a flat 0% and the interested count reads 0 forever, with a green webhook and no error anywhere — a zero the customer will defend as real.

**Proposed fix.** Make the entry describe what the code does: delete the unreachable `normalize` (and its five normalize tests) the way attio.ts and google-sheets.ts already do for stream-scoped sources, and cut the "through the webhook only" / "this way and no other" clauses from `syncNote` and `webhookSetup`, plus the `lead_interested` label at line 945. If those events are actually wanted, they have to come from the poll — read the row's bounce/unsubscribe state off the statistics row and date it from the send it answers — not from the webhook.

### Only the first page of a conversation's threads is ever read, and Help Scout returns threads newest-first

`helpscout.ts:283`

**Scenario.** GET /v2/conversations/{id}/threads is paginated with a default `size` of 25 and, per developer.helpscout.com/mailbox-api/endpoints/conversations/threads/list/ (fetched 8 Sep 2026), "Threads are by default sorted by createdAt (from newest to oldest)". The connector issues one un-paged GET and takes `th._embedded.threads` wholesale, ignoring `page.totalPages`. A conversation with 26+ threads therefore yields only its 25 NEWEST threads — and `lineitem` threads ("represents a change of state on the conversation": every status change, assignment, tag) count toward that 25, so a conversation with six replies and twenty state changes already overflows. The threads dropped are the OLDEST, which is exactly where the first agent reply lives. Concretely: a conversation opened 09:00 with the first agent reply at 09:04 and 30 later threads produces no `helpscout:<conn>:<cid>:thread:<first-reply-id>` event at all, so the catalog's headline promise ("first response time straight from the threads", catalog.ts:955) computes FRT from whatever reply survives in the newest 25 — hours instead of four minutes — and every `customer_replied`/`agent_replied` before the cut is permanently missing, because once the conversation stops changing the watermark passes it and it is never re-read. The webhook path is unaffected, so the two paths silently disagree about how many replies a busy conversation had.

**Proposed fix.** Page the threads read: loop `page=1..body.page.totalPages` (bounded by the poll budget) accumulating `_embedded.threads`, or fetch the list with `embed=threads` and drop the per-conversation call. Either way the budget divisor at line 259 (`PAGE + 1`) must be widened to match the extra calls.

### Poll bounds and marks on `billed_at`, so a transaction that reaches `paid`/`completed` after its billing date never re-enters the window

`paddle.ts:302`

**Scenario.** A merchant issues a manual invoice on 2026-06-01: status `billed`, `billed_at` = 2026-06-01. The poll's `status: "completed,paid"` filter (line 309) excludes it, so it never advances the mark. Other June/July transactions push the walk's high-water mark to 2026-07-20. On 2026-07-21 the customer pays: status becomes `completed`, but `billed_at` is still 2026-06-01. Every subsequent poll asks for `billed_at[GTE] 2026-07-20T…` (mark minus the 5-minute overlap), so that $12,000 transaction is never returned by the poll again — it is stranded permanently. The reconciliation backstop the catalog advertises (`syncNote`: "Completed and paid transactions are reconciled by polling") therefore cannot recover it if the `transaction.completed` webhook was missed or the destination was down, and the revenue is silently absent. The same happens to every automatically-collected renewal that goes `past_due` and is recovered by dunning days later, and it is also why `fee_major`/`earnings_major` (null until `completed`) are never filled in on a poll-only connection. The justification comment at lines 306-308 ("Anything earlier (draft, ready, billed) has no billed_at") is contradicted by the module's own cited doc line 37-38 and by developer.paddle.com/api-reference/transactions/list-transactions (read 2026-09-08): `billed_at` is "RFC 3339 datetime string of when this transaction was marked as `billed`", i.e. it is set precisely for `billed` transactions.

**Proposed fix.** Bound and mark the walk on `updated_at`, which Paddle documents as both a filter (`updated_at[GTE]`) and an `order_by` field, and keep `billed_at` as the event date through windowedWalk's existing `happenedAt` hook: in fetchPage use `"updated_at[GTE]": since.toISOString()` and `order_by: "updated_at[ASC]"`; set `changedAt: (t) => isoOrNull(t["updated_at"])` (line 320) and add `happenedAt: (t) => isoOrNull(t["billed_at"])` so coverage/importProgress still measure the billed_at axis. `transactionEvent` keeps dating on `billed_at`, so occurredAt is unchanged. Delete the false claim that `billed` transactions carry no `billed_at`.

### `checkout.session.completed` is dated by session creation, not completion

`stripe.ts:68`

**Scenario.** `occurredAt` defaults to `epochToDate(obj["created"])` and the `checkout.session.completed` branch (line 78) never overrides it, unlike `invoice.paid` (paid_at), `customer.subscription.deleted` (canceled_at) and `customer.subscription.updated` (event created). For a Checkout Session, `created` is when the session object was made — i.e. when the buyer landed on the checkout page — while `evt.created` is the completion. Stripe sessions live up to 24h, so a customer who opens checkout at 23:50 on Sep 7 and pays at 00:05 on Sep 8 is counted (with `amount_total`) on Sep 7. Daily `checkout_completed` counts and revenue disagree with Stripe's own dashboard, and both the webhook and the poll produce the same wrong date so nothing ever contradicts it.

**Proposed fix.** In the `checkout.session.completed` case set `occurredAt = eventCreated ?? occurredAt` (the Event's `created` is the completion moment), leaving `session.created` in `properties`.

### A transaction is valued at the whole ORDER total, so a payment plan counts the full order on every instalment

`thinkific.ts:178`

**Scenario.** A $199 Thinkific order paid as three instalments emits three `order_transaction.succeeded` deliveries. Each one is valued from `money(order)` — the order's `amount_dollars` (199) — instead of the transaction's own amount, so `payment_succeeded` sums to 597 for a 199 sale. The connector's own fixture proves the two differ: tests/thinkific.test.ts:162 asserts `properties.amount === 85` while the event's `value` is 99.5 (the order). Combined with `order.created` also carrying the full order value, one payment-plan sale inflates revenue several-fold.

**Proposed fix.** Value the transaction from its own figure (`numeric(p["amount"])`, with the unit settled by scripts/verify-thinkific.ts) and fall back to `money(order)` only when the transaction carries no amount — or emit no `value` at all on `order_transaction.*` and let `order.created` be the sole money event.

### A refund is valued at the whole order, not the amount refunded

`thinkific.ts:181`

**Scenario.** A $99.50 order is partially refunded for $20. Thinkific delivers `order_transaction.refunded`, whose payload (confirmed in the Webhooks Documentation example) carries `refunded_amount` and `refunded_tax_amount` — the real figures — alongside a nested `order` with `amount_dollars: 99.5`. `ev([...], "payment_refunded", ..., { value: money(order) })` reads the ORDER's total, so the canonical event states `value: 99.50` for a $20 refund: the refund metric is overstated ~5x and `refunded_amount` is never read at all. The same restatement hits a full refund of ONE installment of a payment-plan order — the entire plan price is booked as refunded. Both Stripe (src/connectors/stripe.ts:93, `money(obj["amount"])` off the refund) and Paddle (src/connectors/paddle.ts:216, the adjustment's own `totals.total`) value a refund from the refund's own amount; Thinkific is the only connector that substitutes the parent order. tests/thinkific.test.ts:167 asserts `value: 99.5` from a fixture whose `refunded_amount` is left `null`, so the test pins the wrong number instead of catching it.

**Proposed fix.** Value `payment_refunded` from the transaction's own `refunded_amount` (adding `refunded_tax_amount` if a gross figure is wanted). When it is absent, emit `value: null` — a counted refund with no figure — rather than falling back to `money(order)`. Give the test a fixture with a real partial `refunded_amount` and assert that figure.

### Every successful transaction is valued at the full order total, so a payment plan counts once per installment

`thinkific.ts:178`

**Scenario.** A $1,200 course sold as a 12-month payment plan is ONE Thinkific order (`order.amount_dollars: 1200`, `payment_type` other than "one-time", `items[].number_of_payments` / `payments_captured`) with twelve `order_transaction.succeeded` deliveries, each nesting that same order object. `value: money(order)` reads `amount_dollars` off the nested order every time, so twelve $100 charges are reported as twelve $1,200 payments — $14,400 of `payment_succeeded` against $1,200 actually collected. Monthly renewals of a `payment_type: "subscription"` order restate the order amount the same way. The comment's premise ("the order it belongs to states both cents and dollars, so the charge is valued from there") only holds when one transaction == one order, which is exactly what a payment plan is not; the documented payload even exposes `payment_type` and `items[].number_of_payments` to tell the two apart.

**Proposed fix.** Value the transaction from its own figures — `amount` with `currency`, or `presentment_amount`/`presentment_currency` — rather than the nested order. If the unit of `amount` is genuinely unsettled until a live key exists, at minimum emit `value: null` whenever `asObject(p["order"])["payment_type"] !== "one-time"`, so an installment is counted without restating the plan price, and have scripts/verify-thinkific.ts print `amount` next to `order.amount_dollars` on a known one-time order to settle the unit.

### ThriveCart eventId omits the invoice/transaction — every subscription rebill after the first collides with the first and is dropped

`thrivecart.ts:262`

**Scenario.** `eventId("thrivecart", ctx.connectionId, id, event)` where `id = order.id ?? order_id ?? invoice_id ?? event_id` and `event` is the provider's event name. For a recurring subscription both parts are constant across payments: order `O-1` billing monthly produces `thrivecart:conn_1:O-1:order.subscription_payment` in January, again in February, again in March (tests/thrivecart.test.ts:151 asserts exactly this shape). `event_id` unique per delivery is used only as the LAST fallback and never reached when an order id exists. Events are unique on `event_id` (src/lib/sync/streams.ts:389), so the second and every later rebill either dedupes away or overwrites the first row's `occurred_at` (preserveOccurredAt is false by default, streams.ts:855). A seller on $97/month with 100 subscribers records $9,700 of rebill revenue in month one and $0 thereafter. `order.refund` on an order refunded twice collides the same way. The dating compounds it: rebills are stamped from `body.order_timestamp`, the ORIGINAL order's timestamp, so even the surviving row sits in the month of the first sale.

**Proposed fix.** Include the per-payment discriminator in the id parts for the non-once-per-order events: `eventId("thrivecart", ctx.connectionId, id, event, text(body["invoice_id"]) ?? text(body["event_id"]) ?? "")` — or, simplest, key rebill/refund events on `invoice_id` (which ThriveCart increments per rebill) rather than `order_id`. Date rebills from the transaction's own timestamp, not `order_timestamp`.

### Refunds, cancellations and rebills are dated by the ORIGINAL order's timestamp

`thrivecart.ts:249`

**Scenario.** `order_timestamp` / `order_date` are top-level keys describing the ORDER, and ThriveCart resends them on every later notification for that order. A customer who buys on 1 Jan and refunds on 15 Mar produces a `payment_refunded` event with `occurredAt = 1 Jan`. "Refunds this month" reads 0 while money is leaving, and a 12-month subscription's rebills all land on the signup date. Thinkific's connector names this exact trap and fixes it (thinkific.ts:181 dates a refund by the delivery); ThriveCart takes the unfixed version.

**Proposed fix.** Only trust `order_timestamp`/`order_date` for `order.success`/`order_created`. For the later-life events (`order.refund`, `order.subscription_payment`, `order.subscription_cancelled`, `order.rebill_failed`, and their `order_*` twins) use the payload's own per-charge date if one exists, else `ctx.fallbackOccurredAt` (the delivery moment).


## MEDIUM

### bookingEvent stamps new Date() for a missing timestamp, and the poll path passes no fallback at all

`oncehub.ts:114`

**Scenario.** `occurredAt: at ?? fallback ?? new Date()`. The webhook path always threads a fallback chain (`ctx.fallbackOccurredAt`, plus `evented` from the event envelope), but all three poll call sites — line 198 (`creation_time`), 217 and 220 (`starting_time`) — pass only the parsed date and no fallback. A booking row whose `creation_time` is null or unparseable is therefore dated at the poll's wall clock instead of being dropped: it lands in TODAY's bookings count. Worse, because pipeline.ts:113 overwrites `occurred_at` on conflict and no `preserveOccurredAt` is set, every later sweep that re-reads the row restamps it to that sweep's clock, so the record marches forward day after day — the exact behaviour PollResult.preserveOccurredAt's own doc comment describes as the failure to avoid.

**Proposed fix.** Have `bookingEvent` return null when both `at` and `fallback` are null, so an undatable row is dropped rather than dated `now` — the rule ADDING_A_CONNECTOR.md states. The walk already advances the mark on a null map(), so the row is not re-read forever.

### 5-minute overlap on a started_at watermark strands call_completed for any call longer than the sweep gap

`aircall.ts:24`

**Scenario.** The walk bounds and marks on `started_at`, but the row CHANGES when the call ends (`ended_at`, and therefore `call_completed` with its talk-time value). A call starting 10:00 and ending 10:40 is read at 10:05 with no `ended_at`; by the 10:45 sweep the mark has advanced to the newest started_at seen (~10:14) and `since` is 10:09, so the call is outside the window forever and the poll never emits its `call_completed`. If the webhook delivery failed, the completion and its talk-time are permanently lost — the poll is supposed to be the safety net. retell.ts:54-60 documents this exact failure and answers it with a 30-minute overlap; aircall keeps the house 5 minutes on the identical shape.

**Proposed fix.** Raise `DEFAULTS.overlapMs` for aircall to cover a long call (retell uses `30 * 60_000`), or bound the request on the call's own update axis rather than `started_at`.

### 5-minute overlap strands the completion of any call longer than the overlap

`aircall.ts:24`

**Scenario.** The walk bounds on `from` and marks on `changedAt: started_at` (line 101) — a field frozen at call start — while the row keeps mutating (`answered_at`, `ended_at`, `duration`) for the whole call. With `overlapMs: 5 * 60_000`, a call starting 09:58 and ending 10:20 is read at 10:00 and 10:10 with `ended_at` still null (only `call_logged` emitted); by the 10:20 poll the mark has advanced to the newest `started_at` (~10:15), so `since` = 10:10 and the 09:58 call is never returned again. Its `call_connected`, `call_completed` and `value: talk` seconds are lost forever on the poll path — talk-time totals and pickup rate silently under-count every call longer than five minutes on any connection whose webhook registration failed or was removed. retell.ts:80-86 documents this exact failure and widens its overlap to 30 minutes for the same reason; aircall did not.

**Proposed fix.** Raise `overlapMs` for aircall to cover the longest plausible call (retell uses 30 minutes), or re-read from `min(mark, now - maxCallDuration)` so an in-progress call is guaranteed to be revisited after it ends.

### Stage event id is keyed on the mutable, slugified stage TITLE while the payload carries a stable status_id

`attio.ts:165`

**Scenario.** The workspace renames the stage "In Progress" to "Working". A full re-sync (resync.ts:527 polls from cursor null) re-reads the same deal, same transition, same active_from, and stores attio:conn_1:deals:rec_1:stage:working while attio:conn_1:deals:rec_1:stage:in_progress is already stored — two deal_stage_changed rows for one move, and a stage-change count that steps up after every reconnect. The inverse also bites: two distinct stages titled "Closed Won" and "closed  won" both slugify to closed_won (stageKey, attio.ts:131), so one overwrites the other and the survivor's occurredAt jumps to the other's active_from.

**Proposed fix.** Key on the stable id the status value carries (the docs example this module cites shows status.id.status_id): `str(asObject(asObject(stage["status"])["id"])["status_id"]) ?? stageKey(title)` — the same choice pipedrive.ts:59 already makes with stage_id.

### conversation_closed falls back to userUpdatedAt, a timestamp that keeps moving under a stable eventId

`helpscout.ts:201`

**Scenario.** When `closedAt` is absent the close is dated by `userUpdatedAt` — "UTC time when the last user update occurred", i.e. the agent's last action of ANY kind. The event keeps the fixed id `${base}:closed`, the connector never sets `preserveOccurredAt`, and `upsertEvents` writes `excluded.occurred_at` on conflict (src/ingestion/pipeline.ts:100), so every later poll that re-reads the conversation rewrites the stored close date. A conversation closed 2 Sep, then touched by an agent note on 20 Sep, is re-read on the next sweep and its `conversation_closed` event moves from 2 Sep to 20 Sep: "conversations closed on 2 Sep" drops from 1 to 0 retroactively, after the customer has already read that number. This is precisely the argument the module itself makes at lines 317-320 for keeping `conversation_assigned` out of the poll ("a polled assignment would be dated by whatever the agent last did"); the same reasoning is not applied here. The same fixed id also collapses a reopen-and-reclose into one event dated at the second closure.

**Proposed fix.** Drop the `?? parseDate(str(c["userUpdatedAt"]), "userUpdatedAt")` fallback and emit `conversation_closed` only when `closedAt` parses — a closure with no close time is a row to skip, not to date from the last thing anyone did.

### conversation_assigned's eventId carries the assignee but not the assignment moment, so a re-assignment overwrites the earlier one

`helpscout.ts:209`

**Scenario.** The id is `${base}:assigned:${assignee}`, with no time component. Support conversations routinely bounce back: assigned to agent@x.io Monday 10:00, to bob@x.io Wednesday, back to agent@x.io Friday 16:00. The Friday delivery mints the same eventId as Monday's, and since the connector sets no `preserveOccurredAt`, `upsertEvents` overwrites `occurred_at` with the new value (src/ingestion/pipeline.ts:100). Monday's assignment count silently becomes 0 and Friday's becomes 1 — three real assignments reported as two, with one of them retroactively moved to a different day and week. Redelivery is not a reason to omit the time: a redelivered payload carries the same `userUpdatedAt`, so a time-bearing id stays idempotent.

**Proposed fix.** Include the assignment moment in the id, e.g. `${base}:assigned:${assignedAt.toISOString()}:${assignee}` (or a hash of the pair), so each assignment is its own event and a repeat assignee no longer clobbers its own history.

### A voicemail is classified as answered, so it lands as call_connected + call_completed with the voicemail length as talk time

`justcall.ts:125`

**Scenario.** An inbound call rings, no agent picks up, and the caller leaves a 45-second voicemail. JustCall returns call_info.type = "Voicemail" (one of the ten documented type values, per developer.justcall.io/reference/call_list_v21) with call_duration.conversation_time = 45 — total_duration is documented as conversation_time + hold_time, so a recorded voicemail carries a non-zero conversation_time. Line 125's `|| talk > 0` fallback (which exists to catch "In Progress" calls) makes `answered` true, so line 144 emits call_connected and line 148 emits call_completed with value 45. A pickup/connect-rate metric (call_connected over call_logged) counts every voicemail as a live conversation, and total/average talk time is inflated by voicemail recording lengths. Only "Answered" and "In Progress" are handled by name; "Voicemail" falls through the duration heuristic.

**Proposed fix.** Restrict the duration shortcut to the case it was written for: `const answered = /^answered$/i.test(type) || (talk > 0 && /^in\s*progress$/i.test(type));` and let "Voicemail" settle as call_missed — or emit the `voicemail_left` event type aircall.ts:54 already declares. Add a fixture with type "Voicemail" and a non-zero conversation_time to tests/justcall.test.ts, which currently has no such case.

### Pipedrive stage events are keyed by destination stage, so a deal re-entering a stage overwrites its earlier entry

`pipedrive.ts:59`

**Scenario.** `eventId` for a stage change is `${base}:stage:${stage_id}` with no discriminator for WHICH move it was (tests/pipedrive.test.ts:74 asserts `pipedrive:conn_1:deal:5:stage:3`). A deal that moves Qualified(2) → Proposal(3) at t2 and then back to Qualified(2) at t4 — routine in any pipeline with a negotiation loop — emits `…:stage:2` twice. Since `preserveOccurredAt` defaults to false (src/lib/sync/streams.ts:855), the second write rewrites the stored row's `occurred_at` from t2 to t4. The customer sees 3 stage transitions instead of 4, and the "entered Qualified" event silently jumps forward in time, moving a data point out of the week it belonged to. The webhook path (which delivers every hop) and the poll fan-out at line 124 both hit this.

**Proposed fix.** Make the id unique per transition rather than per destination stage: append the transition instant, e.g. `${base}:stage:${stage}:${stageAt.toISOString()}` (stage_change_time is already required to be present at line 58), so two entries into the same stage are two rows.

### Stage-change eventId omits the transition time, so a deal re-entering a stage overwrites its earlier move

`pipedrive.ts:59`

**Scenario.** `eventId` is `${base}:stage:${stage_id}` — the destination stage only. A deal that goes Qualification → Proposal → Qualification → Proposal produces `…:stage:proposal` twice with the same id: the second transition is deduped away and, worse, the stored row's `occurredAt` is rewritten from the first `stage_change_time` to the second. "Deals entering Proposal this week" undercounts, and an already-counted event silently moves to a different week. Both paths hit it — the webhook writes it per hop and the poll re-derives it from the deal's current `stage_change_time` — so the collision is not a webhook/poll disagreement that could be spotted by comparison.

**Proposed fix.** Include the transition instant in the key, e.g. `${base}:stage:${stage}:${d.stage_change_time}` — both paths carry `stage_change_time`, so webhook and poll still agree on one id per hop.

### `checkout_expired` is counted as a booking, permanently

`savvycal.ts:59`

**Scenario.** A paid scheduling link creates the event in `awaiting_checkout`; the booker never pays and SavvyCal moves it to `checkout_expired` (webhooks page: "Emitted when someone books a paid event, without paying and checkout expires"). The poll sends `state: "all"` (line 165), so that row comes back on every sweep, `NOT_BOOKED` only excludes `awaiting_approval`/`declined`, and `map` (line 181) mints `savvycal:<conn>:<id>` with eventType `booked`. `canceled_at` stays null for a checkout expiry, so the `extra` fan-out (lines 186-198) never emits a retirement, and `normalize` drops `event.checkout.expired` on the default branch (line 142). Verified against a stubbed page: a `checkout_expired` row yields exactly one `booked` record. Every abandoned checkout inflates the meetings-booked count forever, on the connector's own logic that "a declined one never became one".

**Proposed fix.** Add "checkout_expired" to NOT_BOOKED at line 59 so neither path mints a booking for it. (Rows already stored from the `awaiting_checkout` phase stay; retiring those needs an `event.checkout.expired` branch in `normalize`, but stopping the mint is the smallest correct change.)

### Clamping the mark to `now` strands cancellations of meetings that have already started

`savvycal.ts:178`

**Scenario.** `changedAt` clamps `start_at` to the poll's clock, so after any sweep that sees a future meeting the mark is ~now and `windowedWalk` sends `from = ymd(mark - 5min)`. Measured: stored mark 2026-09-20T00:00:00Z, poll at 2026-09-21T09:00Z, request goes out as `from=2026-09-19`. A meeting that started 2026-09-18 and is cancelled on 2026-09-21 (the everyday "cancel yesterday's no-show this morning" case) has `start_at` below the bound and never re-enters the window, so its `:canceled` event is never produced and the booked count keeps a meeting that no longer happened. The comment at lines 22-26 asserts the clamp "loses nothing"; it loses nothing only for *upcoming* meetings. `autoWebhook: false`, so a connection whose owner never pasted a webhook secret has the poll as its only path and loses these outright.

**Proposed fix.** Clamp to a lookback instead of the instant: `const capMs = now() - CANCEL_LOOKBACK_DAYS * 86_400_000` (a few days), so the day-granular `from` keeps recently-past meetings inside the request window; state the residual (changes older than the lookback are not polled) in the catalog `syncNote`.

### Poll and webhook mint different eventIds for the same send/open/click/reply, so making the webhook ingest would double-count every one

`smartlead.ts:121`

**Scenario.** `factKey` prefers `stats_id`/`email_stats_id` when present, and the connector's own fixture (tests/smartlead.test.ts:37) says statistics rows carry `stats_id`. The webhook payloads on guides/webhook-integration carry no stats id at all (smartlead.ts:26-28 says so), so they fall through to `to_email:sequence_number`. The tests pin both spellings of one fact side by side: line 198 asserts the poll produces `smartlead:conn_1:7:st1:email_sent`, line 107 asserts the webhook produces `smartlead:conn_1:123:lead@example.com:1:email_sent`. Two ids, one send. Today nothing doubles because the webhook path is inert (finding 1), which is exactly what makes this dangerous: the obvious repair for finding 1 — letting the delivery be stored so bounces and unsubscribes arrive — arms it. From that moment every send, open, click and reply on a campaign with an active webhook is written twice, once by the doorbell delivery and once by the next poll of the same row, and the campaign's sent/open/reply counts (and any rate computed from them) read exactly double.

**Proposed fix.** Make identity a function of the fact, not of the door it came through: drop the `stats_id`/`email_stats_id` branch at lines 121-122 so both paths key on `leadEmail(o)` + `sequence_number` — the only pair both a row and a delivery carry — or remove `normalize` outright so there is only one door. Whichever is chosen, add a test that builds the same send from a row and from a webhook payload and asserts one eventId, not two.

### Smartlead's `normalize` is unreachable, so bounces/unsubscribes/category changes are never ingested

`smartlead.ts:202`

**Scenario.** catalog.ts declares smartlead's `campaignId` flowField with no `readFilter`, so `isStreamScoped("smartlead")` is true (catalog.ts:1439-1441). The webhook route treats a stream-scoped source as a doorbell: it verifies, promotes cadence, sends `sync/connection.requested` and returns 202 WITHOUT calling `storeRawEvent`, so `pipeline.ts` never reaches `connector.normalize`. Everything only `normalize` can produce — `bounced` (EMAIL_BOUNCE), `unsubscribed` (LEAD_UNSUBSCRIBED), `lead_interested` / `lead_category_updated` (LEAD_CATEGORY_UPDATED) — can never be stored, because the poll's `ROW_FACTS` covers only sent/opened/clicked/replied. The catalog nonetheless promises the opposite (`syncNote`: "reach this connection through the webhook only"; `webhookSetup`: "bounces, unsubscribes and lead-category changes arrive this way and no other") and ships `eventTypeLabels: { lead_interested: … }`. A customer builds a bounce-rate or leads-marked-interested metric and it reads a permanent zero — the exact unreachable-normalize trap types.ts:441-452 documents for Google Sheets.

**Proposed fix.** Either give the `campaignId` flowField a `readFilter` (matching `campaign_id` in the payload) so deliveries are ingested and attributed, or delete `normalize`, drop the `webhookSecret` credential field, set `instant: false`, and correct the syncNote/webhookSetup so the product does not claim data it cannot hold.

### A partial refund is valued at the full order total, ignoring refunded_amount

`thinkific.ts:181`

**Scenario.** A customer is refunded $50 of a $199 order. `order_transaction.refunded` sets `value: money(order)` = 199, so the refund is overstated ~4×; net revenue (payments minus refunds) goes negative on an order that is still mostly paid. The payload carries `refunded_amount` (present in tests/thinkific.test.ts:83) and it is never read.

**Proposed fix.** Value the refund from `numeric(p["refunded_amount"])` when present, falling back to the transaction amount, and only then to the order total.

### rebill_failed carries the order total as `value` though no money moved

`thrivecart.ts:91`

**Scenario.** `MONEY_EVENTS` includes `rebill_failed`, so a declined card on a $97 subscription stores `value: 97, currency: "USD"` (pinned by tests/thrivecart.test.ts:162-165). A step that sums `value` across ThriveCart events — or any "revenue" metric that is not carefully filtered to `order_created` + `rebill` — counts a charge that never succeeded. The comment two lines above the assignment lists abandoned carts, pauses, resumes and cancellations as no-money and silently omits this one, and Stripe's connector applies the opposite rule (checkout.session.completed nulls its value until `payment_status === "paid"`).

**Proposed fix.** Drop `"rebill_failed"` from `MONEY_EVENTS`; the attempted amount stays available in `properties.order.total`.


## LOW

### subject falls back to tracking_id, a per-booking reference, turning count_distinct(subject) into a booking count

`oncehub.ts:91`

**Scenario.** `subjectOf` returns `form_submission.email`, else `attendees[0]` (an object in practice, so `str()` yields null), else `b["tracking_id"]` — OnceHub's per-booking reference number (the test fixture's `D36E0002` sits on a single booking). `subject` is the default `distinctField` for aggregates and funnels (src/lib/metrics/types.ts:33, src/lib/flow/types.ts:213). So one repeat customer whose bookings carry no form email books three times and a 'unique customers booked' metric reports 3 people instead of 1; the same events also never join by subject to any other source's records.

**Proposed fix.** Return null when neither a form email nor a real attendee identity is present, rather than a booking-scoped id — an absent subject is honest, a unique-per-row one is a wrong number.

### The poll fan-out test asserts the charge on `booked` but never that the sibling outcome event carries none

`oncehub.test.ts:237`

**Scenario.** The test is titled '…a paid booking's charge lands on `booked`' and pins `BKNG-H` as `{eventType: "booked", value: 125, currency: "EUR"}`, then checks only the DATES of `BKNG-H:held` and `BKNG-N:no_show`. The poll is the only place the 1-row→2-event fan-out actually happens, and nothing asserts `value: null` on the outcome, nor the total record count (4). Delete the `kind === "booked" ?` guard at oncehub.ts:109 and a single €125 booking emits €125 twice — once as `booked`, once as `:held` — doubling revenue, and this test still passes. Only the webhook-path assertion at line 148 pins the invariant, on a path where no fan-out occurs.

**Proposed fix.** Assert `value: null, currency: null` on `BKNG-H:held` and `BKNG-N:no_show`, and pin `res.records` to length 4, so the money-once rule is enforced where the fan-out lives.

### Any object with a status attribute slugged `stage` emits deal_stage_changed, including custom ones

`attio.ts:160`

**Scenario.** Attio derives an attribute's api_slug from its title, so a custom `projects` object with a status attribute titled "Stage" gets the slug `stage`. attioRecordEvents types its creation honestly as record_created (line 152, per the module's own "left honest for the rest"), but the same row then emits eventType "deal_stage_changed" — so an org-wide "Deal moved stage" metric counts project status moves as deal stage moves, mixed in with Pipedrive's and Attio's real ones.

**Proposed fix.** Gate the stage fan-out on the object having a declared deal meaning (`ATTIO_OBJECT_EVENT[object] === "opportunity_created"`), or type it record_stage_changed for objects outside that map.

### Only draft and hidden threads are excluded, so threads that were never sent count as replies

`helpscout.ts:147`

**Scenario.** The docs the module itself cites list the thread states as published / draft / bounced / hidden / review (the live page names the last one `underreview`: "stopped by Collision Detection and is waiting to be confirmed"). `threadKind` rejects only `draft` and `hidden`, so a thread held by Collision Detection — written but not sent, and possibly discarded — is emitted as `agent_replied` dated at its `createdAt`, and a `bounced` thread ("couldn't be sent due to an email delivery issue") is emitted as a reply the customer never received. Two agents typing at once produces an `agent_replied` at, say, 09:03 for a message the customer never got, which both inflates the agent-reply count and pulls first-response-time earlier than the customer actually experienced. Nothing retires it later, because the connector declares no `mirrorScope`.

**Proposed fix.** Invert the test — treat anything other than `state === "published"` as not a reply (allowing `bounced` only if a sent-but-undelivered agent reply is deliberately meant to count), and note the decision next to the state list in the header comment.

### subject switches identifier population between answered and unattended calls (agent email vs customer phone number)

`justcall.ts:141`

**Scenario.** `subject` is the product's identity axis — src/lib/metrics/compute.ts:179 counts `count(distinct subject)` per funnel stage and src/lib/metrics/types.ts:33 defaults `distinctField` to "subject". On JustCall an answered call carries agent_email, but an inbound call nobody picked has no agent (missed_call_reason "Call was not picked by any agent"), so line 141 falls back to contact_number. In an account with 5 agents, 100 calls, 60 answered and 40 unattended from 40 distinct numbers, a call_logged → call_connected funnel reads 45 distinct subjects at stage one and 5 at stage two — an 11% conversion that is neither the call-level answer (60%) nor the agent-level one (100%). The two sibling call connectors keep one population: close.ts:1043 and retell.ts:110 both use the counterparty.

**Proposed fix.** Pick one population and keep it null when absent rather than falling back across kinds — `const subject = text(c["contact_number"]) ?? text(c["contact_name"]);` to match close.ts/retell.ts, leaving agent_email in `properties` (it is already there at line 133 and in the catalog's commonFields). tests/justcall.test.ts:167 currently pins the cross-population fallback as intended, so that assertion moves with it.

### testFetchLatest returns the OLDEST records, because the poll walks ascending

`justcall.ts:270`

**Scenario.** `testFetchLatest` powers the connect-time "preview latest records" UX (types.ts:580). It polls with cursor null and maxCalls 1, and the request at line 251 sends `order: "asc"` from a 90-day floor — the test itself calls this "oldest-first" (tests/justcall.test.ts:177). So page one is the 100 OLDEST calls in the retention window, and `slice(0, n)` returns the oldest n. A customer connecting an account with more than 100 calls in 90 days sees a preview full of three-month-old calls and concludes the connection is broken or stale; with n = 3 they see one call's three lifecycle events from 90 days ago rather than three recent calls. retell.ts, whose walk is ascending in the same way, uses `records.slice(-n)` with an explicit comment for exactly this reason. Nothing in tests/justcall.test.ts exercises testFetchLatest, so the mismatch is unpinned.

**Proposed fix.** `return records.slice(-n);` as retell.ts:219 does (and note the slice is over the fanned lifecycle events, so n events is roughly n/3 calls). Add a test that polls a two-page fixture and asserts the preview holds the newest call's ids.

### Zero-decimal currencies divided by 100 although the currency is read on the same line

`savvycal.ts:83`

**Scenario.** A SavvyCal paid link priced at ¥5,000 arrives as `payment: { state: "paid", amount_total: 5000, currency: "JPY" }` (the schema is documented as additive and the code already reads `p["currency"]`). `value` becomes 50, understating the booking's revenue 100×, with `currency: "JPY"` attached so nothing downstream can tell. Every sibling connector (stripe.ts:42, paddle.ts:135, oncehub.ts:100, thrivecart.ts:213) applies a zero-decimal set here.

**Proposed fix.** Read the currency first and reuse the shared zero-decimal set: `const cur = str(p["currency"])?.toUpperCase() ?? null; value = cur && ZERO_DECIMAL.has(cur.toLowerCase()) ? p["amount_total"] : p["amount_total"] / 100`.

### A row with no `created_at` is dated `new Date()` instead of being dropped

`savvycal.ts:94`

**Scenario.** `map` at line 181 calls `meetingEvent` with no `fallback`, so `occurredAt: at ?? fallback ?? new Date()` stamps the poll moment. Verified: a row without `created_at` came back with `occurredAt` equal to wall-clock now — and it ignores the injected `budget.nowMs`, so no test can pin it. Because the ingest upsert (src/ingestion/pipeline.ts:113) overwrites `occurred_at` from `excluded` and this connector never sets `preserveOccurredAt`, that date marches forward on every sweep, reordering the record and making each unchanged sweep look like a change. The contract (docs/ADDING_A_CONNECTOR.md §3) says a missing timestamp should drop the row, and `windowedWalk` already supports that — a null `map()` skips the row while still advancing the mark.

**Proposed fix.** In `map`, resolve the date first and skip when absent: `const at = iso(e["created_at"], "created_at"); return !at || NOT_BOOKED.has(String(e["state"])) ? null : meetingEvent(e, args.connectionId, "booked", at);` and drop the `?? new Date()` tail at line 94 so nothing else can reach it.

### `testFetchLatest` returns the OLDEST meetings, not the latest

`savvycal.ts:202`

**Scenario.** It calls `poll` with `cursor: null`, which makes `windowedWalk` use the 90-day first-sync floor, and the page request hard-codes `direction: "asc"` (line 167). Verified: with now = 2026-09-20 the preview request went out as `from=2026-06-10&direction=asc&limit=100`, and `records.slice(0, n)` then takes the n oldest. The connect-time "preview latest records" panel shows meetings from three months ago, so a user who just booked a test meeting sees no sign of it and reads the connection as broken.

**Proposed fix.** Do not route the preview through `poll`. Call the client directly for the newest page, the way Calendly's `testFetchLatest` does: `client.get("/events", { limit: Math.min(n, 100), state: "all", attendance: "any", period: "all", direction: "desc" })` and map the entries.

### Zero-decimal currencies are divided by 100, and the disclosure the comment promises does not exist

`savvycal.ts:83`

**Scenario.** `amount_total` is divided by 100 unconditionally. SavvyCal payments are Stripe-backed and the documented Payment schema carries no currency, so a link priced in a zero-decimal currency (JPY, KRW) reports ¥5,000 as 50 with `currency: null` — a hundredfold understatement no downstream consumer can detect. The comment at lines 80-83 says this is acceptable "which is why the catalog entry says the amount is Stripe's minor units divided by 100" — the SavvyCal entry in src/connectors/catalog.ts (lines 1150-1189) says no such thing, so the assumption is stated only in a source comment the customer never sees.

**Proposed fix.** Put the assumption where the user reads it — extend the catalog `syncNote` at src/connectors/catalog.ts:1161 with "paid-checkout amounts are the provider's minor units divided by 100; SavvyCal publishes no currency, so a zero-decimal currency (JPY, KRW) will read low" — and correct or delete the cross-reference at savvycal.ts:82.

### No poll test round-trips a cursor, so the overlap, the resume offset and the first-sync floor are unpinned

`attio.test.ts:163`

**Scenario.** Both poll tests pass cursor: null, and the only assertion on the request bound is a regex on the ISO shape where the value is knowable. Set DEFAULTS.overlapMs to 0 (records created in the five minutes before the mark stop being re-read), or firstSyncDays to 1, or make fetchPage ignore `cont` so every poll restarts at offset 0 — the whole file still passes. The 501-record burst is exactly two pages, which is the default pagesPerPoll, so docs/ADDING_A_CONNECTOR.md §5's "a burst larger than the page cap is fully drained" (incomplete: true plus a JSON continuation cursor fed back in) is never exercised either.

**Proposed fix.** Add a poll with cursor "2026-09-01T10:00:00.000Z" asserting filter.created_at.$gte === "2026-09-01T09:55:00.000Z"; and a three-page burst asserting the first poll returns incomplete with a JSON cursor whose cont is "1000", then feeding that cursor back and asserting the request's offset is 1000 and the settled cursor is the bare newest created_at.

### The poll's most explicitly-argued behaviour — that conversation_assigned is never polled — is not pinned by any test

`helpscout.test.ts:173`

**Scenario.** Lines 317-320 of the connector argue at length that `conversation_assigned` must not come out of the poll because `userUpdatedAt` would date it by whatever the agent last did. Both poll fixtures (`convoA`, `convoB`) inherit `assignee: null` from the shared `convo()` helper, so `conversationEvents(..., "all")` never reaches the assigned branch in any test. Changing `"all"` to include `"assigned"`, or letting the branch fire for `which === "all"`, leaves all 11 tests green while every polled conversation with an assignee starts emitting `conversation_assigned` dated by the agent's last action — the exact wrong-dating the comment exists to prevent. The threads stub has the same shape of gap: `threadsA` carries no `page` envelope and `stubFetch` replays its last body, so a threads read that only ever fetches page 1 is invisible to the suite.

**Proposed fix.** Give one poll fixture an `assignee` (and a `userUpdatedAt` later than its `createdAt`) and assert the poll's eventId list still contains no `:assigned:` entry; add a threads fixture with a `page: { totalPages: 2 }` envelope and assert the connector follows it.

### No budgeted poll test: `incomplete`, the JSON continuation cursor and resuming from it are never exercised

`paddle.test.ts:233`

**Scenario.** Both poll tests run without a `budget`, so the walk always reaches `!page.next` and returns a settled bare-string cursor. The branch that stops at the page cap — `incomplete: true` plus a JSON `{hw,cont,maxSeen,floor,…}` cursor — and the next poll parsing that JSON back into `after: cont` (paddle.ts:310) are never run. A regression that serialized the wrong continuation, or that dropped `incomplete`, would ship green: a first sync of a busy Paddle account would restart at page 1 of the 90-day window on every sweep and the connection would be demoted as idle while still importing, with no test failing. docs/ADDING_A_CONNECTOR.md §5 requires exactly this ("cursor round trip, a burst larger than the page cap is fully drained").

**Proposed fix.** Add a poll test with `budget: { maxCalls: 1 }` against a queue of pages where `has_more` stays true: assert `res.incomplete === true`, that `res.nextCursor` parses as JSON carrying `cont` equal to the page's `after` id, then feed that cursor back into a second `poll` and assert the request carries `after=<that id>` and the same `billed_at[GTE]` floor, and that the final poll settles to a bare mark.

### The first-sync floor is asserted by regex when its exact value is knowable

`paddle.test.ts:255`

**Scenario.** `expect(u.searchParams.get("billed_at[GTE]")).toMatch(/^\d{4}-\d{2}-\d{2}T/)` accepts any ISO timestamp, so the 90-day first-sync reach (`DEFAULTS.firstSyncDays`, paddle.ts:85) is unpinned. Changing it to 9 days — which would silently truncate every new customer's imported history to nine days — leaves the whole suite green, even though the sibling test at line 272 shows the exact-value style is available (it pins the 5-minute overlap to `2026-09-01T09:55:00.000Z`).

**Proposed fix.** Freeze the clock (`vi.setSystemTime`) or pass `budget: { nowMs: () => FIXED }` and assert the bound equals the exact floor, e.g. `expect(u.searchParams.get("billed_at[GTE]")).toBe(new Date(FIXED - 90 * 86_400_000).toISOString())`.

### The fan-out test cannot catch money attached to the cancelled leg

`savvycal.test.ts:177`

**Scenario.** The cancelled fixture is built with `payment: null` (line 157), so `expect(res.records[1].value).toBeNull()` at line 177 passes whether or not `meetingEvent` suppresses money on non-`booked` legs, and `records[2].value` is never asserted at all. If the `kind === "booked" ? paid(e) : {…null}` guard at line 89 of savvycal.ts regressed, every cancelled paid booking would emit revenue twice — once on `savvycal:conn:id` and again on `savvycal:conn:id:canceled` — and this suite would stay green. `records[1].occurredAt` (the cancelled row's `booked` leg, `created_at` 2026-09-02) is likewise unasserted.

**Proposed fix.** Give the cancelled fixture `payment: { amount_total: 5000, state: "paid", url: null }` and assert `records[1].value === 50`, `records[1].occurredAt` is 2026-09-02T10:00:00.000Z, and `records[2].value` is null.
