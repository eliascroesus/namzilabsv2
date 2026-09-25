import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { flowResults, flows } from "@/db/schema";
import type { DB } from "@/db/types";
import { grantPlan } from "@/lib/billing/state";
import { countApps, countMetrics } from "@/lib/billing/usage";
import { PlanLimitError, assertCanAddApp, assertCanInvite, assertCanPublish, assertFeature, upgradeHref } from "@/lib/billing/limits";
import { connectionCap, flowCap } from "@/lib/limits";

/**
 * EVERY LIMIT IS A SERVER CHECK AT THE MOMENT OF CREATION — and none of them
 * exists while billing is off. An existing workspace far over the Free limits
 * must keep working exactly as before until the owner launches.
 */

let db: DB;
let close: () => Promise<void>;
const ORG = "org_lim";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

async function apps(n: number, status = "active") {
  for (let i = 0; i < n; i++) await seedConnection(db, { orgId: ORG, status });
}

/** A flow with `metrics` result rows; `published` decides whether they count. */
async function flowWith(metrics: number, published = true): Promise<string> {
  const [f] = await db
    .insert(flows)
    .values({
      orgId: ORG,
      name: `f${Math.random()}`,
      draftGraph: { nodes: [], edges: [], metrics: [] },
      status: published ? "published" : "draft",
      publishedVersion: published ? 1 : null,
    })
    .returning({ id: flows.id });
  for (let i = 0; i < metrics; i++) {
    await db.insert(flowResults).values({ orgId: ORG, flowId: f.id, version: 1, outputNodeId: `o${i}`, tile: { value: i }, status: "fresh" });
  }
  return f.id;
}

async function thrown(p: Promise<unknown>): Promise<PlanLimitError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof PlanLimitError) return e;
    throw e;
  }
}

describe("usage", () => {
  it("counts apps that are not disabled", async () => {
    await apps(2);
    await apps(1, "disabled");
    await apps(1, "error");
    expect(await countApps(db, ORG)).toBe(3);
  });

  it("counts metrics the board shows — published flows only", async () => {
    await flowWith(2);
    await flowWith(3, false);
    expect(await countMetrics(db, ORG)).toBe(2);
  });
});

describe("apps", () => {
  it("allows the Free plan's third app and refuses a fourth", async () => {
    await apps(2);
    await expect(assertCanAddApp(db, ORG)).resolves.toBeUndefined();
    await apps(1);
    const e = await thrown(assertCanAddApp(db, ORG));
    expect(e).toMatchObject({ kind: "apps", plan: "free", limit: 3 });
    expect(e?.message).toMatch(/3 apps/);
  });

  it("follows the plan the workspace holds", async () => {
    await apps(3);
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    await expect(assertCanAddApp(db, ORG)).resolves.toBeUndefined();
  });
});

describe("metrics", () => {
  it("allows publishing up to five on Free and refuses the sixth", async () => {
    await flowWith(4);
    await expect(assertCanPublish(db, ORG, "new-flow", 1)).resolves.toBeUndefined();
    expect(await thrown(assertCanPublish(db, ORG, "new-flow", 2))).toMatchObject({ kind: "metrics", limit: 5 });
  });

  it("counts a republished flow's metrics once, not twice", async () => {
    const id = await flowWith(2);
    await flowWith(3);
    await expect(assertCanPublish(db, ORG, id, 2)).resolves.toBeUndefined();
  });
});

describe("members", () => {
  it("counts the owner, so Free has no seat for anyone else", async () => {
    expect(await thrown(assertCanInvite(db, ORG, async () => 1))).toMatchObject({ kind: "members", limit: 1 });
  });

  it("lets Growth grow to five", async () => {
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    await expect(assertCanInvite(db, ORG, async () => 4)).resolves.toBeUndefined();
    expect(await thrown(assertCanInvite(db, ORG, async () => 5))).toMatchObject({ kind: "members", plan: "growth", limit: 5 });
  });
});

describe("features", () => {
  it("keeps the AI assistant for Scale and templates for any paid plan", async () => {
    expect(await thrown(assertFeature(db, ORG, "aiAssistant"))).toMatchObject({ kind: "feature", feature: "aiAssistant" });
    expect(await thrown(assertFeature(db, ORG, "shareTemplates"))).toMatchObject({ kind: "feature", feature: "shareTemplates" });
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    await expect(assertFeature(db, ORG, "shareTemplates")).resolves.toBeUndefined();
    expect(await thrown(assertFeature(db, ORG, "aiAssistant"))).not.toBeNull();
  });
});

describe("with billing off", () => {
  it("never refuses anything, however far over the Free limits", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    await apps(12);
    await flowWith(40);
    await expect(assertCanAddApp(db, ORG)).resolves.toBeUndefined();
    await expect(assertCanPublish(db, ORG, "x", 10)).resolves.toBeUndefined();
    await expect(assertCanInvite(db, ORG, async () => 30)).resolves.toBeUndefined();
    await expect(assertFeature(db, ORG, "aiAssistant")).resolves.toBeUndefined();
  });
});

describe("the safety caps", () => {
  it("sit above every plan, so a paid limit is always reachable", () => {
    vi.stubEnv("MAX_CONNECTIONS_PER_ORG", "");
    vi.stubEnv("MAX_FLOWS_PER_ORG", "");
    expect(connectionCap()).toBe(50);
    expect(flowCap()).toBe(200);
  });

  it("send every refusal to the plan page with its reason", () => {
    expect(upgradeHref("apps")).toBe("/dashboard/settings/billing?upgrade=apps");
  });
});
