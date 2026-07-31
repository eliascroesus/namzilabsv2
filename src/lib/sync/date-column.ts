import { and, eq } from "drizzle-orm";
import { sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * The date-column setting for a sheet-like stream: reading it, writing it, and
 * saying in one voice what it is currently doing.
 *
 * Kept together because the honesty rule only holds if every surface says the
 * same thing. The node, the Test panel and the connection page all render
 * {@link dateColumnNote}, so a stream cannot report "dating rows from Submitted
 * at" in one place and "using import time" in another.
 *
 * The DETECTOR is not here — it lives in `normalize-dates.ts` beside the parser
 * it validates with, and it runs in the connector, which is the only place that
 * has both the header row and the values. This module is about the SETTING.
 */

export type DateFieldState = NonNullable<typeof sourceStreams.$inferSelect.dateFieldState>;

/**
 * What the picker can say. Three answers, not two.
 *
 * "auto" and "none" both leave `date_field` NULL and mean opposite things — find
 * a column for me, versus stop looking. Collapsing them is exactly the bug this
 * feature fixes, so the type refuses to.
 */
export type DateColumnChoice = { kind: "auto" } | { kind: "none" } | { kind: "column"; column: string };

export type DateColumnSettings = {
  /** The user's explicit column, or null for "auto" and for "no column". */
  dateField: string | null;
  /** Whether a human has answered at all. False means the sweep may detect one. */
  locked: boolean;
  /** What the last read actually did, including what it detected. */
  state: DateFieldState | null;
  /**
   * A change is waiting for the sweep that will restamp the rows already stored.
   * Optional because the note reads the same without it — one sentence gains a
   * clause, nothing else branches.
   */
  restampPending?: boolean;
};

/** The stream's current setting and what the last read did about a row's time. */
export async function dateColumnSettings(
  db: DB,
  orgId: string,
  connectionId: string,
  configHash: string,
): Promise<DateColumnSettings | null> {
  const [row] = await db
    .select({
      dateField: sourceStreams.dateField,
      locked: sourceStreams.dateFieldLocked,
      state: sourceStreams.dateFieldState,
      restampRequestedAt: sourceStreams.restampRequestedAt,
    })
    .from(sourceStreams)
    .where(
      and(eq(sourceStreams.orgId, orgId), eq(sourceStreams.connectionId, connectionId), eq(sourceStreams.configHash, configHash)),
    )
    .limit(1);
  if (!row) return null;
  return { dateField: row.dateField, locked: row.locked, state: row.state, restampPending: row.restampRequestedAt != null };
}

/** The stored setting as the three-way answer the picker speaks in. */
export function dateColumnChoice(settings: DateColumnSettings | null): DateColumnChoice {
  if (!settings || !settings.locked) return { kind: "auto" };
  return settings.dateField ? { kind: "column", column: settings.dateField } : { kind: "none" };
}

/**
 * Answer the date-column question for this STREAM.
 *
 * Org-scoped, like every write in this codebase: the connection id and config
 * hash reaching here come from a flow graph, which is content rather than a
 * validated key.
 *
 * `locked` is what an answer MEANS. A stream nobody has answered for gets a
 * detected column; one that has been answered keeps the answer, including when
 * the answer is "use import time" — otherwise the detector would overrule a
 * deliberate choice on the next sweep and there would be no way to say no.
 * "auto" clears it back, because an override with no way back is a one-way door.
 *
 * Returns whether anything changed, because an unchanged answer must not look
 * like a reason to re-read a settled sheet.
 */
export async function setDateColumn(
  db: DB,
  orgId: string,
  connectionId: string,
  configHash: string,
  choice: DateColumnChoice,
): Promise<{ changed: boolean }> {
  const next = choice.kind === "column" && choice.column.trim() !== "" ? choice.column : null;
  const locked = choice.kind !== "auto";
  // The no-op check, and ONLY that: re-picking the current answer must not look
  // like a reason to re-read a settled sheet.
  const current = await dateColumnSettings(db, orgId, connectionId, configHash);
  if (current && current.dateField === next && current.locked === locked) return { changed: false };

  // The WRITE is the single authority on whether anything happened, including
  // whether this org owns the stream at all. Answering that from the read above
  // instead would leave this predicate unreachable — defence that cannot be
  // tested, and that quietly stops existing the day someone simplifies the read.
  // A real change asks for a restamp, in the same statement that makes the
  // change. `preserveOccurredAt` pins `occurred_at` on conflict, so without this
  // the answer only ever fixes rows that arrive LATER — and the person who
  // notices that every sheet metric is measuring import time is exactly the
  // person the correction would silently fail for. A timestamp rather than a
  // flag, because the sweep clears it by COMPARING: a second change made while
  // this one is being acted on must not be swallowed by the clear.
  const rows = await db
    .update(sourceStreams)
    .set({ dateField: next, dateFieldLocked: locked, restampRequestedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(sourceStreams.orgId, orgId), eq(sourceStreams.connectionId, connectionId), eq(sourceStreams.configHash, configHash)),
    )
    .returning({ id: sourceStreams.id });
  return { changed: rows.length > 0 };
}

/** `"A", "B" and "C"` — a list a person reads, not an array printed. */
function nameList(names: readonly string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * The one sentence, everywhere.
 *
 * First-seen is a defensible answer — a spreadsheet row genuinely has no
 * timestamp of its own — and first-seen presented AS the event time is not. So
 * no state here is silence: each one says which it is.
 *
 * A DETECTED column says it was detected. That is the price of using a guess
 * instead of merely offering one: it has to announce itself, or a wrong guess
 * becomes indistinguishable from a fact and stops being fixable.
 *
 * The renamed-column case is called out separately from "nothing parsed",
 * because they read identically in the numbers and need different fixes: one is
 * "rename it back or re-pick", the other is "those values are not dates".
 */
export function dateColumnNote(settings: DateColumnSettings | null): string {
  const dateField = settings?.dateField ?? null;
  const locked = settings?.locked ?? false;
  const state = settings?.state ?? null;
  // Rows already stored still hold whatever the PREVIOUS answer gave them, and
  // the sweep that fixes them has not run. Saying so is the same rule as the
  // rest of this function: the gap between what was chosen and what is stored is
  // exactly the interval a user would otherwise mistake for a broken picker.
  const pending = settings?.restampPending === true;
  // A state written before detection existed has no `source`; it was a user's
  // pick, because nothing else could write one then.
  const detected = state != null && state.source === "detected";

  // THE AMBIGUOUS CASE, and the only one that asks the user for anything.
  // Several columns hold real dates, so picking one would be a coin toss nobody
  // can see. Named, so the question can be answered rather than puzzled over.
  if (state?.candidates && state.candidates.length > 1) {
    return `More than one column could be the date — ${nameList(state.candidates)}. Choose one; until then timing uses when each row was first imported.`;
  }

  if (!locked && detected && state.column) {
    const base = `Dating rows from "${state.column}" (detected)`;
    if (state.undated > 0) {
      const total = state.dated + state.undated;
      return `${base} — ${state.undated} of ${total} rows have no usable date there and fall back to when they were first imported.`;
    }
    return `${base}.`;
  }

  if (!dateField) {
    if (!locked) {
      // Auto, and the read found nothing to date from. Not silence: this is the
      // state a user would otherwise read as the feature being broken.
      if (state) return "No column in this sheet holds usable dates — timing uses when each row was first imported.";
      return "Timing uses when each row was first imported, until a read finds a date column.";
    }
    return pending
      ? "No date column selected — from the next read, timing goes back to when each row was first imported."
      : "No date column selected — timing uses when each row was first imported.";
  }

  if (state && state.column === dateField && !state.presentInHeader) {
    return `The column "${dateField}" is no longer in this sheet — timing has fallen back to when each row was first imported.`;
  }
  if (!state || state.column !== dateField) {
    // Chosen, but no read has happened under it yet. Do not imply it worked.
    return pending
      ? `Timing will use "${dateField}" from the next read, including rows already imported.`
      : `Timing will use "${dateField}" from the next read.`;
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
