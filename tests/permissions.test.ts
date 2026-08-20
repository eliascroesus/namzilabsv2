import { describe, it, expect } from "vitest";
import { resolveRank, type RankRow } from "@/lib/permissions";

/**
 * resolveRank is the pure brain of the rank system: the union over a rank's
 * inheritance closure, computed at READ time so parent edits are live. These
 * tests pin the closure walk itself — dedup across a diamond, termination on a
 * cycle, sticky "all" flags, and tolerance of deleted parents — because every
 * access check in the app rides on those properties.
 */

function rank(id: string, overrides: Partial<RankRow> = {}): RankRow {
  return {
    id,
    name: id,
    allPermissions: false,
    permissions: [],
    allMetrics: false,
    metricKeys: [],
    inherits: [],
    ...overrides,
  };
}

function rankMap(...rows: RankRow[]): Map<string, RankRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

describe("resolveRank", () => {
  it("grants a rank's own direct permissions and metric keys", () => {
    const ranks = rankMap(
      rank("a", { permissions: ["create_flows"], metricKeys: ["flow:f1", "metric:m1"] }),
    );
    const r = resolveRank(ranks, "a");
    expect(r.allPermissions).toBe(false);
    expect(r.allMetrics).toBe(false);
    expect([...r.permissions]).toEqual(["create_flows"]);
    expect([...r.metricKeys].sort()).toEqual(["flow:f1", "metric:m1"]);
  });

  it("unions a single inherited parent's grants with its own", () => {
    const ranks = rankMap(
      rank("child", { permissions: ["create_flows"], metricKeys: ["flow:f1"], inherits: ["parent"] }),
      rank("parent", { permissions: ["view_integrations"], metricKeys: ["metric:m1"] }),
    );
    const r = resolveRank(ranks, "child");
    expect([...r.permissions].sort()).toEqual(["create_flows", "view_integrations"]);
    expect([...r.metricKeys].sort()).toEqual(["flow:f1", "metric:m1"]);
  });

  it("diamond: A inherits B and C, both inherit D — D contributes exactly once", () => {
    const ranks = rankMap(
      rank("a", { inherits: ["b", "c"] }),
      rank("b", { permissions: ["create_flows"], inherits: ["d"] }),
      rank("c", { permissions: ["view_integrations"], inherits: ["d"] }),
      rank("d", { permissions: ["connect_integrations"], metricKeys: ["flow:f1"] }),
    );
    const r = resolveRank(ranks, "a");
    // Sets make double-counting invisible in the output, so assert the sizes
    // too: the closure visited d once and the union carries each grant once.
    expect([...r.permissions].sort()).toEqual([
      "connect_integrations",
      "create_flows",
      "view_integrations",
    ]);
    expect(r.permissions.size).toBe(3);
    expect([...r.metricKeys]).toEqual(["flow:f1"]);
  });

  it("cycle: A↔B terminates and yields the union of both", () => {
    const ranks = rankMap(
      rank("a", { permissions: ["create_flows"], inherits: ["b"] }),
      rank("b", { metricKeys: ["metric:m1"], inherits: ["a"] }),
    );
    const r = resolveRank(ranks, "a");
    expect([...r.permissions]).toEqual(["create_flows"]);
    expect([...r.metricKeys]).toEqual(["metric:m1"]);
  });

  it("allPermissions is sticky through inheritance", () => {
    const ranks = rankMap(
      rank("child", { inherits: ["parent"] }),
      rank("parent", { allPermissions: true }),
    );
    const r = resolveRank(ranks, "child");
    expect(r.allPermissions).toBe(true);
    expect(r.allMetrics).toBe(false);
  });

  it("allMetrics is sticky through inheritance", () => {
    const ranks = rankMap(
      rank("child", { inherits: ["parent"] }),
      rank("parent", { allMetrics: true }),
    );
    const r = resolveRank(ranks, "child");
    expect(r.allMetrics).toBe(true);
    expect(r.allPermissions).toBe(false);
  });

  it("skips an unknown inherited id silently — a deleted parent must not break its children", () => {
    const ranks = rankMap(
      rank("child", { permissions: ["create_flows"], inherits: ["gone", "parent"] }),
      rank("parent", { metricKeys: ["flow:f1"] }),
    );
    const r = resolveRank(ranks, "child");
    expect([...r.permissions]).toEqual(["create_flows"]);
    expect([...r.metricKeys]).toEqual(["flow:f1"]);
  });

  it("an empty rank grants nothing", () => {
    const r = resolveRank(rankMap(rank("empty")), "empty");
    expect(r.allPermissions).toBe(false);
    expect(r.allMetrics).toBe(false);
    expect(r.permissions.size).toBe(0);
    expect(r.metricKeys.size).toBe(0);
  });
});
