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
