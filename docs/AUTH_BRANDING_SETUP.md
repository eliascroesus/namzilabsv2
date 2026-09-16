# Putting sign-in on our own domain, branding it, and adding Google

**All three of these are configuration, not code.** Nothing in this repo needs
changing for any of them — no deploy, no new dependency. Two env vars change,
and only if you take the optional second domain in step 1b.

That is worth saying plainly, because it means you can do all of this yourself
in about an hour of clicking plus DNS propagation, and none of it is blocked on
me.

---

## 1. Get it off `*.authkit.app`

Today `/sign-in` redirects to WorkOS, which serves the page at a generated
`randomphrase.authkit.app` address. There are **two** domains in play and they
are different things. You probably want both, but the first one is the one you
actually asked about.

### 1a. The AuthKit domain — the page people type into

This is the hostname in the address bar while someone enters their email and
password. Make it `auth.namzilabs.co`.

1. <https://dashboard.workos.com/> → **select the Production environment**
   (this is not offered in staging).
2. **Domains** → **Configure AuthKit domain** → enter `auth.namzilabs.co`.
3. WorkOS shows you a CNAME record. Add it at your DNS provider.
   **If that is Cloudflare, set the record to DNS-only — grey cloud, not
   orange.** A proxied record cannot be verified across accounts and this is the
   single most common way this step stalls.
4. Wait. WorkOS keeps retrying verification for **72 hours**, so a record that
   is right but slow will come good on its own.

**No code change.** The app asks WorkOS for an authorization URL and follows
wherever it points.

### 1b. The Auth API domain — the hop before it (optional)

Even with 1a done, the *first* redirect still goes through `api.workos.com`
before landing on your domain. It is brief and most products live with it. If
you want it gone:

1. Same **Domains** page → **Configure authentication API domain** → e.g.
   `authapi.namzilabs.co`.
2. Add the CNAME it gives you, same Cloudflare caveat.
3. In Vercel, set **`WORKOS_API_HOSTNAME`** to `authapi.namzilabs.co` — the
   hostname only, no `https://`, no trailing slash.

Still no code change: the AuthKit SDK already passes that env var straight
through as the client's `apiHostname`. Do this one **after** 1a is verified, and
note the warning in WorkOS's own docs — once a custom API domain exists, traffic
should go through it, so don't half-finish this step.

### Cost

The custom domain add-on is **$99/mo**. AuthKit itself is free to 1M monthly
active users, so for a while that $99 is the entire auth bill.

### ⚠ One thing that will break quietly if you skip it

`WORKOS_AUTHKIT_DOMAIN` in Vercel is **not** cosmetic. It is the OAuth issuer
and JWKS host that the MCP endpoint validates tokens against
(`src/lib/mcp/env.ts`). Move AuthKit to `auth.namzilabs.co` without updating it
and MCP token validation starts failing on an issuer mismatch — with a
confusing error, because the old domain keeps serving.

MCP is still gated off (`MCP_ENABLED`), so this is not urgent today. It will be
the day you turn it on and cannot work out why. **Update that var in the same
sitting as step 1a.**

---

## 2. Brand it

Everything here is **WorkOS Dashboard → Branding**. The colours have separate
light and dark values; fill in both.

| Field | Light | Dark |
|---|---|---|
| Display name | `Namzilabs` | — |
| Page background | `#F3F3F3` | `#121214` |
| Button background | `#568CFF` | `#568CFF` |
| Button text | `#FFFFFF` | `#FFFFFF` |
| Link colour | `#568CFF` | `#568CFF` |
| Corner radius | `8px` | — |

Then under **AuthKit**:

- **Font family** — `Inter`. It's in their Google Fonts list and it is what the
  app itself is set in, so the sign-in page and the first dashboard screen are
  the same typeface rather than nearly the same.
- **Preferred appearance** — *OS system setting*. The app already does this, and
  a customer on dark who gets a white flash at sign-in notices it.
