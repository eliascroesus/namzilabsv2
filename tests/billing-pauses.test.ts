import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, planPauses } from "@/db/schema";
import type { DB } from "@/db/types";
import { grantPlan } from "@/lib/billing/state";
import { PLAN_PAUSE_UNTIL, applyPlan, enforceAppLimit, isPlanPause, pausedNote, resumePlanPauses } from "@/lib/billing/pauses";

/**
 * APPS OVER THE PLAN'S LIMIT STOP SYNCING — AND RESUME THE MOMENT THEY FIT.
 *
 * The first N connected keep syncing; the rest are paused through the pause
 * the sweep already honours, and recorded so an upgrade resumes exactly those
 * — never a connection paused for its own reasons, like a tripped breaker.
 * Nothing is deleted, and stored data stays.
 */

let db: DB;
let close: () => Promise<void>;
const ORG = "org_pause";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

/** `n` connections, each connected one minute after the last. */
async function apps(n: number, status = "active"): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [row] = await db
      .insert(connections)
      .values({ orgId: ORG, source: "webhook", name: `app ${i}`, status, authType: "secret", createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)) })
      .returning({ id: connections.id });
    ids.push(row.id);
  }
  return ids;
}

const pausedIds = async () =>
  (await db.select({ id: connections.id, until: connections.pausedUntil }).from(connections)).filter((c) => isPlanPause(c.until)).map((c) => c.id);

describe("enforceAppLimit", () => {
  it("pauses the apps connected after the plan's first three, and says why", async () => {
    const ids = await apps(5);
    expect(await enforceAppLimit(db, ORG)).toBe(2);
    expect((await pausedIds()).sort()).toEqual(ids.slice(3).sort());
    const [one] = await db.select().from(connections).where(eq(connections.id, ids[4]));
    expect(one.pausedReason).toMatch(/Free plan/);
    expect(await db.select().from(planPauses)).toHaveLength(2);
  });

  it("does nothing twice", async () => {
    await apps(5);
    await enforceAppLimit(db, ORG);
    expect(await enforceAppLimit(db, ORG)).toBe(0);
    expect(await db.select().from(planPauses)).toHaveLength(2);
  });

  it("ignores disabled connections — they neither count nor get paused", async () => {
    await apps(2, "disabled");
    await apps(3);
    expect(await enforceAppLimit(db, ORG)).toBe(0);
  });

  it("does nothing while billing is off", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    await apps(8);
    expect(await enforceAppLimit(db, ORG)).toBe(0);
    expect(await pausedIds()).toEqual([]);
  });
});

describe("resuming", () => {
  it("resumes every plan-paused app once the plan fits them", async () => {
    await apps(5);
    await enforceAppLimit(db, ORG);
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    expect(await resumePlanPauses(db, ORG)).toBe(2);
    expect(await pausedIds()).toEqual([]);
    expect(await db.select().from(planPauses)).toHaveLength(0);
    const rows = await db.select({ until: connections.pausedUntil, reason: connections.pausedReason }).from(connections);
    for (const r of rows) expect(r).toEqual({ until: null, reason: null });
  });

  it("never lifts a pause it did not make", async () => {
    const [, , , breaker] = await apps(4);
    const soon = new Date(Date.now() + 3_600_000);
    await db.update(connections).set({ pausedUntil: soon, pausedReason: "Paused after 1 failed attempt" }).where(eq(connections.id, breaker));
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    await resumePlanPauses(db, ORG);
    const [row] = await db.select().from(connections).where(eq(connections.id, breaker));
    expect(row.pausedUntil?.getTime()).toBe(soon.getTime());
  });

  it("leaves alone a plan pause the breaker has since replaced, but forgets its record", async () => {
    const ids = await apps(4);
    await enforceAppLimit(db, ORG);
    const soon = new Date(Date.now() + 3_600_000);
    await db.update(connections).set({ pausedUntil: soon }).where(eq(connections.id, ids[3]));
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    await resumePlanPauses(db, ORG);
    const [row] = await db.select().from(connections).where(eq(connections.id, ids[3]));
    expect(row.pausedUntil?.getTime()).toBe(soon.getTime());
    expect(await db.select().from(planPauses)).toHaveLength(0);
  });

  it("applyPlan does both: a smaller plan pauses, a bigger one resumes", async () => {
    await apps(12);
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    await applyPlan(db, ORG);
    expect(await pausedIds()).toHaveLength(2);
    await grantPlan(db, { orgId: ORG, plan: "scale", kind: "manual", endsAt: null, grantedBy: "s" });
    await applyPlan(db, ORG);
    expect(await pausedIds()).toHaveLength(0);
  });

  it("marks its pauses so the UI can tell them from a breaker's", () => {
    expect(isPlanPause(PLAN_PAUSE_UNTIL)).toBe(true);
    expect(isPlanPause(new Date(Date.now() + 3_600_000))).toBe(false);
    expect(isPlanPause(null)).toBe(false);
  });
});

describe("the sweep applies the limit before it polls", () => {
  it("reconcile-one-connection enforces the plan inside its reconcile step", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/inngest/functions/reconcile.ts", "utf8");
    const one = src.slice(src.indexOf("export const reconcileOne"));
    const step = one.slice(one.indexOf('step.run("reconcile"'), one.indexOf('step.run("reconcile"') + 700);
    expect(step).toContain("enforceAppLimit(");
    expect(step.indexOf("enforceAppLimit(")).toBeLessThan(step.indexOf("reconcileConnection("));
  });
});

describe("what a paused app says on the Integrations list", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  it("tells a plan-paused app it resumes on upgrade — never a retry time in the year 9999", () => {
    const note = pausedNote(PLAN_PAUSE_UNTIL, "Paused on the Free plan — upgrade to resume syncing.", NOW)!;
    expect(note).toContain("upgrade to resume");
    expect(note).toMatch(/nothing is lost/i);
    expect(note).not.toMatch(/Retries automatically|9999|12:00/);
  });

  it("keeps the retry time for an ordinary pause", () => {
    const note = pausedNote(new Date(NOW.getTime() + 3_600_000), "Rate limited by the provider.", NOW)!;
    expect(note).toContain("Rate limited by the provider.");
    expect(note).toContain("Retries automatically around");
  });

  it("says nothing once a pause has passed", () => {
    expect(pausedNote(new Date(NOW.getTime() - 1000), "x", NOW)).toBeUndefined();
    expect(pausedNote(null, null, NOW)).toBeUndefined();
  });
});
