import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { accessGrants, promoCodes, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * THE ACTS BEHIND THE PLAN PICKER — choosing Free, starting a trial, paying,
 * redeeming a code — and the two doors a code comes in by: a `/p/CODE` link,
 * and the workspace a signed-out visitor goes on to create.
 */

const hoisted = vi.hoisted(() => ({
  redirect: { url: "" as string },
  jar: new Map<string, string>(),
  sent: [] as Array<{ name: string; data: unknown }>,
  checkout: [] as Array<Record<string, unknown>>,
  org: null as null | { orgId: string; userId: string },
}));

let db: DB;
let close: () => Promise<void>;
const ctx = {
  orgId: "org_bill",
  userId: "user_owner",
  role: "admin" as string | undefined,
  auth: { user: { id: "user_owner", email: "owner@example.com", firstName: "O", lastName: "W" } },
};

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx, getOrgContext: async () => hoisted.org }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    hoisted.redirect.url = url;
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (hoisted.jar.has(k) ? { value: hoisted.jar.get(k) } : undefined),
    set: (k: string, v: string) => void hoisted.jar.set(k, v),
    delete: (k: string) => void hoisted.jar.delete(k),
  }),
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: async (e: { name: string; data: unknown }) => void hoisted.sent.push(e) },
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ organizations: { getOrganization: async () => ({ name: "Coach Co" }) } }),
}));
vi.mock("@/lib/billing/stripe", () => ({
  createCheckout: async (_db: unknown, input: Record<string, unknown>) => {
    hoisted.checkout.push(input);
    return "https://checkout.stripe.test/cs_1";
  },
  createPortal: async () => "https://billing.stripe.test/p_1",
}));

const actions = await import("@/app/billing-actions");
const { afterWorkspaceCreated, CODE_COOKIE } = await import("@/lib/billing/onboard");
const { GET: codeLink } = await import("@/app/p/[code]/route");

async function run(p: Promise<unknown>): Promise<string> {
  hoisted.redirect.url = "";
  try {
    await p;
  } catch (e) {
    if (!(e instanceof Error && e.message === "NEXT_REDIRECT")) throw e;
  }
  return hoisted.redirect.url;
}
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
  hoisted.jar.clear();
  hoisted.sent.length = 0;
  hoisted.checkout.length = 0;
  hoisted.org = null;
  await db.insert(workspaceOwners).values({ orgId: ctx.orgId, userId: ctx.userId, source: "created" });
  await db.insert(promoCodes).values({ code: "STUDENTS30", plan: "growth", months: 3, createdBy: "staff" });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("choosePlanAction", () => {
  it("goes straight on for Free, and grants nothing", async () => {
    expect(await run(actions.choosePlanAction(form({ plan: "free", next: "/dashboard?view=abc" })))).toBe("/dashboard?view=abc");
    expect(await db.select().from(accessGrants)).toHaveLength(0);
  });

  it("starts a 30-day trial with no card, and schedules its reminders", async () => {
    expect(await run(actions.choosePlanAction(form({ plan: "growth", next: "/dashboard" })))).toBe("/dashboard?welcome=trial");
    const [g] = await db.select().from(accessGrants);
    expect(g).toMatchObject({ orgId: ctx.orgId, plan: "growth", kind: "trial" });
    expect(hoisted.sent).toEqual([{ name: "billing/trial.started", data: expect.objectContaining({ orgId: ctx.orgId, plan: "growth" }) }]);
  });

  it("sends someone who has had their trial to pay instead", async () => {
    await run(actions.choosePlanAction(form({ plan: "growth" })));
    ctx.orgId = "org_second";
    try {
      expect(await run(actions.choosePlanAction(form({ plan: "scale", interval: "year" })))).toBe("https://checkout.stripe.test/cs_1");
      expect(hoisted.checkout[0]).toMatchObject({ orgId: "org_second", plan: "scale", interval: "year", email: "owner@example.com" });
    } finally {
      ctx.orgId = "org_bill";
    }
  });

  it("refuses an address outside the app as the place to go next", async () => {
    expect(await run(actions.choosePlanAction(form({ plan: "free", next: "https://evil.example" })))).toBe("/dashboard");
    expect(await run(actions.choosePlanAction(form({ plan: "free", next: "//evil.example" })))).toBe("/dashboard");
  });

  it("does nothing but go to the dashboard while billing is off", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    expect(await run(actions.choosePlanAction(form({ plan: "growth" })))).toBe("/dashboard");
    expect(await db.select().from(accessGrants)).toHaveLength(0);
  });
});

