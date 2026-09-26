import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { accessGrants, billingSubscriptions, flowResults, flows, linkClicks, workspaceAcquisitions } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * WHERE CUSTOMERS COME FROM — the owner's tracking links, and the funnel they
 * feed: clicks → sign-ups → connected an app → built a metric → trials →
 * paying, per link and per source (Facebook vs Instagram is the question).
 *
 * Nothing here may cost a visitor anything: a click that cannot be recorded
 * still redirects, and attribution that throws never fails a sign-up.
 */

let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

const links = await import("@/lib/growth/links");
const { GET } = await import("@/app/go/[slug]/route");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const FB_PREVIEW = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

async function link(over: Partial<Parameters<typeof links.createLink>[1]> = {}) {
  const r = await links.createLink(db, { label: "IG bio", slug: "ig-bio", source: "Instagram", medium: "social", campaign: "launch", destination: "/", createdBy: "staff", ...over });
  if (!r.ok) throw new Error(r.error);
  return r.link;
}
const visit = (slug: string, ua = IPHONE_INSTAGRAM, method = "GET") =>
  GET(new Request(`https://namzilabs.co/go/${slug}`, { method, headers: { "user-agent": ua } }), { params: Promise.resolve({ slug }) });

describe("making a link", () => {
  it("normalises the slug and the source, and refuses what could not work", async () => {
    const l = await link({ slug: "  IG-Bio ", source: " Instagram " });
    expect(l).toMatchObject({ slug: "ig-bio", source: "instagram", medium: "social" });
    expect(await links.createLink(db, { label: "x", slug: "ig-bio", source: "fb", medium: "paid", destination: "/", createdBy: "s" })).toMatchObject({ ok: false });
    expect(await links.createLink(db, { label: "x", slug: "a b", source: "fb", medium: "paid", destination: "/", createdBy: "s" })).toMatchObject({ ok: false });
    expect(await links.createLink(db, { label: "x", slug: "ok-slug", source: "", medium: "paid", destination: "/", createdBy: "s" })).toMatchObject({ ok: false });
  });

  it("only sends people somewhere on this site", async () => {
    for (const destination of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(await links.createLink(db, { label: "x", slug: `s${Math.random().toString(36).slice(2, 8)}`, source: "fb", medium: "paid", destination, createdBy: "s" })).toMatchObject({
        ok: false,
      });
    }
    expect((await link({ slug: "pricing-fb", destination: "/pricing" })).destination).toBe("/pricing");
  });
});

