import type { Node, Edge } from "@xyflow/react";
import { STANDARD_FIELDS, getField, type FlowRecord } from "@/lib/flow/records";
import { isDatasetFormulaOp } from "@/lib/flow/types";
import { isBinaryCalc, producesDataset } from "@/lib/flow/shapes";
import { catalogEntry } from "@/connectors/catalog";
import type { NodeTestDTO } from "@/app/dashboard/flows/actions";

// ---------- Shared editor types ----------

export type ConnMeta = { id: string; name: string; source: string; syncStatus?: string };

export type NodeData = {
  config: Record<string, unknown>;
  label?: string;
  lastTest?: NodeTestDTO | null;
  dirty?: boolean;
  // Transient (display-only) fields injected before render — never persisted:
  stepNo?: number;
  status?: "ready" | "setup" | "untested" | "updating" | "error";
  isTerminal?: boolean;
  issue?: string;
  freeHandles?: Array<{ id: string; label: string }>;
  onAddFrom?: (sourceNodeId: string, sourceHandle?: string | null, anchor?: { x: number; y: number; leftX?: number }) => void;
  onDeleteNode?: (id: string) => void;
  onDuplicateNode?: (id: string) => void;
  [k: string]: unknown;
};
export type FNode = Node<NodeData>;

export type Rule = { field: string; op: string; value: string; value2?: string; valueKind?: "fixed" | "field"; valueField?: string };
export type Filters = { combinator: string; rules: Rule[] };

export type PickField = { path: string; label: string; type?: string; example?: unknown; container?: boolean; populated?: number };
export type FieldGroup = {
  from: string;
  /** The step that produces these fields. Time between persists it, so it must be the real node id. */
  nodeId?: string;
  stepNo?: number;
  system?: boolean;
  /** Source app key of this group's nearest App ancestor (drives icon + brand colour). */
  appSource?: string;
  /** The selected preview record this group's examples were resolved from (for lazy nested expansion). */
  sampleRecord?: unknown;
  fields: PickField[];
};

export type MetricSpecT = { nodeId: string; enabled: boolean; name: string; viz: string; format: string; unit?: string; durationDisplay?: string; currency?: string; precision: number; target: number | null; timeField?: string; timeUnit?: string };
export type Graph = {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
  metrics: MetricSpecT[];
};

export type LibraryCtx = { fromNodeId?: string; sourceHandle?: string | null; onEdge?: Edge } | null;

// ---------- Pure graph algorithms ----------

/** A step that compares two numbers (its a/b inputs are data references, not chain links).
 * A Calculate running a dataset aggregation (count/sum/…) is NOT a compare step — its
 * chain edge is its record input. */
export function isCompareNode(n: FNode): boolean {
  return isBinaryCalc(String(n.type), (n.data.config ?? {}) as Record<string, unknown>);
}

/**
 * The edges that define the flow's SHAPE — the line the user reads. A compare step's
 * a/b number edges are data references chosen in the panel; they are excluded here so
 * that changing which data a step reads can never move any node. (A legacy compare
 * step without a plain chain edge keeps its "a" edge as its anchor so it doesn't float.)
 */
export function structuralEdges(nodes: FNode[], edges: Edge[]): Edge[] {
  const compareIds = new Set(nodes.filter(isCompareNode).map((n) => n.id));
  const hasPlainIn = new Set<string>();
  for (const e of edges) if (compareIds.has(e.target) && e.targetHandle == null) hasPlainIn.add(e.target);
  const kept = edges.filter((e) => {
    if (!compareIds.has(e.target)) return true;
    if (e.targetHandle === "b") return false;
    if (e.targetHandle === "a") return !hasPlainIn.has(e.target);
    return true;
  });
  /**
   * ONE LINE BETWEEN TWO STEPS, however many edges connect them.
   *
   * Every new Calculate is created with TWO edges from the step above it: the
   * chain edge that fixes its place in the line, and an "a" reference that
   * pre-fills its first number if the user later switches it to a comparison.
   * A Calculate's default op is `count`, which is not a comparison, so both
   * edges survived the filter above and the pair read as a two-input junction.
   * The damage was entirely downstream of that miscount: the layout treats
   * multi-input nodes as merges and centres them on their sources, dropping the
   * branch lane offset, so every Calculate under a Paths branch drifted right;
   * and delete-and-reconnect requires exactly one outgoing edge, saw two, and
   * orphaned the Calculate instead of bridging to it.
   *
   * Only ONE line is ever drawn between two steps anyway (`displayEdges`
   * collapses them), so this makes the shape the code reasons about the same
   * shape the customer is looking at. The plain chain edge wins, because that
   * is the one that means "comes after".
   */
  const byPair = new Map<string, Edge>();
  for (const e of kept) {
    const pair = `${e.source}::${e.sourceHandle ?? ""}->${e.target}`;
    const seen = byPair.get(pair);
    if (!seen || (seen.targetHandle != null && e.targetHandle == null)) byPair.set(pair, e);
  }
  return [...byPair.values()];
}

