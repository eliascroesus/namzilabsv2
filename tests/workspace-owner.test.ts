import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { rankAssignments, workspaceOwners, workspaceRanks } from "@/db/schema";
import { canManageRanks, claimOwnerIfMissing, effectiveAccess } from "@/lib/permissions";

/**
 * THE CREATOR IS THE OWNER, AND THE OWNER CAN NEVER BE LOCKED OUT.
 *
 * WorkOS seeds only a default `member` role, so "who is in charge" is OUR
 * database's fact: written at org creation, backfilled for older orgs from
 * the earliest membership. These run against real SQL (PGlite + the actual
 * migrations) because the properties that matter here are database
 * properties — the PK that makes the claim idempotent, the org scoping.
 *
 * The lockout rule is the security-critical one: a rank assigned to the
 * owner, by slip or by malice, must change nothing. Without it, any member
 * who can reach assignRankAction could depose the workspace's creator.
 */
describe("workspace owner", () => {
  it("claims the earliest membership, once, and every later call sees the winner", async () => {
    const { db, close } = await createTestDb();
    try {
      const first = await claimOwnerIfMissing(db, "org_a", [
        { userId: "user_late", createdAt: "2026-02-01T00:00:00Z" },
        { userId: "user_creator", createdAt: "2026-01-01T00:00:00Z" },
      ]);
      expect(first).toBe("user_creator");

      // A second claim — even with a different, wrong candidate list — must
      // return the recorded winner, not re-decide.
      const second = await claimOwnerIfMissing(db, "org_a", [{ userId: "user_impostor", createdAt: "2020-01-01T00:00:00Z" }]);
      expect(second).toBe("user_creator");

      // And an org with no members claims nobody rather than inventing one.
      expect(await claimOwnerIfMissing(db, "org_empty", [])).toBeNull();
    } finally {
      await close();
    }
  });

  it("a rank assigned to the owner changes nothing", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(workspaceOwners).values({ orgId: "org_a", userId: "user_owner", source: "created" });
      await db.insert(workspaceRanks).values({
        id: "rank_nothing",
        orgId: "org_a",
        name: "Sees nothing",
        permissions: [],
        metricKeys: [],
        inherits: [],
      });
      await db.insert(rankAssignments).values({ orgId: "org_a", userId: "user_owner", rankId: "rank_nothing" });

      const access = await effectiveAccess(db, { orgId: "org_a", userId: "user_owner" });
      expect(access.can("create_flows")).toBe(true);
      expect(access.canSeeMetric("flow:anything")).toBe(true);
      expect(await canManageRanks(db, { orgId: "org_a", userId: "user_owner" })).toBe(true);
    } finally {
      await close();
    }
  });

  it("a ranked non-owner is restricted and may not manage ranks; an unranked one may", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(workspaceOwners).values({ orgId: "org_a", userId: "user_owner", source: "created" });
      await db.insert(workspaceRanks).values({
        id: "rank_closer",
        orgId: "org_a",
        name: "Closer",
        permissions: [],
        metricKeys: ["flow:f1"],
        inherits: [],
      });
      await db.insert(rankAssignments).values({ orgId: "org_a", userId: "user_closer", rankId: "rank_closer" });

      const closer = await effectiveAccess(db, { orgId: "org_a", userId: "user_closer" });
      expect(closer.can("create_flows")).toBe(false);
      expect(closer.canSeeMetric("flow:f1")).toBe(true);
      expect(closer.canSeeMetric("flow:f2")).toBe(false);
      expect(await canManageRanks(db, { orgId: "org_a", userId: "user_closer" })).toBe(false);

      // Unranked member: full access today, may manage — the self-serve
      // fallback that keeps the editor reachable before WorkOS roles exist.
      expect(await canManageRanks(db, { orgId: "org_a", userId: "user_unranked" })).toBe(true);

      // And the owner row is org-scoped: the same userId in another org is
      // nobody there.
      expect(await canManageRanks(db, { orgId: "org_b", userId: "user_closer" })).toBe(true);
      await db.insert(workspaceRanks).values({ id: "rank_b", orgId: "org_b", name: "B", permissions: [], metricKeys: [], inherits: [] });
      await db.insert(rankAssignments).values({ orgId: "org_b", userId: "user_owner", rankId: "rank_b" });
      expect(await canManageRanks(db, { orgId: "org_b", userId: "user_owner" })).toBe(false);
    } finally {
      await close();
    }
  });
});
