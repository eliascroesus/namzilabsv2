import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, sampleAppFields } from "@/lib/flow/engine";
import { recordFields } from "@/lib/schema-registry/registry";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

const ORG = "org_f";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function ev(o: {
  orgId?: string;
  source?: string;
  eventType: string;
  subject?: string | null;
  value?: number;
  properties?: Record<string, unknown>;
  daysAgo?: number;
}) {
  await db.insert(events).values({
    eventId: `${o.source ?? "webhook"}:${randomUUID()}`,
    orgId: o.orgId ?? ORG,
    connectionId: CONN,
    source: o.source ?? "webhook",
    eventType: o.eventType,
    subject: o.subject ?? null,
    occurredAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
    value: o.value != null ? String(o.value) : null,
    properties: o.properties ?? {},
  });
}

// graph helpers
const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const G = (nodes: unknown[], edges: unknown[]) => parseGraph({ nodes, edges });

describe("flow engine — App → Filter → Aggregate → Output", () => {
  it("counts all app records, tracking records in/out per node", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "booked", subject: "c" });
    await ev({ eventType: "canceled", subject: "d" });

    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", { name: "Total events" }),
      ],
      [E("a", "agg"), E("agg", "out")],
    );
    const res = await runFlow({ db, orgId: ORG }, g);

    expect(res.outputs).toHaveLength(1);
    expect(res.outputs[0].tile.value).toBe(4);
    const app = res.nodes.get("a")!;
    const agg = res.nodes.get("agg")!;
    expect(app.recordsOut).toBe(4);
    expect(agg.recordsIn).toBe(4);
    expect(agg.recordsOut).toBe(1);
  });

  it("filters before aggregating (booked leads)", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "canceled", subject: "c" });

    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", { name: "Booked" }),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "out")],
    );
    const res = await runFlow({ db, orgId: ORG }, g);
    expect(res.nodes.get("f")!.recordsIn).toBe(3);
    expect(res.nodes.get("f")!.recordsOut).toBe(2);
    expect(res.outputs[0].tile.value).toBe(2);
  });

  it("sums, averages and counts distinct", async () => {
    await ev({ eventType: "deal", subject: "a", value: 100 });
    await ev({ eventType: "deal", subject: "a", value: 300 });
    await ev({ eventType: "deal", subject: "b", value: 200 });

    const sum = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "sum", field: "value" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    expect(sum.outputs[0].tile.value).toBe(600);

    const avg = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "avg", field: "value" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    expect(avg.outputs[0].tile.value).toBe(200);

    const distinct = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count_distinct", distinctField: "subject" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    expect(distinct.outputs[0].tile.value).toBe(2);
  });

  it("produces a time series and a grouped result", async () => {
    await ev({ eventType: "booked", subject: "a", daysAgo: 1 });
    await ev({ eventType: "booked", subject: "b", daysAgo: 1 });
    await ev({ eventType: "booked", subject: "c", daysAgo: 3 });

    const series = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count", groupBy: { type: "time", unit: "day" } }), N("o", "output", { viz: "line" })], [E("a", "agg"), E("agg", "o")]),
    );
    expect(series.outputs[0].tile.series).toHaveLength(2);
    expect(series.outputs[0].tile.value).toBe(3);

    await ev({ eventType: "booked", subject: "x", source: "calendly", properties: { rep: "sam" } });
    await ev({ eventType: "booked", subject: "y", source: "calendly", properties: { rep: "sam" } });
    const grouped = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count", groupBy: { type: "field", field: "properties.rep" } }), N("o", "output", { viz: "category" })], [E("a", "agg"), E("agg", "o")]),
    );
    const groups = grouped.outputs[0].tile.groups!;
    expect(groups.find((g) => g.label === "sam")!.value).toBe(2);
  });

  it("supports rich filter operators", async () => {
    await ev({ eventType: "deal", subject: "a", value: 500 });
    await ev({ eventType: "deal", subject: "b", value: 50 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "value", op: "gt", value: "100" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    expect((await runFlow({ db, orgId: ORG }, g)).outputs[0].tile.value).toBe(1);
  });

  it("supports starts_with / ends_with string operators", async () => {
    await ev({ eventType: "signup", subject: "alice@acme.com" });
    await ev({ eventType: "signup", subject: "bob@other.com" });
    await ev({ eventType: "signup", subject: "carol@acme.com" });
    const starts = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "subject", op: "starts_with", value: "a" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    expect((await runFlow({ db, orgId: ORG }, starts)).outputs[0].tile.value).toBe(1);

    const ends = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "subject", op: "ends_with", value: "@acme.com" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    expect((await runFlow({ db, orgId: ORG }, ends)).outputs[0].tile.value).toBe(2);
  });

  it("is tenant isolated", async () => {
    await ev({ eventType: "booked", subject: "mine" });
    await ev({ eventType: "booked", subject: "theirs", orgId: "org_other" });
    const g = G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]);
    expect((await runFlow({ db, orgId: ORG }, g)).outputs[0].tile.value).toBe(1);
  });

  it("runs only up to a target node when testing that node", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { rules: [] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    expect(res.nodes.has("f")).toBe(true);
    expect(res.nodes.has("agg")).toBe(false); // downstream not executed
    expect(res.nodes.get("f")!.recordsOut).toBe(2);
  });

  /**
   * The preview is labelled "Latest N records", so it has to be the latest ones.
   *
   * Newest-by-occurred_at used to mean that, and stopped once a source started
   * dating records by when they WILL happen: Calendly stores a meeting at its
   * start time and reads a year ahead, so the top of the list became appointments
   * eleven months out — under a label promising the opposite. The dataset's own
   * order is untouched (execApp's dedupe depends on newest-first); only the
   * sample is re-ordered.
   */
  it("previews what just happened first, then what is coming up soonest", async () => {
    await ev({ eventType: "booked", subject: "yesterday", daysAgo: 1 });
    await ev({ eventType: "booked", subject: "last week", daysAgo: 7 });
    await ev({ eventType: "booked", subject: "next month", daysAgo: -30 });
    await ev({ eventType: "booked", subject: "next year", daysAgo: -300 });

    const res = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    const app = res.nodes.get("a")!;
    if (app.status !== "ok") throw new Error("app step failed");
    // A plain newest-first sort would lead with "next year" — the least
    // recognisable row a preview could open with.
    expect(app.sample.map((r) => r.subject)).toEqual(["yesterday", "last week", "next month"]);
    // …and the dataset itself still runs newest-first, which dedupe relies on.
    expect(app.shape.kind).toBe("dataset");
    if (app.shape.kind === "dataset") {
      expect(app.shape.records.map((r) => r.subject)).toEqual(["next year", "next month", "yesterday", "last week"]);
    }
  });

  /**
   * TIE SEMANTICS pin for the preview's top-k selection. The old full sort
   * was V8-stable, so equal occurred_at resolved to input order — the SQL's
   * `occurred_at DESC, id DESC` at the app node. The selection scan must
   * displace an incumbent only on STRICT improvement to give the identical
   * answer; a `>=`-style displacement would silently reverse tie order.
   */
  it("preview ties keep dataset order (strict-improvement selection ≡ stable sort)", async () => {
    // Three rows sharing one instant, one newer row. Dataset order is
    // occurred_at DESC, id DESC; the tied trio's relative order in the sample
    // must match the dataset's, whatever it is.
    await ev({ eventType: "booked", subject: "tie-1", daysAgo: 2 });
    await ev({ eventType: "booked", subject: "tie-2", daysAgo: 2 });
    await ev({ eventType: "booked", subject: "tie-3", daysAgo: 2 });
    await ev({ eventType: "booked", subject: "newest", daysAgo: 1 });

    const res = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    const app = res.nodes.get("a")!;
    if (app.status !== "ok" || app.shape.kind !== "dataset") throw new Error("app step failed");

    const datasetTies = app.shape.records.filter((r) => r.subject?.startsWith("tie-")).map((r) => r.subject);
    expect(app.sample[0].subject).toBe("newest");
    // The two tied rows that made the top-3 appear in DATASET order.
    expect(app.sample.slice(1).map((r) => r.subject)).toEqual(datasetTies.slice(0, 2));
  });

  it("sampleAppFields lists a step's real data fields from its synced events", async () => {
    await ev({ eventType: "row_added", subject: "a@b.com", properties: { Email: "a@b.com", Plan: "pro" } });
    await ev({ eventType: "row_added", subject: "c@d.com", properties: { Email: "c@d.com", Plan: "free" } });
    const fields = await sampleAppFields({ db, orgId: ORG }, { connectionId: CONN });
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("properties.Email"); // the user's own columns are pickable
    expect(paths).toContain("properties.Plan");
    expect(paths).toContain("subject");
    expect(paths.every((p) => !p.startsWith("__"))).toBe(true); // engine internals hidden
  });

  it("serves the picker from the field registry, and keeps fields the sample would miss", async () => {
    // The registry knows the UNION of everything ever synced. A 100-row sample
    // does not: a column that stopped being filled is still a real column, and
    // the scan silently drops it from every picker.
    await recordFields(
      db,
      { orgId: ORG, connectionId: CONN, streamHash: null },
      [
        { eventId: "r1", eventType: "row", occurredAt: new Date(), properties: { Email: "a@b.com", Retired: "old" } },
        { eventId: "r2", eventType: "row", occurredAt: new Date(), properties: { Email: "c@d.com" } },
      ],
    );
    // Only ONE event exists, and it does not carry `Retired` at all.
    await ev({ eventType: "row_added", subject: "z@z.com", properties: { Email: "z@z.com" } });

    const fields = await sampleAppFields({ db, orgId: ORG }, { connectionId: CONN });
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("properties.Retired"); // registry remembers it; a scan would not
    expect(paths).toContain("properties.Email");
    expect(paths).toContain("subject"); // spine fields still present
    // Types are built by the same helper as the scan path, so the picker's icons
    // don't change depending on which path served the request.
    expect(fields.find((f) => f.path === "properties.Email")?.type).toBe("email");
  });

  it("falls back to the sample scan when the stream has nothing registered yet", async () => {
    // A connection synced before A.1, or whose first sweep hasn't landed.
    await ev({ eventType: "row_added", subject: "a@b.com", properties: { OnlyInEvents: "x" } });
    const fields = await sampleAppFields({ db, orgId: ORG }, { connectionId: CONN });
    expect(fields.map((f) => f.path)).toContain("properties.OnlyInEvents");
  });

  it("Calculate runs dataset aggregations directly (the merged Count node)", async () => {
    await ev({ eventType: "deal", subject: "a", value: 100 });
    await ev({ eventType: "deal", subject: "a", value: 300 });
    await ev({ eventType: "deal", subject: "b", value: 200 });
    const calc = async (config: Record<string, unknown>) => {
      const g = G([N("a", "app", { connectionId: CONN }), N("c", "formula", config)], [E("a", "c")]);
      const c = (await runFlow({ db, orgId: ORG }, g, { untilNodeId: "c" })).nodes.get("c")!;
      expect(c.status).toBe("ok");
      return (c as { shape: { kind: string; value?: number } }).shape;
    };
    expect((await calc({ op: "count" })).value).toBe(3);
    expect((await calc({ op: "sum", field: "value" })).value).toBe(600);
    expect((await calc({ op: "avg", field: "value" })).value).toBe(200);
    expect((await calc({ op: "min", field: "value" })).value).toBe(100);
    expect((await calc({ op: "max", field: "value" })).value).toBe(300);
    expect((await calc({ op: "count_distinct", distinctField: "subject" })).value).toBe(2);
  });

  it("a dataset Calculate can split over time (trend), like the old Count node", async () => {
    await ev({ eventType: "booked", daysAgo: 1 });
    await ev({ eventType: "booked", daysAgo: 1 });
    await ev({ eventType: "booked", daysAgo: 3 });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("c", "formula", { op: "count", groupBy: { type: "time", unit: "day" } }), N("o", "output", { viz: "line" })],
      [E("a", "c"), E("c", "o")],
    );
    const res = await runFlow({ db, orgId: ORG }, g);
    expect(res.outputs[0].tile.series).toHaveLength(2);
    expect(res.outputs[0].tile.value).toBe(3);
  });

  it("legacy Count (aggregate) nodes migrate to the unified Calculate on parse", async () => {
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "sum", field: "value", groupBy: { type: "time", unit: "week" } })],
      [E("a", "agg")],
    );
    const migrated = g.nodes.find((n) => n.id === "agg")!;
    expect(migrated.type).toBe("formula");
    expect(migrated.data.config).toMatchObject({ op: "sum", field: "value", groupBy: { type: "time", unit: "week" } });
  });

  it("errors clearly when a dataset Calculate has no records flowing in", async () => {
    await ev({ eventType: "x" });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("cnt", "formula", { op: "count" }), N("c", "formula", { op: "sum", field: "value" })],
      // c's only input is a scalar wired to handle "a" — no chain dataset.
      [E("a", "cnt"), { id: "cnt->c", source: "cnt", target: "c", targetHandle: "a" }],
    );
    const res = await runFlow({ db, orgId: ORG }, g);
    const c = res.nodes.get("c")!;
    expect(c.status).toBe("error");
    expect((c as { error: string }).error).toMatch(/records flowing in/);
  });

  it("Calculate (formula) compares data-step record counts (Output numbers)", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "booked", subject: "c" });
    await ev({ eventType: "canceled", subject: "d" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("calc", "formula", { op: "percentage" }),
      ],
      // Numerator (a) = the filter's passed count; denominator (b) = the app's loaded count.
      [E("a", "f"), { id: "f->calc", source: "f", target: "calc", targetHandle: "a" }, { id: "a->calc", source: "a", target: "calc", targetHandle: "b" }],
    );
    const res = await runFlow({ db, orgId: ORG }, g);
    const calc = res.nodes.get("calc")!;
    expect(calc.status).toBe("ok");
    expect((calc as { shape: { value: number } }).shape.value).toBe(75); // 3 passed ÷ 4 loaded × 100
  });
});

