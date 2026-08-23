import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { flowVersions } from "@/db/schema";
import { createFlow, saveDraft, publishFlow, graphFingerprint, publishedGraphFingerprint } from "@/lib/flow/store";
import { unpublishedCandidateIds, unpublishedFlowIds } from "@/lib/flow/materialize";
import type { DB } from "@/db/types";

/**
 * "YOUR EDITS ARE NOT LIVE YET" — one answer, narrowed in SQL.
 *
 * The builder tests the DRAFT graph; every dashboard tile is computed from the
 * published version. A customer rewrote two Filters, pressed Test, and read the
 * old number off their dashboard for three days because nothing on either
 * screen said the two graphs had parted.
 *
 * Both screens say it now, and `graphFingerprint` — the JS rule the toolbar
 * answers with as you type — is what either screen is allowed to SAY. The
 * Postgres pass exists to keep the dashboard from reading every flow's graph
 * out of the database, so it is asserted here as a filter, not as an answer:
 * it must never miss a real change, it is permitted to over-report, and the
 * confirmed result has to match the builder exactly. A tile and a toolbar that
 * can contradict each other is the defect, not the design.
 */

const ORG = "org_unpub";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

const CONN = "11111111-1111-4111-8111-111111111111";
const base = () => ({
  nodes: [
    {
      id: "a",
      type: "app",
      position: { x: 0, y: 0 },
      data: { config: { connectionId: CONN, source: "webhook", eventType: "booked" }, label: "Get data" },
    },
    {
      id: "f",
      type: "filter",
      position: { x: 300, y: 0 },
      data: { config: { combinator: "and", rules: [{ field: "subject", op: "equals", value: "yes" }] } },
    },
    { id: "out", type: "output", position: { x: 600, y: 0 }, data: { config: { name: "Accepted", viz: "number" } } },
  ],
  edges: [
    { id: "e1", source: "a", target: "f", sourceHandle: null, targetHandle: null },
    { id: "e2", source: "f", target: "out", sourceHandle: null, targetHandle: null },
  ],
  metrics: [],
});

/** Publish `graph`, save `edited` as the draft, then ask all three ways. */
async function answers(graph: unknown, edited: unknown): Promise<{ js: boolean; sql: boolean; shown: boolean }> {
  const flow = await createFlow(db, ORG, "Acceptance Rate");
  await saveDraft(db, ORG, flow.id, graph);
  await publishFlow(db, ORG, flow.id);
  await saveDraft(db, ORG, flow.id, edited);
  const candidates = await unpublishedCandidateIds(db, ORG);
  const confirmed = await unpublishedFlowIds(db, ORG);
  // The client's rule, verbatim: compare the two fingerprints. Written out
  // rather than shared, because this test exists to hold the dashboard to the
  // builder's answer — and a helper both sides called would prove nothing.
  return { js: graphFingerprint(edited) !== graphFingerprint(graph), sql: candidates.has(flow.id), shown: confirmed.has(flow.id) };
}

/**
 * The builder's answer is THE answer, and the marker the dashboard renders is
 * held to it. The SQL pass is held to one thing only: never staying silent
 * about a real change. Naming a flow the fingerprints then clear is allowed —
 * a version cut before a schema default differs in bytes and not in meaning.
 */
async function expectBoth(graph: unknown, edited: unknown, expected: boolean) {
  const { js, sql, shown } = await answers(graph, edited);
  expect({ js, shown }).toEqual({ js: expected, shown: expected });
  if (js) expect(sql, "the candidate filter missed a real change").toBe(true);
}

