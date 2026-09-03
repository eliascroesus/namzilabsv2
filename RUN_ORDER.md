# RUN ORDER — wiping the data and starting clean

> **Superseded on these points as of 3 September 2026** — treat any specific
> migration number or Action name in this file as history, not current
> state. See `STATE.md` for what is actually true today.
>
> Migrations did not stop at `0012`: they run to `0030` now, and every one is
> applied by hand into the Neon SQL Editor, one pasteable block per
> migration, per `drizzle/HAND_APPLY.md`. The *Database migration* Action
> this file warns against running no longer exists in any form — there is no
> migrator to run; everything is pasted by hand and checked with the *Schema
> drift check* Action. (The advice to skip it is still correct, just for a
> different reason now.)
>
> `PRE_LAUNCH_CHECKLIST.md`'s item 5 (one-time legacy-row reconciliation) is
> done, resolved by the 29 July 2026 data wipe. Sendblue has been removed
> from the product entirely — connector, catalog entry, scripts and tests.
> `PRE_LAUNCH_CHECKLIST.md`'s item 8 (the compiled query engine flag) is no
> longer a future step: `ENGINE_COMPILE_TEST` / `ENGINE_COMPILE` exist in the
> code today, off by default.

This is the whole procedure, in order, for emptying the synced data and letting
it rebuild from the providers. Follow it top to bottom. Every step says what a
good result looks like and what a bad one looks like, so you never have to guess
whether to keep going.

Nothing here is run from your laptop. Steps 3 and 5 are a GitHub Action.

**You do NOT need to run a database migration.** Nothing shipped in batch 1 or
batch 2 changed the shape of the database — no new tables, no new columns, no
new indexes. The last migration in the repo (`0012_connection_sync_lease.sql`)
was already applied long before this work started. If anyone suggests running
the "Database migration" Action as part of this, they are wrong; skip it.

**Two words used throughout:**

- A **connection** is one account you linked — your Calendly login, your Close
  API key, one Google account.
- A **stream** is one specific thing a flow reads through a connection — one
  spreadsheet tab, one calendar, one Instantly campaign. Some connections have
  streams and some do not; step 4 explains which.

---

## 1. Check the deploy is actually live

Open `https://<your-app-domain>/api/health` in a browser.

**Good:** you get JSON with `"status": "ok"`, and inside `checks` you see
`"database": "ok"`, `"missingRequired": []` and `"missingForBackgroundWork": []`.

**Also acceptable:** `"status": "degraded"` — but only stop and read why. It
means one of `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` or `APP_BASE_URL` is not
set on the deployment. **Do not run the reset in this state.** Background
syncing is what refills the data, and it will not run. You would end up with an
empty app and nothing bringing it back.

**Bad:** `"status": "unhealthy"`, a 503, a timeout, or a Vercel error page. The
deploy is not up or cannot reach the database. Fix that first. Nothing below
will work.

Also check in Vercel that the latest deployment is the one you expect, and that
it says Ready. Resetting against an old deploy means the data comes back in the
old shape.

---

## 2. Take a Neon branch snapshot

**This is the only undo.** The reset performs hard deletes — the rows are gone
from the database, not hidden. There is no button in the app that brings them
back.

In the Neon console: open the project → **Branches** → **Create branch** → base
it on your production branch, at **the current point in time**. Give it a name
you will recognise later, e.g. `before-reset-2026-07-27`.

**Good:** the branch appears in the list with today's date and a size roughly
matching production.

**Bad:** it fails, or it is created "from a specific time" that is not now.
Delete it and try again. Do not continue without a snapshot you can point at.

You do not need to change any connection string. The snapshot just sits there.
If something goes wrong you restore from it later.

---

## 3. Run the reset in INSPECT mode

GitHub → **Actions** → **Reset data** → **Run workflow**.

Set:

- **level**: `data`
- **mode**: `inspect`
- **confirm**: leave blank

Then run it.

`level: data` keeps everything you authored — your connections and their
credentials, your metrics, your flows and their published versions. It deletes
only what the product downloaded or calculated. `level: all` additionally
deletes connections, metrics and flows; you almost certainly do not want that,
and if you do, you have to type `all` into confirm at step 5.

