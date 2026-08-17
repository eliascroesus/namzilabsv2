import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, events, flowResults, flows, flowVersions } from "@/db/schema";
import { expireAgedResults, materializeFlow, materializeStaleAll } from "@/lib/flow/materialize";
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

describe("age-based expiry (the clock is a data source too)", () => {
  /**
   * A "last 7 days" tile changes at midnight with zero new records — data-
   * driven staleness alone freezes it at its last data change forever.
   * Sabotage: drop expireAgedResults from the cron and a sliding-window tile
   * never recomputes again on a quiet source, "fresh" badge and all.
   */
  const setStatus = async (flowId: string, status: string) => {
    await db.update(flowResults).set({ status }).where(eq(flowResults.flowId, flowId));
  };

  it("scopes to one org when a per-tenant caller asks — the sweep must not write other tenants' rows", async () => {
    // The sweep calls this per connection, so an unscoped update would have
    // one org's ten-minute tick rewriting every other tenant's results.
    const mine = await staleFlow("org_a", "mine", back(2));
    const theirs = await staleFlow("org_b", "theirs", back(2));
    await setStatus(mine, "fresh");
    await setStatus(theirs, "fresh");

    expect(await expireAgedResults(db, 3_600_000, "org_a")).toBe(1);
    expect(await statusOf(mine)).toBe("stale");
    expect(await statusOf(theirs)).toBe("fresh");
  });

  it("re-marks fresh results older than the ceiling; leaves recent, stale and error rows alone", async () => {
    const aged = await staleFlow("org_a", "aged", back(2));
    const recent = await staleFlow("org_a", "recent", new Date());
    const erred = await staleFlow("org_a", "erred", back(3));
    await setStatus(aged, "fresh");
    await setStatus(recent, "fresh");
    await setStatus(erred, "error");

    const expired = await expireAgedResults(db, 3_600_000);

    expect(expired).toBe(1);
    expect(await statusOf(aged)).toBe("stale");
    // A fresh, recent number is left exactly as it is…
    expect(await statusOf(recent)).toBe("fresh");
    // …and an error row is never put on a timer: recomputing a known-broken
    // flow every pass would re-run the same failure forever.
    expect(await statusOf(erred)).toBe("error");
  });

  it("what it expires, the next pass recomputes — the full hourly loop", async () => {
    const aged = await staleFlow("org_a", "aged", back(2));
    await setStatus(aged, "fresh");
    await expireAgedResults(db, 3_600_000);
    await materializeStaleAll(db, { orgId: "org_a" });
    // The harness flow recomputes to "error" (no tile) — the pin is that the
    // pass PICKED IT UP, i.e. it is no longer parked at fresh-but-ancient.
    expect(await statusOf(aged)).not.toBe("fresh");
    expect(await statusOf(aged)).not.toBe("stale");
  });

  /**
   * THE CROSSING, not the timer. A tile stores `nextChangeAt` — the earliest
   * moment its numbers can move without new data (a record leaving a rolling
   * window, a future-dated one reaching "Today", or midnight). Expiry follows
   * that moment: a tile whose crossing has passed recomputes even though it
   * was computed seconds ago, and a tile whose crossing is hours away sits
   * still. REVERT TO THE BLANKET TIMER AND THE SECOND ASSERTION FLIPS — every
   * fresh tile re-read its flow's whole history 144 times a day against a
   * database that bills every byte it sends.
   */
  it("expires a tile whose own crossing has arrived, and only that tile", async () => {
    const crossed = await staleFlow("org_a", "crossed", new Date());
    const parked = await staleFlow("org_a", "parked", new Date());
    const setNext = async (flowId: string, iso: string) => {
      const [r] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
      await db
        .update(flowResults)
        .set({ tile: { ...(r.tile as Record<string, unknown>), nextChangeAt: iso }, status: "fresh" })
        .where(eq(flowResults.flowId, flowId));
    };
    // Both computed NOW — the timer alone would keep both fresh.
    await setNext(crossed, new Date(Date.now() - 60_000).toISOString());
    await setNext(parked, new Date(Date.now() + 3_600_000).toISOString());

    expect(await expireAgedResults(db, 3_600_000)).toBe(1);
    expect(await statusOf(crossed)).toBe("stale");
    expect(await statusOf(parked)).toBe("fresh");
  });
});

/**
 * THE RANGE PILLS, which for their whole life sat above tiles they could not
 * touch. A published tile is a stored snapshot computed from the flow's own
 * definition, and `publishedFlowTiles` never took a range — so "Today" and
 * "Last 90 days" rendered the identical number. Reported as "the time thing
 * doesn't work at all", and it didn't.
 */
