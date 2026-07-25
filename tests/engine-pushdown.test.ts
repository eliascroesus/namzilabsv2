import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { upsertEvents } from "@/ingestion/pipeline";
import { runFlow, type CompileProvenance } from "@/lib/flow/engine";
import { planPushdown } from "@/lib/flow/compile/pushdown";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * E.1/E.4 at the FLOW level: with the per-flow compile flag on, a Get-data
 * step folds its downstream filter chain into SQL. The contract this suite
 * enforces is the one that matters — the compiled run and the JS run produce
 * IDENTICAL results, for every graph shape, and anything the compiler cannot
 * prove it understands is simply not folded.
 */

const ORG = "org_pushdown";
let db: DB;
let close: () => Promise<void>;
let connId = "";

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "gsheets" });
  const rows = Array.from({ length: 60 }, (_, i) => ({
    eventId: `pd:${i}`,
    eventType: i % 3 === 0 ? "row_added" : "updated",
    subject: `user${i}@x.io`,
    occurredAt: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 3_600_000),
    value: i,
    properties: {
      stage: i % 2 === 0 ? "Won" : "Lost",
      channel: ["ig", "fb", "tt"][i % 3],
      amount: String(i * 10),
      note: i % 5 === 0 ? "" : `note ${i}`,
    },
  }));
  await upsertEvents(db, { orgId: ORG, connectionId: connId, source: "gsheets", generation: 1 }, rows);
});

afterAll(async () => {
  await close();
});

const appCfg = { connectionId: connId, source: "gsheets" };

/** Run the same graph both ways and compare every node's output. */
async function bothWays(graphSpec: { nodes: unknown[]; edges: unknown[] }) {
  const graph = parseGraph(graphSpec);
  const provenance: CompileProvenance[] = [];
  const js = await runFlow({ db, orgId: ORG }, graph);
  const compiled = await runFlow({ db, orgId: ORG, compile: true, provenance }, graph);
  return { js, compiled, provenance };
}

/**
 * What MUST be identical: every dashboard number, and every node's output
 * downstream of the fold.
 *
 * What legitimately differs: the row COUNTS reported by the Get-data step and
 * by folded filter steps. That is the whole point of pushing the predicate
 * into SQL — the read fetches 30 matching rows instead of 60 and discarding
 * half. Those counts are honest descriptions of the work done (and the editor
 * shows them as such); they are diagnostics, not results. Every tile value,
 * and every aggregate/output node, is compared strictly below.
 */
function summarize(run: Awaited<ReturnType<typeof runFlow>>, foldedIds: string[] = []) {
  const skip = new Set(foldedIds);
  return [...run.nodes.entries()]
    .filter(([id, n]) => n.nodeType !== "app" && !skip.has(id))
    .map(([id, n]) => `${id}:${n.status}:${n.recordsIn}/${n.recordsOut}`)
    .concat(run.outputs.map((o) => `tile:${o.nodeId}:${JSON.stringify(o.tile?.value ?? null)}`))
    .sort();
}

