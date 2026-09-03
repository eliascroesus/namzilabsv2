import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { mcpGrants, mcpBindings } from "@/db/schema";
import type { DB } from "@/db/types";
import type { McpAuth } from "@/lib/mcp/auth";

export type Workspace = { orgId: string; name: string };
export type ResolvedWorkspace = { orgId: string; userId: string; role?: string; grantSource: "selected" | "claim" };
export type Resolution =
  | { ok: true; ws: ResolvedWorkspace }
  | { ok: false; reason: "workspace_required" | "revoked" | "not_member"; workspaces?: Workspace[] };

const CACHE_TTL_MS = 60_000;
const BINDING_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; role?: string; member: boolean }>();
export function clearMembershipCache(): void { cache.clear(); }

/** Active membership + role slug, cached 60 s. `undefined` = not a member. */
async function membership(userId: string, orgId: string): Promise<{ role?: string } | undefined> {
  const key = `${userId}:${orgId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.member ? { role: hit.role } : undefined;
  const res = await getWorkOS().userManagement.listOrganizationMemberships({ userId, organizationId: orgId, statuses: ["active"] });
  const m = res.data[0];
  const role = (m as { role?: { slug?: string } } | undefined)?.role?.slug;
  cache.set(key, { at: Date.now(), member: Boolean(m), role });
  return m ? { role } : undefined;
}

/** The membership row already carries the org name (app-shell.tsx reads it the same way): no per-org round trip. */
export async function listUserWorkspaces(userId: string): Promise<Workspace[]> {
  const res = await getWorkOS().userManagement.listOrganizationMemberships({ userId, statuses: ["active"], limit: 100 });
  const seen = new Set<string>();
  return res.data
    .map((m) => ({ orgId: m.organizationId, name: m.organizationName }))
    .filter((w) => !seen.has(w.orgId) && (seen.add(w.orgId), true));
}

async function grantOf(db: DB, userId: string, orgId: string) {
  const [g] = await db.select().from(mcpGrants).where(and(eq(mcpGrants.userId, userId), eq(mcpGrants.orgId, orgId))).limit(1);
  return g ?? null;
}

async function touchGrant(db: DB, userId: string, orgId: string, source: "selected" | "claim"): Promise<void> {
  await db
    .insert(mcpGrants)
    .values({ userId, orgId, source, lastUsedAt: new Date() })
    .onConflictDoUpdate({ target: [mcpGrants.userId, mcpGrants.orgId], set: { lastUsedAt: new Date() } });
}

async function bind(db: DB, auth: McpAuth, orgId: string): Promise<void> {
  const exp = auth.extra.bindingKey.startsWith("token:") && auth.expiresAt ? new Date(auth.expiresAt * 1000) : new Date(Date.now() + BINDING_FALLBACK_TTL_MS);
  await db
    .insert(mcpBindings)
    .values({ bindingKey: auth.extra.bindingKey, userId: auth.extra.userId, orgId, expiresAt: exp })
    .onConflictDoUpdate({ target: mcpBindings.bindingKey, set: { orgId, expiresAt: exp } });
}

async function finish(db: DB, auth: McpAuth, orgId: string, source: "selected" | "claim"): Promise<Resolution> {
  const m = await membership(auth.extra.userId, orgId);
  if (!m) return { ok: false, reason: "not_member" };
  const g = await grantOf(db, auth.extra.userId, orgId);
  // Revoked stays revoked on this path: only an explicit select_workspace
  // clears it (spec, Revocation). Otherwise Disconnect would be undone by the
  // assistant's very next call, since the client still holds a valid token.
  if (g?.revokedAt) return { ok: false, reason: "revoked" };
  await touchGrant(db, auth.extra.userId, orgId, g?.source ?? source);
  return { ok: true, ws: { orgId, userId: auth.extra.userId, role: m.role, grantSource: g?.source ?? source } };
}

/**
 * The spec's three-step resolution: claim → binding → the one un-revoked
 * grant; otherwise ask. Membership is always re-verified (cached 60 s).
 */
export async function resolveWorkspace(db: DB, auth: McpAuth): Promise<Resolution> {
  const { userId, orgIdClaim, bindingKey } = auth.extra;
  if (orgIdClaim) return finish(db, auth, orgIdClaim, "claim");

  const [b] = await db.select().from(mcpBindings).where(and(eq(mcpBindings.bindingKey, bindingKey), gt(mcpBindings.expiresAt, new Date()))).limit(1);
  if (b && b.userId === userId) return finish(db, auth, b.orgId, "selected");

  const live = await db.select().from(mcpGrants).where(and(eq(mcpGrants.userId, userId), isNull(mcpGrants.revokedAt)));
  if (live.length === 1) {
    const r = await finish(db, auth, live[0].orgId, live[0].source);
    if (r.ok) await bind(db, auth, live[0].orgId);
    return r;
  }
  return { ok: false, reason: "workspace_required", workspaces: await listUserWorkspaces(userId) };
}

export async function selectWorkspace(db: DB, auth: McpAuth, orgId: string): Promise<Resolution> {
  const m = await membership(auth.extra.userId, orgId);
  if (!m) return { ok: false, reason: "not_member" };
  await db
    .insert(mcpGrants)
    .values({ userId: auth.extra.userId, orgId, source: "selected", lastUsedAt: new Date(), revokedAt: null })
    .onConflictDoUpdate({ target: [mcpGrants.userId, mcpGrants.orgId], set: { source: "selected", lastUsedAt: new Date(), revokedAt: null } });
  await bind(db, auth, orgId);
  return { ok: true, ws: { orgId, userId: auth.extra.userId, role: m.role, grantSource: "selected" } };
}

export async function revokeGrant(db: DB, orgId: string, userId: string): Promise<void> {
  // Bindings are left in place, deliberately: a client already bound to this
  // (org, user) still resolves through the binding path in resolveWorkspace,
  // which re-reads the grant and reports `revoked` there. Deleting the
  // binding here would erase the very thing that keeps that client refused —
  // with no binding row, resolveWorkspace falls through to "the one live
  // grant" and can silently reconnect the client to a DIFFERENT workspace,
  // which is worse than merely failing to disconnect.
  await db.update(mcpGrants).set({ revokedAt: new Date() }).where(and(eq(mcpGrants.orgId, orgId), eq(mcpGrants.userId, userId)));
}

export type GrantRow = typeof mcpGrants.$inferSelect & { clients: number };

/** Grants for the Settings list, each with how many distinct live clients (bindings) use it. */
export async function listGrants(db: DB, orgId: string, userId?: string): Promise<GrantRow[]> {
  const where = userId ? and(eq(mcpGrants.orgId, orgId), eq(mcpGrants.userId, userId)) : eq(mcpGrants.orgId, orgId);
  const [grants, bindings] = await Promise.all([
    db.select().from(mcpGrants).where(where).orderBy(mcpGrants.userId),
    db.select({ userId: mcpBindings.userId, n: sql<number>`count(*)::int` }).from(mcpBindings)
      .where(and(eq(mcpBindings.orgId, orgId), gt(mcpBindings.expiresAt, new Date()))).groupBy(mcpBindings.userId),
  ]);
  const clientsOf = new Map(bindings.map((b) => [b.userId, Number(b.n)]));
  return grants.map((g) => ({ ...g, clients: clientsOf.get(g.userId) ?? 0 }));
}
