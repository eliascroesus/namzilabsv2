import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections } from "@/db/schema";
import { createTestRun, executeAndSettleTestRun, getTestRun } from "@/lib/flow/test-run";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * D.1-full: the Test-lane lifecycle — create → execute (prime force-fresh +
 * run the engine) → settle → poll. Exercised at the lib level; the Inngest
 * function and the inline fallback both call exactly these.
 */

const ORG = "org_testrun";
const KEY = randomBytes(32).toString("base64");
const CFG = { spreadsheetId: "SHEET_T", range: "Tab1" };

let db: DB;
let close: () => Promise<void>;
let connId: string;
let SHEET: string[][] = [];

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  SHEET = [
    ["Name", "Booked"],
    ["Ana", "Yes"],
    ["Ben", "No"],
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/values/")) throw new Error(`unexpected fetch: ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => ({ values: SHEET }),
        text: async () => JSON.stringify({ values: SHEET }),
      } as unknown as Response;
    }),
  );
  const [conn] = await db
    .insert(connections)
    .values({
      orgId: ORG,
      source: "gsheets",
      name: "Sheets",
      status: "active",
      authType: "oauth2",
      credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
    })
    .returning({ id: connections.id });
  connId = conn.id;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

const graph = () => ({
  nodes: [
    { id: "get", type: "app", data: { config: { connectionId: connId, source: "gsheets", sourceConfig: CFG } } },
    { id: "f", type: "filter", data: { config: { combinator: "and", rules: [{ field: "Booked", op: "equals", value: "Yes" }] } } },
  ],
  edges: [{ id: "e1", source: "get", target: "f" }],
});

describe("test-run lifecycle (the lane's unit of work)", () => {
  it("create → running → settled ok, with the force-fresh read baked in", async () => {
    const runId = await createTestRun(db, ORG);
    expect((await getTestRun(db, ORG, runId))?.status).toBe("queued");

    const dto = await executeAndSettleTestRun(db, ORG, runId, graph(), "f");
    expect(dto.status).toBe("ok");
    expect(dto.recordsIn).toBe(2); // the sheet was primed on the spot
    expect(dto.recordsOut).toBe(1); // Booked=Yes

    const state = await getTestRun(db, ORG, runId);
    expect(state?.status).toBe("ok");
    expect(state?.result?.recordsOut).toBe(1);

    // The very next Test sees a live edit — force-fresh is part of the lane.
    SHEET[2] = ["Ben", "Yes"];
    const runId2 = await createTestRun(db, ORG);
    const dto2 = await executeAndSettleTestRun(db, ORG, runId2, graph(), "f");
    expect(dto2.recordsOut).toBe(2);
  });

  it("a node-level failure settles the RUN as ok with the error inside the DTO (the editor renders it)", async () => {
    const runId = await createTestRun(db, ORG);
    const badGraph = { nodes: [{ id: "x", type: "app", data: { config: {} } }], edges: [] };
    const dto = await executeAndSettleTestRun(db, ORG, runId, badGraph, "missing-node");
    expect(dto.status).toBe("error");
    const state = await getTestRun(db, ORG, runId);
    expect(state?.status).toBe("ok"); // the run completed; the result carries the node error
    expect(state?.result?.status).toBe("error");
  });

  it("a step whose connection was removed says so instead of returning zero", async () => {
    const runId = await createTestRun(db, ORG);
    const orphaned = {
      nodes: [{ id: "get", type: "app", data: { config: { connectionId: "00000000-0000-0000-0000-000000000000", source: "gsheets", sourceConfig: CFG } } }],
      edges: [],
    };
    const dto = await executeAndSettleTestRun(db, ORG, runId, orphaned, "get");
    expect(dto.status).toBe("error");
    expect(dto.error).toContain("connection was removed");
    expect(dto.recordsOut).toBe(0); // zero, but never presented as an answer
  });

  it("a stream-scoped step with no resource chosen prompts for the choice", async () => {
    const runId = await createTestRun(db, ORG);
    const unconfigured = {
      nodes: [{ id: "get", type: "app", data: { config: { connectionId: connId, source: "gsheets", sourceConfig: {} } } }],
      edges: [],
    };
    const dto = await executeAndSettleTestRun(db, ORG, runId, unconfigured, "get");
    expect(dto.status).toBe("error");
    expect(dto.error).toMatch(/Choose .*spreadsheet/i);
  });

  it("polling is org-scoped: another org cannot read the run", async () => {
    const runId = await createTestRun(db, ORG);
    expect(await getTestRun(db, "org_other", runId)).toBeNull();
  });

  it("a field breakdown travels on the DTO: groups, whole-input total, pre-cut count", async () => {
    // 2b's test surface: without these three fields the editor shows a bare
    // record count for a grouped Calculate — the breakdown existed only on
    // the published tile, invisible at the moment of building it.
    SHEET = [
      ["Name", "Booked"],
      ["Ana", "Yes"],
      ["Ben", "No"],
      ["Cy", "Yes"],
    ];
    const g = {
      nodes: [
        { id: "get", type: "app", data: { config: { connectionId: connId, source: "gsheets", sourceConfig: CFG } } },
        { id: "calc", type: "formula", data: { config: { op: "count", groupBy: { type: "field", field: "Booked", topN: 1 } } } },
      ],
      edges: [{ id: "e1", source: "get", target: "calc" }],
    };
    const runId = await createTestRun(db, ORG);
    const dto = await executeAndSettleTestRun(db, ORG, runId, g, "calc");
    expect(dto.status).toBe("ok");
    // Sabotage: cut the RECORDS instead of the groups and this total reads 2.
    expect(dto.value).toBe(3);
    expect(dto.groups).toEqual([{ label: "Yes", value: 2 }]);
    expect(dto.groupCount).toBe(2);
  });
});

