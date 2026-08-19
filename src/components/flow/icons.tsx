"use client";

import {
  BarChart3,
  Blend,
  CalendarRange,
  Database,
  Divide,
  Filter,
  LayoutGrid,
  LayoutDashboard,
  Merge,
  Split,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { sourceStyle } from "./controls/source-style";

/**
 * The step glyphs — lucide, not hand-drawn.
 *
 * These were nine bespoke SVG paths written by hand, and they looked it:
 * inconsistent optical weight, stroke joins that did not match each other, a
 * "Calculate" mark that was three dots and a slash. Hand-rolled icon sets are
 * the single loudest tell that an interface was assembled rather than
 * designed, because a real product uses a real family and a real family is
 * internally consistent in ways nobody redraws by accident.
 *
 * lucide is the family shadcn ships with: one stroke width, one grid, one
 * join style, ~1,600 icons — so the next step type already has its icon.
 *
 * Each mapping is the most literal available, because a glyph that needs
 * explaining is doing nothing:
 *   Database — records come out of a store
 *   Merge    — lanes becoming one line
 *   Blend    — two overlapping sets, which IS what matching keeps
 *   Filter   — a funnel
 *   Split    — one line becoming several
 *   BarChart3— a pile of records becoming one number
 *   Divide   — every rate, ratio and % change is one number over another
 *   Timer    — elapsed time between two moments
 */
const GLYPH: Record<string, LucideIcon> = {
  app: Database,
  unite: Merge,
  unite_match: Blend,
  filter: Filter,
  paths: Split,
  formula: BarChart3,
  formula_compare: Divide,
  time_between: Timer,
  time: CalendarRange,
  group: LayoutGrid,
  output: LayoutDashboard,
  calculate: BarChart3,
};

/**
 * The one colourful step icon used everywhere a step is represented — the node
 * picker, the canvas cards, the config panel header. Each step type gets a vivid
 * accent (Make.com's coloured module tiles); a Get-data step instead shows its
 * connected app's brand colour + initials, so a Sheets step reads as Sheets.
 */
/**
 * NINE DISTINCT HUES, none of them grey.
 *
 * `app` was slate — the one step every flow starts with, wearing the colour of
 * something switched off, in a picker where it sits first. A step's tile is
 * its identity and grey is the absence of one. Every entry is now a saturated
 * hue with a clear neighbour distance, so no two steps read as the same family
 * at a glance on a canvas.
 */
export const NODE_ACCENT: Record<string, string> = {
  app: "#10B981", // emerald — where records come IN
  unite: "#0EA5E9", // sky — bringing lanes together
  filter: "#3B82F6", // blue — Conditions
  paths: "#EC4899", // pink — Conditions (split)
  formula: "#8B5CF6", // violet — Calculation
  calculate: "#8B5CF6", // violet — Calculation (legacy)
  time: "#F59E0B", // amber — Conditions (date)
  time_between: "#14B8A6", // teal — Calculation (pairing)
  group: "#F97316", // orange — Calculation (legacy)
  output: "#6366F1", // indigo — Dashboard
};

/**
 * `variant` is the step's JOB, where one node type has two of them —
 * "unite_match", "formula_compare". Same accent colour (they are the same kind
 * of operation), different glyph, so the two doors are never one face.
 */
export function NodeIcon({ type, source, variant, size = 34 }: { type: string; source?: string | null; variant?: string; size?: number }) {
  // PROPORTIONAL, not a token. This mark renders at 28 / 38 / 44 depending on
  // where it is, and a fixed radius from the scale would read square at 44 and
  // pill-like at 28. 0.3 keeps the same corner CHARACTER at every size, which
  // is the thing being held constant — so 13px at 44 is a derived value, not a
  // number off the radius scale that someone forgot to round.
  const radius = Math.max(6, Math.round(size * 0.3));
  // A CONNECTED Get-data step wears its app's brand mark. An unconnected one —
  // the picker's own "Get data" entry, and every step before an account is
  // chosen — used to render a grey tile reading "Ap", which looks like a
  // failed image rather than a step.
  if (type === "app" && source) {
    const s = sourceStyle(source);
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center font-semibold leading-none text-white"
        style={{ background: s.color, width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.42) }}
        title={s.label}
        aria-hidden
      >
        {s.short}
      </span>
    );
  }
  const key = variant && GLYPH[variant] ? variant : type;
  const color = NODE_ACCENT[type] ?? "#64748B";
  const Icon = GLYPH[key] ?? Database;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center text-white"
      style={{ background: color, width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      {/* Sized off the tile, and stroked a touch lighter as it grows so a
          40px picker icon does not read heavier than a 30px card one. */}
      <Icon size={Math.round(size * 0.54)} strokeWidth={size > 34 ? 1.9 : 2} aria-hidden />
    </span>
  );
}
