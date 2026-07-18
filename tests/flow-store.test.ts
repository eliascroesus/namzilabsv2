import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events, flowResults } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createFlow, saveDraft, publishFlow, getPublishedVersion } from "@/lib/flow/store";
import { materializeFlow } from "@/lib/flow/materialize";
import { validateGraph } from "@/lib/flow/validate";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

const ORG = "org_s";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const ET = (s: string, t: string, handle: string) => ({ id: `${s}->${t}:${handle}`, source: s, target: t, targetHandle: handle });
const validGraph = {
  nodes: [
    N("a", "app", { connectionId: CONN }),
    N("agg", "aggregate", { aggregation: "count" }),
    N("out", "output", { name: "Total" }),
  ],
  edges: [E("a", "agg"), E("agg", "out")],
};

async function seedEvents(n: number) {
  for (let i = 0; i < n; i++) {
    await db.insert(events).values({
      eventId: `webhook:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "webhook",
      eventType: "booked",
      subject: `s${i}`,
      occurredAt: new Date(),
      properties: {},
    });
  }
}

describe("flow store: draft / publish immutability", () => {
  it("publishing snapshots the draft into an immutable version", async () => {
    const flow = await createFlow(db, ORG, "My flow");
    await saveDraft(db, ORG, flow.id, validGraph);
    const { version } = await publishFlow(db, ORG, flow.id);
    expect(version).toBe(1);

    const published = await getPublishedVersion(db, ORG, flow.id);
    expect(published?.version).toBe(1);
    expect(published?.graph.nodes.length).toBe(3);
  });

  it("editing the draft does NOT change the published version until republish", async () => {
    const flow = await createFlow(db, ORG);
    await saveDraft(db, ORG, flow.id, validGraph);
    await publishFlow(db, ORG, flow.id);

    // Edit the draft (insert a filter into the chain) — published output must be unchanged.
    await saveDraft(db, ORG, flow.id, {
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { rules: [] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", { name: "Total" }),
      ],
      edges: [E("a", "f"), E("f", "agg"), E("agg", "out")],
    });
    const stillV1 = await getPublishedVersion(db, ORG, flow.id);
    expect(stillV1?.version).toBe(1);
    expect(stillV1?.graph.nodes.length).toBe(3); // draft's 4 nodes not reflected

    const { version } = await publishFlow(db, ORG, flow.id);
    expect(version).toBe(2);
    expect((await getPublishedVersion(db, ORG, flow.id))?.graph.nodes.length).toBe(4);
  });

  it("refuses to publish an invalid draft", async () => {
    const flow = await createFlow(db, ORG);
    await saveDraft(db, ORG, flow.id, { nodes: [N("a", "app", {})], edges: [] }); // app w/o source, no output
    await expect(publishFlow(db, ORG, flow.id)).rejects.toThrow(/Cannot publish/);
  });
});

describe("materializer", () => {
  it("stores fresh flow_results for each Output of the published flow", async () => {
    await seedEvents(5);
    const flow = await createFlow(db, ORG);
    await saveDraft(db, ORG, flow.id, validGraph);
    await publishFlow(db, ORG, flow.id);

    await materializeFlow(db, ORG, flow.id);

    const rows = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("fresh");
    expect((rows[0].tile as { value: number }).value).toBe(5);
    expect(rows[0].computedAt).not.toBeNull();
  });

  it("reports ok:false when a published flow cannot be computed (drives the publish warning)", async () => {
    await seedEvents(3);
    // Passes validation (both formula handles connected) but divides by zero at runtime.
    const graph = {
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("num", "aggregate", { aggregation: "count" }),
        N("den", "aggregate", { aggregation: "sum", field: "value" }), // sum of null = 0
        N("div", "formula", { op: "divide" }),
        N("o", "output", { name: "Bad" }),
      ],
      edges: [E("a", "num"), E("a", "den"), ET("num", "div", "a"), ET("den", "div", "b"), E("div", "o")],
    };
    const flow = await createFlow(db, ORG);
    await saveDraft(db, ORG, flow.id, graph);
    await publishFlow(db, ORG, flow.id); // publish itself succeeds

    const res = await materializeFlow(db, ORG, flow.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Division by zero/);
  });
});

describe("graph validation", () => {
  it("accepts a valid App→Aggregate→Output graph", () => {
    expect(validateGraph(parseGraph(validGraph))).toEqual([]);
  });
  it("flags an empty flow", () => {
    expect(validateGraph(parseGraph({ nodes: [], edges: [] })).length).toBeGreaterThan(0);
  });
  it("flags an aggregate fed by a non-dataset input", () => {
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("agg1", "aggregate", { aggregation: "count" }),
        N("agg2", "aggregate", { aggregation: "count" }),
        N("out", "output", {}),
      ],
      edges: [E("a", "agg1"), E("agg1", "agg2"), E("agg2", "out")], // agg2 fed by a value, not records
    });
    expect(validateGraph(g).some((i) => /records as input/.test(i.message))).toBe(true);
  });
  it("flags a graph with no Output", () => {
    const g = parseGraph({ nodes: [N("a", "app", { connectionId: CONN })], edges: [] });
    expect(validateGraph(g).some((i) => /Output/.test(i.message))).toBe(true);
  });
});