/** Assign 1-based step numbers in topological (top-to-bottom, left-to-right) order. */
export function computeStepNumbers(nodes: FNode[], allEdges: Edge[]): Map<string, number> {
  const edges = structuralEdges(nodes, allEdges);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const roots = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).sort((a, b) => a.position.y - b.position.y).map((n) => n.id);
  const queue = [...roots];
  const order = new Map<string, number>();
  let step = 1;
  while (queue.length) {
    const id = queue.shift()!;
    if (order.has(id)) continue;
    order.set(id, step++);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  for (const n of nodes) if (!order.has(n.id)) order.set(n.id, step++);
  return order;
}

/**
 * Managed top-to-bottom layout. Positions are always computed (users never place
 * nodes): depth flows downward via longest-path layering, and each layer is centred
 * horizontally so branches (Paths) fan out symmetrically. Only structural (chain)
 * edges shape the layout — a compare step's number references NEVER move anything.
 * A junction that genuinely joins several lanes (a Unite, a branch merge) is centred
 * between (and below) the lanes it joins — that merge IS the flow's shape.
 */
export function computeVerticalLayout(nodes: FNode[], allEdges: Edge[]): Map<string, { x: number; y: number }> {
  const structural = structuralEdges(nodes, allEdges);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const structuralIncoming = new Map<string, Array<{ source: string; handle: string | null }>>();
  for (const e of structural) {
    if (!structuralIncoming.has(e.target)) structuralIncoming.set(e.target, []);
    structuralIncoming.get(e.target)!.push({ source: e.source, handle: e.sourceHandle ?? null });
  }

  // Multi-input junctions (Unite, legacy merges) are centred between their lanes.
  type Merge = { centering: boolean; allSources: string[]; anchor: { source: string; handle: string | null } | null };
  const mergeInfo = new Map<string, Merge>();
  for (const n of nodes) {
    const chainIns = structuralIncoming.get(n.id) ?? [];
    if (chainIns.length <= 1) continue;
    mergeInfo.set(n.id, { centering: true, allSources: [...new Set(chainIns.map((i) => i.source))], anchor: chainIns[0] ?? null });
  }

  // Depth: longest path over chain edges, so a merge sits below every branch it joins.
  const depthEdges: Array<{ source: string; target: string }> = structural.map((e) => ({ source: e.source, target: e.target }));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of depthEdges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const depth = new Map<string, number>();
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const nx of adj.get(id) ?? []) {
      depth.set(nx, Math.max(depth.get(nx) ?? 0, (depth.get(id) ?? 0) + 1));
      indeg.set(nx, (indeg.get(nx) ?? 0) - 1);
      if (indeg.get(nx) === 0) queue.push(nx);
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  // Horizontal position: propagate a lane offset down each branch so a Paths split sends
  // its branches cleanly to the sides and every step in a branch stays in that branch's
  // column (instead of drifting back to centre). Non-branching chains stay at x = 0.
  const pathIds = (n: FNode | undefined): string[] => {
    if (!n) return [];
    const paths = (n.data.config?.paths as Array<{ id: string }> | undefined) ?? [];
    const ids = paths.map((p) => p.id);
    const fb = n.data.config?.fallbackId as string | undefined;
    if (fb) ids.push(fb);
    return ids;
  };
  /**
   * ONE COLUMN PITCH, used for both jobs, because two numbers drift.
   *
   * Branch lanes are PLACED at this pitch, and then the same-row packer below
   * ENFORCES it as a minimum. If the placement value were ever smaller than
   * the packing value, the packer would shove every lane after the first to
   * the right and a split would stop being symmetric about its hub — which is
   * exactly what happened when the card grew and the packing gap was raised
   * from 288 to 344 while the spread stayed at 320. They are the same
   * quantity ("how far apart do two columns sit"), so they are now the same
   * constant and cannot disagree again.
   *
   * The value follows the card: 300px wide plus a 44px gutter.
   */
  const COL = 344;
  const xById = new Map<string, number>();
  /** X under one incoming edge: the parent's lane, offset if it's a Paths branch. */
  const laneX = (edge: { source: string; handle: string | null }): number => {
    const px = xById.get(edge.source) ?? 0;
    const parent = nodeById.get(edge.source);
    if (parent && parent.type === "paths" && edge.handle) {
      const ids = pathIds(parent);
      const idx = ids.indexOf(edge.handle);
      // A handle the hub no longer lists (a stale edge from an undo, or a
      // branch removed while its child survived) used to clamp to 0 and so
      // claim the FIRST lane's column — landing on top of the branch that
      // really is lane one and shoving it sideways. It has no lane, so it gets
      // no offset and stays under the hub, where the packing can separate it.
      if (idx < 0) return px;
      return px + (idx - (ids.length - 1) / 2) * COL;
    }
    return px;
  };
  // Row pitch follows the card's HEIGHT the way COL follows its width: the
  // card grew from ~40px to ~76px (taller again with a publish footer), and
  // the ghost "Add next step" beneath a terminal needs its own room.
  const ROW = 232;
  const MIN_GAP = COL;
  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }
  const pos = new Map<string, { x: number; y: number }>();
  // Level by level, top down: place each node from its already-PACKED parents, then
  // nudge same-row overlaps apart and write the packed lane back — so a whole subtree
  // follows its root's final column. Several Get data roots therefore sit side by
  // side, each with its own chain running straight down its own lane.
  for (const [d, ids] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    for (const nid of ids) {
      const ins = structuralIncoming.get(nid) ?? [];
      const info = mergeInfo.get(nid);
      if (info) {
        if (info.centering) {
          const uniqueXs = [...new Set(info.allSources.map((s) => xById.get(s) ?? 0))];
          xById.set(nid, uniqueXs.reduce((a, b) => a + b, 0) / Math.max(1, uniqueXs.length));
        } else {
          // Anchored: exactly where its chain predecessor puts it. Reference sources
          // (whatever data it pulls in) never move it.
          xById.set(nid, info.anchor ? laneX(info.anchor) : 0);
        }
      } else if (ins.length === 0) {
        xById.set(nid, 0);
      } else {
        xById.set(nid, laneX(ins[0]));
      }
    }
    ids.sort((a, b) => (xById.get(a) ?? 0) - (xById.get(b) ?? 0));
    let prevX = -Infinity;
    for (const id of ids) {
      let x = xById.get(id) ?? 0;
      if (x - prevX < MIN_GAP) x = prevX + MIN_GAP;
      pos.set(id, { x, y: d * ROW });
      xById.set(id, x);
      prevX = x;
    }
  }
  return pos;
}

