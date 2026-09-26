import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { accessGrants, auditLog, billingSubscriptions, referralCodes, referrals, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * REFERRAL REWARDS, PAID WITHOUT ANYONE DOING IT BY HAND.
 *
 * The ladder the customer is shown (`MILESTONES`) is the ladder that pays:
 * reaching a rung gives the referrer's workspace that rung's months of Growth,
 * added after whatever free time it already has — or, when the workspace pays
 * through Stripe, the same months as a credit on its Stripe balance. Each rung
 * pays once per workspace, however many times the sums are run.
 */

const hoisted = vi.hoisted(() => ({ sent: [] as Array<{ name: string; data: Record<string, unknown> }> }));
let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/inngest/client")>()),
  inngest: {
    send: async (e: { name: string; data: Record<string, unknown> }) => void hoisted.sent.push(e),
    createFunction: (config: unknown, fn: unknown) => ({ config, fn }),
  },
}));

const { grantReferralRewards } = await import("@/lib/billing/referral-rewards");
const { workspacePlan } = await import("@/lib/billing/state");
const { recordReferral } = await import("@/lib/referral-store");
const { MILESTONES, referralCode } = await import("@/lib/referral");
type Client = NonNullable<Parameters<typeof grantReferralRewards>[2]>["client"];

const REFERRER = "user_referrer";
const ORG = "org_referrer";
const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 86_400_000;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
  hoisted.sent.length = 0;
  await db.insert(workspaceOwners).values({ orgId: ORG, userId: REFERRER, source: "created" });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

async function referred(n: number) {
  for (let i = 0; i < n; i++) {
    await db.insert(referrals).values({ referrerUserId: REFERRER, referredUserId: `user_new_${Math.random()}`, code: "abcdefgh" });
  }
}
const grants = () => db.select().from(accessGrants).where(eq(accessGrants.orgId, ORG)).orderBy(accessGrants.referralRung);

function fakeStripe(opts: { fail?: boolean } = {}) {
  const calls: Array<{ customer: string; params: Record<string, unknown>; key?: string }> = [];
  const client = {
    customers: {
      createBalanceTransaction: async (customer: string, params: Record<string, unknown>, o?: { idempotencyKey?: string }) => {
        if (opts.fail) throw new Error("This feature is not available with Managed Payments");
        calls.push({ customer, params, key: o?.idempotencyKey });
        return { id: `cbtxn_${calls.length}` };
      },
    },
  } as unknown as Client;
  return { client, calls };
}

describe("the ladder pays what it advertises", () => {
  it("states each rung's months in the words the customer reads", () => {
    for (const m of MILESTONES) {
      const words = m.months === 12 ? "1 year free" : `${m.months} ${m.months === 1 ? "month" : "months"} free`;
      expect(m.reward).toBe(words);
    }
  });
});

describe("a workspace that does not pay", () => {
  it("gets the rung's months of Growth when its owner reaches it", async () => {
    await referred(1);
    const out = await grantReferralRewards(db, REFERRER, { now: NOW });
    expect(out).toEqual([expect.objectContaining({ rung: 1, months: 1, form: "grant", orgId: ORG })]);
    const [g] = await grants();
    expect(g).toMatchObject({ plan: "growth", kind: "referral", referralRung: 1 });
    expect(g.startsAt).toEqual(NOW);
    expect(g.endsAt).toEqual(new Date("2026-11-01T12:00:00Z"));
    expect((await workspacePlan(db, ORG, new Date(NOW.getTime() + DAY))).plan).toBe("growth");
  });

  it("adds each rung after the last, so reaching three invites is one month and then three more", async () => {
    await referred(3);
    await grantReferralRewards(db, REFERRER, { now: NOW });
    const [one, three] = await grants();
    expect(one.endsAt).toEqual(new Date("2026-11-01T12:00:00Z"));
    expect(three.startsAt).toEqual(one.endsAt);
    expect(three.endsAt).toEqual(new Date("2027-02-01T12:00:00Z"));
    expect((await workspacePlan(db, ORG, new Date("2027-01-15T00:00:00Z"))).plan).toBe("growth");
  });

  it("starts after free time the workspace already has, rather than inside it", async () => {
    await db.insert(accessGrants).values({ orgId: ORG, plan: "growth", kind: "trial", startsAt: NOW, endsAt: new Date(NOW.getTime() + 20 * DAY) });
    await referred(1);
    await grantReferralRewards(db, REFERRER, { now: NOW });
    const [reward] = (await grants()).filter((g) => g.kind === "referral");
    expect(reward.startsAt).toEqual(new Date(NOW.getTime() + 20 * DAY));
  });

  it("pays each rung once, however many times the sums run", async () => {
    await referred(3);
    await grantReferralRewards(db, REFERRER, { now: NOW });
    expect(await grantReferralRewards(db, REFERRER, { now: NOW })).toEqual([]);
    expect(await grants()).toHaveLength(2);
  });

  it("gives nothing before the first rung, and nothing to someone who owns no workspace", async () => {
    expect(await grantReferralRewards(db, REFERRER, { now: NOW })).toEqual([]);
    await db.insert(referrals).values({ referrerUserId: "user_nobody", referredUserId: "user_x", code: "abcdefgh" });
    expect(await grantReferralRewards(db, "user_nobody", { now: NOW })).toEqual([]);
  });

  it("does nothing while billing is off", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    await referred(1);
    expect(await grantReferralRewards(db, REFERRER, { now: NOW })).toEqual([]);
    expect(await grants()).toHaveLength(0);
  });
});

