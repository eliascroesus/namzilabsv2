import { sql, type SQL } from "drizzle-orm";
import { events } from "@/db/schema";
import { postgresDialect as dialect } from "@/db/dialect";
import { toNumber } from "@/lib/flow/records";

/**
 * E.2 — the operator parity table.
 *
 * The compiled engine must produce EXACTLY what the JS engine produces, for
 * every operator, or it does not cut over. This module is the single place the
 * 17 operators are translated, written against `evalRule` in
 * `src/lib/flow/engine.ts` line by line. The golden suite
 * (tests/engine-parity.test.ts) runs both implementations over the same rows
 * and asserts identical output — that suite is the gate.
 *
 * The semantics being preserved (deliberate, not accidental):
 * - `equals` / `not_equals` / `is_one_of` / `is_not_one_of` are CASE-SENSITIVE.
 * - `contains` / `not_contains` / `starts_with` / `ends_with` are
 *   case-INsensitive, and `%`/`_` in the user's value are LITERAL.
 * - a NULL/missing field stringifies to `''` before comparison, so
 *   `equals ''` matches a missing field — as it does in JS.
 * - numeric operators require BOTH sides numeric; a non-numeric operand makes
 *   the rule false (never an error, never a NULL that leaks through).
 * - `not_contains` / `not_equals` / `is_not_one_of` are TRUE for a missing
 *   field (JS compares the empty string), so they must not be NULL-swallowed.
 * - date operators are NOT compiled at all (see NON_COMPILABLE_OPS) — their
 *   flows stay on the JS engine.
 *
 * A note on what the parity suite already caught, so it isn't re-introduced:
 * the JS engine normalizes date-looking property values on READ, so the
 * compiled path is only equivalent for rows written by the unified writer
 * (which normalizes at INGEST — idempotent, hence equal). Pre-normalization
 * legacy rows can differ; `reprocessConnection` re-normalizes them from
 * raw_events, and that is a production replay gated behind the checklist.
 */

export type CompiledRule = { field: string; op: string; value: string; value2?: string; valueKind?: string; valueField?: string };

/** Every operator the JS engine implements (the parity surface). */
export const ALL_OPS = [
  "equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with",
  "gt", "lt", "gte", "lte", "is_empty", "is_not_empty", "is_one_of", "is_not_one_of",
  "before", "after", "between",
] as const;

/**
 * Date operators are DELIBERATELY not compiled.
 *
 * `evalRule` parses dates with `Date.parse`, whose accepted grammar is far
 * wider than any SQL cast and includes genuinely surprising cases:
 * `Date.parse("42")` is the year 2042 and `Date.parse("100")` is the year 100,
 * so a plain numeric string is a valid DATE to the JS engine. Postgres would
 * either error or disagree, and no regex guard reproduces V8's parser.
 *
 * Since the standing rule is that the compiled path must match the JS engine
 * EXACTLY or it does not cut over, a flow whose filters use `before`, `after`
 * or `between` stays on the JS engine. Everything else compiles. Revisiting
 * this needs a canonical stored date type (a real timestamptz column for
 * promoted date fields), not a cleverer cast.
 */
export const NON_COMPILABLE_OPS: ReadonlySet<string> = new Set<string>(["before", "after", "between"]);

/** Operators the compiler handles. Anything else forces the JS fallback. */
export const COMPILABLE_OPS: ReadonlySet<string> = new Set<string>(ALL_OPS.filter((op) => !NON_COMPILABLE_OPS.has(op)));

/**
 * SQL for a field path, as TEXT — mirroring `getField` + `String(...)`:
 * standard columns by name, everything else out of `properties` (with or
 * without the `properties.` prefix), nested paths via dotted segments.
 */
