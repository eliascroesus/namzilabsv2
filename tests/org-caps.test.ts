import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createTestDb, seedConnection } from "./helpers/testdb";
import type { DB } from "@/db/types";

/**
 * Per-org creation caps — the blast-radius bound on the two MULTIPLIERS of
 * every runtime cost (the sweep polls per connection; materialization runs
 * per published flow). The guards live inside the SINGLE WRITERS
 * (createConnection, createFlow), so the connect form, the OAuth callback and
 * any future caller are covered without each having to remember.
 */

let db: DB;
let close: () => Promise<void>;

// connections.ts guards itself with `import "server-only"`, which throws in
// any non-RSC bundle — including vitest. The guard is for client bundles;
// a test IS the server side, so neutralize it.
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({
  getDb: () => db,
  getReadDb: () => db,
}));
// createConnection dispatches a first sync through Inngest; the cap test must
// not depend on a queue existing.
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const { createConnection } = await import("@/lib/connections");
const { createFlow } = await import("@/lib/flow/store");
const { CapError } = await import("@/lib/limits");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
});

describe("connection cap", () => {
  it("refuses the create past the cap, allows it below, and counts disabled rows", async () => {
    vi.stubEnv("MAX_CONNECTIONS_PER_ORG", "3");
    await seedConnection(db, { orgId: "org_cap", source: "webhook" });
    await seedConnection(db, { orgId: "org_cap", source: "webhook" });
    // Disabled rows keep their data and reconnect for free — they hold quota.
    await seedConnection(db, { orgId: "org_cap", source: "webhook", status: "disabled" });

    await expect(
      createConnection({ orgId: "org_cap", source: "webhook", name: "one too many", authType: "secret" }),
    ).rejects.toThrow(CapError);
    // The message is customer-facing: friendly, names the number, says what to do.
    await expect(
      createConnection({ orgId: "org_cap", source: "webhook", name: "one too many", authType: "secret" }),
    ).rejects.toThrow(/limit of 3 connections.*Contact us/s);

    // Another org is untouched by this org's cap.
    const other = await createConnection({ orgId: "org_other", source: "webhook", name: "fine", authType: "secret" });
    expect(other.id).toBeTruthy();
  });
});

describe("flow cap", () => {
  it("refuses past the cap and stays per-org", async () => {
    vi.stubEnv("MAX_FLOWS_PER_ORG", "2");
    await createFlow(db, "org_cap", "one");
    await createFlow(db, "org_cap", "two");

    await expect(createFlow(db, "org_cap", "three")).rejects.toThrow(CapError);
    // Sabotage pin: move the count after the insert and this fails — the
    // third row would exist before the guard could fire.
    const { flows } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    expect(await db.select().from(flows).where(eq(flows.orgId, "org_cap"))).toHaveLength(2);

    const other = await createFlow(db, "org_other", "fine");
    expect(other.id).toBeTruthy();
  });
});
