import { z } from "zod";
import { GROUP_ACCENT } from "@/components/flow/node-accent";

/**
 * A CUSTOM TILE'S PRESENTATION — everything about HOW its number is shown,
 * chosen on the view rather than inside the flow.
 *
 * This is the other half of the facts/presentation seam. The flow spec states
 * what a number IS (`TileFacts`, stamped on the tile at materialize); this bag
 * states how one tile draws it, and it lives in the `config` jsonb that
 * `dashboard_tiles` already carries — no migration, and CUSTOM VIEWS ONLY: the
 * groups board keeps `FlowTile` doing its best with what it has, because
 * nobody chose a chart there.
 *
 * The tile's CHART is deliberately not in this bag — it has been a column of
 * its own since the table was born, and mirroring it here would be two sources
 * of truth for the one choice the whole feature turns on.
 *
 * THERE IS NO `currency` KEY, AND THAT IS A REFUSAL, NOT AN OMISSION.
 * `formatMetricValue` relabels but never converts: a $12,400 metric restyled
 * "EUR" would print €12,400 — a confidently wrong number of exactly the kind
 * this feature exists to eliminate. Currency stays a publish-time property of
 * the metric.
 *
 * Consumers of most keys arrive with the chart kit; `title` is read today.
 * The schema lands first so every write from now on is validated and every
 * stored bag is parseable, whichever build wrote it.
 */

const KEYS = {
  /** The name on the card. Absent = follow the metric's own name. */
  title: z.string().trim().min(1).max(60),
  /** Decimal places, capped where legibility ends. */
  precision: z.number().int().min(0).max(4),
  /** A GROUP_ACCENT key — a key, not a hex, so a palette re-solve restyles every board at once. */
  color: z.string().refine((c) => c in GROUP_ACCENT),
  /** The tile's own goal. Seeded from the flow's target; null clears it. */
  target: z.number().finite().nullable(),
  showDelta: z.boolean(),
  showGoal: z.boolean(),
  showLabels: z.boolean(),
  showSpark: z.boolean(),
  /** Grouped charts: how the rows are ordered. "stored" is the materializer's order. */
  sort: z.enum(["stored", "value_desc", "value_asc", "label_asc"]),
  /** Grouped charts: how many rows before the honesty footer takes over. */
  limit: z.number().int().min(1).max(50),
  donut: z.boolean(),
  legend: z.enum(["right", "bottom", "none"]),
} as const;

export type TileConfig = { [K in keyof typeof KEYS]?: z.infer<(typeof KEYS)[K]> };

export const TILE_CONFIG_KEYS = Object.keys(KEYS) as Array<keyof typeof KEYS>;

/**
 * EACH KNOWN KEY PARSES INDEPENDENTLY, AND THAT IS THE WHOLE DESIGN.
 *
 * A single `z.object(...).safeParse` is all-or-nothing: one corrupt `limit`
 * written by a buggy build — or by a hand in the SQL editor — would erase a
 * perfectly good `color` and render the tile with every default at once, which
 * reads as "my settings vanished". Here a bad value costs exactly its own key.
 *
 * UNKNOWN KEYS ARE IGNORED ON READ AND MUST BE PRESERVED ON WRITE — forward
 * compatibility in both directions. A key added by a future release must not
 * make today's build render a default-everything tile (ignored covers that),
 * and today's build must not strip it while editing a neighbour (the write
 * path merges with jsonb `||` rather than replacing the bag — see
 * `setCustomTileAction`, which learned that the hard way with `title`).
 *
 * NEVER throws. The worst input — null, a string, an array — parses to the
 * empty config, which renders as every default: exactly what a tile with no
 * choices made should look like.
 */
export function parseTileConfig(raw: unknown): TileConfig {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return {};
  const bag = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TILE_CONFIG_KEYS) {
    if (!(key in bag)) continue;
    const parsed = KEYS[key].safeParse(bag[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as TileConfig;
}
