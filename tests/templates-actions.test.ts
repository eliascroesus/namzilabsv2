import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import {
  auditLog,
  dashboardTiles,
  dashboardViews,
  rankAssignments,
  referralCodes,
  referrals,
  workspaceRanks,
  workspaceTemplateUses,
  workspaceTemplates,
} from "@/db/schema";
import type { DB } from "@/db/types";
import { referralCode } from "@/lib/referral";
import { UNSET_TILE_KEY } from "@/lib/board/types";

/**
 * THE ACTS AROUND A TEMPLATE — sharing one, taking one, and the sign-up that
 * carries one — against a real Postgres, with the framework's redirect, cookie
 * jar and WorkOS stood in for.
 *
 * What these pin that the store tests cannot: the GATES (who may share, who may
 * add), the COOKIES a signed-out visitor leaves with, and that creating a
 * workspace from a template credits the author as its referrer on the path the
 * email-and-password form takes, which never reaches `/callback`.
 */

const hoisted = vi.hoisted(() => ({
  redirect: { url: "" as string },
  jar: new Map<string, string>(),
  switched: { orgId: "", returnTo: "" },
  memberships: [] as Array<{ organizationId: string; organizationName: string }>,
  user: { id: "user_student", createdAt: new Date().toISOString(), firstName: "Sam", lastName: "Student" },
}));

let db: DB;
let close: () => Promise<void>;
let ctx = {
  orgId: "org_author",
  userId: "user_coach",
  role: "admin" as string | undefined,
  auth: { user: { id: "user_coach", firstName: "Casey", lastName: "Coach", email: "coach@example.com" } },
};

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    hoisted.redirect.url = url;
    throw new Error("NEXT_REDIRECT");
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (hoisted.jar.has(k) ? { value: hoisted.jar.get(k) } : undefined),
    set: (k: string, v: string) => void hoisted.jar.set(k, v),
    delete: (k: string) => void hoisted.jar.delete(k),
  }),
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => ({ user: hoisted.user, organizationId: null }),
  switchToOrganization: async (orgId: string, opts: { returnTo: string }) => {
    hoisted.switched.orgId = orgId;
    hoisted.switched.returnTo = opts.returnTo;
  },
  signOut: async () => {},
  getWorkOS: () => ({
    userManagement: {
      listOrganizationMemberships: async () => ({ data: hoisted.memberships }),
      createOrganizationMembership: async () => ({ id: "mem_1" }),
      updateOrganizationMembership: async () => ({}),
    },
    organizations: { createOrganization: async () => ({ id: "org_new" }) },
  }),
}));

const { createTemplateAction, setTemplateLinkAction, updateTemplateAction } = await import(
  "@/app/dashboard/settings/template-actions"
);
const { startWithTemplateAction, addTemplateToWorkspaceAction } = await import("@/app/t/actions");
const { createOrganizationAction } = await import("@/app/actions");

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one);
  return fd;
};

/** Run an action that ends in `redirect`, and return where it went. */
async function landsOn(run: Promise<unknown>): Promise<string> {
  await expect(run).rejects.toThrow("NEXT_REDIRECT");
  return hoisted.redirect.url;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  hoisted.jar.clear();
  hoisted.redirect.url = "";
  hoisted.switched.orgId = "";
  hoisted.memberships = [];
  ctx = {
    orgId: "org_author",
    userId: "user_coach",
    role: "admin",
    auth: { user: { id: "user_coach", firstName: "Casey", lastName: "Coach", email: "coach@example.com" } },
  };
  await db.insert(dashboardViews).values({ id: "canvas", orgId: "org_author", name: "Overview", pos: "i", kind: "custom" });
  await db.insert(dashboardTiles).values({
    id: "t1",
    orgId: "org_author",
    viewId: "canvas",
    tileKey: UNSET_TILE_KEY,
    chart: "number",
    config: { note: "Revenue this month" },
    x: 0,
    y: 0,
    w: 3,
    h: 4,
  });
});

afterEach(async () => {
  await close();
});

