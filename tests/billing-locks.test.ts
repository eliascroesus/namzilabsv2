import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./helpers/testdb";
import { flowResults, flows } from "@/db/schema";
import type { DB } from "@/db/types";
import { grantPlan } from "@/lib/billing/state";
import { anyLocked, applyMetricLocks, lockRow, lockedMetricKeys, metricKey, metricLocksFor } from "@/lib/billing/locks";

/**
 * LOCKED MEANS THE NUMBERS NEVER LEAVE THE SERVER.
 *
 * A workspace over its plan's metrics keeps the first N it published; every
 * later one is locked. The owner's rule is that inspect mode must not be able
 * to reveal a locked number — so the lock is not a blur over real data, it is
 * the data being stripped before the row is handed to anything that renders,
 * computes a chart, fills the calendar or answers the AI assistant.
 */

const SENTINEL = 987654.321;
let db: DB;
let close: () => Promise<void>;
const ORG = "org_lock";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("BILLING_ENABLED", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

/** `n` published metrics, each first published one minute after the last. */
async function metrics(n: number, opts: { published?: boolean; start?: number } = {}) {
  const published = opts.published ?? true;
  const [f] = await db
    .insert(flows)
    .values({ orgId: ORG, name: `f${Math.random()}`, draftGraph: { nodes: [], edges: [], metrics: [] }, status: published ? "published" : "draft", publishedVersion: 1 })
    .returning({ id: flows.id });
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const createdAt = new Date(Date.UTC(2026, 8, 1, 0, (opts.start ?? 0) + i));
    await db.insert(flowResults).values({ orgId: ORG, flowId: f.id, version: 1, outputNodeId: `o${i}`, tile: { name: `m${i}`, value: i }, status: "fresh", createdAt });
    keys.push(metricKey(f.id, `o${i}`));
  }
  return keys;
}

describe("which metrics lock", () => {
  it("keeps the first N by when they were first published and locks the rest", async () => {
    const early = await metrics(3, { start: 0 });
    const late = await metrics(4, { start: 10 });
    const locked = await lockedMetricKeys(db, ORG, 5);
    expect([...locked].sort()).toEqual(late.slice(2).sort());
    for (const k of [...early, ...late.slice(0, 2)]) expect(locked.has(k)).toBe(false);
  });

  it("does not count or lock what the board never shows", async () => {
    await metrics(5, { start: 0 });
    await metrics(3, { published: false, start: 10 });
    expect((await lockedMetricKeys(db, ORG, 5)).size).toBe(0);
  });

  it("follows the workspace's plan — and locks nothing with billing off", async () => {
    await metrics(7);
    expect((await metricLocksFor(db, ORG)).size).toBe(2);
    await grantPlan(db, { orgId: ORG, plan: "growth", kind: "manual", endsAt: null, grantedBy: "s" });
    expect((await metricLocksFor(db, ORG)).size).toBe(0);
    vi.stubEnv("BILLING_ENABLED", "");
    expect((await metricLocksFor(db, "any")).size).toBe(0);
  });
});

describe("a locked row", () => {
  const row = {
    flowId: "f1",
    outputNodeId: "o1",
    tile: {
      name: "Cash collected",
      viz: "number",
      value: SENTINEL,
      byRange: { "30d": { value: SENTINEL, previous: SENTINEL } },
      byDay: { "2026-09-01": SENTINEL },
      sample: [{ amount: SENTINEL }],
      series: [SENTINEL],
      nextChangeAt: "2026-10-01T00:00:00Z",
    },
    status: "fresh",
    error: `the value was ${SENTINEL}`,
    computedAt: new Date("2026-09-30T12:00:00Z"),
    provenance: { streams: [{ rows: SENTINEL }] },
  };

  it("carries its name and chart kind and not one number it measured", () => {
    const locked = lockRow(row);
    expect(JSON.stringify(locked)).not.toContain("987654");
    expect(locked.tile).toEqual({ name: "Cash collected", viz: "number", locked: true });
    expect(locked).toMatchObject({ flowId: "f1", outputNodeId: "o1", locked: true, error: null, computedAt: null, provenance: null });
  });

  it("is applied only to the rows on the locked list", () => {
    const other = { ...row, outputNodeId: "o2" };
    const out = applyMetricLocks([row, other], new Set([metricKey("f1", "o2")]));
    expect(out[0].tile).toBe(row.tile);
    expect((out[1] as { locked?: boolean }).locked).toBe(true);
    expect(JSON.stringify(out[1])).not.toContain("987654");
  });

  it("locks a chart built from any locked metric", () => {
    const locked = new Set([metricKey("f1", "o2")]);
    expect(anyLocked([metricKey("f1", "o1"), metricKey("f1", "o2")], locked)).toBe(true);
    expect(anyLocked([metricKey("f1", "o1")], locked)).toBe(false);
  });
});

/**
 * EVERY READER OF STORED NUMBERS APPLIES THE LOCKS. The tile reads cannot lock
 * inside themselves — the board caches them by results version, and an upgrade
 * would not move that key — so each consumer applies them after reading. A new
 * consumer that forgets fails here.
 */
describe("every consumer of the tile reads applies the locks", () => {
  const READS = /\b(publishedFlowTiles|versionedFlowTiles|calendarFlowTiles)\(/;
  const EXEMPT = new Set(["src/lib/flow/materialize.ts", "src/lib/flow/tile-cache.ts"]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });

  it("the scan finds the consumers it must check", () => {
    const consumers = files("src").filter((f) => !EXEMPT.has(f) && READS.test(readFileSync(f, "utf8")));
    expect(consumers.length).toBeGreaterThanOrEqual(2);
  });

  it("and each one of them locks", () => {
    const missing = files("src")
      .filter((f) => !EXEMPT.has(f))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return READS.test(src) && !/\b(applyMetricLocks|metricLocksFor)\(/.test(src);
      });
    expect(missing, "these read stored tile numbers without applying the plan's metric locks").toEqual([]);
  });
});
