import { formatDuration } from "@/lib/format";
import { durationValueUnit, isDatasetFormulaOp, NODE_LABELS, NODE_TYPES, type NodeType } from "@/lib/flow/types";
import type { NodeData } from "./graph-utils";

/** The four visible stages a metric flows through, in order. */
export const STAGES = ["Data", "Conditions", "Calculation", "Dashboard"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Every node type the canvas can render — including the retired ones, which
 * still load and run so no stored flow ever breaks.
 *
 * There used to be a second table here (`NODE_META`) carrying a label, blurb,
 * stage and keyword string per type, because the picker was a list of TYPES.
 * The picker is now a list of JOBS (`NODE_LIBRARY`), and one type can be two
 * of them — so that table's picker half moved there, and its label half was
 * always a duplicate of `NODE_LABELS`, the canonical vocabulary that
 * validation messages are required to speak. Keeping it would have left a
 * blurb and a keyword list per type that nothing reads: editable, plausible,
 * and with no effect on anything — the kind of dead copy someone eventually
 * fixes a bug in.
 */
export const ALL_TYPES = [...NODE_TYPES];

/**
 * THE STEP PICKER'S OWN LIST — and the product's real taxonomy.
 *
 * Nobody learns this product from documentation. They learn it from the list
 * of steps they are offered, once, in the moment they press "+", and they
 * carry that model for the life of the account. So the list has to be a list
 * of THINGS PEOPLE WANT TO DO, not a list of node types.
 *
 * Those two lists stopped matching when the engine was simplified. Merging
 * Count into Calculate and cross-reference into Combine removed real
 * duplication from the executor — and left two of six picker entries carrying
 * two unrelated jobs each. "Calculate" meant both "how many calls did we
 * make" and "what share of meetings showed up"; the first is a question about
 * a pile of records, the second is arithmetic on two numbers, and a user
 * arriving with one of those questions had to read a sixteen-item dropdown
 * mixing both to find out which half they were in.
 *
 * So: ONE engine node, TWO doors. Each entry names one job and lands on the
 * panel already configured for it. `parseGraph`, the validator, the engine and
 * every stored flow are untouched — this list is display-layer only, and the
 * op dropdown stays inside each panel so a step can still be switched without
 * being deleted.
 *
 * `config` is merged over `defaultConfig(type)`, and `titleOf` in this file
 * reads the SAME fields back, so the card a user gets is titled with the
 * entry they picked. A picker that says "Match against a list" and produces a
 * card saying "Combine data" is the mismatch this whole split exists to end.
 */
export type LibraryEntry = {
  /** Unique within the picker; several entries may share a node `type`. */
  key: string;
  type: NodeType;
  label: string;
  blurb: string;
  stage: Stage;
  keywords: string;
  /** Merged over defaultConfig(type) — what makes one type two doors. */
  config?: Record<string, unknown>;
};

/**
 * ONE WORD WHERE ONE WORD WILL DO.
 *
 * These labels are read in three places, and the narrowest one governs: a
 * 256px canvas card, which also carries a step number, an icon, a status and
 * a menu. "Match against a list" left about eleven characters of room, so a
 * card read "2. Match ..." and told the user nothing at all — the label was
 * long enough to be helpful everywhere except where it was actually needed.
 *
 * The blurb underneath does the explaining, and it only has to do it once,
 * in the picker, at the moment of choosing. After that the user knows what
 * they added and the card is a reminder, not an introduction.
 */
export const NODE_LIBRARY: LibraryEntry[] = [
  {
    key: "app",
    type: "app",
    label: "Get data",
    blurb: "Pull records from a connected app",
    stage: "Data",
    keywords: "integration source connect data app get duplicates dedupe records pull import",
  },
  {
    key: "unite",
    type: "unite",
    label: "Combine",
    blurb: "Put several steps’ records on one line",
    stage: "Data",
    keywords: "unite combine merge together branches lanes sources union bring back stack join",
    config: { mode: "stack" },
  },
  {
    // Was a checkbox inside Combine reading "Only keep records that match
    // across these steps" — so "only the leads that are also in the
    // spreadsheet", a question people arrive with already formed, was
    // reachable only by first picking a step that sounded like it did
    // something else, then finding a checkbox in it.
    key: "unite_match",
    type: "unite",
    label: "Match",
    blurb: "Keep only records that appear in another step",
    stage: "Data",
    keywords: "match cross reference lookup intersect appears exists in both vlookup check against missing not in compare lists filter by another step",
    config: { mode: "match" },
  },
  {
    key: "filter",
    type: "filter",
    label: "Filter",
    blurb: "Keep only the records you want",
    stage: "Conditions",
    keywords: "condition where keep only match date range filter narrow exclude remove period",
  },
  {
    key: "paths",
    type: "paths",
    label: "Split",
    blurb: "Send records down separate branches",
    stage: "Conditions",
    keywords: "split branch route condition paths segment separate",
  },
  {
    key: "formula_dataset",
    type: "formula",
    label: "Summarize",
    blurb: "Count, total or average into one number",
    stage: "Calculation",
    keywords: "count sum average total maximum minimum median distinct unique aggregate how many number summarise summarize records",
    config: { op: "count" },
  },
  {
    key: "formula_compare",
    type: "formula",
    label: "Compare",
    blurb: "A rate, ratio or % change from two steps",
    stage: "Calculation",
    keywords: "compare rate ratio percentage percent change difference divide conversion share of formula two numbers",
    config: { op: "percentage" },
  },
  {
    key: "time_between",
    type: "time_between",
    label: "Time between",
    blurb: "How long from one event to another",
    stage: "Calculation",
    keywords: "speed to lead time between duration gap first call response elapsed how long pair match latency",
  },
];

/**
 * The step's JOB, for the icon — where one node type is two of them. Same
 * accent, different glyph; see NodeIcon.
 */
export function nodeVariant(type: NodeType, cfg: Record<string, unknown>): string | undefined {
  if (type === "unite") return String(cfg.mode ?? "stack") === "match" ? "unite_match" : undefined;
  if (type === "formula") return isDatasetFormulaOp(cfg.op ?? "percentage") ? undefined : "formula_compare";
  return undefined;
}

// (Source badge styling lives in controls/source-style.ts — the one copy.)

export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "app":
      return {};
    case "filter":
      return { combinator: "and", rules: [] };
    case "calculate":
      return { mode: "number", aggregation: "count", field: "value", distinctField: "subject", groupBy: null, breakdownMode: "field", breakdownField: "source", categories: [], fallbackLabel: "Other", op: "percentage" };
    case "output":
      return { name: "New metric", viz: "number", format: "number", precision: 0, target: null };
    case "time":
      return { dateField: "occurredAt", mode: "preset", preset: "last_30_days", days: 30 };
    case "formula":
      // Count, not percentage: "how many X" is the first metric everyone
      // builds, and the old default landed them in a two-number compare
      // asking for a Numerator. Stored configs are untouched (the zod
      // default still reads "percentage" for legacy graphs missing `op`).
      return { op: "count", field: "value", distinctField: "subject", groupBy: null };
    case "time_between":
      return { keyField: "", startField: "", startStep: "", endField: "", endStep: "" };
    case "unite":
      // Match fields stay empty on purpose: whose records continue and which
      // fields compare are questions with no safe default — a matching
      // Combine reads "Needs setup" until each is answered.
      return { mode: "stack" };
    case "group":
      return { mode: "field", field: "source", aggregation: "count", valueField: "value", distinctField: "subject", categories: [], fallbackLabel: "Other" };
    case "paths":
      return { paths: [{ id: "p1", label: "Path A" }, { id: "p2", label: "Path B" }] };
    default:
      return {};
  }
}

