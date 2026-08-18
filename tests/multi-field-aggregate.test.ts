import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, type NodeExecOk } from "@/lib/flow/engine";
import { parseGraph, aggregationFields } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * ONE STEP THAT TOTALS SEVERAL COLUMNS.
 *
 * A form writes one question per column, so "How many NEW people did you call?
 * (CLOSE CRM)" and "…(Your Phone)" are two columns meaning one thing. Adding
 * them used to require two Get-data steps reading the same sheet twice, two
 * Calculates, and a third to add those — and because a step with something
 * after it offers no "+ Add next step", there is no way to branch one sheet
 * into two aggregations at all. The founder, who built the product, could not
 * find the path.
 *
 * The fixture is the real Form_Responses tab, values included.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_multifield";
const CONN = randomUUID();
const CRM = "properties.How many NEW people did you call? (CLOSE CRM)";
const PHONE = "properties.How many NEW people did you call? (Your Phone)";

/** The live sheet: CRM totals 13, Your Phone totals 17 — one of its cells is prose. */
const ROWS: Array<[string, string]> = [
  ["1", "12"],
  ["3", "3"],
  ["6", "0 (the same 4 leads from close Crm that didn’t pick up) "],
  ["0", "2"],
  ["3", "0"],
];

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "gsheets", name: "Sheet", status: "active", authType: "none" });
  let i = 0;
  for (const [crm, phone] of ROWS) {
    await db.insert(events).values({
      eventId: `mf:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "gsheets",
      eventType: "row_added",
      subject: null,
      occurredAt: new Date(Date.parse("2026-08-12T06:00:00Z") + i++ * 86_400_000),
      // Sheets delivers every cell as a string, including the numbers.
      properties: {
        "How many NEW people did you call? (CLOSE CRM)": crm,
        "How many NEW people did you call? (Your Phone)": phone,
      },
    });
  }
});
afterEach(async () => {
  await close();
});

async function calc(config: Record<string, unknown>): Promise<NodeExecOk> {
  const g = parseGraph({
    nodes: [
      { id: "rows", type: "app", data: { config: { connectionId: CONN, source: "gsheets", eventType: "row_added" } } },
      { id: "c", type: "formula", data: { config } },
    ],
    edges: [{ id: "e", source: "rows", target: "c" }],
  });
  const res = await runFlow({ db, orgId: ORG }, g);
  const exec = res.nodes.get("c")!;
  if (exec.status !== "ok") throw new Error(exec.error);
  return exec;
}

const value = (e: NodeExecOk) => (e.shape.kind === "scalar" ? e.shape.value : null);

describe("a Calculate that adds up several columns", () => {
  it("totals one column exactly as it always did", async () => {
    expect(value(await calc({ op: "sum", field: CRM }))).toBe(13);
    // The prose cell is not a number, so its row contributes nothing here —
    // 12 + 3 + 2 + 0. That silent skip is why the panel says so out loud.
    expect(value(await calc({ op: "sum", field: PHONE }))).toBe(17);
  });

  it("totals two columns into one number", async () => {
    // REVERT extraFields AND THIS READS 13 — the second column is ignored and
    // the number looks entirely plausible.
    expect(value(await calc({ op: "sum", field: CRM, extraFields: [PHONE] }))).toBe(30);
  });

  it("adds the columns per record first, so the aggregation still means what it says", async () => {
    // Per-record totals: 13, 6, 6, 2, 3.
    expect(value(await calc({ op: "avg", field: CRM, extraFields: [PHONE] }))).toBe(6); // 30 / 5
    expect(value(await calc({ op: "max", field: CRM, extraFields: [PHONE] }))).toBe(13);
    expect(value(await calc({ op: "min", field: CRM, extraFields: [PHONE] }))).toBe(2);
    expect(value(await calc({ op: "median", field: CRM, extraFields: [PHONE] }))).toBe(6);
  });

  it("a record keeps counting through its readable columns when one cell is prose", async () => {
    // Row 3 holds 6 and a sentence. Its 6 must survive: dropping the whole
    // record because ONE of its columns is unreadable would silently delete a
    // real day's work from the total.
    //
    // Sabotage: require every column to parse and the sum is 24, the median
    // 4.5 — both entirely plausible, both missing a day.
    expect(value(await calc({ op: "sum", field: CRM, extraFields: [PHONE] }))).toBe(30);
    expect(value(await calc({ op: "median", field: CRM, extraFields: [PHONE] }))).toBe(6);
  });

  /**
   * A QUIET WEEK IS NOT A MISCONFIGURATION. A column that exists but is blank
   * in every record — confirmation calls nobody made — is a real answer of
   * zero. Erroring here would turn every legitimately quiet "Today" pill on
   * the dashboard red.
   */
  it("accepts a column that is present but blank everywhere, and counts the rest", async () => {
    const g = parseGraph({
      nodes: [
        { id: "rows", type: "app", data: { config: { connectionId: CONN, source: "gsheets", eventType: "blankcol" } } },
        { id: "c", type: "formula", data: { config: { op: "sum", field: CRM, extraFields: ["properties.Nobody answered"] } } },
      ],
      edges: [{ id: "e", source: "rows", target: "c" }],
    });
    await db.insert(events).values({
      eventId: `mf:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "gsheets",
      eventType: "blankcol",
      occurredAt: new Date("2026-08-12T06:00:00Z"),
      properties: { "How many NEW people did you call? (CLOSE CRM)": "4", "Nobody answered": "" },
    });
    const res = await runFlow({ db, orgId: ORG }, g);
    const exec = res.nodes.get("c")!;
    expect(exec.status).toBe("ok");
    expect(exec.status === "ok" && exec.shape.kind === "scalar" ? exec.shape.value : null).toBe(4);
  });

  /**
   * A COLUMN THAT IS NOT THERE AT ALL is a rename or a typo at the source, and
   * it is the one failure this feature makes silent: the record still counts
   * through its other columns, so a total of 30 quietly becomes 13 with a
   * green badge. Asked only once a step reads more than one column, so no
   * single-field message changes and no published metric moves.
   *
   * REVERT THE PRESENCE CHECK AND THE FIRST ASSERTION READS 13.
   */
  it("errors when a picked column is absent from every record, naming that column", async () => {
    await expect(calc({ op: "sum", field: CRM, extraFields: ["properties.Renamed at the source"] })).rejects.toThrow(
      /Renamed at the source.*renamed/s,
    );
    // A single field keeps its own long-standing message, unchanged.
    await expect(calc({ op: "sum", field: "properties.nope" })).rejects.toThrow(/none of the 5 records/);
  });

  it("counts and unique-counts are untouched by the extra columns", async () => {
    expect(value(await calc({ op: "count", field: CRM, extraFields: [PHONE] }))).toBe(5);
  });

  it("blank extra slots are ignored, so a half-filled picker never changes the number", async () => {
    expect(aggregationFields({ field: CRM, extraFields: ["", "  "] })).toEqual([CRM]);
    expect(value(await calc({ op: "sum", field: CRM, extraFields: [""] }))).toBe(13);
  });
});
