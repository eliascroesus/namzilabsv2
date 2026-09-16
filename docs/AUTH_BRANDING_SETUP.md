# Sign-in on our own domain — what's done, and what you need to do

**Done and deployed:** sign-in and sign-up now live at `namzilabs.co/login` and
`namzilabs.co/signup`, built from the same components as the rest of the app.
Nobody is sent to `authkit.app` any more on the ordinary path.

**Cost: $0.** WorkOS charges $99/mo to put *their* hosted page on
`auth.namzilabs.co`. Hosting the form ourselves — what WorkOS calls headless
AuthKit, and what nearly every SaaS does — costs nothing.

**What is still WorkOS's, deliberately:** password hashing and comparison,
breached-password checks, rate limiting, the verification email, token minting
and refresh, and the session signature. Our code forwards a credential and gets
an answer back. It never sees a hash and never decides whether a password is
right. That line is the reason this was safe to do at all.

---

## The one thing left for you: Google sign-in

The button is built and wired. It needs credentials, and that is a dashboard
job.

### Option A — see it working in one minute

WorkOS Dashboard → **Authentication** → **OAuth providers** → **Google** →
**Manage** → choose **WorkOS's credentials** → Save.

Google sign-in works immediately. The catch: the consent screen says **WorkOS**,
not Namzilabs. Fine for testing, wrong for launch.

### Option B — your own credentials (do this before customers arrive)

**1. Get the redirect URI from WorkOS.** Same dialog as above. **Copy it from
there, not from anything written down here** — it is derived from your
environment.

**2. In Google Cloud Console**, using the **same project** that backs Calendar,
Sheets and Analytics.

⚠ **"APIs & Services → OAuth consent screen" no longer exists.** Google replaced
it with **Google Auth Platform**, split into *Branding*, *Audience*, *Data
Access*, *Clients* and *Verification Center*. Looking for the old menu item is
the single most common way people get stuck here.

- **APIs & Services → Google Auth Platform → Clients → Create client**
- Application type: **Web application**
- Name it something that is *not* "Namzilabs" — Google surfaces the OAuth client
  name in places, and two things with the same name are miserable to debug
- **Authorized redirect URIs** → paste the WorkOS URI, byte for byte, no
  trailing slash
- **Authorized JavaScript origins** → leave empty (this is a server-side code
  flow)
- **Create**, copy the **Client ID** and **Client secret**

**3. Back in WorkOS** → same Google dialog → **Your app's credentials** → paste
both → Save.

**4. Publish** → **Google Auth Platform → Audience → Publish app**. While it
says *Testing*, only the accounts listed under *Test users* on that same page
can sign in — a real customer pressing "Continue with Google" is simply
refused.

**No scopes to add.** The dialog already lists `userinfo.email` and
`userinfo.profile`, which is all login needs. Leave **"Return Google OAuth
tokens"** unchecked — that hands Google access tokens back to us, and the login
flow has no use for them (the connectors do their own OAuth separately).

### What the Google consent screen actually shows

This is the part worth understanding before you judge the result.

- **Unverified:** Google shows the *domain*, not your name or logo. With the
  default WorkOS redirect URI that domain is `auth.workos.com` — so it reads as
  somebody else's product.
- **Verified:** Google shows your **app name and logo** from *Google Auth
  Platform → Branding*. This is free and is the fix.

So the branding lever is **verification**, not the redirect URI. You need
verification anyway for the Analytics scope, and it is the same submission.

⚠ **One line will still say `auth.workos.com`.** WorkOS's own docs are explicit
that the "continue to …" domain only becomes yours once you configure a custom
**auth API** domain — the $99/mo add-on. So the earlier claim in this file that
$99 buys "only the hostname of the hosted page" was incomplete: it also buys
that line on Google's consent screen. Name and logo are free; that one line is
not.

### If Google refuses the redirect URI

Google's rule is that "all domains used in your project, whether in the branding
page or client configuration pages, must be pre-registered" under **Branding →
Authorized domains**. If it rejects the WorkOS URI on that basis, add
`workos.com` there. Remove it again if you ever move to a custom auth domain. Do not confuse this with the
Analytics *connector*, which does (see `GOOGLE_ANALYTICS_SETUP.md`; same
project, so worth doing in one sitting since that review takes days).

---

## Two WorkOS settings worth checking

**Authentication → Email verification.** If "require email verification" is
**on**, a new sign-up gets a code by email and lands on `/verify-email`, which
is built. If it is **off**, sign-up goes straight into the product. Either works;
just know which you have chosen.

**Authentication → Password policy.** WorkOS enforces this, including breach
checks. Our form only pre-checks a length of 8 so the obvious case doesn't cost
a round trip — it deliberately does not impose a second, weaker policy of its
own.

---

## Don't delete the hosted page

`/login` handles email+password and Google. Three things it deliberately does
**not** handle, because half-building them is how authentication goes subtly
wrong:

- an **MFA** challenge
- **organization selection**, if WorkOS ever asks for it at sign-in
- an **SSO-required** account

Any of those hands the person to the hosted AuthKit page, which does them
correctly, and they come back through the same `/callback`. So the hosted page
is still a live fallback.

Practical consequence: **it is worth putting your logo and colours into WorkOS
Dashboard → Branding anyway.** Not for the main flow any more — for the rare one.
Fifteen minutes, free, and `docs/authkit-custom.css` is still there if you want
it to match exactly. Today none of it is urgent.

---

## If you ever want `auth.namzilabs.co` after all

Nothing here blocks it. Dashboard → Domains → Configure AuthKit domain, add the
CNAME (**DNS-only / grey cloud on Cloudflare**), $99/mo. The forms at `/login`
keep working; the fallback page moves onto your domain.

⚠ **If you do that, update `WORKOS_AUTHKIT_DOMAIN` in Vercel in the same
sitting.** It reads like a display setting and is not: `src/lib/mcp/env.ts` uses
it as the OAuth issuer and JWKS host MCP validates every token against. Change
the domain without it and MCP fails on an issuer mismatch — confusingly, because
the old domain keeps serving. MCP is gated off today, so it is a bill that
arrives later.

---

## What changed in the code

| | |
|---|---|
| `/login`, `/signup`, `/verify-email` | the forms, in `src/app/(auth)/` |
| `/auth/google` | sends straight to Google, never via the hosted page |
| `/sign-in`, `/sign-up` | kept, now redirect to the new paths — every existing link, invite email and bookmark still works |
| `src/proxy.ts` | a protected page now bounces to `/login?next=…` instead of to WorkOS |

**No new environment variables.** `saveSession` seals exactly what the hosted
callback sealed, so `withAuth()`, `requireOrg()` and every page downstream
cannot tell which door somebody came through.

The security-critical piece we now own is *where a sign-in sends you afterwards*
— `safeNext` in `src/app/(auth)/next-path.ts`, pinned hard in
`tests/auth-routes.test.ts`, because `?next=` arrives from the browser and an
unchecked value there is an open redirect on our own domain.

### Not built

Password reset. WorkOS sends the email; the screen to set the new password is
not written yet, so "forgot password" is not linked from `/login`. Say the word
and it is a small addition.

---

## Sources

- [AuthKit overview](https://workos.com/docs/authkit) ·
  [custom domain](https://workos.com/docs/custom-domains/authkit) ·
  [branding](https://workos.com/docs/authkit/branding)
- [Authenticate with password](https://workos.com/docs/reference/user-management/authentication/password)
- [Google OAuth integration](https://workos.com/docs/integrations/google-oauth)
- [Pricing](https://workos.com/pricing)
