import { parseGraph, type FlowGraph } from "./types";

/**
 * Starter flows — a complete, tested-shape graph the user opens instead of a
 * blank canvas. Templates are plain node/edge JSON run through `parseGraph`
 * (the same choke point every load path uses), so a template that drifts
 * from the schema fails loudly in tests, not silently in a customer's
 * editor.
 *
 * `build(connectionId)` takes the connection to prefill — null when the org
 * has none (or several) of the source, in which case the Get data steps
 * simply show "Needs setup / Choose an account" and everything else is
 * already wired.
 *
 * Templates may pre-seed `graph.metrics`: Review & publish preserves a
 * pre-seeded spec for an endpoint instead of inventing a default name.
 */
export type FlowTemplate = {
  id: string;
  name: string;
  description: string;
  /** Source whose connection gets prefilled (and the gallery badge). */
  source: string;
  build: (connectionId: string | null) => FlowGraph;
};

/**
 * The flagship. Speed to lead = for each lead, minutes from `lead_created`
 * to the FIRST outbound `call_logged`, median across leads.
 *
 * Shape decisions, each load-bearing:
 * - The outbound Filter sits DIRECTLY after the calls Get-data step, so the
 *   compiled engine folds it into SQL (a linear filter chain off an app
 *   node is exactly what the pushdown handles).
 * - The join key is `properties.lead_id` — the Event Log envelope's
 *   top-level lead reference, the one field present on BOTH a lead event
 *   and a call event. (`properties.data.lead_id` exists only on the call
 *   side; the lead object carries `data.id` instead.) Verified against
 *   live data by scripts/verify-close-speed-to-lead.sql.
 * - Median, not average: one lead called after a weekend would drag an
 *   average into uselessness; the template description says how to switch.
 */
function speedToLeadClose(connectionId: string | null): FlowGraph {
  const conn = { connectionId, source: "close" };
  return parseGraph({
    nodes: [
      { id: "leads", type: "app", data: { label: "Leads created", config: { ...conn, eventType: "lead_created", sourceConfig: {} } } },
      { id: "calls", type: "app", data: { label: "Calls dialed", config: { ...conn, eventType: "call_logged", sourceConfig: {} } } },
      {
        id: "outbound",
        type: "filter",
        data: {
          label: "Outbound only",
          config: {
            combinator: "and",
            rules: [{ field: "properties.data.direction", op: "equals", value: "outbound", valueKind: "fixed" }],
          },
        },
      },
      { id: "combine", type: "unite", data: { label: "Leads + calls together", config: {} } },
      {
        id: "gap",
        type: "time_between",
        data: {
          label: "Time to first call",
          config: { keyField: "properties.lead_id", fromType: "lead_created", toType: "call_logged", mode: "first", unit: "minutes" },
        },
      },
      {
        id: "median",
        type: "formula",
        data: { label: "Speed to lead", config: { op: "median", field: "properties.duration", distinctField: "subject" } },
      },
    ],
    edges: [
      { id: "leads->combine", source: "leads", target: "combine" },
      { id: "calls->outbound", source: "calls", target: "outbound" },
      { id: "outbound->combine", source: "outbound", target: "combine" },
      { id: "combine->gap", source: "combine", target: "gap" },
      { id: "gap->median", source: "gap", target: "median" },
    ],
    metrics: [{ nodeId: "median", enabled: true, name: "Speed to lead (median minutes)", viz: "number", format: "number", precision: 0 }],
  });
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "speed-to-lead-close",
    name: "Speed to lead (Close)",
    description:
      "How fast your team calls new leads: minutes from a lead being created to its first outbound call, median across leads. Switch the last step to Average with one dropdown if you prefer.",
    source: "close",
    build: speedToLeadClose,
  },
];

export function flowTemplate(id: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.id === id);
}
