# Turning on Meta Ads, TikTok Ads and Google Ads

Everything in the code is done. What is left is on the three providers' side,
and most of it is **waiting rather than clicking** — two of the three have
review queues measured in days to weeks.

**Start Google Ads today, even if you do nothing else this week.** It is the
only one with two independent approval queues, and neither can be hurried.

Facts below were read from each provider's own documentation on **21 Sep 2026**.
Provider dashboards get redesigned constantly; if a menu name here does not
match what you see, trust what you see.

---

## The split

| | Mine (done) | Yours |
|---|---|---|
| Connector code, row identity, rate budgets | ✅ | — |
| Customer-facing setup pages at `/docs/<source>` | ✅ | — |
| OAuth wiring, token exchange, callbacks | ✅ | — |
| Live probers to verify each provider | ✅ | run them once you have credentials |
| Registering the three apps | — | **you** |
| Passing App Review / access-level applications | — | **you** |
| Pasting 5 environment variables into Vercel | — | **you** |

Until the environment variables exist, all three cards show *"Not available
yet"* instead of a Connect button. That is deliberate: without credentials the
OAuth start route would throw a 500 at whoever clicked.

---

## Your base URL

Everything below needs these. Production is `https://namzilabs.co`
(`APP_BASE_URL`).

| Provider | Redirect / callback URL to register |
|---|---|
| Meta | `https://namzilabs.co/api/oauth/meta/callback` |
| TikTok | `https://namzilabs.co/api/oauth/tiktok/callback` |
| Google | `https://namzilabs.co/api/oauth/google/callback` — **already registered**, no change needed |

If you want to test locally as well, register the `http://localhost:3000/...`
form of each alongside the production one. Meta and TikTok both accept several.

---

# 1. Google Ads — start this first

**Why first:** two separate approvals, and one of them is a manual audit at
Google that takes about ten business days.

## ⚠ What changed twelve days ago

**Developer tokens are gone.** Google sunset them on **9 September 2026**. If
you read any guide — including most of what is currently on the web — telling
you to create a Google Ads *manager account* and apply at
`ads.google.com/aw/apicenter`, that route is dead.

API access now attaches to the **Google Cloud project** whose OAuth credentials
make the call — for us, the project behind `GOOGLE_CLIENT_ID`, the same one
that already backs Sheets, Calendar and Analytics. **You do not need a manager
account and you do not need a token to paste anywhere.**

> "API access levels are now determined by the Google Cloud project you used to
> generate your OAuth credentials." — [developer token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token), read 21 Sep 2026

## 1a. Enable the API (5 minutes)

1. <https://console.cloud.google.com/apis/library>, with **the project whose
   client id is in `GOOGLE_CLIENT_ID`** selected. A different project would need
   a different client id and there is no slot for one.
2. Search `Google Ads API` → **ENABLE**.

Enabling grants **Test access** automatically. Test access reaches test accounts
only and refuses every real advertiser, so this alone is not enough.

## 1b. Add the OAuth scope (5 minutes)

1. **APIs & Services → Google Auth Platform → Data Access → ADD OR REMOVE SCOPES**.

   (Google replaced "OAuth consent screen" with **Google Auth Platform**. Older
   guides still say "OAuth consent screen → Scopes", which no longer exists.)
2. Paste into the filter box, exactly:
   ```
   https://www.googleapis.com/auth/adwords
   ```
3. Tick it, **UPDATE**, then **SAVE**.

This scope is **sensitive**, so it needs Google's OAuth verification (free, 3–5
business days). Note that `drive.readonly` already puts this project on the
heavier *restricted* track, so Ads rides along on a submission you have made
before.

## 1c. Climb the access ladder

All of this is on the **Google Ads API Overview page inside the Cloud console**,
not in Google Ads.

| Level | Reaches | Daily operations — **shared by every customer** | How |
|---|---|---|---|
| Test | test accounts only | 15,000 | automatic on enabling |
| Explorer | production too | **2,880** | expand *Upgrade access level* → **Apply for access** |
| Basic | production | 15,000 | needs **brand verification** first, then apply — now approved in minutes |
| Standard | production | unlimited | **Start application** → manual audit, ~10 business days |

