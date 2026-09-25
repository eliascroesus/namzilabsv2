# Plans, billing and the owner's admin panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Executed natively in the session that wrote the spec (the owner said "implement", no plan review). Steps name each test and the behaviour it pins rather than reproducing every line; the spec carries the design.

**Goal:** Free / Growth / Scale plans with 30-day no-card trials, Stripe (Managed Payments) checkout, server-enforced limits and metric locks, access codes, referral rewards, tracking links with channel attribution, and an owner admin panel — all dark behind `BILLING_ENABLED` until launch.

**Architecture:** Plan state is resolved from two inputs — a Stripe-synced `billing_subscriptions` row and `access_grants` (trial/code/manual/referral/launch) — by a pure `resolvePlan`. Every limit is checked on the server at the point of creation; downgrades are applied where data leaves the server (tile reads strip locked metrics) and where syncing is scheduled (over-limit apps paused through the existing pause). Stripe is only touched when someone pays.

**Tech Stack:** Next.js 16 (server actions, route handlers, `after`), Drizzle on Neon (PGlite in tests), WorkOS, Inngest (durable sleeps), Stripe Node SDK, Resend, Vitest, Playwright checks.

**Spec:** `docs/superpowers/specs/2026-09-25-billing-and-admin-design.md`

## Global Constraints

- Prices: Growth $49/mo, $468/yr; Scale $149/mo, $1,428/yr. Limits: Free 3 apps / 5 metrics / 1 member; Growth 10 / 50 / 5; Scale 50 / 500 / 20.
- `BILLING_ENABLED` unset ⇒ no limit, lock, pause, gate or in-app plan UI (admin and `/pricing` still render).
- Migration 0035 creates tables only; no existing table is altered.
- Inngest configs: CEL only (no `??`), no global concurrency above `PLAN_MAX_CONCURRENCY`.
- Every admin mutation calls `requireStaff()` and `recordAudit` with enum-only detail.
- Every write to a due-deciding column calls `wakeSweeper()` (tests/sweep-gate.test.ts).
- No free text in audit detail; no IP or user agent stored for clicks.
- Stripe: API version ≥ `2025-03-31.basil`; Managed Payments Checkout must omit `automatic_tax`, `tax_id_collection`, `payment_method_types`, `customer_update`, `invoice_creation`, `subscription_data.invoice_settings`.

## Review Focus

1. **Locked numbers leaving by a side door** — calendar days, a funnel/pie built from a locked member, a custom-range recompute, the AI tools: each must return no value for a locked metric. Pinned in Task 6.
2. **Flag off must be a true no-op** — an existing workspace over the Free limits must keep working exactly as today. Pinned in Tasks 4 and 6.
3. **Webhooks out of order or repeated** — a `deleted` before an `updated`, or the same event twice, must leave the right final state. Pinned in Task 10.
4. **Trial farming and code reuse** — second workspace, same person: no second trial; same code twice in one workspace: refused. Pinned in Task 3.
5. **A sign-up must never fail** because attribution or a code redemption threw (e.g. before the migration is pasted). Pinned in Tasks 11 and 16.

---

### Task 1: Plans config and the pure plan resolver

**Files:**
- Create: `src/lib/billing/plans.ts`, `src/lib/billing/resolve.ts`
- Test: `tests/billing-resolve.test.ts`

**Interfaces — produces:**
- `type PlanId = "free" | "growth" | "scale"`; `type Interval = "month" | "year"`
- `PLANS: Record<PlanId, PlanDef>` with `name`, `tagline`, `limits: { apps, metrics, members }`, `features: { shareTemplates, aiAssistant }`, `price: { month, year } | null`, `lookupKeys: { month, year } | null`, `bullets: string[]`
- `planRank(p: PlanId): number`; `higherPlan(a, b): PlanId`
- `type GrantInput = { plan: Exclude<PlanId,"free">; startsAt: Date; endsAt: Date | null; revokedAt: Date | null; kind: GrantKind }`
- `type SubscriptionInput = { plan: Exclude<PlanId,"free">; status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; trialEnd: Date | null }`
- `resolvePlan({ subscription, grants, now }): ResolvedPlan` where `ResolvedPlan = { plan; source: "subscription" | GrantKind | "free"; state: "active" | "trialing" | "past_due" | "canceling" | "granted" | "free"; endsAt: Date | null; lifetime: boolean }`

