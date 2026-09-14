import { describe, expect, it } from "vitest";
import { testFingerprint } from "@/lib/flow/test-fingerprint";

/**
 * THE FINGERPRINT IS ONLY USEFUL IF IT IS QUIET.
 *
 * It decides whether a canvas card calls its own number superseded, and it is
 * computed on the server when the Test runs and again in the browser on every
 * render. If those two disagree for any reason that is not a real edit — a key
 * order Postgres chose, a sample record the user clicked, a step somewhere else
 * in the flow — then every card in the product reads "re-test to update", the
 * note means nothing within a day, and the stale number it was meant to catch
 * goes back to looking live.
 *
 * So the quiet cases are tested first and there are more of them, deliberately.
 */

type Cfg = Record<string, unknown>;

const graph = (cfg: Cfg, upstream: Cfg = { source: "gsheets", sheet: "Leads" }) => ({
  nodes: [
    { id: "a", type: "app", data: { config: upstream } },
    { id: "f", type: "filter", data: { config: cfg } },
    { id: "z", type: "filter", data: { config: { note: "a step in another lane" } } },
  ],
  edges: [{ source: "a", target: "f" }],
});

const RULES = { combinator: "and", rules: [{ field: "Booked", op: "equals", value: "Yes" }] };
const fp = (g: ReturnType<typeof graph>) => testFingerprint(g.nodes, g.edges, "f");
const baseline = () => fp(graph(RULES));

describe("testFingerprint — what must NOT move it", () => {
  it("survives a jsonb round trip that reorders keys", () => {
    expect(fp(graph({ rules: RULES.rules, combinator: "and" }))).toBe(baseline());
  });

  it("ignores display-only config keys (picking another sample record)", () => {
    expect(fp(graph({ ...RULES, sampleIndex: 3 }))).toBe(baseline());
  });

  it("reads a cleared key the same as a key never written", () => {
    // The panel sets `undefined`; JSON.stringify and jsonb both drop it, so
    // the two shapes are the same config and must hash the same.
    expect(fp(graph({ ...RULES, groupBy: undefined }))).toBe(baseline());
  });

  it("ignores steps outside this one's lane", () => {
    const g = graph(RULES);
    g.nodes[2].data.config = { note: "edited, and nothing to do with the filter" };
    expect(fp(g)).toBe(baseline());
  });

  it("ignores the order of the node array", () => {
    const g = graph(RULES);
    g.nodes.reverse();
    expect(fp(g)).toBe(baseline());
  });

  /**
   * Renaming a branch is renaming a card. The engine routes on `paths[].id` and
   * `paths[].mode`; the label is words on a box. It used to move the hash —
   * which meant renaming one branch marked every step below it "re-test to
   * update" while every number stayed exactly what it was.
   */
  it("ignores a Split's branch names, which route nothing", () => {
    const hub = (labels: string[]) => ({
      id: "s",
      type: "paths",
      data: { config: { paths: labels.map((label, i) => ({ id: `p${i}`, label, mode: "custom" })), fallbackId: "fb", fallbackLabel: labels[0] } },
    });
    const nodes = (labels: string[]) => [hub(labels), { id: "f", type: "filter", data: { config: {} } }];
    const edges = [{ source: "s", target: "f", sourceHandle: "p0" }];
    const named = testFingerprint(nodes(["Booked calls", "No-shows"]), edges, "f");
    expect(testFingerprint(nodes(["Path A", "Path B"]), edges, "f")).toBe(named);
  });

  it("still moves when the branch a step is IN changes", () => {
    const withPaths = (paths: Array<{ id: string; label: string; mode?: string }>) => [
      { id: "s", type: "paths", data: { config: { paths } } },
      { id: "f", type: "filter", data: { config: {} } },
    ];
    const edges = [{ source: "s", target: "f", sourceHandle: "p0" }];
    const base = testFingerprint(withPaths([{ id: "p0", label: "A" }, { id: "p1", label: "B" }]), edges, "f");
    // Its own lane's mode is an execution input — `execPaths` routes on it.
    expect(testFingerprint(withPaths([{ id: "p0", label: "A", mode: "always" }, { id: "p1", label: "B" }]), edges, "f")).not.toBe(base);
  });
});

describe("testFingerprint — what MUST move it", () => {
  it("moves when the step's own config changes", () => {
    expect(fp(graph({ ...RULES, rules: [{ field: "Booked", op: "equals", value: "No" }] }))).not.toBe(baseline());
  });

  it("moves when an ANCESTOR changes — the number came from up there too", () => {
    expect(fp(graph(RULES, { source: "gsheets", sheet: "Archive" }))).not.toBe(baseline());
  });

  it("moves when the wiring changes", () => {
    const g = graph(RULES);
    g.edges = [];
    expect(fp(g)).not.toBe(baseline());
  });
});

/**
 * A SPLIT'S BRANCHES ARE FINGERPRINTED ONE LANE AT A TIME.
 *
 * `execPaths` (src/lib/flow/engine.ts) hands every lane its records without
 * consulting the others — "always" takes everything, "custom" takes everything
 * and lets that branch's own first Filter narrow it downstream. Only "fallback"
 * reads its siblings, being defined as what no custom lane claimed:
 * `records.filter(r => !matchedAny(r))`.
 *
 * The hub used to contribute its whole config to every step beneath it, which
 * was wrong in both directions at once — see `splitContribution` for the full
 * account. These are the cases that were wrong.
 */
