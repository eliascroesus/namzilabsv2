import { normalizeDateValue } from "@/lib/normalize-dates";

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
export function parseDate(value: string | null, field = ""): Date | null {
  if (!value) return null;
  const d = new Date(value);
  const parsed = Number.isNaN(d.getTime()) ? null : d;
  observeParse(value, field, parsed);
  return parsed;
}

/**
 * "Documented ISO in practice" is an ASSUMPTION. This turns it into evidence.
 *
 * The table above says where the two parsers differ; it does not say whether any
 * provider has ever actually sent one of those shapes. That question decides
 * whether unifying them is worth the risk, and until now the only way to answer
 * it was to guess — which is the class of guess that has already been wrong four
 * times in this codebase.
 *
 * So every value a provider sends is checked against BOTH, and the
 * disagreements are logged. `parseDate`'s answer is what gets used, always:
 * nothing here changes a single stored timestamp.
 *
 *   loose-accept    `new Date` read it and the strict parser refused. THE ONE
 *                   THAT MATTERS. "2026-02-30" becomes March 2nd, "2026"
 *                   becomes January 1st, "1799-01-01" is outside any range this
 *                   product means. None of them fail; all of them lie.
 *   divergent       both read it and got different instants. Should be
 *                   impossible; if it ever fires, the table is wrong.
 *   strict-only     the strict parser read what `new Date` refused
 *                   ("21/07/2026", epoch strings). A gain not being taken — real
 *                   data currently landing on `new Date()` instead.
 *
 * WHAT SILENCE PROVES, stated honestly because a log line that never appears
 * looks identical to code that never ran: a period with no `[parse-drift]` lines
 * means no value PARSED in that period disagreed. It does not cover a provider
 * that went quiet, and it cannot be counted from here — these run in ephemeral
 * invocations with no shared process to hold a total. Reading it as "confirmed
 * for the traffic we saw" is right; reading it as "confirmed" is not.
 *
 * The field name is passed so the strict parser's numeric gate applies the same
 * way it does at every other call site: without it, every epoch-second string a
 * provider sends would report as a disagreement that only exists because the
 * comparison was set up wrong.
 */
function observeParse(value: string, field: string, loose: Date | null): void {
  const strict = normalizeDateValue(value, field);
  const strictMs = strict ? Date.parse(strict) : NaN;
  const kind = !Number.isFinite(strictMs)
    ? loose
      ? "loose-accept"
      : null
    : loose
      ? loose.getTime() === strictMs
        ? null
        : "divergent"
      : "strict-only";
  if (!kind) return;
  // Same prefix shape as `[mirror-drift]` and `[invariant-scan]`, so one grep
  // covers every "look at this" signal.
  console.warn(
    `[parse-drift] kind=${kind} field=${field || "?"} value=${JSON.stringify(value)} loose=${loose?.toISOString() ?? "null"} strict=${strict ?? "null"}`,
  );
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
