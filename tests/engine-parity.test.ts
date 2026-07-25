import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { evalRule } from "@/lib/flow/engine";
import { eventToRecord } from "@/lib/flow/records";
import { upsertEvents } from "@/ingestion/pipeline";
import { compileRule, COMPILABLE_OPS, NON_COMPILABLE_OPS, ALL_OPS, type CompiledRule } from "@/lib/flow/compile/operators";
import type { DB } from "@/db/types";

/**
 * E.2/E.4 — THE GOLDEN PARITY SUITE. This is the gate: no flow may be flipped
 * to the compiled engine until JS ≡ SQL for every operator over every fixture
 * row. The JS `evalRule` is the ORACLE; the compiled predicate must agree
 * row-for-row, including on the awkward cases (missing fields, empty strings,
 * non-numeric operands, unparseable dates, regex/LIKE metacharacters, unicode
 * case folding).
 *
 * Any disagreement fails here rather than silently changing a customer's
 * number in production.
 */

const ORG = "org_parity";
let db: DB;
let close: () => Promise<void>;
let connectionId: string;

/** Fixture rows chosen to sit on every boundary the operators care about. */
const FIXTURES: Array<{ label: string; props: Record<string, unknown>; subject?: string | null; value?: number | null }> = [
  { label: "plain", props: { name: "Alice", stage: "Won", amount: "100", when: "2026-03-01T10:00:00Z" }, subject: "alice@acme.com", value: 100 },
  { label: "upper", props: { name: "ALICE", stage: "WON", amount: "100.50", when: "2026-06-15" }, subject: "ALICE@ACME.COM", value: 100.5 },
  { label: "empty-string", props: { name: "", stage: "", amount: "", when: "" }, subject: "", value: null },
  { label: "missing-keys", props: { other: "x" }, subject: null, value: null },
  { label: "null-value", props: { name: null, stage: null, amount: null, when: null }, subject: null, value: null },
  { label: "non-numeric", props: { name: "Bob", stage: "Lost", amount: "not-a-number", when: "not-a-date" }, subject: "bob@x.io", value: 0 },
  { label: "percent", props: { name: "100% done", stage: "a_b", amount: "-5", when: "2026-01-01" }, subject: "x%y", value: -5 },
  { label: "underscore", props: { name: "a_b", stage: "A_B", amount: "0", when: "1999-12-31T23:59:59Z" }, subject: "a_b", value: 0 },
  { label: "spaces", props: { name: "  padded  ", stage: " Won ", amount: " 42 ", when: " 2026-02-02 " }, subject: " s ", value: 42 },
  { label: "unicode", props: { name: "Ünïcödé", stage: "ÉTÉ", amount: "1e3", when: "2026-12-25T00:00:00.500Z" }, subject: "ü@x.io", value: 1000 },
  { label: "numeric-string", props: { name: "42", stage: "42", amount: "42", when: "2026-07-01" }, subject: "42", value: 42 },
  { label: "list-ish", props: { name: "a,b", stage: "a, b", amount: "3.14", when: "2026-05-05" }, subject: "a,b", value: 3.14 },
  { label: "nested", props: { utm: { source: "ig" }, name: "nested", stage: "New", amount: "7", when: "2026-04-04" }, subject: "n@x.io", value: 7 },
  { label: "dotted-key", props: { "a.b": "flat-wins", name: "dotted", stage: "New", amount: "8", when: "2026-04-05" }, subject: "d@x.io", value: 8 },
];

/** Values exercised as the right-hand side of every operator. */
const VALUES = ["Won", "won", "WON", "", "alice", "ALICE", "100", "100.5", "0", "-5", "a_b", "100%", "%", "_",
  "2026-03-01T10:00:00Z", "2026-06-15", "not-a-date", "a,b", "Won,Lost", " Won , Lost ", "Ünïcödé", "42", "1e3"];

/** Fields exercised: properties (flat, missing, nested, dotted) + standard columns. */
const FIELDS = ["name", "stage", "amount", "when", "properties.name", "missing", "utm.source", "a.b", "subject", "value", "eventType", "source"];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db, { orgId: ORG, source: "gsheets" });
  // Seed through the REAL writer, not raw inserts: the writer normalizes
  // date-looking property values at ingest, so this is what production rows
  // actually contain. (The JS engine also normalizes on READ — idempotent for
  // writer-written rows, which is exactly why parity holds. See the caveat
  // test at the bottom for pre-normalization legacy rows.)
  await upsertEvents(
    db,
    { orgId: ORG, connectionId, source: "gsheets", generation: 1 },
    FIXTURES.map((f, i) => ({
      eventId: `parity:${f.label}`,
      eventType: i % 2 === 0 ? "row_added" : "updated",
      subject: f.subject ?? null,
      occurredAt: new Date(Date.parse("2026-03-01T10:00:00Z") + i * 86_400_000),
      value: f.value ?? null,
      properties: f.props,
    })),
  );
});

afterAll(async () => {
  await close();
});

/** Rows the COMPILED predicate keeps. */
async function sqlMatches(rule: CompiledRule): Promise<string[]> {
  const rows = await db
    .select({ eventId: events.eventId })
    .from(events)
    .where(and(eq(events.orgId, ORG), isNull(events.deletedAt), compileRule(rule)));
  return rows.map((r) => r.eventId.replace("parity:", "")).sort();
}