/**
 * The card's own name for a step.
 *
 * For the two node types the picker offers twice, this reads the SAME config
 * field the library entry set — so picking "Match against a list" produces a
 * card that says "Match against a list", and switching the step's mode inside
 * the panel renames the card to match. The alternative is a card whose title
 * describes a different operation from the one it is performing, which is how
 * a user ends up debugging the wrong step.
 *
 * `NODE_LABELS` is untouched and stays the canonical per-TYPE name that
 * validation messages speak — a message naming the type is still correct,
 * because both doors lead to the same type.
 */
export function defaultTitle(type: NodeType, data: NodeData): string {
  const c = data.config;
  if (type === "app") return (c.connectionName as string) || "Get data";
  if (type === "output") return (c.name as string) || "New metric";
  if (type === "formula") return isDatasetFormulaOp(c.op ?? "percentage") ? "Summarize" : "Compare";
  if (type === "unite") return String(c.mode ?? "stack") === "match" ? "Match" : "Combine";
  return NODE_LABELS[type];
}
export function nodeTitle(type: NodeType, data: NodeData): string {
  const custom = typeof data.label === "string" ? data.label.trim() : "";
  return custom || defaultTitle(type, data);
}

/** Labels for the Formula's two named input handles, by operation. */
export function formulaHandleLabels(op: string): { a: string; b: string } {
  switch (op) {
    case "percentage":
      // "38 percent of what?" — the labels answer the question the way a
      // person asks it, not the way a fraction is typeset.
      return { a: "Count this", b: "Out of this" };
    case "ratio":
    case "divide":
      return { a: "Numerator", b: "Denominator" };
    case "percent_change":
      return { a: "Current", b: "Previous" };
    case "subtract":
    case "difference":
      return { a: "A (from)", b: "B (subtract)" };
    default:
      return { a: "A", b: "B" };
  }
}

