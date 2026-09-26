import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { eq } from "drizzle-orm";
import { accessGrants, billingSubscriptions } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * TRIAL REMINDERS — seven days out, one day out, and the day it ends. Each is
 * checked against the workspace's state at the moment it would send, so nobody
 * who has already paid (or been given a plan) is told their trial is ending.
 */

let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

const { trialEmail, sendBillingEmail, reminderDue } = await import("@/lib/billing/emails");
const { startTrial, grantPlan } = await import("@/lib/billing/state");
const { trialReminders } = await import("@/inngest/functions/billing");

const ORG = "org_mail";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await close();
});

describe("the copy", () => {
  const input = { planName: "Growth", endsAt: new Date("2026-10-25T12:00:00Z"), billingUrl: "https://namzilabs.co/dashboard/settings/billing" };

  it("says what happens and when, and links to the plan page", () => {
    for (const kind of ["7d", "1d", "ended"] as const) {
      const m = trialEmail(kind, input);
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.text).toContain("Growth");
      expect(m.text).toContain(input.billingUrl);
      expect(m.html).toContain(input.billingUrl);
    }
    expect(trialEmail("7d", input).text).toMatch(/7 days/);
    expect(trialEmail("1d", input).text).toMatch(/tomorrow/i);
    expect(trialEmail("ended", input).text).toMatch(/Free plan/);
  });

  it("promises that nothing is deleted", () => {
    expect(trialEmail("ended", input).text).toMatch(/nothing (has been|is) deleted/i);
  });
});

describe("whether a reminder is still due", () => {
  it("is due while they are still on the trial", async () => {
    const t = await startTrial(db, { orgId: ORG, userId: "u", plan: "growth" });
    expect(t.ok).toBe(true);
    expect(await reminderDue(db, ORG, "7d")).toBe(true);
  });

  it("is not due once they pay", async () => {
    await startTrial(db, { orgId: ORG, userId: "u", plan: "growth" });
    await db.insert(billingSubscriptions).values({ orgId: ORG, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", plan: "growth", interval: "month", status: "trialing" });
    expect(await reminderDue(db, ORG, "1d")).toBe(false);
    expect(await reminderDue(db, ORG, "ended")).toBe(false);
  });

  it("sends the ended note only to a workspace now on Free", async () => {
    // A trial that began 31 days ago has run out.
    await startTrial(db, { orgId: ORG, userId: "u", plan: "growth", now: new Date(Date.now() - 31 * 86_400_000) });
    expect(await reminderDue(db, ORG, "ended")).toBe(true);
    await grantPlan(db, { orgId: ORG, plan: "scale", kind: "code", endsAt: null, grantedBy: null });
    expect(await reminderDue(db, ORG, "ended")).toBe(false);
  });

  it("says nothing to a workspace that was deleted before its trial ran out", async () => {
    await startTrial(db, { orgId: ORG, userId: "u", plan: "growth", now: new Date(Date.now() - 31 * 86_400_000) });
    // Deleting a workspace sweeps its grants (see destroyWorkspaceData).
    await db.delete(accessGrants).where(eq(accessGrants.orgId, ORG));
    expect(await reminderDue(db, ORG, "ended")).toBe(false);
  });
});

describe("sending", () => {
  it("does nothing until Resend and a sender are configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendBillingEmail("o@x.co", { subject: "s", text: "t", html: "h" })).toEqual({ sent: false });
  });

  it("sends through Resend from the billing address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("BILLING_EMAIL_FROM", "Namzilabs <billing@namzilabs.co>");
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: "e_1" }), { status: 200 });
    });
    expect(await sendBillingEmail("o@x.co", { subject: "Your trial", text: "t", html: "<p>t</p>" })).toEqual({ sent: true });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].body).toMatchObject({ from: "Namzilabs <billing@namzilabs.co>", to: ["o@x.co"], subject: "Your trial" });
  });
});

describe("the reminder function", () => {
  it("sleeps until each moment, then checks before it sends", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const t = await startTrial(db, { orgId: ORG, userId: "u", plan: "growth" });
    if (!t.ok) throw new Error("trial did not start");
    const ids: string[] = [];
    const step = {
      sleepUntil: async (id: string) => void ids.push(id),
      run: async (id: string, fn: () => unknown) => {
        ids.push(id);
        return fn();
      },
    };
    const fn = (trialReminders as unknown as { fn: (a: unknown) => Promise<unknown> }).fn;
    await fn({ event: { data: { orgId: ORG, email: "o@x.co", plan: "growth", endsAt: t.endsAt.toISOString() } }, step });
    expect(ids).toEqual(["wait-7d", "remind-7d", "wait-1d", "remind-1d", "wait-ended", "remind-ended"]);
  });
});