/**
 * Does this step's result become a dashboard tile when the flow is published?
 *
 * The rule — "a step becomes a metric by being a structural terminal" — was
 * never stated and never shown, and it surprises people on the second flow
 * everyone builds. Two counts feeding a rate: the counts' only outgoing edges
 * are number references, which the layout drops, so they ARE terminals, and
 * Review & publish offers three metrics to someone who expected one.
 *
 * Returns undefined for a step that publishes nothing either way, so a card
 * with no stake in this shows no badge at all rather than a reassuring "no".
 *
 * A terminal with no spec yet counts as publishing, because that is what
 * `openReview` will seed it as — a badge that said otherwise would be
 * predicting the opposite of what the modal is about to do. A legacy Output
 * node IS the tile, so it never wears the badge.
 */
export function publishesToDashboard(
  type: string,
  isTerminal: boolean,
  metric: { enabled?: boolean } | undefined,
): boolean | undefined {
  if (!isTerminal || type === "output") return undefined;
  return metric?.enabled ?? true;
}

/** Nodes with no outgoing chain edge — the "ends" of the flow (per branch). A step
 * that only feeds a compare reference is still a line end (it gets an Add-next). */
export function terminalIds(nodes: FNode[], allEdges: Edge[]): Set<string> {
  const hasOut = new Set(structuralEdges(nodes, allEdges).map((e) => e.source));
  return new Set(nodes.filter((n) => !hasOut.has(n.id)).map((n) => n.id));
}

/** Whether a step still needs required setup before it can produce a result. */
export function nodeNeedsSetup(type: string, cfg: Record<string, unknown>, inputCount: number, handles?: Array<string | null>, branchMode?: string | null): boolean {
  // A compare step needs both of its named numbers — a wired step OR a typed-in
  // literal per slot (a chain edge alone isn't enough).
  const aOk = (handles?.includes("a") ?? inputCount >= 1) || cfg.aFixed != null;
  const bOk = (handles?.includes("b") ?? inputCount >= 2) || cfg.bFixed != null;
  const missingAB = !aOk || !bOk;
  if (type === "app") {
    // No account = not set up, even when `source` is present (templates
    // preset the source so labels read right before an account is picked).
    // Without this, a source-only step silently read EVERY connection of
    // that source in the org — blended workspaces, double-counted dials.
    if (!cfg.connectionId) return true;
    // Stream-scoped sources also need their flow-level resource chosen (which sheet…).
    const flowFields = catalogEntry(String(cfg.source ?? ""))?.flowFields ?? [];
    const sc = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
    return flowFields.some((f) => f.required && String(sc[f.key] ?? "").trim() === "");
  }
  if (type === "formula") {
    // A dataset Calculate (count/sum/…) just needs records flowing in through
    // its plain chain edge; a binary one needs both of its numbers.
    if (isDatasetFormulaOp(cfg.op ?? "percentage")) return !(handles ? handles.some((h) => h == null) : inputCount >= 1);
    return missingAB;
  }
  if (type === "calculate") return String(cfg.mode ?? "number") === "compare" ? missingAB : inputCount === 0;
  if (type === "time_between") {
    const set = (k: string) => String(cfg[k] ?? "").trim().length > 0;
    return inputCount === 0 || !set("keyField") || !set("startField") || !set("endField");
  }
  if (type === "unite") {
    if (String(cfg.mode ?? "stack") !== "match") return inputCount === 0;
    // Matching needs two inputs AND all three answers: whose records
    // continue, matched on what, checked against what. A partial match has
    // no safe reading, so nothing here defaults.
    const set = (k: string) => String(cfg[k] ?? "").trim().length > 0;
    return inputCount < 2 || !set("keepNodeId") || !set("keyField") || !set("lookupField");
  }
  if (type === "output") return inputCount === 0 || !String(cfg.name ?? "").trim();
  if (type === "filter") {
    // A Filter with nothing to filter on passes every record and used to read
    // a green "Ready" — the most common half-built state in the product,
    // wearing the badge that means finished. A date window counts as set up.
    //
    // EXCEPT on a Paths branch head set to "Always run" or "Everything else",
    // where having no rules IS the configuration: the panel hides the
    // condition editor entirely for those modes, so a "Needs setup" badge
    // there could never be cleared — and it disables Continue and takes the
    // Test button with it.
    if (branchMode && branchMode !== "custom") return inputCount === 0;
    const rules = ((cfg.rules as unknown[] | undefined) ?? []).length;
    const dated = Boolean((cfg.dateRange as { enabled?: boolean } | undefined)?.enabled);
    return inputCount === 0 || (rules === 0 && !dated);
  }
  return inputCount === 0;
}

