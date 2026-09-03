# How the backend works — in plain English

This document explains the whole backend of Namzilabs in simple language,
with no assumed technical knowledge. Read it top to bottom once, and you will
understand what every part does, why it exists, and how to check for yourself
that it works. Wherever something can be verified, this document says how.

---

## 1. The one-sentence job

**The backend's job is: pull your customers' data out of the tools they
already use (Close, Calendly, Instantly, Google Sheets, Google
Calendar, Whop, or any custom source), keep one clean, always-up-to-date copy of
it, and turn it into the numbers on their dashboard — without ever losing
data, mixing up two customers, or getting banned by the tools it pulls from.**

Everything below exists to make that one sentence true.

---

## 2. The big picture (an analogy)

Think of the backend as a small, very careful shipping company:

- **The mailroom** receives packages the moment senders drop them off
  (webhooks — the tools *push* data to us the instant something happens).
- **The courier** also drives a route every 10 minutes and picks up anything
  the mailroom missed (polling — we *ask* the tools "anything new?").
- **The warehouse** stores every item exactly once, labeled with whose it is
  (the one big `events` table).
- **The accountant** makes sure the courier never knocks on any tool's door
  more often than that tool allows (the rate budget system).
- **The calculator** turns warehouse contents into dashboard numbers, ahead
  of time, so pages load instantly (flows and tiles).
- **The night shift** cleans up old paperwork, checks that every part of the
  operation is still actually moving, and emails you if something silently
  stopped (retention, the nightly scan, the alert email).

Two rules run through the whole company: **never throw away an original**,
and **never guess when you can verify**.

---

## 3. The journey of one piece of data

Say a lead gets updated in Close. Here is everything that happens:

### Path A — the instant path (webhook)

1. Close sends a message to our address the moment the lead changes.
2. **The door checks ID.** Every incoming message must carry a valid
   cryptographic signature — proof it really came from the tool it claims to
   be from, not from a stranger. Wrong or missing signature → rejected.
   Messages over 1MB are rejected too. Close, Calendly and Whop also sign a
   timestamp, so a captured message replayed more than 5 minutes later is
   rejected as stale; the other sources don't sign one, so this particular
   check is specific to those three. Your own custom webhook is the one
   deliberately open door: until you set a signing secret on it, it accepts
   anything (there is nothing else to check it against), and starts
   verifying every message the moment you do. Every rejection — bad
   signature, oversized body, a signing secret that failed to decrypt —
   leaves a row in the delivery log (status "rejected"), so a connection
   silently failing every delivery now shows up instead of leaving no trace
   at all.
3. **The original is saved first, untouched.** Before we do anything else,
   the raw message is stored exactly as received (the `raw_events` table).
   This is our "keep the original receipt" rule — if anything ever goes
   wrong later, we can re-process from the original.
4. **The message is translated** into our standard format: every source's
   data, whatever it looks like, becomes the same kind of row — what
   happened, when, to whom, with all the details attached.
5. **It's written to the warehouse exactly once.** Every row has a unique
   fingerprint (its event ID). If the same event arrives twice — which
   happens all the time with webhooks — the second copy is recognized and
   merged, never duplicated. This is why a webhook AND a poll seeing the
   same record produce ONE row, not two.
6. The dashboard's numbers that depend on this data are marked "stale"
   immediately, by the same step that just wrote the data — not by sending a
   signal and hoping something downstream picks it up. (An earlier version
   did exactly that — a "data changed" announcement a separate step listened
   for — and on production it went undelivered for a full day of new rows
   before anyone noticed the tiles hadn't moved. Nothing announces it
   anymore; see section 8 for how "stale" turns back into a fresh number.)

### Path B — the safety net (polling)

Webhooks can be missed — a provider hiccup, a moment of downtime. So a sweep
visits each connection and asks "what's new since my bookmark?" Each
connection keeps a **bookmark** (called a cursor) marking exactly where its
last read ended, so the sweep never re-reads everything — it picks up
precisely where it left off. Anything the webhook already delivered gets
deduplicated by the fingerprint; anything the webhook missed gets caught
here. **This is why the system "never misses" — the instant path is fast,
and the poll path is guaranteed.**