describe("testFingerprint — a Split's lanes, one at a time", () => {
  const hub = (lanes: Array<{ id: string; mode?: string }>) => ({
    id: "s",
    type: "paths",
    data: { config: { paths: lanes.map((l) => ({ id: l.id, label: l.id, mode: l.mode ?? "custom" })) } },
  });
  const graphOf = (lanes: Array<{ id: string; mode?: string }>, rules: Record<string, unknown[]> = {}) => ({
    nodes: [
      { id: "src", type: "app", data: { config: {} } },
      hub(lanes),
      ...lanes.flatMap((l) => [
        { id: `f_${l.id}`, type: "filter", data: { config: { rules: rules[l.id] ?? [] } } },
        { id: `n_${l.id}`, type: "formula", data: { config: { op: "count" } } },
      ]),
    ],
    edges: [
      { source: "src", target: "s", sourceHandle: "" },
      ...lanes.flatMap((l) => [
        { source: "s", target: `f_${l.id}`, sourceHandle: l.id },
        { source: `f_${l.id}`, target: `n_${l.id}` },
      ]),
    ],
  });
  const fp = (g: ReturnType<typeof graphOf>, n: string) => testFingerprint(g.nodes, g.edges, n);
  const RULE = (v: string) => [{ field: "x", op: "equals", value: v }];

  const three = [{ id: "a" }, { id: "b" }, { id: "c", mode: "always" }];
  const four = [...three, { id: "d" }];

  it("leaves the other branches alone when a branch is added", () => {
    // The reported annoyance: three tested branches asked to re-test because a
    // fourth was added beside them. A custom or always lane cannot see it.
    for (const lane of ["a", "b", "c"]) {
      expect([lane, fp(graphOf(four), `n_${lane}`)]).toEqual([lane, fp(graphOf(three), `n_${lane}`)]);
    }
  });

  it("supersedes an 'everything else' branch when a branch is added, because that one CAN see it", () => {
    const before = [{ id: "a" }, { id: "b" }, { id: "fb", mode: "fallback" }];
    const after = [{ id: "a" }, { id: "b" }, { id: "d" }, { id: "fb", mode: "fallback" }];
    expect(fp(graphOf(after), "n_fb")).not.toBe(fp(graphOf(before), "n_fb"));
    expect(fp(graphOf(after), "n_a")).toBe(fp(graphOf(before), "n_a"));
  });

  /**
   * The half that was silently WRONG rather than merely noisy. Those conditions
   * live in branch A's own Filter — a sibling of the fallback branch, outside
   * the ancestor slice this function walks — so the fallback kept reporting a
   * count measured against the old rules, wearing a green "Tested".
   */
  it("supersedes the fallback when a SIBLING's conditions change", () => {
    const lanes = [{ id: "a" }, { id: "fb", mode: "fallback" }];
    expect(fp(graphOf(lanes, { a: RULE("2") }), "n_fb")).not.toBe(fp(graphOf(lanes, { a: RULE("1") }), "n_fb"));
  });

  it("supersedes the fallback when a sibling's head stops being a Filter at all", () => {
    // `condsOf` returns null unless the head is a Filter, so that lane claims
    // nothing and the fallback GROWS — a change with no config edit in it.
    const lanes = [{ id: "a" }, { id: "fb", mode: "fallback" }];
    const withFilter = graphOf(lanes, { a: RULE("1") });
    const swapped = { ...withFilter, nodes: withFilter.nodes.map((n) => (n.id === "f_a" ? { ...n, type: "group" } : n)) };
    expect(fp(swapped, "n_fb")).not.toBe(fp(withFilter, "n_fb"));
  });

  it("leaves a sibling custom branch alone when another branch's conditions change", () => {
    const lanes = [{ id: "a" }, { id: "b" }];
    expect(fp(graphOf(lanes, { a: RULE("2") }), "n_b")).toBe(fp(graphOf(lanes, { a: RULE("1") }), "n_b"));
    expect(fp(graphOf(lanes, { a: RULE("2") }), "n_a")).not.toBe(fp(graphOf(lanes, { a: RULE("1") }), "n_a"));
  });

  it("supersedes the fallback when a sibling's MODE changes, which changes who claims what", () => {
    const before = [{ id: "a" }, { id: "fb", mode: "fallback" }];
    const after = [{ id: "a", mode: "always" }, { id: "fb", mode: "fallback" }];
    expect(fp(graphOf(after), "n_fb")).not.toBe(fp(graphOf(before), "n_fb"));
  });

  it("ignores the order branches are listed in — that is where they are drawn", () => {
    // `customPaths.some(...)` is order-blind and `outputs` is keyed by path id.
    const forward = [{ id: "a" }, { id: "b" }, { id: "fb", mode: "fallback" }];
    const reversed = [{ id: "b" }, { id: "a" }, { id: "fb", mode: "fallback" }];
    for (const lane of ["a", "b", "fb"]) {
      expect([lane, fp(graphOf(reversed), `n_${lane}`)]).toEqual([lane, fp(graphOf(forward), `n_${lane}`)]);
    }
  });

  it("hashes a legacy hub whole when its handle names no lane it lists", () => {
    // A stale edge from an undo says nothing about which lanes matter, so the
    // safe direction is the old one: hash everything.
    const g = graphOf([{ id: "a" }]);
    const stale = { ...g, edges: g.edges.map((e) => (e.sourceHandle === "a" ? { ...e, sourceHandle: "gone" } : e)) };
    const moved = {
      ...stale,
      nodes: stale.nodes.map((n) => (n.id === "s" ? hub([{ id: "a" }, { id: "z" }]) : n)),
    };
    expect(fp(moved, "n_a")).not.toBe(fp(stale, "n_a"));
  });
});