describe("a workspace that pays through Stripe", () => {
  beforeEach(async () => {
    await db.insert(billingSubscriptions).values({
      orgId: ORG,
      stripeCustomerId: "cus_ref",
      stripeSubscriptionId: "sub_ref",
      plan: "scale",
      interval: "month",
      status: "active",
    });
  });

  it("gets the months as a credit on its Stripe balance — Growth's monthly price per month — once", async () => {
    await referred(3);
    const { client, calls } = fakeStripe();
    const out = await grantReferralRewards(db, REFERRER, { now: NOW, client });
    expect(out.map((o) => o.form)).toEqual(["credit", "credit"]);
    expect(calls.map((c) => [c.customer, c.params.amount, c.params.currency])).toEqual([
      ["cus_ref", -4900, "usd"],
      ["cus_ref", -14700, "usd"],
    ]);
    // An idempotency key per workspace and rung, so a retry inside Stripe's window cannot pay twice.
    expect(new Set(calls.map((c) => c.key)).size).toBe(2);
    // Recorded, but granting no plan time of its own.
    expect(await grants()).toHaveLength(2);
    expect((await workspacePlan(db, ORG, NOW)).source).toBe("subscription");
    await grantReferralRewards(db, REFERRER, { now: NOW, client });
    expect(calls).toHaveLength(2);
  });

  it("records nothing when Stripe refuses, so the next run pays it — and says so in the audit log", async () => {
    await referred(1);
    const out = await grantReferralRewards(db, REFERRER, { now: NOW, client: fakeStripe({ fail: true }).client });
    expect(out).toEqual([expect.objectContaining({ rung: 1, form: "failed" })]);
    expect(await grants()).toHaveLength(0);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, "billing.referral_reward"));
    expect(audit[0]?.detail).toMatchObject({ rung: 1, form: "failed" });
    const { client, calls } = fakeStripe();
    await grantReferralRewards(db, REFERRER, { now: NOW, client });
    expect(calls).toHaveLength(1);
  });

  it("pays a rung once per PERSON — not again when the workspace it lands on changes", async () => {
    // Before the beforeEach subscription: the reward first lands on a free workspace…
    await db.delete(billingSubscriptions);
    await referred(1);
    expect((await grantReferralRewards(db, REFERRER, { now: NOW, client: fakeStripe().client }))[0]).toMatchObject({ rung: 1, form: "grant" });
    // …then the referrer's other workspace starts paying, and the target moves to it.
    await db.insert(workspaceOwners).values({ orgId: "org_paying_later", userId: REFERRER, source: "created" });
    await db.insert(billingSubscriptions).values({
      orgId: "org_paying_later",
      stripeCustomerId: "cus_later",
      stripeSubscriptionId: "sub_later",
      plan: "growth",
      interval: "month",
      status: "active",
    });
    const { client, calls } = fakeStripe();
    expect(await grantReferralRewards(db, REFERRER, { now: NOW, client })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("prefers the workspace that pays when its owner has two", async () => {
    await db.insert(workspaceOwners).values({ orgId: "org_older_free", userId: REFERRER, source: "created", claimedAt: new Date("2026-01-01") });
    await referred(1);
    const { client, calls } = fakeStripe();
    const [o] = await grantReferralRewards(db, REFERRER, { now: NOW, client });
    expect(o).toMatchObject({ orgId: ORG, form: "credit" });
    expect(calls).toHaveLength(1);
  });
});

describe("when a referral is recorded", () => {
  it("asks for the rewards to be worked out, off the sign-in's path", async () => {
    const code = referralCode(REFERRER);
    await db.insert(referralCodes).values({ code, userId: REFERRER });
    expect(await recordReferral({ rawCode: code, newUserId: "user_brand_new", createdAt: new Date() })).toBe(true);
    expect(hoisted.sent).toEqual([{ name: "billing/referral.recorded", data: { referrerUserId: REFERRER } }]);
  });

  it("the function is served — a function Inngest is never told about never runs", async () => {
    const { functions } = await import("@/inngest/functions");
    const { referralRewards } = await import("@/inngest/functions/billing");
    expect(functions).toContain(referralRewards);
  });

  it("the function runs the sums in a step", async () => {
    const { referralRewards } = await import("@/inngest/functions/billing");
    await referred(1);
    const ids: string[] = [];
    const step = {
      run: async (id: string, fn: () => unknown) => {
        ids.push(id);
        return fn();
      },
    };
    const fn = (referralRewards as unknown as { fn: (a: unknown) => Promise<unknown> }).fn;
    await fn({ event: { data: { referrerUserId: REFERRER } }, step });
    expect(ids).toEqual(["grant-rewards"]);
    expect(await grants()).toHaveLength(1);
  });
});
