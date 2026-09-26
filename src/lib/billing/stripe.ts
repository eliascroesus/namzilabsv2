import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { billingSubscriptions } from "@/db/schema";
import type { DB } from "@/db/types";
import { isUndefinedTableError } from "@/lib/db-errors";
import { PLANS, planForLookupKey, type Interval, type PaidPlanId } from "./plans";
import { applyPlan } from "./pauses";

/**
 * STRIPE — used only when someone pays. Trials, codes and grants never touch
 * it (see lib/billing/state.ts), which keeps unconverted sign-ups out of the
 * Stripe account and keeps Managed Payments possible.
 *
 * Every function takes the client as its last argument so the tests can hand
 * in a recording fake; the default is the real one.
 */

export class BillingNotConfigured extends Error {
  constructor() {
    super("Stripe is not configured: set STRIPE_SECRET_KEY.");
    this.name = "BillingNotConfigured";
  }
}

export type StripeClient = Pick<Stripe, "prices" | "customers" | "checkout" | "billingPortal" | "subscriptions">;

let cached: { key: string; client: Stripe } | null = null;

/** The Stripe SDK on its pinned API version (≥ 2025-03-31.basil, which Managed Payments needs). */
export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingNotConfigured();
  if (!cached || cached.key !== key) cached = { key, client: new Stripe(key, { appInfo: { name: "Namzilabs" } }) };
  return cached.client;
}

/**
 * MANAGED PAYMENTS UNLESS SWITCHED OFF. Stripe is then the merchant of record
 * and handles VAT and sales tax worldwide; `STRIPE_MANAGED_PAYMENTS=0` sells as
 * the owner's business with Stripe Tax instead.
 */
export function managedPayments(): boolean {
  return process.env.STRIPE_MANAGED_PAYMENTS !== "0";
}

const priceIds = new Map<string, string>();

/** The live price for a plan and interval, found by the lookup key the owner set in Stripe. */
export async function priceIdFor(plan: PaidPlanId, interval: Interval, client: StripeClient = stripeClient()): Promise<string> {
  const key = PLANS[plan].lookupKeys![interval];
  const hit = priceIds.get(key);
  if (hit) return hit;
  const res = await client.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  const id = res.data[0]?.id;
  if (!id) throw new Error(`No active Stripe price has the lookup key "${key}". Create it in the Stripe dashboard.`);
  priceIds.set(key, id);
  return id;
}

async function customerOf(db: DB, orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ customer: billingSubscriptions.stripeCustomerId })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, orgId))
    .limit(1);
  return row?.customer ?? null;
}

/** One Stripe Customer per workspace, created at the first checkout and reused after. */
export async function ensureCustomer(
  db: DB,
  orgId: string,
  who: { email: string; name: string },
  client: StripeClient = stripeClient(),
): Promise<string> {
  const existing = await customerOf(db, orgId);
  if (existing) return existing;
  const created = await client.customers.create({ email: who.email, name: who.name, metadata: { org_id: orgId } });
  const inserted = await db
    .insert(billingSubscriptions)
    .values({ orgId, stripeCustomerId: created.id })
    .onConflictDoNothing()
    .returning({ customer: billingSubscriptions.stripeCustomerId });
  // Lost a race with another tab: the row that won is the customer.
  return inserted[0]?.customer ?? (await customerOf(db, orgId)) ?? created.id;
}

/** Stripe refuses a Checkout trial ending less than 48 hours out, or more than two years out. */
const MIN_TRIAL_MS = 48 * 3_600_000;
const MAX_TRIAL_MS = 729 * 86_400_000;

/**
 * A Checkout Session for a plan. A workspace still in its trial keeps the rest
 * of it: the subscription starts with `trial_end` at the trial's own end, so
 * paying early never costs a day. Returns the URL to send the owner to.
 */
export async function createCheckout(
  db: DB,
  input: {
    orgId: string;
    plan: PaidPlanId;
    interval: Interval;
    email: string;
    name: string;
    trialEnd: Date | null;
    returnBase: string;
  },
  client: StripeClient = stripeClient(),
): Promise<string> {
  const customer = await ensureCustomer(db, input.orgId, input, client);
  const price = await priceIdFor(input.plan, input.interval, client);
  const keepTrial = input.trialEnd != null && input.trialEnd.getTime() - Date.now() > MIN_TRIAL_MS;
  const base = input.returnBase.replace(/\/$/, "");
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    client_reference_id: input.orgId,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    metadata: { org_id: input.orgId },
    subscription_data: {
      metadata: { org_id: input.orgId },
      // A free period longer than Stripe allows (a long access code) is kept
      // up to the limit; the first charge lands then instead of never.
      ...(keepTrial ? { trial_end: Math.floor(Math.min(input.trialEnd!.getTime(), Date.now() + MAX_TRIAL_MS) / 1000) } : {}),
    },
    success_url: `${base}/dashboard/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/dashboard/settings/billing?checkout=cancelled`,
    // Managed Payments forbids automatic_tax, tax_id_collection and
    // customer_update — Stripe owns the tax side as merchant of record.
    ...(managedPayments()
      ? { managed_payments: { enabled: true } }
      : {
          automatic_tax: { enabled: true },
          customer_update: { address: "auto" as const, name: "auto" as const },
          tax_id_collection: { enabled: true },
        }),
  };
  const session = await client.checkout.sessions.create(params);
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL.");
  return session.url;
}

