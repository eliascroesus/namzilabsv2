import { consumesDataset, outputShapeOf, type ShapeKind } from "./shapes";
import { AppConfigSchema, FilterConfigSchema, PathsConfigSchema, GroupConfigSchema, CalculateConfigSchema, FormulaConfigSchema, TimeBetweenConfigSchema, NODE_TYPES, NODE_LABELS, isDatasetFormulaOp, type FilterConfig, type FlowGraph, type FlowNode } from "./types";

export type ValidationIssue = { nodeId?: string; message: string };

/** Rules whose value is mapped to a field but no field was chosen. */
function mappedRuleGaps(filters: FilterConfig | undefined): number {
  if (!filters) return 0;
  return filters.rules.filter((r) => r.valueKind === "field" && !(r.valueField ?? "").trim()).length;
}

/**
 * Can this step's output fill a Compare slot?
 *
 * The validator used to know three shapes where the engine has four, so a
 * Calculate split over time validated clean and then threw "This input
 * isn't a single number" at runtime — a crash used as an error message.
 * A trend and a breakdown are many numbers; say so, and say what to do.
 */
function numberSlotIssue(src: FlowNode): string | null {
  const shape = outputShapeOf(src.type, (src.data.config ?? {}) as Record<string, unknown>);
  if (shape === "scalar" || shape === "dataset") return null;
  if (shape === "series") return `${stepName(src.type)} produces a trend over time, not a single number — turn its time split off, or point at a different step.`;
  if (shape === "grouped") return `${stepName(src.type)} produces one number per group, not a single number — point at a different step.`;
  return "A Calculate input must be an earlier step's number.";
}

/** One classifier, shared with the engine and the canvas (see shapes.ts). */
function outputKind(node: FlowNode): ShapeKind {
  return outputShapeOf(node.type, (node.data.config ?? {}) as Record<string, unknown>);
}

/**
 * Validate a flow graph before publish (also surfaced in the editor). Enforces:
 * acyclic, valid edge references, per-node input requirements + shape
 * compatibility, required config, and at least one usable Output.
 */
export function validateGraph(graph: FlowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (graph.nodes.length === 0) return [{ message: "This flow is empty. Add a Get data step to start." }];

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
      // An account, not merely a source: a source-only step reads every
      // connection of that source in the org — publishing that blends
      // workspaces and double-counts a twice-connected account.
      if (!cfg.success || !cfg.data.connectionId) {
        issues.push({ nodeId: node.id, message: "Get data needs an account — open the step and choose one." });
      }
      continue;
    }

    if (consumesDataset(node.type)) {
      if (ins.length === 0) issues.push({ nodeId: node.id, message: `${stepName(node.type)} needs a step before it.` });
      for (const srcId of ins) {
        const src = byId.get(srcId);
        if (src && outputKind(src) !== "dataset") {
          issues.push({ nodeId: node.id, message: `${stepName(node.type)} needs records flowing into it — connect it after a data step.` });
        }
      }
    }

    if (node.type === "formula") {
      const fCfg = FormulaConfigSchema.safeParse(node.data.config ?? {});
      const op = fCfg.success ? fCfg.data.op : "percentage";
      const fEdges = incomingEdges.get(node.id) ?? [];
      if (isDatasetFormulaOp(op)) {
        // A dataset Calculate (count/sum/avg/…) aggregates the records flowing in
        // through its plain chain edge; a/b number handles play no part.
        const plain = fEdges.filter((e) => e.targetHandle == null);
        if (plain.length === 0) {
          issues.push({ nodeId: node.id, message: "Calculate needs records as input — connect it after a data step." });
        }
        for (const e of plain) {
          const src = byId.get(e.source);
          if (src && outputKind(src) !== "dataset") {
            issues.push({ nodeId: node.id, message: "Calculate needs records as input." });
          }
        }
      } else {
        // Binary Calculate: each named input (a/b) is either one wired step's number
        // OR a typed-in literal. A plain (no-handle) edge is the step's position in
        // the line — always allowed.
        if (ins.length === 0) issues.push({ nodeId: node.id, message: `${stepName(node.type)} needs a number to work with — wire in an earlier step or type one.` });
        const aFixed = fCfg.success ? fCfg.data.aFixed : null;
        const bFixed = fCfg.success ? fCfg.data.bFixed : null;
        const aCount = fEdges.filter((e) => e.targetHandle === "a").length;
        const bCount = fEdges.filter((e) => e.targetHandle === "b").length;
        if (aCount > 1 || bCount > 1 || (aCount === 0 && aFixed == null) || (bCount === 0 && bFixed == null)) {
          issues.push({ nodeId: node.id, message: "Calculate needs both of its numbers picked (or typed in)." });
        }
        for (const e of fEdges) {
          const src = byId.get(e.source);
          if (src && (e.targetHandle === "a" || e.targetHandle === "b")) {
            const issue = numberSlotIssue(src);
            if (issue) issues.push({ nodeId: node.id, message: issue });
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

    if (node.type === "time_between") {
      const cfg = TimeBetweenConfigSchema.safeParse(node.data.config ?? {});
      if (!cfg.success || !cfg.data.keyField || cfg.data.start.rules.length === 0 || cfg.data.end.rules.length === 0) {
        issues.push({ nodeId: node.id, message: "Time between needs a matching field, plus a condition for the start and the end." });
      }
    }

    if (node.type === "calculate") {
      const parsed = CalculateConfigSchema.safeParse(node.data.config ?? {});
      const mode = parsed.success ? parsed.data.mode : "number";
      if (mode === "compare") {
        const cEdges = incomingEdges.get(node.id) ?? [];
        const aFixed = parsed.success ? parsed.data.aFixed : null;
        const bFixed = parsed.success ? parsed.data.bFixed : null;
        const aCount = cEdges.filter((e) => e.targetHandle === "a").length;
        const bCount = cEdges.filter((e) => e.targetHandle === "b").length;
        if (aCount > 1 || bCount > 1 || (aCount === 0 && aFixed == null) || (bCount === 0 && bFixed == null)) {
          issues.push({ nodeId: node.id, message: "Compare needs both of its numbers picked (or typed in)." });
        }
        for (const e of cEdges) {
          const src = byId.get(e.source);
          if (src && (e.targetHandle === "a" || e.targetHandle === "b")) {
            const issue = numberSlotIssue(src);
            if (issue) issues.push({ nodeId: node.id, message: issue });
          }
        }
      } else {
        const hasDataset = ins.map((sid) => byId.get(sid)).some((s) => s && outputKind(s) === "dataset");
        if (!hasDataset) issues.push({ nodeId: node.id, message: "Calculate needs records as input." });
      }
    }

    if (node.type === "paths") {
      const cfg = PathsConfigSchema.safeParse(node.data.config ?? {});
      if (!cfg.success || cfg.data.paths.length === 0) {
        issues.push({ nodeId: node.id, message: "Split into paths needs at least one branch." });
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

  const hasOutput = graph.nodes.some((n) => n.type === "output");
  const hasMetric = graph.metrics.some((m) => m.enabled);
  if (!hasOutput && !hasMetric) {
    issues.push({ message: "Turn on at least one result in Review & publish." });
  }

  return issues;
}

/** Plain-English step name for messages — never a raw node type. */
function stepName(type: string): string {
  return NODE_LABELS[type as keyof typeof NODE_LABELS] ?? cap(type);
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
