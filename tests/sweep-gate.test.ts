import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { createTestDb } from "./helpers/testdb";
import { backfillJobs, connections, flowResults, flows } from "@/db/schema";
import type { DB } from "@/db/types";
import { dueConnectionsForSweep } from "@/ingestion/reconcile";
import { runnableJobsByProvider } from "@/lib/backfill/jobs";
import { expireAgedResults } from "@/lib/flow/materialize";
import { nextWakeMs } from "@/lib/sweep/next-wake";
import { DUE_MARGIN_MS, GATE_SETTLE, sweepGateOpen, sweepVerdict, type GateReads, type SweepVerdict } from "@/lib/sweep/gate";
import { wakeSweeper } from "@/lib/sweep/wake";

/**
 * THE SWEEP GATE — the two ten-minute crons skip Neon while nothing is due.
 *
 * Four things have to be true for that to cost no accuracy, and each has a
 * block below:
 *
 *   1. The gate's "next wake" agrees with the crons' OWN queries: it is in the
 *      past exactly when one of them would find work (parity, on real SQL).
 *   2. The verdict logic fails open and never trusts an answer computed under
 *      a stamp this same request minted.
 *   3. That stamp rule actually closes the race Next's deferred cache writes
 *      open — shown on a model of the cache, next to the naive design that
 *      loses the write.
 *   4. Every write that can move work earlier wakes the gate — enforced over
 *      the whole source tree, so a new writer cannot forget.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

describe("the next wake agrees with the crons' own queries", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await db.delete(flowResults);
    await db.delete(flows);
    await db.delete(backfillJobs);
    await db.delete(connections);
  });

  /** A connection that is NOT due for a day unless told otherwise. */
  async function conn(o: { status?: string; nextSweepAt?: Date | null; pausedUntil?: Date | null } = {}) {
    const [row] = await db
      .insert(connections)
      .values({
        orgId: "org_gate",
        source: "webhook",
        name: "c",
        status: o.status ?? "active",
        authType: "secret",
        nextSweepAt: o.nextSweepAt === undefined ? at(24 * HOUR) : o.nextSweepAt,
        pausedUntil: o.pausedUntil ?? null,
      })
      .returning({ id: connections.id });
    return row.id;
  }

  async function job(connectionId: string, status = "queued") {
    await db.insert(backfillJobs).values({
      orgId: "org_gate",
      connectionId,
      streamId: randomUUID(),
      streamHash: "h",
      targetFloor: new Date("2026-01-01T00:00:00Z"),
      rowCeiling: 1000,
      status,
    });
  }

  async function result(o: { status: string; computedAt?: Date | null; createdAt?: Date; nextChangeAt?: string }) {
    const [flow] = await db
      .insert(flows)
      .values({ orgId: "org_gate", name: randomUUID(), draftGraph: { nodes: [], edges: [], metrics: [] }, status: "published", publishedVersion: 1 })
      .returning({ id: flows.id });
    await db.insert(flowResults).values({
      orgId: "org_gate",
      flowId: flow.id,
      version: 1,
      outputNodeId: "o1",
      tile: o.nextChangeAt === undefined ? { value: 1 } : { value: 1, nextChangeAt: o.nextChangeAt },
      status: o.status,
      computedAt: o.computedAt === undefined ? new Date() : o.computedAt,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    });
  }

  /** What the two crons would find right now, through their real queries. */
  async function cronsWouldWork(): Promise<boolean> {
    const due = await dueConnectionsForSweep(db);
    const jobs = await runnableJobsByProvider(db, 1000);
    const hasStale = (await db.select({ s: flowResults.status }).from(flowResults)).some((r) => r.s === "stale");
    // Last, because it writes: every row it expires is work the cron does.
    const expired = await expireAgedResults(db);
    return due.length > 0 || jobs.length > 0 || hasStale || expired > 0;
  }

  type Expect = "now" | "never" | number;
  const scenarios: Array<[string, () => Promise<void>, Expect]> = [
    ["nothing at all", async () => {}, "never"],
    ["an active connection due in an hour", async () => void (await conn({ nextSweepAt: at(HOUR) })), HOUR],
    ["an overdue active connection", async () => void (await conn({ nextSweepAt: at(-MIN) })), "now"],
    ["a never-swept active connection", async () => void (await conn({ nextSweepAt: null })), "now"],
    ["an overdue connection still paused for 30 minutes", async () => void (await conn({ nextSweepAt: at(-MIN), pausedUntil: at(30 * MIN) })), 30 * MIN],
    ["an overdue connection whose pause has lapsed", async () => void (await conn({ nextSweepAt: at(-MIN), pausedUntil: at(-MIN) })), "now"],
    ["an overdue connection in error", async () => void (await conn({ status: "error", nextSweepAt: at(-MIN) })), "never"],
    ["an overdue disabled connection", async () => void (await conn({ status: "disabled", nextSweepAt: at(-MIN) })), "never"],
    ["a queued import on a connection not itself due", async () => job(await conn()), "now"],
    ["a running import on a connection paused for 20 minutes", async () => job(await conn({ pausedUntil: at(20 * MIN) }), "running"), 20 * MIN],
    ["a queued import on a disabled connection", async () => job(await conn({ status: "disabled" })), "never"],
    ["a queued import on a connection in error", async () => job(await conn({ status: "error" })), "now"],
    // Only its connection's own sweep, a day out, is left to wake for.
    ["a finished import", async () => job(await conn(), "complete"), 24 * HOUR],
    ["a stale result", async () => result({ status: "stale" }), "now"],
    ["a fresh result whose next change is in 15 minutes", async () => result({ status: "fresh", nextChangeAt: at(15 * MIN).toISOString() }), 15 * MIN],
    ["a fresh result computed five hours ago", async () => result({ status: "fresh", computedAt: at(-5 * HOUR) }), HOUR],
    ["a fresh result whose next change has passed", async () => result({ status: "fresh", nextChangeAt: at(-MIN).toISOString() }), "now"],
    ["a fresh result computed seven hours ago", async () => result({ status: "fresh", computedAt: at(-7 * HOUR) }), "now"],
    [
      "a fresh result with an extended-year next change (the cast must not throw)",
      async () => result({ status: "fresh", computedAt: at(-HOUR), nextChangeAt: "+010000-01-01T00:00:00.000Z" }),
      5 * HOUR,
    ],
    ["an error result whose last good value is seven hours old", async () => result({ status: "error", computedAt: at(-7 * HOUR) }), "now"],
    ["an error result whose last good value is two hours old", async () => result({ status: "error", computedAt: at(-2 * HOUR) }), 4 * HOUR],
    ["an error result that never computed, created seven hours ago", async () => result({ status: "error", computedAt: null, createdAt: at(-7 * HOUR) }), "now"],
    ["a fresh result with no clock at all", async () => result({ status: "fresh", computedAt: null }), "never"],
    [
      "the earliest of several",
      async () => {
        await conn({ nextSweepAt: at(2 * HOUR) });
        await result({ status: "fresh", nextChangeAt: at(30 * MIN).toISOString() });
        await job(await conn({ pausedUntil: at(HOUR) }));
      },
      30 * MIN,
    ],
  ];

  it.each(scenarios)("%s", async (_name, seed, expected) => {
    await seed();
    // THE TICK'S CLOCK IS READ FIRST, as `sweepVerdict` reads it in production
    // — before the query — so the database's own now() is always a little
    // LATER. Reading it after the query is how this test once passed while a
    // fresh read of overdue work answered "idle" on every real tick.
    const now = Date.now();
    const wake = await nextWakeMs(db);
    if (expected === "never") expect(wake).toBeNull();
    // Already due is 0 — "due" on any clock — never the database's own now(),
    // which runs a little ahead of the tick's and once read as "not yet".
    else if (expected === "now") expect(wake).toBe(0);
    else expect(Math.abs((wake as number) - (now + expected))).toBeLessThan(5_000);

    // THE PROPERTY THAT MATTERS, asked the way the crons ask it — through the
    // verdict, on the minted path and the settled path alike: "due" exactly
    // when a cron's own queries would find work. "Idle" while work exists is
    // the one unsafe answer.
    const real = (minted: boolean): GateReads => ({
      stamp: async () => ({ stamp: "s", minted }),
      nextWake: () => nextWakeMs(db),
      nextWakeNow: () => nextWakeMs(db),
    });
    const settled = await sweepVerdict(real(false), now);
    const minted = await sweepVerdict(real(true), now);
    const work = await cronsWouldWork();
    expect(settled === "due").toBe(work);
    expect(minted === "due").toBe(work);
    if (!work) expect(minted).toBe("settling");
  });
});