describe("a published tile carries one value per dashboard range", () => {
  const CONN = "11111111-1111-4111-8111-111111111111";

  async function publishCountFlow(orgId: string) {
    await db.insert(connections).values({ id: CONN, orgId, source: "webhook", name: "Hook", status: "active", authType: "none" });
    const graph = {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN, source: "webhook" } } },
        { id: "c", type: "formula", data: { config: { op: "count" } } },
      ],
      edges: [{ id: "e", source: "a", target: "c" }],
      metrics: [{ nodeId: "c", enabled: true, name: "Events", viz: "number", format: "number", precision: 0 }],
    };
    const [flow] = await db.insert(flows).values({ orgId, name: "counter", draftGraph: graph, status: "published", publishedVersion: 1 }).returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId, version: 1, graph });
    return flow.id;
  }

  const event = async (orgId: string, id: string, occurredAt: Date) => {
    await db.insert(events).values({
      eventId: id, orgId, connectionId: CONN, source: "webhook", eventType: "thing",
      subject: id, occurredAt, properties: {},
    });
  };

  it("counts only the records inside each window", async () => {
    const org = "org_range";
    const flowId = await publishCountFlow(org);
    const now = Date.now();
    const startOfToday = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    await event(org, "today-1", new Date(startOfToday + 60_000));
    await event(org, "yesterday-1", new Date(startOfToday - 3_600_000));
    await event(org, "yesterday-2", new Date(startOfToday - 7_200_000));
    await event(org, "long-ago", new Date(now - 60 * 86_400_000));

    await materializeFlow(db, org, flowId);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
    const byRange = (row.tile as { byRange?: Record<string, { value?: number }> }).byRange!;

    // Sabotage: drop ctx.window from the app read and every one of these is 4.
    expect(byRange.today.value).toBe(1);
    expect(byRange.yesterday.value).toBe(2);
    expect(byRange["7d"].value).toBe(3);
    expect(byRange["90d"].value).toBe(4);
    expect(byRange.all.value).toBe(4);
    // The headline value stays the flow's own definition, so a tile rendered
    // without a range (or written before this shipped) is unchanged.
    expect((row.tile as { value?: number }).value).toBe(4);
  });

  it("a window NARROWS the flow's own definition — it never widens it", async () => {
    const org = "org_range2";
    await db.insert(connections).values({ id: CONN, orgId: org, source: "webhook", name: "Hook", status: "active", authType: "none" });
    const startOfToday = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    // A flow that already restricts itself to one event type.
    const graph = {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN, source: "webhook", eventType: "kept" } } },
        { id: "c", type: "formula", data: { config: { op: "count" } } },
      ],
      edges: [{ id: "e", source: "a", target: "c" }],
      metrics: [{ nodeId: "c", enabled: true, name: "Kept", viz: "number", format: "number", precision: 0 }],
    };
    const [flow] = await db.insert(flows).values({ orgId: org, name: "kept", draftGraph: graph, status: "published", publishedVersion: 1 }).returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: org, version: 1, graph });
    await db.insert(events).values([
      { eventId: "k1", orgId: org, connectionId: CONN, source: "webhook", eventType: "kept", subject: "k1", occurredAt: new Date(startOfToday + 60_000), properties: {} },
      { eventId: "x1", orgId: org, connectionId: CONN, source: "webhook", eventType: "other", subject: "x1", occurredAt: new Date(startOfToday + 60_000), properties: {} },
    ]);

    await materializeFlow(db, org, flow.id);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    const byRange = (row.tile as { byRange?: Record<string, { value?: number }> }).byRange!;
    // Today holds two events; the flow only ever counts one of them.
    expect(byRange.today.value).toBe(1);
    expect(byRange.all.value).toBe(1);
  });
});

/**
 * THE UNIT IS A FACT ABOUT THE DATA, AND THE STEP'S FIELD NAMES IT. A metric
 * spec snapshots the step's duration facts at seed time; nothing re-derived
 * them when the step changed. Measured live: a Calculate whose field was
 * `time_between.minutes` (median 0.583 minutes = 35 seconds, exactly what the
 * builder's Test showed) published under a spec still saying `unit: "hours"`
 * — and the dashboard rendered 0.583 HOURS as "35m". Same number, wrong by a
 * factor of sixty, green badge on top.
 *
 * REVERT `factCorrected` IN materializeFlow AND THIS FAILS: the stored tile
 * keeps the spec's stale unit and every duration on the dashboard is at the
 * mercy of whichever unit the step USED to measure in.
 */
