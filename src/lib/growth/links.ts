import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  accessGrants,
  billingSubscriptions,
  connections,
  flowResults,
  linkClicks,
  trackingLinks,
  workspaceAcquisitions,
} from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * WHERE CUSTOMERS COME FROM — the owner's tracking links.
 *
 * A link is `namzilabs.co/go/<slug>`, made in the admin panel with a source
 * ("instagram"), a medium ("social") and an optional campaign. A click is
 * counted (link-preview bots and HEAD requests are not; no IP or user agent
 * is kept), a 30-day `nz_src` cookie remembers which link it was, and the
 * visitor goes on to the destination with `utm_*` added. When they later make
 * a workspace, the link is snapshotted onto `workspace_acquisitions` — or
 * "direct" if there was none — and the funnel is counted from there.
 *
 * NOTHING HERE MAY COST A VISITOR ANYTHING. A click that cannot be written
 * still redirects; an acquisition that cannot be written leaves the sign-up
 * exactly as it would have been.
 */

export const SOURCE_COOKIE = "nz_src";
export const SOURCE_COOKIE_DAYS = 30;

export type TrackingLink = typeof trackingLinks.$inferSelect;
type Jar = { get(name: string): { value: string } | undefined; delete(name: string): unknown };

/**
 * Crawlers that fetch a link to draw its preview, and scripts. NOT the in-app
 * browsers — Instagram's and Facebook's own ("Instagram", "FBAN") are people
 * tapping the link, which is the whole point of counting.
 */
const BOT = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|telegram|skype|preview|embedly|headless|lighthouse|curl\/|wget\/|python-|httpclient|axios\/|node-fetch|go-http/i;

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT.test(userAgent);
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;
const TAG = /^[a-z0-9][a-z0-9_.-]{0,39}$/;

export function normaliseSlug(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return SLUG.test(s) ? s : null;
}
const tag = (raw: string | null | undefined): string | null => {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return TAG.test(s) ? s : null;
};

