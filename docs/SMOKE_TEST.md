# Production smoke test

Run this after each production deploy. It exercises the critical paths end-to-end
against the live environment. Estimated time: ~10 minutes.

Prerequisites: `DATABASE_URL` (pooled) and `DATABASE_MIGRATION_URL` (direct) set,
migrations applied (`pnpm db:migrate`), WorkOS + Google + Inngest env configured.

---

## 1. WorkOS auth + organizations

- [ ] Visit `/` while logged out → the home page renders (no 500) with **Sign in** / **Get started**.
- [ ] Click **Sign in** → lands on `/sign-in` → redirects to WorkOS AuthKit (no cookie error).
- [ ] Complete sign-in → redirected back to `/dashboard`.
- [ ] New user with no org → redirected to `/onboarding`; create a workspace → lands on `/dashboard`.
- [ ] Header shows the org; if you belong to 2+ orgs, the **switcher** changes the active org and the dashboard data changes with it.
- [ ] Visit `/admin` → 308/permanent redirect to `/dashboard`.
- [ ] Hit `/dashboard` in an incognito window (logged out) → redirected to WorkOS sign-in.
- [ ] **Sign out** → returns to the home page; `/dashboard` is no longer accessible.

## 2. Custom Webhook (generic catch-hook)

- [ ] `/integrations` → connect **Custom Webhook**; open the connection page and copy the **inbound URL** + **signing secret**.
- [ ] Send a signed test event:
      ```bash
      BODY='{"id":"smoke-1","type":"booked","email":"a@b.com","value":1}'
      SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SIGNING_SECRET" -hex | sed 's/^.* //')
      curl -sS -X POST "$INBOUND_URL" \
        -H "content-type: application/json" \
        -H "x-namzilabs-signature: sha256=$SIG" \
        --data "$BODY"
      ```
      Expect `202 {"ok":true,...}`.
- [ ] Send the same event again → still `202`; the dashboard shows **one** canonical event (deduped).
- [ ] Send with a wrong signature → `401`.
- [ ] `/dashboard` shows the event under "Latest canonical events" and a `success` delivery.

## 3. Inngest (durable processing + reconciliation)

- [ ] In the Inngest dashboard, confirm the app is synced from `https://<domain>/api/inngest` and lists `process-inbound-event`, `reconcile-connections`, `reconcile-one-connection`.
- [ ] The webhook event from step 2 shows a completed `process-inbound-event` run.
- [ ] Trigger **Re-sync now** on a poll-capable connection → a `reconcile-one-connection` run completes.
- [ ] Confirm the `reconcile-connections` cron is scheduled (every 10 min) and its last run succeeded.
- [ ] Force a failure (e.g. temporarily bad connector config) → after retries it lands in the **dead-letter queue** on `/dashboard`; **Re-sync / replay** clears it.

## 4. Google Sheets (OAuth + poll-primary)

- [ ] `/integrations` → **Connect with Google Sheets** → Google consent → back to the connection page (no `state_mismatch` error).
- [ ] Tampered/replayed callback (old `state`) is rejected with `?error=state_mismatch`.
- [ ] Set **Spreadsheet ID** + **range**, save → **Preview latest** shows the last 2–3 real rows.
- [ ] Add a new row in the sheet → **Re-sync now** → the new row appears as a `row_added` event on `/dashboard`; re-syncing again does not duplicate it.
- [ ] Edit a cell on an OLD row (e.g. flip `booked` to Yes) → **Test this step** on a flow reading the sheet → the count reflects the edit immediately; within one 10-minute sweep the dashboard tile updates with no user action (mirror sync).
- [ ] Delete a middle row in the sheet → after the next sweep the flow count drops to match the sheet exactly (soft-deleted rows never show).
- [ ] Let the OAuth access token expire (>1h) → a later poll/preview still works (token auto-refreshed and persisted).

## 5. Flows canvas + materialized dashboard (M1–M3)

- [ ] `/dashboard/flows` → **New flow** opens the canvas.
- [ ] Build **App → Filter → Aggregate → Output**; **Test** each node → shows records in/out + latest 3 samples; the variable picker lists upstream fields.
- [ ] **Publish** → a stored tile appears on `/dashboard` with a freshness badge and `Updated …` time.
- [ ] Edit the draft (e.g. change the filter) — the published dashboard tile does **not** change until you **Publish** again (immutable version).

## 6. Sync / data system (M4)

- [ ] Connect a poll-capable source → the connection page **Data status** shows `importing…` then `synced`/`live`; **Last full sync** gets a timestamp (initial historical backfill ran via Inngest `sync-connection`).
- [ ] **Data & sync → Sync new** → an incremental `sync-connection` run completes; only new upstream records are added (no deletions).
- [ ] Delete a record upstream, then **Full re-sync** → the working dataset stays visible during the run; afterward the removed record is soft-deleted (gone from `/dashboard` and node tests) while everything else is preserved (generation swap).
- [ ] **Reprocess** → re-normalizes from stored raw events with no provider calls; canonical events are unchanged in count.
- [ ] In a published flow that reads the synced source, land new data → its dashboard tile flips to **stale**; the `materialize-stale` cron (every 10 min) or a manual **Refresh** on the tile recomputes it back to **fresh**.
- [ ] Open a flow in the canvas and select the **App** node → the Setup tab shows the connection's live **Data status** dot; an `outdated`/`error` connection links to **Manage**.

## 7. Canvas v2 UX + fixes

- [ ] Apply migration `0003` first — all previously-built flows are gone (expected; no back-compat).
- [ ] Canvas has no permanent left palette. **+ Add step** (toolbar), the **+** on a node's right edge, and the **+** on a connection all open the searchable **Add a step** library; picking a tool adds/inserts it (auto-connected).
- [ ] Nodes show **step number + icon + editable title** (e.g. "1. Google Sheets"), with the node type as secondary text; renaming in the config header updates the card.
- [ ] Config tabs are a guided progression: **Setup / Configure / Test** with ✓ checkmarks, Test disabled until setup is complete, and one primary CTA that reads **Fix N required fields → Continue → Test node**.
- [ ] Variable picker (the **+** by a field) shows **Standard fields before any test**, then adds each tested upstream step's custom fields with type + sample value pills, grouped by step.
- [ ] Add a **Formula**: it has two labeled input handles (e.g. **Numerator / Denominator**); the card and Configure tab show the live expression (`A ÷ B × 100`); connecting Aggregate→A and Aggregate→B computes correctly regardless of connection order.
- [ ] Filter operators read in plain language (Exactly matches, Does not match, Starts with, …); **is empty / is not empty** hide the value box.
- [ ] Test tab shows **"56 of 74 records passed"** and a compact **Before / After** sample preview.
- [ ] **Auto layout** tidies the graph left→right; **Fit**, **Align**, and **Collapse/Expand** work; edges are smoothstep (no overlap tangles).
- [ ] Publishing a valid flow shows the tile immediately on `/dashboard`. Force a compute failure (e.g. divide by an empty field) → banner reads **"Flow published, but the dashboard result could not be calculated."** (not a publish failure).
- [ ] Integrations connect form shows real field **labels** with example placeholders (nothing looks pre-filled); Calendly has a **Fetch meetings for** dropdown (User / Organization / Group).
- [ ] Reload `/onboarding` as a user who already has a workspace → you're offered to **enter** an existing workspace, and creating is behind an explicit "Create another workspace" — no duplicate org is minted.

---

If any box fails, capture the response/log and do not promote the deploy.
