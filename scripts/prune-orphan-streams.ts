/**
 * Disable synced streams no flow references any more, and optionally retire
 * their rows.
 *
 * Why this exists: a stream is created when a Get data step declares a resource
 * and was never removed when that step changed. Every edit to a stream-identity
 * setting left the previous one behind — still polled every sweep, still
 * spending the connection's per-minute budget on data nobody can read. Calendly
 * made it acute: its meeting type used to be part of that identity, so clicking
 * through the dropdown left a stream per click, each re-walking the same
 * account. Meeting type is a read filter now, which orphans every one of them.
 *
 * Saving a flow prunes automatically from here on (rows kept). This script is
 * for the backlog, and it is the only path that retires the rows.
 *
 *   pnpm tsx scripts/prune-orphan-streams.ts --org=<orgId>              # report
 *   pnpm tsx scripts/prune-orphan-streams.ts --org=<orgId> --apply
 *   pnpm tsx scripts/prune-orphan-streams.ts --org=<orgId> --apply --retire-rows
 *
 * Dry run by default: it prints what it would disable and stops.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, events, sourceStreams } from "@/db/schema";
import { pruneOrphanStreams } from "@/lib/sync/streams";
import { streamRefsOfGraph } from "@/lib/sync/streams";
import { flows, flowVersions } from "@/db/schema";
import { parseGraph } from "@/lib/flow/types";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const orgId = arg("org");
  if (!orgId) {
    console.error("usage: prune-orphan-streams.ts --org=<orgId> [--apply] [--retire-rows]");
    process.exit(1);
  }
  const db = getDb();

  const conns = await db.select({ id: connections.id, source: connections.source }).from(connections).where(eq(connections.orgId, orgId));
  const sourceOf = (id: string) => conns.find((c) => c.id === id)?.source;
  const referenced = new Set<string>();
  const drafts = await db.select({ draftGraph: flows.draftGraph }).from(flows).where(eq(flows.orgId, orgId));
  const versions = await db.select({ graph: flowVersions.graph }).from(flowVersions).where(eq(flowVersions.orgId, orgId));
  for (const raw of [...drafts.map((d) => d.draftGraph), ...versions.map((v) => v.graph)]) {
    try {
      for (const ref of streamRefsOfGraph(parseGraph(raw), sourceOf)) referenced.add(`${ref.connectionId}:${ref.configHash}`);
    } catch {
      // An unparseable graph is not evidence that anything is unused.
    }
  }

  const all = await db
    .select({
      id: sourceStreams.id,
      connectionId: sourceStreams.connectionId,
      configHash: sourceStreams.configHash,
      config: sourceStreams.config,
      status: sourceStreams.status,
    })
    .from(sourceStreams)
    .where(eq(sourceStreams.orgId, orgId));

  const orphans = all.filter((s) => s.status !== "disabled" && !referenced.has(`${s.connectionId}:${s.configHash}`));
  console.log(`${all.length} streams, ${referenced.size} referenced, ${orphans.length} orphaned.\n`);
  for (const s of orphans) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(and(eq(events.connectionId, s.connectionId), eq(events.streamHash, s.configHash), isNull(events.deletedAt)));
    const source = sourceOf(s.connectionId) ?? "?";
    console.log(`  ${source} ${s.configHash}  ${n} live rows  ${JSON.stringify(s.config)}`);
  }

  if (!has("apply")) {
    console.log(`\nDry run. Re-run with --apply${orphans.length ? " (add --retire-rows to soft-delete their rows)" : ""}.`);
    return;
  }
  const res = await pruneOrphanStreams(db, orgId, { retireRows: has("retire-rows") });
  console.log(`\nDisabled ${res.disabled} stream(s); retired ${res.retired} row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
