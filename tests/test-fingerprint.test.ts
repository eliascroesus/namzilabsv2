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

  it("still moves when a branch is added, removed or reordered", () => {
    const withPaths = (paths: Array<{ id: string; label: string }>) => [
      { id: "s", type: "paths", data: { config: { paths } } },
      { id: "f", type: "filter", data: { config: {} } },
    ];
    const edges = [{ source: "s", target: "f", sourceHandle: "p0" }];
    const two = testFingerprint(withPaths([{ id: "p0", label: "A" }, { id: "p1", label: "B" }]), edges, "f");
    expect(testFingerprint(withPaths([{ id: "p0", label: "A" }]), edges, "f")).not.toBe(two);
    expect(testFingerprint(withPaths([{ id: "p1", label: "B" }, { id: "p0", label: "A" }]), edges, "f")).not.toBe(two);
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
