import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { billingSubscriptions } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * THE STRIPE WEBHOOK — verified, idempotent, order-independent.
 *
 * Nothing in an event body is trusted as state: every subscription or invoice
 * event re-reads the subscription and rebuilds the mirror row, so a duplicate
 * changes nothing and a stale event arriving last cannot undo a newer one.
 */

let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

const { POST } = await import("@/app/api/webhooks/stripe-billing/route");
const { handleBillingEvent } = await import("@/lib/billing/webhook");
const { ensureCustomer } = await import("@/lib/billing/stripe");
type Client = Parameters<typeof handleBillingEvent>[2];

const ORG = "org_hook";
const SECRET = "whsec_test_secret";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

/** A fake whose subscription is whatever `state.status` says NOW — Stripe's canonical copy. */
function fake(state: { status: string }) {
  const retrieves: string[] = [];
  const client = {
    customers: { create: async () => ({ id: "cus_1" }) },
    subscriptions: {
      retrieve: async (id: string) => {
        retrieves.push(id);
        return {
          id,
          customer: "cus_1",
          status: state.status,
          cancel_at_period_end: false,
          trial_end: null,
          metadata: { org_id: ORG },
          items: { data: [{ current_period_end: 1_900_000_000, price: { lookup_key: "growth_monthly", unit_amount: 4900, currency: "usd" } }] },
        };
      },
    },
    checkout: { sessions: { retrieve: async () => ({ subscription: "sub_1", client_reference_id: ORG }) } },
  } as unknown as Client;
  return { client, retrieves };
}

const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_${Math.random()}`, type, data: { object } }) as unknown as Stripe.Event;
const status = async () => (await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, ORG)))[0]?.status;

describe("handleBillingEvent", () => {
  it("rebuilds the mirror from Stripe's own copy of the subscription", async () => {
    const { client } = fake({ status: "active" });
    await ensureCustomer(db, ORG, { email: "o@x.co", name: "O" }, client as never);
    await handleBillingEvent(db, event("customer.subscription.updated", { id: "sub_1" }), client);
    expect(await status()).toBe("active");
  });

  it("changes nothing on a duplicate", async () => {
    const { client } = fake({ status: "active" });
    const e = event("customer.subscription.created", { id: "sub_1" });
    await handleBillingEvent(db, e, client);
    await handleBillingEvent(db, e, client);
    expect(await db.select().from(billingSubscriptions)).toHaveLength(1);
  });

  it("ends in the true state when a stale event arrives last", async () => {
    const state = { status: "canceled" };
    const { client } = fake(state);
    await handleBillingEvent(db, event("customer.subscription.deleted", { id: "sub_1", status: "canceled" }), client);
    // An older `updated` whose body still says active, delivered late:
    await handleBillingEvent(db, event("customer.subscription.updated", { id: "sub_1", status: "active" }), client);
    expect(await status()).toBe("canceled");
  });

  it("follows a completed checkout to its subscription", async () => {
    const { client, retrieves } = fake({ status: "trialing" });
    await handleBillingEvent(db, event("checkout.session.completed", { id: "cs_1", subscription: "sub_1", client_reference_id: ORG }), client);
    expect(retrieves).toEqual(["sub_1"]);
    expect(await status()).toBe("trialing");
  });

  it("follows a failed invoice to its subscription", async () => {
    const { client, retrieves } = fake({ status: "past_due" });
    await handleBillingEvent(db, event("invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } }), client);
    expect(retrieves).toEqual(["sub_1"]);
    expect(await status()).toBe("past_due");
  });

  it("ignores events it has no use for, without calling Stripe", async () => {
    const { client, retrieves } = fake({ status: "active" });
    await handleBillingEvent(db, event("charge.succeeded", { id: "ch_1" }), client);
    expect(retrieves).toEqual([]);
  });
});

describe("the route", () => {
  const post = (body: string, signature: string | null) =>
    POST(new Request("https://namzilabs.co/api/webhooks/stripe-billing", { method: "POST", body, headers: signature ? { "stripe-signature": signature } : {} }));

  it("answers 503 until the signing secret is set", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await post("{}", "t=1,v1=x")).status).toBe(503);
  });

  it("refuses a body whose signature does not verify", async () => {
    expect((await post(JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" }), "t=1,v1=forged")).status).toBe(400);
    expect((await post("{}", null)).status).toBe(400);
  });

  it("accepts a correctly signed event", async () => {
    const payload = JSON.stringify({ id: "evt_ok", object: "event", type: "charge.succeeded", data: { object: { id: "ch_1" } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect((await post(payload, signature)).status).toBe(200);
  });
});
