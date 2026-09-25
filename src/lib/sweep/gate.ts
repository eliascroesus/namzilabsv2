import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import { getDb } from "@/db/client";
import { nextWakeMs } from "./next-wake";
import { SWEEP_WAKE_TAG } from "./wake";

/**
 * SHOULD THIS TICK TOUCH THE DATABASE AT ALL?
 *
 * The two ten-minute crons (`reconcile-connections`, `materialize-stale`) ask
 * this before anything else. The answer comes from Next's data cache — which
 * is not Neon — so a tick with nothing due costs no database time, and the
 * compute can sleep between real work instead of being woken 144 times a day
 * to be told "nothing yet".
 *
 * ═══ WHY NOTHING IS EVER LATER THAN BEFORE ═══
 *
 * The cached value is the earliest moment either cron would find work
 * (`next-wake.ts`). Until then there is, by construction, nothing for them to
 * do; from that moment the ticks run exactly as they always did, on the same
 * ten-minute schedule. Every write that could move work EARLIER clears the
 * cache (`wakeSweeper`), so the next tick recomputes — work a write creates is
 * picked up by the next tick, as it always was.
 *
 * ═══ THE STAMP, AND WHY A PLAIN CACHED VALUE WAS NOT ENOUGH ═══
 *
 * Next writes a freshly computed value in the background — the call returns
 * without waiting for the store (`unstable_cache` parks it in
 * `pendingRevalidates`) — and a tag invalidation only expires entries stored
 * BEFORE it. So a write landing between the gate's query and that store would
 * be announced to an entry that did not exist yet, and the value stored a
 * moment later, from before the write, would look current until the ceiling
 * below. The window is milliseconds; it is still a window.
 *
 * So the answer is keyed by a STAMP: a random id, minted lazily on the first
 * read after any invalidation, carrying the same tag. The rule that closes
 * the gap: an answer is only ever CACHED under a stamp that was stored by an
 * EARLIER request. Then any write after that store expires the stamp; the next
 * read mints a new one; the new stamp is a new key; and the answer is
 * recomputed from a database that already holds the write.
 *
 * A call that had to mint the stamp itself reads the database directly and
 * caches nothing. If work is due it says so — running a tick is never the
 * risky direction, and after activity it is usually the answer. Only a "not
 * yet" is held back as "settling": the cron waits a few seconds and asks
 * again, by which time the stamp is stored and the answer can be cached.
 *
 * FIFTEEN MINUTES IS A CEILING, not the mechanism. A write whose wake never
 * reached this cache — a script run outside Next, a local dev server pointed
 * at the production database, a manual fix in the Neon console, a failed
 * invalidation on the platform — is still noticed within about half an hour
 * (the entry goes stale, the next tick is served the old answer while it
 * refreshes, the one after reads the new one). It was an hour, which made that
 * bound seventy minutes; the owner's rule is that reliability is not traded for
 * cost, and the difference is a few dollars a month.
 *
 * A MINUTE OF MARGIN. Work due within the next minute counts as due now. The
 * gate reads its clock before the crons' own queries run (they come a step or
 * two later), so a `nextChangeAt` falling in that gap would otherwise slip a
 * tick that the old cron would have caught.
 *
 * FAILS OPEN. A cache or database error answers "due" — the old behaviour —
 * because a broken gate must cost money, never freshness.
 */
export type SweepVerdict = "due" | "idle" | "settling";

/** How long a cached answer is trusted with no wake at all — see the note above. */
const GATE_CEILING_S = 15 * 60;

/** Work due this soon counts as due now — see the note above. */
export const DUE_MARGIN_MS = 60_000;

/** The reads the verdict is made of — injectable so the logic is testable. */
export interface GateReads {
  /** The current stamp, and whether THIS call minted it (a cache miss). */
  stamp(): Promise<{ stamp: string; minted: boolean }>;
  /** The earliest due moment in epoch ms (null: nothing will come due), cached under a stamp. */
  nextWake(stamp: string): Promise<number | null>;
  /** The same, read straight from the database and cached nowhere. */
  nextWakeNow(): Promise<number | null>;
}

/**
 * The production reads, over Next's data cache.
 *
 * `name` keeps entries apart when more than one gate shares a process (a
 * local probe of this mechanism uses a different one). The stamp has NO
 * time-based expiry — only a wake replaces it — and its callback flips
 * `minted` synchronously, before its first await, so even a background
 * stale-while-revalidate refresh of it reports itself.
 */
export function cachedGateReads(compute: () => Promise<number | null>, name: string): GateReads {
  const nextWake = unstable_cache(async (_stamp: string) => compute(), [`${name}-next-wake-v3`], {
    tags: [SWEEP_WAKE_TAG],
    revalidate: GATE_CEILING_S,
  });
  return {
    async stamp() {
      let minted = false;
      const stamp = await unstable_cache(
        async () => {
          minted = true;
          return randomUUID();
        },
        [`${name}-stamp-v1`],
        { tags: [SWEEP_WAKE_TAG] },
      )();
      return { stamp, minted };
    },
    nextWake,
    nextWakeNow: compute,
  };
}

const productionReads = cachedGateReads(() => nextWakeMs(getDb()), "sweep");

export async function sweepVerdict(reads: GateReads = productionReads, now = Date.now()): Promise<SweepVerdict> {
  try {
    // ONE stamp read per request. `unstable_cache` skips the callback when a
    // refresh of the same key is already pending in this request and hands
    // back the stale value — which would report `minted: false` for a stamp
    // that is being replaced. The cron's asks are separate steps, so separate
    // requests.
    const { stamp, minted } = await reads.stamp();
    if (minted) {
      // Stored only when this request ends, so nothing may be cached under it
      // yet: an answer stored now could miss a write that lands before that
      // store. Read directly; act on "due", and hold "not yet" for a re-ask.
      const direct = await reads.nextWakeNow();
      return direct != null && now + DUE_MARGIN_MS >= direct ? "due" : "settling";
    }
    const next = await reads.nextWake(stamp);
    // Nothing anywhere will come due without a write first — and that write
    // wakes the sweeper.
    if (next == null) return "idle";
    return now + DUE_MARGIN_MS >= next ? "due" : "idle";
  } catch (e) {
    console.error("[sweep-gate] could not read the next wake; running the tick", e);
    return "due";
  }
}

/**
 * How long a settling gate waits before asking again: long enough for the
 * stamp minted by the first ask to be stored (a single cache write, finished
 * in milliseconds once the step's request closes), short enough to stay inside
 * the same database wake as the tick.
 */
export const GATE_SETTLE = "3s";

/** The slice of Inngest's `step` the gate needs. */
interface GateStep {
  run(id: string, fn: () => Promise<SweepVerdict>): Promise<SweepVerdict>;
  sleep(id: string, duration: string): Promise<unknown>;
}

/**
 * THE CRON'S FIRST QUESTION: run this tick, or skip it without touching Neon?
 *
 * Each ask is its own step, so a replay of the run sees the verdict the first
 * attempt saw instead of asking again and possibly disagreeing halfway
 * through. A gate still settling after its second ask runs the tick — the old
 * behaviour — rather than waiting a third time.
 */
export async function sweepGateOpen(step: GateStep): Promise<boolean> {
  let verdict = await step.run("gate", () => sweepVerdict());
  if (verdict === "settling") {
    await step.sleep("gate-settle", GATE_SETTLE);
    verdict = await step.run("gate-settled", () => sweepVerdict());
  }
  return verdict !== "idle";
}