describe("the verdict", () => {
  const cachedReads: string[] = [];
  const reads = (o: { minted?: boolean; next?: number | null; throws?: "stamp" | "next" }): GateReads => ({
    async stamp() {
      if (o.throws === "stamp") throw new Error("cache down");
      return { stamp: "s1", minted: o.minted ?? false };
    },
    async nextWake(stamp) {
      cachedReads.push(stamp);
      if (o.throws === "next") throw new Error("neon down");
      return o.next ?? null;
    },
    async nextWakeNow() {
      if (o.throws === "next") throw new Error("neon down");
      return o.next ?? null;
    },
  });

  const T = 1_790_000_000_000;

  it("caches nothing under a stamp this request minted — and holds back only a 'not yet'", async () => {
    cachedReads.length = 0;
    // Work due: running is never the risky direction, so it runs at once.
    expect(await sweepVerdict(reads({ minted: true, next: 0 }), T)).toBe("due");
    // Nothing due yet: that answer could be missing a write, so ask again.
    expect(await sweepVerdict(reads({ minted: true, next: T + 5 * MIN }), T)).toBe("settling");
    expect(await sweepVerdict(reads({ minted: true, next: null }), T)).toBe("settling");
    expect(cachedReads).toEqual([]);
  });
  it("is idle while the next wake is ahead, or nothing will ever come due", async () => {
    expect(await sweepVerdict(reads({ next: T + 5 * MIN }), T)).toBe("idle");
    expect(await sweepVerdict(reads({ next: null }), T)).toBe("idle");
  });
  it("is due from the moment the next wake arrives — 0 is the database's 'already due'", async () => {
    expect(await sweepVerdict(reads({ next: T }), T)).toBe("due");
    expect(await sweepVerdict(reads({ next: 0 }), T)).toBe("due");
  });
  it("counts work due within the margin as due now, on both paths", async () => {
    // The crons' own queries run a step or two after the gate reads its clock;
    // something falling due in that gap must not slip a whole tick.
    expect(await sweepVerdict(reads({ next: T + DUE_MARGIN_MS - 1 }), T)).toBe("due");
    expect(await sweepVerdict(reads({ minted: true, next: T + DUE_MARGIN_MS - 1 }), T)).toBe("due");
    expect(await sweepVerdict(reads({ next: T + DUE_MARGIN_MS + 1 }), T)).toBe("idle");
  });
  it("FAILS OPEN — a broken cache or database runs the tick, as before", async () => {
    expect(await sweepVerdict(reads({ throws: "stamp" }), T)).toBe("due");
    expect(await sweepVerdict(reads({ throws: "next" }), T)).toBe("due");
  });
  it("runs every tick in a process with no Next cache at all", async () => {
    // `unstable_cache` refuses outside a Next server; the gate must answer
    // "due" there, never "idle".
    expect(await sweepVerdict()).toBe("due");
  });
});

