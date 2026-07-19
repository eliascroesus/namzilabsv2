import { AppConfigSchema, FilterConfigSchema, PathsConfigSchema, GroupConfigSchema, NODE_TYPES, type FilterConfig, type FlowGraph, type FlowNode } from "./types";

export type ValidationIssue = { nodeId?: string; message: string };

/** Rules whose value is mapped to a field but no field was chosen. */
function mappedRuleGaps(filters: FilterConfig | undefined): number {
  if (!filters) return 0;
  return filters.rules.filter((r) => r.valueKind === "field" && !(r.valueField ?? "").trim()).length;
}

type ShapeKind = "dataset" | "value" | "none";

/** Nodes that emit a record set. */
const DATASET_PRODUCERS = new Set(["app", "filter", "time", "formatter", "combine", "paths"]);
/** Nodes that emit a computed value/series/grouped. */
const VALUE_PRODUCERS = new Set(["aggregate", "formula", "group"]);
/** Nodes that consume record sets. */
const DATASET_CONSUMERS = new Set(["filter", "aggregate", "time", "formatter", "group", "paths", "combine"]);
/** Nodes that consume computed values. */
const VALUE_CONSUMERS = new Set(["formula"]);


function outputKind(node: FlowNode): ShapeKind {
  if (DATASET_PRODUCERS.has(node.type)) return "dataset";
  if (VALUE_PRODUCERS.has(node.type)) return "value";
  return "none";
}

/**
 * Validate a flow graph before publish (also surfaced in the editor). Enforces:
 * acyclic, valid edge references, per-node input requirements + shape
 * compatibility, required config, and at least one usable Output.
 */
export function validateGraph(graph: FlowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (graph.nodes.length === 0) return [{ message: "The flow is empty. Add an App and an Output node." }];

  for (const n of graph.nodes) {
    if (!(NODE_TYPES as readonly string[]).includes(n.type)) {
      issues.push({ nodeId: n.id, message: `Unknown node type "${n.type}".` });
    }
  }

  for (const e of graph.edges) {
    if (!byId.has(e.source)) issues.push({ message: `An edge references a missing node (${e.source}).` });
    if (!byId.has(e.target)) issues.push({ message: `An edge references a missing node (${e.target}).` });
  }

  const incoming = new Map<string, string[]>();
  const incomingEdges = new Map<string, FlowGraph["edges"]>();
  for (const e of graph.edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
    if (!incomingEdges.has(e.target)) incomingEdges.set(e.target, []);
    incomingEdges.get(e.target)!.push(e);
  }

  if (hasCycle(graph)) issues.push({ message: "The flow has a loop; connections must flow in one direction." });

  for (const node of graph.nodes) {
    const ins = incoming.get(node.id) ?? [];

    if (node.type === "app") {
      if (ins.length > 0) issues.push({ nodeId: node.id, message: "App nodes can't have an input." });
      const cfg = AppConfigSchema.safeParse(node.data.config ?? {});
      if (!cfg.success || (!cfg.data.connectionId && !cfg.data.source)) {
        issues.push({ nodeId: node.id, message: "App node needs a connected account or a source." });
      }
      continue;
    }

    if (DATASET_CONSUMERS.has(node.type)) {
      if (ins.length === 0) issues.push({ nodeId: node.id, message: `${cap(node.type)} node needs a connected input.` });
      for (const srcId of ins) {
        const src = byId.get(srcId);
        if (src && outputKind(src) !== "dataset") {
          issues.push({ nodeId: node.id, message: `${cap(node.type)} needs records as input.` });
        }
      }
    }

    if (VALUE_CONSUMERS.has(node.type)) {
      if (ins.length === 0) issues.push({ nodeId: node.id, message: `${cap(node.type)} node needs a connected number.` });
      for (const srcId of ins) {
        const src = byId.get(srcId);
        if (src && outputKind(src) !== "value") {
          issues.push({ nodeId: node.id, message: `${cap(node.type)} needs numbers as input (connect Aggregate nodes).` });
        }
      }
      if (node.type === "formula") {
        // Formula is binary: exactly one number into handle "a" and one into "b".
        const fEdges = incomingEdges.get(node.id) ?? [];
        const aCount = fEdges.filter((e) => e.targetHandle === "a").length;
        const bCount = fEdges.filter((e) => e.targetHandle === "b").length;
        if (aCount !== 1 || bCount !== 1) {
          issues.push({ nodeId: node.id, message: "Formula needs one number in input A and one in input B." });
        }
        // A/B must be scalars — only Aggregate or Formula produce a single number.
        for (const e of fEdges) {
          const src = byId.get(e.source);
          if (src && src.type !== "aggregate" && src.type !== "formula") {
            issues.push({ nodeId: node.id, message: "Formula inputs must come from Aggregate or Formula steps (a single number)." });
          }
        }
      }
    }

    if (node.type === "filter") {
      const cfg = FilterConfigSchema.safeParse(node.data.config ?? {});
      if (cfg.success && mappedRuleGaps(cfg.data) > 0) {
        issues.push({ nodeId: node.id, message: "A condition compares against a field, but no field is chosen." });
      }
    }

    if (node.type === "paths") {
      const cfg = PathsConfigSchema.safeParse(node.data.config ?? {});
      if (!cfg.success || cfg.data.paths.length === 0) {
        issues.push({ nodeId: node.id, message: "Paths node needs at least one path with conditions." });
      } else if (cfg.data.paths.reduce((a, p) => a + mappedRuleGaps(p.filters), 0) > 0) {
        issues.push({ nodeId: node.id, message: "A path condition compares against a field, but no field is chosen." });
      }
    }

    if (node.type === "group") {
      const cfg = GroupConfigSchema.safeParse(node.data.config ?? {});
      if (cfg.success && cfg.data.mode === "categories" && cfg.data.categories.length === 0) {
        issues.push({ nodeId: node.id, message: "Group node needs at least one category." });
      } else if (cfg.success && cfg.data.mode === "categories" && cfg.data.categories.reduce((a, c) => a + mappedRuleGaps(c.filters), 0) > 0) {
        issues.push({ nodeId: node.id, message: "A category condition compares against a field, but no field is chosen." });
      }
    }

    if (node.type === "output" && ins.length === 0) {
      issues.push({ nodeId: node.id, message: "Output node needs a connected input." });
    }
  }

  if (graph.nodes.filter((n) => n.type === "output").length === 0) {
    issues.push({ message: "Add an Output node to save a result to the dashboard." });
  }

  return issues;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hasCycle(graph: FlowGraph): boolean {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return visited < graph.nodes.length;
}