/** Rows the JS ORACLE keeps. */
async function jsMatches(rule: CompiledRule): Promise<string[]> {
  const rows = await db.select().from(events).where(and(eq(events.orgId, ORG), isNull(events.deletedAt)));
  return rows
    .map(eventToRecord)
    .filter((rec) => evalRule(rec, rule))
    .map((rec) => String((rec.properties as Record<string, unknown>).__label ?? ""))
    .sort();
}

/** Same, but labelled by eventId so both sides are comparable. */
async function bothMatch(rule: CompiledRule): Promise<{ js: string[]; compiled: string[] }> {
  const rows = await db.select().from(events).where(and(eq(events.orgId, ORG), isNull(events.deletedAt)));
  const js = rows
    .filter((row) => evalRule(eventToRecord(row), rule))
    .map((row) => row.eventId.replace("parity:", ""))
    .sort();
  return { js, compiled: await sqlMatches(rule) };
}

describe("E.2 — every operator is accounted for: compiled, or explicitly not", () => {
  it("all 17 JS operators are classified, with none silently missing", () => {
    expect(ALL_OPS.length).toBe(17);
    const classified = [...COMPILABLE_OPS, ...NON_COMPILABLE_OPS].sort();
    expect(classified).toEqual([...ALL_OPS].sort());
  });

  it("date operators are deliberately NOT compiled — Date.parse cannot be reproduced in SQL", () => {
    // Date.parse("42") is the year 2042 and Date.parse("100") is the year 100:
    // a bare numeric string is a valid date to the JS engine. No SQL cast or
    // regex guard reproduces that, so parity is unachievable and these
    // operators keep their flows on the JS engine rather than risk a
    // silently-different number.
    expect(Number.isNaN(Date.parse("Won"))).toBe(true);
    expect(Date.parse("42")).toBeGreaterThan(0);
    expect([...NON_COMPILABLE_OPS].sort()).toEqual(["after", "before", "between"]);
    for (const op of NON_COMPILABLE_OPS) expect(COMPILABLE_OPS.has(op)).toBe(false);
  });

  it("a flow using a date operator is not compilable at all (whole-flow fallback)", async () => {
    const { rulesAreCompilable } = await import("@/lib/flow/compile/operators");
    expect(rulesAreCompilable([{ field: "when", op: "equals", value: "x" }])).toBe(true);
    expect(
      rulesAreCompilable([
        { field: "when", op: "equals", value: "x" },
        { field: "when", op: "before", value: "2026-01-01" },
      ]),
    ).toBe(false);
  });
});

describe("E.4 — golden parity: compiled SQL ≡ JS engine, operator by operator", () => {
  for (const op of [...COMPILABLE_OPS].sort()) {
    it(`${op}: identical result set for every field × value combination`, async () => {
      const mismatches: string[] = [];
      for (const field of FIELDS) {
        for (const value of VALUES) {
          const rule: CompiledRule = { field, op, value, ...(op === "between" ? { value2: "2026-12-31" } : {}) };
          const { js, compiled } = await bothMatch(rule);
          if (JSON.stringify(js) !== JSON.stringify(compiled)) {
            mismatches.push(`${op}(${field}, ${JSON.stringify(value)}): js=[${js}] sql=[${compiled}]`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it("field-to-field comparisons (valueKind: 'field') also match", async () => {
    const mismatches: string[] = [];
    for (const op of ["equals", "not_equals", "contains", "gt", "lt"]) {
      for (const [field, valueField] of [["name", "stage"], ["amount", "value"], ["when", "occurredAt"], ["stage", "missing"]]) {
        const rule: CompiledRule = { field, op, value: "", valueKind: "field", valueField };
        const { js, compiled } = await bothMatch(rule);
        if (JSON.stringify(js) !== JSON.stringify(compiled)) {
          mismatches.push(`${op}(${field} vs ${valueField}): js=[${js}] sql=[${compiled}]`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("an unknown operator matches nothing on both sides (no silent pass-through)", async () => {
    const { js, compiled } = await bothMatch({ field: "name", op: "no_such_op", value: "x" });
    expect(js).toEqual([]);
    expect(compiled).toEqual([]);
  });

  it("guards the semantics that are easy to break", async () => {
    // equals is CASE-SENSITIVE; contains is NOT.
    expect((await bothMatch({ field: "stage", op: "equals", value: "won" })).js).not.toContain("plain");
    expect((await bothMatch({ field: "stage", op: "contains", value: "won" })).js).toContain("plain");
    // % and _ are literal, not wildcards.
    const pct = await bothMatch({ field: "name", op: "contains", value: "%" });
    expect(pct.js).toEqual(pct.compiled);
    expect(pct.js).toEqual(["percent"]);
    // A missing field is '' — so not_equals to a non-empty value is TRUE for it.
    expect((await bothMatch({ field: "missing", op: "not_equals", value: "x" })).js.length).toBe(FIXTURES.length);
    // Numeric ops need BOTH sides numeric.
    const gt = await bothMatch({ field: "amount", op: "gt", value: "not-a-number" });
    expect(gt.js).toEqual([]);
    expect(gt.compiled).toEqual([]);
  });
});

describe("determinism (E.3) — the compiled read has a total order", () => {
  it("(occurred_at DESC, id DESC) is a strict total order over the fixture", async () => {
    const run = async () =>
      (
        await db
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.orgId, ORG), isNull(events.deletedAt)))
          .orderBy(sql`${events.occurredAt} desc, ${events.id} desc`)
      ).map((r) => r.id);
    const a = await run();
    const b = await run();
    expect(a).toEqual(b); // repeatable
    expect(new Set(a).size).toBe(a.length); // no ties left unbroken
  });
});
