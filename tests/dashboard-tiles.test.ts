import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { flowResults, flows } from "@/db/schema";
import { publishedFlowTiles } from "@/lib/flow/materialize";
import type { DB } from "@/db/types";

/**
 * The dashboard's tile read, extracted out of a bare `catch {}` whose
 * rationale ("flow_results may not exist before migration 0002") outlived
 * itself by nineteen migrations. Two contracts matter:
 *
 * 1. The row carries the STORED ERROR — a broken tile that renders a red
 *    pill and nothing else tells the customer their number is broken while
 *    withholding the one fact they could act on.
 * 2. A failed read THROWS to the caller. The page turns it into the
 *    load-error banner; swallowing it rendered "No metrics yet." over a
 *    customer's real published tiles on any transient DB failure — the empty
 *    state as a lie.
 */

const ORG = "org_tiles";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function seedFlow(status: "published" | "draft", name: string) {
  const graph = { nodes: [], edges: [], metrics: [] };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name, draftGraph: graph, status, publishedVersion: status === "published" ? 1 : null })
    .returning();
  return flow;
}

describe("publishedFlowTiles", () => {
  it("returns published tiles WITH their stored error, and never a draft's", async () => {
    const published = await seedFlow("published", "Broken but published");
    const draft = await seedFlow("draft", "Draft");
    await db.insert(flowResults).values([
      { orgId: ORG, flowId: published.id, version: 1, outputNodeId: "o1", tile: null, status: "error", error: "boom: node f1 failed" },
      { orgId: ORG, flowId: draft.id, version: 1, outputNodeId: "o1", tile: { value: 1 }, status: "fresh" },
    ]);

    const rows = await publishedFlowTiles(db, ORG);

    expect(rows).toHaveLength(1);
    expect(rows[0].flowId).toBe(published.id);
    // THE contract item 1: drop `error` from the select and this fails.
    expect(rows[0].error).toBe("boom: node f1 failed");
  });

  it("is org-scoped", async () => {
    const mine = await seedFlow("published", "Mine");
    await db.insert(flowResults).values({ orgId: ORG, flowId: mine.id, version: 1, outputNodeId: "o1", tile: {}, status: "fresh" });
    expect(await publishedFlowTiles(db, "org_other")).toHaveLength(0);
  });

  it("REJECTS on a failed read instead of deciding silence is acceptable", async () => {
    await db.execute(sql`drop table flow_results`);
    // THE contract item 2: wrap the query in a try/catch inside the helper
    // and this fails — the page's loadError banner is the only place allowed
    // to decide what a failure looks like.
    await expect(publishedFlowTiles(db, ORG)).rejects.toThrow();
  });
});