/** Stripe's billing portal for the workspace: card, invoices, cancel, plan and interval changes. */
export async function createPortal(db: DB, orgId: string, returnUrl: string, client: StripeClient = stripeClient()): Promise<string> {
  const customer = await customerOf(db, orgId);
  if (!customer) throw new Error("This workspace has no billing account yet.");
  const session = await client.billingPortal.sessions.create({ customer, return_url: returnUrl });
  return session.url;
}

const LIVE = new Set(["active", "trialing", "past_due"]);

/**
 * REBUILD THE MIRROR FROM STRIPE'S OWN COPY. Webhooks arrive out of order and
 * more than once, so the row is never patched from an event body — the
 * subscription is read fresh and written whole. Then the plan is applied:
 * paused apps resume, or pause, to match it.
 *
 * An old subscription that has ended never overwrites a different one that is
 * live (a late `deleted` for a plan someone already replaced).
 */
export async function syncSubscription(
  db: DB,
  subscriptionId: string,
  client: StripeClient = stripeClient(),
): Promise<{ orgId: string | null }> {
  // No `expand`: a subscription item's price is always sent in full, and asking
  // Stripe to expand a property that is not an id is an error — which would
  // fail every webhook and every return from Checkout.
  let s: Stripe.Subscription;
  try {
    s = (await client.subscriptions.retrieve(subscriptionId)) as Stripe.Subscription;
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== "resource_missing") throw e;
    // STRIPE NO LONGER HAS IT (a data-deletion request, a deleted test object).
    // Retrying cannot change that, so it ends here as canceled rather than as
    // an event that fails for three days and leaves the plan standing.
    const ended = await db
      .update(billingSubscriptions)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(eq(billingSubscriptions.stripeSubscriptionId, subscriptionId))
      .returning({ orgId: billingSubscriptions.orgId });
    const orgId = ended[0]?.orgId ?? null;
    if (orgId) await applyPlan(db, orgId).catch(() => {});
    return { orgId };
  }
  const customerId = typeof s.customer === "string" ? s.customer : s.customer.id;
  let orgId: string | null = s.metadata?.org_id ?? null;
  if (!orgId) {
    const [row] = await db
      .select({ orgId: billingSubscriptions.orgId })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.stripeCustomerId, customerId))
      .limit(1);
    orgId = row?.orgId ?? null;
  }
  if (!orgId) return { orgId: null };

  const [existing] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, orgId)).limit(1);
  if (
    existing?.stripeSubscriptionId &&
    existing.stripeSubscriptionId !== s.id &&
    existing.status &&
    LIVE.has(existing.status) &&
    !LIVE.has(s.status)
  ) {
    return { orgId };
  }

  const item = s.items.data[0];
  const price = item?.price;
  const mapped = planForLookupKey(price?.lookup_key ?? null);
  const values = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: s.id,
    plan: mapped?.plan ?? null,
    interval: mapped?.interval ?? null,
    status: s.status,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    trialEnd: s.trial_end ? new Date(s.trial_end * 1000) : null,
    amountCents: price?.unit_amount ?? null,
    currency: price?.currency ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(billingSubscriptions)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: billingSubscriptions.orgId, set: values });
  await applyPlan(db, orgId);
  return { orgId };
}

/** After Checkout: sync the session's subscription straight away, so the unlock never waits for a webhook. */
export async function syncCheckoutSession(db: DB, sessionId: string, client: StripeClient = stripeClient()): Promise<{ orgId: string | null }> {
  const session = await client.checkout.sessions.retrieve(sessionId);
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
  if (!subscriptionId) return { orgId: session.client_reference_id ?? null };
  return syncSubscription(db, subscriptionId, client);
}

/** Statuses after which a subscription can no longer charge anybody. */
const FINISHED = new Set(["canceled", "incomplete_expired"]);

/** Stripe would not cancel a deleted workspace's subscription — so nothing was deleted. */
export class SubscriptionNotCancelled extends Error {
  constructor(
    readonly orgId: string,
    readonly cause: unknown,
  ) {
    super(`Stripe did not cancel the subscription for ${orgId}`);
    this.name = "SubscriptionNotCancelled";
  }
}

/**
 * THE WORKSPACE IS BEING DELETED: stop charging for it, now.
 *
 * Called before a single row goes. Cancels immediately (no proration, no
 * final invoice — they chose to delete). A subscription Stripe no longer has
 * counts as cancelled. Anything else Stripe says THROWS, on purpose: the
 * deletion stops before anything is gone, because a customer billed every
 * month for a workspace that no longer exists is worse than a delete that
 * asks them to try again. No billing table yet (migration 0035 unapplied)
 * means nothing was ever billed. Returns whether Stripe was asked.
 */
export async function cancelForDeletion(db: DB, orgId: string, client?: StripeClient): Promise<boolean> {
  let row: { subscriptionId: string | null; status: string | null } | undefined;
  try {
    [row] = await db
      .select({ subscriptionId: billingSubscriptions.stripeSubscriptionId, status: billingSubscriptions.status })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.orgId, orgId))
      .limit(1);
  } catch (e) {
    if (isUndefinedTableError(e)) return false;
    throw e;
  }
  if (!row?.subscriptionId || FINISHED.has(row.status ?? "")) return false;
  try {
    await (client ?? stripeClient()).subscriptions.cancel(row.subscriptionId, { invoice_now: false, prorate: false });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== "resource_missing") throw new SubscriptionNotCancelled(orgId, e);
  }
  // Marked here so a second pass (the account delete cancels every workspace
  // before destroying any) does not ask Stripe to cancel it again.
  await db.update(billingSubscriptions).set({ status: "canceled", updatedAt: new Date() }).where(eq(billingSubscriptions.orgId, orgId));
  return true;
}
