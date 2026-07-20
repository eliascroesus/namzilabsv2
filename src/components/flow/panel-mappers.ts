import type { DataGroup, ValueModel } from "./controls/types";
import { humanizeKey } from "./controls/field-utils";
import type { FilterConfig } from "@/lib/flow/types";

/**
 * Pure mappers between the node config blobs the engine persists and the control
 * system's value model. Kept dependency-light so config round-tripping is unit-tested
 * without rendering (a bug here silently corrupts saved flows).
 */

/**
 * Read a "fixed value / use a field" pair (e.g. formatter `replaceWith` +
 * `replaceWithKind` + `replaceWithField`) into a {@link ValueModel}, snapshotting the
 * mapped field's display info from the currently-available groups.
 */
export function storedToValue(cfg: Record<string, unknown>, prefix: string, groups: DataGroup[]): ValueModel {
  if (cfg[`${prefix}Kind`] === "field" && cfg[`${prefix}Field`]) {
    const path = String(cfg[`${prefix}Field`]);
    const owner = groups.find((g) => g.fields.some((f) => f.path === path));
    const f = owner?.fields.find((x) => x.path === path);
    return {
      mode: "field",
      text: "",
      field: { producerStepId: owner?.stepId ?? "", fieldPath: path, label: f?.label ?? humanizeKey(path), source: owner?.source, stepNo: owner?.stepNo, sample: f?.sample },
    };
  }
  return { mode: "fixed", text: String(cfg[prefix] ?? ""), field: null };
}

/** Fold a {@link ValueModel} back into the persisted `<prefix>`/`<prefix>Kind`/`<prefix>Field` keys. */
export function valueToStored(v: ValueModel, prefix: string): Record<string, unknown> {
  if (v.mode === "field" && v.field) return { [`${prefix}Kind`]: "field", [`${prefix}Field`]: v.field.fieldPath, [prefix]: "" };
  return { [`${prefix}Kind`]: "fixed", [prefix]: v.text, [`${prefix}Field`]: undefined };
}

/** Coerce a loosely-typed config blob into a FilterConfig for the ConditionEditor. */
export function asFilterConfig(cfg: Record<string, unknown>): FilterConfig {
  return {
    combinator: (cfg.combinator as "and" | "or") ?? "and",
    rules: (cfg.rules as FilterConfig["rules"]) ?? [],
    dateRange: cfg.dateRange as FilterConfig["dateRange"],
  };
}