/** The single user-facing status for a step: Ready / Needs setup / Updating / Error. */
export function computeNodeStatus(opts: {
  type: string;
  cfg: Record<string, unknown>;
  inputCount: number;
  inputHandles?: Array<string | null>;
  /** For a Paths branch head: how records enter it. "always"/"fallback" need no rules. */
  branchMode?: string | null;
  lastTest?: { status?: string } | null;
  dirty?: boolean;
  updating?: boolean;
}): "ready" | "setup" | "untested" | "updating" | "error" {
  const { type, cfg, inputCount, inputHandles, branchMode, lastTest, dirty, updating } = opts;
  if (nodeNeedsSetup(type, cfg, inputCount, inputHandles, branchMode)) return "setup";
  if (updating) return "updating";
  if (lastTest?.status === "error") return "error";
  if (!lastTest || dirty) return "untested"; // configured but needs a manual test
  return "ready";
}

/** All nodes reachable downstream from `start` (excluding start). */
export function descendantsOf(start: string, edges: Edge[]): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of edges) if (e.source === id && !out.has(e.target)) { out.add(e.target); stack.push(e.target); }
  }
  return out;
}

// ---------- Duplicate & place ----------

/**
 * WHERE A COPY OF A STEP GOES.
 *
 * Duplicating used to wire nothing, so the copy had no incoming edge and the
 * layout — which reads a node with no parent as a root — drew it in its own
 * lane beside the flow. Duplicating the third Filter of a chain produced an
 * orphan next to the source.
 *
 * The step's shape decides the answer:
 *  - `app` (Get data) genuinely IS a new lane: it has no input to inherit, and
 *    a second source beside the first is what duplicating one asks for. The
 *    caller adds no edges at all, so this returns nothing to do.
 *  - `paths` takes its copy into its own FIRST branch. A Split's whole meaning
 *    is the branching, so a sibling Split beside it says nothing; one branch
 *    deeper it is a second question asked of the records that got through.
 *  - everything else lands immediately after the original, inheriting its
 *    place: original → copy → whatever the original fed. That holds inside a
 *    branch too, since a branch is an ordinary chain hanging off a handle.
 *
 * Returns the edge to RETIRE (the original's outgoing link, now re-homed under
 * the copy) and the edges to add. `targetHandle` rides through for the same
 * reason it does in `bridgeEdgesFor`: a link into a Calculate's B input has to
 * come back into B, not silently become the chain input.
 */
export function duplicateWiring(
  // `type` is optional on React Flow's node, so it arrives widened. A node
  // without one is neither a source nor a Split and takes the chain rule.
  original: { id: string; type?: string; config?: { paths?: Array<{ id: string }> } | null },
  newId: string,
  edges: Edge[],
): { remove: Edge[]; add: Edge[] } {
  if (original.type === "app") return { remove: [], add: [] };
  const handle = original.type === "paths" ? (original.config?.paths ?? [])[0]?.id : undefined;
  const outgoing =
    original.type === "paths"
      ? // Only when the hub actually has a branch to hand the copy to.
        (handle ? edges.find((e) => e.source === original.id && e.sourceHandle === handle) : undefined)
      : edges.find((e) => e.source === original.id && !e.sourceHandle && e.targetHandle == null);
  // A Split with no branches yet has no lane to nest into; hanging the copy off
  // a handle nothing else uses would strand it exactly as before.
  if (original.type === "paths" && !handle) return { remove: [], add: [] };
  const eid = () => `e_${Math.random().toString(36).slice(2, 9)}`;
  return {
    remove: outgoing ? [outgoing] : [],
    add: [
      { id: eid(), type: "insert", source: original.id, sourceHandle: handle, target: newId },
      ...(outgoing
        ? [{ id: eid(), type: "insert", source: newId, target: outgoing.target, targetHandle: outgoing.targetHandle ?? undefined }]
        : []),
    ],
  };
}