/**
 * Meeting type narrows the READ, not the sync — the fix for a step that showed
 * `0 loaded` the moment a type was picked.
 *
 * It used to be an ordinary `sourceConfig` key, so it entered `streamConfigHash`
 * and gave that step its own stream: a fresh cursor, no rows, and a scan that
 * had to start over before anything appeared. Every flow on the connection now
 * reads ONE stream and the choice is a WHERE clause over it, so switching types
 * is instant and can never point at an empty stream.
 */
describe("read filters — a setting the provider cannot act on", () => {
  const CAL = { scope: "organization" };
  const AAA = "https://api.calendly.com/event_types/AAA";
  const BBB = "https://api.calendly.com/event_types/BBB";

  /** One shared Calendly stream, holding both meeting types. */
  async function seedShared() {
    await db.insert(connections).values({ id: CONN, orgId: ORG, source: "calendly", name: "Calendly", status: "active", authType: "oauth2" });
    const streamHash = streamConfigHash(CAL, "calendly");
    const rows = [
      { uri: "M1", type: AAA, name: "Invite Only Creator Program" },
      { uri: "M2", type: BBB, name: "Invite Only Creator Program" }, // same NAME, different type
      { uri: "M3", type: AAA, name: "Invite Only Creator Program" },
      { uri: "M4", type: "https://api.calendly.com/event_types/CCC", name: "30 Minute Meeting" },
    ];
    for (const r of rows) {
      await db.insert(events).values({
        eventId: `calendly:${CONN}:${streamHash}:${r.uri}`,
        orgId: ORG,
        connectionId: CONN,
        source: "calendly",
        streamHash,
        eventType: "booked",
        subject: r.name,
        occurredAt: new Date(Date.now() - 86_400_000),
        properties: { event_type: r.type, meeting_type: r.name },
      });
    }
  }

  const countWith = async (sourceConfig: Record<string, unknown>) => {
    const res = await runFlow(
      { db, orgId: ORG },
      G(
        [N("a", "app", { connectionId: CONN, source: "calendly", sourceConfig }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})],
        [E("a", "agg"), E("agg", "o")],
      ),
    );
    return res.nodes.get("a")!.recordsOut;
  };

  it("reads the shared stream and returns only the chosen type — no second stream, no zero", async () => {
    await seedShared();
    expect(await countWith(CAL)).toBe(4); // everything the sync holds
    expect(await countWith({ ...CAL, meetingType: AAA })).toBe(2);
    // The other of two SAME-NAMED types selects only itself, which is the whole
    // reason the value is the type's URI rather than its name.
    expect(await countWith({ ...CAL, meetingType: BBB })).toBe(1);
    expect(await countWith({ ...CAL, meetingType: "https://api.calendly.com/event_types/NOPE" })).toBe(0);
  });

  it("does not fork the stream — a filtered step reads exactly what an unfiltered one wrote", async () => {
    // If meetingType entered the identity these would differ, and the filtered
    // step would read a hash nothing was ever written under.
    expect(streamConfigHash({ ...CAL, meetingType: AAA }, "calendly")).toBe(streamConfigHash(CAL, "calendly"));
    // Settings the provider CAN act on still must fork it.
    expect(streamConfigHash({ ...CAL, status: "active" }, "calendly")).not.toBe(streamConfigHash(CAL, "calendly"));
  });

  it("still honors a meeting type saved as a NAME, from before the value was a URI", async () => {
    await seedShared();
    // Both same-named types match, which is what that config always meant.
    expect(await countWith({ ...CAL, meetingType: "Invite Only Creator Program" })).toBe(3);
    expect(await countWith({ ...CAL, meetingType: "30 Minute Meeting" })).toBe(1);
  });
});