async function share(): Promise<{ id: string; code: string }> {
  const url = await landsOn(createTemplateAction(form({ name: "Scorecard", description: "", views: ["canvas"] })));
  expect(url).toContain("template_made=");
  const [row] = await db.select().from(workspaceTemplates);
  return { id: row.id, code: row.code };
}

describe("sharing a template", () => {
  it("is refused to a member who does not govern the workspace", async () => {
    ctx.role = "member";
    const url = await landsOn(createTemplateAction(form({ name: "Scorecard", views: ["canvas"] })));
    // A CODE, never a sentence — a crafted settings link must not be able to
    // put words on an admin's screen (see lib/templates/messages.ts).
    expect(new URL(url, "http://local").searchParams.get("template_error")).toBe("admin");
    expect(await db.select().from(workspaceTemplates)).toEqual([]);
  });

  it("makes the link, names its author, registers their referral code and audits it", async () => {
    const { id } = await share();
    const [row] = await db.select().from(workspaceTemplates).where(eq(workspaceTemplates.id, id));
    expect(row).toMatchObject({ orgId: "org_author", createdBy: "user_coach", authorName: "Casey Coach", name: "Scorecard", enabled: true });
    expect(JSON.stringify(row.snapshot)).toContain("Revenue this month");
    expect(await db.select().from(referralCodes).where(eq(referralCodes.userId, "user_coach"))).toHaveLength(1);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "template.create"));
    expect(audit).toMatchObject({ orgId: "org_author", actorId: "user_coach", target: id });
  });

  it("publishes a board change only when updated, and bumps the version", async () => {
    const { id } = await share();
    await db.update(dashboardTiles).set({ config: { note: "Cash collected" } }).where(eq(dashboardTiles.id, "t1"));
    expect(JSON.stringify((await db.select().from(workspaceTemplates))[0].snapshot)).toContain("Revenue this month");
    await landsOn(updateTemplateAction(form({ id, name: "Scorecard v2", description: "" })));
    const [row] = await db.select().from(workspaceTemplates);
    expect(row).toMatchObject({ name: "Scorecard v2", version: 2 });
    expect(JSON.stringify(row.snapshot)).toContain("Cash collected");
  });

  it("cannot touch another workspace's template by id", async () => {
    const { id } = await share();
    ctx.orgId = "org_other";
    await landsOn(setTemplateLinkAction(form({ id, enabled: "0" })));
    expect((await db.select().from(workspaceTemplates))[0].enabled).toBe(true);
  });
});

describe("taking a template while signed out", () => {
  it("remembers the template, credits the author, and goes to sign-up coming back here", async () => {
    const { code } = await share();
    const url = await landsOn(startWithTemplateAction(form({ code })));
    expect(url).toBe(`/signup?next=${encodeURIComponent(`/t/${code}`)}`);
    expect(hoisted.jar.get("nz_tpl")).toBe(code);
    expect(hoisted.jar.get("nz_ref")).toBe(referralCode("user_coach"));
  });

  it("sets nothing for a link its author turned off", async () => {
    const { id, code } = await share();
    await landsOn(setTemplateLinkAction(form({ id, enabled: "0" })));
    const url = await landsOn(startWithTemplateAction(form({ code })));
    expect(url).toBe(`/t/${code}`);
    expect(hoisted.jar.size).toBe(0);
  });
});

