import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, sampleAppFields } from "@/lib/flow/engine";
import { computeAggregate, computeFunnel, distinctEventTypes, distinctSources, queryEvents } from "@/lib/metrics/compute";
import { parseDefinition } from "@/lib/metrics/types";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * THE TENANT-ISOLATION NET. Until this file, isolation rested on every query
 * author remembering `orgId` in the WHERE — twenty-plus read sites over
 * `events` alone, no row-level security under them, and not one test that
 * would fail if a site forgot. A forgotten predicate does not error, does not
 * slow down, and does not look wrong; it shows one customer another customer's
 * revenue. That is the worst silent failure this product can have, so it gets
 * the same treatment every other silent failure here got: a test that turns it
 * loud.
 *
 * THE FIXTURE IS ADVERSARIAL BY CONSTRUCTION. Both orgs hold data of the SAME
 * source, the SAME event types, the SAME subjects, in the SAME window — so no
 * read can pass by luck of the fixture. Any surface that drops its org
 * predicate sees exactly double the rows (or the neighbour's distinctive
 * marker), and the assertion pins the single-org number.
 *
 * The surfaces driven are the REAL ones — the flow engine's fallback scan, the
 * metrics aggregates, the funnel, the feed, the builder dropdowns — called
 * exactly as production calls them. Deliberately NOT a unit test of
 * `appConds`/`baseWhere`: a helper can be perfect while a call site skips it.
 *
 * The sharpest cases carry no connection filter at all (`source` only),
 * because a connectionId incidentally isolates — the org predicate is the ONLY
 * thing standing between the tenants there.
 */

let db: DB;
let close: () => Promise<void>;

const ORG_A = "org_alpha";
const ORG_B = "org_beta";
let connA = "";
let connB = "";

const RANGE = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-07-01T00:00:00Z") };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connA = randomUUID();
  connB = randomUUID();
  for (const [orgId, id] of [
    [ORG_A, connA],
    [ORG_B, connB],
  ] as const) {
    await db.insert(connections).values({ id, orgId, source: "close", name: "close", status: "active", authType: "apiKey", config: {} });
  }

  // Identical SHAPE in both orgs — same source, same event types, same values,
  // same instant — so no count can pass by luck of the fixture. The SUBJECTS
  // differ per org, deliberately: a `count(distinct subject)` surface (the
  // funnel) collapses a cross-org leak when the neighbours' subjects are
  // byte-identical, which was measured under sabotage before this fixture was
  // corrected. Org B additionally carries a marker property, an extra event
  // type and an extra source — each exists ONLY to show up when a surface leaks.
  const at = new Date("2026-06-01T12:00:00Z");
  const seed = async (orgId: string, connectionId: string, marker: boolean) => {
    const tag = marker ? "b" : "a";
    const rows = [
      { eventType: "booked", subject: `s1-${tag}`, value: "10" },
      { eventType: "booked", subject: `s2-${tag}`, value: "20" },
      { eventType: "canceled", subject: `s3-${tag}`, value: null },
    ];
    for (const r of rows) {
      await db.insert(events).values({
        eventId: `close:${connectionId}:${r.eventType}:${r.subject}`,
        orgId,
        connectionId,
        source: "close",
        eventType: r.eventType,
        subject: r.subject,
        occurredAt: at,
        value: r.value,
        properties: marker ? { leaked_from_org_b: true } : { plain: true },
      });
    }
    if (marker) {
      await db.insert(events).values({
        eventId: `close:${connectionId}:neighbour-only`,
        orgId,
        connectionId,
        source: "sendblue",
        eventType: "neighbour_only_type",
        subject: "s9",
        occurredAt: at,
        properties: { leaked_from_org_b: true },
      });
    }
  };
  await seed(ORG_A, connA, false);
  await seed(ORG_B, connB, true);
});
afterEach(async () => {
  await close();
});

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });

describe("the flow engine reads one org", () => {
  it("an app step scoped only by source counts its own org's rows alone", async () => {
    const g = parseGraph({
      nodes: [N("a", "app", { source: "close" }), N("o", "output", { title: "t", format: "number" })],
      edges: [E("a", "o")],
    });
    const res = await runFlow({ db, orgId: ORG_A }, g);
    const app = res.nodes.get("a")!;
    // Three in org A, three identical in org B. Six means the org predicate fell out.
    expect(app.recordsOut).toBe(3);
  });

  it("field sampling never surfaces a neighbour's property keys", async () => {
    const fields = await sampleAppFields({ db, orgId: ORG_A }, { source: "close" });
    const names = fields.map((f) => f.path).join(",");
    expect(names).toContain("plain");
    expect(names).not.toContain("leaked_from_org_b");
  });
});

