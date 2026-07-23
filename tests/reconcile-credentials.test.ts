import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import { encrypt } from "@/lib/crypto";
import { connections } from "@/db/schema";
import type { Connector, PollArgs } from "@/connectors/types";
import type { DB } from "@/db/types";

// A poll connector that records the credentials it was handed.
let capturedCreds: Record<string, unknown> | null | undefined;
const recordingConnector: Connector = {
  source: "cred-poller",
  syncStrategy: "incremental",
  authType: "apiKey",
  verifySignature: () => true,
  normalize: () => [],
  poll: async (args: PollArgs) => {
    capturedCreds = args.credentials;
    return { records: [], nextCursor: "c1" };
  },
};
registerConnector(recordingConnector);

const KEY = randomBytes(32).toString("base64");

let db: DB;
let close: () => Promise<void>;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  capturedCreds = undefined;
});
afterEach(async () => {
  await close();
});

describe("authenticated reconciliation", () => {
  it("decrypts credentialsEncrypted and forwards them to poll()", async () => {
    const connectionId = await seedConnection(db, { source: "cred-poller" });
    await db
      .update(connections)
      .set({ credentialsEncrypted: encrypt(JSON.stringify({ apiKey: "secret-key" }), Buffer.from(KEY, "base64")) })
      .where(eq(connections.id, connectionId));

    await reconcileConnection(db, connectionId);
    expect(capturedCreds).toEqual({ apiKey: "secret-key" });
  });

  it("passes empty credentials (not undefined) when none are stored", async () => {
    const connectionId = await seedConnection(db, { source: "cred-poller" });
    await reconcileConnection(db, connectionId);
    expect(capturedCreds).toEqual({});
  });
});