Inspect mode writes nothing at all. It is safe to run as many times as you like,
at any point, including right now before you have read the rest of this.

**Good:** the run goes green and the job summary shows a table of row counts and
a list of streams.

**Bad:** it goes red saying `Secret DATABASE_MIGRATION_URL is not set` — the
repository secret is missing; set it to the production database URL and re-run.
Red with a connection error means the URL is wrong or the database is
unreachable. Either way, nothing was written.

---

## 4. Read the output before you delete anything

The summary has two things worth reading properly.

### 4a. The row counts

A list like `events`, `raw_events`, `sync_state`, and so on, with a number
beside each, and a total at the bottom.

**Good:** the numbers are in the range you would expect from how long the app
has been running and how many messages/meetings you actually have. The total is
the number of rows that will be deleted.

**Bad:** the total is zero when you know there is data — you are pointed at the
wrong database. Or it is wildly larger than expected (millions when you expected
thousands) — stop and find out why before deleting it.

### 4b. The re-register list

Under **STREAMS THAT WILL BE RE-REGISTERED** you get one entry per stream, like:

```
   1. gsheets — Google Sheets (you@example.com)
      resource: {"spreadsheetId":"1AbC…","range":"Leads"}
      used by:  Lead tracker, Weekly report
```

This matters because clearing the data also clears the record of which
spreadsheet tab, which calendar, which campaign each flow was reading. If those
were not put back, those connections would go quiet and stay quiet until you
opened every flow by hand. The reset puts them back automatically — this list is
what it will put back.

**Good:** every flow of yours that reads Calendly, Google Sheets, Google
Calendar or Instantly appears in a `used by:` line somewhere, and each resource
looks like the one you configured.

**Bad — and what to do about each:**

- **A flow is missing from the list entirely.** First check what it reads. Only
  four sources appear here: **Calendly, Google Sheets, Google Calendar,
  Instantly**. **Close and catch-hook webhook connections never
  appear**, because they sync at the account level and have no per-flow
  resource. A flow that only reads those is correctly absent — that is not a
  miss. If the missing flow does read one of the four, open it in the editor and
  check its Get data step actually has a resource chosen; a step with a
  connection but no spreadsheet/calendar picked has nothing to re-register.
  Choose it, save the flow, and re-run inspect.

- **The count is HIGHER than your number of flows.** Normal. One flow with two
  Get data steps reading two different tabs is two streams. Two flows reading
  the same tab are one stream listed under both names. Count entries, not flows.

- **The count is LOWER than you expect and a real flow is missing.** Do not
  apply. Fix the flow first (previous bullet) and re-run inspect until the list
  is right. Applying with a flow missing means that flow stops syncing after the
  reset, and you would only notice days later when its tile stays empty.

- **A resource looks wrong** — an old spreadsheet, a tab you renamed. The reset
  restores what the flow currently says. Change the flow first, save it, re-run
  inspect.

- **You see a warning about flows referencing a connection that no longer
  exists.** Those flows are already broken and the reset will not fix them.
  Re-point their Get data step at a live connection.

Do not go to step 5 until this list reads correctly.

---

## 5. Run the reset in APPLY mode

Same Action: GitHub → **Actions** → **Reset data** → **Run workflow**.

Set:

- **level**: `data`
- **mode**: `apply`
- **confirm**: type `data`

The confirm box has to match the level exactly. If it does not, the run stops
before it opens the database and nothing is deleted. This is deliberate: it
means a mis-click on the level dropdown cannot wipe your connections.

The run inspects first and prints that output again, then deletes. So the log
always contains the before-picture next to what it did.

**Good:** green run. The summary's second block ends with something like
`Re-armed 3 connection(s); re-registered 4 stream(s).` and the re-registered
number matches the number of entries you read in step 4b.

**Bad:**

- Red before it deleted anything, saying the confirmation did not match — you
  typed the wrong word in confirm. Re-run with it typed correctly.
- Red partway through. The script deletes in batches and is safe to re-run: run
  it again with exactly the same inputs. It picks up where it stopped and never
  deletes twice. If it fails the same way twice, stop and restore the Neon
  snapshot from step 2 rather than continuing.