/**
 * Close's Pipeline read filter on a CONNECTION-scoped source (stream_hash
 * null). Two halves that only make sense together: within opportunity
 * records it narrows exactly as Calendly's meetingType does, and OUTSIDE
 * them it does not apply at all — pipelines exist only on opportunities, and
 * a filter that cannot match must never be the reason a step reads zero.
 */
describe("Close pipeline read filter", () => {
  const seedClose = async () => {
    await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
    const rows = [
      { id: "o1", type: "opportunity_created", data: { pipeline_id: "pipe_a", status_label: "Demo" } },
      { id: "o2", type: "opportunity_created", data: { pipeline_id: "pipe_a", status_label: "Won" } },
      { id: "o3", type: "opportunity_created", data: { pipeline_id: "pipe_b", status_label: "Demo" } },
      { id: "s1", type: "sms_sent", data: { to: "+1555" } }, // no pipeline_id — not an opportunity
    ];
    for (const r of rows) {
      await db.insert(events).values({
        eventId: `close:${CONN}:${r.id}`,
        orgId: ORG,
        connectionId: CONN,
        source: "close",
        streamHash: null,
        eventType: r.type,
        occurredAt: new Date(Date.now() - 86_400_000),
        properties: { object_type: r.type === "sms_sent" ? "activity.sms" : "opportunity", action: "created", data: r.data },
      });
    }
  };

  const countWith = async (sourceConfig: Record<string, unknown>, eventType: string | null = "opportunity_created") => {
    const res = await runFlow(
      { db, orgId: ORG },
      G(
        [N("a", "app", { connectionId: CONN, source: "close", eventType, sourceConfig }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})],
        [E("a", "agg"), E("agg", "o")],
      ),
    );
    return res.nodes.get("a")!.recordsOut;
  };

  it("narrows an opportunity step to one pipeline; wrong id reads 0", async () => {
    await seedClose();
    expect(await countWith({})).toBe(3); // every opportunity
    expect(await countWith({ pipelineId: "pipe_a" })).toBe(2);
    expect(await countWith({ pipelineId: "pipe_b" })).toBe(1);
    expect(await countWith({ pipelineId: "nope" })).toBe(0);
  });

  it("does NOT apply to a step reading records that have no pipeline", async () => {
    await seedClose();
    // The reported bug: a pipeline chosen while the step read opportunities,
    // left behind after switching to leads/SMS, filtered on a field those
    // records don't carry — "0 loaded", no explanation. Sabotage: drop the
    // gate in readFilterConds and both of these collapse to 0.
    expect(await countWith({ pipelineId: "pipe_a" }, "sms_sent")).toBe(1);
    expect(await countWith({ pipelineId: "pipe_a" }, null)).toBe(4); // "All record types"
  });
});