/** A path on this site, or nothing: a tracking link is never a way off it. */
export function safeDestination(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim() || "/";
  if (!s.startsWith("/") || s.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/**
 * Why a link was refused, as a CODE — the admin page maps it to a sentence,
 * so no text from a URL is ever printed on a staff page.
 */
export type LinkError = "slug" | "tags" | "campaign" | "destination" | "taken";
export const LINK_ERRORS: Record<LinkError, string> = {
  slug: "The slug needs 2–48 lower-case letters, numbers or dashes.",
  tags: "Give the link a source (like instagram) and a medium (like social).",
  campaign: "The campaign can use letters, numbers, dashes and underscores.",
  destination: "The destination must be a page on this site, like / or /pricing.",
  taken: "There is already a link with that slug.",
};

export async function createLink(
  db: DB,
  input: { label: string; slug: string; source: string; medium: string; campaign?: string | null; destination?: string | null; createdBy: string },
): Promise<{ ok: true; link: TrackingLink } | { ok: false; error: LinkError }> {
  const slug = normaliseSlug(input.slug);
  if (!slug) return { ok: false, error: "slug" };
  const source = tag(input.source);
  const medium = tag(input.medium);
  if (!source || !medium) return { ok: false, error: "tags" };
  const campaign = input.campaign?.trim() ? tag(input.campaign) : null;
  if (input.campaign?.trim() && !campaign) return { ok: false, error: "campaign" };
  const destination = safeDestination(input.destination);
  if (!destination) return { ok: false, error: "destination" };
  const label = input.label.trim() || slug;
  const [link] = await db
    .insert(trackingLinks)
    .values({ slug, label, source, medium, campaign, destination, createdBy: input.createdBy })
    .onConflictDoNothing()
    .returning();
  if (!link) return { ok: false, error: "taken" };
  return { ok: true, link };
}

/** Archived links stop redirecting (they go home) but keep their history. */
export async function archiveLink(db: DB, linkId: string, now = new Date()): Promise<void> {
  await db.update(trackingLinks).set({ archivedAt: now }).where(eq(trackingLinks.id, linkId));
}

/** A live link by slug; null for anything unknown or archived. */
export async function linkBySlug(db: DB, raw: string): Promise<TrackingLink | null> {
  const slug = normaliseSlug(raw);
  if (!slug) return null;
  const [link] = await db
    .select()
    .from(trackingLinks)
    .where(and(eq(trackingLinks.slug, slug), isNull(trackingLinks.archivedAt)))
    .limit(1);
  return link ?? null;
}

/** One more click on today's counter for this link (UTC days). */
export async function recordClick(db: DB, linkId: string, at = new Date()): Promise<void> {
  await db
    .insert(linkClicks)
    .values({ linkId, day: at.toISOString().slice(0, 10), clicks: 1 })
    .onConflictDoUpdate({ target: [linkClicks.linkId, linkClicks.day], set: { clicks: sql`${linkClicks.clicks} + 1` } });
}

/** Where the visitor lands: the destination, with the link's utm tags added where it has none of its own. */
export function destinationFor(link: Pick<TrackingLink, "destination" | "source" | "medium" | "campaign" | "slug">): string {
  const url = new URL(safeDestination(link.destination) ?? "/", "https://x.invalid");
  const tags: Array<[string, string | null]> = [
    ["utm_source", link.source],
    ["utm_medium", link.medium],
    ["utm_campaign", link.campaign],
  ];
  for (const [k, v] of tags) if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sourceCookieValue(linkId: string, clickedAt: Date): string {
  return `${linkId}.${clickedAt.getTime()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSourceCookie(raw: string | null | undefined): { linkId: string; clickedAt: Date } | null {
  const [linkId, ms] = (raw ?? "").split(".");
  const t = Number(ms);
  if (!linkId || !UUID.test(linkId) || !Number.isFinite(t) || t <= 0) return null;
  return { linkId, clickedAt: new Date(t) };
}

/**
 * WHERE A NEW WORKSPACE CAME FROM, written once, the moment it is made. The
 * link's source, medium and campaign are COPIED, so editing or archiving the
 * link later never rewrites history. The cookie is spent: a second workspace
 * the same person makes next week did not come from last week's ad.
 */
export async function recordAcquisition(db: DB, input: { orgId: string; jar: Jar }): Promise<void> {
  try {
    const clicked = parseSourceCookie(input.jar.get(SOURCE_COOKIE)?.value);
    let link: TrackingLink | null = null;
    if (clicked) {
      const [row] = await db.select().from(trackingLinks).where(eq(trackingLinks.id, clicked.linkId)).limit(1);
      link = row ?? null;
    }
    await db
      .insert(workspaceAcquisitions)
      .values(
        link
          ? { orgId: input.orgId, linkId: link.id, source: link.source, medium: link.medium, campaign: link.campaign, clickedAt: clicked!.clickedAt }
          : { orgId: input.orgId, linkId: null, source: "direct", medium: "none", campaign: null, clickedAt: null },
      )
      .onConflictDoNothing();
  } catch (e) {
    console.error(`[growth] acquisition not recorded for ${input.orgId}`, e);
  }
  try {
    input.jar.delete(SOURCE_COOKIE);
  } catch {
    /* a cookie that cannot be cleared expires on its own */
  }
}

export type FunnelRow = {
  clicks: number | null;
  signups: number;
  connected: number;
  metric: number;
  trials: number;
  paying: number;
};
export type LinkFunnelRow = FunnelRow & { linkId: string; slug: string; label: string; source: string; medium: string; campaign: string | null; archived: boolean };
export type SourceFunnelRow = FunnelRow & { source: string };

const PAYING = ["active", "past_due"];

/**
 * THE FUNNEL: clicks → sign-ups (workspaces made) → connected an app → built
 * a metric → started a trial → paying, per link and per source. Each step
 * counts WORKSPACES that reached it, so a step can never exceed the one
 * before it by counting one workspace twice.
 */
export async function linkFunnel(db: DB, opts: { since?: Date } = {}): Promise<{ links: LinkFunnelRow[]; sources: SourceFunnelRow[] }> {
  const allLinks = await db.select().from(trackingLinks);
  const clickRows = await db
    .select({ linkId: linkClicks.linkId, n: sql<number>`coalesce(sum(${linkClicks.clicks}), 0)::int` })
    .from(linkClicks)
    .where(opts.since ? gte(linkClicks.day, opts.since.toISOString().slice(0, 10)) : undefined)
    .groupBy(linkClicks.linkId);
  const clicks = new Map(clickRows.map((r) => [r.linkId, Number(r.n)]));

  const acquisitions = await db
    .select({ orgId: workspaceAcquisitions.orgId, linkId: workspaceAcquisitions.linkId, source: workspaceAcquisitions.source })
    .from(workspaceAcquisitions)
    .where(opts.since ? gte(workspaceAcquisitions.createdAt, opts.since) : undefined);
  const orgIds = acquisitions.map((a) => a.orgId);

  const reached = async (q: () => Promise<Array<{ orgId: string }>>) => (orgIds.length === 0 ? new Set<string>() : new Set((await q()).map((r) => r.orgId)));
  const [connected, metric, trialGrants, trialSubs, paying] = await Promise.all([
    reached(() => db.selectDistinct({ orgId: connections.orgId }).from(connections).where(inArray(connections.orgId, orgIds))),
    reached(() => db.selectDistinct({ orgId: flowResults.orgId }).from(flowResults).where(inArray(flowResults.orgId, orgIds))),
    reached(() =>
      db
        .selectDistinct({ orgId: accessGrants.orgId })
        .from(accessGrants)
        .where(and(inArray(accessGrants.orgId, orgIds), eq(accessGrants.kind, "trial"))),
    ),
    reached(() =>
      db
        .selectDistinct({ orgId: billingSubscriptions.orgId })
        .from(billingSubscriptions)
        .where(and(inArray(billingSubscriptions.orgId, orgIds), eq(billingSubscriptions.status, "trialing"))),
    ),
    reached(() =>
      db
        .selectDistinct({ orgId: billingSubscriptions.orgId })
        .from(billingSubscriptions)
        .where(and(inArray(billingSubscriptions.orgId, orgIds), inArray(billingSubscriptions.status, PAYING))),
    ),
  ]);

  const tally = (orgs: string[], clickCount: number | null): FunnelRow => ({
    clicks: clickCount,
    signups: orgs.length,
    connected: orgs.filter((o) => connected.has(o)).length,
    metric: orgs.filter((o) => metric.has(o)).length,
    // Paying counts as past the trial step (some pay without one), so the
    // funnel never narrows at "trials" and widens again at "paying".
    trials: orgs.filter((o) => trialGrants.has(o) || trialSubs.has(o) || paying.has(o)).length,
    paying: orgs.filter((o) => paying.has(o)).length,
  });

  const links: LinkFunnelRow[] = allLinks.map((l) => ({
    linkId: l.id,
    slug: l.slug,
    label: l.label,
    source: l.source,
    medium: l.medium,
    campaign: l.campaign,
    archived: l.archivedAt != null,
    ...tally(
      acquisitions.filter((a) => a.linkId === l.id).map((a) => a.orgId),
      clicks.get(l.id) ?? 0,
    ),
  }));

  const sourceNames = [...new Set([...allLinks.map((l) => l.source), ...acquisitions.map((a) => a.source)])];
  const sources: SourceFunnelRow[] = sourceNames.map((source) => {
    const linkIds = allLinks.filter((l) => l.source === source).map((l) => l.id);
    const clickTotal = linkIds.length === 0 ? null : linkIds.reduce((n, id) => n + (clicks.get(id) ?? 0), 0);
    return { source, ...tally(acquisitions.filter((a) => a.source === source).map((a) => a.orgId), clickTotal) };
  });
  sources.sort((a, b) => b.signups - a.signups || (b.clicks ?? 0) - (a.clicks ?? 0));
  links.sort((a, b) => Number(a.archived) - Number(b.archived) || b.signups - a.signups || (b.clicks ?? 0) - (a.clicks ?? 0));
  return { links, sources };
}
