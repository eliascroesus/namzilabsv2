import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, usageLedger } from "@/db/schema";
import { encrypt, getEncryptionKey } from "@/lib/crypto";
import { claimCalls, laneLimit } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { closeConnector } from "@/connectors/close";
import type { DB } from "@/db/types";

/**
 * C17 — the connect-time "preview latest records" button (`previewLatest`)
 * used to fetch straight from the provider with no budget check at all: no
 * pause check, no ledger claim. A click here could run during a provider
 * cool-off, or spend a call the budget layer never saw and would then
 * double-count against when the real sweep ran next.
 *
 * Mirrors the contract `listSourceOptions` already has and is covered for in
 * `source-options.test.ts`: the pause binds BEFORE any fetch, the claim rides
 * the same "interactive" lane, and a denial must be visible without an
 * unledgered provider call ever going out. `previewLatest` calls `getDb()`
 * internally (unlike `listSourceOptions`, which takes `db` as an argument),
 * so it needs the same `@/db/client` mock as `backfill-reconnect.test.ts`,
 * `calendly-webhook.test.ts` and `org-caps.test.ts`.
 */

let db: DB;
let close: () => Promise<void>;

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));

const { previewLatest } = await import("@/lib/connections");

const ORG = "org_preview";

/** Close: no declared per-endpoint rate limits, so pollOperation("close") is "*". */
async function seedClose(orgId = ORG): Promise<{ id: string; orgId: string; source: string }> {
  const [row] = await db
    .insert(connections)
    .values({
      orgId,
      source: "close",
      name: "Close",
      status: "active",
      authType: "apiKey",
      credentialsEncrypted: encrypt(JSON.stringify({ apiKey: "k" }), getEncryptionKey()),
    })
    .returning({ id: connections.id });
  return { id: row.id, orgId, source: "close" };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

describe("previewLatest enforces the provider budget", () => {
  it("an exhausted bucket throws the claim's reason, without calling the connector", async () => {
    const conn = await seedClose();
    const spy = vi.spyOn(closeConnector, "testFetchLatest").mockResolvedValue([]);
    // Drain the interactive lane's whole minute — same drill as
    // source-options.test.ts's "defers when the minute's budget is spent".
    const limit = laneLimit("close", pollOperation("close"), "interactive");
    const drain = await claimCalls(db, conn, pollOperation("close"), limit, new Date(), "interactive");
    expect(drain.allowed).toBe(true);

    await expect(previewLatest(ORG, conn.id, 3)).rejects.toThrow(/rate limit/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a paused connection throws before any fetch", async () => {
    const conn = await seedClose();
    const spy = vi.spyOn(closeConnector, "testFetchLatest").mockResolvedValue([]);
    // The claim alone cannot enforce this: paused sweeps leave the minute's
    // buckets empty, so a claim would succeed inside the provider's declared
    // cool-off. Remove the isPaused check in previewLatest and this fires a
    // real request instead of throwing.
    await db
      .update(connections)
      .set({ pausedUntil: new Date(Date.now() + 10 * 60_000), pausedReason: "close rate limited (429) — resumes automatically" })
      .where(eq(connections.id, conn.id));

    await expect(previewLatest(ORG, conn.id, 3)).rejects.toThrow(/paused/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a normal call claims exactly one call — a real usage_ledger row with calls = 1", async () => {
    const conn = await seedClose();
    const fixture = [{ eventId: "e1", eventType: "lead_created", occurredAt: new Date(), properties: {} }];
    const spy = vi.spyOn(closeConnector, "testFetchLatest").mockResolvedValue(fixture);

    const result = await previewLatest(ORG, conn.id, 3);

    expect(result).toEqual(fixture);
    expect(spy).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, conn.id));
    expect(row.calls).toBe(1);
    expect(row.operation).toBe(pollOperation("close")); // "*" — Close has one account-wide bucket
  });
});
