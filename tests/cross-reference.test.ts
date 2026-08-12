import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, evalRule, type NodeExecOk, type CrossRefReport } from "@/lib/flow/engine";
import { planPushdown } from "@/lib/flow/compile/pushdown";
import { validateGraph } from "@/lib/flow/validate";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * Combine's match mode — the join primitive — and the filter guard that
 * retires the shape people built without it.
 *
 * The origin case, measured on production data: "keep the Close leads that
 * are in the spreadsheet" built as Combine + a field-vs-field equals. Every
 * record after a Combine is from ONE app, so the comparison could only ever
 * see one side — and `"" === ""` passed exactly the 8 records that had
 * NEITHER field, while the 28 real matches scored as misses. Everything in
 * this file exists so that flow either works or refuses out loud.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_xref";
const CONN = randomUUID();
const T0 = Date.parse("2026-07-01T12:00:00Z");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
});
afterEach(async () => {
  await close();
});

let seq = 0;
/** A Close-lane record: email lives at data.emails.0.email (blank array = no email). */
async function contact(email: string | null) {
  await db.insert(events).values({
    eventId: `xr:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "close",
    eventType: "contact_created",
    occurredAt: new Date(T0 + seq++ * 60_000),
    properties: { data: { emails: email == null ? [] : [{ email }], name: `c${seq}` } },
  });
}
/** A Sheets-lane record: email lives at the top-level `email` column. */
async function row(email: string | null) {
  await db.insert(events).values({
    eventId: `xr:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "close",
    eventType: "sheet_row",
    occurredAt: new Date(T0 + seq++ * 60_000),
    properties: email == null ? {} : { email },
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const XR = (over: Record<string, unknown> = {}) => ({
  mode: "match",
  keepNodeId: "contacts",
  keyField: "properties.data.emails.0.email",
  lookupField: "properties.email",
  matchMode: "appears",
  ...over,
});

/** The real shape: two Get data lanes into a matching Combine. */
function graph(xr: Record<string, unknown> = {}, edges?: Array<{ id: string; source: string; target: string }>) {
  return parseGraph({
    nodes: [
      N("contacts", "app", { connectionId: CONN, source: "close", eventType: "contact_created" }),
      N("rows", "app", { connectionId: CONN, source: "close", eventType: "sheet_row" }),
      N("x", "unite", XR(xr)),
    ],
    edges: edges ?? [E("contacts", "x"), E("rows", "x")],
  });
}

async function runX(xr: Record<string, unknown> = {}) {
  const res = await runFlow({ db, orgId: ORG }, graph(xr));
  return res.nodes.get("x")!;
}

const emails = (exec: NodeExecOk) => {
  if (exec.shape.kind !== "dataset") throw new Error("expected dataset");
  return exec.shape.records.map((r) => ((r.properties.data as { emails?: Array<{ email?: string }> })?.emails?.[0]?.email ?? "").toLowerCase()).sort();
};

describe("Combine match-mode semantics", () => {
  it("keeps records from the kept lane whose key appears among the other lane's values", async () => {
    // The origin flow in miniature. Sabotage: route this through a stacking
    // Combine + a field-vs-field equals instead and the answer is the
    // no-email contact, not the two real matches.
    await contact("anna@x.com");
    await contact("bob@y.com");
    await contact("carol@z.com");
    await contact(null); // the "8 no-email records" case
    await row("anna@x.com");
    await row("bob@y.com");
    await row("nobody@else.com");

    const exec = await runX();
    expect(exec.status).toBe("ok");
    const ok = exec as NodeExecOk;
    expect(emails(ok)).toEqual(["anna@x.com", "bob@y.com"]);
    // recordsIn is the KEPT lane only — the reference list is context, not input.
    expect(ok.recordsIn).toBe(4);
    expect(ok.crossRef).toEqual({
      mode: "appears",
      keyField: "properties.data.emails.0.email",
      lookupField: "properties.email",
      checked: 4,
      kept: 2,
      dropped: 2,
      blanks: 1,
      listSize: 3,
      listBlanks: 0,
      phones: 0,
    } satisfies CrossRefReport);
  });

  it("a plain Combine (mode stack, and every stored {} config) still stacks all lanes", async () => {
    // Sabotage: make match the default and every existing flow's Combine
    // starts dropping records the moment it loads.
    await contact("anna@x.com");
    await row("anna@x.com");
    const res = await runFlow({ db, orgId: ORG }, graph({ mode: "stack" }));
    expect((res.nodes.get("x") as NodeExecOk).recordsOut).toBe(2);

    const legacy = await runFlow(
      { db, orgId: ORG },
      parseGraph({
        nodes: [N("contacts", "app", { connectionId: CONN, source: "close", eventType: "contact_created" }), N("rows", "app", { connectionId: CONN, source: "close", eventType: "sheet_row" }), N("x", "unite", {})],
        edges: [E("contacts", "x"), E("rows", "x")],
      }),
    );
    expect((legacy.nodes.get("x") as NodeExecOk).recordsOut).toBe(2);
  });

  it("matching ignores capitalization and surrounding spaces — a join key is an identity", async () => {
    // Sabotage: compare raw strings and "Anna@X.com " is a silently missing
    // lead, indistinguishable from one genuinely absent from the sheet.
    await contact("Anna@X.com ");
    await row(" anna@x.COM");
    const exec = await runX();
    expect((exec as NodeExecOk).recordsOut).toBe(1);
  });

  /** A Sheets-lane record with a phone column, for the phone-join tests. */
  async function phoneRow(phone: string) {
    await db.insert(events).values({
      eventId: `xr:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "close",
      eventType: "sheet_row",
      occurredAt: new Date(T0 + seq++ * 60_000),
      properties: { phone },
    });
  }

  it("phone fields match by their digits across formatting divides", async () => {
    // The live case this was measured on: a form writes `2086130936`, Close
    // writes `+1 208-613-0936` — 47 sheet phones vs 299 CRM phones scored 0
    // exact matches and 38 by digits. Sabotage: drop phoneKey from keyOf and
    // Kathryn is dropped again, indistinguishable from a lead not in the CRM.
    await contact(null); // no email — but the phone below identifies her
    await db
      .update(events)
      .set({ properties: { data: { emails: [], phones: [{ phone: "+1 208-613-0936" }], name: "Kathryn" } } })
      .where(eq(events.orgId, ORG));
    await phoneRow("2086130936");

    const exec = await runX({ keyField: "properties.data.phones.0.phone", lookupField: "properties.phone" });
    const ok = exec as NodeExecOk;
    expect(ok.status).toBe("ok");
    expect(ok.recordsOut).toBe(1);
    // Both sides were phone-normalized, and the receipt carries the count so
    // the panel can SAY digits were compared — a silent rewrite of the user's
    // values is how a correct match reads as a wrong one.
    expect(ok.crossRef?.phones).toBe(2);
  });

  it("digit matching runs ONLY between phone-named fields — value shape alone never rewrites a join", async () => {
    // The review case: compact timestamps `20250804093000` / `20260804093000`
    // are "digits plus separators, 10-15 digits" — last-10 keying drops
    // exactly the year and cross-matches records a year apart. Sabotage:
    // gate on phoneKey's shape test alone and these two match.
    await contact(null);
    await db
      .update(events)
      .set({ properties: { data: { emails: [], stamp: "20250804093000", name: "T" } } })
      .where(eq(events.orgId, ORG));
    await row("20260804093000"); // row() stores it under properties.email — not phone-named
    const exec = await runX({ keyField: "properties.data.stamp", lookupField: "properties.email" });
    const ok = exec as NodeExecOk;
    expect(ok.recordsOut).toBe(0);
    expect(ok.crossRef?.phones).toBe(0);
  });

  it("short digit runs and non-phone values inside phone fields keep exact matching", async () => {
    // Tristan's sheet rows hold `55548` in the phone column. Sabotage:
    // normalize any digit run in a phone field and `55548` matches every
    // value ending in those digits.
    await contact(null);
    await db
      .update(events)
      .set({ properties: { data: { emails: [], phones: [{ phone: "55548" }], name: "T" } } })
      .where(eq(events.orgId, ORG));
    await phoneRow("155548"); // shares a suffix; NOT the same 5-digit value
    const differs = await runX({ keyField: "properties.data.phones.0.phone", lookupField: "properties.phone" });
    expect((differs as NodeExecOk).recordsOut).toBe(0);

    await phoneRow("55548"); // the exact value still matches, as text
    const exact = await runX({ keyField: "properties.data.phones.0.phone", lookupField: "properties.phone" });
    expect((exact as NodeExecOk).recordsOut).toBe(1);
    expect((exact as NodeExecOk).crossRef?.phones).toBe(0);
  });

  it("matchMode 'missing' keeps the records NOT in the list — and keeps blanks, counted", async () => {
    await contact("anna@x.com"); // in the sheet → dropped
    await contact("dave@w.com"); // not in the sheet → kept
    await contact(null); // blank: not provably present → kept, and the receipt says so
    await row("anna@x.com");

    const exec = await runX({ matchMode: "missing" });
    const ok = exec as NodeExecOk;
    expect(ok.recordsOut).toBe(2);
    expect(ok.crossRef).toMatchObject({ mode: "missing", kept: 2, dropped: 1, blanks: 1 });
  });

  it("kept records pass through unchanged and gain this step's stamp", async () => {
    await contact("anna@x.com");
    await row("anna@x.com");
    const exec = (await runX()) as NodeExecOk;
    if (exec.shape.kind !== "dataset") throw new Error("expected dataset");
    const r = exec.shape.records[0];
    // Still the contact's own fields (pass-through)…
    expect((r.properties.data as { name?: string }).name).toBeDefined();
    // …still the kept lane's stamp, plus this step's own.
    expect(r.properties.__count_contacts).toBeDefined();
    expect(r.properties.__count_x).toBe(1);
    // The reference lane's stamp is NOT on it — its records don't flow through.
    expect(r.properties.__count_rows).toBeUndefined();
  });

  it("an empty reference SOURCE is an empty window (0 kept), but a blank lookup FIELD is a config error", async () => {
    // The 1C distinction, applied to the check list. Sabotage: collapse the
    // two cases and an analyst pointing at the wrong sheet column reads
    // "0 matched" as "none of my leads are in the sheet".
    await contact("anna@x.com");
    const empty = await runX();
    expect(empty.status).toBe("ok");
    expect((empty as NodeExecOk).recordsOut).toBe(0);

    await row("bob@y.com");
    const wrongField = await runX({ lookupField: "properties.no_such_column" });
    expect(wrongField.status).toBe("error");
    expect((wrongField as { error: string }).error).toContain("no_such_column");
    expect((wrongField as { error: string }).error).toContain("empty on all");
  });

  it("refuses to run half-wired or half-configured", async () => {
    await contact("anna@x.com");
    await row("anna@x.com");

    const one = await runFlow({ db, orgId: ORG }, graph({}, [E("contacts", "x")]));
    expect(one.nodes.get("x")!.status).toBe("error");
    expect((one.nodes.get("x") as { error: string }).error).toContain("two connected steps");

    const unset = await runX({ keyField: "" });
    expect(unset.status).toBe("error");
    expect((unset as { error: string }).error).toContain("finish the sentence");

    // The kept step was rewired away (config points at a node that isn't an input).
    const stale = await runX({ keepNodeId: "somewhere_else" });
    expect(stale.status).toBe("error");
    expect((stale as { error: string }).error).toContain("isn't wired into this Combine");
  });
});

describe("the retired cross_reference node loads as a matching Combine", () => {
  it("parseGraph migrates the type and maps every config key", () => {
    // The step shipped for one release before matching moved onto Combine, so
    // a stored graph can contain one. Sabotage: drop the migration and that
    // flow fails schema validation on its next load.
    const g = parseGraph({
      nodes: [
        N("contacts", "app", { connectionId: CONN, source: "close", eventType: "contact_created" }),
        N("rows", "app", { connectionId: CONN, source: "close", eventType: "sheet_row" }),
        N("x", "cross_reference", { keepNodeId: "contacts", keyField: "k", lookupField: "l", mode: "missing" }),
      ],
      edges: [E("contacts", "x"), E("rows", "x")],
    });
    const x = g.nodes.find((n) => n.id === "x")!;
    expect(x.type).toBe("unite");
    expect(x.data.config).toEqual({ mode: "match", keepNodeId: "contacts", keyField: "k", lookupField: "l", matchMode: "missing" });
  });
});

describe("match-mode static validation (the publish gate's twin)", () => {
  const V = (nodes: unknown[], edges: unknown[]) => validateGraph(parseGraph({ nodes, edges }));
  const app = (id: string) => N(id, "app", { connectionId: CONN, source: "close", eventType: "x" });

  it("one wired input, an unfinished config, and a stale keep-step each block publish by name", () => {
    const oneInput = V([app("a"), N("x", "unite", XR())], [E("a", "x")]);
    expect(oneInput.some((i) => i.nodeId === "x" && i.message.includes("exactly two steps"))).toBe(true);

    const unfinished = V([app("a"), app("b"), N("x", "unite", XR({ lookupField: "" }))], [E("a", "x"), E("b", "x")]);
    expect(unfinished.some((i) => i.nodeId === "x" && i.message.includes("isn't finished"))).toBe(true);

    const stale = V([app("a"), app("b"), N("x", "unite", XR({ keepNodeId: "gone" }))], [E("a", "x"), E("b", "x")]);
    expect(stale.some((i) => i.nodeId === "x" && i.message.includes("no longer wired"))).toBe(true);

    const complete = V([app("a"), app("b"), N("x", "unite", XR({ keepNodeId: "a" }))], [E("a", "x"), E("b", "x")]);
    expect(complete.filter((i) => i.nodeId === "x")).toEqual([]);

    // A stacking Combine raises none of this — {} is every existing flow.
    const stack = V([app("a"), app("b"), N("x", "unite", {})], [E("a", "x"), E("b", "x")]);
    expect(stack.filter((i) => i.nodeId === "x")).toEqual([]);
  });
});

describe("the pushdown chain never tunnels through a Combine", () => {
  it("a Filter below a matching Combine does not fold into the kept lane's app read", () => {
    // Sabotage: let the fold walk through non-filter nodes and the app read
    // pre-applies a condition meant for the JOINED set — rows the reference
    // side would have kept are gone before the check runs.
    const g = parseGraph({
      nodes: [
        N("contacts", "app", { connectionId: CONN, source: "close", eventType: "contact_created" }),
        N("rows", "app", { connectionId: CONN, source: "close", eventType: "sheet_row" }),
        N("x", "unite", XR()),
        N("f", "filter", { combinator: "and", rules: [{ field: "subject", op: "equals", value: "a" }] }),
      ],
      edges: [E("contacts", "x"), E("rows", "x"), E("x", "f")],
    });
    expect(planPushdown(g, "contacts").foldedNodeIds).toEqual([]);
    expect(planPushdown(g, "rows").foldedNodeIds).toEqual([]);
  });
});

describe("the filter guard that retires the mistaken join", () => {
  const rec = (props: Record<string, unknown>) =>
    ({ id: "r", source: "close", eventType: "e", subject: null, occurredAt: new Date(T0).toISOString(), value: null, currency: null, properties: props }) as never;

  it("a field-to-field comparison where both sides are blank matches nothing", () => {
    // Sabotage: drop the guard in evalRule and this is `"" === ""` — the
    // exact mechanics that passed 8 no-email contacts as "matches".
    const rule = { field: "a", op: "equals", value: "", valueKind: "field", valueField: "b" };
    expect(evalRule(rec({}), rule)).toBe(false);
    expect(evalRule(rec({ a: "", b: "" }), rule)).toBe(false);
    expect(evalRule(rec({ a: "x", b: "x" }), rule)).toBe(true);
    expect(evalRule(rec({ a: "x", b: "y" }), rule)).toBe(false);
    // contains was quietly worse: "".includes("") is true.
    expect(evalRule(rec({}), { ...rule, op: "contains" })).toBe(false);
    // is_one_of via a blank mapped field: splitList("") yields [""].
    expect(evalRule(rec({}), { ...rule, op: "is_one_of" })).toBe(false);
  });

  it("is_empty / is_not_empty keep their meaning even with a stray mapped field on the rule", () => {
    // Switching an op to "Is empty" leaves valueKind/valueField behind on the
    // stored rule; the guard must not swallow the answer.
    const rule = { field: "a", op: "is_empty", value: "", valueKind: "field", valueField: "b" };
    expect(evalRule(rec({}), rule)).toBe(true);
    expect(evalRule(rec({ a: "x" }), rule)).toBe(false);
  });

  it("a fixed empty value still matches blank fields — only field-to-field changed", () => {
    expect(evalRule(rec({}), { field: "a", op: "equals", value: "", valueKind: "fixed" })).toBe(true);
  });

  it("a Filter comparing two fields that never co-occur refuses, and names the cure", async () => {
    // The user's original flow, verbatim: stack two apps, compare a field
    // from each. Sabotage: drop assertComparableFields and this "succeeds"
    // with 1 record — the blank-blank one is gone (guard above), but
    // 0-passed would read as "none of my leads are in the sheet", which is
    // equally a lie.
    await contact("anna@x.com");
    await contact(null);
    await row("anna@x.com");
    const g = parseGraph({
      nodes: [
        N("contacts", "app", { connectionId: CONN, source: "close", eventType: "contact_created" }),
        N("rows", "app", { connectionId: CONN, source: "close", eventType: "sheet_row" }),
        N("u", "unite", {}),
        N("f", "filter", {
          combinator: "and",
          rules: [{ field: "properties.email", op: "equals", value: "", valueKind: "field", valueField: "properties.data.emails.0.email" }],
        }),
      ],
      edges: [E("contacts", "u"), E("rows", "u"), E("u", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g);
    const f = res.nodes.get("f")!;
    expect(f.status).toBe("error");
    const msg = (f as { error: string }).error;
    expect(msg).toContain("no record here carries both");
    expect(msg).toContain("Only keep records that match");
  });

  it("the same comparison on ONE lane, where some record carries both, runs normally", async () => {
    // The guard must fire on impossibility, not on sparseness.
    await contact("anna@x.com");
    const g = parseGraph({
      nodes: [
        N("contacts", "app", { connectionId: CONN, source: "close", eventType: "contact_created" }),
        N("f", "filter", {
          combinator: "and",
          rules: [{ field: "properties.data.emails.0.email", op: "equals", value: "", valueKind: "field", valueField: "properties.data.name" }],
        }),
      ],
      edges: [E("contacts", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g);
    expect(res.nodes.get("f")!.status).toBe("ok");
  });
});
