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
- [ ] Add a new row in the sheet → **Re-sync now** → the new row appears as a `row_added` event on `/dashboard`; re-syncing again does not duplicate it (row cursor).
- [ ] Let the OAuth access token expire (>1h) → a later poll/preview still works (token auto-refreshed and persisted).

---

If any box fails, capture the response/log and do not promote the deploy.