describe("the cron's gate", () => {
  function fakeStep(verdicts: SweepVerdict[]) {
    const calls: string[] = [];
    const step = {
      async run(id: string, _fn: () => Promise<SweepVerdict>) {
        calls.push(id);
        const v = verdicts.shift();
        if (!v) throw new Error(`no scripted verdict for ${id}`);
        return v;
      },
      async sleep(id: string, duration: string) {
        calls.push(`${id}:${duration}`);
      },
    };
    return { step, calls };
  }

  it("skips an idle tick with one cache read and nothing else", async () => {
    const { step, calls } = fakeStep(["idle"]);
    expect(await sweepGateOpen(step)).toBe(false);
    expect(calls).toEqual(["gate"]);
  });
  it("opens a due tick", async () => {
    const { step } = fakeStep(["due"]);
    expect(await sweepGateOpen(step)).toBe(true);
  });
  it("settles once, then trusts the second answer", async () => {
    const skip = fakeStep(["settling", "idle"]);
    expect(await sweepGateOpen(skip.step)).toBe(false);
    expect(skip.calls).toEqual(["gate", `gate-settle:${GATE_SETTLE}`, "gate-settled"]);
    const run = fakeStep(["settling", "due"]);
    expect(await sweepGateOpen(run.step)).toBe(true);
  });
  it("runs the tick when it is still settling after the wait", async () => {
    const { step } = fakeStep(["settling", "settling"]);
    expect(await sweepGateOpen(step)).toBe(true);
  });
});

/**
 * THE RACE THE STAMP EXISTS FOR, on a model of Next's data cache reduced to
 * the two properties it lives in: a miss's value is stored AFTER the call has
 * returned it (`unstable_cache` does not wait for the write — modelled here as
 * the end of the request), and an invalidation expires only entries stored
 * BEFORE it.
 */
