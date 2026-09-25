import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { billingSubscriptions } from "@/db/schema";
import type { DB } from "@/db/types";
import { workspacePlan } from "@/lib/billing/state";
import {
  BillingNotConfigured,
  createCheckout,
  createPortal,
  ensureCustomer,
  stripeClient,
  syncSubscription,
  type StripeClient,
} from "@/lib/billing/stripe";

/**
 * STRIPE, SEEN FROM OUR SIDE — what we send and what we keep.
 *
 * A fake client records every call, so these pin the exact Checkout request
 * (Managed Payments on, the parameters it forbids left out, the trial carried
 * over) and the mirror row a subscription becomes. Nothing here talks to Stripe.
 */

let db: DB;
let close: () => Promise<void>;
const ORG = "org_pay";
const DAY = 86_400_000;

type Recorded = { checkout: Record<string, unknown>[]; customers: Record<string, unknown>[]; portal: Record<string, unknown>[] };

function fakeStripe(subscriptions: Record<string, unknown> = {}): { client: StripeClient; calls: Recorded } {
  const calls: Recorded = { checkout: [], customers: [], portal: [] };
  const prices: Record<string, string> = { growth_monthly: "price_gm", growth_yearly: "price_gy", scale_monthly: "price_sm", scale_yearly: "price_sy" };
  const client = {
    prices: {
      list: async (p: { lookup_keys: string[] }) => ({ data: p.lookup_keys.filter((k) => prices[k]).map((k) => ({ id: prices[k], lookup_key: k })) }),
    },
    customers: {
      create: async (p: Record<string, unknown>) => {
        calls.customers.push(p);
        return { id: `cus_${calls.customers.length}` };
      },
    },
    checkout: {
      sessions: {
        create: async (p: Record<string, unknown>) => {
          calls.checkout.push(p);
          return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" };
        },
        retrieve: async () => ({ id: "cs_1", subscription: "sub_1", customer: "cus_1", client_reference_id: ORG }),
      },
    },
    billingPortal: {
      sessions: {
        create: async (p: Record<string, unknown>) => {
          calls.portal.push(p);
          return { url: "https://billing.stripe.test/p_1" };
        },
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        const s = subscriptions[id];
        if (!s) throw new Error(`no such subscription ${id}`);
        return s;
      },
    },
  } as unknown as StripeClient;
  return { client, calls };
}

function sub(over: Record<string, unknown> = {}, lookup = "growth_yearly") {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    trial_end: null,
    metadata: { org_id: ORG },
    items: { data: [{ current_period_end: Math.floor(Date.UTC(2027, 8, 26) / 1000), price: { id: "price_x", lookup_key: lookup, unit_amount: 46800, currency: "usd" } }] },
    ...over,
  };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

const who = { email: "owner@example.com", name: "Owner's workspace" };

describe("the client", () => {
  it("refuses to start without a secret key, rather than calling Stripe unauthenticated", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(() => stripeClient()).toThrow(BillingNotConfigured);
  });
});

