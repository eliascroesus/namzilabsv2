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

  it("polling is org-scoped: another org cannot read the run", async () => {
    const runId = await createTestRun(db, ORG);
    expect(await getTestRun(db, "org_other", runId)).toBeNull();
  });
});