- **Assets** — logo 160×160 or larger, square logo icon, favicon 32×32+.
- **Legal links** — `https://namzilabs.co/privacy` and `/terms`. These are
  required for Google verification anyway (see step 3), so filling them here
  kills two birds.
- **Page layout** — *two-column*. A centred card on an empty page is a form; a
  split page is a product with a form on it. There is a starting panel in
  `docs/authkit-custom.css`.
- **Custom CSS** — paste `docs/authkit-custom.css`. It sets the card surface,
  the hairline, the heading weight and the Google button's position, which are
  the things the fields above cannot reach. Read its header first: it explains
  what belongs in a field and what belongs in CSS, and why fighting the fields
  gives you a brand-blue button with a default-blue focus ring.

The one asset I can't produce for you is the logo PNG — the app has no raster
logo committed, only the connector marks. 160×160 and 32×32, square, on
transparent.

---

## 3. Sign in with Google

Two halves. Do them in this order, because the redirect URI you need in Google
**changes** once step 1b is done.

### Fastest path: use WorkOS's credentials

The Google OAuth panel in WorkOS offers its own shared credentials. Turning that
on gives you working Google sign-in in about a minute with no Google Console
work at all.

The catch: the consent screen says **WorkOS**, not Namzilabs. Fine for testing,
wrong for launch. Use it today if you want to see it working; do the real thing
below before customers arrive.

### Your own credentials

**In WorkOS first** — Dashboard → **Authentication** → **OAuth providers** →
**Google** → **Manage**. Copy the **Redirect URI** it shows you. Copy it from
there rather than from anything I write down: it is derived from your
environment, and if you have done step 1b it is on your API domain rather than
on `api.workos.com`.

**Then in Google Cloud Console** — use the **same project** that already backs
Calendar, Sheets and the new Analytics connector:

1. **APIs & Services → Credentials → Create client**.
2. Application type **Web application**. Give it a name that is *not* your app's
   name — Google shows the OAuth *client* name in some surfaces and two things
   called "Namzilabs" is confusing to debug.
3. **Authorized redirect URIs** → paste the WorkOS one from above. Byte for
   byte, no trailing slash.
4. **Authorized JavaScript origins** — leave empty. This is a server-side code
   flow, not a browser token flow.
5. **Create**, then copy the **Client ID** and **Client secret**.

**Back in WorkOS** — the same Google dialog → choose **Your app's credentials**
→ paste both → **Save**.

**Then publish** — Google Console → **OAuth consent screen → Audience → Publish
app**. While it is in Testing, only listed test users can sign in, so a customer
who tries Google login will simply be refused.

You do not add any scopes for this. WorkOS requests the basic identity scopes
itself, and they are not sensitive — which is why Google *login* needs no review
even though the Analytics *connector* does.

### While you're in there

Steps 1–2 of `docs/GOOGLE_ANALYTICS_SETUP.md` are in the same console, on the
same project, and the Analytics scope submission takes days to come back. Doing
both in one sitting starts that clock.

---

## What I'd do in what order

1. **AuthKit domain** (1a) — the visible win, and DNS needs the lead time.
   Update `WORKOS_AUTHKIT_DOMAIN` while you're there.
2. **Branding** (2) — you can do this while DNS propagates; it applies to the
   `.authkit.app` page immediately and follows the domain over.
3. **Google login with WorkOS's credentials** — one minute, see it working.
4. **Google login with your own** (3) — before anyone real signs up.
5. **Auth API domain** (1b) — polish, once the rest is settled.

---

## Sources

- [AuthKit custom domain](https://workos.com/docs/custom-domains/authkit)
- [Auth API custom domain](https://workos.com/docs/custom-domains/auth-api)
- [AuthKit branding & custom CSS](https://workos.com/docs/authkit/branding)
- [Google OAuth integration](https://workos.com/docs/integrations/google-oauth)
- [Pricing](https://workos.com/pricing)
