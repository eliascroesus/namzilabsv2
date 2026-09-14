import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow, MAX_GROUPS, MAX_GROUP_LABEL } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import { defaultConfig } from "@/components/flow/node-meta";
import { groupsFooter } from "@/components/board-charts/bars-horizontal";
import type { DB } from "@/db/types";

/**
 * A BREAKDOWN POINTED AT A COLUMN THAT IS DIFFERENT ON EVERY ROW.
 *
 * `lead_id`, `email`, a timestamp — every one of them is one keystroke away in
 * the field picker, and until now every one of them produced a group per
 * record. Records are capped at 500,000, so the honest worst case was half a
 * million rows of `{label, value}` written into a tile's jsonb, read back on
 * every board render (a database that bills by the byte), shipped to the
 * browser and turned into DOM. Nothing in the chain refused.
 *
 * TWO AXES BLOW UP, NOT ONE, and the second is easier to hit: `groupKey` was
 * `String(v)`, so a breakdown by a free-text column made every LABEL as long as
 * the cell behind it. Forty groups of a 2KB note is still 80KB of jsonb per
 * tile, and forty is a perfectly ordinary number of groups.
 */
describe("a breakdown of a column with a value per row", () => {
  const ORG = "org_card";
  const CONN = randomUUID();
  let db: DB;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  const rows = async (n: number, props: (i: number) => Record<string, unknown>) => {
    for (let i = 0; i < n; i++) {
      await db.insert(events).values({
        eventId: `webhook:${randomUUID()}`,
        orgId: ORG,
        connectionId: CONN,
        source: "webhook",
        eventType: "lead",
        subject: `s${i}`,
        occurredAt: new Date(Date.now() - 86_400_000),
        value: null,
        properties: props(i),
      });
    }
  };

  const run = (field: string) =>
    runFlow(
      { db, orgId: ORG },
      parseGraph({
        nodes: [
          { id: "a", type: "app", data: { config: { connectionId: CONN } } },
          { id: "g", type: "group", data: { config: { ...defaultConfig("group"), field } } },
          { id: "o", type: "output", data: { config: { name: "By field", viz: "category" } } },
        ],
        edges: [
          { id: "a->g", source: "a", target: "g" },
          { id: "g->o", source: "g", target: "o" },
        ],
      }),
    );

  it("keeps at most MAX_GROUPS rows, however many distinct values there are", async () => {
    // 90 leads, every one its own id — the accident this exists for.
    await rows(90, (i) => ({ lead_id: `L${i}` }));
    const tile = (await run("properties.lead_id")).outputs[0].tile;
    expect(MAX_GROUPS).toBe(40);
    expect(tile.groups!.length).toBe(MAX_GROUPS);
  });

  it("says how many values there really were, instead of implying forty", async () => {
    /**
     * THE HALF THAT MAKES THE CAP HONEST. Forty bars each reading 1, with
     * nothing to say ninety values exist, is a confidently wrong chart — the
     * precise failure this codebase refuses everywhere else.
     */
    await rows(90, (i) => ({ lead_id: `L${i}` }));
    const tile = (await run("properties.lead_id")).outputs[0].tile;
    expect(tile.groupsDistinct).toBe(90);
    // And the headline still counts every record, not the forty shown.
    expect(tile.value).toBe(90);
  });

  it("keeps the LARGEST groups, since those are the ones worth drawing", async () => {
    // One value on 50 rows, then 60 singletons: the big one must survive.
    await rows(50, () => ({ rep: "Afeef" }));
    await rows(60, (i) => ({ rep: `one-off ${i}` }));
    const tile = (await run("properties.rep")).outputs[0].tile;
    expect(tile.groups![0]).toEqual({ label: "Afeef", value: 50 });
    expect(tile.groups!.length).toBe(MAX_GROUPS);
    expect(tile.groupsDistinct).toBe(61);
  });

  it("leaves an ordinary breakdown completely alone", async () => {
    // Under the cap, nothing is trimmed and nothing is claimed about omissions.
    await rows(4, (i) => ({ rep: `R${i % 2}` }));
    const tile = (await run("properties.rep")).outputs[0].tile;
    expect(tile.groups!.length).toBe(2);
    expect(tile.groupsDistinct).toBeUndefined();
  });

  it("cuts a runaway LABEL down, so forty groups cannot be megabytes", async () => {
    const essay = "x".repeat(5_000);
    await rows(3, () => ({ note: essay }));
    const tile = (await run("properties.note")).outputs[0].tile;
    const label = tile.groups![0].label;
    expect(label.length).toBeLessThanOrEqual(MAX_GROUP_LABEL);
    // Trimmed, and SAYING it is trimmed rather than just stopping.
    expect(label.endsWith("…")).toBe(true);
  });

  it("leaves a label that fits exactly as it was, ellipsis and all", async () => {
    await rows(2, () => ({ rep: "Afeef" }));
    const tile = (await run("properties.rep")).outputs[0].tile;
    expect(tile.groups![0].label).toBe("Afeef");
  });
});

/**
 * AND THE CARD HAS TO SAY SO. A cap nobody is told about is the same lie as no
 * cap at all, drawn smaller: forty bars each reading 1 look like the whole
 * story.
 */
describe("what the tile admits it left out", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `g${i}`, value: n - i }));

  it("counts the values that EXISTED, not the forty it was handed", () => {
    // 40 rows kept out of 12,431 — every number in the sentence names the
    // right thing, and the big one is grouped for reading.
    expect(groupsFooter(rows(40), 8, null, 12_431)).toBe("Top 8 of 12,431.");
  });

  it("speaks up when the ENGINE trimmed even though the display did not", () => {
    // No display limit at all, and still 40 of 12,431 — this is the case the
    // old signature could not express, because it counted `groups.length`.
    expect(groupsFooter(rows(40), undefined, null, 12_431)).toBe("Top 40 of 12,431.");
  });

  it("stays quiet when nothing was left out by either", () => {
    expect(groupsFooter(rows(6), 10)).toBeNull();
    expect(groupsFooter(rows(6), 6)).toBeNull();
    expect(groupsFooter(rows(6), undefined, null, 6)).toBeNull();
  });

  it("still reports an ordinary display limit on an uncapped breakdown", () => {
    // The behaviour this function already had, unchanged.
    expect(groupsFooter(rows(12), 5)).toBe("Top 5 of 12.");
  });
});