describe("paying and managing", () => {
  it("opens Checkout for the chosen plan and interval", async () => {
    expect(await run(actions.startCheckoutAction(form({ plan: "growth", interval: "month" })))).toBe("https://checkout.stripe.test/cs_1");
  });

  it("opens the billing portal", async () => {
    expect(await run(actions.openPortalAction())).toBe("https://billing.stripe.test/p_1");
  });
});

describe("redeemCodeAction", () => {
  it("grants the code's plan and says so", async () => {
    expect(await run(actions.redeemCodeAction(form({ code: "students30" })))).toBe("/dashboard/settings/billing?code=ok");
    expect(await db.select().from(accessGrants)).toHaveLength(1);
  });

  it("says why a code did not work", async () => {
    expect(await run(actions.redeemCodeAction(form({ code: "NOPE" })))).toBe("/dashboard/settings/billing?code_error=unknown");
  });
});

describe("a code by link", () => {
  const visit = (code: string) => codeLink(new Request(`https://namzilabs.co/p/${code}`), { params: Promise.resolve({ code }) });

  it("keeps the code for a signed-out visitor and sends them to sign up", async () => {
    const res = await visit("students30");
    expect(res.headers.get("location")).toBe("https://namzilabs.co/signup");
    expect(res.headers.get("set-cookie")).toContain(`${CODE_COOKIE}=STUDENTS30`);
  });

  it("redeems at once for someone already in a workspace", async () => {
    hoisted.org = { orgId: ctx.orgId, userId: ctx.userId };
    const res = await visit("STUDENTS30");
    expect(res.headers.get("location")).toBe("https://namzilabs.co/dashboard/settings/billing?code=ok");
    expect(await db.select().from(accessGrants)).toHaveLength(1);
  });

  it("sends a malformed code home", async () => {
    expect((await visit("b@d")).headers.get("location")).toBe("https://namzilabs.co/");
  });
});

describe("afterWorkspaceCreated", () => {
  const jar = {
    get: (k: string) => (hoisted.jar.has(k) ? { value: hoisted.jar.get(k)! } : undefined),
    delete: (k: string) => void hoisted.jar.delete(k),
  };

  it("redeems the code a visitor brought, and skips the plan step they no longer need", async () => {
    hoisted.jar.set(CODE_COOKIE, "STUDENTS30");
    expect(await afterWorkspaceCreated(db, { orgId: "org_new", landing: "/dashboard", jar })).toBe("/dashboard?welcome=code");
    expect(hoisted.jar.has(CODE_COOKIE)).toBe(false);
    expect(await db.select().from(accessGrants)).toHaveLength(1);
  });

  it("sends everyone else through the plan step, keeping where they were going", async () => {
    expect(await afterWorkspaceCreated(db, { orgId: "org_new", landing: "/dashboard?view=v1", jar })).toBe(
      "/onboarding/plan?next=%2Fdashboard%3Fview%3Dv1",
    );
  });

  it("changes nothing while billing is off", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    expect(await afterWorkspaceCreated(db, { orgId: "org_new", landing: "/dashboard", jar })).toBe("/dashboard");
  });

  it("never fails a sign-up — a redemption that throws is swallowed", async () => {
    hoisted.jar.set(CODE_COOKIE, "STUDENTS30");
    const broken = { select: () => { throw new Error("relation does not exist"); } } as unknown as DB;
    await expect(afterWorkspaceCreated(broken, { orgId: "org_new", landing: "/dashboard", jar })).resolves.toMatch(/^\/onboarding\/plan|^\/dashboard/);
  });
});
