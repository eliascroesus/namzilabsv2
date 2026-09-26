import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { accessGrants, auditLog, billingSubscriptions, connections, planPauses, promoCodes, referrals, trackingLinks, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * THE OWNER'S BACK OFFICE — the acts behind /admin.
 *
 * Every one is staff-only (the check is the action's FIRST statement, so no
 * write can happen before it), and every one leaves an audit row whose detail
 * is enum-shaped: which plan, how many months, which source — never the note
 * somebody typed.
 */

const hoisted = vi.hoisted(() => ({ redirect: "", denied: false }));
let db: DB;
let close: () => Promise<void>;

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    hoisted.redirect = url;
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/admin/access", () => ({
  requireStaff: async () => {
    if (hoisted.denied) throw new Error("NEXT_NOT_FOUND");
    return { userId: "staff_1", email: "owner@namzilabs.co" };
  },
}));
vi.mock("@/inngest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/inngest/client")>()),
  inngest: { send: async () => {}, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) },
}));

const actions = await import("@/app/admin/actions");
const { workspacePlan } = await import("@/lib/billing/state");

async function run(p: Promise<unknown>): Promise<string> {
  hoisted.redirect = "";
  try {
    await p;
  } catch (e) {
    if (!(e instanceof Error && (e.message === "NEXT_REDIRECT" || e.message === "NEXT_NOT_FOUND"))) throw e;
    if (e.message === "NEXT_NOT_FOUND") return "404";
  }
  return hoisted.redirect;
}
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action as never));

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  hoisted.denied = false;
  vi.stubEnv("BILLING_ENABLED", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("the gate", () => {
  /** Names of every exported async function whose first statement is not a `requireStaff()` call. */
  function ungated(source: string): string[] {
    const sf = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: string[] = [];
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st) || !st.name || !st.body) continue;
      if (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const first = st.body.statements[0]?.getText(sf) ?? "";
      if (!/^(const \w+ = )?await requireStaff\(\);$/.test(first)) out.push(st.name.text);
    }
    return out;
  }

  it("the scan can fail", () => {
    const planted = `export async function ok() { const s = await requireStaff(); }\nexport async function leaky(fd: FormData) { await db.insert(x); await requireStaff(); }`;
    expect(ungated(planted)).toEqual(["leaky"]);
  });

  it("every admin action checks staff before it does anything else", () => {
    const src = readFileSync("src/app/admin/actions.ts", "utf8");
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThanOrEqual(7);
    expect(ungated(src)).toEqual([]);
  });

  it("writes nothing for someone who is not staff", async () => {
    hoisted.denied = true;
    expect(await run(actions.grantPlanAction(form({ orgId: "org_x", plan: "scale", duration: "lifetime" })))).toBe("404");
    expect(await db.select().from(accessGrants)).toHaveLength(0);
  });
});