/**
 * TWO REGIMES for the variable picker, split by what the step reads:
 *
 * - A SPECIFIC record type: a field is offered iff at least one record of
 *   THAT TYPE carries a value — counted over every loaded record. A meeting's
 *   attendee emails under a "Contact created" step is how "the backend mixes
 *   leads together" got reported: nothing was mixed, the picker was showing a
 *   connection-wide union with examples borrowed from other events.
 * - "All record types": a field is offered iff at least one record from this
 *   CONNECTION has ever carried a value. That breadth is equally the point —
 *   hiding by a 200-record sample is what made a Close pipeline field vanish
 *   from a picker that had been offering it ("you removed the pipeline
 *   thing"), on a connection where 594 opportunity records carry one.
 *
 * Both reports were real; the record type is the line between them.
 */
describe("a step's field list is what the app has, not what this run loaded", () => {
  // executeNodeTest reads the connection (source resolution + priming), which
  // the plain runFlow tests above do not need.
  beforeEach(async () => {
    await db.insert(connections).values({ id: CONN, orgId: ORG, source: "webhook", name: "Webhook", status: "active", authType: "none" });
  });

  const testApp = async (config: Record<string, unknown>, extraNodes: unknown[] = [], extraEdges: unknown[] = []) => {
    const { executeNodeTest } = await import("@/lib/flow/test-run");
    const g = {
      nodes: [{ id: "a", type: "app", position: { x: 0, y: 0 }, data: { config: { connectionId: CONN, source: "webhook", ...config } } }, ...extraNodes],
      edges: extraEdges,
    };
    return executeNodeTest(db, ORG, g, "a");
  };

  it("another record type's field is hidden on a typed step, and offered on an All-types read", async () => {
    // The registry saw a pipeline on an opportunity; only calls are loaded.
    await recordFields(db, { orgId: ORG, connectionId: CONN, streamHash: null }, [
      { eventId: "o1", eventType: "opportunity", occurredAt: new Date(), properties: { pipeline_id: "pipe_7XAom" } },
    ]);
    await ev({ eventType: "call_logged", subject: "+1914", properties: { direction: "outbound" } });

    // Sabotage: ignore presence and the calls picker re-offers pipeline_id —
    // a field no call carries, so a Filter on it can never match anything.
    const typed = await testApp({ eventType: "call_logged" });
    expect(typed.status).toBe("ok");
    expect(typed.outputSchema.map((f) => f.path)).toContain("properties.direction");
    expect(typed.outputSchema.map((f) => f.path)).not.toContain("properties.pipeline_id");

    // Sabotage the other way: return the run's own inferSchema unmerged and
    // pipeline_id disappears from a broad read too — the exact "you removed
    // the pipeline thing" report.
    const broad = await testApp({});
    expect(broad.status).toBe("ok");
    expect(broad.outputSchema.map((f) => f.path)).toContain("properties.pipeline_id");
    expect(broad.outputSchema.map((f) => f.path)).toContain("properties.direction");
  });

  it("a field the app has NEVER filled is offered nowhere", async () => {
    await recordFields(db, { orgId: ORG, connectionId: CONN, streamHash: null }, [
      { eventId: "r1", eventType: "row", occurredAt: new Date(), properties: { Email: "a@b.com", Unused: null } },
    ]);
    await ev({ eventType: "row_added", subject: "a@b.com", properties: { Email: "a@b.com" } });

    const dto = await testApp({});
    // Sabotage: skip the cardinality gate and the picker reopens on every
    // column the account has never once used.
    expect(dto.outputSchema.map((f) => f.path)).not.toContain("properties.Unused");
    expect(dto.outputSchema.map((f) => f.path)).toContain("properties.Email");
  });

  it("a field a saved step points at is never dropped for being empty", async () => {
    await recordFields(db, { orgId: ORG, connectionId: CONN, streamHash: null }, [
      { eventId: "r1", eventType: "row", occurredAt: new Date(), properties: { Email: "a@b.com", Unused: null } },
    ]);
    await ev({ eventType: "row_added", subject: "a@b.com", properties: { Email: "a@b.com" } });

    // Sabotage: drop savedFieldPaths and this saved rule goes amber with
    // "this field's source is missing" — and ConditionEditor is pick-only, so
    // there is no way to choose it again.
    const dto = await testApp({}, [
      { id: "f", type: "filter", position: { x: 0, y: 1 }, data: { config: { combinator: "and", rules: [{ field: "properties.Unused", op: "equals", value: "x", valueKind: "fixed" }] } } },
    ], [{ id: "e", source: "a", target: "f" }]);
    expect(dto.outputSchema.map((f) => f.path)).toContain("properties.Unused");
  });

  it("a connection with nothing registered still gets a picker", async () => {
    await ev({ eventType: "row_added", subject: "a@b.com", properties: { OnlyInEvents: "x" } });
    const dto = await testApp({});
    // Sabotage: return the registry's empty answer instead of falling back and
    // a brand-new connection's first Test opens an empty picker.
    expect(dto.outputSchema.map((f) => f.path)).toContain("properties.OnlyInEvents");
  });

  it("the Filter below sees the same list — the union lands where downstream pickers read", async () => {
    const { buildFieldGroups } = await import("@/components/flow/graph-utils");
    await recordFields(db, { orgId: ORG, connectionId: CONN, streamHash: null }, [
      { eventId: "o1", eventType: "opportunity", occurredAt: new Date(), properties: { pipeline_id: "pipe_7XAom" } },
    ]);
    await ev({ eventType: "call_logged", subject: "+1914", properties: { direction: "outbound" } });
    const dto = await testApp({ eventType: "call_logged" });

    const nodes = [
      { id: "a", type: "app", position: { x: 0, y: 0 }, data: { config: { connectionId: CONN, source: "webhook", eventType: "call_logged" }, lastTest: dto } },
      { id: "f", type: "filter", position: { x: 0, y: 1 }, data: { config: { combinator: "and", rules: [] }, lastTest: { status: "ok", recordsIn: 1, recordsOut: 1, sample: [{}], outputSchema: [] } } },
    ];
    const groups = buildFieldGroups({
      selectedId: "f",
      nodes: nodes as never[],
      edges: [{ id: "e", source: "a", target: "f" }] as never[],
      stepNoById: new Map([["a", 1], ["f", 2]]),
      titleOf: (n) => String(n.type),
    });
    // Sabotage: apply the type scoping anywhere downstream pickers do not
    // read (execApp only, or the tested node's own schema) and the Get data
    // step is narrow while the Filter under it is wide — two pickers
    // disagreeing about one dataset, in either direction.
    const paths = groups.flatMap((g) => g.fields.map((x) => x.path));
    expect(paths).toContain("properties.direction");
    expect(paths).not.toContain("properties.pipeline_id");
  });
});

