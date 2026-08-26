import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT.
 *
 * `usage_ledger` shipped writing a row per connection per operation per minute
 * — 150-600 rows per connection per day — with no retention path at all, and
 * nothing anywhere noticed, because the retention policy was a list of tables
 * somebody remembered to add to rather than a question asked of every table.
 * The suite stayed green the whole time: every test of `pruneOperationalTables`
 * asserted that the tables it knew about were pruned correctly.
 *
 * So this asks the question the other direction. Every table in the schema must
 * be classified, and the classification must be one of three honest answers:
 * it is pruned, it is bounded by something other than activity, or it is a
 * KNOWN GAP that someone has written down. A new table is a test failure until
 * a human says which.
 *
 * The point of the third category is that it is not a way to pass. It is the
 * list of tables that will eventually need this, visible in a file people read
 * rather than in someone's memory.
 */

const schema = readFileSync(join(process.cwd(), "src/db/schema.ts"), "utf8");
const lifecycle = readFileSync(join(process.cwd(), "src/lib/storage-lifecycle.ts"), "utf8");

/** Every `pgTable("name"` in the schema, which is the authoritative list. */
function declaredTables(): string[] {
  return [...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
}

type Classification =
  /** Has an age-based retention path in storage-lifecycle.ts. */
  | { kind: "pruned"; window: string }
  /**
   * Grows with customers, configuration or deliberate human action — not with
   * sweeps, calls or deliveries. A thousand customers is a thousand rows, not a
   * million, so retention would be solving a problem that does not exist.
   */
  | { kind: "bounded"; by: string }
  /**
   * Grows with ACTIVITY and has no age-based path. Deleted only when its
   * connection is deleted. This is a real gap and saying so is the point.
   */
  | { kind: "gap"; why: string };

const TABLES: Record<string, Classification> = {
  // ── Pruned ────────────────────────────────────────────────────────────────
  delivery_log: { kind: "pruned", window: "30d" },
  test_runs: { kind: "pruned", window: "30d, plus a 24h sweep of settled runs" },
  usage_ledger: { kind: "pruned", window: "2d spent counters / 90d evidence" },

  // ── Bounded by something other than activity ──────────────────────────────
  // (organizations/users/memberships are ABSENT on purpose: identity lives in
  // WorkOS and the unread local mirrors were dropped by migration 0022.)
  connections: { kind: "bounded", by: "one row per connected account; disabled rows are kept on purpose" },
  source_streams: { kind: "bounded", by: "one row per configured stream" },
  sync_state: { kind: "bounded", by: "one row per connection" },
  stream_fields: {
    kind: "bounded",
    by: "one row per (connection, stream, field path), UPSERTED rather than appended — it tracks schema width, which does not grow with time",
  },
  metrics: { kind: "bounded", by: "one row per metric a human defined" },
  flows: { kind: "bounded", by: "one row per flow a human created" },
  flow_results: {
    kind: "bounded",
    by: "one row per (flow, version, output node); materialize deletes and rewrites rather than appending",
  },
  flow_versions: {
    kind: "bounded",
    by: "one row per PUBLISH — a deliberate human action, not a sweep. Grows slowly and forever; revisit if publish ever becomes automated",
  },
  backfill_jobs: {
    kind: "bounded",
    by: "one row per historical import, so it grows with imports rather than with polling. Revisit if re-imports become routine",
  },
  workspace_ranks: { kind: "bounded", by: "one row per rank an admin defined" },
  rank_assignments: {
    kind: "bounded",
    by: "at most one row per (org, member) — the composite PK enforces it; assignment is an upsert, never an append",
  },
  workspace_owners: { kind: "bounded", by: "exactly one row per org — the org id IS the primary key" },
  dashboard_views: {
    kind: "bounded",
    by: "one row per view a human added above their board — the default view has no row at all, so this counts only the extra tabs",
  },
  dashboard_groups: { kind: "bounded", by: "one row per column a human created, per view" },
  dashboard_tile_placements: {
    kind: "bounded",
    by: "at most one row per (org, tile) — the composite PK enforces it, and a drag is an upsert rather than an append. Placements outlive their tile ON PURPOSE (a republished flow gets its column back), so the ceiling is every tile the workspace has ever published rather than the tiles it has now; deleting the flow or metric clears them, and the write action caps the set",
  },

  // ── Known gaps ────────────────────────────────────────────────────────────
  raw_events: {
    kind: "gap",
    why: "one row per inbound webhook delivery, and the replay source of truth. PARTIALLY pruned: storage-lifecycle removes raws only for connections DISABLED 30+ days (disabled_at is the clock, never age alone). ACTIVE connections' raws remain unbounded ON PURPOSE — the pending WEBHOOK_EVENT_TIME_LIVE restamp and reprocessConnection both re-derive from these payloads, so a window here IS the reach of both. Closeable only after the event-time flip has run; the long-term shape is archive-to-object-storage, not delete",
  },
  events: {
    kind: "gap",
    why: "customer data. LIVE rows are never pruned (the gap, stated). TOMBSTONES older than 30d on non-disabled connections ARE now hard-deleted nightly (storage-lifecycle eventTombstones tier) — 30d because upsertEvents un-deletes on reappearance and Calendly's is the widest retire window that can legitimately resurrect a row; disabled connections' tombstones are the reconnect-restore set and are kept. Same partially-pruned-gap classification as raw_events.",
  },
  dead_letter: {
    kind: "gap",
    why: "one row per payload that failed processing, and RESOLVED rows are never removed — only connection deletion clears them. Smaller than the others because it only grows on failure, but it is unbounded in exactly the same way and nothing currently touches it",
  },
};

/** Kept as a set so adding a gap is a deliberate edit to this file, not a silent pass. */
const KNOWN_GAPS = ["dead_letter", "events", "raw_events"];

describe("every table is asked whether it needs retention", () => {
  it("classifies every table in the schema", () => {
    const declared = declaredTables();
    const classified = Object.keys(TABLES).sort();

    const unclassified = declared.filter((t) => !(t in TABLES));
    expect(
      unclassified,
      `New table(s) with no retention decision: ${unclassified.join(", ")}. Add each to TABLES in ` +
        `this file as "pruned", "bounded" or "gap". This is the check usage_ledger needed and did not have: ` +
        `it shipped writing a row per connection per operation per minute, with no retention path, and ` +
        `nothing failed.`,
    ).toEqual([]);

    const stale = classified.filter((t) => !declared.includes(t));
    expect(stale, `Classified but no longer in the schema: ${stale.join(", ")}`).toEqual([]);
  });

  it("every table claimed as pruned actually has a path in storage-lifecycle.ts", () => {
    // Checked against the IMPORT rather than the file text, because a table
    // name appears in a comment for free and the claim has to be backed by code
    // that touches the table. Otherwise the list becomes a place to assert
    // coverage that does not exist — which is the failure it was written for.
    const imported = lifecycle.match(/import \{([^}]+)\} from "@\/db\/schema"/)?.[1] ?? "";
    const symbols = imported.split(",").map((s) => s.trim());
    const camel = (t: string) => t.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    for (const [table, c] of Object.entries(TABLES)) {
      if (c.kind !== "pruned") continue;
      expect(
        symbols,
        `${table} is classified "pruned" (${c.window}) but src/lib/storage-lifecycle.ts does not import it, ` +
          `so nothing there can be deleting from it.`,
      ).toContain(camel(table));
    }
  });

  it("the known gaps are exactly the ones written down", () => {
    const gaps = Object.entries(TABLES)
      .filter(([, c]) => c.kind === "gap")
      .map(([t]) => t)
      .sort();
    expect(
      gaps,
      "A table moved into or out of the known-gap list. That is a real change in what this system " +
        "promises about disk growth — update KNOWN_GAPS deliberately.",
    ).toEqual(KNOWN_GAPS);
  });

  it("every exemption states a reason, so the list cannot become a rubber stamp", () => {
    // Only the exemptions need prose. A pruned table's "reason" is its window,
    // which is a value ("30d") and is verified against the code above; an
    // exemption is a judgement call and has to justify itself in words.
    for (const [table, c] of Object.entries(TABLES)) {
      if (c.kind === "pruned") {
        expect(c.window, `${table} is classified "pruned" with no window`).toMatch(/\d/);
        continue;
      }
      const reason = c.kind === "bounded" ? c.by : c.why;
      const words = reason.trim().split(/\s+/);
      const message =
        `${table} is exempt from retention with no real reason given. Say what bounds it ` +
        `("one row per tenant"), or classify it as a gap. A placeholder is how usage_ledger would have ` +
        `passed this test without being fixed.`;
      expect(words.length, message).toBeGreaterThanOrEqual(3);
      expect(reason, message).not.toMatch(/^(tbd|todo|n\/?a|none|unknown|\?+)\b/i);
    }
  });
});

