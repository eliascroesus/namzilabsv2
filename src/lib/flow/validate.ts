import { AppConfigSchema, CORE_NODE_TYPES, type FlowGraph, type FlowNode } from "./types";

export type ValidationIssue = { nodeId?: string; message: string };

type ShapeKind = "dataset" | "value" | "none";

/** The output shape kind a core node produces. */
function outputKind(node: FlowNode): ShapeKind {
  switch (node.type) {
    case "app":
    case "filter":
      return "dataset";
    case "aggregate":
      return "value";
    default:
      return "none"; // output is terminal
  }
}

/**
 * Validate a flow graph before publish (also surfaced in the editor). Enforces:
 * acyclic, valid edge references, per-node input requirements + shape
 * compatibility, required config, and at least one usable Output.
 */
export function validateGraph(graph: FlowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (graph.nodes.length === 0) {
    return [{ message: "The flow is empty. Add an App and an Output node." }];
  }

  // Only the core node types are executable today.
  for (const n of graph.nodes) {
    if (!(CORE_NODE_TYPES as readonly string[]).includes(n.type)) {
      issues.push({ nodeId: n.id, message: `The "${n.type}" node isn't available yet.` });
    }
  }

  // Edges must reference existing nodes.
  for (const e of graph.edges) {
    if (!byId.has(e.source)) issues.push({ message: `An edge references a missing node (${e.source}).` });
    if (!byId.has(e.target)) issues.push({ message: `An edge references a missing node (${e.target}).` });
  }

  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }

  // Cycle detection.
  if (hasCycle(graph)) issues.push({ message: "The flow has a loop; connections must flow in one direction." });

  // Per-node checks.
  for (const node of graph.nodes) {
    const ins = incoming.get(node.id) ?? [];
    if (node.type === "app") {
      if (ins.length > 0) issues.push({ nodeId: node.id, message: "App nodes can't have an input." });
      const cfg = AppConfigSchema.safeParse(node.data.config ?? {});
      if (!cfg.success || (!cfg.data.connectionId && !cfg.data.source)) {
        issues.push({ nodeId: node.id, message: "App node needs a connected account or a source." });
      }
    }
    if (node.type === "filter" || node.type === "aggregate") {
      if (ins.length === 0) issues.push({ nodeId: node.id, message: `${cap(node.type)} node needs a connected input.` });
      for (const srcId of ins) {
        const src = byId.get(srcId);
        if (src && outputKind(src) !== "dataset") {
          issues.push({ nodeId: node.id, message: `${cap(node.type)} needs records as input.` });
        }
      }
    }
    if (node.type === "output") {
      if (ins.length === 0) issues.push({ nodeId: node.id, message: "Output node needs a connected input." });
    }
  }

  const outputs = graph.nodes.filter((n) => n.type === "output");
  if (outputs.length === 0) issues.push({ message: "Add an Output node to save a result to the dashboard." });

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
