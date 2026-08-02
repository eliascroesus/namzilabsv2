/**
 * Will this run finish before the CI runner kills the job?
 *
 * WHY THIS EXISTS. `verify-calendly.ts` CL11 answers "how long does a Calendly
 * `page_token` live?" the only way that question can be answered: sleep, then
 * retry the token. And the sleep has to be long to mean anything — `calendly.ts`
 * reads `token_in` from the PERSISTED cursor and reuses it on the *next* sweep,
 * ~600s later at base cadence and up to 3600s on the widened webhook backstop.
 * A convenient 60s wait measures a gap the connector never actually takes.
 *
 * So the script is deliberately capable of sleeping for an hour. Which means it
 * is also capable of being killed at the runner's job ceiling — and a job killed
 * at the ceiling does not produce a partial report. It produces NO report: every
 * check that already passed is thrown away along with the one that was sleeping,
 * and the only thing the operator learns is that they waited an hour for nothing.
 *
 * Hence: do the arithmetic BEFORE the first request, and refuse to start a run
 * that cannot finish, naming the term that ran out.
 *
 * THE ALLOWANCES ARE DELIBERATELY GENEROUS, and the asymmetry is the reason.
 * Over-estimating how long the work takes makes this refuse a run that would
 * actually have fit — annoying, corrected in one dispatch. Under-estimating
 * approves a run that dies at minute 59. Only one of those is cheap to undo.
 */

export type JobBudgetInputs = {
  /** Seconds the caller intends to spend deliberately asleep. */
  waitSeconds: number;
  /** Seconds to allow for the caller's own requests — everything that is not a sleep. */
  workSeconds: number;
  /**
   * Seconds to leave for whatever runs AFTER the caller in the same job.
   *
   * Not optional bookkeeping: the verify workflow runs four provider steps in
   * one job, so a Calendly step that fits perfectly can still push the Instantly
   * step past the ceiling. The step that sleeps is the one that has to account
   * for the steps it delays.
   */
  reserveSeconds: number;
  /** Wall-clock seconds the job has already burned before this check. */
  elapsedSeconds: number;
  /** The runner's per-job ceiling in seconds, or `null` when not running under one. */
  ceilingSeconds: number | null;
  /**
   * False when a ceiling was declared but the job's start time was not, so
   * `elapsedSeconds` is an assumption rather than a measurement. Reported rather
   * than hidden — an optimistic guard that does not say it is being optimistic
   * is worse than no guard.
   */
  elapsedKnown?: boolean;
};

export type JobBudget = {
  fits: boolean;
  /** wait + work + reserve. */
  needSeconds: number;
  /** ceiling − elapsed, or `null` when there is no ceiling. */
  remainingSeconds: number | null;
  /** The whole sum spelled out, so a refusal carries its own reason. */
  explain: string;
};

const nonNegative = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function jobBudget(i: JobBudgetInputs): JobBudget {
  const wait = nonNegative(i.waitSeconds);
  const work = nonNegative(i.workSeconds);
  const reserve = nonNegative(i.reserveSeconds);
  const need = wait + work + reserve;
  const terms = `${wait}s of sleeps + ${work}s for this script's own requests + ${reserve}s reserved for later steps in the same job`;

  if (i.ceilingSeconds == null || !Number.isFinite(i.ceilingSeconds) || i.ceilingSeconds <= 0) {
    return {
      fits: true,
      needSeconds: need,
      remainingSeconds: null,
      explain: `needs ${need}s (${terms}); no job ceiling declared, so nothing is going to cut this run short`,
    };
  }

  const ceiling = Math.floor(i.ceilingSeconds);
  const elapsed = nonNegative(i.elapsedSeconds);
  const remaining = ceiling - elapsed;
  const assumed =
    i.elapsedKnown === false
      ? ", ASSUMED — the job's start time was not passed in, so this figure is optimistic by however long setup took"
      : "";

  return {
    fits: need <= remaining,
    needSeconds: need,
    remainingSeconds: remaining,
    explain: `needs ${need}s (${terms}); ${remaining}s left of a ${ceiling}s job ceiling (${elapsed}s already elapsed${assumed})`,
  };
}

/**
 * "600" / "60,540" → the seconds to sleep, in order, plus whatever was thrown out.
 *
 * Rejected entries are RETURNED, not coerced. The obvious implementation —
 * `Math.max(1, Number(x) || 0)` — turns `"ten minutes"` into a one-second wait
 * and reports a token lifetime of 1s, which is a measurement of nothing wearing
 * the costume of a measurement. An unusable value has to be visible.
 *
 * An empty list is a legitimate answer, and the caller is expected to skip
 * rather than substitute a default: silently running the 60s test when the
 * operator asked for 600 produces an answer to a question nobody asked.
 */
export function parseWaitSeconds(raw: string): { seconds: number[]; rejected: string[] } {
  const seconds: number[] = [];
  const rejected: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "") continue;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) {
      rejected.push(t);
      continue;
    }
    seconds.push(Math.floor(n));
  }
  return { seconds, rejected };
}