/**
 * A ZodError's `.message` in zod v4 IS the JSON issues array, and it went
 * straight onto the node card. The most ordinary half-built state in the
 * product produced it: add a condition, don't fill the field in, hit Test.
 */
describe("a step's error is a sentence, never the parser's internals", () => {
  it("an unfinished condition reads as English", async () => {
    await ev({ eventType: "row_added", subject: "a@b.com" });
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN } } },
        { id: "f", type: "filter", data: { config: { combinator: "and", rules: [{ field: "", op: "equals", value: "x", valueKind: "fixed" }] } } },
      ],
      edges: [{ id: "e", source: "a", target: "f" }],
    });
    const exec = (await runFlow({ db, orgId: ORG }, g)).nodes.get("f")!;
    expect(exec.status).toBe("error");
    // Sabotage: return e.message from the ZodError and the card shows
    // [{"code":"too_small","minimum":1,...}] to a non-technical user.
    expect((exec as { error: string }).error).toBe("A condition on this step has no field chosen yet.");
    expect((exec as { error: string }).error).not.toMatch(/[[{]/);
  });
});

/**
 * Five places the engine read data one way and a person would read it another.
 */
describe("semantics that used to differ from what a person would assume", () => {
  it("a bare number is an epoch or nothing — never a year", async () => {
    // A duration in seconds, offered as a moment by the picker.
    await ev({ eventType: "call", subject: "L1", properties: { lead_id: "L1", dur: 42, answered: 1_800_000_000_000 } });
    const between = async (startField: string) => {
      const g = parseGraph({
        nodes: [
          { id: "a", type: "app", data: { config: { connectionId: CONN } } },
          { id: "t", type: "time_between", data: { config: { keyField: "properties.lead_id", startField, endField: "properties.answered" } } },
        ],
        edges: [{ id: "e", source: "a", target: "t" }],
      });
      const exec = (await runFlow({ db, orgId: ORG }, g)).nodes.get("t")!;
      return (exec as { shape: { records: unknown[] } }).shape.records;
    };
    // Sabotage: Date.parse(String(v)) reads 42 as the year 2042, so a duration
    // picked as a start time pairs happily and reports a gap measured in
    // decades — a large, plausible, entirely fabricated number.
    expect(await between("properties.dur")).toHaveLength(0);
    // A real epoch, in either unit, is still a moment.
    await ev({ eventType: "call", subject: "L2", properties: { lead_id: "L2", started: 1_700_000_000, answered: 1_800_000_000_000 } });
    expect(await between("properties.started")).toHaveLength(1);
  });

  it("a step that reads one stream says so instead of dropping a lane", async () => {
    await ev({ eventType: "a", subject: "x" });
    const g = parseGraph({
      nodes: [
        { id: "a1", type: "app", data: { config: { connectionId: CONN, eventType: "a" } } },
        { id: "a2", type: "app", data: { config: { connectionId: CONN, eventType: "a" } } },
        { id: "f", type: "filter", data: { config: { combinator: "and", rules: [{ field: "subject", op: "is_not_empty", value: "", valueKind: "fixed" }] } } },
      ],
      edges: [
        { id: "e1", source: "a1", target: "f" },
        { id: "e2", source: "a2", target: "f" },
      ],
    });
    const exec = (await runFlow({ db, orgId: ORG }, g)).nodes.get("f")!;
    // Sabotage: read inputs[0] and ignore the rest, and a whole lane vanishes —
    // with WHICH lane survives decided by the order the edges were drawn.
    expect(exec.status).toBe("error");
    expect((exec as { error: string }).error).toMatch(/Combine data step/);
  });

  it("records with no value form a group that says so, not one named “—”", async () => {
    await ev({ eventType: "deal", properties: { rep: "Ana" } });
    await ev({ eventType: "deal", properties: {} });
    await ev({ eventType: "deal", properties: { rep: "—" } });
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN } } },
        { id: "g", type: "group", data: { config: { mode: "field", field: "properties.rep", aggregation: "count" } } },
      ],
      edges: [{ id: "e", source: "a", target: "g" }],
    });
    const shape = (await runFlow({ db, orgId: ORG }, g)).nodes.get("g")! as { shape: { groups: Array<{ label: string }> } };
    const labels = shape.shape.groups.map((x) => x.label).sort();
    // Sabotage: `?? "—"` and the unset record merges with the record whose
    // value genuinely IS "—", into one category that reads like a real one.
    expect(labels).toEqual(["(not set)", "Ana", "—"]);
  });

  it("operator labels say how they compare, because the engine differs", async () => {
    const { FILTER_OP_LABELS } = await import("@/lib/flow/types");
    // Sabotage: drop the qualifiers and `equals "Outbound"` silently returns
    // zero rows where `contains "outbound"` returns all of them, from one
    // dropdown with nothing to distinguish them.
    expect(FILTER_OP_LABELS.equals).toMatch(/case-sensitive/);
    expect(FILTER_OP_LABELS.contains).toMatch(/any case/);
    expect(FILTER_OP_LABELS.is_one_of).toMatch(/comma-separated/);
  });
});

