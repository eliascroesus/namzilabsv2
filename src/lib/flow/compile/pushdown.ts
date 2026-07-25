import { sql, type SQL } from "drizzle-orm";
import type { FlowGraph, FlowNode } from "@/lib/flow/types";
import { compileRules, rulesAreCompilable, type CompiledRule } from "./operators";

/**
 * E.1 — graph → SQL compilation, applied where it pays for itself first:
 * pushing the FILTER chain that immediately follows a Get-data step down into
 * that step's query.
 *
 * Why this shape rather than compiling the whole graph at once:
 * - it removes the reason `APP_LOAD_CAP` existed. The cap silently truncated
 *   at 20k newest rows; with the predicate evaluated in Postgres, the engine
 *   loads only matching rows, so a 2M-row sheet filtered to 300 records is 300
 *   rows over the wire instead of a wrong answer;
 * - every remaining node keeps running on the JS engine it already has, so
 *   there is exactly ONE new semantic surface (the operator table) and the
 *   golden suite covers all of it;
 * - it degrades safely: anything the compiler doesn't fully understand (a date
 *   operator, a filter fed by something other than a Get-data step, a
 *   multi-input filter) simply isn't pushed down, and the flow behaves exactly
 *   as before.
 *
 * The pushed-down filters still execute in JS afterwards. That is deliberate:
 * the SQL predicate is a pre-filter, the JS pass remains the source of truth
 * for the record set, and running both means a compiler bug can only ever cost
 * work — never change a number. The parity suite proves the pre-filter never
 * removes a row JS would have kept.
 */

export type PushdownPlan = {
  /** Extra WHERE for this app node's read, or null when nothing is pushable. */
  predicate: SQL | null;
  /** Filter nodes whose rules were folded in (for provenance/telemetry). */
  foldedNodeIds: string[];
};

type FilterConfigLike = { combinator?: unknown; rules?: unknown };

function filterRules(node: FlowNode): { rules: CompiledRule[]; combinator: "and" | "or" } | null {
  if (node.type !== "filter") return null;
  const cfg = (node.data.config ?? {}) as FilterConfigLike;
  const rules = Array.isArray(cfg.rules) ? (cfg.rules as CompiledRule[]) : [];
  const combinator = cfg.combinator === "or" ? "or" : "and";
  return { rules, combinator };
}

/**
 * What can be pushed into `appNodeId`'s read.
 *
 * Only a LINEAR chain of filters directly downstream of the app node is
 * eligible, and the chain stops at the first node that is not a
 * single-input filter — a filter with two inputs, or one fed by a union or a
 * branch, does not describe this app node's rows alone.
 *
 * A chain of filters is an implicit AND: each one narrows what the previous
 * produced, whatever their internal combinators are.
 */
export function planPushdown(graph: FlowGraph, appNodeId: string): PushdownPlan {
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const e of graph.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
  }
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const predicates: SQL[] = [];
  const foldedNodeIds: string[] = [];

  let cursor = appNodeId;
  for (;;) {
    const next = outgoing.get(cursor) ?? [];
    // A fan-out means the app node's rows feed more than one branch; the
    // branches may filter differently, so nothing below is safe to fold.
    if (next.length !== 1) break;
    const candidate = nodeById.get(next[0]);
    if (!candidate) break;
    // Only a filter, and only one that reads this chain alone.
    if (candidate.type !== "filter" || (incomingCount.get(candidate.id) ?? 0) !== 1) break;

    const parsed = filterRules(candidate);
    if (!parsed) break;
    // An operator we cannot compile verbatim stops the chain — the flow keeps
    // its exact JS semantics rather than risking a different number.
    if (!rulesAreCompilable(parsed.rules)) break;
    // A rule referencing an upstream-mapped field is resolved per record by
    // the JS engine against data this query hasn't produced yet.
    if (parsed.rules.some((r) => r.valueKind === "field" && !r.valueField)) break;

    if (parsed.rules.length > 0) predicates.push(compileRules(parsed.rules, parsed.combinator));
    foldedNodeIds.push(candidate.id);
    cursor = candidate.id;
  }

  if (predicates.length === 0) return { predicate: null, foldedNodeIds };
  const combined = predicates.reduce((acc, p) => (acc === null ? p : sqlAnd(acc, p)), null as SQL | null);
  return { predicate: combined, foldedNodeIds };
}

/** A chain of filters is an implicit AND. */
function sqlAnd(a: SQL, b: SQL): SQL {
  return sql`(${a} and ${b})`;
}