describe("Checkout", () => {
  it("sells through Managed Payments by default, and leaves out every parameter it forbids", async () => {
    const { client, calls } = fakeStripe();
    const url = await createCheckout(db, { orgId: ORG, plan: "growth", interval: "month", ...who, trialEnd: null, returnBase: "https://namzilabs.co" }, client);
    expect(url).toBe("https://checkout.stripe.test/cs_1");
    const p = calls.checkout[0];
    expect(p).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: ORG,
      line_items: [{ price: "price_gm", quantity: 1 }],
      managed_payments: { enabled: true },
      allow_promotion_codes: true,
      subscription_data: { metadata: { org_id: ORG } },
    });
    for (const forbidden of ["automatic_tax", "tax_id_collection", "customer_update", "payment_method_types", "invoice_creation"]) {
      expect(p, forbidden).not.toHaveProperty(forbidden);
    }
    expect((p.subscription_data as Record<string, unknown>).invoice_settings).toBeUndefined();
    expect(String(p.success_url)).toContain("/dashboard/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}");
    expect(String(p.cancel_url)).toContain("/dashboard/settings/billing?checkout=cancelled");
  });

  it("uses standard Stripe with automatic tax when Managed Payments is switched off", async () => {
    vi.stubEnv("STRIPE_MANAGED_PAYMENTS", "0");
    const { client, calls } = fakeStripe();
    await createCheckout(db, { orgId: ORG, plan: "scale", interval: "year", ...who, trialEnd: null, returnBase: "https://namzilabs.co" }, client);
    expect(calls.checkout[0]).toMatchObject({ automatic_tax: { enabled: true }, line_items: [{ price: "price_sy", quantity: 1 }] });
    expect(calls.checkout[0]).not.toHaveProperty("managed_payments");
  });

  it("carries a trial's remaining days over, so paying early never costs them", async () => {
    const { client, calls } = fakeStripe();
    const trialEnd = new Date(Date.now() + 20 * DAY);
    await createCheckout(db, { orgId: ORG, plan: "growth", interval: "month", ...who, trialEnd, returnBase: "https://namzilabs.co" }, client);
    expect((calls.checkout[0].subscription_data as Record<string, unknown>).trial_end).toBe(Math.floor(trialEnd.getTime() / 1000));
  });

  it("does not ask Stripe for a trial it would refuse (less than two days left)", async () => {
    const { client, calls } = fakeStripe();
    await createCheckout(db, { orgId: ORG, plan: "growth", interval: "month", ...who, trialEnd: new Date(Date.now() + DAY), returnBase: "https://namzilabs.co" }, client);
    expect((calls.checkout[0].subscription_data as Record<string, unknown>).trial_end).toBeUndefined();
  });

  it("keeps a free period longer than Stripe allows inside its two-year limit", async () => {
    const { client, calls } = fakeStripe();
    const before = Date.now();
    await createCheckout(db, { orgId: ORG, plan: "growth", interval: "month", ...who, trialEnd: new Date(before + 1000 * DAY), returnBase: "https://namzilabs.co" }, client);
    const sent = (calls.checkout[0].subscription_data as Record<string, number>).trial_end * 1000;
    expect(sent).toBeLessThanOrEqual(Date.now() + 730 * DAY);
    expect(sent).toBeGreaterThan(before + 720 * DAY);
  });

  it("creates one Stripe customer per workspace and reuses it", async () => {
    const { client, calls } = fakeStripe();
    expect(await ensureCustomer(db, ORG, who, client)).toBe("cus_1");
    expect(await ensureCustomer(db, ORG, who, client)).toBe("cus_1");
    expect(calls.customers).toHaveLength(1);
    expect(calls.customers[0]).toMatchObject({ email: who.email, name: who.name, metadata: { org_id: ORG } });
  });
});

describe("the billing portal", () => {
  it("opens for a workspace that has a customer, and refuses one that has none", async () => {
    const { client, calls } = fakeStripe();
    await expect(createPortal(db, ORG, "https://namzilabs.co/dashboard/settings/billing", client)).rejects.toThrow();
    await ensureCustomer(db, ORG, who, client);
    expect(await createPortal(db, ORG, "https://namzilabs.co/dashboard/settings/billing", client)).toBe("https://billing.stripe.test/p_1");
    expect(calls.portal[0]).toMatchObject({ customer: "cus_1", return_url: "https://namzilabs.co/dashboard/settings/billing" });
  });
});

describe("syncSubscription", () => {
  it("mirrors the subscription Stripe returns, and the workspace takes its plan", async () => {
    const { client } = fakeStripe({ sub_1: sub() });
    await ensureCustomer(db, ORG, who, client);
    await syncSubscription(db, "sub_1", client);
    const [row] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, ORG));
    expect(row).toMatchObject({ stripeSubscriptionId: "sub_1", plan: "growth", interval: "year", status: "active", amountCents: 46800, currency: "usd", cancelAtPeriodEnd: false });
    expect(row.currentPeriodEnd?.toISOString()).toBe("2027-09-26T00:00:00.000Z");
    expect((await workspacePlan(db, ORG)).plan).toBe("growth");
  });

  it("finds the workspace by customer when the subscription carries no org id", async () => {
    const { client } = fakeStripe({ sub_1: sub({ metadata: {} }) });
    await ensureCustomer(db, ORG, who, client);
    await syncSubscription(db, "sub_1", client);
    expect((await workspacePlan(db, ORG)).plan).toBe("growth");
  });

  it("never lets an old, finished subscription overwrite a live one", async () => {
    const { client } = fakeStripe({ sub_1: sub(), sub_old: sub({ id: "sub_old", status: "canceled" }) });
    await ensureCustomer(db, ORG, who, client);
    await syncSubscription(db, "sub_1", client);
    await syncSubscription(db, "sub_old", client);
    const [row] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, ORG));
    expect(row).toMatchObject({ stripeSubscriptionId: "sub_1", status: "active" });
  });

  it("records a price it does not recognise without granting a plan", async () => {
    const { client } = fakeStripe({ sub_1: sub({}, "something_else") });
    await ensureCustomer(db, ORG, who, client);
    await syncSubscription(db, "sub_1", client);
    expect((await workspacePlan(db, ORG)).plan).toBe("free");
  });
});