Every connection starts on a **10-minute** sweep. A connection that hasn't
changed anything in a while backs off — 10 minutes, then 30, then 2 hours,
then 6, then once a day — so a quiet account costs almost nothing, and any
new activity (or a person clicking something) snaps it straight back to 10
minutes. A connection whose webhook has proven itself healthy recently widens
its floor to 60 minutes instead, since the instant path is already doing the
real-time work and the poll is only a backstop for it.

Some sources (Calendly, Instantly, Sheets, Calendar) are organized into
**streams** — one bookmark per resource (one spreadsheet tab, one calendar,
one campaign) rather than one per account — so each flow's data source
tracks its own progress independently.

*A brief incident, because it's the kind of failure this design is meant to
survive.* For a few weeks in August 2026, a misconfiguration (three of the
backend's background jobs used a JavaScript shorthand their task scheduler's
expression language doesn't support) meant only 4 of the backend's 12
background jobs were actually registered and running — including the
historical-import job and the nightly cleanup-and-health-check job. It went
unnoticed on the dashboard because the sweep that stayed running already
recomputes tiles directly on every pass (the paragraph above this one), so
numbers kept updating the whole time; what silently stopped was history
import, the nightly retention sweep, and the health scan that would normally
have flagged the problem itself. Fixed 31 August 2026, and now guarded by
tests that check every background job's configuration is syntactically valid
and fits inside the account's capacity, rather than trusting either by eye.

---

## 4. Connections — the keyring

A **connection** is one linked account (your customer's Close account, their
Google login, etc.).

- Their passwords/keys are **encrypted before touching the database**
  (AES-256, the standard banks use). Nobody reading the database can see
  them.
- Connecting automatically registers the webhook with the provider where
  supported, and immediately starts a first sync — so data shows up right
  away, not at the next sweep.
- Disconnecting **hides** the data instead of destroying it. Reconnect
  within 30 days and everything comes back exactly as it was. Only after
  30 days disconnected does the original raw copies of its messages become
  *eligible* for cleanup — and even then, nothing is actually deleted until
  you turn that on (`STORAGE_PRUNE_LIVE=1`); until you do, the nightly job
  only reports what it would have removed. The customer-visible records
  themselves are never touched by this — see the warehouse guarantees below.
- There is a second, separate way to remove a connection: **Delete
  permanently**. Unlike Disconnect, this is immediate and cannot be undone —
  it erases the connection and every row belonging to it across ten tables —
  so it asks you to type the connection's name first, to make sure a click
  wasn't a mistake.
- Each workspace can create at most 10 connections and 25 flows (adjustable)
  — a guard against runaway scripts, not a business limit.

---

## 5. The warehouse — one table of truth

Every source's data lands in **one table called `events`**, in one standard
shape. Everything the dashboard shows is computed from this table.

The important guarantees:

- **Exactly once.** The fingerprint (event ID) makes duplicates impossible
  by construction — the database itself refuses a second copy.
- **Never hard-deleted by sync.** When a record disappears at the source
  (a canceled meeting, a deleted spreadsheet row), our copy is only
  *marked* deleted (a "tombstone"), never destroyed. If the record comes
  back, the tombstone comes back to life with its history intact.
- **The tenant wall.** Every row carries the ID of the workspace it belongs
  to, every read filters by it, and the write path itself refuses to let one
  connection's data overwrite another's — even in the theoretical case of
  two sources producing the same fingerprint. There is a dedicated test
  suite (`tests/tenant-isolation.test.ts`) that deliberately tries to make
  one workspace see another's numbers, and fails the build if it ever can.

---

## 6. The accountant — never getting banned

Every tool we pull from has rules: "no more than X requests per minute."
Break them repeatedly and they ban you. This is the part of the backend that
makes that impossible:

- **Every single request is pre-approved.** Before any call to any provider,
  the code asks a ledger in our own database: "may I spend one call?" The
  ledger tracks spending per connection, per endpoint, per minute. No
  approval, no call — the work politely waits and retries later. Nothing is
  ever lost by waiting; the bookmark just stays where it was.
- **The window slides.** A naive per-minute counter lets you spend a full
  minute's allowance at 11:59:59.9 and again at 12:00:00.1 — double the
  allowed rate in a fraction of a second, which is exactly what gets
  accounts flagged. Our counter carries the previous minute's spending
  forward proportionally, so that trick is impossible.
- **Three priority lanes.** A person clicking "Test" in the editor
  outranks the background sweep, which outranks a big historical import. A
  busy system never makes a human wait behind a robot.
- **Google is special.** All customers' Google traffic goes out under ONE
  Google project of ours, so there's an extra shared budget that protects
  everyone from any one customer's volume.
- **We listen to the provider.** Many tools state their real limit in every
  response. We record those statements (that's what `observed-limits.sql`
  reads back) and obey "you have 0 remaining" immediately instead of
  discovering it the hard way.
- **A "slow down" is not a failure.** If a provider says "too many requests"
  (a 429), we pause exactly as long as it asks — we do NOT treat the
  connection as broken.
- **Real failures self-heal.** A genuinely failing connection (bad
  credentials, provider outage) is paused on a ladder — retry in 1 hour,
  then 4, then daily. Every pause has an expiry. Nothing is ever
  permanently dead; everything probes its way back automatically.

**How much data per visit?** Each sweep visit spends only what the ledger
says is actually available, within a 25-second time box, up to a memory
safety cap. In plain terms: on a quiet account, a visit is one small
request; on a busy account, the same visit legally pulls thousands of
records. The system scales its appetite to its allowance automatically.

---

## 7. The history importer — backfill

When a customer connects a source, they usually want the past 90 days, not
just today onward. The same thing happens any time a genuinely *new* stream
shows up on a connection that already exists — a spreadsheet tab, a calendar,
a campaign nobody had picked before — it gets its own 90-day import queued
automatically, with no button to remember to press. Historical imports are
their own system because they're big:

- They run in **small slices**, dispatched from the same 10-minute tick that
  runs the regular sweep, in the lowest priority lane, so they never crowd
  out live syncing. A connection with history left to import drains up to
  12 slices (about 45 seconds) every time that tick comes around, instead of
  one slice per wake — so a long import finishes in minutes, not hours.
- Every slice saves a **checkpoint**. If anything dies mid-import, the next
  slice resumes exactly where the last one saved — never starting over,
  never re-downloading.
- **Tenants take turns.** If two customers are both importing from Calendly,
  their imports interleave slice by slice — one customer's 90-day import
  can't make another's wait hours.
- The dashboard tells the truth during an import: a tile fed by one shows
  **"Still importing — covering 12 of 90 days"** instead of presenting a
  partial number as final.

---

## 8. The calculator — flows and tiles

A **flow** is a recipe a customer builds visually: get data → filter →
group → count → show on the dashboard.

- When a flow is **published**, its numbers are computed and **stored**
  (in `flow_results`). The dashboard reads stored numbers — that's why it
  loads instantly regardless of data size.
- When new data arrives, affected numbers are marked stale immediately (a
  direct write, not an announcement that something downstream has to catch —
  see section 3) and recomputed shortly after: a debounced pass per
  workspace so a webhook storm doesn't trigger a hundred recalculations, AND
  again as part of every connection's routine 10-minute sweep, so a recompute
  is never waiting only on the debounce. That same sweep also nudges along
  one slice of that connection's history import, if it has one running, so a
  backfill makes some progress even on a quiet tick.
- The browser quietly asks "did anything change?" every 12 seconds using a
  fingerprint of the results — a near-free question — and only refetches
  when the answer is yes. Open dashboards cost almost nothing.
- **Every number carries its receipts.** Stored beside each tile is the
  exact query that produced it and when — so any number a customer questions
  can be traced.
- **Honesty over polish**: a broken tile shows its actual error and a link
  to fix it; a partial number says it's partial; "Data as of 3:41 PM" is on
  every tile.
- There is a faster calculation engine (it pushes filtering into the
  database instead of doing it in application code). It is fully built,
  proven to produce identical answers, and **switched off** until you flip
  its switch (`ENGINE_COMPILE_TEST=1` first, then `ENGINE_COMPILE=1`).
  Flipping back is instant.

---

## 9. The repair shop — when a message can't be processed

Sometimes a message arrives that the translator chokes on (malformed data,
an unexpected shape). The rule is: **never drop it, never let it break
anything else.**

- After 5 automatic retries fail (recorded as 6 attempts, counting the first
  try), the message is parked in the **dead-letter queue** — a holding
  shelf. The original raw copy is intact.
- The dashboard shows a red count linking to the connection's page, where
  each parked message is listed with its error and a **Replay** button.
  Replay re-processes the original — no re-downloading, no provider calls.
- One poisoned message never stops the connection: syncing continues around
  it, and the connection itself is left active rather than flagged as
  broken — a bad message says nothing about whether the credentials or the
  provider are healthy, so it isn't treated as if they weren't. The
  connection's error banner still shows what failed, and Replay clears it.

---

## 10. The night shift — cleanup and self-checks

Every night at 3:17 AM, five things happen, in order:

**1. Tidy the editor.** Test runs left over from the flow editor's "Test"
button are cleared out once they're a day old, so the editor's own scratch
space never accumulates.

**2. Cleanup (retention).** Operational records that only matter briefly are
deleted on schedules: processing logs after 30 days, spent rate-limit
counters after 2 days (rare "evidence" rows kept 90), raw originals only for
connections disconnected 30+ days, and tombstones (soft-deleted rows) older
than 30 days on active connections. Customer data itself is never aged out.
**Important: all of this is currently in rehearsal mode** — every night it
reports exactly what it *would* delete and deletes nothing, until you flip
`STORAGE_PRUNE_LIVE=1` after reading one night's report (the procedure is
checklist item 7b).

