import { and, eq, inArray } from "drizzle-orm";
import { backfillJobs, connections, sourceStreams, syncState } from "@/db/schema";
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
 * THE RULE THIS FILE EXISTS TO KEEP: only positive evidence may produce
 * "done". Absence of an import is not proof of a finished one — a mirror
 * source never gets a backfill job at all, a stream that has never been
 * polled has no job either, and reading either as "History imported — this
 * is everything" is the strongest claim in the product made on no evidence.
 * Those cases are `unknown`, and `unknown` says nothing.
 *
 * A third case earns a warning rather than silence: an import that ENDED
 * without finishing (row ceiling hit, connection disconnected mid-run,
 * repeated failures). That is not "importing" and definitely not "done".
 *
 * Deliberately NOT built on `connections.syncStatus`: that column is a
 * transient in-flight flag (set to "importing" at the top of every sweep,
 * incremental included, and back to "live" at the end even when the
 * connector reported the window incomplete). It cannot distinguish "first
 * window still paging" from "steady state", which is the entire question.
 */
export type ImportStatus = {
  state: "importing" | "done" | "unknown";
  coverage?: ImportCoverage;
  /** Ready-to-render sentence, or undefined when there is nothing to say. */
  note?: string;
};

const UNKNOWN: ImportStatus = { state: "unknown" };
const DONE: ImportStatus = { state: "done", note: "History imported." };
/** Terminal but incomplete — the honest middle the old version called "done". */
const STOPPED: ImportStatus = {
  state: "unknown",
  note: "History import didn't finish — older records may be missing. Import more history from the connection page.",
};

/** Mid-walk cursors are stored as JSON; a drained one collapses to a date string. */
function cursorSaysImporting(raw: string): boolean {
  if (!raw.startsWith("{")) return false; // bare high-water mark = a window drained
  try {
    const parsed = JSON.parse(raw) as { hw?: unknown };
    return !parsed.hw; // no high-water mark yet ⇒ the FIRST window is still walking
  } catch {
    return false;
  }
}

/**
 * Statuses for many connections in a fixed number of queries — four, whether
 * the workspace has two connections or fifty. The per-connection version
 * below is a thin wrapper, so the integrations list cannot drift into an
 * N+1 by calling the "simple" one in a loop.
 */
export async function connectionImportStatuses(db: DB, orgId: string, connectionIds: string[]): Promise<Map<string, ImportStatus>> {
  const out = new Map<string, ImportStatus>();
  if (connectionIds.length === 0) return out;

  const conns = await db
    .select({ id: connections.id, source: connections.source })
    .from(connections)
    .where(and(eq(connections.orgId, orgId), inArray(connections.id, connectionIds)));
  if (conns.length === 0) return out;

  const streamScoped = conns.filter((c) => isStreamScoped(c.source));
  const connScoped = conns.filter((c) => !isStreamScoped(c.source));

  if (streamScoped.length > 0) {
    const ids = streamScoped.map((c) => c.id);
    const streams = await db
      .select({ connectionId: sourceStreams.connectionId, configHash: sourceStreams.configHash })
      .from(sourceStreams)
      .where(and(eq(sourceStreams.orgId, orgId), inArray(sourceStreams.connectionId, ids)));
    const open = await importProgressByStreamRef(db, orgId, streams);
    const jobs = await db
      .select({ connectionId: backfillJobs.connectionId, status: backfillJobs.status })
      .from(backfillJobs)
      .where(and(eq(backfillJobs.orgId, orgId), inArray(backfillJobs.connectionId, ids)));

    const hashesBy = new Map<string, string[]>();
    for (const s of streams) hashesBy.set(s.connectionId, [...(hashesBy.get(s.connectionId) ?? []), s.configHash]);

    for (const c of streamScoped) {
      // The connection is only as finished as its furthest-behind stream.
      let worst: ImportCoverage | null = null;
      for (const hash of hashesBy.get(c.id) ?? []) {
        const cov = open.get(`${c.id}:${hash}`);
        if (!cov) continue;
        const share = cov.targetMs > 0 ? cov.coveredMs / cov.targetMs : 1;
        const worstShare = worst && worst.targetMs > 0 ? worst.coveredMs / worst.targetMs : 1;
        if (!worst || share < worstShare) worst = cov;
      }
      if (worst) {
        out.set(c.id, { state: "importing", coverage: worst, note: importProgressNote(worst) });
        continue;
      }
      const mine = jobs.filter((j) => j.connectionId === c.id);
      if (mine.length === 0) {
        out.set(c.id, UNKNOWN); // mirrors and never-polled streams — no evidence either way
      } else if (mine.some((j) => j.status === "partial" || j.status === "failed")) {
        out.set(c.id, STOPPED);
      } else if (mine.some((j) => j.status === "complete")) {
        out.set(c.id, DONE);
      } else {
        out.set(c.id, UNKNOWN);
      }
    }
  }

  if (connScoped.length > 0) {
    const ids = connScoped.map((c) => c.id);
    // sync_state is keyed by connection; the org wall is the lookup above.
    const rows = await db
      .select({ connectionId: syncState.connectionId, cursor: syncState.cursor })
      .from(syncState)
      .where(inArray(syncState.connectionId, ids));
    const cursorBy = new Map(rows.map((r) => [r.connectionId, r.cursor]));

    for (const c of connScoped) {
      const raw = cursorBy.get(c.id) ?? null;
      if (!raw) {
        out.set(c.id, UNKNOWN); // never polled is not the same as finished
        continue;
      }
      // Close is the one source whose cursor carries measured coverage.
      const coverage = c.source === "close" ? closeImportProgress(raw) : null;
      if (coverage) {
        out.set(c.id, { state: "importing", coverage, note: importProgressNote(coverage) });
      } else if (cursorSaysImporting(raw)) {
        // Every other paging source stores the same JSON-while-
        // walking shape but no coverage fields: we can say THAT it is still
        // on its first window, just not how far in.
        out.set(c.id, { state: "importing", note: "Still importing history — these numbers can still grow." });
      } else {
        out.set(c.id, DONE);
      }
    }
  }

  return out;
}

export async function connectionImportStatus(db: DB, orgId: string, connectionId: string): Promise<ImportStatus> {
  const map = await connectionImportStatuses(db, orgId, [connectionId]);
  return map.get(connectionId) ?? UNKNOWN;
}
