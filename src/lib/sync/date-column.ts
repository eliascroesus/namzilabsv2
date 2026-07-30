import { and, eq } from "drizzle-orm";
import { sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { isDateHintedName } from "@/lib/normalize-dates";

/**
 * The date-column setting for a sheet-like stream: reading it, writing it,
 * suggesting one, and saying in one voice what it is currently doing.
 *
 * Kept together because the honesty rule only holds if every surface says the
 * same thing. The node, the Test panel and the connection page all render
 * {@link dateColumnNote}, so a stream cannot report "dating rows from Submitted
 * at" in one place and "using import time" in another.
 */

export type DateFieldState = NonNullable<typeof sourceStreams.$inferSelect.dateFieldState>;
export type DateColumnSettings = { dateField: string | null; state: DateFieldState | null };

/**
 * Which column to PRE-SELECT, from the sheet's header row.
 *
 * Symmetric with the connector's `firstEmailLike`, which has always scanned
 * headers to find a subject — this is the same idea for a date, using the same
 * name detector the ingest path uses, so the suggestion and the parse agree
 * about what a date-like column is called.
 *
 * A suggestion only. It pre-fills a visible picker and never decides: a wrong
 * guess the user can see and change is fine, and a wrong guess that hides is the
 * defect this whole feature exists to remove. Returns null rather than guessing
 * at random when no header looks like a date.
 */
export function suggestDateColumn(headers: readonly string[]): string | null {
  return headers.find((h) => h.trim() !== "" && isDateHintedName(h)) ?? null;
}

/** The stream's current setting and what the last read did with it. */
export async function dateColumnSettings(
  db: DB,
  orgId: string,
  connectionId: string,
  configHash: string,
): Promise<DateColumnSettings | null> {
  const [row] = await db
    .select({ dateField: sourceStreams.dateField, state: sourceStreams.dateFieldState })
    .from(sourceStreams)
    .where(
      and(eq(sourceStreams.orgId, orgId), eq(sourceStreams.connectionId, connectionId), eq(sourceStreams.configHash, configHash)),
    )
    .limit(1);
  return row ? { dateField: row.dateField, state: row.state } : null;
}

/**
 * Nominate the column that holds a row's event time, for this STREAM.
 *
 * Org-scoped, like every write in this codebase: the connection id and config
 * hash reaching here come from a flow graph, which is content rather than a
 * validated key.
 *
 * Returns whether anything changed, because an unchanged pick must not look like
 * a reason to re-read a settled sheet.
 */
export async function setDateColumn(
  db: DB,
  orgId: string,
  connectionId: string,
  configHash: string,
  column: string | null,
): Promise<{ changed: boolean }> {
  const next = column && column.trim() !== "" ? column : null;
  // The no-op check, and ONLY that: re-picking the current column must not look
  // like a reason to re-read a settled sheet.
  const current = await dateColumnSettings(db, orgId, connectionId, configHash);
  if (current && current.dateField === next) return { changed: false };

  // The WRITE is the single authority on whether anything happened, including
  // whether this org owns the stream at all. Answering that from the read above
  // instead would leave this predicate unreachable — defence that cannot be
  // tested, and that quietly stops existing the day someone simplifies the read.
  const rows = await db
    .update(sourceStreams)
    .set({ dateField: next, updatedAt: new Date() })
    .where(
      and(eq(sourceStreams.orgId, orgId), eq(sourceStreams.connectionId, connectionId), eq(sourceStreams.configHash, configHash)),
    )
    .returning({ id: sourceStreams.id });
  return { changed: rows.length > 0 };
}

/**
 * The one sentence, everywhere.
 *
 * First-seen is a defensible answer — a spreadsheet row genuinely has no
 * timestamp of its own — and first-seen presented AS the event time is not. So
 * the unset case is not silence: it says which it is.
 *
 * The renamed-column case is called out separately from "nothing parsed",
 * because they read identically in the numbers and need different fixes: one is
 * "rename it back or re-pick", the other is "those values are not dates".
 */
export function dateColumnNote(settings: DateColumnSettings | null): string {
  const dateField = settings?.dateField ?? null;
  const state = settings?.state ?? null;
  if (!dateField) return "No date column selected — timing uses when each row was first imported.";

  if (state && state.column === dateField && !state.presentInHeader) {
    return `The column "${dateField}" is no longer in this sheet — timing has fallen back to when each row was first imported.`;
  }
  if (!state || state.column !== dateField) {
    // Chosen, but no read has happened under it yet. Do not imply it worked.
    return `Timing will use "${dateField}" from the next read.`;
  }
  if (state.dated === 0) {
    return `No row has a usable date in "${dateField}" — timing uses when each row was first imported.`;
  }
  if (state.undated > 0) {
    const total = state.dated + state.undated;
    return `Timing uses "${dateField}" — ${state.undated} of ${total} rows have no usable date there and fall back to when they were first imported.`;
  }
  return `Timing uses "${dateField}".`;
}
