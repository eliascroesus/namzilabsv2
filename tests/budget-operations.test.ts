import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector, getConnector } from "@/connectors/registry";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { budgetFor } from "@/lib/provider-gateway/budget";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { usageLedger, sourceStreams } from "@/db/schema";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * Per-endpoint budget enforcement.
 *
 * The budget layer has always STORED and computed budgets per
 * `(connection, operation)` — the ledger's unique key is
 * `(connection_id, operation, window_start)` and `budgetFor` reads
 * `rateLimits[operation]`. But every production call site passed the literal
 * `"*"`, so Instantly could declare `emails.list: 20/min`, have that verified
 * by a unit test, and still spend at the `"*"` fallback of 42/min against a
 * 20/min endpoint.
 *
 * The old tests missed it because they called `claimCalls(db, conn,
 * "emails.list", …)` directly — they proved the MECHANISM works when handed the
 * right operation, and never asserted that production hands it over. So the
 * decisive test here is the first one: it drives the real reconcile path and
 * reads back what actually landed in the ledger.
 *
 * The rest are dead-config detectors, in both directions.
 */

let db: DB;
let close: () => Promise<void>;

/** Stands in for the real Instantly connector so no network is touched — but
 *  keeps its source, so the REAL catalog entry (and its declared limit) apply. */
const fakeInstantly: Connector = {
  source: "instantly",
  authType: "apiKey",
  verifySignature: () => true,
  normalize: () => [],
  operations: ["emails.list"] as const,
  operationFor: (config) => (config?.["streamType"] === "raw_emails" ? "emails.list" : "campaigns.analytics.daily"),
  poll: async () => ({ records: [], nextCursor: null }),
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
  registerConnector((await import("@/connectors/instantly")).instantlyConnector);
});

describe("the sweep claims against the endpoint it actually calls", () => {
  it("records the declared operation in the ledger, not the wildcard", async () => {
    registerConnector(fakeInstantly);
    const connectionId = await seedConnection(db, { source: "instantly" });
    // Instantly is stream-scoped, so the sweep claims PER STREAM — and resolves
    // the endpoint from that stream's own config, which is the point.
    await db.insert(sourceStreams).values({
      orgId: "org_test",
      connectionId,
      configHash: "h1",
      config: { campaignId: "camp-1", streamType: "raw_emails" },
    });

    await reconcileConnection(db, connectionId);

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(rows).toHaveLength(1);
    // THE regression: this was "*" before per-endpoint enforcement was wired.
    expect(rows[0].operation).toBe("emails.list");
    expect(rows[0].provider).toBe("instantly");
    expect(rows[0].calls).toBe(1);
  });

  it("spends the declared budget, not the default one", async () => {
    // 20/min published × 0.7 share = 14, vs the undeclared default of 60 × 0.7 = 42.
    expect(budgetFor("instantly", "emails.list")).toBe(14);
    expect(budgetFor("instantly", "*")).toBe(42);
    // What the sweep now resolves to must be the strict one.
    expect(budgetFor("instantly", pollOperation("instantly"))).toBe(14);
  });
});

describe("declared limits and claimed operations cannot drift apart", () => {
  const declaring = CONNECTOR_CATALOG.filter((e) => e.rateLimits && Object.keys(e.rateLimits).length > 0);

  it("covers at least one connector (guards against the check silently vacating)", () => {
    expect(declaring.length).toBeGreaterThan(0);
  });

  it("every declared rateLimits key is one some operation can actually emit", () => {
    for (const entry of declaring) {
      const connector = getConnector(entry.source);
      const emits = new Set(connector?.operations ?? []);
      for (const key of Object.keys(entry.rateLimits!)) {
        expect(
          emits.has(key),
          `${entry.source} declares rateLimits["${key}"] but its connector never emits that operation — ` +
            `the limit is dead config and spending silently falls back to the default budget. ` +
            `Add it to the connector's operations/operationFor, or drop the declaration.`,
        ).toBe(true);
      }
    }
  });

  it("every operation a connector emits has a declared limit", () => {
    for (const entry of CONNECTOR_CATALOG) {
      const connector = getConnector(entry.source);
      for (const op of connector?.operations ?? []) {
        expect(
          Boolean(entry.rateLimits?.[op]),
          `${entry.source} claims budget against "${op}" but the catalog declares no limit for it — ` +
            `it will silently use the default budget. Declare it in rateLimits.`,
        ).toBe(true);
      }
    }
  });

  it("a source that declares limits never resolves to the wildcard bucket", () => {
    for (const entry of declaring) {
      expect(
        pollOperation(entry.source),
        `${entry.source} declares per-endpoint limits but its polls resolve to "*", ` +
          `which is the exact bug this suite exists to prevent.`,
      ).not.toBe("*");
    }
  });
});

describe("pollOperation resolution", () => {
  it("falls back to the shared bucket for connectors with one account-wide limit", () => {
    // Correct, not a gap: the provider publishes a single limit.
    expect(pollOperation("close")).toBe("*");
    expect(pollOperation("gsheets")).toBe("*");
  });

  it("is resolved from config, so per-stream endpoints get separate budgets", () => {
    // The real connector already does this: two streams on ONE Instantly
    // connection hit different endpoints and draw on different buckets.
    expect(pollOperation("instantly", { streamType: "analytics_daily" })).toBe("campaigns.analytics.daily");
    expect(pollOperation("instantly", { streamType: "analytics_totals" })).toBe("campaigns.analytics");
    expect(pollOperation("instantly", { streamType: "raw_emails" })).toBe("emails.list");
  });

  it("is safe for an unknown source", () => {
    expect(pollOperation("nope-not-a-source")).toBe("*");
  });
});

/**
 * The observation has to survive the SWEEP, not just the unit call.
 *
 * This is the same shape of gap that created the problem: `parseRateLimit` read
 * the provider's stated limit correctly, carried it across the connector seam
 * correctly, and then the runner dropped it — every piece working, nothing
 * joining them. So this drives the real reconcile path and reads the ledger.
 */
const fakeClose: Connector = {
  source: "close",
  authType: "apiKey",
  verifySignature: () => true,
  normalize: () => [],
  poll: async () => ({
    records: [],
    nextCursor: null,
    rateLimit: { limit: 240, remaining: 239, resetSeconds: 12 },
  }),
};

describe("what the provider says about its own limit reaches the ledger", () => {
  afterEach(async () => {
    registerConnector((await import("@/connectors/close")).closeConnector);
  });

  it("stores the stated limit from a real sweep", async () => {
    registerConnector(fakeClose);
    const connectionId = await seedConnection(db, { source: "close" });

    await reconcileConnection(db, connectionId);

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].observedLimit).toBe(240);
    expect(rows[0].provider).toBe("close");
  });

  it("leaves it null for a source that states nothing", async () => {
    registerConnector({ ...fakeClose, poll: async () => ({ records: [], nextCursor: null }) });
    const connectionId = await seedConnection(db, { source: "close" });

    await reconcileConnection(db, connectionId);

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(rows[0].observedLimit).toBeNull();
  });
});
