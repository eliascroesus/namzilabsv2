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
});

/**
 * E.7 dedupe guardrail, end to end.
 *
 * The judgement comes from the field registry the WRITER maintains, so it
 * reflects everything ever synced for the stream rather than the sample this
 * Test happened to load. These cases drive the real lane path
 * (executeAndSettleTestRun → prime → run → warn), not the registry module in
 * isolation — the module was already tested and still never reached a user.
 */
describe("dedupe guardrail reaches the Test result", () => {
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

  it("warns when the dedupe field cannot identify a record", async () => {
    SHEET = wideSheet();
    const runId = await createTestRun(db, ORG);
    const dto = await executeAndSettleTestRun(db, ORG, runId, dedupeGraph("Booked"), "get");

    expect(dto.status).toBe("ok");
    expect(dto.dedupeWarning).toBeTruthy();
    expect(dto.dedupeWarning).toContain("Booked");
    // The point of the warning: it names how much was thrown away.
    expect(dto.dedupeWarning).toMatch(/collapse about 18 of 20 records/);

    // And it survives the round trip through the polled run row, which is what
    // the editor actually reads.
    const state = await getTestRun(db, ORG, runId);
    expect(state?.result?.dedupeWarning).toBe(dto.dedupeWarning);
  });

  it("stays silent for a field that genuinely identifies a record", async () => {
    SHEET = wideSheet();
    const runId = await createTestRun(db, ORG);
    const dto = await executeAndSettleTestRun(db, ORG, runId, dedupeGraph("Name"), "get");
    expect(dto.status).toBe("ok");
    expect(dto.dedupeWarning).toBeUndefined();
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
    expect(dto.dedupeWarning).toBeUndefined();
  });
});
