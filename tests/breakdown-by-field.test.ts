import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, type NodeExecOk } from "@/lib/flow/engine";
import { validateGraph } from "@/lib/flow/validate";
import { parseGraph, seedMetricFormat } from "@/lib/flow/types";
import { resultLabel } from "@/components/flow/node-meta";
import { nodeNeedsSetup } from "@/components/flow/graph-utils";
import type { DB } from "@/db/types";

/**
 * 2b — breakdown by a field on Calculate.
 *
 * The engine could always group by a field (all seven aggregations, median
 * included); the only control in the UI offered "one total number" or "a
 * trend over time". Of 15 realistic sales metrics in the audit, three of the
 * seven unbuildable ones were exactly this missing dropdown option — booked
 * calls per closer, leads per campaign, revenue per pipeline.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_bd";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "none" });
});
afterEach(async () => {
  await close();
});

let seq = 0;
async function ev(rep: string, value?: number) {
  await db.insert(events).values({
    eventId: `bd:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "webhook",
    eventType: "call",
    occurredAt: new Date(Date.parse("2026-07-01T12:00:00Z") + seq++ * 60_000),
    value: value != null ? String(value) : null,
    properties: { rep },
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const calcGraph = (config: Record<string, unknown>) =>
  parseGraph({ nodes: [N("a", "app", { connectionId: CONN }), N("c", "formula", config)], edges: [E("a", "c")] });

async function runCalc(config: Record<string, unknown>) {
  const res = await runFlow({ db, orgId: ORG }, calcGraph(config));
  return res.nodes.get("c")!;
}

describe("the engine's field breakdown, through the Calculate node", () => {
  it("groups by the field, largest first, with the total over EVERY record", async () => {
    await ev("sam");
    await ev("sam");
    await ev("sam");
    await ev("kim");
    await ev("kim");
    await ev("lee");

    const exec = (await runCalc({ op: "count", groupBy: { type: "field", field: "properties.rep" } })) as NodeExecOk;
    expect(exec.status).toBe("ok");
    if (exec.shape.kind !== "grouped") throw new Error("expected grouped");
    expect(exec.shape.groups).toEqual([
      { label: "sam", value: 3 },
      { label: "kim", value: 2 },
      { label: "lee", value: 1 },
    ]);
    expect(exec.shape.total).toBe(6);
    expect(exec.shape.groupCount).toBe(3);
  });

  it("top-N cuts the GROUPS, never the records — the headline cannot become the sum of the survivors", async () => {
    // Sabotage: slice records before aggregating and total reads 5, silently.
    await ev("sam", 100);
    await ev("sam", 200);
    await ev("kim", 50);
    await ev("lee", 25);

    const exec = (await runCalc({ op: "sum", field: "value", groupBy: { type: "field", field: "properties.rep", topN: 1 } })) as NodeExecOk;
    if (exec.shape.kind !== "grouped") throw new Error("expected grouped");
    expect(exec.shape.groups).toEqual([{ label: "sam", value: 300 }]);
    expect(exec.shape.total).toBe(375);
    expect(exec.shape.groupCount).toBe(3);
  });

  it('an unfinished "By a field" errors in words, not zod', async () => {
    await ev("sam");
    const exec = await runCalc({ op: "count", groupBy: { type: "field", field: "" } });
    expect(exec.status).toBe("error");
    expect((exec as { error: string }).error).toContain("Break this down");
  });
});

describe("the static gates around the same unfinished state", () => {
  const cfg = (field: string) => ({ op: "count", groupBy: { type: "field", field } });

  it("publish is blocked, naming the step and the sentence to finish", () => {
    // Sabotage: drop the validate guard and this publishes, then errors at
    // materialize with a red tile — the exact class 1D exists to prevent.
    const issues = validateGraph(calcGraph(cfg("")));
    expect(issues.some((i) => i.nodeId === "c" && i.message.includes("Break this down"))).toBe(true);
    expect(validateGraph(calcGraph(cfg("properties.rep"))).filter((i) => i.nodeId === "c")).toEqual([]);
  });

  it("the card reads Needs setup until the field is picked", () => {
    expect(nodeNeedsSetup("formula", cfg(""), 1, [null])).toBe(true);
    expect(nodeNeedsSetup("formula", cfg("properties.rep"), 1, [null])).toBe(false);
    // The plain single-number Calculate is untouched by the new rule.
    expect(nodeNeedsSetup("formula", { op: "count" }, 1, [null])).toBe(false);
  });

  it("a breakdown seeds a bar tile at Review & publish; a plain number stays a number", () => {
    // Sabotage: seed viz "number" and the published tile silently drops the
    // breakdown the builder just showed.
    expect(seedMetricFormat(cfg("properties.rep"))).toMatchObject({ viz: "bar", format: "number" });
    expect(seedMetricFormat({ op: "count" }).viz).toBeUndefined();
  });

  it("the test headline says the group count next to the total", () => {
    const label = resultLabel("formula", { recordsIn: 6, recordsOut: 3, value: 6, groups: [{ label: "sam", value: 3 }], groupCount: 3 }, cfg("properties.rep"));
    expect(label).toBe("6 across 3 groups");
    // One group is spelled in the singular — "across 1 groups" reads as a
    // bug, on the very headline whose job is to be trusted.
    expect(resultLabel("formula", { recordsIn: 6, recordsOut: 1, value: 6, groups: [{ label: "all", value: 6 }], groupCount: 1 }, cfg("properties.rep"))).toBe("6 across 1 group");
    // No groups → the label is exactly what it always was.
    expect(resultLabel("formula", { recordsIn: 6, recordsOut: 1, value: 6 }, { op: "count" })).toBe("6");
  });

  it("the published tile carries the pre-cut group count, so its bars can't pose as the whole population", async () => {
    // Sabotage: drop groupCount from buildTile and a "Show top 3" tile shows
    // three bars with nothing on the card saying twenty groups were cut.
    await ev("sam");
    await ev("kim");
    await ev("lee");
    const res = await runFlow(
      { db, orgId: ORG },
      parseGraph({
        nodes: [
          N("a", "app", { connectionId: CONN }),
          N("c", "formula", { op: "count", groupBy: { type: "field", field: "properties.rep", topN: 1 } }),
          N("o", "output", { viz: "bar" }),
        ],
        edges: [E("a", "c"), E("c", "o")],
      }),
    );
    expect(res.outputs[0].tile.groups).toHaveLength(1);
    expect(res.outputs[0].tile.groupCount).toBe(3);
    expect(res.outputs[0].tile.value).toBe(3); // the total, never the survivors' sum
  });
});
