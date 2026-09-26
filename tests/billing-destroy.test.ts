import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { accessGrants, billingSubscriptions, flows, trialClaims, workspaceAcquisitions } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * DELETING A WORKSPACE THAT PAYS.
 *
 * The one thing worse than keeping a deleted customer's data is charging them
 * for it. A live Stripe subscription is cancelled FIRST — and if Stripe will
 * not cancel it, nothing is deleted, so the owner is told rather than billed
 * for a workspace that is gone.
 */

let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));

const { destroyWorkspaceData, destroyUserData } = await import("@/lib/destroy");
const { cancelForDeletion, SubscriptionNotCancelled } = await import("@/lib/billing/stripe");
type Client = NonNullable<NonNullable<Parameters<typeof destroyWorkspaceData>[2]>["stripe"]>;

const ORG = "org_paying";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

function fakeStripe(opts: { fail?: Error } = {}) {
  const cancelled: string[] = [];
  const client = {
    subscriptions: {
      cancel: async (id: string) => {
        if (opts.fail) throw opts.fail;
        cancelled.push(id);
        return { id, status: "canceled" };
      },
    },
  } as unknown as Client;
  return { client, cancelled };
}

async function payingWorkspace(status = "active") {
  await db.insert(billingSubscriptions).values({ orgId: ORG, stripeCustomerId: "cus_p", stripeSubscriptionId: "sub_p", plan: "growth", interval: "month", status });
  await db.insert(accessGrants).values({ orgId: ORG, plan: "growth", kind: "trial", endsAt: new Date(Date.now() + 86_400_000) });
  await db.insert(workspaceAcquisitions).values({ orgId: ORG, source: "direct", medium: "none" });
  await db.insert(flows).values({ orgId: ORG, name: "Cash", draftGraph: { nodes: [], edges: [], metrics: [] } });
}

describe("deleting a workspace with a subscription", () => {
  it("cancels it at Stripe, then removes the workspace's billing rows with everything else", async () => {
    await payingWorkspace();
    const { client, cancelled } = fakeStripe();
    const res = await destroyWorkspaceData(db, ORG, { stripe: client });
    expect(cancelled).toEqual(["sub_p"]);
    for (const t of [billingSubscriptions, accessGrants, workspaceAcquisitions, flows]) {
      expect(await db.select().from(t).where(eq(t.orgId, ORG))).toHaveLength(0);
    }
    expect(res.rows.billing_subscriptions).toBe(1);
  });

  it("deletes nothing when Stripe refuses to cancel — the owner hears about it instead of being billed", async () => {
    await payingWorkspace();
    const { client } = fakeStripe({ fail: new Error("api_connection_error") });
    await expect(destroyWorkspaceData(db, ORG, { stripe: client })).rejects.toBeInstanceOf(SubscriptionNotCancelled);
    expect(await db.select().from(flows).where(eq(flows.orgId, ORG))).toHaveLength(1);
    expect(await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, ORG))).toHaveLength(1);
  });

  it("does not call Stripe for a subscription that already ended, or for a workspace that never paid", async () => {
    await payingWorkspace("canceled");
    const { client, cancelled } = fakeStripe();
    await destroyWorkspaceData(db, ORG, { stripe: client });
    await destroyWorkspaceData(db, "org_never_paid", { stripe: client });
    expect(cancelled).toEqual([]);
  });

  it("treats a subscription Stripe says is already gone as cancelled", async () => {
    await payingWorkspace();
    const gone = Object.assign(new Error("No such subscription: 'sub_p'"), { code: "resource_missing" });
    const { client } = fakeStripe({ fail: gone });
    await expect(destroyWorkspaceData(db, ORG, { stripe: client })).resolves.toBeTruthy();
    expect(await db.select().from(flows).where(eq(flows.orgId, ORG))).toHaveLength(0);
  });

  it("works before migration 0035 is pasted — the billing tables simply are not there", async () => {
    await db.insert(flows).values({ orgId: ORG, name: "Cash", draftGraph: { nodes: [], edges: [], metrics: [] } });
    for (const t of ["access_grants", "billing_subscriptions", "workspace_acquisitions", "plan_pauses"]) {
      await db.execute(sql.raw(`drop table if exists ${t} cascade`));
    }
    await expect(destroyWorkspaceData(db, ORG, { stripe: fakeStripe().client })).resolves.toBeTruthy();
    expect(await db.select().from(flows).where(eq(flows.orgId, ORG))).toHaveLength(0);
  });
});

describe("cancelling ahead of the delete", () => {
  it("asks Stripe once — a cancelled subscription is marked, so the sweep that follows does not ask again", async () => {
    await payingWorkspace();
    const { client, cancelled } = fakeStripe();
    expect(await cancelForDeletion(db, ORG, client)).toBe(true);
    expect(await cancelForDeletion(db, ORG, client)).toBe(false);
    expect(cancelled).toEqual(["sub_p"]);
  });

  it("the delete actions turn a refusal into their own 'nothing was deleted' message", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/settings/danger-actions.ts", "utf8");
    const del = src.slice(src.indexOf("export async function deleteWorkspaceAction"), src.indexOf("export async function deleteAccountAction"));
    expect(del).toMatch(/SubscriptionNotCancelled/);
    // Deleting an account cancels EVERY owned workspace's subscription before destroying any of them.
    const acct = src.slice(src.indexOf("export async function deleteAccountAction"));
    expect(acct.indexOf("cancelForDeletion(")).toBeGreaterThan(-1);
    expect(acct.indexOf("cancelForDeletion(")).toBeLessThan(acct.indexOf("destroyWorkspaceData("));
  });
});

describe("the trial claim", () => {
  it("outlives the workspace — deleting it must not hand its owner a second trial", async () => {
    await db.insert(trialClaims).values({ userId: "user_owner", orgId: ORG, plan: "growth" });
    await destroyWorkspaceData(db, ORG, { stripe: fakeStripe().client });
    expect(await db.select().from(trialClaims)).toHaveLength(1);
  });

  it("goes with the person when they delete their account", async () => {
    await db.insert(trialClaims).values({ userId: "user_owner", orgId: ORG, plan: "growth" });
    const rows = await destroyUserData(db, "user_owner");
    expect(rows.trial_claims).toBe(1);
    expect(await db.select().from(trialClaims)).toHaveLength(0);
  });
});
