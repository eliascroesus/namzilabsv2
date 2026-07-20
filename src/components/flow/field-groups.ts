import type { FieldGroup } from "./graph-utils";
import type { DataGroup } from "./controls/types";

/**
 * Adapt the builder's upstream field provenance (graph-utils `FieldGroup`) into the
 * control system's `DataGroup` shape. The synthetic `stepId` is stable within a render
 * (it drives only in-panel stale detection); condition/mapping values persist plain
 * field paths, never this id, so it is safe that it is not a real node id.
 */
export function toDataGroups(fieldGroups: FieldGroup[]): DataGroup[] {
  return fieldGroups.map((g, i) => ({
    stepId: `g${i}:${g.stepNo ?? "sys"}:${g.from}`,
    stepNo: g.stepNo,
    source: g.appSource,
    title: g.from,
    system: g.system,
    fields: g.fields.map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container })),
  }));
}