/**
 * WHERE A STEP GOES WHEN IT IS DRAGGED SOMEWHERE ELSE.
 *
 * Moving is detaching plus inserting, and both halves already exist: the step
 * leaves the way a deleted one does — its parent bridged to its children, so
 * the line it was in closes up — and it arrives the way a duplicate does,
 * between the drop target and whatever that target fed.
 *
 * `target` is a slot, never a coordinate. Positions on this canvas are
 * computed from the wiring, so a dropped step has no meaningful x/y of its
 * own; what a drag actually chooses is a PLACE IN THE ORDER.
 *  - `{ after: id }` puts it directly below that step, in that step's lane.
 *  - `{ after: id, handle }` puts it at the head of one of a Split's branches.
 *  - `{ root: true }` detaches it into a lane of its own — the "drop it beside
 *    the first step" case, which is how a second source, or a chain someone
 *    wants to rebuild from scratch, gets started.
 *
 * Returns null when there is no move to make — dropped on itself, or with no
 * slot named.
 *
 * NO CYCLE IS REACHABLE, and the reason is worth stating because the obvious
 * guard is wrong. Refusing a target inside the step's own subtree looks
 * prudent and forbids the commonest reorder there is: dragging a step to the
 * BOTTOM of the line it already sits in. The step is detached before it is
 * re-inserted — its children are bridged to its parent, so by the time the
 * slot is read it has no descendants at all, and inserting a parentless node
 * into a DAG cannot close a loop.
 */
export function moveWiring(
  nodeId: string,
  target: { after?: string; handle?: string; root?: boolean },
  edges: Edge[],
): { remove: Edge[]; add: Edge[] } | null {
  if (target.after === nodeId) return null;

  // Detach: everything touching the step, plus the bridge that closes the gap.
  const incident = edges.filter((e) => e.source === nodeId || e.target === nodeId);
  const bridges = bridgeEdgesFor(nodeId, edges);
  if (target.root) return { remove: incident, add: bridges };
  if (!target.after) return null;

  /**
   * INSERT INTO THE GRAPH AS IT WILL BE, NOT AS IT WAS.
   *
   * The slot has to be found AFTER the step has left, because the link it is
   * about to occupy may be the bridge its own departure created. Dragging a
   * step to sit directly under its own parent is the plain case: `a -> b -> c`
   * detaches to `a -> c`, and reading the original edges instead would find
   * nothing leaving `a`, drop the step on the end, and lose `c`.
   */
  const detached = [...edges.filter((e) => !incident.includes(e)), ...bridges];
  const outgoing = target.handle
    ? detached.find((e) => e.source === target.after && e.sourceHandle === target.handle)
    : detached.find((e) => e.source === target.after && !e.sourceHandle && e.targetHandle == null);
  const eid = () => `e_${Math.random().toString(36).slice(2, 9)}`;
  return {
    // A bridge is a new edge, so "not adding it" is how it is taken back out;
    // only an ORIGINAL edge can be removed.
    remove: [...incident, ...(outgoing && !bridges.includes(outgoing) ? [outgoing] : [])],
    add: [
      ...bridges.filter((b) => b !== outgoing),
      { id: eid(), type: "insert", source: target.after, sourceHandle: target.handle, target: nodeId },
      ...(outgoing
        ? [{ id: eid(), type: "insert", source: nodeId, target: outgoing.target, targetHandle: outgoing.targetHandle ?? undefined }]
        : []),
    ],
  };
}

// ---------- Delete & reconnect ----------

/**
 * The bridge edges that reconnect a node's predecessor to its successors when the
 * node is removed. A multi-input junction (Unite) bridges from its FIRST lane so
 * the line downstream survives; a node with no input or no output has nothing to
 * bridge and is simply deleted (empty).
 *
 * `preferredSource` names the lane that must survive when the first one is the
 * wrong answer: deleting a MATCHING Combine has to reconnect the kept lane —
 * bridging blind from lane one could hand every downstream step the check
 * list's records, silently, the moment the keep lane happened to be wired
 * second.
 */
export function bridgeEdgesFor(nodeId: string, edges: Edge[], preferredSource?: string | null): Edge[] {
  const incoming = edges.filter((e) => e.target === nodeId);
  const outgoing = edges.filter((e) => e.source === nodeId);
  if (incoming.length === 0 || outgoing.length === 0) return [];
  const i = (preferredSource ? incoming.find((e) => e.source === preferredSource) : undefined) ?? incoming[0];
  /**
   * ONE BRIDGE PER SURVIVING CONNECTION, not one per deleted node.
   *
   * Deleting a step in the middle of a line must leave the step above wired to
   * the step below — for every step below, and through whichever input it was
   * wired to. Requiring exactly one outgoing edge failed both halves: a step
   * feeding two next steps orphaned both, and a step feeding a Calculate's B
   * input orphaned it because that edge is a number reference rather than a
   * chain link, so it was not even counted.
   *
   * `targetHandle` is carried through, so a number that was wired into B comes
   * back into B rather than silently becoming the chain input.
   */
  return outgoing.map((o) => ({
    id: `e_${Math.random().toString(36).slice(2, 9)}`,
    type: "insert",
    source: i.source,
    sourceHandle: i.sourceHandle ?? undefined,
    target: o.target,
    targetHandle: o.targetHandle ?? undefined,
  }));
}

