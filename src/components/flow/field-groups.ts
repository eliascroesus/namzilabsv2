import { catalogEntry } from "@/connectors/catalog";
import { flattenFields } from "./controls/field-utils";
import type { FieldGroup } from "./graph-utils";
import type { DataGroup } from "./controls/types";

/**
 * Adapt the builder's upstream field provenance (graph-utils `FieldGroup`) into the
 * control system's `DataGroup` shape.
 */
/**
 * Put the fields people actually build on first (catalog `commonFields`),
 * keeping everything else in its existing order behind them.
 *
 * Display ranking only — nothing is removed, and an unranked field is still
 * one search away. The reason this exists: a Close record carries ~480
 * fields, so an alphabetical list opens on `data.address_id` while the
 * question the user came to answer is about `data.direction`.
 */
/**
 * The canonical fields EVERY step carries, floated ahead of a source's own.
 *
 * `buildFieldGroups` appends these last (after every custom field), so on a
 * source with hundreds of fields the step's own timestamp — the default of
 * every date picker in the product — fell off the end of the list. A picker
 * whose currently-selected value isn't visible in its own open list is the
 * clearest possible way to look broken.
 */
const SPINE_FIELDS = ["subject", "occurredAt", "value", "eventType", "source"] as const;

export function rankFields<T extends { path: string }>(source: string | undefined, fields: T[]): T[] {
  const common = [...SPINE_FIELDS, ...(catalogEntry(source ?? "")?.commonFields ?? [])];
  if (common.length === 0 || fields.length === 0) return fields;
  const rank = new Map(common.map((p, i) => [p, i]));
  const first: Array<{ at: number; f: T }> = [];
  const rest: T[] = [];
  for (const f of fields) {
    const at = rank.get(f.path);
    if (at == null) rest.push(f);
    else first.push({ at, f });
  }
  if (first.length === 0) return fields;
  first.sort((a, b) => a.at - b.at); // the catalog's order IS the priority
  return [...first.map((x) => x.f), ...rest];
}

/**
 * Flatten and rank a group's fields ONCE, where the group is built.
 *
 * Doing it in the browser instead meant the list showed a nested field the
 * input box could not find, so picking `data.direction` displayed something
 * else — the two disagreed because only one of them had the flat list.
 */
export function prepareGroups(groups: DataGroup[]): DataGroup[] {
  return groups.map((g) => ({ ...g, fields: dropEmpty(rankFields(g.source, flattenFields(g.fields))) }));
}

/**
 * A field with no value on ANY record is not offered at all.
 *
 * It used to be sorted to the back, which still opened a Close step on 93
 * fields where 33 resolve to nothing on every record — the list was no
 * shorter, only reordered. Removing is safe because nothing executes against
 * this schema: the engine resolves every path at runtime through `getField`,
 * so a hidden field can never change a number. And a path any step has SAVED
 * never arrives here marked empty — it is pinned upstream, in
 * `appFieldUnion`, precisely so a picker is never missing its own value.
 *
 * `populated !== 0`, not `!populated`: a drilled-in child built by
 * `childFields` carries no count at all and must survive.
 */
function dropEmpty<T extends { populated?: number }>(fields: T[]): T[] {
  return fields.some((f) => f.populated === 0) ? fields.filter((f) => f.populated !== 0) : fields;
}

export function toDataGroups(fieldGroups: FieldGroup[]): DataGroup[] {
  const out: DataGroup[] = fieldGroups.map((g, i) => ({
    // The REAL node id when there is one. Time between persists which step a
    // picked moment came from, so this had to stop being a render-local
    // string; the synthetic form survives only for system groups that no node
    // produces.
    stepId: g.nodeId ?? `g${i}:${g.stepNo ?? "sys"}:${g.from}`,
    stepNo: g.stepNo,
    source: g.appSource,
    title: g.from,
    system: g.system,
    fields: g.fields.map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container, populated: f.populated })),
  }));
  return prepareGroups(out);
}

/**
 * Dates and numbers only — the two kinds of value a clock can read. A step's
 * own "Output number" (`__count_<id>`) is excluded: it is a record COUNT, not
 * a moment, and a picker listing it next to a timestamp invites a metric that
 * measures the gap between two tallies.
 */
export function momentGroups(groups: DataGroup[]): DataGroup[] {
  const out: DataGroup[] = [];
  for (const g of groups) {
    const fields = g.fields.filter((f) => (f.type === "date" || f.type === "number") && !f.path.startsWith("__"));
    if (fields.length > 0) out.push({ ...g, fields });
  }
  return out;
}