/**
 * A custom range excluded its own last day. The control is <input type="date">,
 * so "To: 31 Aug" arrived as "2026-08-31" and parsed to midnight — every
 * custom-range metric was short by up to a day, and the shorter the range the
 * larger the error. A one-day range measured almost nothing.
 */
describe("a date range includes the day it names", () => {
  const inWindow = async (from: string, to: string) => {
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN } } },
        { id: "f", type: "filter", data: { config: { combinator: "and", rules: [], dateRange: { enabled: true, dateField: "occurredAt", mode: "between", from, to } } } },
      ],
      edges: [{ id: "e", source: "a", target: "f" }],
    });
    return (await runFlow({ db, orgId: ORG }, g)).nodes.get("f")!.recordsOut;
  };

  it("a record late on the To date is inside the window", async () => {
    await db.insert(events).values({
      eventId: "late", orgId: ORG, connectionId: CONN, source: "webhook", eventType: "call",
      subject: "x", occurredAt: new Date("2026-08-31T14:00:00Z"), properties: {},
    });
    // Sabotage: parse the To date as midnight and this is 0 — a whole day of
    // work missing from every custom-range number, with nothing to show it.
    expect(await inWindow("2026-08-01", "2026-08-31")).toBe(1);
    // A single-day range now actually measures that day.
    expect(await inWindow("2026-08-31", "2026-08-31")).toBe(1);
    // And the day after is still outside it.
    expect(await inWindow("2026-08-01", "2026-08-30")).toBe(0);
  });

  it("a hand-typed instant keeps the exact moment it names", async () => {
    await db.insert(events).values({
      eventId: "pm", orgId: ORG, connectionId: CONN, source: "webhook", eventType: "call",
      subject: "y", occurredAt: new Date("2026-08-31T18:00:00Z"), properties: {},
    });
    // Sabotage: extend every To by a day and "to 2026-08-31T12:00:00Z" silently
    // gains twelve hours, so an exact window stops being exact.
    expect(await inWindow("2026-08-01", "2026-08-31T12:00:00Z")).toBe(0);
    expect(await inWindow("2026-08-01", "2026-08-31T23:00:00Z")).toBe(1);
  });
});