**3. Measure the backlog.** A capacity check with no switch: how many rows
are currently sitting past their retention window, still waiting to be
cleaned up. A backlog that keeps growing night after night means cleanup is
falling behind how fast data comes in — visible here before it turns into a
storage problem.

**4. The webhook event-time scan.** For every custom-webhook connection,
work out which field in its payloads actually holds "when this happened,"
and record the answer. Same rehearsal-mode idea as cleanup: purely an
observation until you turn it on, and it changes nothing about how events
are dated in the meantime.

**5. The "is work still happening?" scan, and the alert email.** Most
monitoring asks "did this task fail?" This scan asks the more dangerous
question: "is anything that should be moving quietly standing still?" It
looks for streams nobody has polled in a day, imports that claim to be
running but haven't progressed, connections failing over and over,
connections being throttled hard enough that it matters, a paged scan stuck
restarting instead of advancing, dead letters sitting unresolved, endpoints
rejecting deliveries, mirrors that read successfully yet hold nothing, and —
specific to Close — a bookmark aging toward Close's own 30-day
data-deletion cliff (Close permanently deletes its event history after 30
days; we warn at 25). The findings used to go into a log line at 3 AM that
nobody reads. Now, if the scan finds anything, it emails you (this is
Resend). This needs three values in Vercel (`RESEND_API_KEY`,
`ALERT_EMAIL`, `ALERT_FROM` — free Resend account, ~2 emails/day maximum).
**Until you add them, the email part is asleep: nothing breaks, findings
just stay in the logs.** The code is ~22 lines, costs nothing, and was
verified to be the smallest possible way to do this (nothing else in the
stack can send email, and the researched write-up is in the git history).

