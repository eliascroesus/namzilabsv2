import { z } from "zod";
import { eq } from "drizzle-orm";
import { connections } from "@/db/schema";
import { connectionImportStatuses } from "@/lib/sync/import-status";
import { unresolvedDeadLetterCountsByConnection } from "@/lib/dead-letter";
import { withToolContext } from "@/lib/mcp/context";
import { describe, ok } from "@/lib/mcp/result";

/**
 * `list_sources` — the connected apps feeding this workspace, WITHOUT ever
 * touching `listConnections`: that helper's row carries
 * `credentialsEncrypted` / `signingSecretEncrypted`, and an assistant-facing
 * tool must never have those columns in scope to leak, truncate or log by
 * accident. This selects exactly the columns a caller may see.
 *
 * Gated on BOTH `use_ai_assistants` (may this person use an assistant at
 * all) AND `view_integrations` (may they see data sources) — the spec's
 * narrower gate for a tool that names connections, sync state and errors,
 * one step closer to raw provider data than a metric headline is.
 */
export const listSourcesTool = {
  name: "list_sources",
  title: "List data sources",
  description: describe(
    "Lists the connected apps feeding this workspace with their sync state, last activity, pauses, errors, import progress and unresolved failed deliveries — use it to answer whether the data behind a number is current.",
  ),
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({}).passthrough(),
  handler: withToolContext<Record<string, never>>("list_sources", { permissions: ["use_ai_assistants", "view_integrations"] }, async (ctx) => {
    const rows = await ctx.db
      .select({
        id: connections.id,
        name: connections.name,
        source: connections.source,
        status: connections.status,
        syncStatus: connections.syncStatus,
        lastEventAt: connections.lastEventAt,
        pausedUntil: connections.pausedUntil,
        pausedReason: connections.pausedReason,
        lastError: connections.lastError,
      })
      .from(connections)
      .where(eq(connections.orgId, ctx.orgId));
    const [imports, dlq] = await Promise.all([
      connectionImportStatuses(ctx.db, ctx.orgId, rows.map((r) => r.id)),
      unresolvedDeadLetterCountsByConnection(ctx.db, ctx.orgId),
    ]);
    const dlqBy = new Map(dlq.map((d) => [d.connectionId, d.count]));
    return ok({
      workspace: { id: ctx.orgId, name: ctx.workspaceName },
      asOf: new Date().toISOString(),
      rows: rows.length,
      sources: rows.map((r) => ({
        ...r,
        lastEventAt: r.lastEventAt?.toISOString() ?? null,
        pausedUntil: r.pausedUntil?.toISOString() ?? null,
        import: imports.get(r.id) ?? null,
        deadLetters: dlqBy.get(r.id) ?? 0,
      })),
    });
  }),
};