// ---------- Variable picker fields ----------

/** Canonical (system) fields, grouped under a collapsed "System fields" section. */
export const STD_META: Record<string, { label: string; type: string }> = {
  subject: { label: "Subject / person", type: "text" },
  source: { label: "Source app", type: "text" },
  eventType: { label: "Event type", type: "text" },
  value: { label: "Value / amount", type: "number" },
  currency: { label: "Currency", type: "text" },
  occurredAt: { label: "Occurred at", type: "date" },
  id: { label: "Record id", type: "text" },
};

/**
 * Resolve a field path against a loosely-typed sample record. Thin guard over
 * the engine's own `getField`, so path semantics can never drift between the
 * picker previews and what actually runs.
 */
export function resolveSampleField(rec: unknown, path: string): unknown {
  if (!rec || typeof rec !== "object") return undefined;
  return getField(rec as FlowRecord, path);
}

/**
 * Build the variable-picker groups for the selected node: the actual fields
 * returned by each upstream source come first (with sample values from the
 * chosen sample record), and the canonical/system fields go last in their own
 * collapsible group.
 */
export function buildFieldGroups(opts: {
  selectedId: string | null;
  nodes: FNode[];
  edges: Edge[];
  stepNoById: Map<string, number>;
  titleOf: (n: FNode) => string;
  sampleIndexOf?: (n: FNode) => number;
}): FieldGroup[] {
  const { selectedId, nodes, edges, stepNoById, titleOf, sampleIndexOf } = opts;
  const stdSet = new Set<string>(STANDARD_FIELDS);
  const groups: FieldGroup[] = [];

  if (selectedId) {
    // Every logically-upstream step is offered as its own group (Zapier's "Previous
    // Steps"), so the user can expand any earlier step — not just the immediate parent —
    // and pick a value from it. Branch scoping still holds: only ancestors of the
    // selected step appear, never sibling branches or future steps.
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
    }
    const byIdAll = new Map(nodes.map((n) => [n.id, n]));
    const ancestorIds = new Set<string>();
    const stack = [selectedId];
    while (stack.length) {
      const cur = stack.pop()!;
      // The reference lane of a matching Combine does not flow past it — its
      // records are only a check list. Offering its fields below the Combine
      // re-opens the mistaken-join trap: a pick that resolves on no record.
      // The Combine's OWN panel still sees both lanes (cur === selectedId),
      // which is where the two match fields are chosen.
      const keep = cur === selectedId ? null : matchKeepOf(byIdAll.get(cur));
      const sources = incoming.get(cur) ?? [];
      // Fail OPEN when the keep reference is stale (names a node that is no
      // longer a direct input): restricting to a lane that isn't wired in
      // would hide EVERY lane and empty every picker downstream. The stale
      // config is separately an error the validator and the engine both name
      // — the picker's job is to keep showing the data that exists.
      const keepValid = keep != null && sources.includes(keep);
      for (const s of sources) {
        if (keepValid && s !== keep) continue;
        if (!ancestorIds.has(s)) {
          ancestorIds.add(s);
          stack.push(s);
        }
      }
    }
    // In flow order (step 1, 2, 3…), matching how the steps read on the canvas.
    const ordered = [...ancestorIds].sort((a, b) => (stepNoById.get(a) ?? 0) - (stepNoById.get(b) ?? 0));
    for (const sid of ordered) {
      const sn = nodes.find((n) => n.id === sid);
      if (!sn) continue;
      // A stacking Unite is pure plumbing — it exposes no data of its own; its
      // lanes' steps are ancestors too and appear as their own groups, which is
      // what the user recognises ("1. Google Sheets", not "3. Unite data").
      // A MATCHING one makes a decision, and its decision is readable
      // downstream: Output (did this record survive the check) and Output
      // number (how many did) — the same two facts every Filter exposes.
      const matchingUnite = sn.type === "unite" && String((sn.data.config as { mode?: unknown }).mode ?? "stack") === "match";
      if (sn.type === "unite" && !matchingUnite) continue;
      // Untested steps expose nothing yet (explicit-test model).
      if (sn.data.lastTest?.status !== "ok") continue;
      const app = nearestAppAncestor(sn, nodes, edges);
      const appChosen = app ? chosenSample(app, sampleIndexOf) : undefined;
      const upChosen = chosenSample(sn, sampleIndexOf);

      // Filters/windows expose "Output" — whether the record continued past that step.
      // It is genuinely per-record: on a Paths flow a record that took branch B carries
      // no `__passed_<A>` stamp, so "passed step 3" distinguishes rows.
      const outBool: PickField = { path: `__passed_${sn.id}`, label: "Output", type: "boolean", example: true };
      // How many records this step produced. It is a property of the DATASET, so it
      // reads the same on every row — a per-record condition on it therefore passes
      // all rows or none, and summing it multiplies the count by itself. It is here
      // to be READ and referenced ("step 1 loaded 390"), and it goes last so it never
      // competes with the step's real columns.
      const outNum: PickField = { path: `__count_${sn.id}`, label: "Output number", type: "number", example: sn.data.lastTest.recordsOut };
      /**
       * A MATCHING Combine over ONE lane is not pass-through, and that is
       * the whole point.
       *
       * A Filter narrows a lane that keeps its own name; a matching Combine
       * produces a NEW, smaller population — "the 39 leads that are also in
       * the spreadsheet" — and downstream that population is the thing the
       * user reasons about. Listing only its Output made the picker offer the
       * Get data step instead, which reads as "all 324 leads" and left people
       * believing their metric was computed on records the step had already
       * dropped. (It wasn't: lane stamps travel, so picking the Get data step
       * resolves to the same survivors. The picker was telling the truth in a
       * way nobody could read.)
       *
       * THE ONE-LANE CONDITION IS LOAD-BEARING, not tidiness. Exposing
       * columns is what makes a step pickable as a Time between MOMENT, and a
       * moment names the lane a record came down. Every other pickable step
       * is single-lane by construction; a matching Combine whose kept side is
       * itself a stack is not, and `__count_<combine>` is stamped on all of
       * its records, so naming it on both sides of the clock reproduces
       * exactly the call→call measurement the unset-lane guard exists to
       * prevent — a plausible near-zero speed-to-lead that publishes clean.
       * One app in the kept lane means one record shape, and the question
       * cannot arise. A STACKING Combine is excluded for the same reason from
       * the other direction: its records genuinely have two shapes, and its
       * lanes are listed as their own steps.
       */
      const keptLaneApps = matchingUnite
        ? [...laneAncestorIds(matchKeepOf(sn) ?? sn.id, edges)].filter((id) => byIdAll.get(id)?.type === "app").length
        : 0;
      const isPassThrough = sn.type === "filter" || sn.type === "time" || (matchingUnite && keptLaneApps !== 1);
      /**
       * A step that computes a NUMBER has no per-record variables to offer,
       * and offering one anyway was a lie the picker told: a Calculate that
       * produced 38 advertised an "Output number" field whose sample read 1
       * and which resolved to nothing at all downstream, because no record
       * ever carries it. Its number is picked in the Compare slots, where it
       * is real. So a value step contributes no fields.
       */
      if (!producesDataset(String(sn.type))) continue;

      // Fields this source declares as plumbing — constant on every row, or an
      // exact restatement of another field. Hidden from the picker only; the data
      // and any stored reference to it are untouched.
      const hidden = new Set(catalogEntry(app ? String((app.data.config as { source?: unknown }).source ?? "") : "")?.hiddenFields ?? []);

      let fields: PickField[];
      if (isPassThrough) {
        // A filter/window introduces no columns of its own (they come from the source
        // step); it reads out purely as its result.
        fields = [outBool, outNum];
      } else {
        // W3b: examples come from the field's nearest App ancestor's *selected* preview
        // record, so changing the record updates values everywhere. Transform-added fields
        // (absent on the app record) fall back to the direct upstream's own sample.
        // Canonical fields (subject, occurredAt, …) live inside the step's own group —
        // with human labels — and only when they actually carry data (no "System" group).
        const custom: PickField[] = [];
        const std: PickField[] = [];
        for (const f of sn.data.lastTest.outputSchema ?? []) {
          if (hidden.has(f.path)) continue;
          let ex = appChosen !== undefined ? resolveSampleField(appChosen, f.path) : undefined;
          if (ex === undefined) ex = upChosen !== undefined ? resolveSampleField(upChosen, f.path) : f.example;
          if (stdSet.has(f.path)) {
            if (ex != null && ex !== "") std.push({ path: f.path, label: STD_META[f.path]?.label ?? f.label, type: STD_META[f.path]?.type ?? f.type, example: ex });
          } else {
            custom.push({ path: f.path, label: f.label, type: f.type, example: ex, container: f.container, populated: f.populated });
          }
        }
        // A matching Combine keeps "did this record survive the check" too —
        // it is a decision step as well as a population.
        fields = matchingUnite ? [...custom, ...std, outBool, outNum] : [...custom, ...std, outNum];
        /**
         * Time between offers THE MEASUREMENT, not the record it measured.
         *
         * Its output is the start record annotated, so its schema is that
         * whole record — a Close lead's name, email, ids and forty more —
         * and listing them here says "this step produced your email address",
         * which it did not. It produced a duration. The step whose group they
         * belong to (the Get data, or the matching Combine that narrowed it)
         * is an ancestor and lists them already, so nothing becomes
         * unreachable: a Filter below can still pick lead_id from there, and
         * the path resolves on exactly these records.
         */
        if (sn.type === "time_between") {
          fields = [...custom.filter((f) => f.path.startsWith("properties.time_between")), outNum];
        }
      }

      groups.push({
        from: titleOf(sn),
        nodeId: sid,
        stepNo: stepNoById.get(sid),
        appSource: app ? String((app.data.config as { source?: unknown }).source ?? "") : undefined,
        sampleRecord: isPassThrough ? undefined : appChosen ?? upChosen,
        fields,
      });
    }
  }

  return groups;
}

