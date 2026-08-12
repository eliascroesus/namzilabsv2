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
 * - Median, not average, and the Calculation dropdown on that step is how you
 *   change it. Re-measured on live Close data (419 leads, 203 called): median
 *   4h 44m, average 27h 36m. The average is not a slower version of the same
 *   answer, it is a different and worse one, which is why the description no
 *   longer advertises the switch.
 * - A second endpoint breaks the SAME duration down by the lead's status, and
 *   ships DISABLED — one checkbox, not a second tile nobody asked for. On the
 *   same live data it separates 5h 20m (booked for a demo) from 2h 21m
 *   (opted in), which is the follow-up question every median provokes. It
 *   groups on a field of the LEAD, deliberately: Time between emits the START
 *   record, so a call-side field (who dialled) is not on the row and would
 *   silently produce one "(not set)" group. The status is the one the lead
 *   carried WHEN IT WAS CREATED — the event log stores the object as it was
 *   at the event — so every label the user sees says "when created" rather
 *   than implying today's pipeline stage.
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
          config: {
            keyField: "properties.lead_id",
            // The two Get data steps ARE the two lanes: leads start the clock,
            // calls stop it. Both carry `occurredAt`, so the step id is what
            // tells them apart.
            startField: "occurredAt",
            startStep: "leads",
            endField: "occurredAt",
            endStep: "calls",
          },
        },
      },
      {
        id: "median",
        type: "formula",
        data: { label: "Speed to lead", config: { op: "median", field: "properties.time_between.minutes", resultKind: "duration", durationUnit: "minutes", distinctField: "subject" } },
      },
      {
        id: "bystatus",
        type: "formula",
        data: {
          label: "By status when created",
          config: {
            op: "median",
            field: "properties.time_between.minutes",
            resultKind: "duration",
            durationUnit: "minutes",
            distinctField: "subject",
            groupBy: { type: "field", field: "properties.data.status_label", topN: null },
          },
        },
      },
    ],
    edges: [
      { id: "leads->combine", source: "leads", target: "combine" },
      { id: "calls->outbound", source: "calls", target: "outbound" },
      { id: "outbound->combine", source: "outbound", target: "combine" },
      { id: "combine->gap", source: "combine", target: "gap" },
      { id: "gap->median", source: "gap", target: "median" },
      { id: "gap->bystatus", source: "gap", target: "bystatus" },
    ],
    metrics: [
      { nodeId: "median", enabled: true, name: "Speed to lead", viz: "number", format: "duration", unit: "minutes", precision: 0 },
      // Disabled, like the no-show template's count nodes: a second terminal
      // would otherwise be seeded as an enabled tile named after its step.
      { nodeId: "bystatus", enabled: false, name: "Speed to lead by status when created", viz: "bar", format: "duration", unit: "minutes", precision: 0 },
    ],
  });
}

/** No-show rate: what share of booked Calendly meetings ended in a no-show. */
function noShowRateCalendly(connectionId: string | null): FlowGraph {
  const conn = { connectionId, source: "calendly", sourceConfig: { scope: "organization" } };
  return parseGraph({
    nodes: [
      { id: "booked", type: "app", data: { label: "Meetings", config: { ...conn, eventType: "booked" } } },
      { id: "noshow", type: "app", data: { label: "No-shows", config: { ...conn, eventType: "no_show" } } },
      { id: "countb", type: "formula", data: { label: "Booked count", config: { op: "count", field: "value", distinctField: "subject" } } },
      { id: "countn", type: "formula", data: { label: "No-show count", config: { op: "count", field: "value", distinctField: "subject" } } },
      { id: "rate", type: "formula", data: { label: "No-show rate", config: { op: "percentage" } } },
    ],
    edges: [
      { id: "booked->countb", source: "booked", target: "countb" },
      { id: "noshow->countn", source: "noshow", target: "countn" },
      { id: "countn->rate:a", source: "countn", target: "rate", targetHandle: "a" },
      { id: "countb->rate:b", source: "countb", target: "rate", targetHandle: "b" },
    ],
    // The count nodes are structural terminals (their only outgoing edges are
    // a/b number references, which the layout drops), so Review & publish
    // would otherwise seed them as ENABLED metrics named after the steps.
    // Pre-seeding them disabled keeps them one checkbox away, not shipped.
    metrics: [
      { nodeId: "rate", enabled: true, name: "No-show rate", viz: "number", format: "percent", precision: 1 },
      { nodeId: "countb", enabled: false, name: "Meetings booked", viz: "number", format: "number", precision: 0 },
      { nodeId: "countn", enabled: false, name: "No-shows", viz: "number", format: "number", precision: 0 },
    ],
  });
}

