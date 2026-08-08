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
 * Close's Pipeline read filter — same contract as Calendly's meetingType, on a
 * CONNECTION-scoped source (stream_hash null). The pin that matters: only
 * opportunity records carry a pipeline_id, so setting the filter hides every
 * other record type — which is exactly what the Configure hint promises, and
 * what a wrong pipeline id shows as an honest 0 rather than an error.
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

  const countWith = async (sourceConfig: Record<string, unknown>) => {
    const res = await runFlow(
      { db, orgId: ORG },
      G(
        [N("a", "app", { connectionId: CONN, source: "close", sourceConfig }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})],
        [E("a", "agg"), E("agg", "o")],
      ),
    );
    return res.nodes.get("a")!.recordsOut;
  };

  it("narrows to one pipeline's opportunities; unset reads everything; wrong id reads 0", async () => {
    await seedClose();
    expect(await countWith({})).toBe(4);
    expect(await countWith({ pipelineId: "pipe_a" })).toBe(2);
    expect(await countWith({ pipelineId: "pipe_b" })).toBe(1);
    // Non-opportunity records drop out while the filter is set — the hint's promise.
    expect(await countWith({ pipelineId: "nope" })).toBe(0);
  });
});