- [ ] Tests first: no inputs → free; active/trialing/past_due subscription → its plan; canceled/unpaid/paused/incomplete → ignored; a grant in window → its plan; expired, future, revoked grants ignored; lifetime grant (endsAt null) wins; highest tier wins across sources; overlapping grants → the latest `endsAt` among same-tier grants; `cancel_at_period_end` → state `canceling`; `endsAt` reported correctly for each.
- [ ] Implement; run; commit `Plans config and a pure plan resolver`.

### Task 2: Migration 0035 and schema

**Files:**
- Create: `drizzle/0035_billing_and_growth.sql`; Modify: `drizzle/meta/_journal.json` (idx 35), `src/db/schema.ts`, `drizzle/HAND_APPLY.md`
- Test: covered by every PGlite test that follows (the migrator applies the journal).

Tables (all `IF NOT EXISTS`):
- `billing_subscriptions` (org_id PK, stripe_customer_id, stripe_subscription_id UNIQUE, plan, interval, status, current_period_end, cancel_at_period_end, trial_end, amount_cents, currency, updated_at, created_at)
- `access_grants` (id uuid PK, org_id, plan, kind, starts_at, ends_at null, promo_code_id null FK→promo_codes, referral_rung int null, granted_by text null, note text null, created_at, revoked_at null, revoked_by null) + index (org_id); partial unique (org_id, promo_code_id) where promo_code_id not null; partial unique (org_id, referral_rung) where referral_rung not null; partial unique (org_id) where kind = 'launch'
- `trial_claims` (user_id PK, org_id, plan, claimed_at)
- `promo_codes` (id uuid PK, code UNIQUE, plan, months int null, max_redemptions int null, redeem_by timestamptz null, note, created_by, created_at, disabled_at null)
- `plan_pauses` (connection_id PK, org_id, paused_at) + index (org_id)
- `tracking_links` (id uuid PK, slug UNIQUE, label, source, medium, campaign, destination, created_by, created_at, archived_at null)
- `link_clicks` (id uuid PK, link_id FK→tracking_links cascade, at) + index (link_id, at)
- `workspace_acquisitions` (org_id PK, link_id null FK set null, source, medium, campaign, clicked_at null, created_at)

- [ ] Write SQL + journal + schema; run `npx vitest run tests/admin-growth.test.ts` (any PGlite test) to prove the migrator applies it; run `pnpm tsx scripts/check-schema-drift.ts --emit-sql`; commit `Migration 0035: billing, grants, codes, links`.

### Task 3: Billing state — plan lookup, grants, trials, codes

**Files:**
- Create: `src/lib/billing/state.ts`
- Test: `tests/billing-state.test.ts` (PGlite)

**Interfaces — produces:**
- `billingEnabled(): boolean` (env `BILLING_ENABLED` truthy)
- `workspacePlan(db, orgId, now = new Date()): Promise<ResolvedPlan>`
- `grantPlan(db, { orgId, plan, kind, endsAt, grantedBy, note?, promoCodeId?, referralRung? }): Promise<string>` (grant id)
- `revokeGrant(db, grantId, by): Promise<boolean>`
- `listGrants(db, orgId): Promise<GrantRow[]>`
- `startTrial(db, { orgId, userId, plan }): Promise<{ ok: true; endsAt: Date } | { ok: false; reason: "already_trialed" | "has_plan" }>` — one per user (`trial_claims`), 30 days
- `redeemCode(db, { orgId, userId, code, now }): Promise<{ ok: true; plan; endsAt: Date | null } | { ok: false; reason: "unknown" | "disabled" | "expired" | "used_up" | "already_redeemed" }>`
- `normaliseCode(raw): string | null` (A–Z0–9-, 3–32)