---

## 11. The instruments — how the system tells you the truth

- **`/api/health`** — answers "is the app up?" to anyone (just an ok/not-ok),
  and gives full detail (which settings are missing, what the database said)
  only to callers holding a secret token. Point a free uptime monitor at it.
- **The Schema drift check** (a button in GitHub Actions) — compares the live
  database against what the code expects, table by table, column by column.
  It checks 23 tables / 228 columns. The 3 September 2026 run found one gap:
  the `user_profiles` table (migration 0030) is missing in production — see
  `STATE.md` for the run and what it means for the profile feature.
- **The invariant scan + alert email** — section 10.
- **The dead-letter page** — section 9.
- **Every tile's "Data as of…" stamp and import-progress bar** — section 8.

---

## 12. The safety rules (the never-list)

These are the promises the design enforces, each with tests that fail if a
change ever breaks them:

1. **Never lose data silently.** Originals kept, soft-deletes only,
   dead-letter instead of drop, checkpoints instead of restarts.
2. **Never get banned.** No provider call without ledger approval; sliding
   windows; obey the provider's own statements; pauses instead of retries
   when told to slow down.
3. **Never mix tenants.** Workspace ID on every row, every query, and inside
   the write path itself; adversarial tests.
4. **Never show a wrong number confidently.** Dedup by construction,
   receipts on every tile, partial data labeled partial, broken tiles say
   why.