/**
 * Meetings HAPPENING this month, windowed by the filter's date range.
 *
 * It was called "Bookings this month" and it never counted bookings. A
 * Calendly record's `occurredAt` is the meeting's START TIME, not when it was
 * booked (see the connector's mapping), so windowing on it answers "how many
 * meetings are on the calendar this month" — a real and useful question, and
 * not the one the name asked. Booking date lives at `properties.booked_at`;
 * counting on that is a different template, and it carries a caveat, because
 * Calendly is synced over a start-time window, so a meeting booked in August
 * for a date already past may not be stored at all.
 */
function bookingsThisMonthCalendly(connectionId: string | null): FlowGraph {
  const conn = { connectionId, source: "calendly", sourceConfig: { scope: "organization" } };
  return parseGraph({
    nodes: [
      { id: "booked", type: "app", data: { label: "Meetings booked", config: { ...conn, eventType: "booked" } } },
      {
        id: "window",
        type: "filter",
        data: {
          label: "Happening this month",
          config: { combinator: "and", rules: [], dateRange: { enabled: true, dateField: "occurredAt", mode: "preset", preset: "this_month" } },
        },
      },
      { id: "count", type: "formula", data: { label: "Meetings", config: { op: "count", field: "value", distinctField: "subject" } } },
    ],
    edges: [
      { id: "booked->window", source: "booked", target: "window" },
      { id: "window->count", source: "window", target: "count" },
    ],
    metrics: [{ nodeId: "count", enabled: true, name: "Meetings this month", viz: "number", format: "number", precision: 0 }],
  });
}

/** Outbound calls per day: dial volume as a daily bar chart. */
function outboundCallsPerDayClose(connectionId: string | null): FlowGraph {
  const conn = { connectionId, source: "close" };
  return parseGraph({
    nodes: [
      { id: "calls", type: "app", data: { label: "Calls dialed", config: { ...conn, eventType: "call_logged", sourceConfig: {} } } },
      {
        id: "outbound",
        type: "filter",
        data: {
          label: "Outbound only",
          config: { combinator: "and", rules: [{ field: "properties.data.direction", op: "equals", value: "outbound", valueKind: "fixed" }] },
        },
      },
      { id: "perday", type: "formula", data: { label: "Calls per day", config: { op: "count", field: "value", distinctField: "subject", groupBy: { type: "time", unit: "day" } } } },
    ],
    edges: [
      { id: "calls->outbound", source: "calls", target: "outbound" },
      { id: "outbound->perday", source: "outbound", target: "perday" },
    ],
    metrics: [{ nodeId: "perday", enabled: true, name: "Outbound calls per day", viz: "bar", format: "number", precision: 0 }],
  });
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "speed-to-lead-close",
    name: "Speed to lead (Close)",
    description:
      "How fast your team calls new leads: from a lead being created to its first outbound call, median across leads. Leads never called are counted and reported when you test, never folded in as a zero. A second result — one checkbox away at publish — splits the same number by the status each lead had when it was created. Close's event log only reaches back about 30 days, so leads created before you connected aren't in it.",
    source: "close",
    build: speedToLeadClose,
  },
  {
    id: "no-show-rate-calendly",
    name: "No-show rate (Calendly)",
    description: "What share of booked meetings ended in a no-show — booked and no-show counts, divided.",
    source: "calendly",
    build: noShowRateCalendly,
  },
  {
    id: "bookings-this-month-calendly",
    name: "Meetings this month (Calendly)",
    description:
      "One number: meetings taking place this month. Calendly dates records by when the meeting starts, so this counts what is on the calendar — for meetings booked this month, window on booked_at instead.",
    source: "calendly",
    build: bookingsThisMonthCalendly,
  },
  {
    id: "outbound-calls-per-day-close",
    name: "Outbound calls per day (Close)",
    description: "Dial volume as a daily bar chart — inbound calls filtered out.",
    source: "close",
    build: outboundCallsPerDayClose,
  },
];

export function flowTemplate(id: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.id === id);
}