/** The selected preview record for a node (its `sampleIndex`, else the first sample). */
function chosenSample(node: FNode, sampleIndexOf?: (n: FNode) => number): unknown {
  const sample = (node.data.lastTest?.sample ?? []) as unknown[];
  const idx = sampleIndexOf ? sampleIndexOf(node) : 0;
  return sample[idx] ?? sample[0];
}

/**
 * Every node upstream of (and including) `startId` — one Cross-reference
 * lane's picker scope. The kept side must offer only kept-lane fields and the
 * list side only list-lane fields: offering the union re-opens the trap the
 * step exists to close, picking a field the chosen records never carry.
 */
export function laneAncestorIds(startId: string, edges: Edge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const s of incoming.get(cur) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(s);
    }
  }
  return seen;
}

/** The keep-lane source id of a matching Combine, else null. */
export function matchKeepOf(n: FNode | undefined): string | null {
  if (!n || n.type !== "unite") return null;
  const cfg = (n.data.config ?? {}) as { mode?: unknown; keepNodeId?: unknown };
  if (String(cfg.mode ?? "stack") !== "match") return null;
  const keep = typeof cfg.keepNodeId === "string" ? cfg.keepNodeId : "";
  return keep || null;
}

/** Walk upstream from a node to the nearest App source (itself if it is one). */
export function nearestAppAncestor(start: FNode, nodes: FNode[], edges: Edge[]): FNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const guard = new Set<string>();
  let cur: FNode | undefined = start;
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.type === "app") return cur;
    // Through a matching Combine, the app that matters is the KEPT lane's —
    // following the first edge blind could land on the check-list side, whose
    // records don't flow here, and stamp its badge and samples on everything.
    const ins = edges.filter((e) => e.target === cur!.id);
    const keep = matchKeepOf(cur);
    const up = (keep ? ins.find((e) => e.source === keep) : undefined) ?? ins[0];
    cur = up ? byId.get(up.source) : undefined;
  }
  return undefined;
}

