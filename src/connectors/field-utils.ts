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
 * runs newest-first. Close's Event Log runs OLDEST-first, so its first page
 * landed on the floor and the note claimed the whole window while holding a
 * handful of events.
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
 * unparseable — which is what "nothing ingested yet" should read as.
 *
 * Separate from {@link spanCovered} because a walk that covers its window in
 * more than one pass needs the numerator on its own: Close opens a first sync on
 * a shallow rung and steps out to the full target, so it banks the largest span
 * any rung reached rather than reporting one against a target directly.
 */
export function spanBetween(oldest: string | null, newest: string | null): number {
  const lo = oldest ? Date.parse(oldest) || 0 : 0;
  const hi = newest ? Date.parse(newest) || 0 : 0;
  return lo > 0 && hi > lo ? hi - lo : 0;
}
