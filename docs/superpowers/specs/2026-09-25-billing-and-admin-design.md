# Plans, billing and the owner's admin panel — design

Approved by the owner on 25 Sep 2026 ("Perfect continue and do that and implement").
Builds on the admin-panel design approved the same day and folds it in.

## Goal

Charge for Namzilabs without making anyone's first month harder: a Free plan
that is genuinely useful, two paid plans anyone can try for 30 days with no card,
and a downgrade that hides value without deleting anything. Give the owner one
panel to see where customers come from and to hand out access.

## Plans

| | Free | Growth (most popular) | Scale |
|---|---|---|---|
| Monthly | $0 | $49 | $149 |
| Yearly (per month) | — | $39 ($468/yr) | $119 ($1,428/yr) |
| Trial | — | 30 days, no card | 30 days, no card |
| Apps | 3 | 10 | 50 (shown as "Unlimited — fair use") |
| Metrics | 5 | 50 | 500 (shown as "Unlimited — fair use") |
| Team members (incl. owner) | 1 | 5 | 20 |
| Share templates | — | ✓ | ✓ |
| AI assistant (MCP) | — | — | ✓ |
| Support | Email | Priority email | Priority + WhatsApp |

- A **metric** is one number on the board: one enabled metric of a published
  flow, i.e. one `flow_results` row. Views are not limited.
- An **app** is a connection that is not `disabled`.
- **Members** count WorkOS memberships (active + pending invitations), owner
  included.
- One config file (`src/lib/billing/plans.ts`) holds every number above. The
  safety caps in `src/lib/limits.ts` are raised so no plan limit is ever
  unreachable: connections 50, flows 200.

## Where plan state comes from

The effective plan of a workspace is the highest tier among:

1. its Stripe subscription, when `status` is `active`, `trialing` or
   `past_due` (past due keeps access — Stripe is still retrying);
2. its unrevoked access grants whose window contains now — kinds `trial`,
   `code`, `manual`, `referral`, `launch`; `ends_at = null` is lifetime;

and Free otherwise. Resolution is a pure function (`resolvePlan`) so every rule
is unit-testable; one DB wrapper reads the two inputs.

**`BILLING_ENABLED` is the launch switch.** Off (the default): nothing is
enforced, no plan UI appears outside `/admin` and `/pricing`, and the app
behaves exactly as today. On: everything below applies.

## Trials

- Chosen on the plan picker: Growth or Scale for 30 days, no card.
- **One trial per person** (`trial_claims`, keyed by WorkOS user id), so a
  second workspace offers "Start Growth", not another trial.
- Stored as an access grant of kind `trial`; Stripe is not involved until they
  pay. This keeps unconverted sign-ups out of Stripe and works with Managed
  Payments.
- Reminder emails (Resend) 7 days and 1 day before the end and on the day,
  scheduled with a durable Inngest function (`step.sleepUntil`), skipped when
  they have subscribed or the trial was revoked.
- Paying during a trial opens Checkout with `subscription_data.trial_end` set
  to the trial's end, so the first charge lands when the trial would have ended.

## Paying (Stripe)

- **Stripe Checkout with Managed Payments** (`managed_payments[enabled]=true`,
  Stripe as merchant of record). `STRIPE_MANAGED_PAYMENTS=0` switches to
  standard Stripe with `automatic_tax`.
- Prices are found by lookup key: `growth_monthly`, `growth_yearly`,
  `scale_monthly`, `scale_yearly`.
- One Stripe Customer per workspace; `metadata.org_id` on customer and
  subscription, `client_reference_id` on the session.
- **Billing portal** for card, invoices, cancel, plan and interval changes.
- **Webhook** `POST /api/webhooks/stripe-billing`, signature-verified. On any
  subscription or invoice event the handler re-reads the subscription from
  Stripe (events can arrive out of order) and upserts `billing_subscriptions`,
  then applies the plan (resume paused apps, revalidate).
- Returning from Checkout, the success page syncs the session's subscription
  directly, so the unlock never waits for the webhook.
- Smart Retries: 8 tries over 2 weeks, then cancel (Stripe setting).

## Downgrade — what "Free limits" means

Applies when the effective plan drops (trial or grant ended, subscription
ended, downgraded below usage). Nothing is ever deleted.

- **Metrics:** the first N by first publish (`flow_results.created_at`, then
  id) stay live; the rest are **locked**. The server strips their data before
  it leaves: a locked tile carries its name only — no value, no ranges, no
  days, no provenance. The dashboard draws a lock over a static blurred
  placeholder that contains no data. Charts composed from a locked metric are
  locked. The calendar never receives locked values. Clicking a locked tile or
  trying to edit its flow opens the upgrade dialog.