describe("E.1 — filter pushdown produces identical results to the JS engine", () => {
  it("a simple app → filter → aggregate flow matches exactly, and folds the filter", async () => {
    const spec = {
      nodes: [
        N("get", "app", appCfg),
        N("f", "filter", { combinator: "and", rules: [{ field: "stage", op: "equals", value: "Won" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", { name: "Won count" }),
      ],
      edges: [E("get", "f"), E("f", "agg"), E("agg", "out")],
    };
    const { js, compiled, provenance } = await bothWays(spec);
    expect(summarize(compiled, provenance[0].foldedFilterNodeIds)).toEqual(summarize(js, provenance[0].foldedFilterNodeIds));
    expect(js.outputs[0].tile.value).toBe(30);
    expect(compiled.outputs[0].tile.value).toBe(30);
    // The filter WAS folded, and the read loaded only matching rows.
    expect(provenance[0].foldedFilterNodeIds).toEqual(["f"]);
    expect(provenance[0].rowsLoaded).toBe(30);
  });

  it("a chain of filters folds as an implicit AND", async () => {
    const spec = {
      nodes: [
        N("get", "app", appCfg),
        N("f1", "filter", { combinator: "and", rules: [{ field: "stage", op: "equals", value: "Won" }] }),
        N("f2", "filter", { combinator: "and", rules: [{ field: "channel", op: "equals", value: "ig" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", {}),
      ],
      edges: [E("get", "f1"), E("f1", "f2"), E("f2", "agg"), E("agg", "out")],
    };
    const { js, compiled, provenance } = await bothWays(spec);
    expect(summarize(compiled, provenance[0].foldedFilterNodeIds)).toEqual(summarize(js, provenance[0].foldedFilterNodeIds));
    expect(provenance[0].foldedFilterNodeIds).toEqual(["f1", "f2"]);
    expect(provenance[0].rowsLoaded).toBe(js.nodes.get("f2")!.recordsOut);
  });

  it("an OR combinator inside a folded filter still matches", async () => {
    const spec = {
      nodes: [
        N("get", "app", appCfg),
        N("f", "filter", {
          combinator: "or",
          rules: [
            { field: "channel", op: "equals", value: "ig" },
            { field: "note", op: "is_empty", value: "" },
          ],
        }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", {}),
      ],
      edges: [E("get", "f"), E("f", "agg"), E("agg", "out")],
    };
    const { js, compiled, provenance } = await bothWays(spec);
    expect(summarize(compiled, provenance[0].foldedFilterNodeIds)).toEqual(summarize(js, provenance[0].foldedFilterNodeIds));
  });

  it("aggregations over pushed-down rows match (sum/avg/count_distinct)", async () => {
    for (const agg of [
      { aggregation: "sum", field: "amount" },
      { aggregation: "avg", field: "value" },
      { aggregation: "count_distinct", distinctField: "channel" },
    ]) {
      const spec = {
        nodes: [
          N("get", "app", appCfg),
          N("f", "filter", { combinator: "and", rules: [{ field: "stage", op: "equals", value: "Won" }] }),
          N("agg", "aggregate", agg),
          N("out", "output", {}),
        ],
        edges: [E("get", "f"), E("f", "agg"), E("agg", "out")],
      };
      const { js, compiled, provenance } = await bothWays(spec);
      expect(summarize(compiled, provenance[0].foldedFilterNodeIds)).toEqual(summarize(js, provenance[0].foldedFilterNodeIds));
    }
  });
});

describe("E.1 — the compiler refuses anything it cannot prove", () => {
  it("does NOT fold a date operator (its flow keeps exact JS semantics)", async () => {
    const graph = parseGraph({
      nodes: [
        N("get", "app", appCfg),
        N("f", "filter", { combinator: "and", rules: [{ field: "occurredAt", op: "before", value: "2026-01-02" }] }),
      ],
      edges: [E("get", "f")],
    });
    expect(planPushdown(graph, "get").predicate).toBeNull();
    const provenance: CompileProvenance[] = [];
    const compiled = await runFlow({ db, orgId: ORG, compile: true, provenance }, graph);
    const js = await runFlow({ db, orgId: ORG }, graph);
    expect(summarize(compiled)).toEqual(summarize(js));
    expect(provenance[0].rowsLoaded).toBe(60); // nothing folded — full read
  });

  it("stops the chain at a mixed filter (one compilable rule + one date rule)", async () => {
    const graph = parseGraph({
      nodes: [
        N("get", "app", appCfg),
        N("f", "filter", {
          combinator: "and",
          rules: [
            { field: "stage", op: "equals", value: "Won" },
            { field: "occurredAt", op: "after", value: "2026-01-01" },
          ],
        }),
      ],
      edges: [E("get", "f")],
    });
    expect(planPushdown(graph, "get").predicate).toBeNull();
  });

  it("does NOT fold across a fan-out (two branches may filter differently)", async () => {
    const graph = parseGraph({
      nodes: [
        N("get", "app", appCfg),
        N("f1", "filter", { combinator: "and", rules: [{ field: "stage", op: "equals", value: "Won" }] }),
        N("f2", "filter", { combinator: "and", rules: [{ field: "stage", op: "equals", value: "Lost" }] }),
      ],
      edges: [E("get", "f1"), E("get", "f2")],
    });
    expect(planPushdown(graph, "get").predicate).toBeNull();
  });

  it("does NOT fold a filter with more than one input", async () => {
    const graph = parseGraph({
      nodes: [
        N("get", "app", appCfg),
        N("other", "app", appCfg),
        N("u", "unite", {}),
        N("f", "filter", { combinator: "and", rules: [{ field: "stage", op: "equals", value: "Won" }] }),
      ],
      edges: [E("get", "u"), E("other", "u"), E("u", "f")],
    });
    expect(planPushdown(graph, "get").predicate).toBeNull();
  });

  it("an empty rule set folds nothing but still runs identically", async () => {
    const spec = {
      nodes: [N("get", "app", appCfg), N("f", "filter", { combinator: "and", rules: [] }), N("agg", "aggregate", { aggregation: "count" }), N("out", "output", {})],
      edges: [E("get", "f"), E("f", "agg"), E("agg", "out")],
    };
    const { js, compiled } = await bothWays(spec);
    expect(summarize(compiled)).toEqual(summarize(js));
    expect(js.outputs[0].tile.value).toBe(60);
  });
});

describe("E.4 — no silent truncation", () => {
  it("the default (uncompiled) run is unchanged: the flag is opt-in per flow", async () => {
    const spec = {
      nodes: [N("get", "app", appCfg), N("agg", "aggregate", { aggregation: "count" }), N("out", "output", {})],
      edges: [E("get", "agg"), E("agg", "out")],
    };
    const { js, compiled } = await bothWays(spec);
    expect(js.outputs[0].tile.value).toBe(60);
    expect(summarize(compiled)).toEqual(summarize(js));
  });

  it("a normal read is never marked truncated", async () => {
    const graph = parseGraph({ nodes: [N("get", "app", appCfg)], edges: [] });
    const run = await runFlow({ db, orgId: ORG }, graph);
    const exec = run.nodes.get("get")!;
    expect(exec.status).toBe("ok");
    expect((exec as { truncated?: boolean }).truncated).toBeUndefined();
  });
});
