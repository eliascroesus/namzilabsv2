import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";
import { grantPlan } from "@/lib/billing/state";
import { checkSeat, seatAllowed } from "@/lib/billing/seats";

/**
 * SEATS — the owner and the earliest members up to the plan's limit keep the
 * workspace; anyone later sees "ask the owner to upgrade". Nobody is removed:
 * an upgrade lets them straight back in.
 */

const day = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString();
const members = [
  { userId: "owner", createdAt: day(1) },
  { userId: "m1", createdAt: day(2) },
  { userId: "m2", createdAt: day(3) },
  { userId: "m3", createdAt: day(4) },
  { userId: "m4", createdAt: day(5) },
  { userId: "m5", createdAt: day(6) },
  { userId: "m6", createdAt: day(7) },
];

describe("seatAllowed", () => {
  it("always lets the owner in", () => {
    expect(seatAllowed({ userId: "owner", ownerId: "owner", memberships: members, limit: 1 })).toBe(true);
  });

  it("gives a one-seat plan to the owner alone", () => {
    expect(seatAllowed({ userId: "m1", ownerId: "owner", memberships: members, limit: 1 })).toBe(false);
  });

  it("seats the earliest members after the owner, up to the limit", () => {
    const allowed = members.filter((m) => seatAllowed({ userId: m.userId, ownerId: "owner", memberships: members, limit: 5 }));
    expect(allowed.map((m) => m.userId)).toEqual(["owner", "m1", "m2", "m3", "m4"]);
  });

  it("does not depend on the order the provider lists them in", () => {
    const shuffled = [...members].reverse();
    expect(seatAllowed({ userId: "m4", ownerId: "owner", memberships: shuffled, limit: 5 })).toBe(true);
    expect(seatAllowed({ userId: "m5", ownerId: "owner", memberships: shuffled, limit: 5 })).toBe(false);
  });

  it("refuses someone who is not a member at all", () => {
    expect(seatAllowed({ userId: "stranger", ownerId: "owner", memberships: members, limit: 20 })).toBe(false);
  });
});

describe("checkSeat", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    vi.stubEnv("BILLING_ENABLED", "1");
    await db.insert(workspaceOwners).values({ orgId: "org_s", userId: "owner", source: "created" });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await close();
  });

  it("never asks the provider about the owner", async () => {
    const list = vi.fn(async () => members);
    expect(await checkSeat(db, "org_s", "owner", list)).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });

  it("seats by the workspace's plan", async () => {
    expect(await checkSeat(db, "org_s", "m1", async () => members)).toBe(false);
    await grantPlan(db, { orgId: "org_s", plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    expect(await checkSeat(db, "org_s", "m1", async () => members)).toBe(true);
    expect(await checkSeat(db, "org_s", "m6", async () => members)).toBe(false);
  });

  it("lets everyone in while billing is off", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    const list = vi.fn(async () => members);
    expect(await checkSeat(db, "org_s", "m6", list)).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("the gate every workspace page and action passes through", () => {
  it("requireOrg checks the seat and sends anyone unseated to /seat", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/auth.ts", "utf8");
    const body = src.slice(src.indexOf("export async function requireOrg"), src.indexOf("export async function getOrgContext"));
    expect(body).toContain("seatFor(");
    expect(body).toContain('redirect("/seat")');
    // …and /seat itself never calls requireOrg, or an unseated member loops.
    expect(readFileSync("src/app/seat/page.tsx", "utf8")).not.toContain("requireOrg(");
  });
});
