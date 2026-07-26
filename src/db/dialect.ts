/**
 * B.4 — the dialect seam.
 *
 * The compiled flow engine (E.1) emits SQL through THIS interface only, never
 * raw strings, so every dialect-specific spelling lives in one reviewable
 * place: identifier quoting, jsonb access, date bucketing, DISTINCT ON,
 * pattern escaping for the case-insensitive text operators, and casts. One
 * Postgres implementation ships; the seam is what keeps the compiler honest
 * (and portable if a second engine ever appears).
 *
 * Everything here builds SQL FRAGMENTS from trusted structural inputs
 * (identifiers, operator kinds). User VALUES never pass through this module —
 * they are always bound as parameters by the caller. `escapeLikePattern` is
 * the one value-adjacent helper: it neutralizes `%`/`_`/escape chars INSIDE a
 * parameter value before the caller binds it (operator parity E.2: contains /
 * starts_with / ends_with treat those characters literally).
 */

export type DateBucket = "day" | "week" | "month";
export type CastType = "numeric" | "timestamptz" | "text";

export interface Dialect {
  /** Quote a schema identifier (table/column/alias). Throws on empty. */
  quoteIdent(name: string): string;
  /** Extract a (possibly nested) json path as TEXT, e.g. properties->'a'->>'b'. */
  jsonExtractText(column: string, path: string[]): string;
  /** Truncate a timestamp expression to a bucket, returning a timestamp expression. */
  dateTrunc(bucket: DateBucket, expr: string): string;
  /** DISTINCT ON prefix for a select, given the key expressions. */
  distinctOn(keyExprs: string[]): string;
  /** Case-insensitive LIKE operator name (parity: contains is case-insensitive). */
  ilikeOp(): string;
  /**
   * Escape LIKE/ILIKE metacharacters in a VALUE so it matches literally once
   * wrapped in a pattern by the caller (e.g. `%${escaped}%`). Callers must
   * append `escapeClause()` to the predicate.
   */
  escapeLikePattern(value: string): string;
  /** The ESCAPE clause matching escapeLikePattern's escape character. */
  escapeClause(): string;
  /** Cast an expression to a target type. */
  cast(expr: string, to: CastType): string;
}

export class PostgresDialect implements Dialect {
  quoteIdent(name: string): string {
    if (name.length === 0) throw new Error("empty identifier");
    return `"${name.replaceAll('"', '""')}"`;
  }

  jsonExtractText(column: string, path: string[]): string {
    if (path.length === 0) throw new Error("empty json path");
    const quoted = path.map((p) => `'${p.replaceAll("'", "''")}'`);
    const last = quoted.pop()!;
    return `${column}${quoted.map((p) => `->${p}`).join("")}->>${last}`;
  }

  dateTrunc(bucket: DateBucket, expr: string): string {
    // bucket is a closed enum — safe to inline (and must be inline: a bound
    // param would make SELECT and GROUP BY expressions differ byte-wise).
    return `date_trunc('${bucket}', ${expr})`;
  }

  distinctOn(keyExprs: string[]): string {
    if (keyExprs.length === 0) throw new Error("DISTINCT ON needs at least one key");
    return `distinct on (${keyExprs.join(", ")})`;
  }

  ilikeOp(): string {
    return "ilike";
  }

  escapeLikePattern(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  }

  escapeClause(): string {
    return " escape '\\'";
  }

  cast(expr: string, to: CastType): string {
    return `(${expr})::${to}`;
  }
}

export const postgresDialect: Dialect = new PostgresDialect();