describe("unpublished changes: what counts as a change", () => {
  it("a freshly published flow has none", async () => {
    await expectBoth(base(), base(), false);
  });

  it("an edited filter rule is a change — the incident, exactly", async () => {
    const edited = base();
    edited.nodes[1].data.config = { combinator: "and", rules: [{ field: "subject", op: "equals", value: "no" }] };
    await expectBoth(base(), edited, true);
  });

  it("rewiring the steps is a change", async () => {
    const edited = base();
    edited.edges = [{ id: "e2", source: "a", target: "out", sourceHandle: null, targetHandle: null }];
    await expectBoth(base(), edited, true);
  });

  it("a metric's presentation is a change — the tile renders it", async () => {
    const published = base();
    const edited = base();
    edited.metrics = [{ nodeId: "out", enabled: true, name: "Accepted", viz: "number", format: "percent", precision: 1, target: null }] as never;
    await expectBoth(published, edited, true);
  });

  it("dragging a card across the canvas is NOT a change", async () => {
    const edited = base();
    edited.nodes[1].position = { x: 940, y: 220 };
    await expectBoth(base(), edited, false);
  });

  it("running a Test after publishing is NOT a change", async () => {
    // The cached Test result rides in the draft graph, so a step tested after
    // publish would otherwise flag the flow as edited for the rest of its life.
    const edited = base();
    (edited.nodes[1].data as { lastTest?: unknown }).lastTest = { status: "ok", recordsOut: 12, value: 12 };
    await expectBoth(base(), edited, false);
  });

  it("renaming a step in the builder is NOT a change — the tile never shows it", async () => {
    const edited = base();
    edited.nodes[0].data.label = "Calendar invites";
    await expectBoth(base(), edited, false);
  });

  it("redrawing the identical wire is NOT a change, whatever id it gets", async () => {
    const edited = base();
    edited.edges[0].id = "e_redrawn_9f3a";
    await expectBoth(base(), edited, false);
  });

  it("key order in a step's config is not content", async () => {
    const edited = base();
    edited.nodes[1].data.config = { rules: [{ op: "equals", value: "yes", field: "subject" }], combinator: "and" };
    await expectBoth(base(), edited, false);
  });
});

describe("unpublished changes: what the dashboard will claim", () => {
  it("says nothing about a flow it cannot compare", async () => {
    // Never published: there is no version row to compare against, so the
    // marker stays off rather than guessing. (The builder answers this case
    // from `publishedVersion` instead — nothing is live at all.)
    const flow = await createFlow(db, ORG, "Draft only");
    await saveDraft(db, ORG, flow.id, base());
    expect((await unpublishedFlowIds(db, ORG)).has(flow.id)).toBe(false);
  });

  it("stays out of other orgs", async () => {
    const flow = await createFlow(db, ORG, "Mine");
    await saveDraft(db, ORG, flow.id, base());
    await publishFlow(db, ORG, flow.id);
    const edited = base();
    edited.nodes[1].data.config = { combinator: "and", rules: [] };
    await saveDraft(db, ORG, flow.id, edited);
    expect((await unpublishedFlowIds(db, "org_someone_else")).has(flow.id)).toBe(false);
  });

  it("drops the marker again once the edits are published", async () => {
    const flow = await createFlow(db, ORG, "Acceptance Rate");
    await saveDraft(db, ORG, flow.id, base());
    await publishFlow(db, ORG, flow.id);
    const edited = base();
    edited.nodes[1].data.config = { combinator: "and", rules: [{ field: "subject", op: "equals", value: "no" }] };
    await saveDraft(db, ORG, flow.id, edited);
    expect((await unpublishedFlowIds(db, ORG)).has(flow.id)).toBe(true);
    await publishFlow(db, ORG, flow.id);
    expect((await unpublishedFlowIds(db, ORG)).has(flow.id)).toBe(false);
  });

  it("does not accuse a flow whose published version predates a schema default", async () => {
    // The false alarm this split exists to stop. `metrics[].durationDisplay`
    // gained a default AFTER metrics[] shipped, so a version row cut in that
    // window has no such key while every saveDraft re-parses one into the
    // draft. Drag a card — not a change, by the rules above — and the stored
    // bytes part company: the tile said "Edited since publishing" about a flow
    // whose editor showed no pill.
    const withMetric = () => ({
      ...base(),
      metrics: [{ nodeId: "out", enabled: true, name: "Time to first call", viz: "number", format: "duration", unit: "minutes" }],
    });
    const flow = await createFlow(db, ORG, "Speed to lead");
    await saveDraft(db, ORG, flow.id, withMetric());
    await publishFlow(db, ORG, flow.id);

    // The version row as it would have been written before the default existed.
    const where = and(eq(flowVersions.flowId, flow.id), eq(flowVersions.version, 1));
    const [row] = await db.select({ graph: flowVersions.graph }).from(flowVersions).where(where);
    const older = row.graph as { metrics: Array<Record<string, unknown>> };
    delete older.metrics[0].durationDisplay;
    await db.update(flowVersions).set({ graph: older }).where(where);

    const dragged = withMetric();
    dragged.nodes[1].position = { x: 940, y: 220 };
    await saveDraft(db, ORG, flow.id, dragged);

    expect((await unpublishedCandidateIds(db, ORG)).has(flow.id)).toBe(true);
    expect((await unpublishedFlowIds(db, ORG)).has(flow.id)).toBe(false);
  });
});

