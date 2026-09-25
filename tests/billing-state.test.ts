import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { accessGrants, billingSubscriptions, promoCodes } from "@/db/schema";
import type { DB } from "@/db/types";
import {
  addMonths,
  billingEnabled,
  grantPlan,
  hasTrialed,
  listGrants,
  normaliseCode,
  redeemCode,
  revokeGrant,
  startTrial,
  workspacePlan,
} from "@/lib/billing/state";

/**
 * THE DATABASE SIDE OF PLANS — what a workspace holds, and the three ways it
 * gets something without paying: a trial (once per PERSON), an access code
 * (once per workspace per code, capped, expiring), and a grant the owner makes.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

async function code(over: Partial<typeof promoCodes.$inferInsert> = {}) {
  const [row] = await db
    .insert(promoCodes)
    .values({ code: "STUDENTS30", plan: "growth", months: 3, createdBy: "staff_1", ...over })
    .returning();
  return row;
}

describe("the launch switch", () => {
  it("is off unless BILLING_ENABLED says otherwise", () => {
    vi.stubEnv("BILLING_ENABLED", "");
    expect(billingEnabled()).toBe(false);
    vi.stubEnv("BILLING_ENABLED", "0");
    expect(billingEnabled()).toBe(false);
    vi.stubEnv("BILLING_ENABLED", "1");
    expect(billingEnabled()).toBe(true);
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(billingEnabled()).toBe(true);
  });
});

describe("workspacePlan", () => {
  it("is Free with nothing on record", async () => {
    expect((await workspacePlan(db, "org_a", NOW)).plan).toBe("free");
  });

  it("follows the mirrored Stripe subscription", async () => {
    await db.insert(billingSubscriptions).values({
      orgId: "org_a",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      plan: "scale",
      interval: "month",
      status: "active",
    });
    expect(await workspacePlan(db, "org_a", NOW)).toMatchObject({ plan: "scale", source: "subscription" });
  });

  it("ignores a customer row that has no subscription yet", async () => {
    await db.insert(billingSubscriptions).values({ orgId: "org_a", stripeCustomerId: "cus_1" });
    expect((await workspacePlan(db, "org_a", NOW)).plan).toBe("free");
  });

  it("follows a grant, and forgets it once revoked", async () => {
    const id = await grantPlan(db, { orgId: "org_a", plan: "growth", kind: "manual", endsAt: null, grantedBy: "staff_1", now: NOW });
    expect(await workspacePlan(db, "org_a", NOW)).toMatchObject({ plan: "growth", lifetime: true });
    expect(await revokeGrant(db, { grantId: id!, by: "staff_1", now: NOW })).toBe(true);
    expect((await workspacePlan(db, "org_a", NOW)).plan).toBe("free");
    // Revoking twice changes nothing and says so.
    expect(await revokeGrant(db, { grantId: id!, by: "staff_1", now: NOW })).toBe(false);
  });

  it("keeps grants to their own workspace", async () => {
    await grantPlan(db, { orgId: "org_a", plan: "scale", kind: "manual", endsAt: null, grantedBy: "staff_1", now: NOW });
    expect((await workspacePlan(db, "org_b", NOW)).plan).toBe("free");
  });
});

describe("grantPlan", () => {
  it("gives each workspace one launch trial, ever", async () => {
    const ends = addMonths(NOW, 1);
    expect(await grantPlan(db, { orgId: "org_a", plan: "growth", kind: "launch", endsAt: ends, grantedBy: null, now: NOW })).not.toBeNull();
    expect(await grantPlan(db, { orgId: "org_a", plan: "growth", kind: "launch", endsAt: ends, grantedBy: null, now: NOW })).toBeNull();
    expect(await listGrants(db, "org_a")).toHaveLength(1);
  });
});

describe("startTrial", () => {
  it("gives 30 days of the chosen plan with no card", async () => {
    const r = await startTrial(db, { orgId: "org_a", userId: "user_1", plan: "scale", now: NOW });
    expect(r).toEqual({ ok: true, endsAt: new Date(NOW.getTime() + 30 * 86_400_000) });
    expect(await workspacePlan(db, "org_a", NOW)).toMatchObject({ plan: "scale", source: "trial", state: "trialing" });
  });

  it("gives each PERSON one trial — a second workspace does not get another", async () => {
    await startTrial(db, { orgId: "org_a", userId: "user_1", plan: "growth", now: NOW });
    expect(await startTrial(db, { orgId: "org_b", userId: "user_1", plan: "growth", now: NOW })).toEqual({
      ok: false,
      reason: "already_trialed",
    });
    expect((await workspacePlan(db, "org_b", NOW)).plan).toBe("free");
  });

  it("knows who has had their trial, so the picker offers them a price instead", async () => {
    expect(await hasTrialed(db, "user_1")).toBe(false);
    await startTrial(db, { orgId: "org_a", userId: "user_1", plan: "growth", now: NOW });
    expect(await hasTrialed(db, "user_1")).toBe(true);
    expect(await hasTrialed(db, "user_2")).toBe(false);
  });

  it("does not start a trial on a workspace that already has a paid plan", async () => {
    await grantPlan(db, { orgId: "org_a", plan: "growth", kind: "manual", endsAt: null, grantedBy: "staff_1", now: NOW });
    expect(await startTrial(db, { orgId: "org_a", userId: "user_1", plan: "scale", now: NOW })).toEqual({ ok: false, reason: "has_plan" });
    // …and the person keeps their trial for a workspace that needs it.
    expect((await startTrial(db, { orgId: "org_b", userId: "user_1", plan: "scale", now: NOW })).ok).toBe(true);
  });
});

describe("redeemCode", () => {
  it("grants the code's plan for its months, counted from redemption", async () => {
    await code();
    const r = await redeemCode(db, { orgId: "org_a", code: "  students30 ", now: NOW });
    expect(r).toEqual({ ok: true, plan: "growth", endsAt: new Date("2027-01-01T12:00:00Z") });
    expect(await workspacePlan(db, "org_a", NOW)).toMatchObject({ plan: "growth", source: "code" });
  });

  it("grants for life when the code has no months", async () => {
    await code({ code: "FOREVER", months: null, plan: "scale" });
    expect(await redeemCode(db, { orgId: "org_a", code: "forever", now: NOW })).toEqual({ ok: true, plan: "scale", endsAt: null });
  });

  it("refuses an unknown, disabled or expired code", async () => {
    await code({ code: "OFF", disabledAt: new Date("2026-09-01") });
    await code({ code: "OLD", redeemBy: new Date("2026-09-30") });
    expect(await redeemCode(db, { orgId: "org_a", code: "NOPE", now: NOW })).toEqual({ ok: false, reason: "unknown" });
    expect(await redeemCode(db, { orgId: "org_a", code: "OFF", now: NOW })).toEqual({ ok: false, reason: "disabled" });
    expect(await redeemCode(db, { orgId: "org_a", code: "OLD", now: NOW })).toEqual({ ok: false, reason: "expired" });
    expect(await redeemCode(db, { orgId: "org_a", code: "b@d code!", now: NOW })).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses a second redemption by the same workspace", async () => {
    await code();
    await redeemCode(db, { orgId: "org_a", code: "STUDENTS30", now: NOW });
    expect(await redeemCode(db, { orgId: "org_a", code: "STUDENTS30", now: NOW })).toEqual({ ok: false, reason: "already_redeemed" });
  });

  it("stops at its redemption cap", async () => {
    await code({ maxRedemptions: 1 });
    expect((await redeemCode(db, { orgId: "org_a", code: "STUDENTS30", now: NOW })).ok).toBe(true);
    expect(await redeemCode(db, { orgId: "org_b", code: "STUDENTS30", now: NOW })).toEqual({ ok: false, reason: "used_up" });
    expect(await db.select().from(accessGrants)).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("normalise a code to upper case, and reject anything else", () => {
    expect(normaliseCode(" students-30 ")).toBe("STUDENTS-30");
    expect(normaliseCode("ab")).toBeNull();
    expect(normaliseCode("x".repeat(33))).toBeNull();
    expect(normaliseCode("no spaces")).toBeNull();
    expect(normaliseCode(null)).toBeNull();
  });

  it("add calendar months without spilling into the next month", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2026-10-01T12:00:00Z"), 12).toISOString()).toBe("2027-10-01T12:00:00.000Z");
  });
});