// ---------- Input descriptors (Unite / Calculate panels) ----------

/** One connected input of the selected step — exactly what the panels read. */
export type InputDescriptor = {
  nodeId: string;
  targetHandle: string | null;
  title: string;
  /** The producing step's computed number (for the "= N" preview under a picked slot). */
  value?: unknown;
};

/** Describe each connected input of a node, in connection order. */
export function describeInputs(opts: { selectedId: string; nodes: FNode[]; edges: Edge[]; titleOf: (n: FNode) => string }): InputDescriptor[] {
  const { selectedId, nodes, edges, titleOf } = opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.target === selectedId)
    .map((e) => {
      const sn = byId.get(e.source);
      const tile = sn?.data.lastTest?.tile as { value?: unknown } | undefined;
      return {
        nodeId: e.source,
        targetHandle: e.targetHandle ?? null,
        title: sn ? titleOf(sn) : e.source,
        value: sn?.data.lastTest?.value ?? tile?.value,
      };
    });
}

/**
 * WHAT "100%" MEANS ON THIS CANVAS.
 *
 * 1:1 is not the resting size here. A step card is 300px wide holding a 44px
 * mark, a chip and two short lines; at 1.0 on a laptop it is a small object in
 * a large field, and a two-step flow reads as a diagram OF something rather
 * than the thing itself. 1.3 is where it sits right.
 *
 * So 1.3 is the unit, not a zoom level: a flow opens at it, "fit" returns to
 * it, and the readout calls it 100% — because to the person using it, that IS
 * normal size, and a badge reading 130% at rest invites them to "fix" it.
 * Everything else is a percentage OF this, so the bounds below read as the
 * 50%–200% anyone expects.
 *
 * The three uses — fitView's cap, React Flow's min/max, and the readout — must
 * all come from here or the number in the corner stops meaning anything.
 * Pinned by tests/zoom-scale.test.ts.
 */
export const BASE_ZOOM = 1.3;
export const MIN_ZOOM = BASE_ZOOM * 0.5;
export const MAX_ZOOM = BASE_ZOOM * 2;

/** Raw React Flow zoom -> the percentage the toolbar shows. */
export function zoomPercent(zoom: number): number {
  return Math.round((zoom / BASE_ZOOM) * 100);
}
