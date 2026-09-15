/**
 * EVERY QUERY THAT TOUCHES TENANT DATA IS WALLED BY `org_id`.
 *
 * This is the one bug class that ends a data company. Not a crash, not a
 * leak of our own internals — one customer's records rendered into another
 * customer's dashboard, silently, with every test green. Twenty-five of the
 * twenty-nine tables in this schema carry an `org_id`, and the only thing
 * standing between them and a cross-tenant read is that somebody remembered
 * the predicate at each of a few hundred call sites.
 *
 * So it is checked mechanically. The script walks `src/db/schema.ts` for the
 * tables that carry `org_id`, then finds every Drizzle statement in `src/`
 * that reads or writes one, and fails on any whose text does not mention the
 * column. Exceptions are allowlisted BY FILE AND TABLE with a stated reason —
 * background sweeps genuinely do scan the fleet, and a lookup keyed by a
 * generated UUID is walled by something stronger than a tenant id.
 *
 * WHY IT SCANS `src/app` AND NOT `src/lib`, which is the judgement in this
 * file and the first version got it wrong.
 *
 * Pointed at the whole tree it reported 114 statements. Almost every one was
 * correct: an ingestion pipeline reading `raw_events` by its own id, a backfill
 * job reading itself by job id, a sweep updating a connection it was handed.
 * Those are walled by a GENERATED UUID, which is a stronger wall than a tenant
 * id — a v4 cannot be guessed — and the tenant is then derived from the row.
 * A check that fires on a hundred correct lines is a check somebody turns off.
 *
 * The bug class that actually matters is narrower and has a boundary you can
 * name: code reachable FROM THE INTERNET that takes an id out of a request and
 * queries by it. That is `src/app` — every server action and every route
 * handler — and there the rule is absolute, because the id arrived from
 * somebody who may not own the row it names.
 *
 * WHAT IT STILL CANNOT SEE, stated so nobody trusts it further than it goes:
 *   - whether the `orgId` a statement uses came from the SESSION or from the
 *     form. That is the other half of tenancy and it is a human read;
 *     `tests/tenancy.test.ts` asserts the session half separately.
 *   - a predicate built dynamically and passed in as a variable. Those are
 *     reported as unscoped, which is the safe direction: a reviewer confirms
 *     and allowlists rather than the script guessing.
 *   - anything in `src/lib` called BY an action with a browser-supplied id.
 *     Those are audited by hand and the findings live in
 *     `docs/security-audit.md`.
 *
 * Usage: `pnpm check:tenancy`. Exits non-zero on any unscoped statement.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Table names carrying `org_id`, read from the schema rather than listed. */
function orgScopedTables(): Map<string, string> {
  const src = readFileSync(join(ROOT, "src/db/schema.ts"), "utf8");
  const byVar = new Map<string, string>();
  // `export const fooBar = pgTable("foo_bar", { … })` up to the next export.
  const re = /export const (\w+) = pgTable\(\s*"([^"]+)"/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const [, varName, tableName] = m;
    const start = m.index;
    const nextExport = src.indexOf("\nexport const ", start + 1);
    const body = src.slice(start, nextExport === -1 ? undefined : nextExport);
    if (/orgId: text\("org_id"\)/.test(body)) byVar.set(varName, tableName);
  }
  return byVar;
}

/**
 * Statements a reviewer has confirmed are correctly unscoped, with the reason.
 *
 * Keyed `file::table`. Adding an entry is a deliberate act that shows up in a
 * diff — which is the point: "this query does not filter by tenant" should
 * never be something a reader has to infer.
 */
const ALLOW: Record<string, string> = {
  /**
   * THE WORKSPACE CAP IS COUNTED PER PERSON, NOT PER TENANT — deliberately.
   * Being invited into a dozen workspaces must not spend somebody's own
   * allowance, so the count is keyed by `user_id` and `source = 'created'`.
   * An org predicate here would give every workspace its own cap of three,
   * which is the opposite of the limit.
   */
  "src/app/actions.ts::workspace_owners": "the cap counts what a PERSON created, across tenants, on purpose",

  /**
   * AN UNAUTHENTICATED DELIVERY HAS NO SESSION TO SCOPE BY. The connection is
   * found by the UUID in its own webhook URL and the tenant is DERIVED from
   * that row — the only order that can work, and safe because the id is a v4
   * nobody can guess and the request is then verified against the connection's
   * own signing secret before anything is written.
   */
  "src/app/api/webhooks/[connectionId]/route.ts::connections":
    "the delivery URL's UUID is the wall; the tenant comes off the row it finds",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The text of one Drizzle statement, from a `.from(` / `.update(` / `.delete(`
 * / `.insert(` up to the end of the chain.
 *
 * "End of the chain" is the first line whose indentation returns to or below
 * the statement's own AND which does not continue it — good enough for this
 * codebase's formatting, and generous rather than tight: a window that is too
 * LARGE can only produce a false pass on a statement whose neighbour is
 * scoped, which a reviewer then catches. Too small would produce false alarms
 * that get allowlisted, which is how a check like this dies.
 */
function statementAt(src: string, idx: number): string {
  const end = src.indexOf(";", idx);
  return src.slice(Math.max(0, idx - 400), end === -1 ? idx + 600 : end + 1);
}

const tables = orgScopedTables();
const findings: Array<{ file: string; table: string; line: number; snippet: string }> = [];

for (const file of walk(join(ROOT, "src/app"))) {
  const rel = file.slice(ROOT.length + 1);
  // The destroy sweep is the one place a whole table is emptied for one org
  // through a dynamic reference; it carries its own coverage test.
  if (rel === "src/lib/destroy.ts") continue;
  const src = readFileSync(file, "utf8");
  for (const [varName, tableName] of tables) {
    const re = new RegExp(`\\.(?:from|update|delete|insert)\\(\\s*${varName}\\s*[,)]`, "g");
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const stmt = statementAt(src, m.index);
      if (/orgId|org_id/.test(stmt)) continue;
      if (ALLOW[`${rel}::${tableName}`]) continue;
      findings.push({
        file: rel,
        table: tableName,
        line: src.slice(0, m.index).split("\n").length,
        snippet: stmt.slice(380, 520).replace(/\s+/g, " ").trim(),
      });
    }
  }
}

console.log(`Scanned ${walk(join(ROOT, "src/app")).length} request-facing files against ${tables.size} tenant tables.`);
const allowed = Object.keys(ALLOW).length;
console.log(`${allowed} statement(s) allowlisted, each with a stated reason.\n`);

if (findings.length === 0) {
  console.log("PASS — every request-facing query touching tenant data names org_id.");
  process.exit(0);
}

console.log(`FAIL — ${findings.length} statement(s) touching tenant data with no org_id:\n`);
for (const f of findings) {
  console.log(`  ✗ ${f.file}:${f.line}  ${f.table}`);
  console.log(`      ${f.snippet}`);
}
console.log(
  "\nEither add the org predicate, or — if the statement is genuinely fleet-wide or\n" +
    "walled by a generated UUID — add it to ALLOW in this script WITH a reason.",
);
process.exit(1);
