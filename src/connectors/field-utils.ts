/** Return the first value among `keys` that is a non-empty string. */
export function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Return the first value among `keys` that is a finite number (or numeric string). */
export function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Best-effort date parse; returns null when unparseable. */
/**
 * Parse a DOCUMENTED PROVIDER FIELD. Not for user-shaped JSON.
 *
 * This is `new Date(value)` with a null guard, and it is kept — rather than
 * unified with `normalizeDateValue` — because its callers read fields whose
 * format the provider documents: Calendly's `start_time`, Close's
 * `date_created`, Instantly's `timestamp_created`, Sendblue's four date fields,
 * Calendar's `start.dateTime`. All ISO, all the time.
 *
 * The catch-hook does NOT use it, and that is the point of this comment. Its
 * payloads are arbitrary JSON with no schema, so the shapes below stop being
 * hypothetical, and two answers to "is this a date" on the same value — one per
 * door the data came through — is its own bug.
 *
 * EVERY CLASS WHERE THE TWO DISAGREE, measured rather than recalled. `hinted` is
 * `normalizeDateValue(v, "created_at")`; `plain` is the same with a field name
 * that is not date-like. A blank means "not a date".
 *
 *   input                       new Date()                normalizeDateValue
 *                                                          hinted / plain
 *   --------------------------- ------------------------- ---------------------
 *   AGREE (same instant)
 *   "2026-07-22T10:30:00Z"      2026-07-22T10:30:00Z      same
 *   "2026-07-22T10:30:00+02:00" 2026-07-22T08:30:00Z      same
 *   "2026-07-22 10:30:00"       2026-07-22T10:30:00Z      same
 *   "Tue, 21 Jul 2026 10:30:00 GMT"  2026-07-21T10:30:00Z same
 *   "7/21/2026 14:23:45"        2026-07-21T14:23:45Z      same
 *   "2026-07-22"                2026-07-22T00:00:00Z      "2026-07-22" (same instant)
 *   "7/21/2026"                 2026-07-21T00:00:00Z      "2026-07-21" (same instant)
 *   "Jan 5, 2026" / "5 Jan 2026"  2026-01-05T00:00:00Z    "2026-01-05" (same instant)
 *   "10:30:00"                  —                         —
 *   "2026-13-01"                —                         —
 *   "Q3 2026 revision"          —                         —
 *   ""                          — (guarded)               —
 *
 *   normalizeDateValue READS WHAT new Date CANNOT
 *   "21/07/2026"                —                         2026-07-21
 *   "21.07.2026"                —                         2026-07-21
 *   "20260722"                  —                         2026-07-22 / —
 *   "1750000000"                —                         2025-06-15T15:06:40Z / —
 *   "1750000000000"             —                         2025-06-15T15:06:40Z / —
 *
 *   new Date ACCEPTS WHAT normalizeDateValue REFUSES  ← the dangerous half
 *   "2026-02-30"                2026-03-02T00:00:00Z  ←  —      rolls over SILENTLY
 *   "1799-01-01"                1799-01-01T00:00:00Z     —      outside 1900-2100
 *   "2026"                      2026-01-01T00:00:00Z     —      a year is not a date
 *   "2026-07"                   2026-07-01T00:00:00Z     —      a month is not a date
 *   1750000000 (number)         1970-01-21T06:06:40Z     2025-06-15T15:06:40Z / —
 *                                                        (unreachable here — the
 *                                                        signature is string|null)
 *   null / true                 1970-01-01T00:00:00Z     —
 *                                                        (null is guarded below;
 *                                                        booleans cannot reach it)
 *
 * The last block is why unifying them is a real decision and not a tidy-up:
 * `"2026-02-30"` does not fail under `new Date`, it becomes March 2nd. A
 * provider that ever emits one is currently believed. Everything in the middle
 * block is a strict gain. Nothing in the first block changes.
 *
 * Unify when someone is willing to re-verify the five connectors against that
 * table; until then the split is deliberate and this comment is the boundary.
 */
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A non-empty string, or null. The standard defensive read for provider payloads. */
export function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The value as a plain object, or {} — payload fields are never trusted to be shaped. */
export function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Import coverage for `PollResult.importProgress`: how much of the window a walk
 * has actually ingested, against how much it is aiming at.
 *
 * Shared by every connector that walks history, because the mistake it prevents
 * is one any of them can make. Progress used to be reported as "the oldest
 * record reached, versus the floor" — which measures nothing unless the walk
 * runs newest-first, and says "100%" on the first page of one that does not.
 * Close's Event Log does run newest-first, so that framing happened to be right
 * there; a progress number whose correctness depends on how a provider chose to
 * sort is one nobody can check and the provider can invalidate without telling
 * anyone.
 *
 * Between the oldest and newest thing actually ingested there is no direction to
 * get wrong: the span starts near zero and grows toward the target from
 * whichever end the walk began.
 *
 * Unparseable or absent marks give a covered span of zero — nothing ingested is
 * exactly what "we cannot tell yet" should read as, never as complete.
 */
export function spanCovered(
  oldestSeen: string | null,
  newestSeen: string | null,
  targetFloorMs: number,
  now = Date.now(),
): { coveredMs: number; targetMs: number } {
  return { coveredMs: spanBetween(oldestSeen, newestSeen), targetMs: Math.max(0, now - targetFloorMs) };
}

/**
 * How much time two provider date strings span, or 0 if either is missing or
 * unparseable — which is what "nothing ingested yet" should read as, never as
 * complete.
 */
function spanBetween(oldest: string | null, newest: string | null): number {
  const lo = oldest ? Date.parse(oldest) || 0 : 0;
  const hi = newest ? Date.parse(newest) || 0 : 0;
  return lo > 0 && hi > lo ? hi - lo : 0;
}