describe("a write that lands while the gate is computing", () => {
  class ModelCache {
    private clock = 0;
    private expiredAt = -1;
    private entries = new Map<string, { value: unknown; storedAt: number }>();
    invalidate() {
      this.expiredAt = ++this.clock;
    }
    request() {
      const pending: Array<() => void> = [];
      const read = async <T,>(key: string, fill: () => Promise<T>): Promise<{ value: T; hit: boolean }> => {
        const e = this.entries.get(key);
        if (e && !(this.expiredAt > e.storedAt)) return { value: e.value as T, hit: true };
        const value = await fill();
        pending.push(() => this.entries.set(key, { value, storedAt: ++this.clock }));
        return { value, hit: false };
      };
      return { read, end: () => pending.forEach((p) => p()) };
    }
  }

  const NOW = 1_000;
  const LATER = 1_000_000;

  /**
   * The world: one due time. `racer` is the writer — it makes work due NOW and
   * announces it (once) — and each test decides when it lands.
   */
  function setup() {
    const cache = new ModelCache();
    const world = { due: LATER };
    let raced = false;
    const racer = () => {
      if (raced) return;
      raced = true;
      world.due = NOW;
      cache.invalidate();
    };
    let seq = 0;
    const stamped = (req: ReturnType<ModelCache["request"]>, duringCompute?: () => void): GateReads => ({
      async stamp() {
        const r = await req.read("stamp", async () => `stamp-${++seq}`);
        return { stamp: r.value, minted: !r.hit };
      },
      async nextWake(stamp) {
        const r = await req.read(`next:${stamp}`, async () => {
          const snapshot = world.due;
          duringCompute?.();
          return snapshot;
        });
        return r.value;
      },
      async nextWakeNow() {
        const snapshot = world.due;
        duringCompute?.();
        return snapshot;
      },
    });
    /**
     * One cron tick as `sweepGateOpen` runs it: ask, and settle once in a
     * second request if told to. `race.first` lands the write in the middle of
     * the first ask's database read, `race.settled` in the middle of the
     * settled ask's, and `race.beforeEnd` while the first request is still
     * open, whether or not a read happened.
     */
    const tick = async (race: { first?: boolean; settled?: boolean; beforeEnd?: boolean } = {}): Promise<SweepVerdict> => {
      const r1 = cache.request();
      let v = await sweepVerdict(stamped(r1, race.first ? racer : undefined), NOW);
      if (race.beforeEnd) racer();
      r1.end();
      if (v === "settling") {
        const r2 = cache.request();
        v = await sweepVerdict(stamped(r2, race.settled ? racer : undefined), NOW);
        r2.end();
      }
      return v;
    };
    return { cache, tick };
  }

  it("is seen at once when it lands while the stamp is being minted", async () => {
    const s = setup();
    // The first ask after a wake mints the stamp, reads the world a moment
    // before the write and caches none of it — so the settled ask reads a
    // database that already holds the write.
    expect(await s.tick({ first: true, beforeEnd: true })).toBe("due");
    expect(await s.tick()).toBe("due");
  });

  it("is caught by the next tick when it races the settled compute itself", async () => {
    const s = setup();
    expect(await s.tick()).toBe("idle"); // a quiet tick stores the stamp and LATER
    s.cache.invalidate(); // some earlier write woke the sweeper
    expect(await s.tick({ settled: true })).toBe("idle"); // this read the world a moment before the write…
    expect(await s.tick()).toBe("due"); // …and the next tick is not fooled by what it stored.
  });

  it("WOULD be lost by a plain cached value — the reason the stamp exists", async () => {
    const cache = new ModelCache();
    const world = { due: LATER };
    const naive = async (duringCompute?: () => void) => {
      const req = cache.request();
      const r = await req.read("next", async () => {
        const snapshot = world.due;
        duringCompute?.();
        return snapshot;
      });
      req.end();
      return NOW >= r.value ? "due" : "idle";
    };
    const racer = () => {
      world.due = NOW;
      cache.invalidate();
    };
    expect(await naive(racer)).toBe("idle");
    // The value stored after the invalidation looks current: the write is
    // invisible until the entry's hour runs out.
    expect(await naive()).toBe("idle");
  });
});

/**
 * EVERY WRITE THAT CAN MOVE WORK EARLIER WAKES THE GATE.
 *
 * Read off the syntax tree rather than grepped, so the rule is "the FUNCTION
 * that writes a due-deciding column calls `wakeSweeper()`" — not "the file
 * mentions it somewhere". Deletes are exempt: they can only remove due work,
 * which leaves the cached answer early, never late.
 */