describe("adding a template to the workspace you are in", () => {
  it("adds its views, counts the use, audits it and lands on the first new view", async () => {
    const { id, code } = await share();
    ctx = { ...ctx, orgId: "org_student", userId: "user_student", role: "member" };
    const url = await landsOn(addTemplateToWorkspaceAction(form({ code })));
    const [view] = await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, "org_student"));
    expect(url).toBe(`/dashboard?view=${view.id}`);
    const [tile] = await db.select().from(dashboardTiles).where(eq(dashboardTiles.orgId, "org_student"));
    expect(tile).toMatchObject({ tileKey: UNSET_TILE_KEY, config: { note: "Revenue this month" } });
    expect(await db.select().from(workspaceTemplateUses)).toMatchObject([
      { templateId: id, orgId: "org_student", userId: "user_student", newWorkspace: false, version: 1 },
    ]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "template.use"))).toHaveLength(1);
  });

  it("is refused to a role that cannot add views — and writes nothing", async () => {
    const { code } = await share();
    ctx = { ...ctx, orgId: "org_student", userId: "user_student", role: "member" };
    await db.insert(workspaceRanks).values({ id: "viewer", orgId: "org_student", name: "Viewer", allMetrics: true });
    await db.insert(rankAssignments).values({ orgId: "org_student", userId: "user_student", rankId: "viewer" });
    expect(await landsOn(addTemplateToWorkspaceAction(form({ code })))).toBe(`/t/${code}?error=rank`);
    expect(await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, "org_student"))).toEqual([]);
  });
});

describe("creating a workspace from a template", () => {
  it("builds the workspace from it, lands on its first view, and credits the author for a password sign-up", async () => {
    const { id, code } = await share();
    hoisted.jar.set("nz_tpl", code);
    hoisted.jar.set("nz_ref", referralCode("user_coach"));

    await createOrganizationAction(form({ name: "Sam's agency", template: code }));

    const views = await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, "org_new"));
    expect(views.map((v) => v.name)).toEqual(["Overview"]);
    expect(hoisted.switched).toEqual({ orgId: "org_new", returnTo: `/dashboard?view=${views[0].id}` });
    expect(await db.select().from(workspaceTemplateUses)).toMatchObject([{ templateId: id, orgId: "org_new", newWorkspace: true }]);
    expect(await db.select().from(referrals)).toMatchObject([{ referrerUserId: "user_coach", referredUserId: "user_student" }]);
    // Both cookies answered: the template was used, the referral written.
    expect(hoisted.jar.has("nz_tpl")).toBe(false);
    expect(hoisted.jar.has("nz_ref")).toBe(false);
  });

  it("still creates the workspace when the template's link was turned off — empty, and without failing", async () => {
    const { id, code } = await share();
    await landsOn(setTemplateLinkAction(form({ id, enabled: "0" })));
    await createOrganizationAction(form({ name: "Sam's agency", template: code }));
    expect(hoisted.switched).toEqual({ orgId: "org_new", returnTo: "/dashboard" });
    expect(await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, "org_new"))).toEqual([]);
  });

  it("sends a new workspace named after an existing one back to pick another name", async () => {
    const { code } = await share();
    hoisted.memberships = [{ organizationId: "org_existing", organizationName: "Sam's agency" }];
    await expect(createOrganizationAction(form({ name: "Sam's agency", template: code }))).rejects.toThrow("NEXT_REDIRECT");
    expect(hoisted.redirect.url).toBe(`/t/${code}?error=name`);
    expect(hoisted.switched.orgId).toBe("");
  });

  it("still treats a double-submit as one — the first press already took the template", async () => {
    const { code } = await share();
    await createOrganizationAction(form({ name: "Sam's agency", template: code }));
    hoisted.memberships = [{ organizationId: "org_new", organizationName: "Sam's agency" }];
    hoisted.switched.orgId = "";
    await createOrganizationAction(form({ name: "Sam's agency", template: code }));
    expect(hoisted.switched).toEqual({ orgId: "org_new", returnTo: "/dashboard" });
    expect(await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, "org_new"))).toHaveLength(1);
  });

  it("does not credit anybody for an account that is not new", async () => {
    await share();
    hoisted.jar.set("nz_ref", referralCode("user_coach"));
    const created = hoisted.user.createdAt;
    hoisted.user.createdAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await createOrganizationAction(form({ name: "Second space" }));
    } finally {
      hoisted.user.createdAt = created;
    }
    expect(await db.select().from(referrals)).toEqual([]);
    // Kept: a refused attribution must not throw away one that might still land.
    expect(hoisted.jar.has("nz_ref")).toBe(true);
  });
});