/** A one-line human expression for a dataset Calculate (count/sum/avg/…). */
export function datasetCalcExpression(op: string, fieldLabel: string): string {
  switch (op) {
    case "count":
      return "Count of records";
    case "count_distinct":
      return `Unique values of ${fieldLabel}`;
    case "sum":
      return `Sum of ${fieldLabel}`;
    case "avg":
      return `Average of ${fieldLabel}`;
    case "median":
      return `Median of ${fieldLabel}`;
    case "min":
      return `Lowest ${fieldLabel}`;
    case "max":
      return `Highest ${fieldLabel}`;
    default:
      return op;
  }
}

/**
 * Short verbs for a filter rule, for prose rather than for a dropdown.
 *
 * FILTER_OP_LABELS is deliberately explicit ("Exactly matches
 * (case-sensitive)") because a dropdown is where that distinction has to be
 * made — it is the difference between "Outbound" matching and not matching.
 * A sentence restating the whole configuration needs the short form, or it
 * stops being readable at two conditions.
 */
const OP_PHRASE: Record<string, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn’t contain",
  starts_with: "starts with",
  ends_with: "ends with",
  gt: "is more than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  is_one_of: "is one of",
  is_not_one_of: "is none of",
  before: "is before",
  after: "is after",
  between: "is between",
};

/**
 * WHAT THIS STEP DOES, IN A SENTENCE, ABOVE ITS CONTROLS.
 *
 * The Calculate panel has always had one — a plain restatement of its own
 * configuration, sitting above the fields that produce it — and it is the
 * single most reassuring thing in the builder: it closes the loop between
 * "what I picked" and "what that means" without running anything.
 *
 * Every other step was left to be read off its own controls, which is exactly
 * the reading that goes wrong. A Filter showing `properties.data.direction` /
 * `Exactly matches (case-sensitive)` / `outbound` in three separate boxes is
 * three facts; "Keeps records where Direction is 'outbound'" is a sentence a
 * person can check against what they meant.
 *
 * Returns one line per clause. Empty for `formula`, which has its own richer
 * expression, and for steps whose whole configuration is already one sentence
 * on screen (a matching Combine).
 */
