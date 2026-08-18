import { isDatasetFormulaOp } from "./types";

/**
 * WHAT A STEP PRODUCES — the one place that answers it.
 *
 * There were three answers to this question and they disagreed. The engine
 * knows four shapes; the validator knew three (so a Calculate emitting a
 * trend passed validation and then threw "This input isn't a single
 * number" at runtime); and the canvas kept a fourth opinion in a private
 * list that had never heard of Time between (so it couldn't be combined
 * with anything, and its number was never offered).
 *
 * Every consumer reads THIS. The classification is pinned against real
 * engine output by tests/flow-shapes.test.ts, so the two cannot drift.
 */
export type ShapeKind = "dataset" | "scalar" | "series" | "grouped" | "none";

/** Steps that emit a record set. */
const DATASET_PRODUCERS = new Set(["app", "filter", "time", "time_between", "paths", "unite"]);
/** Steps that read a record set. */
const DATASET_CONSUMERS = new Set(["filter", "time", "time_between", "group", "paths", "unite"]);

export function producesDataset(type: string): boolean {
  return DATASET_PRODUCERS.has(type);
}
export function consumesDataset(type: string): boolean {
  return DATASET_CONSUMERS.has(type);
}

/** A grouping choice decides whether an aggregation is one number or many. */
function groupedShape(groupBy: unknown): ShapeKind {
  const gb = (groupBy ?? null) as { type?: string } | null;
  if (gb?.type === "time") return "series";
  if (gb?.type === "field") return "grouped";
  return "scalar";
}

/**
 * Read the one key that decides the shape, straight off the config.
 *
 * NOT through the schema: a `safeParse` fails on ANY malformed key and then
 * hands back the DEFAULTS, so a Calculate split over time whose `field` was
 * mid-edit got classified "scalar" — the exact misclassification this file
 * was written to end, arriving through the back door.
 */
const str = (cfg: Record<string, unknown>, key: string, fallback: string): string => {
  const v = cfg[key];
  return typeof v === "string" && v ? v : fallback;
};

export function outputShapeOf(type: string, cfg: Record<string, unknown> = {}): ShapeKind {
  if (producesDataset(type)) return "dataset";
  if (type === "formula") {
    if (!isDatasetFormulaOp(str(cfg, "op", "percentage"))) return "scalar"; // comparing two numbers
    return groupedShape(cfg.groupBy);
  }
  if (type === "group") return "grouped";
  if (type === "calculate") {
    const mode = str(cfg, "mode", "number");
    if (mode === "compare") return "scalar";
    if (mode === "breakdown") return "grouped";
    return groupedShape(cfg.groupBy);
  }
  // `output` passes its input through and is the only shape-polymorphic step;
  // it publishes a tile rather than a value anyone can wire into.
  return "none";
}

/**
 * A Calculate configured to COMPARE two numbers rather than aggregate
 * records. One definition — this question used to be re-derived in eight
 * places, which is most of why the step felt like two different nodes.
 */
export function isBinaryCalc(type: string, cfg: Record<string, unknown> = {}): boolean {
  if (type === "formula") return !isDatasetFormulaOp(str(cfg, "op", "percentage"));
  if (type === "calculate") return str(cfg, "mode", "number") === "compare";
  return false;
}

/** A step whose output is a single number, so it can fill a Compare slot. */
export function producesNumber(type: string, cfg: Record<string, unknown> = {}): boolean {
  const shape = outputShapeOf(type, cfg);
  // A dataset counts as a number too — that is what `scalarAt` does with one.
  return shape === "scalar" || shape === "dataset";
}

/**
 * A step whose MAIN input is a record set — as opposed to a Compare, whose two
 * numbers are picked in its panel rather than flowing down the line.
 */
export function readsRecords(type: string, cfg: Record<string, unknown> = {}): boolean {
  if (consumesDataset(type)) return true;
  if (type === "formula" || type === "calculate") return !isBinaryCalc(type, cfg);
  return false;
}

/**
 * WHICH STEP'S RECORDS A RECORDS-READING STEP ACTUALLY READS.
 *
 * The step directly above it, when that step produces records — which is the
 * ordinary case and the only one that ever worked. Otherwise the nearest step
 * above THAT which does.
 *
 * Without this, two aggregations of one source were unbuildable. A Calculate
 * consumes records and emits a number, so stacking a second one under it left
 * nothing to read, and the canvas offers no way to branch: "+ Add next step"
 * appears only on a step with nothing after it, so a sheet already feeding a
 * Calculate cannot be given a second child at all. The person who wanted
 * "total calls AND total pickups from this sheet" had no route to it, while
 * the field picker on that second Calculate cheerfully offered the sheet's
 * columns — the product promising what the engine then refused.
 *
 * The line keeps its meaning. It has always said "comes after"; for a step
 * that reads records it now also says "reads from here, or from the last
 * place there were records", which is what everyone reading the canvas
 * already assumed. The nearest producer wins, so a Filter between the source
 * and the step still narrows it.
 *
 * Returns the lane handle too: a branch of a Split is its own record set, and
 * resolving to the hub without its lane would hand back every branch's rows.
 */
export function recordsSourceOf(
  graph: { nodes: Array<{ id: string; type: string }>; edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> },
  nodeId: string,
): { nodeId: string; sourceHandle?: string | null } | null {
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const plainIncoming = new Map<string, Array<{ source: string; sourceHandle?: string | null }>>();
  for (const e of graph.edges) {
    // Only the CHAIN carries records; a Compare's a/b edges are references to
    // a number and must never be mistaken for the line.
    if (e.targetHandle != null) continue;
    if (!plainIncoming.has(e.target)) plainIncoming.set(e.target, []);
    plainIncoming.get(e.target)!.push({ source: e.source, sourceHandle: e.sourceHandle ?? null });
  }
  // Breadth-first, so "nearest" means nearest and a diamond cannot prefer the
  // longer way round. `seen` also makes a cyclic graph terminate.
  const seen = new Set<string>([nodeId]);
  let frontier = plainIncoming.get(nodeId) ?? [];
  while (frontier.length > 0) {
    const next: Array<{ source: string; sourceHandle?: string | null }> = [];
    for (const step of frontier) {
      if (seen.has(step.source)) continue;
      seen.add(step.source);
      if (producesDataset(typeOf.get(step.source) ?? "")) return { nodeId: step.source, sourceHandle: step.sourceHandle };
      next.push(...(plainIncoming.get(step.source) ?? []));
    }
    frontier = next;
  }
  return null;
}