5. **Never a permanent failure state.** Every pause expires; everything
   probes itself back to life; a lost webhook subscription re-creates
   itself on the next sweep.
6. **Never two workers on the same job.** Every sync path — the sweep, the
   "Sync now" button, historical imports, the editor's Test — takes the same
   lock per connection, so no two can double-spend calls or tangle
   bookmarks.

---

## 13. What is deliberately asleep or waiting (the complete list)

Nothing here is broken or unfinished — each is a switch or an observation,
by design:

| What | State | Wakes up when |
|---|---|---|
| Alert emails (Resend) | Asleep | You add the 3 values to Vercel |
| Deletion (retention) | Rehearsal mode | You flip `STORAGE_PRUNE_LIVE=1` after one night's report |
| Faster calculation engine | Off | You flip `ENGINE_COMPILE_TEST=1`, soak, then `ENGINE_COMPILE=1` |
| Close's full speed | Capped at a safe guess | You send the `observed-limits.sql` output after a day of traffic (then it's a one-line change) |
| Close live webhook | Built, never witnessed | You edit one lead in Close and see it arrive |
| Health-detail token | Unset | You add `HEALTH_CHECK_TOKEN` + point an uptime monitor |
| Pool database driver | Off | A later, documented rollout (checklist item 4) |

---

## 14. How to question and verify any of this

- **"Prove no duplicates."** `tests/dedupe.test.ts` and the fingerprint
  uniqueness are enforced by the database itself; run `pnpm test`.
- **"Prove tenants can't see each other."** `tests/tenant-isolation.test.ts`
  actively tries to leak data across workspaces.
- **"Prove you don't overspend providers."** `tests/provider-gateway.test.ts`
  includes the exact burst-at-the-minute-boundary attack, denied.
- **"Prove a killed import resumes."** `tests/backfill-lane.test.ts`.
- **"Prove the database matches the code."** The Schema drift check button —
  you ran it, it passed.
- **"Prove deletion can't touch live data."** `tests/storage-lifecycle.test.ts`
  includes a test where a row comes back to life mid-deletion and survives.
- **Everything at once:** `pnpm test` — 1,104 checks, every one written so it
  FAILS against the old, broken version of whatever it guards.

---

## 15. Glossary

- **Webhook** — a tool calling US the moment something happens (push).
- **Poll / sweep** — us calling the tool on a schedule to ask what's new (pull).
- **Cursor / bookmark** — the saved position marking where the last read ended.
- **Stream** — one synced resource (a tab, a calendar, a campaign) with its own bookmark.
- **Event** — one standardized row in the warehouse: something that happened.
- **Fingerprint / event ID** — the unique identity that makes duplicates impossible.
- **Tombstone** — a row marked deleted but kept, so it can come back.
- **Dead letter** — a message that failed processing, parked safely for replay.
- **Rate limit** — a provider's "no more than X requests per minute" rule.
- **Ledger** — our own record of spending against those rules, consulted before every call.
- **Lane** — priority class: person > background sweep > historical import.
- **Backfill** — importing history in resumable slices.
- **Flow / tile** — a customer's visual recipe, and its precomputed dashboard number.
- **Materialize** — computing and storing a tile's number ahead of time.
- **Lease / lock** — the "one worker per connection at a time" rule.
- **Migration** — a change to the database's shape, applied by pasting SQL into Neon (per `drizzle/HAND_APPLY.md`).
- **Drift check** — the button that verifies the live database matches the code.
