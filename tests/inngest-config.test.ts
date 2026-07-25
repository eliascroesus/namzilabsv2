import { describe, it, expect } from "vitest";
import { reconcileAll, reconcileOne } from "@/inngest/functions/reconcile";
import { processEvent } from "@/inngest/functions/process-event";
import { syncConnection, recomputeStaleFlows, materializeStale } from "@/inngest/functions/sync";

/**
 * The queue-layer SAFETY behavior lives in Inngest function CONFIGURATION:
 * singleton pileup guards, concurrency caps, per-tenant fairness, priority
 * lanes, idempotency and debounce. A refactor that drops one of these fields
 * compiles fine and ships a regression silently — so the load-bearing configs
 * are pinned here, verbatim.
 */

// The SDK exposes the exact options object on every function.
const opts = (fn: unknown) => (fn as { opts: Record<string, unknown> }).opts;

describe("Inngest safety configuration is pinned", () => {
  it("reconcileAll (dispatcher): single-flight cron, never stacked", () => {
    const o = opts(reconcileAll);
    expect(o.id).toBe("reconcile-connections");
    expect(o.concurrency).toEqual({ limit: 1 });
    expect(o.triggers).toEqual([{ cron: "*/10 * * * *" }]);
  });

  it("reconcileOne (worker): singleton skip per connection, global+tenant caps, priority lane", () => {
    const o = opts(reconcileOne);
    expect(o.id).toBe("reconcile-one-connection");
    // Pileup guard: in-flight connection → new sweep events SKIPPED, not queued.
    expect(o.singleton).toEqual({ key: "event.data.connectionId", mode: "skip" });
    // C.3: global worker cap + per-tenant fairness cap.
    expect(o.concurrency).toEqual([{ limit: 10 }, { key: "event.data.orgId", limit: 3 }]);
    // C.5: interactive lanes outrank the sweep.
    expect(o.priority).toEqual({ run: "event.data.priority ?? 0" });
    expect(o.retries).toBe(3);
  });

  it("processEvent: per-raw-event idempotency + per-tenant webhook-storm cap", () => {
    const o = opts(processEvent);
    expect(o.id).toBe("process-inbound-event");
    expect(o.idempotency).toBe("event.data.rawEventId");
    expect(o.concurrency).toEqual({ key: "event.data.orgId ?? ''", limit: 5 });
    expect(o.retries).toBe(5);
  });

  it("syncConnection: user-initiated syncs QUEUE per connection (no singleton skip — a user action must never silently do nothing)", () => {
    const o = opts(syncConnection);
    expect(o.id).toBe("sync-connection");
    expect(o.concurrency).toEqual({ key: "event.data.connectionId", limit: 1 });
    // Deliberately NOT singleton: "sync now" clicked during a running sync
    // waits its turn and runs; only the cron sweep may skip (it re-dispatches
    // every tick). If someone adds singleton here, they must first route user
    // feedback for the skip.
    expect(o.singleton).toBeUndefined();
  });

  it("recomputeStaleFlows: per-org debounce coalesces bursts; serialized per org", () => {
    const o = opts(recomputeStaleFlows);
    expect(o.debounce).toEqual({ key: "event.data.orgId", period: "10s" });
    expect(o.concurrency).toEqual({ key: "event.data.orgId", limit: 1 });
  });

  it("materializeStale backstop cron stays in place", () => {
    const o = opts(materializeStale);
    expect(o.triggers).toEqual([{ cron: "*/10 * * * *" }]);
  });
});
