import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { syncState } from "@/db/schema";
import { registerConnector, getConnector } from "@/connectors/registry";
import { closeConnector, closeImportProgress } from "@/connectors/close";
import { connectionImportStatuses } from "@/lib/sync/import-status";
import { scanInvariants } from "@/lib/health/invariants";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

const DAY = 86_400_000;
let db: DB;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("import progress comes from the connector, not from its name", () => {
  it("Close declares its own progress reader", () => {
    expect(closeConnector.importProgress).toBe(closeImportProgress);
  });
  it("a connection-scoped connector that declares importProgress drives the Importing state", async () => {
    const stub: Connector = {
      source: "hook-stub",
      authType: "apiKey",
      verifySignature: () => false,
      poll: async () => ({ records: [], nextCursor: null }),
      importProgress: (cursor) => (cursor === "walking" ? { coveredMs: 2 * DAY, targetMs: 10 * DAY } : null),
    };
    registerConnector(stub);
    const id = await seedConnection(db, { source: "hook-stub" });
    await db.insert(syncState).values({ connectionId: id, cursor: "walking" });
    const statuses = await connectionImportStatuses(db, "org_test", [id]);
    expect(statuses.get(id)?.state).toBe("importing");
    expect(statuses.get(id)?.coverage).toEqual({ coveredMs: 2 * DAY, targetMs: 10 * DAY });
  });
});

describe("cursor lag is declared per connector as retention", () => {
  it("Close declares 30 days with a 25-day alarm and reads its own watermark", () => {
    expect(closeConnector.retention?.days).toBe(30);
    expect(closeConnector.retention?.alarmAfterDays).toBe(25);
    expect(closeConnector.retention?.watermarkOf("2026-08-01T00:00:00Z")).toBe("2026-08-01T00:00:00Z");
    expect(closeConnector.retention?.watermarkOf(JSON.stringify({ hw: "2026-08-02T00:00:00Z", cont: "t" }))).toBe("2026-08-02T00:00:00Z");
  });
  it("any connector with retention is scanned, carrying its source in the finding", async () => {
    const stub: Connector = {
      source: "retention-stub",
      authType: "apiKey",
      verifySignature: () => false,
      poll: async () => ({ records: [], nextCursor: null }),
      retention: { days: 10, alarmAfterDays: 7, watermarkOf: (c) => c },
    };
    registerConnector(stub);
    const id = await seedConnection(db, { source: "retention-stub" });
    await db.insert(syncState).values({ connectionId: id, cursor: new Date(Date.now() - 8 * DAY).toISOString() });
    const report = await scanInvariants(db);
    expect(report.cursorLag).toEqual([{ source: "retention-stub", connectionId: id, hw: expect.any(String), ageDays: 8 }]);
    expect(getConnector("gcal")?.retention).toBeUndefined();
  });
});
