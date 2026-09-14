import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import { NODE_LIBRARY, defaultConfig } from "@/components/flow/node-meta";
import { nodeNeedsSetup, publishesToDashboard } from "@/components/flow/graph-utils";
import { validateGraph } from "@/lib/flow/validate";
import { chartsFor, shapeOfTile } from "@/lib/board/charts";
import type { DB } from "@/db/types";

/**
 * THE STEP THAT BREAKS A METRIC DOWN BY A FIELD — reachable at last.
 *
 * Everything under it was built and none of it was usable: `execGroup` runs,
 * `GroupConfigSchema` parses, the config panel has the full "Group by → A field
 * value" form, the canvas registers the node type and the board draws the
 * result as a Breakdown, a Pie or Ranked bars. The step was simply absent from
 * `NODE_LIBRARY`, so no one could add one — which is why the Breakdown chart
 * reported "nothing here can be drawn that way" over a workspace whose 46
 * published tiles were, every one of them, a single number.
 *
 * So the pins below are about REACHABILITY first and arithmetic second: a
 * picker entry that builds this node, a default config that runs without being
 * touched, and a stored tile the breakdown charts actually accept.
 */
describe("the breakdown step, in the picker", () => {
  const entry = () => NODE_LIBRARY.find((e) => e.type === "group");

  it("is offered at all", () => {
    expect(entry()).toBeDefined();
  });

  it("lands ready to run, so the card is not born broken", () => {
    /**
     * A step added from the picker gets `defaultConfig` merged under the
     * entry's own `config`. Grouping by a field with no field named is a card
     * that says "Needs setup" the moment it appears — true of some steps by
     * design (a Match cannot guess what to match) but not of this one, where
     * "count the records in each value of a field" has an honest default.
     */
    const cfg = { ...defaultConfig("group"), ...(entry()?.config ?? {}) };
    expect(cfg.mode).toBe("field");
    expect(cfg.aggregation).toBe("count");
    expect(String(cfg.field ?? "")).not.toBe("");
  });
});

describe("the breakdown step, published", () => {
  /**
   * REACHABLE MEANS PUBLISHABLE. A step you can add and configure but cannot
   * turn into a metric is still a step that does nothing, and this path has
   * never been walked: no flow in any workspace contains a `group` node, so
   * neither the validator nor the publish gate has ever been asked about one.
   */
  const g = () =>
    parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: "c1", source: "gsheets", sourceConfig: { spreadsheetId: "s", range: "r" } } } },
        { id: "g", type: "group", data: { config: { ...defaultConfig("group"), field: "properties.booked_hour" } } },
      ],
      edges: [{ id: "a->g", source: "a", target: "g" }],
      metrics: [{ nodeId: "g", name: "Leads by hour", enabled: true }],
    });

  it("validates clean, so Publish is not blocked on it", () => {
    expect(validateGraph(g())).toEqual([]);
  });

  it("counts as a result the dashboard can be given", () => {
    /**
     * Nothing above the group step points anywhere, so it is the flow's
     * terminal node — and a terminal step that is not an Output publishes when
     * its metric is on, which is how every endpoint metric in the product
     * works. Asserted through the predicate the builder itself calls rather
     * than through the shape of this fixture.
     */
    expect(g().edges.some((e) => e.source === "g")).toBe(false);
    expect(publishesToDashboard("group", true, { enabled: true })).toBe(true);
    // And an author who switches it off is respected, so the flag is real.
    expect(publishesToDashboard("group", true, { enabled: false })).toBe(false);
  });

  it("is not stuck reading Needs setup once a step feeds it", () => {
    expect(nodeNeedsSetup("group", { ...defaultConfig("group") }, 1)).toBe(false);
    // …and with nothing above it, it correctly still asks for one.
    expect(nodeNeedsSetup("group", { ...defaultConfig("group") }, 0)).toBe(true);
  });
});

describe("the breakdown step, run", () => {
  const ORG = "org_bd";
  const CONN = randomUUID();
  let db: DB;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  const lead = async (hour: string, subject: string) => {
    await db.insert(events).values({
      eventId: `webhook:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "webhook",
      eventType: "booked",
      subject,
      occurredAt: new Date(Date.now() - 86_400_000),
      value: null,
      properties: { booked_hour: hour },
    });
  };

  const graph = () =>
    parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN } } },
        {
          id: "g",
          type: "group",
          data: { config: { ...defaultConfig("group"), field: "properties.booked_hour" } },
        },
        { id: "o", type: "output", data: { config: { name: "Leads by hour", viz: "category" } } },
      ],
      edges: [
        { id: "a->g", source: "a", target: "g" },
        { id: "g->o", source: "g", target: "o" },
      ],
    });

  it("gives one row per distinct value of the field", async () => {
    await lead("09", "a");
    await lead("09", "b");
    await lead("14", "c");

    const res = await runFlow({ db, orgId: ORG }, graph());
    const groups = res.outputs[0].tile.groups!;
    expect(groups.map((g) => g.label).sort()).toEqual(["09", "14"]);
    expect(groups.find((g) => g.label === "09")!.value).toBe(2);
    expect(groups.find((g) => g.label === "14")!.value).toBe(1);
  });

  it("heads the card with every record, not the sum of the rows", async () => {
    // The distinction only bites for count_distinct, but the headline is one
    // rule in one place and this is the cheap way to notice it changing.
    await lead("09", "a");
    await lead("14", "b");
    const res = await runFlow({ db, orgId: ORG }, graph());
    expect(res.outputs[0].tile.value).toBe(2);
  });

  it("produces a tile the breakdown charts will actually take", async () => {
    /**
     * THE HALF THAT MAKES THE FEATURE REACHABLE RATHER THAN MERELY CORRECT.
     * `chartsFor` decides what the board offers from the SHAPE of the stored
     * tile, so a grouped result that never reaches `tile.groups` would draw as
     * a lonely number and the Breakdown chart would go on saying there is
     * nothing to draw.
     */
    await lead("09", "a");
    await lead("14", "b");
    const res = await runFlow({ db, orgId: ORG }, graph());
    const charts = chartsFor(shapeOfTile(res.outputs[0].tile));
    expect(charts).toContain("category");
    expect(charts).toContain("pie");
    expect(charts).toContain("ranked");
  });
});
