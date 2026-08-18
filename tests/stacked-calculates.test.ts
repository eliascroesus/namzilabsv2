import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, tileByRange, type NodeExecOk, type TilePresentation } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import { recordsSourceOf } from "@/lib/flow/shapes";
import type { DB } from "@/db/types";

/**
 * SEVERAL NUMBERS FROM ONE SOURCE.
 *
 * A Calculate consumes records and emits a number, so a second Calculate
 * stacked under it had nothing to read: "The step above produces a single
 * number, not records." And the canvas offers no way to branch — "+ Add next
 * step" appears only on a step with nothing after it, so a sheet already
 * feeding a Calculate cannot be given a second child at all. Wanting "total
 * calls AND total pickups from this sheet" was therefore unbuildable, while
 * the second step's field picker offered that sheet's columns the whole time.
 *
 * A records-reading step now reaches back to the nearest step above it that
 * has records. The line still means "comes after"; for a step that reads
 * records it also means "reads from here, or from the last place there were
 * records" — which is what the canvas already looked like it meant.
 *
 * The fixture is the founder's real Form_Responses tab.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_stacked";
const CONN = randomUUID();
const CALLS_CRM = "properties.How many NEW people did you call? (CLOSE CRM)";
const CALLS_PHONE = "properties.How many NEW people did you call? (Your Phone)";
const PICKED_CRM = "properties.How many people picked up? (CLOSE CRM)";
const PICKED_PHONE = "properties.How many people picked up? (Your Phone)";

/** [callsCrm, callsPhone, pickedCrm, pickedPhone] — five real responses. */
const ROWS: Array<[string, string, string, string]> = [
  ["1", "12", "1", "5"],
  ["3", "3", "0", "2"],
  ["6", "0", "1", "0"],
  ["0", "2", "0", "2"],
  ["3", "0", "2", "0"],
];

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "gsheets", name: "Sheet", status: "active", authType: "none" });
  let i = 0;
  for (const [cc, cp, pc, pp] of ROWS) {
    await db.insert(events).values({
      eventId: `st:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "gsheets",
      eventType: "row_added",
      occurredAt: new Date(Date.parse("2026-08-12T06:00:00Z") + i++ * 3_600_000),
      properties: {
        "How many NEW people did you call? (CLOSE CRM)": cc,
        "How many NEW people did you call? (Your Phone)": cp,
        "How many people picked up? (CLOSE CRM)": pc,
        "How many people picked up? (Your Phone)": pp,
      },
    });
  }
});
afterEach(async () => {
  await close();
});

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string, extra: Record<string, unknown> = {}) => ({ id: `${s}->${t}${JSON.stringify(extra)}`, source: s, target: t, ...extra });
const sum = (field: string, extra: string) => ({ op: "sum", field, extraFields: [extra] });
const val = (e: NodeExecOk) => (e.shape.kind === "scalar" ? e.shape.value : null);

/** The founder's flow: Sheet -> Calculate(pickups) -> Calculate(calls). */
const STACKED = {
  nodes: [
    N("sheet", "app", { connectionId: CONN, source: "gsheets", eventType: "row_added" }),
    N("pickups", "formula", sum(PICKED_CRM, PICKED_PHONE)),
    N("calls", "formula", sum(CALLS_CRM, CALLS_PHONE)),
  ],
  edges: [E("sheet", "pickups"), E("pickups", "calls")],
};

async function run(graph: unknown) {
  const g = parseGraph(graph);
  return { g, res: await runFlow({ db, orgId: ORG }, g) };
}

describe("a second Calculate stacked under the first", () => {
  it("reads the sheet's records instead of erroring", async () => {
    const { res } = await run(STACKED);
    const pickups = res.nodes.get("pickups")!;
    const calls = res.nodes.get("calls")!;

    // REVERT THE REACH-BACK AND THIS IS: "The step above produces a single
    // number, not records, so there is nothing here to add up."
    expect(calls.status).toBe("ok");
    // 1+12, 3+3, 6+0, 0+2, 3+0 = 30 calls; 1+5, 0+2, 1+0, 0+2, 2+0 = 13 pickups.
    expect(val(pickups as NodeExecOk)).toBe(13);
    expect(val(calls as NodeExecOk)).toBe(30);
  });

  it("takes the NEAREST records above it, so a Filter in between still narrows", async () => {
    const graph = {
      nodes: [
        N("sheet", "app", { connectionId: CONN, source: "gsheets", eventType: "row_added" }),
        // Only the responses where somebody was reached on the CRM.
        N("reached", "filter", { combinator: "and", rules: [{ field: PICKED_CRM, op: "gt", value: "0" }] }),
        N("pickups", "formula", sum(PICKED_CRM, PICKED_PHONE)),
        N("calls", "formula", sum(CALLS_CRM, CALLS_PHONE)),
      ],
      edges: [E("sheet", "reached"), E("reached", "pickups"), E("pickups", "calls")],
    };
    const { res } = await run(graph);
    // Rows with pickedCrm > 0 are rows 1, 3 and 5: calls 1+12, 6+0, 3+0 = 22.
    // Sabotage: reach past the Filter to the sheet and this reads 30 — every
    // filter in the flow silently undone for the step below the number.
    expect(val(res.nodes.get("calls") as NodeExecOk)).toBe(22);
  });

  it("a Compare step is untouched — its two numbers are references, not the line", async () => {
    const graph = {
      nodes: [
        N("sheet", "app", { connectionId: CONN, source: "gsheets", eventType: "row_added" }),
        N("pickups", "formula", sum(PICKED_CRM, PICKED_PHONE)),
        N("calls", "formula", sum(CALLS_CRM, CALLS_PHONE)),
        N("rate", "formula", { op: "percentage" }),
      ],
      edges: [
        E("sheet", "pickups"),
        E("pickups", "calls"),
        E("pickups", "rate", { targetHandle: "a" }),
        E("calls", "rate", { targetHandle: "b" }),
      ],
    };
    const { res } = await run(graph);
    // 13 pickups out of 30 calls.
    expect(val(res.nodes.get("rate") as NodeExecOk)).toBeCloseTo(43.333333, 4);
  });

  it("still errors honestly when there are no records anywhere above", async () => {
    const graph = {
      nodes: [N("lonely", "formula", sum(CALLS_CRM, CALLS_PHONE))],
      edges: [],
    };
    const { res } = await run(graph);
    const exec = res.nodes.get("lonely")!;
    expect(exec.status).toBe("error");
    if (exec.status === "error") expect(exec.error).toMatch(/connect it after a data step/i);
  });

  it("resolves the lane of a branch, not the whole split", () => {
    const g = parseGraph({
      nodes: [
        N("sheet", "app", { connectionId: CONN, source: "gsheets" }),
        N("hub", "paths", { paths: [{ id: "pA", label: "A" }, { id: "pB", label: "B" }] }),
        N("headA", "filter", { combinator: "and", rules: [] }),
        N("calcA", "formula", { op: "sum", field: CALLS_CRM }),
        N("calcA2", "formula", { op: "sum", field: PICKED_CRM }),
      ],
      edges: [E("sheet", "hub"), E("hub", "headA", { sourceHandle: "pA" }), E("headA", "calcA"), E("calcA", "calcA2")],
    });
    // The second Calculate in the branch reads the BRANCH's records — reaching
    // to the hub without its lane would hand it every branch's rows.
    expect(recordsSourceOf(g, "calcA2")).toEqual({ nodeId: "headA", sourceHandle: null });
  });

  /**
   * REACHING BACK SILENTLY WOULD BE WORSE THAN THE ERROR IT REPLACES. The
   * panel names the step the records came from whenever it is not simply the
   * step above, so nobody has to infer it from a number that looks plausible.
   */
  it("the resolution is visible: the source differs from the step above", () => {
    const g = parseGraph(STACKED);
    const parentOf = (id: string) => g.edges.find((e) => e.target === id && e.targetHandle == null)?.source;
    // The step above "calls" is the pickups Calculate…
    expect(parentOf("calls")).toBe("pickups");
    // …but its records come from the sheet, which is exactly the case the
    // panel is required to spell out.
    expect(recordsSourceOf(g, "calls")).toEqual({ nodeId: "sheet", sourceHandle: null });
    // And where the two agree, there is nothing to say.
    expect(recordsSourceOf(g, "pickups")).toEqual({ nodeId: parentOf("pickups"), sourceHandle: null });
  });

  /**
   * A range must resolve a step's records exactly as the run did, or the tile's
   * headline and its pills answer two different questions.
   */
  it("a dashboard range windows the reached-back records too", async () => {
    const { g, res } = await run(STACKED);
    const start = Date.parse("2026-08-12T06:00:00Z");
    const spec: TilePresentation = { name: "Calls", viz: "number", format: "number", precision: 0, target: null };
    const { byRange } = tileByRange(g, res.nodes, "calls", spec, [
      // The first two responses only: 1+12 and 3+3.
      { key: "window", start, end: start + 3_600_000 + 1 },
      { key: "all", start: 0, end: start + 99 * 3_600_000, all: true },
    ]);
    expect(byRange.window.unavailable).toBeUndefined();
    expect(byRange.window.value).toBe(19);
    expect(byRange.all.value).toBe(30);
  });
});