/** Enum-shaped: numbers, booleans, nulls, and short lower-case identifiers — never prose. */
function expectEnumOnly(detail: unknown) {
  for (const [k, v] of Object.entries((detail ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string") expect(v, `detail.${k}`).toMatch(/^[a-z0-9_.:-]{1,40}$/);
    else expect(["number", "boolean"].includes(typeof v) || v === null, `detail.${k}`).toBe(true);
  }
}

describe("granting and revoking a plan", () => {
  it("grants for months, for life, or until a date — and records who and how, not the note", async () => {
    expect(await run(actions.grantPlanAction(form({ orgId: "org_a", plan: "growth", duration: "3", note: "Podcast guest, thank-you" })))).toBe(
      "/admin/workspaces/org_a?done=grant",
    );
    await run(actions.grantPlanAction(form({ orgId: "org_b", plan: "scale", duration: "lifetime" })));
    await run(actions.grantPlanAction(form({ orgId: "org_c", plan: "growth", duration: "until", until: "2027-01-31" })));
    const rows = await db.select().from(accessGrants);
    expect(rows.find((r) => r.orgId === "org_a")).toMatchObject({ plan: "growth", kind: "manual", grantedBy: "staff_1", note: "Podcast guest, thank-you" });
    expect(rows.find((r) => r.orgId === "org_b")?.endsAt).toBeNull();
    expect(rows.find((r) => r.orgId === "org_c")?.endsAt?.toISOString().slice(0, 10)).toBe("2027-01-31");
    const a = await audits("admin.grant");
    expect(a).toHaveLength(3);
    for (const row of a) {
      expect(row.actorId).toBe("staff_1");
      expectEnumOnly(row.detail);
      expect(JSON.stringify(row.detail)).not.toContain("Podcast");
    }
  });

  it("refuses a plan, a duration or a date that is not one", async () => {
    expect(await run(actions.grantPlanAction(form({ orgId: "org_a", plan: "platinum", duration: "3" })))).toMatch(/error=/);
    expect(await run(actions.grantPlanAction(form({ orgId: "org_a", plan: "growth", duration: "999" })))).toMatch(/error=/);
    expect(await run(actions.grantPlanAction(form({ orgId: "org_a", plan: "growth", duration: "until", until: "2001-01-01" })))).toMatch(/error=/);
    expect(await db.select().from(accessGrants)).toHaveLength(0);
  });

  it("revokes a grant and the workspace drops back", async () => {
    await run(actions.grantPlanAction(form({ orgId: "org_a", plan: "scale", duration: "lifetime" })));
    const [g] = await db.select().from(accessGrants);
    expect((await workspacePlan(db, "org_a")).plan).toBe("scale");
    expect(await run(actions.revokeGrantAction(form({ orgId: "org_a", grantId: g.id })))).toBe("/admin/workspaces/org_a?done=revoke");
    expect((await workspacePlan(db, "org_a")).plan).toBe("free");
    const [a] = await audits("admin.revoke");
    expect(a).toMatchObject({ orgId: "org_a", actorId: "staff_1" });
    expectEnumOnly(a.detail);
  });
});

describe("access codes", () => {
  it("creates a code, and refuses a duplicate or a malformed one", async () => {
    expect(await run(actions.createCodeAction(form({ code: "students30", plan: "growth", duration: "3", maxRedemptions: "50", redeemBy: "2030-01-01" })))).toBe(
      "/admin/codes?done=create&code=STUDENTS30",
    );
    const [c] = await db.select().from(promoCodes);
    expect(c).toMatchObject({ code: "STUDENTS30", plan: "growth", months: 3, maxRedemptions: 50, createdBy: "staff_1" });
    expect(await run(actions.createCodeAction(form({ code: "STUDENTS30", plan: "growth", duration: "3" })))).toMatch(/error=/);
    expect(await run(actions.createCodeAction(form({ code: "a b", plan: "growth", duration: "3" })))).toMatch(/error=/);
    await run(actions.createCodeAction(form({ code: "VIP-FOREVER", plan: "scale", duration: "lifetime" })));
    expect((await db.select().from(promoCodes).where(eq(promoCodes.code, "VIP-FOREVER")))[0].months).toBeNull();
    for (const row of await audits("admin.code_create")) expectEnumOnly(row.detail);
  });

  it("switches a code off and on again", async () => {
    await run(actions.createCodeAction(form({ code: "LAUNCH", plan: "growth", duration: "1" })));
    const [c] = await db.select().from(promoCodes);
    await run(actions.toggleCodeAction(form({ codeId: c.id, disable: "1" })));
    expect((await db.select().from(promoCodes))[0].disabledAt).not.toBeNull();
    await run(actions.toggleCodeAction(form({ codeId: c.id, disable: "0" })));
    expect((await db.select().from(promoCodes))[0].disabledAt).toBeNull();
    expect(await audits("admin.code_toggle")).toHaveLength(2);
  });
});

describe("tracking links", () => {
  it("creates and archives a link", async () => {
    expect(
      await run(actions.createLinkAction(form({ label: "IG bio", slug: "ig-bio", source: "instagram", medium: "social", campaign: "", destination: "/" }))),
    ).toBe("/admin/links?done=create&slug=ig-bio");
    const [l] = await db.select().from(trackingLinks);
    expect(l).toMatchObject({ slug: "ig-bio", createdBy: "staff_1" });
    expect(await run(actions.createLinkAction(form({ label: "x", slug: "ig-bio", source: "instagram", medium: "social", destination: "/" })))).toMatch(/error=/);
    await run(actions.archiveLinkAction(form({ linkId: l.id })));
    expect((await db.select().from(trackingLinks))[0].archivedAt).not.toBeNull();
    for (const row of [...(await audits("admin.link_create")), ...(await audits("admin.link_archive"))]) expectEnumOnly(row.detail);
  });
});

describe("launch trials", () => {
  beforeEach(async () => {
    await db.insert(workspaceOwners).values([
      { orgId: "org_free", userId: "u1", source: "created" },
      { orgId: "org_paid", userId: "u2", source: "created" },
      { orgId: "org_referrer", userId: "u3", source: "created" },
    ]);
    await db.insert(accessGrants).values({ orgId: "org_paid", plan: "scale", kind: "manual", endsAt: null });
  });

  it("gives every workspace without a plan 30 days of Growth, once, and pays referral rewards earned before launch", async () => {
    await db.insert(referrals).values({ referrerUserId: "u3", referredUserId: "u_new", code: "abcdefgh" });
    expect(await run(actions.startLaunchTrialsAction())).toBe("/admin?launched=2&rewarded=1");
    const launch = await db.select().from(accessGrants).where(eq(accessGrants.kind, "launch"));
    expect(launch.map((g) => g.orgId).sort()).toEqual(["org_free", "org_referrer"]);
    const days = (launch[0].endsAt!.getTime() - launch[0].startsAt.getTime()) / 86_400_000;
    expect(days).toBe(30);
    expect(await db.select().from(accessGrants).where(eq(accessGrants.kind, "referral"))).toHaveLength(1);

    // Pressing it again changes nothing.
    expect(await run(actions.startLaunchTrialsAction())).toBe("/admin?launched=0&rewarded=0");
    expect(await db.select().from(accessGrants).where(eq(accessGrants.kind, "launch"))).toHaveLength(2);
    const [a] = await audits("admin.launch_trials");
    expectEnumOnly(a.detail);
  });

  it("runs BEFORE billing is switched on, so no workspace is on Free at the moment it comes on", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    await db.insert(referrals).values({ referrerUserId: "u3", referredUserId: "u_new", code: "abcdefgh" });
    expect(await run(actions.startLaunchTrialsAction())).toBe("/admin?launched=2&rewarded=1");
    // Switched on: both workspaces are already on Growth, and the reward is already paid.
    vi.stubEnv("BILLING_ENABLED", "1");
    expect((await workspacePlan(db, "org_free")).plan).toBe("growth");
    expect(await run(actions.startLaunchTrialsAction())).toBe("/admin?launched=0&rewarded=0");
  });
});

describe("switching billing off", () => {
  async function planPausedApp(orgId: string) {
    const { PLAN_PAUSE_UNTIL } = await import("@/lib/billing/pauses");
    const [c] = await db
      .insert(connections)
      .values({ orgId, source: "webhook", name: "Paused", status: "active", authType: "secret", pausedUntil: PLAN_PAUSE_UNTIL, pausedReason: "Paused on the Free plan — upgrade to resume syncing." })
      .returning({ id: connections.id });
    await db.insert(planPauses).values({ connectionId: c.id, orgId });
    return c.id;
  }

  it("lifts every app a plan paused — their pause would otherwise never fall due", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    const a = await planPausedApp("org_x");
    const b = await planPausedApp("org_y");
    expect(await run(actions.resumePlanPausesAction())).toBe("/admin?resumed=2");
    const rows = await db.select({ id: connections.id, pausedUntil: connections.pausedUntil }).from(connections);
    for (const id of [a, b]) expect(rows.find((r) => r.id === id)?.pausedUntil).toBeNull();
    expect(await db.select().from(planPauses)).toHaveLength(0);
    const [audit] = await audits("admin.resume_pauses");
    expectEnumOnly(audit.detail);
  });

  it("is refused while billing is on, where each workspace's plan decides what stays paused", async () => {
    await planPausedApp("org_x");
    expect(await run(actions.resumePlanPausesAction())).toBe("/admin?error=billing_on");
    expect(await db.select().from(planPauses)).toHaveLength(1);
  });
});

