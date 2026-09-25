import {
  AreaChart,
  BarChart3,
  BarChartHorizontal,
  FilterX,
  Hash,
  Heading2,
  Minus,
  PieChart,
  Rows3,
  Table as TableIcon,
  Target,
  TrendingUp,
  Type,
} from "lucide-react";
import type { ChartId } from "./charts";

/**
 * Chart id → its icon. Read by the canvas's Add menu and empty slots, and by a
 * template's public preview, which draws the same slots without loading the
 * board that edits them. `satisfies`-complete, so a chart added to the registry
 * without an icon is a type error rather than an empty square.
 */
export const CHART_ICONS: Record<ChartId, typeof Hash> = {
  number: Hash,
  line: TrendingUp,
  area: AreaChart,
  bar: BarChart3,
  category: Rows3,
  ranked: BarChartHorizontal,
  pie: PieChart,
  progress: Target,
  pipeline: FilterX,
  table: TableIcon,
  heading: Heading2,
  text: Type,
  divider: Minus,
};