const DUE_COLUMNS: Record<string, Set<string>> = {
  connections: new Set(["status", "pausedUntil", "nextSweepAt"]),
  backfillJobs: new Set(["status"]),
  flowResults: new Set(["status", "tile", "computedAt", "createdAt"]),
};
const RAW_WRITE = /\b(update|insert\s+into)\s+(connections|backfill_jobs|flow_results)\b/i;

type Site = { file: string; line: number; what: string; wakes: boolean };

/** Keys an object literal sets, through conditional spreads; null when unknowable. */
function keysOf(expr: ts.Expression): Set<string> | null {
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (ts.isObjectLiteralExpression(expr)) {
    const keys = new Set<string>();
    for (const p of expr.properties) {
      if (ts.isSpreadAssignment(p)) {
        const inner = keysOf(p.expression);
        if (!inner) return null;
        inner.forEach((k) => keys.add(k));
      } else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        keys.add(p.name.text);
      } else {
        return null;
      }
    }
    return keys;
  }
  if (ts.isConditionalExpression(expr)) {
    const a = keysOf(expr.whenTrue);
    const b = keysOf(expr.whenFalse);
    return a && b ? new Set([...a, ...b]) : null;
  }
  return null;
}

function scanWrites(fileName: string, text: string): Site[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: Site[] = [];
  const enclosing = (n: ts.Node) => {
    let p: ts.Node | undefined = n.parent;
    while (p && !ts.isFunctionLike(p)) p = p.parent;
    return p;
  };
  const wakes = (fn: ts.Node | undefined) => {
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "wakeSweeper") found = true;
      else ts.forEachChild(n, visit);
    };
    if (fn) visit(fn);
    return found;
  };
  const add = (n: ts.Node, what: string) =>
    sites.push({ file: fileName, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, what, wakes: wakes(enclosing(n)) });

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const table = n.arguments[0];
      if ((method === "update" || method === "insert") && table && ts.isIdentifier(table) && table.text in DUE_COLUMNS) {
        let relevant = method === "insert";
        if (method === "update") {
          const set = n.parent;
          const call = set?.parent;
          const obj = call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(set) && set.name.text === "set" ? call.arguments[0] : undefined;
          const keys = obj ? keysOf(obj) : null;
          relevant = keys === null || [...keys].some((k) => DUE_COLUMNS[table.text].has(k));
        }
        if (relevant) add(n, `${method}(${table.text})`);
      }
    }
    if ((ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && RAW_WRITE.test(n.getText(sf))) {
      add(n, "raw SQL write");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts") && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("every write that moves work wakes the gate", () => {
  it("the scanner can fail: it finds unannounced writes and ignores harmless ones", () => {
    const sites = scanWrites(
      "fixture.ts",
      `
      export async function a(db) { await db.update(connections).set({ nextSweepAt: new Date() }).where(x); }
      export async function b(db) { await db.update(connections).set({ nextSweepAt: new Date() }).where(x); wakeSweeper(); }
      export async function c(db) { await db.update(connections).set({ lastError: "x" }).where(x); }
      export async function d(db) { await db.update(connections).set({ ...(y ? { config: {} } : {}), updatedAt: 1 }).where(x); }
      export async function e(db) { await db.update(connections).set({ ...patch }).where(x); }
      export async function f(db) { await db.execute(sql\`update flow_results set status = 'stale'\`); }
      export async function g(db) { await db.insert(backfillJobs).values({}); }
      export async function h(db) { await db.delete(flowResults).where(x); }
      `,
    );
    expect(sites.map((s) => `${s.what}:${s.wakes}`)).toEqual([
      "update(connections):false",
      "update(connections):true",
      "update(connections):false",
      "raw SQL write:false",
      "insert(backfillJobs):false",
    ]);
  });

  it("holds across src/", () => {
    const root = join(process.cwd(), "src");
    const sites = sourceFiles(root).flatMap((f) => scanWrites(relative(process.cwd(), f), readFileSync(f, "utf8")));
    // A scanner that silently matched nothing would pass everything: the tree
    // has well over this many due-deciding writes today.
    expect(sites.length).toBeGreaterThanOrEqual(20);
    const silent = sites.filter((s) => !s.wakes).map((s) => `${s.file}:${s.line} ${s.what}`);
    expect(silent, "these writes can make sweep work due without telling the gate — call wakeSweeper() (lib/sweep/wake.ts)").toEqual([]);
  });

  it("wakeSweeper is safe to call anywhere, including outside a request", () => {
    expect(() => wakeSweeper()).not.toThrow();
  });
});
