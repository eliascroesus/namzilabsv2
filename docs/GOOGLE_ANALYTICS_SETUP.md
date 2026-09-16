# Turning on the Google Analytics connector

Everything in the code is done. What is left is Google's side, and it is mostly
waiting rather than clicking.

**Read the warning in "Before customers touch it" first.** The build is finished
and the connector still cannot be given to a customer until verification comes
back, so the submission wants starting now, not after testing.

---

## What the code already does

- Reads GA4 through the **Data API v1beta** (`runReport`).
- Lists the customer's properties through the **Admin API v1beta**
  (`accountSummaries.list`), so they pick from a dropdown rather than pasting an id.
- Asks for exactly one new scope: `https://www.googleapis.com/auth/analytics.readonly`.

**No new environment variables.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`APP_BASE_URL` already exist, and one Google OAuth client backs all three Google
sources — the callback is derived per *provider*, not per source.

**No redirect URI change.** The callback is
`${APP_BASE_URL}/api/oauth/google/callback`, which is the same URL Calendar and
Sheets already use and which Google already has registered.

---

## 1. Enable two APIs (5 minutes)

Use the **same Cloud project** that already backs Calendar and Sheets — the one
whose client id is in `GOOGLE_CLIENT_ID`. A second project would need a second
client id and there is no slot for one.

1. <https://console.cloud.google.com/apis/library>, with that project selected.
2. Search `Google Analytics Data API` → **ENABLE**.
3. Search `Google Analytics Admin API` → **ENABLE**.

Both are needed: the Data API cannot list properties and the Admin API cannot
read numbers.

**Do not enable "Google Analytics API"** — that is the old v3, for Universal
Analytics, which stopped processing hits in July 2023 and had its data deleted a
year later. There is no UA support in this connector on purpose.

---

## 2. Add the scope (5 minutes)

1. **APIs & Services → Google Auth Platform → Data Access** → **ADD OR REMOVE
   SCOPES**.

   ⚠ Google replaced "OAuth consent screen" with **Google Auth Platform**
   (tabs: *Branding*, *Audience*, *Data Access*, *Clients*, *Verification
   Center*). Older guides — including most screenshots online — still say
   "OAuth consent screen → Scopes", which no longer exists.
2. Paste into the filter box, exactly:
   ```
   https://www.googleapis.com/auth/analytics.readonly
   ```
3. Tick it. It reads *"See and download your Google Analytics data."* → **UPDATE** → **SAVE**.
4. Check it lands under **sensitive scopes**. That placement is Google telling
   you it needs review.
5. Check nothing else got dropped. The full list should be `openid`,
   `userinfo.email`, `calendar.readonly`, `spreadsheets.readonly`,
   `drive.readonly`, and the new `analytics.readonly`.

**Do not add** `analytics`, `analytics.edit`, or any `analytics.manage.*`.
Google requires the narrowest scope that does the job, and a write scope on a
read-only connector is a common rejection.

---

## 3. Before customers touch it

Adding a sensitive scope **re-opens verification for the consent screen**, and
until it clears you are in Testing mode, where three things bite:

- **A permanent 100-user cap.** Once the "unverified app" screen has been shown,
  the app is capped at 100 new users *for its lifetime*. Google states this
  cannot be reset or changed. Every customer who connects before verification
  burns one forever. **Do not soft-launch GA to customers while unverified.**
- **Refresh tokens die after 7 days.** They return `invalid_grant`. Because this
  connector polls on a schedule, every test connection goes dark after a week —
  which will look like a connector bug and is not one.
- **Verification takes 3–5 business days** per cycle, plus re-submissions.
  It needs the homepage, a publicly-loading privacy policy and terms, a verified
  authorized domain, a scope justification, and an English demo video of the
  consent flow.

Before submitting, confirm `https://namzilabs.co/privacy` and `/terms` load
publicly with no login wall — Google fetches them, and a 404 costs a whole cycle.

**The good news:** `analytics.readonly` is *sensitive*, not *restricted*. It
needs verification, **not** a CASA third-party security assessment. The
`drive.readonly` scope the Sheets connector already carries **is** restricted, so
this project is on the heavier track already and Analytics rides along on it —
worth confirming the project's current verification state before submitting.

While waiting: add yourself under **Google Auth Platform → Audience → Test
users**.

---

## 4. Things that will generate support tickets

Worth knowing before a customer says the numbers are wrong.

- **Today is never final.** Standard properties lag 2–6 hours intraday; daily
  tables settle 12–24h after the day closes. Yesterday is not reliably complete
  until mid-afternoon *in the property's own timezone*.
- **Users are not additive.** `totalUsers` and `activeUsers` are de-duplicated
  per requested date range, so summing daily rows overstates them, and worse the
  wider the range. This matters here specifically: the metric engine's
  `countable` / `additive` distinction exists for exactly this, and a GA4 user
  metric must not be declared additive.
- **Thresholding and `(other)`.** GA withholds rows on small audiences and rolls
  high-cardinality dimensions into `(other)`. The connector logs when either
  happened, which is the evidence for why a number disagrees with the GA UI.
- **The connector re-reads a trailing 7 days** on every sweep, so recent numbers
  get corrected as Google finishes processing. That window is an engineering
  judgement, not a documented Google figure — conversions reassign attribution
  credit for considerably longer, which this does not fully cover.

---

## Status

`verified: { live: null }` in the catalog. The connector is written against
Google's published reference and its tests cover our own arithmetic — the row
identity, the timezone handling, the window it retires against — but **nothing
has yet talked to a real GA4 property**. Point `scripts/verify-ganalytics.ts` at
a connected account and date that field once it has.
