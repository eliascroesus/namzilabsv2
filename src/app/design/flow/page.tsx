import { FlowCanvas } from "@/components/flow/flow-canvas";

/**
 * THE FLOW BUILDER, DRIVABLE WITHOUT AUTHENTICATION.
 *
 * Same move as `/design/canvas` made for the dashboard's grid, and for the same
 * reason: the builder sits behind WorkOS, so no screenshot and no harness could
 * reach it, and its layout is pure geometry that every test in the suite reads
 * as source text. A six-way Split with splits nested two deep under it drifted
 * hundreds of pixels off-centre for months while `tests/flow-canvas-utils.test.ts`
 * stayed green, because every fixture in it was a single split of leaf steps.
 *
 * The graph below IS that flow — the one a customer built and reported as "a
 * mess" — rebuilt step for step, so the thing that broke is the first thing
 * anyone rendering this page sees. The writes will fail here (there is no
 * session and no such flow), which costs nothing: what is being looked at is
 * placement, and placement is computed in the browser from `initialGraph`
 * before anything is saved.
 */
export const dynamic = "force-dynamic";

type RawNode = { id: string; type: string; position: { x: number; y: number }; data: { config?: unknown; label?: unknown; lastTest?: unknown } };

const at = (id: string, type: string, label: string, config: Record<string, unknown> = {}): RawNode => ({
  id,
  type,
  // Every coordinate on this canvas is computed; these are the placeholders a
  // stored graph carries, and they are deliberately wrong so that a layout that
  // silently stopped running would be obvious rather than plausible.
  position: { x: 0, y: 0 },
  data: { config, label },
});

const split = (id: string, labels: string[]): RawNode =>
  at(id, "paths", "", { paths: labels.map((label, i) => ({ id: `${id}_p${i}`, label, mode: "custom" })) });

const NODES: RawNode[] = [
  at("src", "app", "", { source: "gsheets", connectionName: "Google Sheets — Leads" }),
  split("hub", ["Booked calls", "No-shows", "Cancelled", "Refunded", "Churned", "Renewed"]),
  at("bA", "filter", "Booked calls"), at("bB", "filter", "No-shows"), at("bC", "filter", "Cancelled"),
  at("bD", "filter", "Refunded"), at("bE", "filter", "Churned"), at("bF", "filter", "Renewed"),
  split("hA", ["Paid", "Free"]), split("hB", ["First time", "Repeat"]), split("hC", ["Within 7 days", "Later"]),
  // Deliberately a `group`: that type name collides with a React Flow built-in,
  // and `pnpm flow`'s one-width assertion is what caught the stray box it drew.
  at("eSum", "group", "", { mode: "field", field: "source", aggregation: "count" }),
  at("fBetween", "time_between", ""),
  at("aA", "filter", "Paid"), at("aB", "filter", "Free"),
  at("bBa", "filter", "First time"), at("bBb", "filter", "Repeat"),
  at("cCa", "filter", "Within 7 days"), at("cCb", "filter", "Later"),
  at("fSum", "formula", "", { op: "count" }),
  split("hAA", ["High ticket", "Low ticket"]),
  at("calcB", "formula", "", { op: "count" }),
  at("calcBB", "formula", "", { op: "count" }),
  at("calcCC", "formula", "", { op: "count" }),
  at("aaA", "filter", "High ticket"), at("aaB", "filter", "Low ticket"),
  at("calcAA", "formula", "", { op: "count" }),
  /**
   * THE ONE STEP THAT OPENS A FIELD BROWSER. Every other card here configures
   * itself from dropdowns; `calculate` is the only type whose panel offers the
   * "Insert data" flyout, and that flyout's search had a bug nothing on this
   * page could reach — it matched a column's label, path and sample and never
   * the STEP's name, so typing "Booked" against a canvas full of steps called
   * Booked calls / No-shows / Refunded returned "No fields match".
   *
   * A leaf on the Refunded branch: it adds one card to a 27-card fixture, so
   * every geometry assertion above it is untouched, and it sits deep enough to
   * see the named filter steps the search is now expected to find.
   */
  at("calcNum", "calculate", "", { mode: "compare", op: "percentage" }),
];

const wire = (source: string, target: string, sourceHandle?: string) => ({ id: `e_${source}_${target}`, source, target, sourceHandle: sourceHandle ?? null });

const EDGES = [
  wire("src", "hub"),
  wire("hub", "bA", "hub_p0"), wire("hub", "bB", "hub_p1"), wire("hub", "bC", "hub_p2"),
  wire("hub", "bD", "hub_p3"), wire("hub", "bE", "hub_p4"), wire("hub", "bF", "hub_p5"),
  wire("bA", "hA"), wire("bB", "hB"), wire("bC", "hC"),
  wire("bE", "eSum"), wire("bF", "fBetween"), wire("fBetween", "fSum"),
  wire("hA", "aA", "hA_p0"), wire("hA", "aB", "hA_p1"),
  wire("hB", "bBa", "hB_p0"), wire("hB", "bBb", "hB_p1"),
  wire("hC", "cCa", "hC_p0"), wire("hC", "cCb", "hC_p1"),
  wire("aA", "hAA"), wire("aB", "calcB"), wire("bBb", "calcBB"), wire("cCb", "calcCC"),
  wire("hAA", "aaA", "hAA_p0"), wire("hAA", "aaB", "hAA_p1"),
  wire("aaB", "calcAA"), wire("bD", "calcNum"),
];

export default function DesignFlowPage() {
  return (
    <div data-design-flow className="h-dvh w-full">
      <FlowCanvas
        flowId="00000000-0000-0000-0000-000000000000"
        name="Leads"
        status="draft"
        publishedVersion={null}
        publishedFingerprint={null}
        initialGraph={{ nodes: NODES, edges: EDGES, metrics: [] }}
        connections={[{ id: "conn_specimen", name: "Google Sheets — Leads", source: "gsheets", syncStatus: "ready" }]}
      />
    </div>
  );
}