export function stepSummaryLines(
  type: NodeType,
  cfg: Record<string, unknown>,
  labelOf: (path: string) => string,
  ctx: { recordType?: string; inputCount?: number } = {},
): string[] {
  if (type === "filter") {
    const rules = Array.isArray(cfg.rules) ? (cfg.rules as Array<Record<string, unknown>>) : [];
    const combinator = String(cfg.combinator ?? "and") === "or" ? " or " : " and ";
    const clause = rules
      .filter((r) => String(r.field ?? "").trim() !== "")
      .map((r) => {
        const op = OP_PHRASE[String(r.op)] ?? String(r.op);
        // A rule comparing against another FIELD says so — it reads as a
        // literal otherwise, and "Email is Email" is nonsense a user would
        // stare at rather than recognise as field-to-field.
        if (r.valueKind === "field" && r.valueField) return `${labelOf(String(r.field))} ${op} ${labelOf(String(r.valueField))}`;
        const v = String(r.value ?? "").trim();
        if (!v) return `${labelOf(String(r.field))} ${op}`;
        return `${labelOf(String(r.field))} ${op} “${v}”`;
      });
    const dr = (cfg.dateRange ?? {}) as { enabled?: boolean; mode?: string; preset?: string; days?: number; from?: string; to?: string };
    const lines: string[] = [];
    lines.push(clause.length === 0 ? "Passes every record through — no conditions yet." : `Keeps records where ${clause.join(combinator)}.`);
    if (dr.enabled) {
      const period =
        dr.mode === "rolling"
          ? `the last ${dr.days ?? 30} days`
          : dr.mode === "between"
            ? dr.from
              ? `${dr.from}${dr.to ? ` to ${dr.to}` : " onwards"}`
              : "a custom range"
            : String(dr.preset ?? "last_30_days").replace(/_/g, " ");
      lines.push(`Only records from ${period}.`);
    }
    return lines;
  }

  if (type === "app") {
    const account = String(cfg.connectionName ?? "").trim();
    if (!account) return [];
    const kind = ctx.recordType?.trim() ? ctx.recordType : "All records";
    const dedupe = cfg.dedupe
      ? ` One record per ${labelOf(String(cfg.dedupeField ?? "subject"))}, keeping the ${String(cfg.dedupeKeep ?? "latest") === "earliest" ? "earliest" : "latest"}.`
      : "";
    return [`${kind} from ${account}.${dedupe}`];
  }

  if (type === "unite") {
    const n = ctx.inputCount ?? 0;
    if (String(cfg.mode ?? "stack") === "match") {
      // A half-answered Match has no honest sentence — naming only the side
      // that IS chosen would read as a complete rule that keeps the wrong
      // records. The setup hint on the card covers the unfinished case.
      const key = String(cfg.keyField ?? "");
      const lookup = String(cfg.lookupField ?? "");
      if (!key || !lookup) return [];
      const verb = String(cfg.matchMode ?? "appears") === "missing" ? "is not in" : "is in";
      return [`Keeps records whose ${labelOf(key)} ${verb} the other step’s ${labelOf(lookup)}.`];
    }
    return n === 0 ? ["Pick the steps whose records should flow on together."] : [`Records from ${n} step${n === 1 ? "" : "s"}, continuing as one list.`];
  }

  if (type === "paths") {
    const paths = Array.isArray(cfg.paths) ? (cfg.paths as Array<{ label?: string }>) : [];
    if (paths.length === 0) return [];
    return [`Splits into ${paths.length} branch${paths.length === 1 ? "" : "es"}: ${paths.map((p) => p.label ?? "?").join(", ")}.`];
  }

  if (type === "time_between") {
    const key = String(cfg.keyField ?? "");
    const start = String(cfg.startField ?? "");
    const end = String(cfg.endField ?? "");
    if (!key || !start || !end) return [];
    return [`For each ${labelOf(key)}, the time from ${labelOf(start)} to ${labelOf(end)}.`];
  }

  return [];
}

/** A one-line human expression for a Formula, using upstream titles when known. */
export function formulaExpression(op: string, aName: string, bName: string): string {
  switch (op) {
    case "percentage":
      return `${aName} ÷ ${bName} × 100`;
    case "ratio":
    case "divide":
      return `${aName} ÷ ${bName}`;
    case "percent_change":
      return `(${aName} − ${bName}) ÷ ${bName} × 100`;
    case "add":
      return `${aName} + ${bName}`;
    case "subtract":
    case "difference":
      return `${aName} − ${bName}`;
    case "multiply":
      return `${aName} × ${bName}`;
    case "average":
      return `(${aName} + ${bName}) ÷ 2`;
    default:
      return `${aName} ${op} ${bName}`;
  }
}

