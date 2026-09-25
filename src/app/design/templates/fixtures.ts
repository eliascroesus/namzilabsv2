import { buildSnapshot, type MetricFacts, type SourceView } from "@/lib/templates/snapshot";

/**
 * AN AUTHOR'S THREE VIEWS, AND THE TEMPLATE THE REAL BUILDER MAKES OF THEM —
 * shared by the `/design/templates` specimens so every surface draws the same
 * template. See that page's note for why these are built rather than written.
 */
export const FLOW = (n: number) => `flow:00000000-0000-4000-8000-00000000000${n}:out`;
const FACTS: Record<string, MetricFacts> = {
  [FLOW(1)]: { name: "Revenue", apps: ["stripe"] },
  [FLOW(2)]: { name: "Calls booked", apps: ["calendly"] },
  [FLOW(3)]: { name: "Show rate", apps: ["calendly"] },
  [FLOW(4)]: { name: "Deals won", apps: ["close"] },
  [FLOW(5)]: { name: "Leads", apps: ["typeform"] },
};

const AUTHOR: SourceView[] = [
  {
    name: "Overview",
    kind: "custom",
    tiles: [
      { tileKey: "block:text", chart: "text", config: { text: "Week one — fill in the top row first", textSize: "lg" }, x: 0, y: 0, w: 12, h: 2 },
      { tileKey: FLOW(1), chart: "number", config: { color: "teal", note: "Cash collected this month, from Stripe — not invoices sent" }, x: 0, y: 2, w: 3, h: 4 },
      { tileKey: FLOW(2), chart: "number", config: {}, x: 3, y: 2, w: 3, h: 4 },
      { tileKey: FLOW(3), chart: "number", config: { title: "Show-up rate" }, x: 6, y: 2, w: 3, h: 4 },
      { tileKey: FLOW(5), chart: "number", config: {}, x: 9, y: 2, w: 3, h: 4 },
      { tileKey: FLOW(1), chart: "area", config: {}, x: 0, y: 6, w: 6, h: 6 },
      { tileKey: FLOW(5), chart: "pipeline", config: { parts: [FLOW(2), FLOW(4)] }, x: 6, y: 6, w: 6, h: 6 },
    ],
    groups: [],
    placements: [],
    calendarKey: null,
    notes: new Map(),
  },
  {
    name: "Sales",
    kind: "groups",
    tiles: [],
    groups: [
      { id: "g1", name: "Calls", color: "blue", sortKey: "manual", pos: "i" },
      { id: "g2", name: "Money", color: "teal", sortKey: "manual", pos: "r" },
    ],
    placements: [
      { tileKey: FLOW(2), groupId: "g1", pos: "i" },
      { tileKey: FLOW(3), groupId: "g1", pos: "r" },
      { tileKey: FLOW(1), groupId: "g2", pos: "i" },
      { tileKey: FLOW(4), groupId: "g2", pos: "r" },
    ],
    calendarKey: null,
    notes: new Map(),
  },
  { name: "Bookings", kind: "calendar", tiles: [], groups: [], placements: [], calendarKey: FLOW(2), notes: new Map() },
];

export const SNAPSHOT = buildSnapshot(AUTHOR, (k) => FACTS[k]);