describe("a published duration tile takes its unit from the step's own field", () => {
  const CONN = "22222222-2222-4222-8222-222222222222";

  it("heals a stale spec unit at materialize, with no republish", async () => {
    const org = "org_unit";
    await db.insert(connections).values({ id: CONN, orgId: org, source: "webhook", name: "Hook", status: "active", authType: "none" });
    // The live defect, replicated: field says minutes, config and spec say hours.
    const graph = {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN, source: "webhook" } } },
        {
          id: "c",
          type: "formula",
          data: {
            config: {
              op: "median",
              field: "properties.time_between.minutes",
              resultKind: "duration",
              durationUnit: "hours",
              durationDisplay: "hours",
            },
          },
        },
      ],
      edges: [{ id: "e", source: "a", target: "c" }],
      metrics: [
        { nodeId: "c", enabled: true, name: "Speed", viz: "number", format: "duration", unit: "hours", durationDisplay: "auto", precision: 0 },
      ],
    };
    const [flow] = await db.insert(flows).values({ orgId: org, name: "speed", draftGraph: graph, status: "published", publishedVersion: 1 }).returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: org, version: 1, graph });
    await db.insert(events).values({
      eventId: "u1", orgId: org, connectionId: CONN, source: "webhook", eventType: "pair", subject: "u1",
      occurredAt: new Date(), properties: { time_between: { minutes: 0.583333 } },
    });

    await materializeFlow(db, org, flow.id);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    const tile = row.tile as { value?: number; unit?: string; format?: string; durationDisplay?: string };

    // The number is unchanged — 0.583 of SOMETHING — and the something now
    // comes from the field: minutes, i.e. 35 seconds, what the builder shows.
    expect(tile.value).toBeCloseTo(0.583333, 4);
    expect(tile.format).toBe("duration");
    expect(tile.unit).toBe("minutes");
    // Display preference follows the step too — the one place it is chosen.
    expect(tile.durationDisplay).toBe("hours");
  });

  /**
   * THE UNIT LEAVES WITH THE DURATION. `seedMetricFormat`'s number answer
   * carries no unit key at all, so spreading it over a spec that used to be a
   * duration kept `unit: "minutes"` — and the number branch of the formatter
   * suffixes the unit, so a plain record count published as "56 minutes"
   * while the builder's Test box said "56". No control anywhere can clear it,
   * so it survived every republish.
   */
  it("sheds the unit when a step goes back to plain numbers", async () => {
    const org = "org_unit3";
    await db.insert(connections).values({ id: CONN, orgId: org, source: "webhook", name: "Hook", status: "active", authType: "none" });
    // The step is a plain count now; the spec is a leftover from when it measured time.
    const graph = {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN, source: "webhook" } } },
        { id: "c", type: "formula", data: { config: { op: "count" } } },
      ],
      edges: [{ id: "e", source: "a", target: "c" }],
      metrics: [
        { nodeId: "c", enabled: true, name: "Leads", viz: "number", format: "duration", unit: "minutes", durationDisplay: "hours", precision: 0 },
      ],
    };
    const [flow] = await db.insert(flows).values({ orgId: org, name: "leads", draftGraph: graph, status: "published", publishedVersion: 1 }).returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: org, version: 1, graph });
    await db.insert(events).values({
      eventId: "u3", orgId: org, connectionId: CONN, source: "webhook", eventType: "lead", subject: "u3",
      occurredAt: new Date(), properties: {},
    });

    await materializeFlow(db, org, flow.id);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    const tile = row.tile as { value?: number; format?: string; unit?: string; durationDisplay?: string };

    expect(tile.value).toBe(1);
    expect(tile.format).toBe("number");
    // REVERT THE SHED AND THESE ARE "minutes"/"hours" — the tile reads "1 minutes".
    expect(tile.unit).toBeUndefined();
    expect(tile.durationDisplay).toBeUndefined();
  });

  it("leaves a non-duration metric's chosen format alone", async () => {
    const org = "org_unit2";
    await db.insert(connections).values({ id: CONN, orgId: org, source: "webhook", name: "Hook", status: "active", authType: "none" });
    // A plain count the user chose to show as currency — the spec owns that.
    const graph = {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN, source: "webhook" } } },
        { id: "c", type: "formula", data: { config: { op: "sum", field: "value" } } },
      ],
      edges: [{ id: "e", source: "a", target: "c" }],
      metrics: [{ nodeId: "c", enabled: true, name: "Revenue", viz: "number", format: "currency", currency: "USD", precision: 0 }],
    };
    const [flow] = await db.insert(flows).values({ orgId: org, name: "rev", draftGraph: graph, status: "published", publishedVersion: 1 }).returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: org, version: 1, graph });
    await db.insert(events).values({
      eventId: "u2", orgId: org, connectionId: CONN, source: "webhook", eventType: "sale", subject: "u2",
      occurredAt: new Date(), value: "250", properties: {},
    });

    await materializeFlow(db, org, flow.id);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect((row.tile as { format?: string }).format).toBe("currency");
    expect((row.tile as { value?: number }).value).toBe(250);
  });
});
