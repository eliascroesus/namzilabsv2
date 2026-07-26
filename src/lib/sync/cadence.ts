import { eq } from "drizzle-orm";
import { connections } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * H.1/H.2 + F.5 — adaptive sweep cadence.
 *
 * The cost model that matters: background work must scale with the DATA-CHANGE
 * RATE, not with how many tenants exist. A connection nobody touches for a
 * month should cost ~nothing, and a connection whose webhook already delivers
 * everything instantly shouldn't be polled on the same schedule as one with no
 * instant path at all.
 *
 * Three inputs, one decision:
 * - **H.1 no-op streak**: consecutive sweeps that found nothing.
 * - **H.2 idle tiers**: the streak maps to a widening interval, and ANY change
 *   (or user activity) resets it to the base cadence immediately.
 * - **F.5 webhook coverage**: when D.6 verified the provider-side subscription
 *   healthy recently, the poll is a BACKSTOP, not the primary path — its floor
 *   widens, because the webhook is already covering the stream in real time.
 *
 * Correctness note: demotion never means "stop". Every tier still polls, so a
 * missed webhook is still reconciled — just later. The rollback windows and
 * full re-syncs are unaffected.
 */

const MINUTE = 60_000;

/** Base cadence — the 10-minute sweep everything starts on. */
export const BASE_INTERVAL_MS = 10 * MINUTE;
/** Tier ladder by consecutive no-op sweeps: 10min → 30min → 2h → 6h → daily. */
const IDLE_TIERS: Array<{ afterNoOps: number; intervalMs: number }> = [
  { afterNoOps: 6, intervalMs: 30 * MINUTE },
  { afterNoOps: 18, intervalMs: 2 * 60 * MINUTE },
  { afterNoOps: 40, intervalMs: 6 * 60 * MINUTE },
  { afterNoOps: 80, intervalMs: 24 * 60 * MINUTE },
];
/** F.5 — a webhook verified healthy within this window covers the stream. */
export const WEBHOOK_FRESH_MS = 2 * 60 * MINUTE;
/** F.5 — the poll floor while a healthy webhook is doing the real-time work. */
export const WEBHOOK_BACKSTOP_INTERVAL_MS = 60 * MINUTE;

export type CadenceInput = {
  /** Did this sweep actually change anything? */
  changed: boolean;
  /** Consecutive no-op sweeps BEFORE this one. */
  previousNoOps: number;
  /** When the provider webhook was last verified healthy (F.5). */
  webhookHealthyAt?: Date | null;
  now?: Date;
};

export type CadenceDecision = {
  intervalMs: number;
  nextSweepAt: Date;
  consecutiveNoOpSweeps: number;
  /** Why this interval — surfaced in tests and useful for support. */
  reason: "changed" | "idle-tier" | "webhook-backstop";
};

/** Pure cadence policy — no I/O, so the rules are directly testable. */
export function decideCadence(input: CadenceInput): CadenceDecision {
  const now = input.now ?? new Date();
  const noOps = input.changed ? 0 : input.previousNoOps + 1;

  // Any change → back to base cadence at once. Responsiveness beats thrift the
  // moment a connection proves it's live.
  if (input.changed) {
    return { intervalMs: BASE_INTERVAL_MS, nextSweepAt: new Date(now.getTime() + BASE_INTERVAL_MS), consecutiveNoOpSweeps: 0, reason: "changed" };
  }

  let intervalMs = BASE_INTERVAL_MS;
  let reason: CadenceDecision["reason"] = "idle-tier";
  for (const tier of IDLE_TIERS) {
    if (noOps >= tier.afterNoOps) intervalMs = tier.intervalMs;
  }

  // F.5: a healthy webhook makes the poll a backstop — widen the floor.
  const healthy = input.webhookHealthyAt != null && now.getTime() - input.webhookHealthyAt.getTime() < WEBHOOK_FRESH_MS;
  if (healthy && intervalMs < WEBHOOK_BACKSTOP_INTERVAL_MS) {
    intervalMs = WEBHOOK_BACKSTOP_INTERVAL_MS;
    reason = "webhook-backstop";
  }

  return { intervalMs, nextSweepAt: new Date(now.getTime() + intervalMs), consecutiveNoOpSweeps: noOps, reason };
}

/** Apply a cadence decision to the connection row. */
export async function applyCadence(
  db: DB,
  connectionId: string,
  decision: CadenceDecision,
  webhookHealthyNow: boolean,
  now = new Date(),
): Promise<void> {
  await db
    .update(connections)
    .set({
      nextSweepAt: decision.nextSweepAt,
      consecutiveNoOpSweeps: decision.consecutiveNoOpSweeps,
      ...(webhookHealthyNow ? { webhookHealthyAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(connections.id, connectionId));
}

/**
 * Promote a connection back to the base cadence NOW — used whenever something
 * proves it's live outside the sweep: an inbound webhook, a user's Test, a
 * manual re-sync, or a freshly configured resource. Idle backoff must never
 * make the product feel slow after a user acts.
 */
export async function promoteToBaseCadence(db: DB, connectionId: string, now = new Date()): Promise<void> {
  await db
    .update(connections)
    .set({ nextSweepAt: now, consecutiveNoOpSweeps: 0, updatedAt: now })
    .where(eq(connections.id, connectionId));
}
