import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, type NodeExecOk } from "@/lib/flow/engine";
import { parseGraph, type Dataset } from "@/lib/flow/types";
import { catalogEntry, fieldAppliesToEventType } from "@/connectors/catalog";
import type { DB } from "@/db/types";

/**
 * How a Get data step READS: paged so one response can never be too large,
 * and gated so a setting that belongs to another kind of record can't
 * silently empty the step.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_read";
const CONN = randomUUID();
const T0 = Date.parse("2026-07-01T12:00:00Z");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
});
afterEach(async () => {
  await close();
});

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });

async function readApp(config: Record<string, unknown>): Promise<Dataset["records"]> {
  const g = parseGraph({ nodes: [N("a", "app", { connectionId: CONN, source: "close", ...config })], edges: [] });
  const res = await runFlow({ db, orgId: ORG }, g);
  const exec = res.nodes.get("a")!;
  if (exec.status !== "ok") throw new Error(exec.error);
  const shape = (exec as NodeExecOk).shape;
  if (shape.kind !== "dataset") throw new Error("expected dataset");
  return shape.records;
}

describe("paged reads", () => {
  /**
   * 2,500 rows crosses the 2,000-row page boundary, and a five-row TIE is
   * placed so the boundary lands inside it — the case a naive keyset gets
   * wrong in both directions (`<` drops the tied rows, `<=` repeats them).
   */
  it("returns every row, in exact order, across a page boundary that splits a timestamp tie", async () => {
    const rows: (typeof events.$inferInsert)[] = [];
    for (let i = 0; i < 2_500; i++) {
      // Sorted newest-first, position ≈ i. Five rows around i=2000 share one
      // timestamp, so the 2,000-row page boundary falls INSIDE the tie: page
      // one ends mid-tie and page two must resume by id, not by timestamp.
      const tie = i >= 1_998 && i <= 2_002;
      rows.push({
        eventId: `page:${String(i).padStart(5, "0")}`,
        orgId: ORG,
        connectionId: CONN,
        source: "close",
        eventType: "call_logged",
        subject: String(i),
        occurredAt: new Date(T0 - (tie ? 2_000 : i) * 60_000),
        properties: { i },
      });
    }
    for (let at = 0; at < rows.length; at += 500) await db.insert(events).values(rows.slice(at, at + 500));

    const records = await readApp({});
    expect(records).toHaveLength(2_500);
    // No duplicates and no drops — the two ways a bad boundary fails.
    expect(new Set(records.map((r) => r.subject)).size).toBe(2_500);

    // The order must match a single unpaged query exactly.
    const expected = (
      await db
        .select({ subject: events.subject })
        .from(events)
        .where(eq(events.orgId, ORG))
        .orderBy(desc(events.occurredAt), desc(events.id))
    ).map((r) => r.subject);
    expect(records.map((r) => r.subject)).toEqual(expected);
  });

  it("dedupe still applies to the WHOLE result, not per page", async () => {
    const rows: (typeof events.$inferInsert)[] = [];
    for (let i = 0; i < 2_100; i++) {
      rows.push({
        eventId: `dup:${i}`,
        orgId: ORG,
        connectionId: CONN,
        source: "close",
        eventType: "call_logged",
        // Two subjects only: a per-page dedupe would leave 2 per page (4),
        // a whole-result dedupe leaves exactly 2.
        subject: i % 2 === 0 ? "a" : "b",
        occurredAt: new Date(T0 - i * 60_000),
        properties: {},
      });
    }
    for (let at = 0; at < rows.length; at += 500) await db.insert(events).values(rows.slice(at, at + 500));

    const records = await readApp({ dedupe: true, dedupeField: "subject" });
    expect(records).toHaveLength(2);
  });
});

describe("record-kind gating", () => {
  it("Close's Pipeline applies to opportunity types only", () => {
    const pipeline = catalogEntry("close")!.flowFields!.find((f) => f.key === "pipelineId")!;
    expect(fieldAppliesToEventType(pipeline, "opportunity_created")).toBe(true);
    expect(fieldAppliesToEventType(pipeline, "lead_created")).toBe(false);
    // "All record types" spans kinds that carry no pipeline at all.
    expect(fieldAppliesToEventType(pipeline, "")).toBe(false);
    expect(fieldAppliesToEventType(pipeline, null)).toBe(false);
    // An ungated field (Calendly's meeting type) is unaffected.
    const meetingType = catalogEntry("calendly")!.flowFields!.find((f) => f.key === "meetingType")!;
    expect(fieldAppliesToEventType(meetingType, "booked")).toBe(true);
  });

  it("a stale Pipeline saved on a lead step is IGNORED, not applied", async () => {
    // THE bug: a flow published while the step read opportunities, then
    // switched to leads, kept filtering on a field leads don't have and read
    // 0 with no explanation. Sabotage: drop the gate in readFilterConds and
    // this returns 0.
    await db.insert(events).values({
      eventId: "lead:1",
      orgId: ORG,
      connectionId: CONN,
      source: "close",
      eventType: "lead_created",
      occurredAt: new Date(T0),
      properties: { lead_id: "L1", data: {} },
    });

    const records = await readApp({ eventType: "lead_created", sourceConfig: { pipelineId: "pipe_a" } });
    expect(records).toHaveLength(1);
  });

  it("a stale gated value is DROPPED when the graph loads, so the config matches what runs", () => {
    // The engine already ignores it, but leaving it stored means the saved
    // graph says one thing and computes another — and the panel correctly
    // hides the control, so the value is invisible AND unclearable.
    // Sabotage: remove the app branch from migrateLegacyGraph and the key
    // survives the round trip.
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN, source: "close", eventType: "lead_created", sourceConfig: { pipelineId: "pipe_a" } }),
      ],
      edges: [],
    });
    const cfg = g.nodes[0].data.config as { sourceConfig: Record<string, unknown> };
    expect(cfg.sourceConfig).toEqual({});
  });

  it("a value that DOES apply survives the load untouched", () => {
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN, source: "close", eventType: "opportunity_created", sourceConfig: { pipelineId: "pipe_a" } }),
      ],
      edges: [],
    });
    const cfg = g.nodes[0].data.config as { sourceConfig: Record<string, unknown> };
    expect(cfg.sourceConfig).toEqual({ pipelineId: "pipe_a" });
  });

  it("still filters opportunities by pipeline — the gate narrows, it does not disable", async () => {
    for (const [id, pipe] of [
      ["o1", "pipe_a"],
      ["o2", "pipe_b"],
    ]) {
      await db.insert(events).values({
        eventId: `opp:${id}`,
        orgId: ORG,
        connectionId: CONN,
        source: "close",
        eventType: "opportunity_created",
        occurredAt: new Date(T0),
        properties: { data: { pipeline_id: pipe } },
      });
    }
    const records = await readApp({ eventType: "opportunity_created", sourceConfig: { pipelineId: "pipe_a" } });
    expect(records).toHaveLength(1);
  });
});
