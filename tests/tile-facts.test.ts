import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, flowResults, flows, flowVersions } from "@/db/schema";
import { materializeFlow, publishedFlowTiles } from "@/lib/flow/materialize";
import { seedMetricFacts, type TileFacts } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * THE FACTS RIDE THE TILE — what a number IS, stamped where the data is.
 *
 * `factCorrected` has enforced this for durations since the "35 seconds
 * rendered as 35m" bug; this suite pins the widened rule. Three facts exist
 * because three lies exist without them:
 *
 *   `kind: "ratio"` — the engine PRE-multiplies percentages, so the stored
 *   number for 57.1% is 57.1. A future format override that does not know this
 *   prints "0.57%".
 *
 *   `ordered` — `groupByCategories` preserves the author's stage order while
 *   `groupByField` sorts a ranking, and the stored `groups` array is
 *   byte-identical either way. A funnel drawn over a ranking is a lie told in
 *   the author's own labels.
 *
 *   absence — every tile published before this shipped has NO facts until its
 *   next materialize. Absence means unknown, and the last block proves the
 *   window is safe.
 */

const ORG = "org_facts";
const CONN = randomUUID();

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "none" });
});
afterEach(async () => {
  await close();
});

async function publish(nodes: unknown[], edges: unknown[], metric: Record<string, unknown>) {
  const graph = { nodes, edges, metrics: [{ enabled: true, viz: "number", format: "number", precision: 0, ...metric }] };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name: "f", draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph });
  return flow.id;
}

const app = (id: string) => ({ id, type: "app", data: { config: { connectionId: CONN, source: "webhook" } } });
const edge = (a: string, b: string) => ({ id: `${a}-${b}`, source: a, target: b });

async function seedEvents(n = 3) {
  for (let i = 0; i < n; i++) {
    await db.insert(events).values({
      eventId: `e${i}`,
      orgId: ORG,
      connectionId: CONN,
      source: "webhook",
      eventType: "booked",
      subject: `s${i}`,
      occurredAt: new Date(Date.now() - (i + 1) * 3_600_000),
      properties: { plan: i % 2 ? "pro" : "free" },
    });
  }
}

const factsOf = async (flowId: string): Promise<TileFacts | undefined> => {
  const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
  return (row.tile as { facts?: TileFacts }).facts;
};

describe("the stamp, end to end through a real materialize", () => {
  it("a plain count is a count, scalar", async () => {
    await seedEvents();
    const flowId = await publish(
      [app("a"), { id: "c", type: "formula", data: { config: { op: "count" } } }],
      [edge("a", "c")],
      { nodeId: "c", name: "Events" },
    );
    await materializeFlow(db, ORG, flowId);
    expect(await factsOf(flowId)).toEqual({ kind: "count", shape: "scalar" });
  });

  it("a percentage op is a RATIO — the pre-multiplied trap, recorded", async () => {
    await seedEvents(4);
    const flowId = await publish(
      [
        app("a"),
        { id: "f1", type: "filter", data: { config: { filters: { combinator: "and", rules: [{ field: "properties.plan", op: "equals", value: "pro" }] } } } },
        { id: "c1", type: "formula", data: { config: { op: "count" } } },
        { id: "c2", type: "formula", data: { config: { op: "count" } } },
        { id: "pct", type: "formula", data: { config: { op: "percentage" } } },
      ],
      [
        edge("a", "f1"),
        edge("f1", "c1"),
        edge("a", "c2"),
        { id: "c1-pct", source: "c1", target: "pct", targetHandle: "a" },
        { id: "c2-pct", source: "c2", target: "pct", targetHandle: "b" },
      ],
      { nodeId: "pct", name: "Pro share", format: "percent" },
    );
    const r = await materializeFlow(db, ORG, flowId);
    expect(r.ok, "the fixture graph must actually materialize").toBe(true);
    const facts = await factsOf(flowId);
    expect(facts?.kind).toBe("ratio");
    expect(facts?.shape).toBe("scalar");
  });

  it("ordered categories are stamped ordered, with their fallback's name", async () => {
    await seedEvents(4);
    const flowId = await publish(
      [
        app("a"),
        {
          id: "g",
          type: "group",
          data: {
            config: {
              mode: "categories",
              aggregation: "count",
              fallbackLabel: "Everything else",
              categories: [
                { label: "Pro", filters: { combinator: "and", rules: [{ field: "properties.plan", op: "equals", value: "pro" }] } },
                { label: "Free", filters: { combinator: "and", rules: [{ field: "properties.plan", op: "equals", value: "free" }] } },
              ],
            },
          },
        },
      ],
      [edge("a", "g")],
      { nodeId: "g", name: "By plan" },
    );
    await materializeFlow(db, ORG, flowId);
    expect(await factsOf(flowId)).toEqual({
      kind: "count",
      shape: "grouped",
      ordered: true,
      fallbackLabel: "Everything else",
    });
  });

  it("a field breakdown is grouped but NOT ordered — a ranking, not a sequence", async () => {
    await seedEvents(4);
    const flowId = await publish(
      [app("a"), { id: "g", type: "group", data: { config: { mode: "field", field: "properties.plan", aggregation: "count" } } }],
      [edge("a", "g")],
      { nodeId: "g", name: "By plan" },
    );
    await materializeFlow(db, ORG, flowId);
    const facts = await factsOf(flowId);
    expect(facts?.shape).toBe("grouped");
    // Sabotage: stamp `ordered` from the mere presence of a grouped shape and
    // a value-sorted ranking becomes offerable as a funnel — a lie told in the
    // author's own labels.
    expect(facts?.ordered).toBeUndefined();
  });

  it("survives the dashboard read, which subtracts rather than lists", async () => {
    await seedEvents();
    const flowId = await publish(
      [app("a"), { id: "c", type: "formula", data: { config: { op: "count" } } }],
      [edge("a", "c")],
      { nodeId: "c", name: "Events" },
    );
    await materializeFlow(db, ORG, flowId);
    const [row] = await publishedFlowTiles(db, ORG);
    // `tile - 'byDay'` drops one key; everything else — facts included — rides
    // through with no write-path schema to strip it.
    expect((row.tile as { facts?: TileFacts }).facts).toEqual({ kind: "count", shape: "scalar" });
  });
});

