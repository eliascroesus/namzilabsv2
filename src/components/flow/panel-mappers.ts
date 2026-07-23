import type { FilterConfig } from "@/lib/flow/types";

/**
 * Pure mappers between the node config blobs the engine persists and the control
 * system's value model. Kept dependency-light so config round-tripping is unit-tested
 * without rendering (a bug here silently corrupts saved flows).
 */

/** Coerce a loosely-typed config blob into a FilterConfig for the ConditionEditor. */
export function asFilterConfig(cfg: Record<string, unknown>): FilterConfig {
  return {
    combinator: (cfg.combinator as "and" | "or") ?? "and",
    rules: (cfg.rules as FilterConfig["rules"]) ?? [],
    dateRange: cfg.dateRange as FilterConfig["dateRange"],
  };
}