- [ ] Tests: trial once per person across two orgs; trial refused when already on a paid plan; code redeem happy path (plan, endsAt = now + months, lifetime when months null); unknown/disabled/expired/used-up/already-redeemed refusals; redemption count race (max 1, two redeems → one wins, via the unique index + count check); revoked grant stops counting; workspacePlan combines subscription row + grants.
- [ ] Implement; run; commit `Billing state: plans, grants, one trial per person, access codes`.

### Task 4: Usage counts and limits

**Files:**
- Create: `src/lib/billing/usage.ts`, `src/lib/billing/limits.ts`; Modify: `src/lib/limits.ts` (defaults: connections 50, flows 200)
- Test: `tests/billing-limits.test.ts`

**Interfaces — produces:**
- `countApps(db, orgId)`, `countMetrics(db, orgId)` (flow_results rows of published flows), `countMembers(orgId, workos?)`
- `class PlanLimitError extends Error { kind: "apps" | "metrics" | "members" | "feature"; plan: PlanId; limit: number; feature?: "shareTemplates" | "aiAssistant" }`
- `assertCanAddApp(db, orgId)`, `assertCanPublish(db, orgId, flowId, metricsInFlow)`, `assertCanInvite(orgId)`, `assertFeature(db, orgId, feature)` — all no-ops when billing is disabled
- `upgradeHref(kind): string` (`/dashboard/settings/billing?upgrade=<kind>`)

- [ ] Tests: each assert throws at the limit and passes below; flag off → never throws even far over; republishing a flow counts its existing metrics once; metrics of unpublished flows don't count.
- [ ] Implement; run; commit.

### Task 5: Enforce limits where things are created

**Files:** Modify `src/lib/connections.ts` (createConnection), `src/app/api/oauth/[provider]/start/route.ts`, `src/app/dashboard/flows/actions.ts` (publishFlowAction), `src/app/dashboard/settings/actions.ts` (inviteMemberAction), `src/app/dashboard/settings/template-actions.ts` (create/update), `src/lib/mcp/context.ts` (AI feature), integration forms' error mapping
- Test: `tests/billing-enforcement.test.ts` (PGlite for createConnection; source-scan that each entry point calls its assert)

- [ ] Tests: createConnection over the Free limit throws `PlanLimitError` with billing on and not with it off; the OAuth start route redirects to `upgradeHref("apps")` at the limit; each named action source calls its assert (scan proves it can fail on a fixture).
- [ ] Implement; action callers return `{ ok:false, upgrade: kind }` so the UI opens the dialog; commit.

### Task 6: Metric locks — data never leaves the server

**Files:**
- Create: `src/lib/billing/locks.ts`
- Modify: `src/app/dashboard/page.tsx` (board rows, calendar rows, composed charts), `src/app/dashboard/board-actions.ts` (any action returning tile data), `src/lib/mcp/tools/metrics.ts`
- Test: `tests/billing-locks.test.ts`

**Interfaces — produces:**
- `lockedMetricKeys(db, orgId, limit): Promise<Set<string>>` — key `${flowId}:${outputNodeId}`, ordering `flow_results.created_at, id`
- `lockRow<T extends { tile: unknown }>(row: T): T & { locked: true }` — tile replaced by `{ name, locked: true }` (no value/byRange/byDay/nextChangeAt/provenance)
- `metricLocksFor(db, orgId): Promise<Set<string>>` — empty when billing off or under limit

- [ ] Tests: first N by publish order stay; later ones locked; a locked row serialised with `JSON.stringify` contains none of the original numbers (plant a sentinel value 987654.321 and assert absence); composed chart with a locked member is locked; calendar rows locked; MCP metrics tool returns no value for a locked metric; flag off → empty set.
- [ ] Implement; commit.

### Task 7: Pause apps over the limit, resume on upgrade

**Files:**
- Create: `src/lib/billing/pauses.ts`; Modify: `src/inngest/functions/reconcile.ts` (reconcileOne checks before polling)
- Test: `tests/billing-pauses.test.ts`

