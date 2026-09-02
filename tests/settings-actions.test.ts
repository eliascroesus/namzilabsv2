import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { rankAssignments, workspaceRanks } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * `assignRankAction` TRUSTS THE BROWSER FOR WHICH MEMBER, NOT JUST WHICH RANK.
 *
 * The rank id already gets walled to this org before writing (see the comment
 * at its use below). The member id had no such wall: `memberUserId` is a
 * plain string argument, so any signed-in caller who can reach the action
 * (any admin/owner/`manage_workspace` holder) could plant a rank assignment —
 * or clear one — for a WorkOS user id that was never a member of this
 * workspace, active in some other org, or simply invented. WorkOS is the
 * source of truth for membership, so this confirms THERE before either
 * branch writes.
 */

let db: DB;
let close: () => Promise<void>;
let ctx = { orgId: "org_a", userId: "admin_1", role: "admin" as string | undefined };

const listOrganizationMemberships = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships } }),
}));

const { assignRankAction } = await import("@/app/dashboard/settings/actions");

const A = "org_a";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ctx = { orgId: A, userId: "admin_1", role: "admin" };
  listOrganizationMemberships.mockReset();
  await db.insert(workspaceRanks).values({ id: "rank_1", orgId: A, name: "Closer", metricKeys: ["flow:f1"] });
});
afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
});

const assignmentOf = async (userId: string) => {
  const [row] = await db
    .select()
    .from(rankAssignments)
    .where(and(eq(rankAssignments.orgId, A), eq(rankAssignments.userId, userId)));
  return row ?? null;
};

describe("assigning a rank", () => {
  it("refuses a member id WorkOS has no active membership for, and writes nothing", async () => {
    listOrganizationMemberships.mockResolvedValue({ data: [] });

    const r = await assignRankAction("user_ghost", "rank_1");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("That person is not a member of this workspace.");
    expect(await assignmentOf("user_ghost")).toBeNull();
    expect(listOrganizationMemberships).toHaveBeenCalledWith({
      organizationId: A,
      userId: "user_ghost",
      statuses: ["active"],
    });
  });

  it("lands the assignment once WorkOS confirms an active membership", async () => {
    listOrganizationMemberships.mockResolvedValue({ data: [{ id: "om_1" }] });

    const r = await assignRankAction("user_real", "rank_1");

    expect(r.ok).toBe(true);
    const row = await assignmentOf("user_real");
    expect(row?.rankId).toBe("rank_1");
  });
});

describe("clearing a rank", () => {
  it("also verifies membership before deleting the assignment", async () => {
    // A stale assignment: this member's WorkOS membership has since lapsed,
    // but the row from when they held it is still here.
    await db.insert(rankAssignments).values({ orgId: A, userId: "user_ghost", rankId: "rank_1" });
    listOrganizationMemberships.mockResolvedValue({ data: [] });

    const r = await assignRankAction("user_ghost", null);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("That person is not a member of this workspace.");
    // Refused BEFORE the delete — the stale row must survive the refusal.
    expect(await assignmentOf("user_ghost")).not.toBeNull();
  });

  it("clears the assignment once WorkOS confirms an active membership", async () => {
    await db.insert(rankAssignments).values({ orgId: A, userId: "user_real", rankId: "rank_1" });
    listOrganizationMemberships.mockResolvedValue({ data: [{ id: "om_1" }] });

    const r = await assignRankAction("user_real", null);

    expect(r.ok).toBe(true);
    expect(await assignmentOf("user_real")).toBeNull();
  });
});