**Explorer's 2,880/day is across your whole fleet, not per customer.** At one
sweep every ten minutes that is roughly 20 connections before the ceiling binds.
Get to Basic quickly; apply for Standard before you have real volume.

Brand verification is part of the standard OAuth verification in Cloud console
(Google Auth Platform → Branding), so 1b and Basic access overlap.

## 1d. Flip the switch

Once the Overview page shows **Explorer or better**, set in Vercel:

```
GOOGLE_ADS_ENABLED=1
```

This is a deliberate human switch. Nothing in the environment can prove the
project's access level, and a customer connecting against Test access would see
every sweep fail — so the card stays inert until you confirm.

## 1e. Verify

```
GOOGLE_ADS_ACCESS_TOKEN=ya29.… pnpm tsx scripts/verify-google-ads.ts
```

Get the token from the [OAuth Playground](https://developers.google.com/oauthplayground)
with the adwords scope. It checks that the project has access, that the response
is camelCase as the connector assumes, and prints which campaign types the
account runs. Then put today's date in `verified.live` on the `gads` catalog
entry.

---

# 2. Meta Ads

**Why second:** App Review plus Business Verification, days to weeks.

## 2a. Create the app (10 minutes)

1. <https://developers.facebook.com/apps/creation/>
2. App name and contact email → **Next**.
3. **Use cases.** Pick the one that covers ads; if nothing fits, choose
   **Other**, which leads to the app-type step.
4. **App type: Business.** This is the one that carries the Marketing API.
5. **Connect a business** — pick your business portfolio, or create one.
6. **Go to dashboard**.

## 2b. Add the two products

From the App Dashboard sidebar, **Add product**:

- **Marketing API** — the reporting endpoints themselves.
- **Facebook Login for Business** — how customers authorise. *Not* plain
  Facebook Login.

## 2c. Register the redirect URL

**Products → Facebook Login for Business → Settings → Client OAuth settings →
Valid OAuth Redirect URIs**, paste:

```
https://namzilabs.co/api/oauth/meta/callback
```

**Save changes.** A URI that is not listed here fails at the moment a customer
returns, after they have already granted access.

## 2d. Copy the credentials

**App settings → Basic**: **App ID** and **App Secret** (Show).

## 2e. ⭐ The configuration that stops tokens expiring

This is the step that decides whether your customers reconnect every 60 days or
never.

A plain `ads_read` token lasts ~60 days and **cannot be refreshed** — Meta has
no refresh-token grant. A **Business Integration System User** token
*"defaults to never expire"*, and you get one by pointing the login dialog at a
saved **configuration** instead of a scope list.

1. **Facebook Login for Business → Configurations → Create configuration**.
2. Token type: **System user access token**.
3. Assets: **Ad accounts**. Permission: **`ads_read`**.
4. Token expiration: **Never**.
5. Save, and copy the **Configuration ID**.

Set it as `META_LOGIN_CONFIG_ID` and the connector sends `config_id` instead of
`scope` automatically. **Leave it unset and everything still works** — you just
get 60-day tokens until the app reaches Full Access (below), at which point
Meta stops expiring them anyway.

## 2f. The three URLs Meta asks for

**App settings → Basic** has required fields that App Review checks are live.
All three exist and are public:

| Field | URL |
|---|---|
| Privacy Policy URL | `https://namzilabs.co/privacy` |
| Terms of Service URL | `https://namzilabs.co/terms` |
| User Data Deletion | choose **Data Deletion Instructions URL** → `https://namzilabs.co/data-deletion` |

Meta offers a *Data Deletion Callback URL* as the alternative. Take the
**Instructions URL** — the callback is a signed-request endpoint you would have
to build and keep working, and the instructions page is equally accepted because
deletion here is genuinely self-serve.

TikTok and Google ask for the privacy policy in the same way; the deletion page
serves all three.

## 2g. Business Verification and App Review

- **Business Verification** — App Dashboard → **Review → Business Verification
  → Start Verification**. Required before Advanced Access to ads permissions.
- **App Review** — request **Advanced Access** to **`ads_read`**. Ask for
  `ads_read` only. `ads_management` would let the app create and delete
  campaigns, which this connector never does, and makes review harder for
  nothing.

## 2h. Raise the rate limit when you can

Meta scores requests rather than counting them: a read costs 1 point.

| Tier | Ceiling | Effect |
|---|---|---|
| Limited (default) | 60 points / 300s | **12 reads a minute for your whole fleet** |
| Full | 9,000 points / 300s | 1,800/min |

Renamed on 4 May 2026 (was Standard/Advanced). The bar is **500+ Marketing API
calls in 15 days with an error rate under 15%** — so it becomes reachable simply
by running. When you clear it, raise `fleetLimits` on the `meta-ads` catalog
entry from 12 to 1800; the comment there says so.

## 2i. Verify

```
META_ADS_TOKEN=EAA… pnpm tsx scripts/verify-meta-ads.ts
```

It reports your access tier off the throttle header and — the important one —
**whether the token you hold actually expires**.

---

# 3. TikTok Ads

**Why last:** one queue, up to 7 business days, and no verification step.

## 3a. Create the app

1. <https://business-api.tiktok.com/portal> → **My Apps → Create an App**.
2. Name, description, category.
3. **Advertiser redirect URL**:
   ```
   https://namzilabs.co/api/oauth/tiktok/callback
   ```
   Up to 10 are allowed, including localhost — add your dev URL too.
4. **Scope of permission**: **Ads Management** and **Reporting**. Reporting
   alone does not cover the advertiser lookups the account picker makes.
5. **Submit**. Review takes up to 7 business days.

## 3b. Copy the credentials

From the app's detail page: **App ID** and **Secret**.

Both are needed at **runtime**, not only at connect time — unlike every other
connector here, TikTok's advertiser picker must send the app id and secret
alongside the customer's token on every call.

## 3c. Verify — and settle the one open question

```
TIKTOK_ADS_TOKEN=… TIKTOK_APP_ID=… TIKTOK_APP_SECRET=… pnpm tsx scripts/verify-tiktok-ads.ts
```

**This is the weakest claim in the whole feature.** The connector declares that
TikTok advertiser tokens never expire, on secondary sources alone — TikTok's
documentation portal renders client-side and cannot be read by any tool. If it
is wrong, every TikTok connection dies silently when the token lapses.

When you do your first real advertiser authorisation, **print the
`/oauth2/access_token/` response**. If it carries `expires_in` or a
`refresh_token`, tell me and I will switch the provider to a real refresh.

---

# 4. The environment variables

Vercel → Project → **Settings → Environment Variables**, scope **Production**
(and Preview if you want them there).

```
META_APP_ID=…
META_APP_SECRET=…
META_LOGIN_CONFIG_ID=…        # optional, but this is the never-expire path
TIKTOK_APP_ID=…
TIKTOK_APP_SECRET=…
GOOGLE_ADS_ENABLED=1          # only once the Cloud project shows Explorer+
```

Nothing for Google Ads beyond that flag — it reuses `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`.

**Redeploy after adding them.** Vercel does not apply new variables to an
existing build, and a card will keep saying "Not available yet" until it
rebuilds. Deploys land in about a minute.

Add the same values to `.env.local` if you want to test locally, with the
`localhost:3000` redirect URIs registered.

---

# 5. Checking it worked

Each card should swap "Not available yet" for a **Connect with …** button as
soon as its variables are live. Then:

1. Connect one account yourself.
2. Open the connection and run **Test** — it should return rows.
3. Build a flow: Get data → pick the account → leave Group by on Campaign.
4. A Sum of `value` is your spend.

If a card is still inert, its variables are missing from the build — check the
deployment picked them up, not just the project settings.

---

# 6. What is still unverified

None of these block launch; all of them are things no amount of reading could
settle, recorded so nobody mistakes them for checked facts. Each catalog entry
carries `verified: { live: null }` until its prober has run.

- **TikTok token lifetime** — see 3c. The one that could bite hard.
- **TikTok's real rate limits.** Declared conservatively at 60/min because
  TikTok publishes QPS, QPM and QPD figures nowhere a tool can read them.
- **Meta's access tier and true per-account limits** — read off
  `X-FB-Ads-Insights-Throttle` by the prober.
- **Google Ads: whether Read-only account access is enough** to run reports via
  the API. Google's help page lists running reports under Standard and Admin but
  not Read only. The customer guide says so; the prober will settle it.