export function fieldSql(path: string): SQL {
  switch (path) {
    case "id":
      return sql`${events.id}::text`;
    case "source":
      return sql`${events.source}`;
    case "eventType":
      return sql`${events.eventType}`;
    case "subject":
      return sql`${events.subject}`;
    case "currency":
      return sql`${events.currency}`;
    case "connectionId":
      return sql`${events.connectionId}::text`;
    case "value":
      // JS: Number(row.value) → String(...) drops trailing zeros ("10" not "10.00").
      return sql`trim_scale(${events.value})::text`;
    case "occurredAt":
      // JS: Date#toISOString() — millisecond precision, trailing Z.
      return sql`to_char(${events.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    default: {
      const rest = path.startsWith("properties.") ? path.slice("properties.".length) : path;
      // Flat key first (keys containing dots keep their meaning), then a walk.
      const flat = sql.raw(dialect.jsonExtractText(`"events"."properties"`, [rest]));
      if (!rest.includes(".")) return flat;
      const walk = sql.raw(dialect.jsonExtractText(`"events"."properties"`, rest.split(".")));
      return sql`coalesce(${flat}, ${walk})`;
    }
  }
}

/** The field as text with NULL collapsed to '' — JS's `String(raw ?? "")`. */
function fieldText(path: string): SQL {
  return sql`coalesce(${fieldSql(path)}, '')`;
}

/** The right-hand side: a literal, or another field resolved per row. */
function rhsText(rule: CompiledRule): SQL {
  if (rule.valueKind === "field" && rule.valueField) return sql`coalesce(${fieldSql(rule.valueField)}, '')`;
  return sql`${rule.value ?? ""}`;
}

/**
 * Numeric coercion for a per-ROW expression, matching `toNumber`: finite
 * numbers only, otherwise NULL. The regex guard is what stops a non-numeric
 * cell from raising — JS just returns null.
 */
function numericExpr(expr: SQL): SQL {
  return sql`(case when (${expr}) ~ '^\\s*-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?\\s*$' then (${expr})::numeric end)`;
}

/**
 * Numeric coercion for the right-hand side.
 *
 * A LITERAL is converted in JS with the very same `toNumber` the engine uses,
 * then bound as a number (or NULL) — parity by construction, and it sidesteps
 * a real Postgres trap: a guarded `CASE … THEN $1::numeric` gets constant
 * -folded for parameters, so the cast raises on 'Won' before the guard can
 * ever run. A FIELD reference stays a per-row guarded expression, where CASE
 * does protect the cast.
 */
function numericRhs(rule: CompiledRule): SQL {
  if (rule.valueKind === "field" && rule.valueField) {
    return numericExpr(sql`coalesce(${fieldSql(rule.valueField)}, '')`);
  }
  const n = toNumber(rule.value ?? "");
  return n == null ? sql`null::numeric` : sql`${n}::numeric`;
}

// (No date coercion here by design — see NON_COMPILABLE_OPS.)

/**
 * Compile one rule to a boolean SQL predicate that is NEVER NULL — a NULL
 * predicate would silently drop rows a JS `false` would have kept out anyway,
 * but would also drop rows JS KEEPS for negative operators. Every branch is
 * wrapped in `coalesce(..., false)`.
 */
export function compileRule(rule: CompiledRule): SQL {
  const f = fieldText(rule.field);
  const v = rhsText(rule);
  const raw = fieldSql(rule.field);

  switch (rule.op) {
    case "equals":
      return sql`coalesce(${f} = ${v}, false)`;
    case "not_equals":
      return sql`coalesce(${f} <> ${v}, false)`;
    case "contains":
      return sql`coalesce(${f} ilike ('%' || ${escaped(v)} || '%') escape '\\', false)`;
    case "not_contains":
      return sql`coalesce(not (${f} ilike ('%' || ${escaped(v)} || '%') escape '\\'), false)`;
    case "starts_with":
      return sql`coalesce(${f} ilike (${escaped(v)} || '%') escape '\\', false)`;
    case "ends_with":
      return sql`coalesce(${f} ilike ('%' || ${escaped(v)}) escape '\\', false)`;
    case "gt":
      return sql`coalesce(${numericExpr(f)} > ${numericRhs(rule)}, false)`;
    case "lt":
      return sql`coalesce(${numericExpr(f)} < ${numericRhs(rule)}, false)`;
    case "gte":
      return sql`coalesce(${numericExpr(f)} >= ${numericRhs(rule)}, false)`;
    case "lte":
      return sql`coalesce(${numericExpr(f)} <= ${numericRhs(rule)}, false)`;
    case "is_empty":
      return sql`coalesce(${raw} is null or ${f} = '', false)`;
    case "is_not_empty":
      return sql`coalesce(${raw} is not null and ${f} <> '', false)`;
    case "is_one_of":
      return sql`coalesce(${f} = any(${listSql(rule)}), false)`;
    case "is_not_one_of":
      return sql`coalesce(not (${f} = any(${listSql(rule)})), false)`;
    default:
      // Unknown operator — and the deliberately-uncompiled date operators —
      // must never reach here: `rulesAreCompilable` gates the whole flow onto
      // the JS engine first. Matching nothing is the safe reading of "false".
      return sql`false`;
  }
}

/** `%`/`_`/`\` in a user value are literal (dialect seam owns the escaping). */
function escaped(v: SQL): SQL {
  return sql`replace(replace(replace(${v}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;
}

/** `splitList`: comma-separated, each element trimmed — including the empty string. */
function listSql(rule: CompiledRule): SQL {
  if (rule.valueKind === "field" && rule.valueField) {
    return sql`(select coalesce(array_agg(btrim(x)), array[]::text[]) from unnest(string_to_array(coalesce(${fieldSql(rule.valueField)}, ''), ',')) as x)`;
  }
  // Built as an explicit array literal rather than a bound array param, so the
  // element type is unambiguous on every driver.
  const parts = String(rule.value ?? "").split(",").map((s) => s.trim());
  const elems = parts.map((p) => sql`${p}`);
  return sql`array[${sql.join(elems, sql`, `)}]::text[]`;
}

/** Combine a rule set the way `evalRules` does (empty set passes everything). */
export function compileRules(rules: CompiledRule[], combinator: "and" | "or"): SQL {
  if (rules.length === 0) return sql`true`;
  const preds = rules.map(compileRule);
  const joined = preds.reduce((acc, p, i) => (i === 0 ? p : sql`${acc} ${sql.raw(combinator === "or" ? "or" : "and")} ${p}`));
  return sql`(${joined})`;
}

/** Can every rule in this set be compiled? (else the flow stays on JS) */
export function rulesAreCompilable(rules: CompiledRule[]): boolean {
  return rules.every((r) => COMPILABLE_OPS.has(r.op));
}