describe("the config half, in isolation", () => {
  it("derives duration facts the way seedMetricFormat always has", () => {
    expect(seedMetricFacts({ resultKind: "duration", field: "properties.time_between.hours" })).toEqual({
      kind: "duration",
      unit: "hours",
    });
  });

  it("keeps the op spelled 'ratio' a COUNT — it is a plain quotient, never multiplied", () => {
    // The engine's `percentage` and `percent_change` multiply by 100; `ratio`
    // does not. The fact records the multiplication, not the name.
    expect(seedMetricFacts({ op: "ratio" }).kind).toBe("count");
    expect(seedMetricFacts({ op: "percentage" }).kind).toBe("ratio");
    expect(seedMetricFacts({ op: "percent_change" }).kind).toBe("ratio");
  });

  it("reads Calculate's breakdownMode and the Group node's mode as one fact", () => {
    expect(seedMetricFacts({ breakdownMode: "categories" }).ordered).toBe(true);
    expect(seedMetricFacts({ mode: "categories" }).ordered).toBe(true);
    expect(seedMetricFacts({ mode: "field" }).ordered).toBeUndefined();
  });
});

describe("the factless window is safe", () => {
  /**
   * Every tile published before this shipped carries no `facts` until its next
   * materialize — the ten-minute stale sweep heals the fleet. During that
   * window a tile renders EXACTLY as it does today, because nothing consumes
   * facts yet; these pins are the promise that the first consumer cannot make
   * absence mean anything but "unknown".
   */
  it("no renderer requires facts today", async () => {
    const { readFileSync } = await import("node:fs");
    for (const p of ["src/components/flow-tile.tsx", "src/components/custom-tile.tsx", "src/lib/board/charts.ts"]) {
      expect(readFileSync(p, "utf8"), `${p} consumes facts before a consumer exists`).not.toMatch(/\.facts\b/);
    }
  });

  it("the type itself says absence means unknown", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/flow/types.ts", "utf8")).toContain("ABSENCE MEANS UNKNOWN");
  });
});

describe("the series gate asks the data, not the viz", () => {
  it("a dataset endpoint with a time reference stores its series whatever the viz says", async () => {
    /**
     * The gate read `viz === "line" || viz === "bar"`, which made a
     * PRESENTATION field decide whether the series was computed at all — the
     * one place in the repo where the otherwise-decorative viz changed
     * behaviour, and the reason a tile could not become a bar chart later
     * without a republish. Same records, already in memory; presentation now
     * chooses freely at render.
     */
    await seedEvents(3);
    const flowId = await publish([app("a")], [], {
      nodeId: "a",
      name: "Raw events",
      viz: "number",
      timeField: "occurredAt",
      timeUnit: "day",
    });
    const r = await materializeFlow(db, ORG, flowId);
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
    const tile = row.tile as { series?: unknown[]; facts?: TileFacts };
    // Sabotage: restore the viz check and this tile has no series — and no
    // amount of restyling can grow one without a republish.
    expect(Array.isArray(tile.series)).toBe(true);
    expect(tile.series!.length).toBeGreaterThan(0);
    expect(tile.facts?.shape).toBe("dataset");
  });
});
