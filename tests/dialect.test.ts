import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { postgresDialect as d } from "@/db/dialect";
import { createTestDb } from "./helpers/testdb";
import type { DB } from "@/db/types";

/**
 * B.4: the dialect seam the compiled engine (E.1) emits SQL through. The
 * fragment builders are pinned as pure functions, then the LIKE-escaping
 * contract — the operator-parity subtlety (E.2: `%`/`_` are literal in
 * contains/starts_with/ends_with) — is proven against real Postgres.
 */

describe("PostgresDialect fragments", () => {
  it("quotes identifiers, doubling embedded quotes; rejects empty", () => {
    expect(d.quoteIdent("events")).toBe('"events"');
    expect(d.quoteIdent('we"ird')).toBe('"we""ird"');
    expect(() => d.quoteIdent("")).toThrow();
  });

  it("extracts json paths as text, with nesting and quote-safe keys", () => {
    expect(d.jsonExtractText('"events"."properties"', ["email"])).toBe('"events"."properties"->>\'email\'');
    expect(d.jsonExtractText("p", ["utm", "source"])).toBe("p->'utm'->>'source'");
    expect(d.jsonExtractText("p", ["o'key"])).toBe("p->>'o''key'");
    expect(() => d.jsonExtractText("p", [])).toThrow();
  });

  it("builds date_trunc with the enum inlined (SELECT and GROUP BY stay byte-identical)", () => {
    expect(d.dateTrunc("week", '"occurred_at"')).toBe(`date_trunc('week', "occurred_at")`);
  });

  it("builds DISTINCT ON and casts", () => {
    expect(d.distinctOn(["a", "b"])).toBe("distinct on (a, b)");
    expect(() => d.distinctOn([])).toThrow();
    expect(d.cast("x", "numeric")).toBe("(x)::numeric");
    expect(d.cast("y", "timestamptz")).toBe("(y)::timestamptz");
  });

  it("escapes LIKE metacharacters in values", () => {
    expect(d.escapeLikePattern("100%_done\\now")).toBe("100\\%\\_done\\\\now");
    expect(d.escapeLikePattern("plain")).toBe("plain");
  });
});

describe("LIKE escaping against real Postgres (operator parity E.2)", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  async function contains(haystack: string, needle: string): Promise<boolean> {
    const pattern = `%${d.escapeLikePattern(needle)}%`;
    const res = await db.execute(
      sql`select ${haystack} ${sql.raw(d.ilikeOp())} ${pattern}${sql.raw(d.escapeClause())} as hit`,
    );
    const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (res as unknown as Array<Record<string, unknown>>);
    return Boolean(rows[0].hit);
  }

  it("'%' and '_' in the user value match LITERALLY, not as wildcards", async () => {
    expect(await contains("progress: 100% done", "100% done")).toBe(true);
    expect(await contains("progress: 100x done", "100% done")).toBe(false); // % is not a wildcard
    expect(await contains("a_b", "a_b")).toBe(true);
    expect(await contains("axb", "a_b")).toBe(false); // _ is not a wildcard
  });

  it("backslashes in the user value survive; matching stays case-insensitive", async () => {
    expect(await contains("path C:\\temp here", "c:\\TEMP")).toBe(true);
    expect(await contains("HELLO world", "hello")).toBe(true);
  });
});