describe("the overview's money", () => {
  it("adds up MRR at list price — a yearly plan is a twelfth a month — and counts each trial once", async () => {
    const { billingOverview } = await import("@/lib/admin/billing");
    const sub = (orgId: string, plan: string, interval: string, status: string) =>
      db.insert(billingSubscriptions).values({ orgId, stripeCustomerId: `cus_${orgId}`, stripeSubscriptionId: `sub_${orgId}`, plan, interval, status });
    await sub("o1", "growth", "month", "active");
    await sub("o2", "scale", "year", "active");
    await sub("o3", "growth", "month", "past_due");
    await sub("o4", "growth", "month", "canceled");
    await sub("o5", "growth", "month", "trialing");
    // o5 took the in-app trial and then added a card: one trial, not two.
    await db.insert(accessGrants).values({ orgId: "o5", plan: "growth", kind: "trial", endsAt: new Date(Date.now() + 10 * 86_400_000) });
    await db.insert(accessGrants).values({ orgId: "o6", plan: "growth", kind: "launch", endsAt: new Date(Date.now() + 20 * 86_400_000) });
    const o = await billingOverview();
    expect(o.paying).toBe(3);
    expect(o.mrr).toBe(49 + 119 + 49);
    expect(o.trialsActive).toBe(2);
    expect(o.launchStartedAt).not.toBeNull();
  });
});
