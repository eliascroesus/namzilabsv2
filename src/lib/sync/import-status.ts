import { and, eq } from "drizzle-orm";
import { connections, sourceStreams, syncState } from "@/db/schema";
import { closeImportProgress } from "@/connectors/close";
import { importProgressByStreamRef } from "@/lib/backfill/jobs";
import { isStreamScoped } from "@/connectors/catalog";
import { importProgressNote } from "@/lib/sync/streams";
import type { ImportCoverage } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * "Is this source still pulling history, and how far has it got?" — answered
 * from STORED STATE ONLY. No provider call, so it is safe to ask on every
 * page render and in a panel that opens constantly.
 *
 * Three states, and the third is the honest one that a naive version gets
 * wrong: `unknown` means we have no evidence either way, and it must say
 * NOTHING rather than claim completion. A connection with no backfill job and
 * no cursor has not "finished importing" — it has never been asked to import.
 *
 * Deliberately NOT built on `connections.syncStatus`: that column is a
 * transient in-flight flag (set to "importing" at the top of every sweep,
 * incremental included, and back to "live" at the end even when the connector
 * reported the window incomplete). It cannot distinguish "first window still
 * paging" from "steady state", which is the entire question here.
 */
export type ImportStatus = {
  state: "importing" | "done" | "unknown";
  coverage?: ImportCoverage;
  /** Ready-to-render sentence, or undefined when there is nothing to say. */
  note?: string;
};

const UNKNOWN: ImportStatus = { state: "unknown" };

export async function connectionImportStatus(db: DB, orgId: string, connectionId: string): Promise<ImportStatus> {
  const [conn] = await db
    .select({ id: connections.id, source: connections.source })
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
    .limit(1);
  if (!conn) return UNKNOWN;

  if (isStreamScoped(conn.source)) {
    // Stream sources import through the backfill lane: an open job IS the
    // import, and its reached/target floors ARE the percentage.
    const streams = await db
      .select({ configHash: sourceStreams.configHash })
      .from(sourceStreams)
      .where(and(eq(sourceStreams.orgId, orgId), eq(sourceStreams.connectionId, connectionId)));
    if (streams.length === 0) return UNKNOWN;
    const progress = await importProgressByStreamRef(
      db,
      orgId,
      streams.map((s) => ({ connectionId, configHash: s.configHash })),
    );
    if (progress.size === 0) return { state: "done", note: "History imported." };
    // Several streams importing at once: report the LEAST covered, because
    // the connection is only as finished as its furthest-behind resource.
    let worst: ImportCoverage | null = null;
    for (const c of progress.values()) {
      const share = c.targetMs > 0 ? c.coveredMs / c.targetMs : 1;
      const worstShare = worst && worst.targetMs > 0 ? worst.coveredMs / worst.targetMs : 1;
      if (!worst || share < worstShare) worst = c;
    }
    return { state: "importing", coverage: worst ?? undefined, note: importProgressNote(worst ?? undefined) };
  }

  // Connection-scoped (Close): the walk's own cursor is the record of it.
  // sync_state is keyed by connection; the org wall is the lookup above.
  const [state] = await db.select({ cursor: syncState.cursor }).from(syncState).where(eq(syncState.connectionId, connectionId)).limit(1);
  const raw = state?.cursor ?? null;
  if (!raw) return UNKNOWN; // never polled — not the same as finished
  const coverage = conn.source === "close" ? closeImportProgress(raw) : null;
  if (coverage) return { state: "importing", coverage, note: importProgressNote(coverage) };
  // A cursor exists and reports no first-window progress ⇒ a window has
  // drained. Sendblue stores no coverage fields, so it lands here too — which
  // is right: a cursor it wrote means it has been reading.
  return { state: "done", note: "History imported." };
}