describe("metrics read one org", () => {
  it("a source-only aggregate counts one org", async () => {
    const def = parseDefinition({ kind: "aggregate", source: "close", eventType: "booked" });
    if (def.kind !== "aggregate") throw new Error("unreachable");
    const res = await computeAggregate(db, ORG_A, def, RANGE);
    expect(res).toEqual({ kind: "scalar", value: 2 });
  });

  it("a sum aggregates one org's values", async () => {
    const def = parseDefinition({ kind: "aggregate", source: "close", eventType: "booked", aggregation: "sum" });
    if (def.kind !== "aggregate") throw new Error("unreachable");
    const res = await computeAggregate(db, ORG_A, def, RANGE);
    // 10 + 20 in org A; 60 would mean both orgs were summed.
    expect(res).toEqual({ kind: "scalar", value: 30 });
  });

  it("a time-bucketed series stays single-org", async () => {
    const def = parseDefinition({ kind: "aggregate", source: "close", eventType: "booked", timeBucket: "day" });
    if (def.kind !== "aggregate") throw new Error("unreachable");
    const res = await computeAggregate(db, ORG_A, def, RANGE);
    if (res.kind !== "series") throw new Error("expected series");
    expect(res.series).toEqual([{ bucket: "2026-06-01", value: 2 }]);
  });

  it("a funnel counts one org's subjects per stage", async () => {
    const def = parseDefinition({
      kind: "funnel",
      stages: [
        { label: "booked", source: "close", eventType: "booked" },
        { label: "canceled", source: "close", eventType: "canceled" },
      ],
    });
    if (def.kind !== "funnel") throw new Error("unreachable");
    const res = await computeFunnel(db, ORG_A, def, RANGE);
    expect(res.stages.map((s) => s.count)).toEqual([2, 1]);
  });

  it("the event feed returns one org's rows", async () => {
    const rows = await queryEvents(db, ORG_A, { source: "close", range: RANGE });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.orgId === ORG_A)).toBe(true);
  });

  it("builder dropdowns never list a neighbour's sources or event types", async () => {
    expect(await distinctSources(db, ORG_A)).toEqual(["close"]); // sendblue exists only in org B
    expect(await distinctEventTypes(db, ORG_A, null)).not.toContain("neighbour_only_type");
  });

  /**
   * THE WRITE-SIDE HOLE THE READ TESTS CANNOT SEE. `events.event_id` is
   * globally unique with no org in the key, and the upsert's SET list never
   * re-asserts org or connection — so a colliding id from org B's connection
   * would overwrite org A's row CONTENT while `org_id` stayed A. Every
   * org-scoped read above would then serve B's data to A with its predicates
   * fully intact, which is why this needs its own test: the leak lives inside
   * a row, not across a WHERE clause. Unreachable today (every connector
   * namespaces ids with the connection UUID); this pins the guard for the
   * connector that forgets.
   */
  it("a cross-connection event_id collision cannot overwrite another tenant's row", async () => {
    const { upsertEvents } = await import("@/ingestion/pipeline");
    const shared = "unnamespaced:collision";
    await upsertEvents(db, { orgId: ORG_A, connectionId: connA, source: "close", generation: 1 }, [
      { eventId: shared, eventType: "booked", subject: "a-subject", occurredAt: new Date("2026-06-02T00:00:00Z"), properties: { owner: "A" } },
    ]);

    // Org B collides at a HIGHER generation — the strongest overwrite claim
    // the ratchet knows. The guard must still refuse it.
    const res = await upsertEvents(db, { orgId: ORG_B, connectionId: connB, source: "close", generation: 9 }, [
      { eventId: shared, eventType: "stolen", subject: "b-subject", occurredAt: new Date("2026-06-03T00:00:00Z"), properties: { owner: "B" } },
    ]);

    expect(res.inserted).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.deduped).toBe(1); // suppressed, visibly counted as a no-op

    const [row] = await db.select().from(events).where(eq(events.eventId, shared));
    expect(row.orgId).toBe(ORG_A);
    expect(row.connectionId).toBe(connA);
    expect(row.eventType).toBe("booked");
    expect(row.subject).toBe("a-subject");
    expect(row.properties).toEqual({ owner: "A" });
    expect(row.syncGeneration).toBe(1);
  });

  it("the guard does not over-tighten: the SAME connection still updates on redelivery", async () => {
    const { upsertEvents } = await import("@/ingestion/pipeline");
    const id = "same-conn:redelivery";
    await upsertEvents(db, { orgId: ORG_A, connectionId: connA, source: "close", generation: 1 }, [
      { eventId: id, eventType: "booked", subject: "v1", occurredAt: new Date("2026-06-02T00:00:00Z") },
    ]);
    const res = await upsertEvents(db, { orgId: ORG_A, connectionId: connA, source: "close", generation: 2 }, [
      { eventId: id, eventType: "booked", subject: "v2", occurredAt: new Date("2026-06-02T00:00:00Z") },
    ]);

    expect(res.updated).toBe(1);
    const [row] = await db.select().from(events).where(eq(events.eventId, id));
    expect(row.subject).toBe("v2");
    expect(row.syncGeneration).toBe(2);
  });
});