**Interfaces — produces:**
- `enforceAppLimit(db, orgId): Promise<number>` — pauses connections beyond the plan's app limit (by created_at), records `plan_pauses`, calls `wakeSweeper()`
- `resumePlanPauses(db, orgId): Promise<number>` — clears pause for recorded rows now within the limit, deletes them, `wakeSweeper()`
- `applyPlan(db, orgId): Promise<void>` — both of the above, used after any plan change

- [ ] Tests: 5 apps on Free → last 2 paused with the reason; upgrade → both resumed; flag off → nothing paused; a connection paused by the breaker is not resumed by `resumePlanPauses`.
- [ ] Implement; commit.

### Task 8: Seat gate

**Files:** Create `src/lib/billing/seats.ts`, `src/components/billing/seat-gate.tsx`; Modify the dashboard layout/app shell entry to render the gate
- Test: `tests/billing-seats.test.ts`

- [ ] `seatAllowed({ ownerId, memberships (createdAt order), userId, limit })` pure: owner always; earliest members up to limit; others refused. Tests for each; flag off → allowed.
- [ ] Implement; commit.

### Task 9: Stripe core

**Files:** Add dependency `stripe`; Create `src/lib/billing/stripe.ts`
- Test: `tests/billing-stripe.test.ts` (fake client)

**Interfaces — produces:**
- `stripeClient(): Stripe` (throws `BillingNotConfigured` without `STRIPE_SECRET_KEY`)
- `priceIdFor(plan, interval, client?)` via `prices.list({ lookup_keys })`, cached in module
- `ensureCustomer(db, orgId, { email, name }, client?)`
- `createCheckout(db, { orgId, plan, interval, email, name, trialEnd?, returnBase }, client?)` → url; Managed Payments on unless `STRIPE_MANAGED_PAYMENTS=0`
- `createPortal(db, orgId, returnUrl, client?)` → url
- `syncSubscription(db, subscriptionId, client?)` → upserts `billing_subscriptions` from the canonical object, then `applyPlan`

- [ ] Tests: checkout params include `managed_payments.enabled`, omit forbidden params, set `client_reference_id`, `metadata.org_id`, `subscription_data.trial_end` when trialing; standard mode adds `automatic_tax`; sync maps plan from price lookup key and status; unknown price → ignored.
- [ ] Implement; commit.

### Task 10: Stripe webhook + checkout return

**Files:** Create `src/app/api/webhooks/stripe-billing/route.ts`; success handling in the billing page
- Test: `tests/billing-webhook.test.ts`

- [ ] Tests: bad signature → 400; valid signed `customer.subscription.updated` → row upserted from the (faked) retrieved subscription; the same event twice → same state; `deleted` then a stale `updated` → final state from the retrieve (canceled); `checkout.session.completed` links customer to org.
- [ ] Implement; commit.

### Task 11: Billing actions, codes by link, onboarding step

**Files:** Create `src/app/billing-actions.ts`, `src/app/p/[code]/route.ts`, `src/app/onboarding/plan/page.tsx`; Modify `src/app/actions.ts` (after createOrganization: redeem pending code cookie, then redirect to the plan step when billing on)
- Test: `tests/billing-actions.test.ts`

- [ ] `choosePlanAction(plan)` (free → dashboard; paid → startTrial or checkout when already trialed), `redeemCodeAction(code)`, `startCheckoutAction(plan, interval)`, `openPortalAction()`; `/p/CODE` sets `nz_code` cookie (30 days) and redirects to sign-up, or redeems at once when signed in.
- [ ] Tests: code cookie redeemed on workspace creation; a throwing redemption never fails creation; actions require an org and the governance rank.
- [ ] Implement; commit.

### Task 12: Trial reminder emails

**Files:** Create `src/lib/billing/emails.ts`, `src/inngest/functions/billing.ts`; Modify `src/inngest/functions/index.ts`
- Test: `tests/billing-emails.test.ts`, existing `tests/inngest-config.test.ts`

- [ ] Event `billing/trial.started` → sleepUntil end−7d → send if still trialing and unpaid; −1d; end. Emails via Resend (`BILLING_EMAIL_FROM`), skipped when unset. Tests for due-ness decisions and copy; config test passes.
- [ ] Implement; commit.