/** Minimal wording for a successful test result — just the number + a short verb. */
export function resultLabel(
  type: string,
  test: { recordsIn: number; recordsOut: number; tile?: unknown; value?: number },
  cfg: Record<string, unknown> = {},
): string {
  const { recordsOut, tile, value } = test;
  const tileVal = (tile as { value?: unknown } | undefined)?.value;
  const val = value != null ? String(value) : tileVal != null ? String(tileVal) : String(recordsOut);
  switch (type) {
    case "app":
      return `${recordsOut} loaded`;
    case "filter":
      return `${recordsOut} passed`;
    case "time":
      return `${recordsOut} kept`;
    case "time_between":
      return `${recordsOut} matched`;
    case "unite":
      // A matching Combine's number answers "how many survived the check",
      // not "how many were stacked" — the verb has to say which.
      return String(cfg.mode) === "match" ? `${recordsOut} kept` : `${recordsOut} combined`;
    case "paths":
      return `${recordsOut} routed`;
    case "group":
      return `${recordsOut} groups`;
    case "formula":
    case "calculate":
    case "output": {
      // A speed-to-lead read "285.195783". A raw float is not an answer:
      // a step measuring a length of time says "4h 45m", and anything else
      // gets thousands separators and two decimals at most.
      const n = value ?? (typeof tileVal === "number" ? tileVal : null);
      if (n == null) return `${val}`;
      if (cfg.resultKind === "duration") {
        return formatDuration(n, durationValueUnit(String(cfg.field ?? ""), String(cfg.durationUnit ?? "minutes")), String(cfg.durationDisplay ?? "auto"));
      }
      // A legacy Output node says "duration" through `format` + `unit`, not
      // `resultKind` — so this read its float raw ("285.19") while the tile it
      // publishes rendered "4h 45m". Same number, two readings, one step.
      if (type === "output" && cfg.format === "duration") {
        return formatDuration(n, String(cfg.unit ?? "seconds"), String(cfg.durationDisplay ?? "auto"));
      }
      return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    default:
      return `${recordsOut}`;
  }
}

/**
 * User-facing step status vocabulary (what the user should understand, not internals).
 *
 * THE TWO GREYS WERE OPPOSITE STATES WEARING ONE BADGE. "Needs setup" BLOCKS
 * publish — the step is unfinished and the flow cannot ship. "Ready to test"
 * blocks nothing — the step is complete and simply hasn't been run. Both were
 * `bg-neutral-100`, and they are by far the two most common states on a
 * half-built canvas, so the one badge a user most needs to act on was the one
 * they could not pick out.
 *
 * Amber is the product's existing "look at this" tone (the Test receipts, the
 * import notes), so `setup` borrows it and nothing new is invented.
 *
 * "Tested" rather than "Ready": green means the step RAN and returned data. It
 * has never meant the flow is correct, and a badge reading "Ready" over a step
 * whose filter matches the wrong column is a promise the product can't keep.
 * "Not tested" rather than "Ready to test": a status says what IS, not what to
 * do next — the footer button already says what to do next.
 */
export type NodeStatus = "ready" | "setup" | "untested" | "updating" | "error";
export const STATUS_META: Record<NodeStatus, { label: string; cls: string; border: string; dot: string; hint: string }> = {
  ready: { label: "Tested", cls: "bg-green-100 text-green-700", border: "border-green-300", dot: "bg-green-500", hint: "text-neutral-500" },
  setup: { label: "Needs setup", cls: "bg-amber-100 text-amber-800", border: "border-amber-300", dot: "bg-amber-500", hint: "text-amber-700" },
  untested: { label: "Not tested", cls: "bg-neutral-100 text-neutral-500", border: "border-neutral-300", dot: "bg-neutral-300", hint: "text-neutral-400" },
  updating: { label: "Testing…", cls: "bg-blue-100 text-blue-700", border: "border-blue-300", dot: "bg-blue-500", hint: "text-blue-600" },
  error: { label: "Error", cls: "bg-red-100 text-red-700", border: "border-red-300", dot: "bg-red-500", hint: "text-red-600" },
};

export function pathHandles(data: NodeData): Array<{ id: string; label: string }> {
  const paths = (data.config.paths as Array<{ id: string; label: string }>) ?? [];
  const handles = paths.map((p) => ({ id: p.id, label: p.label }));
  const fbId = data.config.fallbackId as string | undefined; // the "everything else" lane
  if (fbId) handles.push({ id: fbId, label: String(data.config.fallbackLabel ?? "Everything else") });
  return handles;
}
