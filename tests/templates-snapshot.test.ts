import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  parseSnapshot,
  planApply,
  summarize,
  type MetricFacts,
  type SourceView,
} from "@/lib/templates/snapshot";
import { UNSET_TILE_KEY } from "@/lib/board/types";

/**
 * WHAT A TEMPLATE MAY CARRY OUT OF A WORKSPACE — the specification for
 * `src/lib/templates/snapshot.ts`.
 *
 * The snapshot is published at a public URL and copied into strangers'
 * workspaces, so the tests that matter most here are the NEGATIVE ones: a tile
 * key, a goal, a composed part list and a hidden metric's name must never
 * appear anywhere in the serialized JSON. They search the whole string rather
 * than one field, because a leak through a field nobody thought to check is
 * exactly the failure a whitelist exists to prevent.
 */

const FLOW = "flow:0b7c2a9e-1111-4d4d-8e8e-000000000001:out1";
const FLOW_B = "flow:0b7c2a9e-1111-4d4d-8e8e-000000000002:out2";
const FLOW_C = "flow:0b7c2a9e-1111-4d4d-8e8e-000000000003:out3";
const HIDDEN = "flow:0b7c2a9e-1111-4d4d-8e8e-00000000dead:secret";
const METRIC = "metric:6f0f5c1e-2222-4b4b-9c9c-000000000009";

const FACTS: Record<string, MetricFacts> = {
  [FLOW]: { name: "Revenue", apps: ["stripe"] },
  [FLOW_B]: { name: "Booked calls", apps: ["calendly"] },
  [FLOW_C]: { name: "Closed", apps: ["close"] },
  [METRIC]: { name: "Leads", apps: ["typeform"] },
};
const facts = (k: string) => FACTS[k];

function custom(tiles: SourceView["tiles"], name = "Overview"): SourceView {
  return { name, kind: "custom", tiles, groups: [], placements: [], calendarKey: null, notes: new Map() };
}

const tile = (over: Partial<SourceView["tiles"][number]> = {}): SourceView["tiles"][number] => ({
  tileKey: FLOW,
  chart: "number",
  config: {},
  x: 0,
  y: 0,
  w: 3,
  h: 4,
  ...over,
});

describe("what never leaves the workspace", () => {
  const snap = buildSnapshot(
    [
      custom([
        tile({ config: { title: "Cash in", target: 50000, color: "teal", precision: 2, showGoal: true } }),
        tile({ tileKey: FLOW_B, chart: "pipeline", config: { parts: [FLOW_C], exits: [FLOW_C], flow: "across" }, x: 3 }),
        tile({ tileKey: HIDDEN, config: { title: "Client X margin" }, x: 6 }),
      ]),
    ],
    facts,
  );
  const json = JSON.stringify(snap);

  it("carries no tile key, flow id or metric id", () => {
    expect(json).not.toContain("flow:");
    expect(json).not.toContain("metric:");
    expect(json).not.toContain("0b7c2a9e");
  });

  it("carries no goal — the author's target is their business number", () => {
    expect(json).not.toContain("50000");
    expect(json).not.toContain("target");
    expect(json).not.toContain("showGoal");
  });

  it("carries no composed parts or exits", () => {
    expect(json).not.toContain("parts");
    expect(json).not.toContain("exits");
  });

  it("carries not a word about a metric the author cannot see — not even a title typed over it", () => {
    expect(json).not.toContain("Client X");
    expect(json).not.toContain("secret");
  });

  it("does carry presentation", () => {
    const [view] = snap.views;
    if (view.kind !== "custom") throw new Error("expected a custom view");
    expect(view.tiles[0].config).toEqual({ color: "teal", precision: 2 });
    expect(view.tiles[1].config).toEqual({ flow: "across" });
  });
});