### Task 13: Plan picker, pricing page, Plan & billing settings

**Files:** Create `src/components/billing/plan-picker.tsx` (+ `plan-picker.module.css`), `src/app/pricing/page.tsx`, `src/app/dashboard/settings/billing/page.tsx`, `src/app/design/billing/page.tsx` (fixture)
- Test: `tests/billing-ui.test.ts` (render), screenshots of `/design/billing`

- [ ] Picker: interval toggle ("Save 20%"), 3 cards, Growth raised "Most popular", struck price + FREE, "30 days free, then $X/month", Start 30-day free trial / No card needed, Continue free, access code field, "Need more? Talk to us". Settings: current plan/state, trial days, usage bars, Manage billing. Render tests assert copy per state; look at screenshots in light and dark.
- [ ] Implement; commit.

### Task 14: Locked tiles, upgrade dialog, banners

**Files:** Create `src/components/billing/upgrade-dialog.tsx`, `src/components/billing/locked-tile.tsx`, `src/components/billing/plan-banner.tsx`; Modify the board tile renderer to render `locked` rows, AppShell/dashboard to render banners
- Test: `tests/billing-locked-ui.test.ts`, fixture on `/design/billing`

- [ ] Locked tile: name + lock + static blurred placeholder (SVG with no data) → opens dialog. Banners: trial ≤7 days, past due, downgraded with locked count. Tests assert the placeholder never contains a number from the row.
- [ ] Implement; commit.

### Task 15: Referral rewards granted automatically

**Files:** Create `src/lib/billing/referral-rewards.ts`; Modify `src/lib/referral-store.ts` (after a referral is recorded)
- Test: `tests/billing-referral-rewards.test.ts`

- [ ] Reaching rung k grants Growth for its months on the referrer's owned workspaces (unique per rung); lifetime rung → lifetime; when the workspace pays through Stripe → a balance credit instead (fake client); idempotent on repeat.
- [ ] Implement; commit.

### Task 16: Tracking links and attribution

**Files:** Create `src/lib/growth/links.ts`, `src/app/go/[slug]/route.ts`; Modify `src/app/actions.ts` and `src/app/callback/route.ts` (record acquisition)
- Test: `tests/growth-links.test.ts`

- [ ] `/go/slug` records a click (bot UAs skipped), sets `nz_src` (30 days), redirects with utm params; unknown/archived slug → `/`. Acquisition recorded once per org from the cookie; no cookie → direct; a throw never fails sign-up. Funnel query returns clicks/sign-ups/activated/metric/trial/paid per link and per source.
- [ ] Implement; commit.

### Task 17: Admin panel

**Files:** Modify `src/app/admin/layout.tsx` (tabs), `src/app/admin/page.tsx` (channels, trials, paying, MRR, launch button), `src/app/admin/search/page.tsx` (links to workspace pages); Create `src/app/admin/workspaces/[orgId]/page.tsx`, `src/app/admin/codes/page.tsx`, `src/app/admin/links/page.tsx`, `src/app/admin/log/page.tsx`, `src/app/admin/actions.ts`; Modify `src/lib/audit.ts` (admin.* and billing.* actions)
- Test: `tests/admin-actions.test.ts`

- [ ] Every exported admin action calls `requireStaff()` first (source scan that can fail) and writes an audit row with enum-only detail; grant/revoke/create-code/disable-code/create-link/archive-link/launch-trials behave (PGlite); launch trials is idempotent.
- [ ] Implement; commit.

### Task 18: Verify and hand over

- [ ] Full bar: typecheck, full vitest (`--maxWorkers=2`, JSON), check:ui, check:orphans, check:tenancy, build, browser checks (landing, geometry, frame, board:drag, flow), screenshots of `/design/billing` in three modes.
- [ ] HAND_APPLY entry for 0035 with the verify query; owner pastes into dev + prod; push; verify production with the flag off.
- [ ] Owner hand-over: Stripe setup steps, env vars, test run in the sandbox, launch steps.
