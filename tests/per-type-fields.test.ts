import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { upsertEvents } from "@/ingestion/pipeline";
import { presenceByPath } from "@/lib/flow/schema-infer";
import { appFieldUnion, sampleAppFields, runFlow, type NodeExecOk } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { FlowRecord } from "@/lib/flow/records";
import type { DB } from "@/db/types";

/**
 * Per-record-type field scoping — the audit finding behind it, measured on
 * production data first: a "Contact created" picker offered `data.attendees.
 * 1.email` with a MEETING's attendee as the example, because the union spans
 * the whole connection and the registry samples whichever event it saw last.
 * The user read that as the backend mixing leads together. Nothing was mixed
 * — the picker was presenting a connection-wide union as if it were this
 * step's data.
 *
 * The rule now: with a specific record type chosen and fully loaded, a field
 * is offered iff at least one record OF THAT TYPE carries a value — counted
 * over every record, never a sample — and examples come from that type's own
 * records. "All record types" keeps the connection-wide breadth (pipeline
 * fields live only on opportunity events and must stay findable there).
 */

let db: DB;
let close: () => Promise<void>;
let connId: string;

const ORG = "org_ptf";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "close" });
});
afterEach(async () => {
  await close();
});

/** Close-style: connection-scoped (no stream hash), mixed record types. */
const write = (records: Array<{ eventId: string; eventType: string; subject: string | null; occurredAt: Date; properties: Record<string, unknown> }>) =>
  upsertEvents(db, { orgId: ORG, connectionId: connId, source: "close", streamHash: null, generation: 1 }, records);

let seq = 0;
const contact = (email: string) => ({
  eventId: `ptf:c:${seq}`,
  eventType: "contact_created",
  subject: null,
  occurredAt: new Date(Date.parse("2026-07-01T12:00:00Z") + seq++ * 60_000),
  properties: { data: { emails: [{ email }], name: `c${seq}` } },
});
const meeting = (attendee: string) => ({
  eventId: `ptf:m:${seq}`,
  eventType: "meeting_held",
  subject: null,
  occurredAt: new Date(Date.parse("2026-07-01T12:00:00Z") + seq++ * 60_000),
  properties: { data: { attendees: [{ email: attendee }], duration: 30 } },
});

const rec = (properties: Record<string, unknown>): FlowRecord =>
  ({ id: "r", source: "close", eventType: "e", subject: null, occurredAt: "2026-07-01T12:00:00Z", value: null, currency: null, properties }) as FlowRecord;

describe("presenceByPath — the full truth, or nothing", () => {
  it("counts over EVERY record, not the newest 200", () => {
    // Sabotage: sample like inferSchema does and a field filled only on the
    // older records reads 0 — and would be HIDDEN, which is exactly the lie
    // the sampled count is never allowed to tell.
    const records = [
      ...Array.from({ length: 240 }, () => rec({ recent: "x" })),
      ...Array.from({ length: 10 }, () => rec({ recent: "x", old_only: "y" })),
    ];
    const p = presenceByPath(records)!;
    expect(p.get("old_only")).toBe(10);
    expect(p.get("recent")).toBe(250);
  });

  it("blank values do not count as presence, and unknown paths are absent", () => {
    const p = presenceByPath([rec({ a: "", b: [], c: {}, d: null, e: "real" })])!;
    expect(p.get("a")).toBe(0);
    expect(p.get("b")).toBe(0);
    expect(p.get("e")).toBe(1);
    expect(p.get("nope")).toBeUndefined();
  });

  it("returns null on path overflow — presence unknown must hide nothing", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) wide[`k${i}`] = "v";
    const records = Array.from({ length: 3 }, () => rec(wide));
    expect(presenceByPath(records, 10)).toBeNull();
  });
});

describe("the union narrows to the record type when the full truth is known", () => {
  it("a Contact created step stops offering meeting fields, and 'All record types' keeps them", async () => {
    // Sabotage: ignore presence in appFieldUnion and data.attendees is back
    // in the contact picker, with a meeting's attendee as its example.
    await write([contact("anna@x.com"), contact("bob@y.com"), meeting("holly@z.com")]);

    const typed = { connectionId: connId, source: "close", eventType: "contact_created" };
    const g = parseGraph({ nodes: [{ id: "get", type: "app", data: { config: typed } }], edges: [] });
    const res = await runFlow({ db, orgId: ORG, fieldPresence: true }, g);
    const exec = res.nodes.get("get") as NodeExecOk;
    expect(exec.status).toBe("ok");
    expect(exec.fieldPresence).toBeDefined();

    const narrowed = await appFieldUnion({ db, orgId: ORG }, typed, exec.outputSchema, new Set(), exec.fieldPresence!);
    const paths = narrowed.map((f) => f.path);
    expect(paths).toContain("properties.data.emails");
    expect(paths).not.toContain("properties.data.attendees");
    expect(paths).not.toContain("properties.data.duration");

    // Without presence (All record types), the connection-wide breadth stays:
    // that is what keeps opportunity-only fields findable from a broad read.
    const broad = await appFieldUnion({ db, orgId: ORG }, { connectionId: connId, source: "close" }, exec.outputSchema, new Set(), null);
    expect(broad.map((f) => f.path)).toContain("properties.data.attendees");
  });

  it("a saved (pinned) path survives narrowing even when the type never carries it", async () => {
    // The user's own flow: dedupe saved on data.attendees.1.email while
    // reading contacts. Hiding a picker's own value reads as broken.
    await write([contact("anna@x.com"), meeting("holly@z.com")]);
    const typed = { connectionId: connId, source: "close", eventType: "contact_created" };
    const g = parseGraph({ nodes: [{ id: "get", type: "app", data: { config: typed } }], edges: [] });
    const res = await runFlow({ db, orgId: ORG, fieldPresence: true }, g);
    const exec = res.nodes.get("get") as NodeExecOk;

    const pinned = new Set(["properties.data.attendees"]);
    const narrowed = await appFieldUnion({ db, orgId: ORG }, typed, exec.outputSchema, pinned, exec.fieldPresence!);
    expect(narrowed.map((f) => f.path)).toContain("properties.data.attendees");
  });
});

describe("the config-time picker (before any test) is type-scoped too", () => {
  it("scans the record type's own events instead of the connection-wide registry", async () => {
    // Sabotage: prefer the registry and the pre-test "Keep one record per"
    // picker shows all 600+ connection fields under a step reading one type.
    await write([contact("anna@x.com"), contact("bob@y.com"), meeting("holly@z.com")]);

    const typedFields = await sampleAppFields({ db, orgId: ORG }, { connectionId: connId, source: "close", eventType: "contact_created" });
    const typedPaths = typedFields.map((f) => f.path);
    expect(typedPaths).toContain("properties.data.emails");
    expect(typedPaths).not.toContain("properties.data.attendees");

    // No record type chosen → the registry's breadth is the right answer.
    const broad = await sampleAppFields({ db, orgId: ORG }, { connectionId: connId, source: "close" });
    expect(broad.map((f) => f.path)).toContain("properties.data.attendees");
  });

  it("a type with no records yet falls back to the registry rather than an empty picker", async () => {
    await write([meeting("holly@z.com")]);
    const fields = await sampleAppFields({ db, orgId: ORG }, { connectionId: connId, source: "close", eventType: "contact_created" });
    expect(fields.length).toBeGreaterThan(0);
  });
});
