import { describe, it, expect } from "vitest";
import { runFlow } from "@/lib/flow/engine";
import type { FlowGraph } from "@/lib/flow/types";

/**
 * MIN AND MAX MUST NOT THROW ON A LARGE DATASET.
 *
 * `Math.min(...nums)` spreads every value as a separate ARGUMENT, and the
 * argument count is bounded by the JS engine's stack. Measured on this runtime:
 * 125,000 passes, 200,000 throws `RangeError: Maximum call stack size exceeded`.
 *
 * `APP_LOAD_CEILING` is 500,000, so a min or max over a stream with more than
 * roughly 150k records inside the window does not return a wrong number — it
 * throws, and the node reports an error the user cannot act on. Every other
 * aggregation on the same records is a `reduce` and is unaffected, which is why
 * this only ever surfaced on two of them.
 *
 * The fix is a linear scan. The threshold is not worth chasing precisely: any
 * spread over an unbounded collection is a latent limit, so the loop removes the
 * class rather than raising the ceiling.
 */

/** Records enough to be past the measured failure threshold, cheap to build. */
const RECORDS = 200_000;

function graphOver(aggregation: "min" | "max" | "avg"): FlowGraph {
  return {
    nodes: [
      { id: "src", type: "app", position: { x: 0, y: 0 }, data: { config: {} } },
      {
        id: "calc",
        type: "calculate",
        position: { x: 1, y: 0 },
        data: { config: { mode: "number", aggregation, field: "properties.amount" } },
      },
    ],
    edges: [{ id: "e", source: "src", target: "calc" }],
  } as unknown as FlowGraph;
}

/**
 * The engine's Get-data step reads the database, so this drives `computeAgg`
 * through the public entry point with a stubbed reader instead — the shape of
 * the failure is the argument count, not where the rows came from.
 */
async function aggregateOver(aggregation: "min" | "max" | "avg"): Promise<number> {
  const records = Array.from({ length: RECORDS }, (_, i) => ({
    id: String(i),
    occurredAt: new Date(2026, 0, 1).toISOString(),
    properties: { amount: i + 1 },
  }));
  const ctx = {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => records.map((r) => ({ ...r, properties: r.properties })) }),
          }),
        }),
      }),
    } as never,
    orgId: "org",
  };
  const res = await runFlow(ctx, graphOver(aggregation));
  const node = res.nodes.get("calc")!;
  if (node.status === "error") throw new Error(node.error);
  const shape = node.shape;
  if (shape.kind !== "scalar") throw new Error(`expected a scalar, got ${shape.kind}`);
  return shape.value;
}

describe("min and max over a large dataset", () => {
  it("min returns the smallest value instead of throwing", async () => {
    await expect(aggregateOver("min")).resolves.toBe(1);
  });

  it("max returns the largest value instead of throwing", async () => {
    await expect(aggregateOver("max")).resolves.toBe(RECORDS);
  });

  /** The control: avg was always a reduce, and must keep its answer. */
  it("avg is unchanged", async () => {
    await expect(aggregateOver("avg")).resolves.toBe((RECORDS + 1) / 2);
  });
});