describe("the fingerprint itself", () => {
  it("is stable across serializations of the same flow", () => {
    expect(graphFingerprint(base())).toBe(graphFingerprint(base()));
  });

  it("treats a graph that cannot be published as diverged, never as live", () => {
    // `saveDraft` parses too, so an unparseable draft never reached the
    // server — it cannot be what the dashboard is computing from.
    const unparseable = { nodes: [{ id: "x", type: "not_a_step" }], edges: [] };
    expect(graphFingerprint(unparseable)).not.toBe(graphFingerprint(base()));
  });

  it("keeps two graphs that cannot parse apart from each other", () => {
    // A single "unparseable" token gave every graph that will not parse the
    // same fingerprint, so two unrelated broken graphs read as identical —
    // "your edits are live" about a version sharing nothing with the draft.
    const a = { nodes: [{ id: "x", type: "not_a_step" }], edges: [] };
    const b = { nodes: [{ id: "x", type: "another_missing_step" }], edges: [] };
    expect(graphFingerprint(a)).not.toBe(graphFingerprint(b));
    // Still one answer per graph, or the pill would flicker as you type.
    expect(graphFingerprint(a)).toBe(graphFingerprint({ nodes: [{ id: "x", type: "not_a_step" }], edges: [] }));
  });

  it("distinguishes two flows that differ only in a metric spec", () => {
    // The metric spec is what the dashboard renders — a changed target or
    // precision is a changed tile, even with every step untouched.
    const withTarget = { ...base(), metrics: [{ nodeId: "calc", name: "Acceptance Rate", enabled: true, target: 50 }] };
    expect(graphFingerprint(withTarget)).not.toBe(graphFingerprint(base()));
  });
});

describe("the published fingerprint the editor opens with", () => {
  it("is the whole graph's answer, computed without reading the Test payloads", async () => {
    // The projection in the SELECT (`graphForFingerprint`) is only allowed to
    // drop what the fingerprint already ignores. If it ever drops more, the
    // editor opens claiming edits are live that are not — so the projected
    // answer is held against the full graph's, cached samples and all.
    const flow = await createFlow(db, ORG, "Speed to lead");
    const g = {
      ...base(),
      metrics: [{ nodeId: "out", enabled: true, name: "Accepted", viz: "number", format: "percent", precision: 1, target: 40 }],
    };
    (g.nodes[1].data as { lastTest?: unknown }).lastTest = {
      status: "ok",
      recordsOut: 2,
      sample: [{ id: "r1", properties: { subject: "yes" } }],
      inputSample: [{ id: "r0", properties: { subject: "no" } }],
      tile: { value: 2, format: "number" },
    };
    await saveDraft(db, ORG, flow.id, g);
    const { version } = await publishFlow(db, ORG, flow.id);

    expect(await publishedGraphFingerprint(db, ORG, flow.id, version)).toBe(graphFingerprint(g));
  });

  it("is null for a version that is not there, never a match", async () => {
    // No fingerprint means the toolbar warns; a fabricated one would mean it
    // claimed the draft was live against a version nobody could read.
    const flow = await createFlow(db, ORG, "Acceptance Rate");
    await saveDraft(db, ORG, flow.id, base());
    expect(await publishedGraphFingerprint(db, ORG, flow.id, 7)).toBeNull();
  });
});
