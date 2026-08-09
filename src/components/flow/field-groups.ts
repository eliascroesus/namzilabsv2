import { catalogEntry } from "@/connectors/catalog";
import type { FieldGroup } from "./graph-utils";
import type { DataGroup } from "./controls/types";

/**
 * Adapt the builder's upstream field provenance (graph-utils `FieldGroup`) into the
 * control system's `DataGroup` shape. The synthetic `stepId` is stable within a render
 * (it drives only in-panel stale detection); condition/mapping values persist plain
 * field paths, never this id, so it is safe that it is not a real node id.
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

export function toDataGroups(fieldGroups: FieldGroup[]): DataGroup[] {
  return fieldGroups.map((g, i) => ({
    stepId: `g${i}:${g.stepNo ?? "sys"}:${g.from}`,
    stepNo: g.stepNo,
    source: g.appSource,
    title: g.from,
    system: g.system,
    fields: rankFields(
      g.appSource,
      g.fields.map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container })),
    ),
  }));
}