/** Corrections the adversarial review of the reliability sweep turned up. */
describe("the sweep's own gaps", () => {
  it("a numeric field stored as text still orders a keep-one", async () => {
    const { keepOnePerGroup } = await import("@/lib/flow/engine");
    const rec = (id: string, v: unknown) => ({ id, source: "gsheets", connectionId: "c", eventType: "row", subject: "k", occurredAt: new Date(), value: null, currency: null, properties: { amount: v } });
    // Sheets, CSV and most webhooks store numbers as text. Sabotage: send
    // strings through dateMs and every value is null, so the survivor is
    // whichever loaded first — the load order this whole rewrite removes —
    // while the receipt claims it kept the largest.
    const r = keepOnePerGroup([rec("small", "10"), rec("big", "900")] as never[], { groupField: "subject", keep: "latest", orderField: "properties.amount" });
    expect(r.records[0].id).toBe("big");
    expect(r.report.ordered).toBe(1);
  });

  it("the receipt admits when nothing was orderable", async () => {
    const { keepOnePerGroup } = await import("@/lib/flow/engine");
    const rec = (id: string) => ({ id, source: "s", connectionId: "c", eventType: "e", subject: "k", occurredAt: new Date(), value: null, currency: null, properties: {} });
    // Sabotage: drop `ordered` and the panel states as fact that it kept the
    // earliest of a field that resolved on nothing.
    expect(keepOnePerGroup([rec("a"), rec("b")] as never[], { groupField: "subject", keep: "earliest", orderField: "properties.nope" }).report.ordered).toBe(0);
  });

  it("a decimal numeric string is not a date either", async () => {
    await ev({ eventType: "call", subject: "L1", properties: { lead_id: "L1", dur: "12.5", answered: 1_800_000_000_000 } });
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN } } },
        { id: "t", type: "time_between", data: { config: { keyField: "properties.lead_id", startField: "properties.dur", endField: "properties.answered" } } },
      ],
      edges: [{ id: "e", source: "a", target: "t" }],
    });
    // Sabotage: guard on /^-?\d+$/ and "12.5" falls through to Date.parse,
    // which reads it as 5 December 2001 — the exact bug 1F claimed to close.
    const shape = (await runFlow({ db, orgId: ORG }, g)).nodes.get("t")! as { shape: { records: unknown[] } };
    expect(shape.shape.records).toHaveLength(0);
  });

  it("the `between` operator includes the day it names, like the date window", async () => {
    await db.insert(events).values({
      eventId: "btw", orgId: ORG, connectionId: CONN, source: "webhook", eventType: "call",
      subject: "z", occurredAt: new Date("2026-08-31T14:00:00Z"), properties: {},
    });
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN } } },
        { id: "f", type: "filter", data: { config: { combinator: "and", rules: [{ field: "occurredAt", op: "between", value: "2026-08-01", value2: "2026-08-31", valueKind: "fixed" }] } } },
      ],
      edges: [{ id: "e", source: "a", target: "f" }],
    });
    // Sabotage: use dateMs for the upper bound and the operator drops its own
    // last day — the twin of the window bug, fed by the same date picker.
    expect((await runFlow({ db, orgId: ORG }, g)).nodes.get("f")!.recordsOut).toBe(1);
  });
});
