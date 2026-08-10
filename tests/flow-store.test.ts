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

async function seedEvents(n: number, value?: number) {
  for (let i = 0; i < n; i++) {
    await db.insert(events).values({
      eventId: `webhook:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "webhook",
      eventType: "booked",
      subject: `s${i}`,
      occurredAt: new Date(),
      ...(value != null ? { value: String(value) } : {}),
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

  it("materializes an endpoint metric (Review & publish) without an Output node", async () => {
    await seedEvents(4);
    const flow = await createFlow(db, ORG);
    await saveDraft(db, ORG, flow.id, {
      nodes: [N("a", "app", { connectionId: CONN }), N("c", "calculate", { mode: "number", aggregation: "count" })],
      edges: [E("a", "c")],
      metrics: [{ nodeId: "c", enabled: true, name: "Total bookings", viz: "number", format: "number" }],
    });
    await publishFlow(db, ORG, flow.id);

    const res = await materializeFlow(db, ORG, flow.id);
    expect(res.ok).toBe(true);
    const rows = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].outputNodeId).toBe("c");
    expect((rows[0].tile as { value: number; name: string }).value).toBe(4);
    expect((rows[0].tile as { name: string }).name).toBe("Total bookings");
  });


  /**
   * A metric that starts failing must not simply disappear.
   *
   * The tidy-up deletes every stored row whose node is not in the tile list,
   * and a failed node was never in that list — so a broken metric had its row
   * DELETED, vanished from the dashboard with no badge and no message, and
   * materializeFlow returned ok. The honest path only ran when EVERY tile
   * failed, so the more metrics a flow had, the quieter the loss.
   */
  it("a metric that breaks keeps its row and says why, and the run reports failure", async () => {
    await seedEvents(3, 10);
    const flow = await createFlow(db, ORG);
    const graph = (field: string) => ({
      nodes: [N("a", "app", { connectionId: CONN }), N("ok", "formula", { op: "count" }), N("bad", "formula", { op: "sum", field })],
      edges: [E("a", "ok"), E("a", "bad")],
      metrics: [
        { nodeId: "ok", enabled: true, name: "Count", viz: "number", format: "number" },
        { nodeId: "bad", enabled: true, name: "Total", viz: "number", format: "number" },
      ],
    });
    await saveDraft(db, ORG, flow.id, graph("value"));
    await publishFlow(db, ORG, flow.id);
    expect(await materializeFlow(db, ORG, flow.id)).toMatchObject({ ok: true });

    // Republish pointing at a field no record carries — the metric breaks.
    await saveDraft(db, ORG, flow.id, graph("properties.missing"));
    await publishFlow(db, ORG, flow.id);
    const res = await materializeFlow(db, ORG, flow.id);

    // Sabotage: leave the failed node out of `keep` and its row is deleted —
    // the tile silently disappears from the dashboard and this returns ok:true.
    expect(res.ok).toBe(false);
    const rows = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(rows.map((r) => r.outputNodeId).sort()).toEqual(["bad", "ok"]);
    const bad = rows.find((r) => r.outputNodeId === "bad")!;
    expect(bad.status).toBe("error");
    expect(bad.error).toMatch(/none of the 3 records/);
    expect(rows.find((r) => r.outputNodeId === "ok")!.status).toBe("fresh");
  });

  it("reports ok:false when a published flow cannot be computed (drives the publish warning)", async () => {
    // A REAL zero denominator. This used to seed records with no `value` at
    // all and lean on "sum of null = 0" — which is the confident-zero bug an
    // aggregation now refuses to commit, so it can no longer be borrowed.
    await seedEvents(3, 0);
    const graph = {
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("num", "aggregate", { aggregation: "count" }),
        N("den", "aggregate", { aggregation: "sum", field: "value" }),
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
  it("flags a graph with no metric to publish (no Output node, no metrics)", () => {
    const g = parseGraph({ nodes: [N("a", "app", { connectionId: CONN })], edges: [] });
    // The copy speaks the UI's language ("Turn on… in Review & publish"),
    // pinned exactly in tests/builder-ux.test.ts.
    expect(validateGraph(g).some((i) => /Turn on at least one result/.test(i.message))).toBe(true);
  });
  it("accepts an endpoint metric instead of an Output node", () => {
    const g = parseGraph({
      nodes: [N("a", "app", { connectionId: CONN }), N("c", "calculate", { mode: "number", aggregation: "count" })],
      edges: [E("a", "c")],
      metrics: [{ nodeId: "c", enabled: true, name: "Total" }],
    });
    expect(validateGraph(g).some((i) => /metric to publish/.test(i.message))).toBe(false);
  });
});