- Green, but re-registered fewer streams than the list had. This only happens
  when a previous run was interrupted after that step, and the log says so. The
  end state is the same. Confirm it in step 6b.

---

## 6. Verification

Do these in order. 6a–6c immediately, 6d–6f after waiting.

### 6a. The data is actually gone

Re-run the Action in **inspect** mode (level `data`, mode `inspect`, confirm
blank).

**Good:** every row count is `0` except `source_streams`, which shows the number
of streams that were re-registered.

**Bad:** `events` or `raw_events` still shows a large number. The apply run did
not finish. Re-run apply.

### 6b. The streams came back

Same inspect output, or the app: open each flow and check the Get data step
still shows the right spreadsheet/calendar/campaign.

**Good:** `source_streams` count matches the re-register list from step 4b.

**Bad:** it is 0 while your flows do read Calendly/Sheets/Calendar/Instantly.
Something failed after the delete. Re-run apply — it re-registers every time.

### 6c. The connections are awake

Open **Integrations**, then click into each connection to see its detail page.

**Good:** the list shows every connection as active, and each detail page shows
no red "Paused, retrying automatically" banner and no error. Its **Last event**
field will read `—`, which is correct — the reset cleared it and the next sync
sets it again.

This is the point of the re-arm step: a connection that had been backed off to a
six-hour check, or paused by repeated failures, is put back to checking on the
normal schedule so it starts refilling immediately.

**Bad:** a connection shows an error, or its page shows a pause countdown. That
error is real and predates the reset (a bad credential, a revoked token).
Reconnect it.

### 6d. Data starts coming back — wait 10 to 15 minutes

The background sweep runs every 10 minutes. Nothing happens instantly.

**Good:** after one or two sweeps, a connection's page shows a **Last event**
time again, and opening a flow and pressing **Test** returns rows.

**Bad:** 30+ minutes and still nothing anywhere. Check `/api/health` again for
`missingForBackgroundWork` — if the Inngest keys are not set, the sweep is not
running at all and no amount of waiting will help.

### 6e. Less history than before is CORRECT

**Do not treat a smaller number as a failure.** First syncs are deliberately
bounded now:

- **Close** goes back 30 days (this is new — it previously walked the entire
  workspace history, which is what made it run for days).
- **Calendly** covers 30 days back and 90 days forward.
- **Google Sheets** reads the whole tab, so it comes back complete.

So if you had six months of Close data before, you get roughly one month back.
That is the intended behaviour, not data loss on top of the reset.

While a connection is still working backwards it says so — open the flow, press
**Test**, and the amber note under the result reads *"Still importing — covering
12 of 30 days so far, reaching further back each sync."* When that note
disappears, the import finished.

### 6f. Dashboard tiles refill

**Good:** tiles are empty right after the reset, then fill in as data arrives and
the recompute runs (also on a 10-minute schedule). Empty for the first 10-20
minutes is expected.

**Bad:** data is clearly present when you press Test on a flow, but its tile is
still empty an hour later. That is a recompute problem, not a reset problem —
open the flow and publish it again to force one.

---

## 7. Things you specifically do NOT need to do

- **No database migration.** Stated at the top; repeating it because it is the
  easiest thing to do by mistake. Batches 1 and 2 changed no tables, columns or
  indexes. Do not run the "Database migration" Action.
- **No redeploy.** The reset touches only the database. The one in-memory cache
  that matters holds provider identity for five minutes and expires on its own;
  the editor's label cache clears when you reload the page.
- **No touching organizations, users or memberships.** No level of this reset
  deletes an account. You will still be logged in.

---

## 8. If you need to undo it

Restore the Neon branch you created in step 2. That is the only route back —
there is no in-app undo, and re-running the reset does not reverse anything.

If you have already let it sit for a few hours and the data has partly rebuilt,
restoring the snapshot also throws away everything synced since. Decide which
you want before restoring.

---

## Deeper diagnostics, if something looks off

`scripts/stream-inventory.sql` is read-only and written for the Neon SQL Editor:
paste it in and run it. It shows, per stream, how many rows are visible, how many
are retired, and the oldest and newest thing stored — which is the fastest way to
see whether a connection is genuinely empty or just has a short history.