describe("the note an empty slot will show", () => {
  const notes = (tiles: SourceView["tiles"]) => {
    const [view] = buildSnapshot([custom(tiles)], facts).views;
    if (view.kind !== "custom") throw new Error("expected a custom view");
    return view.tiles.map((t) => ({ note: t.note, apps: t.apps }));
  };

  it("is the metric's name and its app, with no typing from the author", () => {
    expect(notes([tile()])).toEqual([{ note: "Revenue", apps: ["stripe"] }]);
  });

  it("prefers the title the author gave the tile over the metric's own name", () => {
    expect(notes([tile({ config: { title: "Cash in" } })])).toEqual([{ note: "Cash in", apps: ["stripe"] }]);
  });

  it("prefers a note the author wrote over everything", () => {
    expect(notes([tile({ config: { title: "Cash in", note: "Cash collected, from Stripe — not the CRM" } })])).toEqual([
      { note: "Cash collected, from Stripe — not the CRM", apps: ["stripe"] },
    ]);
  });

  it("names a pipeline's stages in order, and every app they read", () => {
    expect(notes([tile({ tileKey: FLOW_B, chart: "pipeline", config: { parts: [FLOW_C, FLOW] } })])).toEqual([
      { note: "Booked calls → Closed → Revenue", apps: ["calendly", "close", "stripe"] },
    ]);
  });

  it("lists a pie's slices with commas, since a pie is not a sequence", () => {
    expect(notes([tile({ tileKey: FLOW_B, chart: "pie", config: { parts: [FLOW_C] } })])).toEqual([
      { note: "Booked calls, Closed", apps: ["calendly", "close"] },
    ]);
  });

  it("keeps an empty slot's own note, and says nothing for one without", () => {
    expect(
      notes([
        tile({ tileKey: UNSET_TILE_KEY, config: { note: "Show rate" } }),
        tile({ tileKey: UNSET_TILE_KEY, x: 3 }),
      ]),
    ).toEqual([
      { note: "Show rate", apps: [] },
      { note: null, apps: [] },
    ]);
  });

  it("names a classic metric and the sources in its definition", () => {
    expect(notes([tile({ tileKey: METRIC })])).toEqual([{ note: "Leads", apps: ["typeform"] }]);
  });

  it("clips a note to the length a slot can show", () => {
    const [n] = notes([tile({ config: { note: "x".repeat(280) } })]);
    expect(n.note?.length).toBe(280);
  });
});

describe("blocks travel whole", () => {
  it("keeps a text block's words and setting, and gives it no note", () => {
    const [view] = buildSnapshot(
      [custom([tile({ tileKey: "block:text", chart: "text", config: { text: "Week 1 — fill these in", textSize: "lg" } })])],
      facts,
    ).views;
    if (view.kind !== "custom") throw new Error("expected a custom view");
    expect(view.tiles[0]).toMatchObject({ chart: "text", note: null, apps: [], config: { text: "Week 1 — fill these in", textSize: "lg" } });
  });
});

describe("groups and calendars", () => {
  const groups: SourceView = {
    name: "Sales",
    kind: "groups",
    tiles: [],
    groups: [
      { id: "g2", name: "Money", color: "teal", sortKey: "manual", pos: "r" },
      { id: "g1", name: "Calls", color: "nonsense", sortKey: "bogus", pos: "i" },
    ],
    placements: [
      { tileKey: FLOW_C, groupId: "g1", pos: "r" },
      { tileKey: FLOW_B, groupId: "g1", pos: "i" },
      { tileKey: HIDDEN, groupId: "g1", pos: "k" },
      { tileKey: FLOW, groupId: "g2", pos: "i" },
    ],
    calendarKey: null,
    notes: new Map([["group:g2", { note: "Cash only", apps: [] }]]),
  };

  it("keeps the columns in their order, and a bad colour or sort reads as the default", () => {
    const [view] = buildSnapshot([groups], facts).views;
    if (view.kind !== "groups") throw new Error("expected a groups view");
    expect(view.groups.map((g) => [g.name, g.color, g.sortKey])).toEqual([
      ["Calls", "grey", "manual"],
      ["Money", "teal", "manual"],
    ]);
  });

  it("notes a column with its members' names in the author's order — skipping a hidden one", () => {
    const [view] = buildSnapshot([groups], facts).views;
    if (view.kind !== "groups") throw new Error("expected a groups view");
    expect(view.groups[0]).toMatchObject({ note: "Booked calls · Closed", apps: ["calendly", "close"] });
  });

  it("lets the author's column note win, while the apps stay the members'", () => {
    const [view] = buildSnapshot([groups], facts).views;
    if (view.kind !== "groups") throw new Error("expected a groups view");
    expect(view.groups[1]).toMatchObject({ note: "Cash only", apps: ["stripe"] });
  });

  it("notes a calendar with its metric", () => {
    const [view] = buildSnapshot(
      [{ name: "Days", kind: "calendar", tiles: [], groups: [], placements: [], calendarKey: FLOW_B, notes: new Map() }],
      facts,
    ).views;
    expect(view).toEqual({ kind: "calendar", name: "Days", note: "Booked calls", apps: ["calendly"] });
  });
});

