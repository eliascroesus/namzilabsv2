import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { mcpBindings, mcpCalls } from "@/db/schema";
import type { DB } from "@/db/types";

export const USER_PER_MINUTE = 60;
export const ORG_PER_HOUR = 600;
export const MCP_CALLS_RETENTION_DAYS = 90;
/**
 * Rows removed per table per night — same bound as storage-lifecycle.ts, so
 * one sweep can't lock a hot table. Exported so `sync.ts` can compare its own
 * batch's overdue counts against the SAME number rather than repeating 5000.
 */
export const MCP_PRUNE_BATCH = 5_000;
/** How much of a caught error's own text `recordCall` will keep. See `CallEntry.error`. */
const ERROR_MAX_CHARS = 200;

export function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string") out[k] = v.length <= 40 && /^[A-Za-z0-9_:\-.]+$/.test(v) ? v : "<text>";
    else out[k] = Array.isArray(v) ? `<array:${v.length}>` : "<object>";
  }
  return out;
}

export type CallEntry = {
  orgId: string; userId: string; clientId?: string | null; tool: string;
  argsSummary: Record<string, unknown>; rows: number; bytes: number; durationMs: number;
  revealContacts?: boolean;
  /**
   * The tool's own one-sentence result text (what `fail()` produced), NEVER
   * a caught exception's `.message`. `mcp_calls`' own schema comment says
   * "never free text", and an exception message can carry anything a library
   * or the runtime chooses to put there — a stack fragment, a connection
   * string, a echoed-back argument. `recordCall` hard-truncates to
   * `ERROR_MAX_CHARS` regardless, as a backstop rather than a license to pass
   * anything through.
   */
  error?: string | null;
};

export async function recordCall(db: DB, e: CallEntry): Promise<void> {
  await db.insert(mcpCalls).values({
    orgId: e.orgId, userId: e.userId, clientId: e.clientId ?? null, tool: e.tool, argsSummary: e.argsSummary,
    rows: e.rows, bytes: e.bytes, durationMs: e.durationMs, revealContacts: e.revealContacts ?? false,
    error: e.error ? e.error.slice(0, ERROR_MAX_CHARS) : null,
  });
}

async function countSince(db: DB, where: ReturnType<typeof and>): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(mcpCalls).where(where);
  return Number(row?.n ?? 0);
}

export async function checkRateLimit(db: DB, k: { orgId: string; userId: string; tool: string }):
  Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number; reason: string }> {
  const minuteAgo = new Date(Date.now() - 60_000);
  const hourAgo = new Date(Date.now() - 3_600_000);
  const user = await countSince(db, and(eq(mcpCalls.userId, k.userId), gt(mcpCalls.at, minuteAgo)));
  if (user >= USER_PER_MINUTE) return { allowed: false, retryAfterSeconds: 60, reason: `You have made ${user} requests in the last minute; the limit is ${USER_PER_MINUTE}. Try again in a minute.` };
  if (!k.orgId) return { allowed: true }; // pre-workspace tools: no workspace to count against
  const org = await countSince(db, and(eq(mcpCalls.orgId, k.orgId), gt(mcpCalls.at, hourAgo)));
  if (org >= ORG_PER_HOUR) return { allowed: false, retryAfterSeconds: 600, reason: `This workspace has made ${org} assistant requests in the last hour; the limit is ${ORG_PER_HOUR}. Try again later.` };
  return { allowed: true };
}

export type McpPruneResult = { inspected: boolean; callsPastRetention: number; bindingsExpired: number; callsDeleted: number; bindingsDeleted: number; skipped?: boolean };

/**
 * A zero result flagged `skipped: true` — exported so sync.ts's own
 * `MCP_ENABLED` gate (the step never calling `pruneMcpTables` at all) and
 * this function's belt-and-braces catch below (a table missing anyway)
 * report the EXACT same shape, rather than sync.ts hand-rolling its own
 * literal that could drift from this one.
 */