describe("/go/<slug>", () => {
  it("counts the click, remembers it for 30 days, and redirects with the link's utm tags", async () => {
    const l = await link({ destination: "/pricing?plan=growth" });
    const res = await visit("ig-bio");
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/pricing");
    expect(Object.fromEntries(to.searchParams)).toEqual({ plan: "growth", utm_source: "instagram", utm_medium: "social", utm_campaign: "launch" });
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, l.id))).toHaveLength(1);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${links.SOURCE_COOKIE}=${l.id}.`);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("keeps utm tags the destination already carries", async () => {
    await link({ slug: "tagged", destination: "/?utm_source=newsletter" });
    const to = new URL((await visit("tagged")).headers.get("location")!);
    expect(to.searchParams.get("utm_source")).toBe("newsletter");
    expect(to.searchParams.get("utm_medium")).toBe("social");
  });

  it("does not count link-preview bots or HEAD requests, but still sends them on", async () => {
    const l = await link();
    const bot = await visit("ig-bio", FB_PREVIEW);
    expect(bot.headers.get("location")).toContain("utm_source=instagram");
    expect(bot.headers.get("set-cookie")).toBeNull();
    await visit("ig-bio", IPHONE_INSTAGRAM, "HEAD");
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, l.id))).toHaveLength(0);
  });

  it("sends an unknown or archived link home", async () => {
    expect((await visit("nope")).headers.get("location")).toBe("https://namzilabs.co/");
    const l = await link();
    await links.archiveLink(db, l.id);
    expect((await visit("ig-bio")).headers.get("location")).toBe("https://namzilabs.co/");
  });

  it("still redirects when the click cannot be written", async () => {
    await link();
    const real = db;
    db = new Proxy(real, { get: (t, p) => (p === "insert" ? () => { throw new Error("db down"); } : Reflect.get(t, p)) }) as DB;
    try {
      expect((await visit("ig-bio")).headers.get("location")).toContain("utm_source=instagram");
    } finally {
      db = real;
    }
  });
});

describe("recording where a new workspace came from", () => {
  const jarWith = (value?: string) => {
    const store = new Map(value ? [[links.SOURCE_COOKIE, value]] : []);
    return { get: (k: string) => (store.has(k) ? { value: store.get(k)! } : undefined), delete: (k: string) => void store.delete(k), store };
  };

  it("snapshots the last link clicked, once, and forgets the cookie", async () => {
    const l = await link();
    const clickedAt = new Date("2026-09-20T10:00:00Z");
    const jar = jarWith(links.sourceCookieValue(l.id, clickedAt));
    await links.recordAcquisition(db, { orgId: "org_new", jar });
    await links.recordAcquisition(db, { orgId: "org_new", jar: jarWith(links.sourceCookieValue(l.id, clickedAt)) });
    const rows = await db.select().from(workspaceAcquisitions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: "org_new", linkId: l.id, source: "instagram", medium: "social", campaign: "launch", clickedAt });
    expect(jar.store.has(links.SOURCE_COOKIE)).toBe(false);
  });

  it("calls a workspace with no link, or a link that no longer exists, Direct", async () => {
    await links.recordAcquisition(db, { orgId: "org_a", jar: jarWith() });
    await links.recordAcquisition(db, { orgId: "org_b", jar: jarWith(links.sourceCookieValue("00000000-0000-4000-8000-000000000000", new Date())) });
    await links.recordAcquisition(db, { orgId: "org_c", jar: jarWith("garbage") });
    const rows = await db.select().from(workspaceAcquisitions);
    expect(rows.map((r) => [r.orgId, r.source, r.linkId])).toEqual(
      expect.arrayContaining([
        ["org_a", "direct", null],
        ["org_b", "direct", null],
        ["org_c", "direct", null],
      ]),
    );
  });

  it("never fails a sign-up", async () => {
    const broken = { select: () => { throw new Error("relation does not exist"); }, insert: () => { throw new Error("nope"); } } as unknown as DB;
    await expect(links.recordAcquisition(broken, { orgId: "org_x", jar: jarWith("anything") })).resolves.toBeUndefined();
  });

  it("is called where workspaces are made", () => {
    const src = readFileSync("src/app/actions.ts", "utf8");
    const body = src.slice(src.indexOf("export async function createOrganizationAction"), src.indexOf("async function startFromTemplate"));
    expect(body).toMatch(/recordAcquisition\(/);
  });
});

describe("the funnel", () => {
  it("counts each step per link and per source, with Direct for workspaces that came without one", async () => {
    const ig = await link();
    const fb = await link({ slug: "fb-ads", source: "facebook", medium: "paid", campaign: null });
    for (let i = 0; i < 5; i++) await links.recordClick(db, ig.id);
    for (let i = 0; i < 3; i++) await links.recordClick(db, fb.id);

    const acquire = (orgId: string, linkId: string | null, source: string, medium: string) =>
      db.insert(workspaceAcquisitions).values({ orgId, linkId, source, medium });
    await acquire("org_ig1", ig.id, "instagram", "social");
    await acquire("org_ig2", ig.id, "instagram", "social");
    await acquire("org_fb1", fb.id, "facebook", "paid");
    await acquire("org_direct", null, "direct", "none");

    await seedConnection(db, { orgId: "org_ig1" });
    await seedConnection(db, { orgId: "org_ig2" });
    const [flow] = await db
      .insert(flows)
      .values({ orgId: "org_ig1", name: "Cash", draftGraph: { nodes: [], edges: [], metrics: [] }, status: "published", publishedVersion: 1 })
      .returning({ id: flows.id });
    await db.insert(flowResults).values({ orgId: "org_ig1", flowId: flow.id, version: 1, outputNodeId: "n1", tile: {}, status: "fresh" });
    await db.insert(accessGrants).values({ orgId: "org_ig1", plan: "growth", kind: "trial", endsAt: new Date(Date.now() + 86_400_000) });
    await db.insert(billingSubscriptions).values({ orgId: "org_ig1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", plan: "growth", interval: "month", status: "active" });

    const f = await links.linkFunnel(db);
    expect(f.links.find((r) => r.linkId === ig.id)).toMatchObject({ clicks: 5, signups: 2, connected: 2, metric: 1, trials: 1, paying: 1 });
    expect(f.links.find((r) => r.linkId === fb.id)).toMatchObject({ clicks: 3, signups: 1, connected: 0, metric: 0, trials: 0, paying: 0 });
    expect(f.sources.find((r) => r.source === "instagram")).toMatchObject({ clicks: 5, signups: 2, paying: 1 });
    expect(f.sources.find((r) => r.source === "direct")).toMatchObject({ clicks: null, signups: 1 });
  });
});