describe("reading a stored snapshot back", () => {
  const snap = buildSnapshot([custom([tile({ config: { color: "teal" } })])], facts);

  it("round-trips what it wrote", () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("refuses garbage rather than rendering half of it", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ v: 2, views: [] })).toBeNull();
    expect(parseSnapshot({ v: 1, views: [] })).toBeNull();
    expect(parseSnapshot({ v: 1, views: [{ kind: "custom", name: "x", tiles: [{ chart: "nope" }] }] })).toBeNull();
  });

  it("re-applies the whitelist, so a bag edited in the database cannot widen a copy", () => {
    const tampered = JSON.parse(JSON.stringify(snap));
    tampered.views[0].tiles[0].config.target = 99;
    tampered.views[0].tiles[0].config.parts = [FLOW_B];
    const parsed = parseSnapshot(tampered);
    if (parsed?.views[0].kind !== "custom") throw new Error("expected a custom view");
    expect(parsed.views[0].tiles[0].config).toEqual({ color: "teal" });
  });

  it("keeps a box on the grid even when the author's row said otherwise", () => {
    const [view] = buildSnapshot([custom([tile({ x: 11, w: 6, h: 500, y: -3 })])], facts).views;
    if (view.kind !== "custom") throw new Error("expected a custom view");
    expect(view.tiles[0]).toMatchObject({ x: 6, w: 6, y: 0, h: 60 });
  });
});

describe("the rows a snapshot becomes", () => {
  let n = 0;
  const keys = { viewPos: ["a1", "a2", "a3"], groupPos: (k: number) => Array.from({ length: k }, (_, i) => `g${i + 1}`), id: () => `id${++n}` };

  it("lands every metric slot as an empty tile carrying its note and apps", () => {
    const snap = buildSnapshot(
      [custom([tile(), tile({ tileKey: "block:divider", chart: "divider", x: 3 })])],
      facts,
    );
    const rows = planApply(snap, keys);
    expect(rows.tiles.map((t) => [t.tileKey, t.chart, t.config])).toEqual([
      [UNSET_TILE_KEY, "number", { note: "Revenue", noteApps: ["stripe"] }],
      ["block:divider", "divider", {}],
    ]);
    expect(rows.tiles.every((t) => t.viewId === rows.views[0].id)).toBe(true);
  });

  it("gives columns fresh ids and puts their notes where the board reads them", () => {
    const snap = buildSnapshot(
      [
        {
          name: "Sales",
          kind: "groups",
          tiles: [],
          groups: [{ id: "g1", name: "Calls", color: "teal", sortKey: "manual", pos: "i" }],
          placements: [{ tileKey: FLOW_B, groupId: "g1", pos: "i" }],
          calendarKey: null,
          notes: new Map(),
        },
      ],
      facts,
    );
    const rows = planApply(snap, keys);
    expect(rows.groups).toHaveLength(1);
    expect(rows.groups[0].id).not.toBe("g1");
    expect(rows.notes).toEqual([{ targetKind: "group", targetId: rows.groups[0].id, note: "Booked calls", apps: ["calendly"] }]);
  });

  it("summarizes slots and apps for the page that sells it", () => {
    const snap = buildSnapshot(
      [custom([tile(), tile({ tileKey: FLOW_B, x: 3 }), tile({ tileKey: "block:text", chart: "text", config: { text: "Hi" }, x: 6 })])],
      facts,
    );
    expect(summarize(snap)).toEqual({ views: 1, slots: 2, apps: ["stripe", "calendly"] });
  });
});