/**
 * The budget that keeps the sweep inside its container, pinned the same way
 * `tests/timeout-budgets.test.ts` pins the provider budget: the relationship
 * between the numbers is the invariant, not any one value.
 */
describe("the prune budget stays inside the route that runs it", () => {
  const declaredMaxDuration = (p: string) =>
    Number(readFileSync(join(process.cwd(), p), "utf8").match(/^export const maxDuration = (\d+);/m)?.[1]);

  it("leaves room for a worst-case overshoot inside maxDuration", () => {
    const budget = Number(lifecycle.match(/const PRUNE_BUDGET_MS = ([\d_]+);/)?.[1].replace(/_/g, ""));
    const route = declaredMaxDuration("src/app/api/inngest/route.ts") * 1000;

    expect(budget).toBeGreaterThan(0);
    expect(route).toBeGreaterThan(0);
    // The deadline is checked BETWEEN passes, so a run can overshoot by up to
    // one pass. Half the route budget leaves room for that overshoot and still
    // lands well inside the ceiling — the same ratio PROVIDER_CALL_BUDGET_MS
    // holds against the same 60s.
    expect(
      budget,
      `PRUNE_BUDGET_MS (${budget}ms) must stay at or under half of the ${route}ms the Inngest route allows, ` +
        `because the sweep can overshoot its deadline by one pass and a step killed mid-flight cannot tell ` +
        `the next run whether it finished.`,
    ).toBeLessThanOrEqual(route / 2);
  });
});
