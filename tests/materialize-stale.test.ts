import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { flowResults, flows, flowVersions } from "@/db/schema";
import { materializeStaleAll } from "@/lib/flow/materialize";
import type { DB } from "@/db/types";

/**
 * `materializeStaleAll` — scoped, budgeted, longest-stale first.
 *
 * The debounced recompute (`recomputeStaleFlows`) debounces and serializes PER
 * ORG, but the body it ran was fleet-wide: two orgs' bursts ran two concurrent
 * unlocked passes over every tenant's stale rows. And no pass had a time
 * budget — a fleet's worth of stale flows ran serially inside one 60s step.
 */

const NOW = new Date("2026-07-01T00:00:00Z");
const back = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

/** A published flow whose recompute RUNS (and flips its result off "stale" —
 *  to error, honestly: the graph produces no dashboard tile, which is fine,
 *  what these tests pin is which flows a pass touched). */
async function staleFlow(orgId: string, name: string, computedAt: Date | null) {
  const connId = await seedConnection(db, { orgId, source: "webhook" });
  const graph = {
    nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source: "webhook" } } }],
    edges: [],
    metrics: [],
  };
  const [flow] = await db
    .insert(flows)
    .values({ orgId, name, draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId, version: 1, graph });
  await db.insert(flowResults).values({
    orgId,
    flowId: flow.id,
    version: 1,
    outputNodeId: "o1",
    tile: { name, value: 1 },
    status: "stale",
    computedAt,
  });
  return flow.id;
}

async function statusOf(flowId: string): Promise<string> {
  const [r] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
  return r.status;
}

describe("org scoping", () => {
  it("a scoped pass recomputes ONLY that org's stale flows", async () => {
    const mine = await staleFlow("org_a", "A's flow", back(1));
    const theirs = await staleFlow("org_b", "B's flow", back(1));

    const res = await materializeStaleAll(db, { orgId: "org_a" });

    expect(res.recomputed).toBe(1);
    expect(res.pending).toBe(0);
    expect(await statusOf(mine)).not.toBe("stale");
    // THE regression: the per-org debounced run used to recompute this too.
    expect(await statusOf(theirs)).toBe("stale");
  });

  it("the unscoped backstop still covers every org", async () => {
    const a = await staleFlow("org_a", "A's flow", back(1));
    const b = await staleFlow("org_b", "B's flow", back(1));

    const res = await materializeStaleAll(db);

    expect(res.recomputed).toBe(2);
    expect(await statusOf(a)).not.toBe("stale");
    expect(await statusOf(b)).not.toBe("stale");
  });
});

describe("time budget", () => {
  it("a drained budget stops the pass, reports the tail, and still makes progress", async () => {
    const oldest = await staleFlow("org_a", "longest stale", back(48));
    const newer = await staleFlow("org_a", "newer", back(1));
    const never = await staleFlow("org_a", "never computed", null);

    // Zero budget: the deadline is already past after the FIRST flow — which
    // must still run, because a too-small budget has to degrade to slow
    // progress, never to a stall that looks like a healthy no-op.
    const res = await materializeStaleAll(db, { orgId: "org_a", budgetMs: 0 });

    expect(res.recomputed).toBe(1);
    expect(res.pending).toBe(2);
    // Longest-stale first: NULL computed_at is the most starved of all.
    expect(await statusOf(never)).not.toBe("stale");
    expect(await statusOf(oldest)).toBe("stale");
    expect(await statusOf(newer)).toBe("stale");
  });

  it("the truncated tail is what the next pass starts with", async () => {
    const oldest = await staleFlow("org_a", "longest stale", back(48));
    const newer = await staleFlow("org_a", "newer", back(1));

    await materializeStaleAll(db, { orgId: "org_a", budgetMs: 0 });
    // First pass took `oldest` (48h beats 1h). Second pass must take the tail,
    // not re-sort the survivor behind anything.
    expect(await statusOf(oldest)).not.toBe("stale");
    expect(await statusOf(newer)).toBe("stale");

    const res = await materializeStaleAll(db, { orgId: "org_a", budgetMs: 0 });

    expect(res.recomputed).toBe(1);
    expect(res.pending).toBe(0);
    expect(await statusOf(newer)).not.toBe("stale");
  });

  it("a pass that finishes inside its budget reports no pending work", async () => {
    await staleFlow("org_a", "one", back(1));
    await staleFlow("org_a", "two", back(2));

    const res = await materializeStaleAll(db, { orgId: "org_a" });

    expect(res).toEqual({ recomputed: 2, pending: 0 });
    const remaining = await db
      .select()
      .from(flowResults)
      .where(and(eq(flowResults.orgId, "org_a"), eq(flowResults.status, "stale")));
    expect(remaining).toHaveLength(0);
  });
});