/**
 * E.7's dedupe guardrail, reworked: the judgement is MEASURED ON THE RUN.
 *
 * The old warning came from connection-wide registry stats, so it could sit
 * directly above a receipt saying the opposite about the same step —
 * "would collapse 23,262 of 23,420" over "No duplicates found", both about
 * one 402-record read. Now `dedupe.groups` (the run's distinct-identity
 * count) travels in the receipt and the panel derives the collapse warning
 * from it, so the two statements share one measurement and cannot disagree.
 */
describe("the dedupe receipt carries the run's distinct-identity count", () => {
  const dedupeGraph = (field: string) => ({
    nodes: [
      {
        id: "get",
        type: "app",
        data: { config: { connectionId: connId, source: "gsheets", sourceConfig: CFG, dedupe: true, dedupeField: field } },
      },
    ],
    edges: [],
  });

  /** 20 rows, 2 distinct "Booked" values, 20 distinct "Name" values. */
  const wideSheet = () => {
    const rows: string[][] = [["Name", "Booked"]];
    for (let i = 0; i < 20; i++) rows.push([`Person ${i}`, i % 2 === 0 ? "Yes" : "No"]);
    return rows;
  };

  it("a category field reads as a huge collapse into few groups", async () => {
    // Sabotage: drop `groups` from the report and the panel can no longer
    // tell "removed most records because the field is a category" from a
    // legitimate dedupe — the exact confusion the registry warning guessed at.
    SHEET = wideSheet();
    const runId = await createTestRun(db, ORG);
    const dto = await executeAndSettleTestRun(db, ORG, runId, dedupeGraph("Booked"), "get");

    expect(dto.status).toBe("ok");
    expect(dto.dedupe).toMatchObject({ field: "Booked", matched: 20, groups: 2, removed: 18 });

    // And it survives the round trip through the polled run row, which is
    // what the editor actually reads.
    const state = await getTestRun(db, ORG, runId);
    expect(state?.result?.dedupe).toMatchObject({ groups: 2, removed: 18 });
  });

  it("an identity field reads as one group per record", async () => {
    SHEET = wideSheet();
    const runId = await createTestRun(db, ORG);
    const dto = await executeAndSettleTestRun(db, ORG, runId, dedupeGraph("Name"), "get");
    expect(dto.status).toBe("ok");
    expect(dto.dedupe).toMatchObject({ matched: 20, groups: 20, removed: 0 });
  });

  it("stays silent when dedupe is off, however bad the field would be", async () => {
    SHEET = wideSheet();
    const graphNoDedupe = {
      nodes: [
        {
          id: "get",
          type: "app",
          data: { config: { connectionId: connId, source: "gsheets", sourceConfig: CFG, dedupe: false, dedupeField: "Booked" } },
        },
      ],
      edges: [],
    };
    const runId = await createTestRun(db, ORG);
    const dto = await executeAndSettleTestRun(db, ORG, runId, graphNoDedupe, "get");
    expect(dto.dedupe).toBeUndefined();
  });
});