- **Apps:** the first N connected (`created_at`) keep syncing. The rest are
  paused through the existing pause (`paused_until` far future,
  `paused_reason` "Paused on the Free plan — upgrade to resume"), recorded in
  `plan_pauses` so an upgrade resumes exactly those. Applied lazily by the
  sweep worker when it reaches an over-limit connection, and eagerly when a
  plan changes. Webhook data keeps landing.
- **Members:** the owner and the earliest members up to the seat limit keep
  access; anyone else sees "This workspace is on the Free plan — ask the owner
  to upgrade".
- **Features:** AI assistant refuses with an upgrade message; creating or
  updating a template needs Growth (links already shared keep working).
- **New creation** beyond a limit (connect, publish, invite) opens the upgrade
  dialog instead of doing it.

Upgrading reverses all of it at once: grants/subscription land → paused apps
resume and catch up → locks lift on the next render.

## Codes, referrals, launch

- **Access codes** (owner-made, `/admin/codes`): plan + months or lifetime,
  optional redemption cap and redeem-by date, disable any time. Redeemed from
  the plan picker's "Access code" field, from Settings, or via
  `namzilabs.co/p/CODE` (a cookie applies it when the workspace is created, or
  at once if already signed in). Grant = plan until redemption + months. One
  use per workspace per code. Overlapping grants do not stack: the latest end
  wins.
- **Referral rewards** (1/3/5/10/25 invites → 1/3/6/12 months, lifetime):
  granted automatically when a referral is recorded — as a Growth grant, or,
  when the referrer's workspace pays through Stripe, as a credit of N monthly
  prices on their Stripe balance. The lifetime rung grants lifetime Growth and
  is flagged in the admin log; revenue share stays manual.
- **Launch:** an admin button "Start launch trials" gives every existing
  workspace without a plan a 30-day Growth grant of kind `launch`, once.

## Where customers come from

- Owner-made **tracking links** (`/admin/links`): label, source, medium,
  campaign, destination → `namzilabs.co/go/<slug>`.
- A click is recorded (known bots skipped; no IP or user agent stored), a
  30-day `nz_src` cookie remembers the link, and the visitor is redirected to
  the destination with `utm_*` appended.
- At workspace creation (the same two places referral attribution runs) the
  last link clicked is saved on `workspace_acquisitions` (source, medium,
  campaign snapshotted). No link = Direct. Attribution never fails a sign-up.
- Funnel per link and per source: clicks → sign-ups → connected an app → built
  a metric → trials → paying.

## Admin panel

Tabs: **Overview · Workspaces · Links · Codes · Log**, all behind the existing
`requireStaff()` gate.

- **Overview:** today's fleet stats, plus the channel funnel, active trials,
  paying workspaces, MRR (monthly-equivalent of active subscriptions), and the
  launch button.
- **Workspaces:** search → `/admin/workspaces/[orgId]`: the existing card,
  where it came from, referral count, plan and source, subscription status,
  every grant; actions **grant plan** (months, lifetime or until a date, with a
  note) and **revoke grant**.
- **Links** and **Codes** as above.
- **Log:** every admin action, from `audit_log` (new closed actions
  `admin.*`), with the staff member and the target.

## Presentation

The plan picker follows the owner's inspiration (Mochi's plan step) in the
product's own style: Monthly/Yearly toggle with "Save 20%", three cards with
Growth raised under "Most popular", paid prices struck through beside "FREE",
"30 days free, then $X/month", **Start 30-day free trial** with "No card
needed", Free's **Continue free**, an "Access code" field bottom-left and
"Need more? Talk to us" bottom-right. It appears as step 2 of onboarding (after
the workspace is created), in Settings → Plan & billing, and at public
`/pricing`. Settings also shows usage bars (apps, metrics, members) and
Manage billing. A trial banner stays quiet until 7 days are left; a red banner
shows while a payment is failing.

## Data (migration 0035 — new tables only)

`billing_subscriptions`, `access_grants`, `trial_claims`, `promo_codes`,
`plan_pauses`, `tracking_links`, `link_clicks`, `workspace_acquisitions`.
No existing table is altered, so deploying before the migration is pasted
cannot break a query that already runs.

## Safety properties (tested)

- Locked metric data never reaches the browser, the calendar or the AI tools.
- Every limit is enforced on the server, never only in the UI.
- With `BILLING_ENABLED` off, no limit, lock or plan UI applies.
- Attribution and code redemption can never fail a sign-up.
- Stripe webhooks are verified, idempotent and order-independent.
- Every admin action is staff-gated and audited.