export function skippedResult(inspect: boolean | undefined): McpPruneResult {
  return { inspected: Boolean(inspect), callsPastRetention: 0, bindingsExpired: 0, callsDeleted: 0, bindingsDeleted: 0, skipped: true };
}

/**
 * Postgres' "undefined_table" (SQLSTATE 42P01), however the driver hands it
 * back: a direct `pg` client puts the code on the error itself, but the http
 * driver some deployments use wraps the original error under `.cause` and can
 * lose the code along the way — so the message text is checked too, but
 * narrowly: `/relation .* does not exist/i`, never a bare `/does not exist/i`,
 * which would also match "column ... does not exist" or "function ... does
 * not exist" — a real query bug wearing the same words, silently reported as
 * "not migrated yet" instead of surfacing as the bug it is.
 */
function isUndefinedTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  if (err.code === "42P01" || err.cause?.code === "42P01") return true;
  const message = `${typeof err.message === "string" ? err.message : ""} ${typeof err.cause?.message === "string" ? err.cause.message : ""}`;
  return /relation .* does not exist/i.test(message);
}

/**
 * Nightly retention for the two MCP tables that grow: calls past 90 days and
 * bindings past their token's expiry. Honours the same `STORAGE_PRUNE_LIVE`
 * inspect gate as pruneOperationalTables — inspect = count, delete nothing —
 * and removes one bounded batch per table per night.
 *
 * Belt and braces alongside sync.ts's `MCP_ENABLED` gate: if either table is
 * somehow missing anyway (0031 not yet pasted, a gate this function cannot
 * see was bypassed), the two `count(*)` probes below would be the first
 * queries to hit that — so ONLY they run inside the catch. If they succeed,
 * the tables exist, and the deletes that follow run OUTSIDE the catch: a
 * failure there is a real bug (a lock timeout, a constraint, anything else),
 * and must propagate and fail the step rather than being reported as a
 * quiet, misleading "skipped" zero result.
 */
export async function pruneMcpTables(db: DB, opts: { inspect?: boolean; now?: Date } = {}): Promise<McpPruneResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - MCP_CALLS_RETENTION_DAYS * 86_400_000);
  const callsWhere = lt(mcpCalls.at, cutoff);
  const bindingsWhere = lt(mcpBindings.expiresAt, now);
  let calls: { n: number } | undefined;
  let bindings: { n: number } | undefined;
  try {
    const counted = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(mcpCalls).where(callsWhere),
      db.select({ n: sql<number>`count(*)::int` }).from(mcpBindings).where(bindingsWhere),
    ]);
    [[calls], [bindings]] = counted;
  } catch (e) {
    if (!isUndefinedTableError(e)) throw e;
    console.warn("[mcp] prune skipped: tables not migrated yet");
    return skippedResult(opts.inspect);
  }
  const out: McpPruneResult = { inspected: Boolean(opts.inspect), callsPastRetention: Number(calls?.n ?? 0), bindingsExpired: Number(bindings?.n ?? 0), callsDeleted: 0, bindingsDeleted: 0 };
  if (out.inspected) return out;
  const ids = await db.select({ id: mcpCalls.id }).from(mcpCalls).where(callsWhere).limit(MCP_PRUNE_BATCH);
  if (ids.length) out.callsDeleted = (await db.delete(mcpCalls).where(inArray(mcpCalls.id, ids.map((r) => r.id))).returning({ id: mcpCalls.id })).length;
  const keys = await db.select({ k: mcpBindings.bindingKey }).from(mcpBindings).where(bindingsWhere).limit(MCP_PRUNE_BATCH);
  if (keys.length) out.bindingsDeleted = (await db.delete(mcpBindings).where(inArray(mcpBindings.bindingKey, keys.map((r) => r.k))).returning({ k: mcpBindings.bindingKey })).length;
  return out;
}
