import { and, eq } from "drizzle-orm";
import { connections } from "@/db/schema";
import { getConnector } from "@/connectors/registry";
import { getConnectionCredentials } from "@/lib/credentials";
import { claimCalls, isPaused } from "@/lib/provider-gateway/budget";
import { formatTime } from "@/lib/format";
import { pollOperation } from "@/lib/provider-gateway/operations";
import type { SourceOption } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * Live choices for a Get data step's Configure dropdowns (spreadsheets, tabs,
 * calendars, Close pipelines…), listed straight from the provider with the
 * connection's credentials.
 *
 * Pulled out of the server action so the whole contract is testable over
 * PGlite: the tenant wall, the budget claim, and the gate.
 *
 * Three deliberate properties:
 * - The gate is "does the connector list options", NOT `isStreamScoped`. The
 *   old stream-scope gate silently returned [] for any connection-scoped
 *   source, which is exactly the shape Close's Pipeline picker has (a
 *   readFilter over one shared sync).
 * - One interactive claim per call. These pickers were the one provider-
 *   hitting path with no budget behind them — unledgered and uncounted. A
 *   denial rides the panel's existing free-text degradation instead of
 *   throwing. (Known undercount: a Calendly option walk can spend up to ~11
 *   requests against this claim of 1 — the same claim-per-poll shape the
 *   sweep uses; tightening that is a separate, flagged change.)
 * - Pauses BIND. A 429/breaker pause is the provider's own "stop calling
 *   me", and the claim alone cannot enforce it: paused sweeps leave the
 *   minute's buckets empty, so a claim would happily succeed inside the
 *   cool-off. Checked explicitly, exactly like primeStream/primeConnection.
 */
export async function listSourceOptions(
  db: DB,
  orgId: string,
  connectionId: string,
  key: string,
  config: Record<string, unknown>,
): Promise<{ ok: true; options: SourceOption[] } | { ok: false; error: string }> {
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
    .limit(1);
  if (!conn) return { ok: false, error: "Connection not found." };
  const connector = getConnector(conn.source);
  if (!connector?.listOptions) return { ok: true, options: [] };
  // The pause is the provider's own "stop calling me" (429 / breaker), and it
  // binds EVERY provider-hitting path — the budget claim below can't cover
  // this, because paused sweeps leave the minute's buckets empty. Same check
  // primeStream and primeConnection make before their claims.
  if (isPaused(conn)) {
    const when = conn.pausedUntil ? ` — it retries around ${formatTime(conn.pausedUntil)}` : "";
    return { ok: false, error: `Syncing is paused (${conn.pausedReason ?? "provider limit"})${when}. Type the value manually or try again shortly.` };
  }
  const operation = connector.listOperationFor?.(key) ?? pollOperation(conn.source, config);
  const claim = await claimCalls(db, conn, operation, 1, new Date(), "interactive");
  if (!claim.allowed) return { ok: false, error: claim.reason };
  const credentials = await getConnectionCredentials(db, conn);
  const options = await connector.listOptions(key, { connectionId, credentials, config });
  return { ok: true, options };
}
