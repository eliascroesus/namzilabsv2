/**
 * Orphan-export check.
 *
 * Finds exported functions and consts that NOTHING in production code calls —
 * complete, tested implementations wired to nobody. That is the failure mode
 * that let three P5 features ("compiled engine opt-in", the field registry
 * read, the dedupe guardrail) report as shipped while being unreachable: each
 * had a passing test suite that would have kept passing if every call site
 * were deleted, because the tests WERE the only call sites.
 *
 * A test-only export is not a bug in itself. An export that exists to do a job
 * in production and never gets asked to is.
 *
 *   pnpm tsx scripts/check-orphans.ts
 *
 * Exits 1 when an unallowlisted orphan exists, so CI fails on the next one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * Exports that legitimately have no production caller. Every entry needs a
 * reason — "it's fine" is how the next orphan gets waved through.
 */
const ALLOWLIST: Record<string, string> = {
  // A.2, by design: identifiers are extracted and stored now so that identity
  // resolution can be built later WITHOUT a schema change or a backfill. The
  // spec explicitly deferred the reader ("no persons table now").
  extractIdentifiers: "A.2 — written by the writer, read by future identity resolution (deferred by design)",
  normalizeEmail: "A.2 — identity normalizer, same deferral",
  normalizePhone: "A.2 — identity normalizer, same deferral",
  // The dialect seam exists so the compiler can target more than Postgres; its
  // methods are called through the interface, which this scan can't see.
  postgresDialect: "B.4 — consumed through the Dialect interface, not by name",
  // C.1 write-side mutual exclusion. Found unwired BY THIS CHECK: only the Q6
  // read-side (awaitStreamWriteLock) had a caller, so the write critical
  // section this wraps has never run. Wired into syncStream's swap in the
  // window-bounded-mirror increment; inert until DB_DRIVER=pool either way
  // (it degrades to running the body directly on the http driver).
  // REMOVE THIS ENTRY once syncStream calls it — it is a dated debt, not a
  // permanent exemption.
  withStreamWriteLock: "C.1 — wiring into syncStream's write swap; inert until DB_DRIVER=pool (checklist item 4)",
};

/** Framework entry points: the framework calls these, not our code. */
const FRAMEWORK_EXPORTS = new Set([
  "default", "metadata", "generateMetadata", "dynamic", "revalidate", "runtime",
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "middleware", "config",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
// Operational scripts (runbooks, verification, the migration diagnostics) are
// production callers — they are how a human invokes a capability. A function
// only a runbook calls is wired; a function only a TEST calls is not.
// ...except THIS file. Naming something in the allowlist below would otherwise
// count as a use of it, so adding an exemption would make the export look
// wired and silently retire the check for it. Self-reference is not a caller.
const scriptFiles = walk(join(ROOT, "scripts")).filter((f) => /\.tsx?$/.test(f) && !f.endsWith("check-orphans.ts"));
const sources = new Map([...files, ...scriptFiles].map((f) => [f, readFileSync(f, "utf8")]));
const testFiles = walk(join(ROOT, "tests")).map((f) => readFileSync(f, "utf8")).join("\n");

/**
 * Only `export function` / `export async function`. Deliberately NOT consts,
 * classes or components: exported constants are routinely exported so a test
 * can assert against them (BASE_INTERVAL_MS, ALL_OPS), and flagging those buries
 * the signal that matters under noise nobody reads. Behavior is the thing that
 * can be "built but never called".
 */
const DECL = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
/** A line that only re-exports is not a use. */
const isReExport = (line: string) => /^\s*export\s+(?:\*|\{)/.test(line);
/**
 * A mention in a comment is not a call. Without this the check has a blind
 * spot exactly where it hurts: a function whose own module documents why it
 * is not wired yet looks wired. That is how withStreamWriteLock hid.
 */
const isComment = (line: string) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

type Orphan = { name: string; file: string; testRefs: number };
const orphans: Orphan[] = [];

for (const [file, text] of sources) {
  // Type-only files and the connector registry's built-in wiring aren't behavior.
  for (const m of text.matchAll(DECL)) {
    const name = m[1];
    if (FRAMEWORK_EXPORTS.has(name)) continue;

    let uses = 0;
    for (const [otherFile, otherText] of sources) {
      if (!otherText.includes(name)) continue;
      for (const line of otherText.split("\n")) {
        if (!line.includes(name)) continue;
        if (isReExport(line)) continue; // a barrel is not a consumer
        if (isComment(line)) continue; // nor is prose about it
        // The declaration itself is not a use — but other lines of its OWN file
        // are (a module-private helper called by its own module is wired).
        if (otherFile === file && new RegExp(`^export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(line)) continue;
        if (new RegExp(`\\b${name}\\b`).test(line)) uses++;
      }
    }
    if (uses > 0) continue;

    const testRefs = (testFiles.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    orphans.push({ name, file: relative(ROOT, file), testRefs });
  }
}

const unexpected = orphans.filter((o) => !ALLOWLIST[o.name]);
const allowed = orphans.filter((o) => ALLOWLIST[o.name]);

console.log(`Scanned ${files.length} source files.\n`);

if (allowed.length > 0) {
  console.log("Allowlisted (no production caller, by design):");
  for (const o of allowed) console.log(`  - ${o.name}  (${o.file})\n      ${ALLOWLIST[o.name]}`);
  console.log("");
}

if (unexpected.length === 0) {
  console.log("PASS — every exported function reaches production code.");
  process.exit(0);
}

console.log(`FAIL — ${unexpected.length} export(s) with no production caller:\n`);
for (const o of unexpected) {
  const note = o.testRefs > 0 ? `referenced ONLY by tests (${o.testRefs} refs)` : "referenced nowhere at all";
  console.log(`  ✗ ${o.name}`);
  console.log(`      ${o.file}`);
  console.log(`      ${note}`);
}
console.log(
  "\nEither wire it to a real caller, delete it, or add it to ALLOWLIST in this\n" +
    "script WITH a reason. A feature that only its own tests call is not shipped.",
);
process.exit(1);

export {};
