# Connector Kit Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding a connector a one-module, one-entry, one-test job by giving new connectors a kit of tested helpers, a provider-agnostic OAuth flow, population tests instead of hand-joined rosters, connector hooks instead of source-name branches, and a scaffold plus prober per connector.

**Architecture:** A `src/connectors/kit/` of composable functions (windowed walk, signature schemes, provider HTTP client, id and date helpers) that new connectors import and the seven existing connectors ignore. A `src/lib/oauth/` provider registry and flow that the two Google entries move onto with byte-identical authorize URLs. Catalog entries gain `brand`, `docs`, `verified`, `connect: "oauth"` and `oauthProvider`; the `Connector` interface gains `importProgress` and `retention` hooks. Tests iterate `CONNECTOR_CATALOG` so a new connector is covered the moment it is registered.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript, drizzle + Neon (PGlite in tests), vitest (node env, TZ=UTC), `tsx` scripts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-connector-kit-and-first-twenty-design.md`

## Global Constraints

- The seven existing connectors (calendly, close, instantly, whop, gsheets, gcal, webhook) keep their behaviour and their tests; no migration onto the kit.
- Every behavioural change ships with a test that fails on the old code.
- Gates at every commit: `pnpm typecheck`, the touched test files; before the final push also `pnpm test` (dev server STOPPED; `pnpm vitest run --maxWorkers=2` if the machine is busy), `pnpm check:orphans`, `pnpm check:ui`, `pnpm build`.
- `check:orphans` scans `src/` and `scripts/` for callers of every `export function`; a barrel re-export is not a caller. Kit exports with no production caller yet are allowlisted WITH a dated reason, and the connectors plan removes those entries as consumers land.
- `check:ui` walks all of `src/`; its "hex literal" rule needs an `allow` entry for `src/connectors/catalog.ts` (brand colours are the vendors', mirroring the existing `source-style.ts` entry).
- Tests are typechecked (`tsconfig` includes `**/*.ts`) and two tests push bare fake catalog entries, so `brand`, `docs`, `verified`, `oauthProvider` are OPTIONAL in the type and REQUIRED by the population test.
- The flow builder's UI (`src/components/flow/**`) is not redesigned; `sourceStyle` keeps its export name and signature.
- Commit messages: one line of intent, a body that says why, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work in the worktree `.claude/worktrees/figma-overview-match` on branch `worktree-figma-overview-match`; never `cd` out of it; never bare `git stash`.

---

## File structure

Created
- `src/connectors/kit/walk.ts` — `windowedWalk`, `parseWalkCursor`, `serializeWalkCursor`, `walkImportProgress`.
- `src/connectors/kit/verify.ts` — `standardWebhooksVerify`, `timestampedHmacVerify`, `hmacHeaderVerify`, `sharedTokenVerify`.
- `src/connectors/kit/http.ts` — `providerClient`, `bearerClient`, `basicClient`, `headerKeyClient`, `requireCredential`.
- `src/connectors/kit/ids.ts` — `eventId`, `naturalOrHash`.
- `src/connectors/kit/dates.ts` — `epochToDate`, `ymd`, `isoOrNull`, re-export `parseDate`.
- `src/connectors/kit/index.ts` — barrel.
- `src/lib/oauth/providers.ts` — `OAUTH_PROVIDERS`, `oauthProvider`, `oauthProviderFor`, `OAuthProvider`, `OAuthTokens`.
- `src/lib/oauth/flow.ts` — `buildAuthUrl`, `exchangeCode`, `refreshTokens`, `redirectUriFor`.
- `src/app/api/oauth/[provider]/start/route.ts`, `src/app/api/oauth/[provider]/callback/route.ts`.
- `scripts/lib/probe.ts` — the prober harness.
- `scripts/new-connector.ts` — the scaffold.
- `scripts/verify-all.ts` — runs every generated prober whose key is present.
- `scripts/connector-inventory.ts` — prints the catalog with provenance and verification.
- `docs/ADDING_A_CONNECTOR.md`.
- Tests: `tests/kit-windowed-walk.test.ts`, `tests/kit-verify.test.ts`, `tests/kit-http.test.ts`, `tests/kit-ids-dates.test.ts`, `tests/source-style.test.ts`, `tests/connector-population.test.ts`, `tests/oauth-providers.test.ts`, `tests/oauth-route.test.ts`, `tests/connector-hooks.test.ts`.

Modified
- `src/connectors/catalog.ts` — new types and fields; `brand` on the seven entries.
- `src/connectors/types.ts` — `importProgress`, `retention` on `Connector`.
- `src/connectors/close.ts` — declares the two hooks.
- `src/components/flow/controls/source-style.ts` — reads the catalog.
- `src/lib/sync/import-status.ts`, `src/lib/health/invariants.ts` — generic hooks.
- `src/lib/oauth-state.ts`, `src/lib/credentials.ts`, `src/app/integrations/page.tsx`, `src/app/integrations/error-messages.ts`.
- `scripts/check-orphans.ts` (allowlist), `scripts/check-ui.ts` (allow), `.github/workflows/verify-providers.yml`.
- `tests/connectors-signatures.test.ts`, `tests/held-continuation.test.ts`, `tests/invariant-scan.test.ts`, `tests/oauth-state.test.ts`, `tests/integrations-errors.test.ts`.
- `docs/DATA_MODEL.md`, `docs/HOW_THE_BACKEND_WORKS.md`.

Deleted
- `src/lib/google-oauth.ts`, `src/app/api/oauth/google/start/route.ts`, `src/app/api/oauth/google/callback/route.ts` (the `[provider]` routes serve the same URLs).

---

### Task 1: `kit/walk.ts` — the windowed walk, written once

**Files:**
- Create: `src/connectors/kit/walk.ts`
- Test: `tests/kit-windowed-walk.test.ts`

**Interfaces:**
- Consumes: `spanCovered` from `src/connectors/field-utils.ts`; `CanonicalEvent`, `ImportCoverage`, `PollBudget`, `PollResult` from `src/connectors/types.ts`; `ObservedRateLimit` from `src/lib/http-client.ts`; `holdsWindowContinuation` (field-utils) already understands the cursor shape.
- Produces: `parseWalkCursor(raw: string | null): WalkCursor`, `serializeWalkCursor(c: WalkCursor): string | null`, `walkImportProgress(raw: string | null, now?: number): ImportCoverage | null`, `windowedWalk<Row>(o: WindowedWalkOpts<Row>): Promise<PollResult>`, types `WalkCursor`, `WalkPage<Row>`, `WalkDefaults`, `WindowedWalkOpts<Row>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/kit-windowed-walk.test.ts
import { describe, it, expect } from "vitest";
import { HttpError } from "@/lib/http-client";
import { holdsWindowContinuation } from "@/connectors/field-utils";
import {
  windowedWalk,
  parseWalkCursor,
  serializeWalkCursor,
  walkImportProgress,
  type WindowedWalkOpts,
} from "@/connectors/kit/walk";
import type { CanonicalEvent } from "@/connectors/types";

const DAY = 86_400_000;
const MIN = 60_000;
type Row = { id: string; updated: string; created: string };

/** A provider that filters on `updated >= since`, returns newest-first, and pages by offset in `next`. */
function server(rows: Row[], pageSize = 50) {
  const calls: Array<{ since: string; cont: string | null }> = [];
  const fetchPage: WindowedWalkOpts<Row>["fetchPage"] = async ({ since, cont }) => {
    calls.push({ since: since.toISOString(), cont });
    const kept = rows.filter((r) => Date.parse(r.updated) >= since.getTime());
    const offset = cont ? Number(cont) : 0;
    const page = kept.slice(offset, offset + pageSize);
    return { rows: page, next: offset + page.length < kept.length ? String(offset + page.length) : null };
  };
  return { calls, fetchPage };
}

const DEFAULTS = { pagesPerPoll: 4, maxPagesPerPoll: 40, firstSyncDays: 30, overlapMs: 5 * MIN };
const map = (r: Row): CanonicalEvent => ({ eventId: `t:c1:${r.id}`, eventType: "row", occurredAt: new Date(r.created) });
const changedAt = (r: Row) => r.updated;
const happenedAt = (r: Row) => r.created;

/** n rows, updated one minute apart ending an hour ago, created a day earlier each — newest first. */
function burst(n: number, now: number): Row[] {
  const end = now - 3_600_000;
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i + 1}`,
    updated: new Date(end - i * MIN).toISOString(),
    created: new Date(end - DAY - i * MIN).toISOString(),
  }));
}

describe("windowedWalk", () => {
  const NOW = Date.parse("2026-09-07T12:00:00Z");
  const now = () => NOW;

  it("drains a burst larger than one poll's page cap without stranding a record", async () => {
    const rows = burst(260, NOW);
    const { fetchPage } = server(rows);
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await windowedWalk({ cursor, now, defaults: DEFAULTS, fetchPage, changedAt, happenedAt, map });
      for (const e of res.records) seen.add(e.eventId.split(":").pop()!);
      cursor = res.nextCursor;
      if (!res.incomplete) break;
    }
    expect(seen.size).toBe(260);
    expect(cursor).toBe(rows[0].updated); // settled: a bare high-water mark = the newest `updated`
    expect(holdsWindowContinuation(cursor)).toBe(false);
  });

  it("stops at the page cap, says so, and reports coverage on the happened-at axis", async () => {
    const rows = burst(260, NOW);
    const { calls, fetchPage } = server(rows);
    const res = await windowedWalk({ cursor: null, now, defaults: DEFAULTS, fetchPage, changedAt, happenedAt, map });
    expect(calls).toHaveLength(4);
    expect(res.records).toHaveLength(200);
    expect(res.incomplete).toBe(true);
    expect(res.providerCalls).toBe(4);
    expect(holdsWindowContinuation(res.nextCursor)).toBe(true);
    expect(res.importProgress).toBeDefined();
    expect(res.importProgress!.targetMs).toBe(30 * DAY);
    // 200 rows created a minute apart = 199 minutes of the created axis, not the updated one.
    expect(res.importProgress!.coveredMs).toBe(199 * MIN);
  });

  it("a budget caps the pages below the default; a deadline stops between pages", async () => {
    const rows = burst(260, NOW);
    const a = server(rows);
    await windowedWalk({ cursor: null, budget: { maxCalls: 2, nowMs: now }, defaults: DEFAULTS, fetchPage: a.fetchPage, changedAt, map });
    expect(a.calls).toHaveLength(2);

    let clock = NOW;
    const b = server(rows);
    const res = await windowedWalk({
      cursor: null,
      budget: { maxCalls: 10, deadlineMs: NOW + 1, nowMs: () => (clock += 1000) },
      defaults: DEFAULTS,
      fetchPage: b.fetchPage,
      changedAt,
      map,
    });
    expect(b.calls).toHaveLength(1);
    expect(res.incomplete).toBe(true);
  });

  it("an expired continuation restarts from the high-water mark without losing what was read", async () => {
    const rows = burst(120, NOW);
    const base = server(rows);
    const fetchPage: WindowedWalkOpts<Row>["fetchPage"] = async (q) => {
      if (q.cont) throw new HttpError({ status: 400, statusText: "Bad Request", url: "x", body: "cursor expired", retryAfterMs: null });
      return base.fetchPage(q);
    };
    const res = await windowedWalk({
      cursor: JSON.stringify({ hw: rows[60].updated, cont: "50", maxSeen: rows[0].updated }),
      now,
      defaults: DEFAULTS,
      fetchPage,
      changedAt,
      map,
      expiredContinuation: (e) => e instanceof HttpError && e.status === 400,
    });
    expect(res.incomplete).toBe(true);
    expect(res.records).toHaveLength(0);
    expect(res.nextCursor).toBe(rows[60].updated); // cont dropped, hw kept, maxSeen discarded
  });

  it("re-reads from the mark minus the overlap, and bounds a first sync at firstSyncDays or windowFloor", async () => {
    const rows = burst(10, NOW);
    const hw = rows[0].updated;
    const a = server(rows);
    await windowedWalk({ cursor: hw, now, defaults: DEFAULTS, fetchPage: a.fetchPage, changedAt, map });
    expect(a.calls[0].since).toBe(new Date(Date.parse(hw) - 5 * MIN).toISOString());

    const b = server(rows);
    await windowedWalk({ cursor: null, now, defaults: DEFAULTS, fetchPage: b.fetchPage, changedAt, map });
    expect(b.calls[0].since).toBe(new Date(NOW - 30 * DAY).toISOString());

    const c = server(rows);
    const deep = new Date(NOW - 90 * DAY);
    await windowedWalk({ cursor: null, now, windowFloor: deep, defaults: DEFAULTS, fetchPage: c.fetchPage, changedAt, map });
    expect(c.calls[0].since).toBe(deep.toISOString());
  });

  it("dedupes within a poll, skips rows map() refuses, and still advances the mark for them", async () => {
    const rows = burst(3, NOW);
    const dup = { ...rows[1], id: "r2" };
    const { fetchPage } = server([rows[0], rows[1], dup, rows[2]]);
    const res = await windowedWalk({
      cursor: null,
      now,
      defaults: DEFAULTS,
      fetchPage,
      changedAt,
      map: (r) => (r.id === "r1" ? null : map(r)),
    });
    expect(res.records.map((e) => e.eventId)).toEqual(["t:c1:r2", "t:c1:r3"]);
    expect(res.nextCursor).toBe(rows[0].updated); // r1 was skipped by map() but its `updated` still moved the mark
  });

  it("reports the last observed rate limit", async () => {
    const rows = burst(3, NOW);
    const res = await windowedWalk({
      cursor: null,
      now,
      defaults: DEFAULTS,
      fetchPage: async () => ({ rows, next: null, rateLimit: { limit: 100, remaining: 7, resetSeconds: 30 } }),
      changedAt,
      map,
    });
    expect(res.rateLimit).toEqual({ limit: 100, remaining: 7, resetSeconds: 30 });
  });
});

describe("walk cursors", () => {
  it("round-trips, reads a bare string as a mark, and treats bad JSON as a fresh start", () => {
    expect(parseWalkCursor(null)).toEqual({ hw: null, cont: null, maxSeen: null });
    expect(parseWalkCursor("2026-08-01T00:00:00Z")).toEqual({ hw: "2026-08-01T00:00:00Z", cont: null, maxSeen: null });
    expect(parseWalkCursor("{nope")).toEqual({ hw: null, cont: null, maxSeen: null });
    const c = { hw: "2026-08-01T00:00:00Z", cont: "tok", maxSeen: "2026-08-02T00:00:00Z", floor: null, covLo: null, covHi: null };
    expect(parseWalkCursor(serializeWalkCursor(c))).toEqual(c);
    expect(serializeWalkCursor({ hw: "a", cont: null, maxSeen: "b" })).toBe("b");
    expect(serializeWalkCursor({ hw: "a", cont: null, maxSeen: null })).toBe("a");
  });

  it("walkImportProgress answers only for a first sync still walking", () => {
    const now = Date.parse("2026-09-07T12:00:00Z");
    expect(walkImportProgress(null, now)).toBeNull();
    expect(walkImportProgress("2026-08-01T00:00:00Z", now)).toBeNull();
    expect(walkImportProgress(JSON.stringify({ hw: "2026-08-01T00:00:00Z", cont: "t", floor: "2026-07-01T00:00:00Z" }), now)).toBeNull();
    const floor = new Date(now - 30 * DAY).toISOString();
    const covLo = new Date(now - 10 * DAY).toISOString();
    const covHi = new Date(now - 1 * DAY).toISOString();
    expect(walkImportProgress(JSON.stringify({ hw: null, cont: "t", maxSeen: null, floor, covLo, covHi }), now)).toEqual({
      coveredMs: 9 * DAY,
      targetMs: 30 * DAY,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/kit-windowed-walk.test.ts`
Expected: FAIL — `Cannot find module '@/connectors/kit/walk'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/connectors/kit/walk.ts
import type { ObservedRateLimit } from "@/lib/http-client";
import { spanCovered } from "../field-utils";
import type { CanonicalEvent, ImportCoverage, PollBudget, PollResult } from "../types";

const DAY_MS = 86_400_000;

/**
 * The cursor of a windowed walk — the same grammar Close, Instantly and Whop
 * each hand-rolled, written once. A BARE STRING is a settled high-water mark
 * (the newest `changedAt` seen). JSON means mid-walk: `cont` is the provider's
 * continuation, `maxSeen` the newest mark seen so far in this window, and
 * `floor`/`covLo`/`covHi` exist only during a first sync, for coverage.
 * `holdsWindowContinuation` (field-utils) and `cursorSaysImporting`
 * (import-status) already read this grammar.
 */
export type WalkCursor = {
  hw: string | null;
  cont: string | null;
  maxSeen: string | null;
  floor?: string | null;
  covLo?: string | null;
  covHi?: string | null;
};

export function parseWalkCursor(raw: string | null): WalkCursor {
  if (!raw) return { hw: null, cont: null, maxSeen: null };
  if (raw.startsWith("{")) {
    try {
      const p = JSON.parse(raw) as Partial<WalkCursor>;
      return {
        hw: p.hw ?? null,
        cont: p.cont ?? null,
        maxSeen: p.maxSeen ?? null,
        floor: p.floor ?? null,
        covLo: p.covLo ?? null,
        covHi: p.covHi ?? null,
      };
    } catch {
      return { hw: null, cont: null, maxSeen: null };
    }
  }
  return { hw: raw, cont: null, maxSeen: null };
}

export function serializeWalkCursor(c: WalkCursor): string | null {
  if (c.cont || (!c.hw && c.floor)) return JSON.stringify(c);
  return c.maxSeen ?? c.hw;
}

function coverage(c: WalkCursor, targetMs: number, now: number): ImportCoverage {
  const loMs = c.covLo ? Date.parse(c.covLo) || 0 : 0;
  // Records inside the change window can have HAPPENED long before it (an
  // edit to an old record); clamp so "covering 700 of 30 days" cannot appear.
  const lo = loMs > 0 && loMs < targetMs ? new Date(targetMs).toISOString() : (c.covLo ?? null);
  return spanCovered(lo, c.covHi ?? null, targetMs, now);
}

/** Coverage of a FIRST sync still walking; null once a mark exists or for a bare cursor. */
export function walkImportProgress(raw: string | null, now = Date.now()): ImportCoverage | null {
  const c = parseWalkCursor(raw);
  if (!raw || c.hw || !c.floor) return null;
  const floorMs = Date.parse(c.floor);
  if (!Number.isFinite(floorMs)) return null;
  return coverage(c, floorMs, now);
}

const later = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return (Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a;
};
const earlier = (a: string | null, b: string | null): string | null => {
  const ta = a ? Date.parse(a) || null : null;
  const tb = b ? Date.parse(b) || null : null;
  if (ta == null) return b;
  if (tb == null) return a;
  return tb < ta ? b : a;
};

export type WalkPage<Row> = { rows: Row[]; next: string | null; rateLimit?: ObservedRateLimit | null };

export type WalkDefaults = {
  /** Pages per poll when no budget is handed down (legacy callers, tests). */
  pagesPerPoll: number;
  /** Memory ceiling on pages even when the budget allows more. */
  maxPagesPerPoll: number;
  /** How far back a first sync reaches when nothing deepens it. */
  firstSyncDays: number;
  /** Re-read this much behind the mark, so a late-arriving edit is not missed. */
  overlapMs: number;
};

export type WindowedWalkOpts<Row> = {
  cursor: string | null;
  budget?: PollBudget;
  windowFloor?: Date | null;
  /** Injectable clock; `budget.nowMs` wins when both are given. */
  now?: () => number;
  defaults: WalkDefaults;
  /** One provider request: rows changed at or after `since`, from `cont` when set. */
  fetchPage: (q: { since: Date; cont: string | null }) => Promise<WalkPage<Row>>;
  /** The field the provider FILTERS on — the watermark axis. */
  changedAt: (row: Row) => string | null;
  /** The field that says when the thing HAPPENED — the coverage axis. Defaults to `changedAt`. */
  happenedAt?: (row: Row) => string | null;
  /** Null skips the row; its `changedAt` still advances the mark so it is not re-read forever. */
  map: (row: Row) => CanonicalEvent | null;
  /** Recognise "this continuation is dead" — the walk drops it and resumes from the mark. */
  expiredContinuation?: (err: unknown) => boolean;
};

/**
 * Cursor-forward polling with overlap, bounded by budget and deadline, that
 * never strands a record: a window is drained to its end across polls, a
 * deeper first sync resumes where it stopped, and the mark only advances
 * once a window has settled.
 */
export async function windowedWalk<Row>(o: WindowedWalkOpts<Row>): Promise<PollResult> {
  const nowMs = o.budget?.nowMs ?? o.now ?? Date.now;
  const started = nowMs();
  const cur = parseWalkCursor(o.cursor);
  if (cur.hw && !Number.isFinite(Date.parse(cur.hw))) cur.hw = null;

  const defaultFloor = started - o.defaults.firstSyncDays * DAY_MS;
  const requestedFloor = o.windowFloor ? o.windowFloor.getTime() : null;
  const storedFloor = cur.floor ? Date.parse(cur.floor) : NaN;
  let targetMs: number;
  if (cur.hw) targetMs = Date.parse(cur.hw) - o.defaults.overlapMs;
  else if (Number.isFinite(storedFloor)) targetMs = requestedFloor != null ? Math.min(storedFloor, requestedFloor) : storedFloor;
  else targetMs = requestedFloor != null ? Math.min(defaultFloor, requestedFloor) : defaultFloor;
  if (!cur.hw) cur.floor = new Date(targetMs).toISOString();
  const since = new Date(targetMs);

  const pageCap = o.budget ? Math.min(o.defaults.maxPagesPerPoll, Math.max(1, o.budget.maxCalls)) : o.defaults.pagesPerPoll;
  const deadline = o.budget?.deadlineMs;
  const records = new Map<string, CanonicalEvent>();
  const happenedAt = o.happenedAt ?? o.changedAt;
  let providerCalls = 0;
  let rateLimit: ObservedRateLimit | null = null;

  const partial = (): PollResult => ({
    records: [...records.values()],
    nextCursor: serializeWalkCursor(cur),
    providerCalls,
    rateLimit: rateLimit ?? undefined,
    incomplete: true,
    importProgress: cur.hw ? undefined : coverage(cur, targetMs, nowMs()),
  });

  for (let pages = 0; pages < pageCap; pages++) {
    if (pages > 0 && deadline != null && nowMs() >= deadline) return partial();
    let page: WalkPage<Row>;
    try {
      providerCalls += 1;
      page = await o.fetchPage({ since, cont: cur.cont });
    } catch (e) {
      if (cur.cont && o.expiredContinuation?.(e)) {
        cur.cont = null;
        cur.maxSeen = null;
        return partial();
      }
      throw e;
    }
    if (page.rateLimit) rateLimit = page.rateLimit;
    for (const row of page.rows) {
      const ev = o.map(row);
      if (ev) records.set(ev.eventId, ev);
      cur.maxSeen = later(cur.maxSeen, o.changedAt(row));
      const h = happenedAt(row);
      cur.covLo = earlier(cur.covLo ?? null, h);
      cur.covHi = later(cur.covHi ?? null, h);
    }
    if (!page.next || page.rows.length === 0) {
      return {
        records: [...records.values()],
        nextCursor: serializeWalkCursor({ hw: cur.maxSeen ?? cur.hw, cont: null, maxSeen: null }),
        providerCalls,
        rateLimit: rateLimit ?? undefined,
      };
    }
    cur.cont = page.next;
  }
  return partial();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/kit-windowed-walk.test.ts && pnpm typecheck`
Expected: PASS (9 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/kit/walk.ts tests/kit-windowed-walk.test.ts
git commit -m "Write the windowed walk once, for the connectors that come next

Close, Instantly and Whop each hand-rolled the same hw/cont/maxSeen walk and
the stranding bug was fixed three times. New connectors compose this one; the
three existing ones are untouched. Same cursor grammar, so field-utils and
import-status keep reading it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `kit/verify.ts` — every signature scheme, failing closed

**Files:**
- Create: `src/connectors/kit/verify.ts`
- Test: `tests/kit-verify.test.ts`

**Interfaces:**
- Consumes: `safeEqual`, `timestampFreshness` from `src/lib/signatures.ts`.
- Produces: `standardWebhooksVerify(input, opts?)`, `timestampedHmacVerify(input, opts)`, `hmacHeaderVerify(input, opts)`, `sharedTokenVerify(input, opts)`, all `(…) => boolean`; type `VerifyInput = { rawBody: string; headers: Record<string, string>; secret?: string | null }` (structurally identical to `VerifyArgs`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/kit-verify.test.ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  standardWebhooksVerify,
  timestampedHmacVerify,
  hmacHeaderVerify,
  sharedTokenVerify,
} from "@/connectors/kit/verify";

const BODY = '{"id":"evt_1","type":"payment.succeeded"}';
const nowSec = () => Math.floor(Date.now() / 1000);
const hmac = (key: string | Buffer, msg: string, enc: "hex" | "base64" = "hex") =>
  createHmac("sha256", key).update(msg, "utf8").digest(enc);

describe("standardWebhooksVerify (webhook-id.webhook-timestamp.body, v1 base64)", () => {
  const raw = Buffer.from("a-32-byte-secret-for-the-tests-!").toString("base64");
  const secret = `whsec_${raw}`;
  const headersFor = (sig: string, ts = String(nowSec())) => ({ "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": sig });
  const sign = (ts: string) => `v1,${hmac(Buffer.from(raw, "base64"), `msg_1.${ts}.${BODY}`, "base64")}`;

  it("accepts a fresh, correctly signed delivery — and one of several v1 entries", () => {
    const ts = String(nowSec());
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sign(ts), ts), secret })).toBe(true);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(`v1,AAAA ${sign(ts)}`, ts), secret })).toBe(true);
  });
  it("accepts the secret without its whsec_ prefix and a literal (undecoded) secret", () => {
    const ts = String(nowSec());
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sign(ts), ts), secret: raw })).toBe(true);
    const literal = "plain-literal-secret";
    const sig = `v1,${hmac(literal, `msg_1.${ts}.${BODY}`, "base64")}`;
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sig, ts), secret: literal })).toBe(true);
  });
  it("fails closed: no secret, missing headers, wrong secret, tampered body, stale timestamp", () => {
    const ts = String(nowSec());
    const h = headersFor(sign(ts), ts);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: h, secret: null })).toBe(false);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: { "webhook-id": "msg_1" }, secret })).toBe(false);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: h, secret: "whsec_d3Jvbmc=" })).toBe(false);
    expect(standardWebhooksVerify({ rawBody: BODY + " ", headers: h, secret })).toBe(false);
    const old = String(nowSec() - 3600);
    expect(standardWebhooksVerify({ rawBody: BODY, headers: headersFor(sign(old), old), secret })).toBe(false);
  });
});

describe("timestampedHmacVerify (t=…,v1=… style)", () => {
  const secret = "whsec_test";
  const opts = {
    header: "stripe-signature",
    timestampKey: "t",
    signatureKey: "v1",
    message: (t: string, body: string) => `${t}.${body}`,
  } as const;
  it("accepts a fresh signature, including when two v1 values are present", () => {
    const t = String(nowSec());
    const v1 = hmac(secret, `${t}.${BODY}`);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=${t},v1=${v1}` }, secret }, opts)).toBe(true);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=${t},v1=deadbeef,v1=${v1}` }, secret }, opts)).toBe(true);
  });
  it("supports another separator, base64, and a custom message (Paddle ts;h1, OnceHub t=,s=)", () => {
    const t = String(nowSec());
    const h1 = hmac(secret, `${t}:${BODY}`);
    expect(
      timestampedHmacVerify(
        { rawBody: BODY, headers: { "paddle-signature": `ts=${t};h1=${h1}` }, secret },
        { header: "paddle-signature", pairSeparator: ";", timestampKey: "ts", signatureKey: "h1", message: (ts, b) => `${ts}:${b}` },
      ),
    ).toBe(true);
    const s = hmac(secret, `${t}.${BODY}`, "base64");
    expect(
      timestampedHmacVerify(
        { rawBody: BODY, headers: { "oncehub-signature": `t=${t},s=${s}` }, secret },
        { header: "oncehub-signature", timestampKey: "t", signatureKey: "s", encoding: "base64", message: (ts, b) => `${ts}.${b}` },
      ),
    ).toBe(true);
  });
  it("fails closed: no secret, no header, wrong secret, stale, unparseable timestamp", () => {
    const t = String(nowSec());
    const v1 = hmac(secret, `${t}.${BODY}`);
    const headers = { "stripe-signature": `t=${t},v1=${v1}` };
    expect(timestampedHmacVerify({ rawBody: BODY, headers, secret: null }, opts)).toBe(false);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: {}, secret }, opts)).toBe(false);
    expect(timestampedHmacVerify({ rawBody: BODY, headers, secret: "other" }, opts)).toBe(false);
    const old = String(nowSec() - 3600);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=${old},v1=${hmac(secret, `${old}.${BODY}`)}` }, secret }, opts)).toBe(false);
    expect(timestampedHmacVerify({ rawBody: BODY, headers: { "stripe-signature": `t=soon,v1=${hmac(secret, `soon.${BODY}`)}` }, secret }, opts)).toBe(false);
  });
});

describe("hmacHeaderVerify (one header over the raw body)", () => {
  const secret = "s3cret";
  it("hex, base64, and a sha256= prefix", () => {
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { "x-cal-signature-256": hmac(secret, BODY) }, secret }, { header: "x-cal-signature-256", encoding: "hex" })).toBe(true);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { "typeform-signature": `sha256=${hmac(secret, BODY, "base64")}` }, secret }, { header: "typeform-signature", encoding: "base64", prefix: "sha256=" })).toBe(true);
  });
  it("fails closed", () => {
    const sig = hmac(secret, BODY);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { h: sig }, secret: null }, { header: "h", encoding: "hex" })).toBe(false);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: {}, secret }, { header: "h", encoding: "hex" })).toBe(false);
    expect(hmacHeaderVerify({ rawBody: BODY, headers: { h: sig }, secret: "nope" }, { header: "h", encoding: "hex" })).toBe(false);
    expect(hmacHeaderVerify({ rawBody: BODY + "x", headers: { h: sig }, secret }, { header: "h", encoding: "hex" })).toBe(false);
  });
});

describe("sharedTokenVerify (a bare token, constant-time)", () => {
  it("matches a header or a caller-extracted token, and fails closed", () => {
    expect(sharedTokenVerify({ rawBody: BODY, headers: { "x-token": "abc" }, secret: "abc" }, { header: "x-token" })).toBe(true);
    expect(sharedTokenVerify({ rawBody: BODY, headers: {}, secret: "abc" }, { token: "abc" })).toBe(true);
    expect(sharedTokenVerify({ rawBody: BODY, headers: { "x-token": "abc" }, secret: null }, { header: "x-token" })).toBe(false);
    expect(sharedTokenVerify({ rawBody: BODY, headers: {}, secret: "abc" }, { header: "x-token" })).toBe(false);
    expect(sharedTokenVerify({ rawBody: BODY, headers: { "x-token": "abd" }, secret: "abc" }, { header: "x-token" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/kit-verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/connectors/kit/verify.ts
import { createHmac } from "node:crypto";
import { safeEqual, timestampFreshness } from "@/lib/signatures";

/** Structurally the same as `VerifyArgs` — a connector passes its args straight through. */
export type VerifyInput = { rawBody: string; headers: Record<string, string>; secret?: string | null };
type Algo = "sha256" | "sha1" | "md5";
type Enc = "hex" | "base64";

function digest(algo: Algo, key: string | Buffer, message: string, enc: Enc): string {
  return createHmac(algo, key).update(message, "utf8").digest(enc);
}

/**
 * Standard Webhooks (Svix, Stripe's Workbench, Whop, Retell, OpenPhone…):
 * `webhook-id`.`webhook-timestamp`.body, HMAC-SHA256, base64, in a
 * `webhook-signature` header of space-separated `v1,<sig>` entries. The
 * secret is usually `whsec_` + base64; both the decoded and the literal
 * key are tried, as Whop's connector learned to.
 */
export function standardWebhooksVerify(
  input: VerifyInput,
  opts: { idHeader?: string; timestampHeader?: string; signatureHeader?: string; secretPrefix?: string; toleranceMs?: number } = {},
): boolean {
  const { rawBody, headers, secret } = input;
  if (!secret) return false;
  const id = headers[opts.idHeader ?? "webhook-id"];
  const ts = headers[opts.timestampHeader ?? "webhook-timestamp"];
  const sig = headers[opts.signatureHeader ?? "webhook-signature"];
  if (!id || !ts || !sig) return false;
  if (timestampFreshness(ts, opts.toleranceMs) !== "fresh") return false;
  const prefix = opts.secretPrefix ?? "whsec_";
  const raw = secret.startsWith(prefix) ? secret.slice(prefix.length) : secret;
  const keys: Array<string | Buffer> = [Buffer.from(raw, "base64"), raw];
  const expected = keys.map((k) => digest("sha256", k, `${id}.${ts}.${rawBody}`, "base64"));
  for (const part of sig.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    if (expected.some((e) => safeEqual(value, e))) return true;
  }
  return false;
}

/**
 * One header of `key=value` pairs carrying a timestamp and one or more
 * signatures (Stripe `t=,v1=`; Paddle `ts=;h1=`; OnceHub `t=,s=`). The
 * caller states how the signed message is built from the timestamp and body.
 */
export function timestampedHmacVerify(
  input: VerifyInput,
  opts: {
    header: string;
    pairSeparator?: string;
    kvSeparator?: string;
    timestampKey: string;
    signatureKey: string;
    message: (timestamp: string, rawBody: string) => string;
    encoding?: Enc;
    algorithm?: Algo;
    toleranceMs?: number;
  },
): boolean {
  const { rawBody, headers, secret } = input;
  if (!secret) return false;
  const header = headers[opts.header];
  if (!header) return false;
  const kv = opts.kvSeparator ?? "=";
  let ts: string | null = null;
  const sigs: string[] = [];
  for (const part of header.split(opts.pairSeparator ?? ",")) {
    const i = part.indexOf(kv);
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + kv.length).trim();
    if (k === opts.timestampKey) ts = v;
    else if (k === opts.signatureKey && v) sigs.push(v);
  }
  if (!ts || sigs.length === 0) return false;
  if (timestampFreshness(ts, opts.toleranceMs) !== "fresh") return false;
  const expected = digest(opts.algorithm ?? "sha256", secret, opts.message(ts, rawBody), opts.encoding ?? "hex");
  return sigs.some((s) => safeEqual(s, expected));
}

/** One header = HMAC over the raw body (Cal.com hex; Typeform `sha256=` base64; Thinkific base64; Attio hex). */
export function hmacHeaderVerify(
  input: VerifyInput,
  opts: { header: string; encoding: Enc; prefix?: string; algorithm?: Algo; message?: (rawBody: string) => string },
): boolean {
  const { rawBody, headers, secret } = input;
  if (!secret) return false;
  const provided = headers[opts.header];
  if (!provided) return false;
  const value = opts.prefix && provided.startsWith(opts.prefix) ? provided.slice(opts.prefix.length) : provided;
  const expected = digest(opts.algorithm ?? "sha256", secret, (opts.message ?? ((b) => b))(rawBody), opts.encoding);
  return safeEqual(value, expected);
}

/**
 * A bare shared token — in a header, or extracted from the body by the
 * caller. No integrity over the body, so weaker than an HMAC; still fails
 * closed without a secret and compares in constant time.
 */
export function sharedTokenVerify(input: VerifyInput, opts: { header?: string; token?: string | null }): boolean {
  const { headers, secret } = input;
  if (!secret) return false;
  const provided = opts.token ?? (opts.header ? headers[opts.header] : undefined);
  if (!provided) return false;
  return safeEqual(provided, secret);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/kit-verify.test.ts && pnpm typecheck`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/connectors/kit/verify.ts tests/kit-verify.test.ts
git commit -m "Give new connectors every webhook signature scheme, each failing closed

Standard Webhooks, timestamped key=value headers, one-header HMAC over the
body, and a bare shared token. Timestamps must be fresh, secrets must exist,
comparisons are constant-time.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `kit/http.ts`, `kit/ids.ts`, `kit/dates.ts`, the barrel, and the orphan allowlist

**Files:**
- Create: `src/connectors/kit/http.ts`, `src/connectors/kit/ids.ts`, `src/connectors/kit/dates.ts`, `src/connectors/kit/index.ts`
- Modify: `scripts/check-orphans.ts` (ALLOWLIST)
- Test: `tests/kit-http.test.ts`, `tests/kit-ids-dates.test.ts`

**Interfaces:**
- Consumes: `fetchJson`, `HttpError`, `parseRateLimit`, `basicAuth`, `FetchJsonOptions`, `ObservedRateLimit` from `src/lib/http-client.ts`; `hashId` from `src/lib/ids.ts`; `parseDate`, `str` from `src/connectors/field-utils.ts`.
- Produces: `providerClient(o: ClientOpts): ProviderClient`, `bearerClient(baseUrl, token, provider, extraHeaders?)`, `basicClient(baseUrl, username, password, provider, extraHeaders?)`, `headerKeyClient(baseUrl, header, key, provider, extraHeaders?)`, `requireCredential(credentials, field, provider): string`; `eventId(source, connectionId, ...parts): string`, `naturalOrHash(source, connectionId, natural, payload): string`; `epochToDate(v, unit?)`, `ymd(d)`, `isoOrNull(v)`; `ProviderClient = { get, post, del, rateLimit(), calls() }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/kit-http.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { bearerClient, basicClient, headerKeyClient, requireCredential } from "@/connectors/kit/http";
import { HttpError } from "@/lib/http-client";

afterEach(() => vi.unstubAllGlobals());

function stub(status = 200, body: unknown = { ok: true }, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Nope",
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

describe("provider clients", () => {
  it("bearer: joins base and path, encodes params, drops nullish params, sends the header", async () => {
    const calls = stub();
    const c = bearerClient("https://api.example.com/v2/", "tok", "example");
    await c.get("/bookings", { after: "2026-01-01", limit: 50, skip: undefined, nothing: null });
    expect(calls[0].url).toBe("https://api.example.com/v2/bookings?after=2026-01-01&limit=50");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(c.calls()).toBe(1);
  });
  it("basic and header-key clients send their credential", async () => {
    const calls = stub();
    await basicClient("https://api.example.com", "user", "pass", "example").get("x");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    await headerKeyClient("https://api.example.com", "api-key", "k1", "example").get("x");
    expect((calls[1].init.headers as Record<string, string>)["api-key"]).toBe("k1");
  });
  it("post sends JSON with a content-type", async () => {
    const calls = stub();
    await bearerClient("https://api.example.com", "t", "example").post("/webhooks", { url: "https://x" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"url":"https://x"}');
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
  it("captures the provider's rate-limit headers", async () => {
    stub(200, {}, { "x-ratelimit-limit": "120", "x-ratelimit-remaining": "7", "x-ratelimit-reset": "30" });
    const c = bearerClient("https://api.example.com", "t", "example");
    expect(c.rateLimit()).toBeNull();
    await c.get("x");
    expect(c.rateLimit()).toEqual({ limit: 120, remaining: 7, resetSeconds: 30 });
  });
  it("turns a 401 into a reconnect hint and leaves other errors as HttpError", async () => {
    stub(401, { error: "bad key" });
    await expect(bearerClient("https://api.example.com", "t", "Example").get("x")).rejects.toThrow(
      "Example rejected this credential — open the connection and reconnect.",
    );
    stub(500, {});
    await expect(bearerClient("https://api.example.com", "t", "Example", {}, { retries: 0 }).get("x")).rejects.toBeInstanceOf(HttpError);
  });
  it("requireCredential trims a present field and names the missing one", () => {
    expect(requireCredential({ apiKey: " k " }, "apiKey", "Example")).toBe("k");
    expect(() => requireCredential({}, "apiKey", "Example")).toThrow("Example: this connection has no apiKey — open it and reconnect.");
  });
});
```

```ts
// tests/kit-ids-dates.test.ts
import { describe, it, expect } from "vitest";
import { eventId, naturalOrHash } from "@/connectors/kit/ids";
import { epochToDate, ymd, isoOrNull } from "@/connectors/kit/dates";
import { hashId } from "@/lib/ids";

describe("ids", () => {
  it("namespaces by source and connection, and hashes when there is no natural id", () => {
    expect(eventId("stripe", "c1", "evt_1")).toBe("stripe:c1:evt_1");
    expect(eventId("stripe", "c1", "refund", 42)).toBe("stripe:c1:refund:42");
    expect(naturalOrHash("stripe", "c1", "evt_1", {})).toBe("stripe:c1:evt_1");
    expect(naturalOrHash("stripe", "c1", null, { a: 1 })).toBe(hashId("stripe:c1", { a: 1 }));
  });
});
describe("dates", () => {
  it("epochToDate reads seconds, milliseconds, strings, and refuses junk", () => {
    expect(epochToDate(1_700_000_000, "s")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate(1_700_000_000_000, "ms")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate("1700000000")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate(1_700_000_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate("soon")).toBeNull();
    expect(epochToDate(null)).toBeNull();
  });
  it("ymd and isoOrNull", () => {
    expect(ymd(new Date("2026-09-07T23:59:59Z"))).toBe("2026-09-07");
    expect(isoOrNull("2026-09-07T10:00:00+02:00")).toBe("2026-09-07T08:00:00.000Z");
    expect(isoOrNull("nope")).toBeNull();
    expect(isoOrNull(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/kit-http.test.ts tests/kit-ids-dates.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/connectors/kit/http.ts
import { basicAuth, fetchJson, HttpError, parseRateLimit, type FetchJsonOptions, type ObservedRateLimit } from "@/lib/http-client";

export type Params = Record<string, string | number | boolean | null | undefined>;

export type ProviderClient = {
  get<T = unknown>(path: string, params?: Params): Promise<T>;
  post<T = unknown>(path: string, body: unknown, params?: Params): Promise<T>;
  del<T = unknown>(path: string, params?: Params): Promise<T>;
  /** The provider's own remaining-budget headers, from the last response that carried any. */
  rateLimit(): ObservedRateLimit | null;
  /** Requests made through this client — a poll reports it as `providerCalls`. */
  calls(): number;
};

export type ClientOpts = {
  baseUrl: string;
  headers: Record<string, string>;
  /** Display name used in the reconnect hint. */
  provider: string;
  reconnectHint?: string;
  fetchOptions?: Omit<FetchJsonOptions, "headers" | "method" | "body" | "onResponse">;
};

export function providerClient(o: ClientOpts): ProviderClient {
  let calls = 0;
  let observed: ObservedRateLimit | null = null;
  const url = (path: string, params?: Params): string => {
    const u = /^https?:\/\//.test(path) ? new URL(path) : new URL(`${o.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) u.searchParams.set(k, String(v));
    return u.toString();
  };
  const run = async <T,>(method: string, path: string, params?: Params, body?: unknown): Promise<T> => {
    calls += 1;
    try {
      return await fetchJson<T>(url(path, params), {
        ...o.fetchOptions,
        method,
        headers: { ...o.headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        onResponse: (res) => {
          observed = parseRateLimit(res.headers) ?? observed;
        },
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        throw new Error(o.reconnectHint ?? `${o.provider} rejected this credential — open the connection and reconnect.`);
      }
      throw e;
    }
  };
  return {
    get: (path, params) => run("GET", path, params),
    post: (path, body, params) => run("POST", path, params, body),
    del: (path, params) => run("DELETE", path, params),
    rateLimit: () => observed,
    calls: () => calls,
  };
}

export function bearerClient(baseUrl: string, token: string, provider: string, extraHeaders: Record<string, string> = {}, fetchOptions?: ClientOpts["fetchOptions"]): ProviderClient {
  return providerClient({ baseUrl, provider, headers: { authorization: `Bearer ${token}`, ...extraHeaders }, fetchOptions });
}
export function basicClient(baseUrl: string, username: string, password: string, provider: string, extraHeaders: Record<string, string> = {}, fetchOptions?: ClientOpts["fetchOptions"]): ProviderClient {
  return providerClient({ baseUrl, provider, headers: { authorization: basicAuth(username, password), ...extraHeaders }, fetchOptions });
}
export function headerKeyClient(baseUrl: string, header: string, key: string, provider: string, extraHeaders: Record<string, string> = {}, fetchOptions?: ClientOpts["fetchOptions"]): ProviderClient {
  return providerClient({ baseUrl, provider, headers: { [header]: key, ...extraHeaders }, fetchOptions });
}

/** A credential field that must be present — the message names the field and the fix. */
export function requireCredential(credentials: Record<string, unknown> | null | undefined, field: string, provider: string): string {
  const v = credentials?.[field];
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new Error(`${provider}: this connection has no ${field} — open it and reconnect.`);
}
```

```ts
// src/connectors/kit/ids.ts
import { hashId } from "@/lib/ids";

/** `source:connectionId:part:part` — the namespace every connector's dedup key carries. */
export function eventId(source: string, connectionId: string, ...parts: Array<string | number>): string {
  return `${source}:${connectionId}:${parts.join(":")}`;
}

/** The provider's own id when it has one; a stable hash of the payload when it does not. */
export function naturalOrHash(source: string, connectionId: string, natural: string | null | undefined, payload: unknown): string {
  return natural ? eventId(source, connectionId, natural) : hashId(`${source}:${connectionId}`, payload);
}
```

```ts
// src/connectors/kit/dates.ts
export { parseDate } from "../field-utils";

/** Epoch seconds or milliseconds (or a numeric string) to a Date; "auto" reads > 1e12 as ms. */
export function epochToDate(v: unknown, unit: "s" | "ms" | "auto" = "auto"): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const ms = unit === "ms" ? n : unit === "s" ? n * 1000 : n > 1e12 ? n : n * 1000;
  return new Date(ms);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Any string Date.parse accepts, normalised to ISO; null otherwise. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
```

```ts
// src/connectors/kit/index.ts
export * from "./walk";
export * from "./verify";
export * from "./http";
export * from "./ids";
export * from "./dates";
```

Then in `scripts/check-orphans.ts`, inside `ALLOWLIST`, add (one entry per kit export — a barrel is not a consumer):

```ts
  // Connector kit (docs/superpowers/specs/2026-09-07-connector-kit-and-first-twenty-design.md).
  // Written before its consumers on purpose: the first connectors built on it
  // land in docs/superpowers/plans/2026-09-07-connectors-batch-1.md, and each
  // task there DELETES the entry for the helper it consumes. Added 7 Sep 2026.
  windowedWalk: "connector kit — first consumer: Stripe (connectors batch 1)",
  parseWalkCursor: "connector kit — first consumer: Stripe (connectors batch 1)",
  serializeWalkCursor: "connector kit — first consumer: Stripe (connectors batch 1)",
  walkImportProgress: "connector kit — first consumer: Stripe (connectors batch 1)",
  standardWebhooksVerify: "connector kit — first consumer: Retell (connectors batch 1)",
  timestampedHmacVerify: "connector kit — first consumer: Stripe (connectors batch 1)",
  hmacHeaderVerify: "connector kit — first consumer: Cal.com (connectors batch 1)",
  sharedTokenVerify: "connector kit — first consumer: Lemlist (connectors batch 1)",
  providerClient: "connector kit — first consumer: Stripe, through bearerClient (connectors batch 1)",
  bearerClient: "connector kit — first consumer: Stripe (connectors batch 1)",
  basicClient: "connector kit — first consumer: Aircall (connectors batch 1)",
  headerKeyClient: "connector kit — first consumer: OnceHub (connectors batch 1)",
  requireCredential: "connector kit — first consumer: Stripe (connectors batch 1)",
  eventId: "connector kit — first consumer: Stripe (connectors batch 1)",
  naturalOrHash: "connector kit — first consumer: Typeform (connectors batch 1)",
  epochToDate: "connector kit — first consumer: Stripe (connectors batch 1)",
  ymd: "connector kit — first consumer: Typeform (connectors batch 1)",
  isoOrNull: "connector kit — first consumer: Cal.com (connectors batch 1)",
```

- [ ] **Step 4: Run the tests and the orphan check**

Run: `pnpm vitest run tests/kit-http.test.ts tests/kit-ids-dates.test.ts && pnpm typecheck && pnpm check:orphans`
Expected: PASS; the orphan check lists the kit exports under "Allowlisted" and exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/kit tests/kit-http.test.ts tests/kit-ids-dates.test.ts scripts/check-orphans.ts
git commit -m "Finish the connector kit: a provider client, id and date helpers

The client joins URLs, encodes params, captures rate-limit headers and turns
a 401 into a reconnect hint that names the provider. Kit exports are
allowlisted in the orphan check with a dated reason; the connectors plan
removes each entry as its first consumer lands.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: catalog fields (`brand`, `docs`, `verified`, `connect: "oauth"`, `oauthProvider`) and `sourceStyle` from the catalog

**Files:**
- Modify: `src/connectors/catalog.ts` (types near line 60–226; the seven entries), `src/components/flow/controls/source-style.ts`, `scripts/check-ui.ts` (hex-literal `allow`)
- Test: `tests/source-style.test.ts`

**Interfaces:**
- Produces: `ConnectorBrand = { color: string; short: string; label?: string }`, `ConnectorDocs = { url: string; readOn: string; webhooks?: string }`, `ConnectorVerification = { live: string | null }`; `ConnectorCatalogEntry.connect: "apiKey" | "google" | "oauth"`, optional `oauthProvider`, `brand`, `docs`, `verified`; `sourceStyle(source)` unchanged in signature, now catalog-backed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/source-style.test.ts
import { describe, it, expect } from "vitest";
import { sourceStyle } from "@/components/flow/controls/source-style";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/** The map as it stood before brand moved into the catalog — byte-for-byte. */
const BEFORE: Record<string, { label: string; color: string; short: string }> = {
  calendly: { label: "Calendly", color: "#006BFF", short: "Ca" },
  close: { label: "Close", color: "#1E88E5", short: "Cl" },
  instantly: { label: "Instantly", color: "#7C3AED", short: "In" },
  whop: { label: "Whop", color: "#FF6243", short: "Wh" },
  gsheets: { label: "Google Sheets", color: "#0F9D58", short: "Sh" },
  gcal: { label: "Google Calendar", color: "#4285F4", short: "GC" },
  webhook: { label: "Webhook", color: "#64748B", short: "Wh" },
};

describe("sourceStyle reads the catalog", () => {
  it("renders every existing connector exactly as before", () => {
    for (const [source, want] of Object.entries(BEFORE)) expect(sourceStyle(source), source).toEqual(want);
  });
  it("every catalog entry declares a brand", () => {
    for (const e of CONNECTOR_CATALOG) {
      expect(e.brand, e.source).toBeDefined();
      expect(e.brand!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(e.brand!.short.length).toBeGreaterThanOrEqual(1);
      expect(e.brand!.short.length).toBeLessThanOrEqual(2);
    }
  });
  it("falls back to a neutral badge for an unknown or missing source", () => {
    expect(sourceStyle("zzz")).toEqual({ label: "zzz", color: "#64748B", short: "Zz" });
    expect(sourceStyle(null)).toEqual({ label: "App", color: "#64748B", short: "Ap" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/source-style.test.ts`
Expected: FAIL — `e.brand` undefined.

- [ ] **Step 3: Add the types and fields**

In `src/connectors/catalog.ts`, directly above `export type ConnectorCatalogEntry = {`:

```ts
/**
 * The connector's brand tile: the vendor's colour and a one-or-two letter
 * mark. Lives here, not in the builder, so one entry is the whole
 * registration; `sourceStyle` reads it. `label` overrides the display name
 * only where the mark's tooltip has always said something shorter than the
 * catalog name ("Close", "Webhook").
 */
export type ConnectorBrand = { color: string; short: string; label?: string };

/**
 * Where the facts in this entry came from and when they were read. Every
 * rate limit, endpoint and field name a connector relies on is a claim about
 * a provider, and a claim with a date can be re-checked; one without a date
 * is folklore. Required by tests for every entry added after the kit.
 */
export type ConnectorDocs = { url: string; readOn: string; webhooks?: string };

/** `live` is the date the connector's prober last ran against the real API, or null: unprobed. */
export type ConnectorVerification = { live: string | null };
```

Inside `ConnectorCatalogEntry`, replace `connect: "apiKey" | "google";` with:

```ts
  /** How the user connects: paste a key, Google's flow, or another provider's OAuth (see `oauthProvider`). */
  connect: "apiKey" | "google" | "oauth";
  /** The `OAUTH_PROVIDERS` key when `connect` is "oauth". */
  oauthProvider?: string;
  brand?: ConnectorBrand;
  docs?: ConnectorDocs;
  verified?: ConnectorVerification;
```

Then add `brand` to each of the seven entries, right after `description:`:

```ts
// calendly
    brand: { color: "#006BFF", short: "Ca" },
// close
    brand: { color: "#1E88E5", short: "Cl", label: "Close" },
// instantly
    brand: { color: "#7C3AED", short: "In" },
// whop
    brand: { color: "#FF6243", short: "Wh" },
// gsheets
    brand: { color: "#0F9D58", short: "Sh" },
// gcal
    brand: { color: "#4285F4", short: "GC" },
// webhook
    brand: { color: "#64748B", short: "Wh", label: "Webhook" },
```

Replace the body of `src/components/flow/controls/source-style.ts` with:

```ts
import { catalogEntry } from "@/connectors/catalog";

/**
 * Brand styling for data sources, used by the rebuilt control system (pills,
 * data browser, node cards). The colours live on the catalog entry now, so a
 * new connector registers its mark in the same place as everything else;
 * unknown sources fall back to a neutral badge derived from the key.
 */
export type SourceStyle = { label: string; color: string; short: string };

export function sourceStyle(source?: string | null): SourceStyle {
  const entry = source ? catalogEntry(source) : undefined;
  if (entry?.brand) return { label: entry.brand.label ?? entry.name, color: entry.brand.color, short: entry.brand.short };
  const key = (source ?? "").trim();
  return { label: key || "App", color: "#64748B", short: (key || "ap").slice(0, 2).replace(/^\w/, (c) => c.toUpperCase()) };
}
```

In `scripts/check-ui.ts`, in the `"hex literal"` rule's `allow` map, add:

```ts
      "src/connectors/catalog.ts": "connector brand colours are the vendors', not ours — the same exception source-style.ts had before brand moved here",
```

- [ ] **Step 4: Run the tests, the UI check and the typecheck**

Run: `pnpm vitest run tests/source-style.test.ts tests/event-type-labels.test.ts tests/budget-operations.test.ts && pnpm typecheck && pnpm check:ui`
Expected: PASS; `check:ui` clean.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/catalog.ts src/components/flow/controls/source-style.ts scripts/check-ui.ts tests/source-style.test.ts
git commit -m "Move a connector's brand into its catalog entry, and make room for provenance

One entry is now the whole registration: colour and mark next to name and
description. New fields for where the facts came from (docs), whether a live
prober has run (verified), and a provider-agnostic OAuth connect.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: connector hooks — `importProgress` and `retention` replace the Close branches

**Files:**
- Modify: `src/connectors/types.ts` (Connector interface, after `holdsContinuation`), `src/connectors/close.ts` (connector object, after `holdsContinuation: holdsWindowContinuation,`), `src/lib/sync/import-status.ts:1-8,135`, `src/lib/health/invariants.ts:5,115,296-323,372,388,401`
- Test: `tests/connector-hooks.test.ts` (new), `tests/invariant-scan.test.ts:318-362` (rename `closeCursorLag` → `cursorLag`)

**Interfaces:**
- Produces on `Connector`: `importProgress?(cursor: string | null, now?: number): ImportCoverage | null;` and `retention?: { days: number; alarmAfterDays: number; watermarkOf: (cursor: string | null) => string | null };`
- `InvariantReport.cursorLag: Array<{ source: string; connectionId: string; hw: string; ageDays: number }>` replaces `closeCursorLag`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connector-hooks.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, syncState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { registerConnector, getConnector } from "@/connectors/registry";
import { closeConnector, closeImportProgress } from "@/connectors/close";
import { connectionImportStatuses } from "@/lib/sync/import-status";
import { scanInvariants } from "@/lib/health/invariants";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

const DAY = 86_400_000;
let db: DB;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("import progress comes from the connector, not from its name", () => {
  it("Close declares its own progress reader", () => {
    expect(closeConnector.importProgress).toBe(closeImportProgress);
  });
  it("a connection-scoped connector that declares importProgress drives the Importing state", async () => {
    const stub: Connector = {
      source: "hook-stub",
      authType: "apiKey",
      verifySignature: () => false,
      poll: async () => ({ records: [], nextCursor: null }),
      importProgress: (cursor) => (cursor === "walking" ? { coveredMs: 2 * DAY, targetMs: 10 * DAY } : null),
    };
    registerConnector(stub);
    const id = await seedConnection(db, { source: "hook-stub" });
    await db.insert(syncState).values({ connectionId: id, cursor: "walking" });
    const statuses = await connectionImportStatuses(db, [(await db.select().from(connections).where(eq(connections.id, id)))[0]]);
    expect(statuses.get(id)?.state).toBe("importing");
    expect(statuses.get(id)?.coverage).toEqual({ coveredMs: 2 * DAY, targetMs: 10 * DAY });
  });
});

describe("cursor lag is declared per connector as retention", () => {
  it("Close declares 30 days with a 25-day alarm and reads its own watermark", () => {
    expect(closeConnector.retention?.days).toBe(30);
    expect(closeConnector.retention?.alarmAfterDays).toBe(25);
    expect(closeConnector.retention?.watermarkOf("2026-08-01T00:00:00Z")).toBe("2026-08-01T00:00:00Z");
    expect(closeConnector.retention?.watermarkOf(JSON.stringify({ hw: "2026-08-02T00:00:00Z", cont: "t" }))).toBe("2026-08-02T00:00:00Z");
  });
  it("any connector with retention is scanned, carrying its source in the finding", async () => {
    const stub: Connector = {
      source: "retention-stub",
      authType: "apiKey",
      verifySignature: () => false,
      poll: async () => ({ records: [], nextCursor: null }),
      retention: { days: 10, alarmAfterDays: 7, watermarkOf: (c) => c },
    };
    registerConnector(stub);
    const id = await seedConnection(db, { source: "retention-stub" });
    await db.insert(syncState).values({ connectionId: id, cursor: new Date(Date.now() - 8 * DAY).toISOString() });
    const report = await scanInvariants(db);
    expect(report.cursorLag).toEqual([{ source: "retention-stub", connectionId: id, hw: expect.any(String), ageDays: 8 }]);
    expect(getConnector("gcal")?.retention).toBeUndefined();
  });
});
```

In `tests/invariant-scan.test.ts`, lines 335–361: replace every `report.closeCursorLag` / `.closeCursorLag` with `.cursorLag` (seven occurrences).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/connector-hooks.test.ts tests/invariant-scan.test.ts`
Expected: FAIL — `importProgress`/`retention` undefined; `cursorLag` undefined.

- [ ] **Step 3: Implement**

`src/connectors/types.ts` — inside `interface Connector`, after the `holdsContinuation?` member:

```ts
  /**
   * How much of a first import this stored cursor represents — the coverage
   * the connection page shows as "covering 12 of 30 days". Null once the
   * import has settled, or for a cursor this connector cannot read. Declared
   * here so `import-status` never has to know a source by name.
   */
  importProgress?(cursor: string | null, now?: number): ImportCoverage | null;
  /**
   * The provider FORGETS its own history after `days` (Close keeps ~30 days
   * of event log). The nightly scan alarms when a connection's watermark is
   * older than `alarmAfterDays`, because data behind the mark is about to
   * become unfetchable. `watermarkOf` reads the mark out of this connector's
   * own cursor grammar. Omit it for providers that keep everything.
   */
  retention?: { days: number; alarmAfterDays: number; watermarkOf: (cursor: string | null) => string | null };
```

`src/connectors/close.ts` — in `closeConnector`, after `holdsContinuation: holdsWindowContinuation,`:

```ts
  importProgress: closeImportProgress,
  retention: { days: 30, alarmAfterDays: 25, watermarkOf: (cursor) => parseCloseCursor(cursor).hw },
```

Update the comment above `parseCloseCursor` (line 173) from "`closeCursorLag`" to "`cursorLag`".

`src/lib/sync/import-status.ts` — delete `import { closeImportProgress } from "@/connectors/close";`, add `import { getConnector } from "@/connectors/registry";`, and change line 135 to:

```ts
      const coverage = getConnector(c.source)?.importProgress?.(raw) ?? null;
```

`src/lib/health/invariants.ts` — delete `import { parseCloseCursor } from "@/connectors/close";`, add `import { getConnector } from "@/connectors/registry";`. Replace the `closeCursorLag` field in `InvariantReport` (line 115) with:

```ts
  cursorLag: Array<{ source: string; connectionId: string; hw: string; ageDays: number }>;
```

Replace `CLOSE_HW_LAG_MS` and the whole `closeCursorLag` function (lines 296–324) with:

```ts
/**
 * A connection whose watermark has fallen too far behind for a provider that
 * FORGETS its history. Which providers, and how far, is the connector's to
 * say (`Connector.retention`); this only walks the ones that said so.
 */
async function cursorLag(db: DB, now: Date) {
  const rows = await db
    .select({ connectionId: connections.id, source: connections.source, cursor: syncState.cursor })
    .from(connections)
    .innerJoin(syncState, eq(syncState.connectionId, connections.id))
    .where(and(eq(connections.status, "active"), isNull(connections.disabledAt)))
    .limit(REPORT_LIMIT * 4);
  const findings: Array<{ source: string; connectionId: string; hw: string; ageDays: number }> = [];
  for (const row of rows) {
    const retention = getConnector(row.source)?.retention;
    if (!retention) continue;
    const hw = retention.watermarkOf(row.cursor);
    if (!hw) continue;
    const t = Date.parse(hw);
    if (!Number.isFinite(t)) continue;
    const ageMs = now.getTime() - t;
    if (ageMs <= retention.alarmAfterDays * 24 * HOUR_MS) continue;
    const ageDays = Math.floor(ageMs / (24 * HOUR_MS));
    console.warn(
      `[cursor-lag] source=${row.source} connection=${row.connectionId} hw=${hw} ageDays=${ageDays} — the provider keeps ${retention.days} days; data older than the mark is at risk`,
    );
    findings.push({ source: row.source, connectionId: row.connectionId, hw, ageDays });
    if (findings.length >= REPORT_LIMIT) break;
  }
  return findings;
}
```

In `scanInvariants`: `const closeLag = await closeCursorLag(db, now);` → `const lag = await cursorLag(db, now);`; `closeCursorLag: closeLag,` → `cursorLag: lag,`; `report.closeCursorLag.length > 0` → `report.cursorLag.length > 0`.

Then grep for any other consumer: `grep -rn "closeCursorLag" src tests` must return nothing.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/connector-hooks.test.ts tests/invariant-scan.test.ts tests/close-poll.test.ts && pnpm typecheck && pnpm check:orphans`
Expected: PASS. (`closeImportProgress` still has a production caller: `close.ts` itself assigns it.)

- [ ] **Step 5: Commit**

```bash
git add src/connectors/types.ts src/connectors/close.ts src/lib/sync/import-status.ts src/lib/health/invariants.ts tests/connector-hooks.test.ts tests/invariant-scan.test.ts
git commit -m "Let a connector declare its import progress and its provider's retention

import-status and the nightly scan asked 'is this Close?' where they should
have asked the connector. Close now declares both; the next connector that
forgets its history declares the same two things and is scanned for free.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: population tests replace the rosters

**Files:**
- Modify: `tests/connectors-signatures.test.ts:198-224`, `tests/held-continuation.test.ts:155-185`
- Create: `tests/connector-population.test.ts`

**Interfaces:**
- Consumes: `CONNECTOR_CATALOG`, `catalogEntry` from catalog; `getConnector` from registry; `OAUTH_PROVIDERS` from `src/lib/oauth/providers.ts` — created in Task 7. Write this test's OAuth assertion so it passes today (no entry has `connect: "oauth"` yet) and gains teeth once Task 7 lands: import `oauthProvider` lazily inside the `it` via `await import("@/lib/oauth/providers")` guarded by a try — no. Keep it simple: this task asserts `connect === "oauth" ⇒ typeof oauthProvider === "string"`; Task 7 tightens it to a registered provider.

- [ ] **Step 1: Rewrite the two rosters and write the population test**

`tests/connectors-signatures.test.ts` — add `import { CONNECTOR_CATALOG } from "@/connectors/catalog";` and `import { getConnector } from "@/connectors/registry";`. Replace the body of `it("only the catch-hook, whose open endpoint IS the product", …)` (keep its doc comment) with:

```ts
    const open = CONNECTOR_CATALOG.map((e) => {
      const c = getConnector(e.source);
      expect(c, `${e.source} is in the catalog but not the registry`).toBeDefined();
      return [e.source, c!] as const;
    })
      .filter(([, c]) => c.verifySignature(unsigned))
      .map(([name]) => name);
    expect(open).toEqual(["webhook"]);
```

The six now-unused connector imports at the top of that file are still used by the earlier describes (Calendly, Close, Instantly, catch-hook); remove only `googleSheetsConnector` and `googleCalendarConnector` if nothing else in the file references them.

`tests/held-continuation.test.ts` — keep the three existing `it`s (lines 155–185) and add after them:

```ts
  it("every registered connector either declares none, or answers false for null and for a bare mark", () => {
    for (const e of CONNECTOR_CATALOG) {
      const c = getConnector(e.source);
      expect(c, e.source).toBeDefined();
      if (!c!.holdsContinuation) continue;
      expect(c!.holdsContinuation(null), e.source).toBe(false);
      expect(c!.holdsContinuation("2026-08-03T10:00:00Z"), e.source).toBe(false);
      expect(c!.holdsContinuation("{not json"), e.source).toBe(false);
    }
  });
```

with `import { CONNECTOR_CATALOG } from "@/connectors/catalog";` and `getConnector` added to the registry import.

```ts
// tests/connector-population.test.ts
import { describe, it, expect } from "vitest";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

/** The seven that predate the kit; everything after them must carry provenance. */
const LEGACY = new Set(["calendly", "close", "instantly", "whop", "gsheets", "gcal", "webhook"]);
const unsigned = { rawBody: "{}", headers: {}, secret: null };

describe("every catalog entry and every registered connector agree", () => {
  it("the catalog and the registry name the same sources", () => {
    for (const e of CONNECTOR_CATALOG) expect(getConnector(e.source), `${e.source}: registered`).toBeDefined();
  });
  it("sources are unique, lowercase, and URL-safe", () => {
    const seen = new Set<string>();
    for (const e of CONNECTOR_CATALOG) {
      expect(e.source).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(seen.has(e.source), `${e.source} declared twice`).toBe(false);
      seen.add(e.source);
    }
  });
  it("authType agrees with how the user connects", () => {
    for (const e of CONNECTOR_CATALOG) {
      const c = getConnector(e.source)!;
      if (e.connect === "google" || e.connect === "oauth") expect(c.authType, e.source).toBe("oauth2");
      else expect(["apiKey", "secret"], e.source).toContain(c.authType);
      if (e.connect === "oauth") expect(typeof e.oauthProvider, `${e.source}: oauthProvider`).toBe("string");
    }
  });
  it("capabilities the entry advertises exist on the connector", () => {
    for (const e of CONNECTOR_CATALOG) {
      const c = getConnector(e.source)!;
      if (e.poll) expect(typeof c.poll, `${e.source}: poll`).toBe("function");
      if (e.autoWebhook) expect(typeof c.registerWebhook, `${e.source}: registerWebhook`).toBe("function");
      if (e.flowFields?.some((f) => f.dynamic)) expect(typeof c.listOptions, `${e.source}: listOptions`).toBe("function");
      if (e.instant && e.source !== "webhook") {
        expect(c.verifySignature(unsigned), `${e.source} accepts an unsigned request`).toBe(false);
        expect(typeof c.normalize === "function" || e.poll, `${e.source}: instant needs normalize or a poll doorbell`).toBeTruthy();
      }
    }
  });
  it("every entry carries a brand, and every post-kit entry carries dated provenance", () => {
    for (const e of CONNECTOR_CATALOG) {
      expect(e.brand, `${e.source}: brand`).toBeDefined();
      if (LEGACY.has(e.source)) continue;
      expect(e.docs?.url, `${e.source}: docs.url`).toMatch(/^https:\/\//);
      expect(e.docs?.readOn, `${e.source}: docs.readOn`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.verified, `${e.source}: verified`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run the three files**

Run: `pnpm vitest run tests/connectors-signatures.test.ts tests/held-continuation.test.ts tests/connector-population.test.ts`
Expected: PASS (the population test passes against the seven; it will fail loudly for any future entry missing brand/docs).

- [ ] **Step 3: Sabotage check** — temporarily change `gsheets`'s `verifySignature` to `return true` when `!secret`; run `tests/connectors-signatures.test.ts` and `tests/connector-population.test.ts`; both must FAIL naming `gsheets`. Revert.

- [ ] **Step 4: Commit**

```bash
git add tests/connectors-signatures.test.ts tests/held-continuation.test.ts tests/connector-population.test.ts
git commit -m "Test the population, not a roster

The unsigned-request and held-continuation checks now walk the catalog, and a
new population test ties catalog to registry, capabilities to methods, and
provenance to every entry added after the kit. A connector nobody listed is
the one that fails open.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: generic OAuth — providers, flow, routes, state, credentials

**Files:**
- Create: `src/lib/oauth/providers.ts`, `src/lib/oauth/flow.ts`, `src/app/api/oauth/[provider]/start/route.ts`, `src/app/api/oauth/[provider]/callback/route.ts`
- Delete: `src/lib/google-oauth.ts`, `src/app/api/oauth/google/start/route.ts`, `src/app/api/oauth/google/callback/route.ts`
- Modify: `src/lib/oauth-state.ts`, `src/lib/credentials.ts:4,29-33,50-52`, `src/app/integrations/page.tsx:128`, `src/app/integrations/error-messages.ts` (add `oauth_unknown`), `tests/oauth-state.test.ts`, `tests/integrations-errors.test.ts:5-8`, `tests/connector-population.test.ts` (tighten the oauth assertion)
- Test: `tests/oauth-providers.test.ts`, `tests/oauth-route.test.ts`

**Interfaces:**
- Produces: `OAuthProvider`, `OAuthTokens`, `OAUTH_PROVIDERS`, `oauthProvider(key)`, `oauthProviderFor(source)`; `buildAuthUrl(p, { source, state })`, `exchangeCode(p, code)`, `refreshTokens(p, refreshToken)`, `redirectUriFor(p)`; `createOAuthState({ provider, source })`, `parseOAuthState(state) → { nonce, provider, source }`, `isValidOAuthState(state, cookieNonce)`, `OAUTH_STATE_COOKIE`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/oauth-providers.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { OAUTH_PROVIDERS, oauthProviderFor } from "@/lib/oauth/providers";
import { buildAuthUrl, redirectUriFor } from "@/lib/oauth/flow";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.APP_BASE_URL = "https://app.example.com";
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe("the Google provider reproduces the retired google-oauth.ts byte for byte", () => {
  const google = OAUTH_PROVIDERS.google;
  it("resolves for both Google sources and for nothing else", () => {
    expect(oauthProviderFor("gsheets")).toBe(google);
    expect(oauthProviderFor("gcal")).toBe(google);
    expect(oauthProviderFor("close")).toBeUndefined();
    expect(oauthProviderFor("nope")).toBeUndefined();
  });
  it("keeps the registered redirect URI", () => {
    expect(redirectUriFor(google)).toBe("https://app.example.com/api/oauth/google/callback");
    process.env.GOOGLE_REDIRECT_URI = "https://x/cb";
    expect(redirectUriFor(google)).toBe("https://x/cb");
    delete process.env.GOOGLE_REDIRECT_URI;
  });
  it("builds the exact authorize URL the old builder produced (params, order, scopes)", () => {
    const state = "abc";
    expect(buildAuthUrl(google, { source: "gsheets", state })).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: "cid",
          redirect_uri: "https://app.example.com/api/oauth/google/callback",
          response_type: "code",
          scope: "openid email https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
          access_type: "offline",
          include_granted_scopes: "true",
          prompt: "consent select_account",
          state,
        }).toString(),
    );
    expect(buildAuthUrl(google, { source: "gcal", state })).toContain("scope=openid+email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly&");
  });
  it("refuses to build without a client id", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => buildAuthUrl(google, { source: "gcal", state: "s" })).toThrow("GOOGLE_CLIENT_ID is not set");
    process.env.GOOGLE_CLIENT_ID = "cid";
  });
});
```

```ts
// tests/oauth-route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { registerConnector } from "@/connectors/registry";
import { OAUTH_PROVIDERS } from "@/lib/oauth/providers";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;
let cookie: string | undefined;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));
vi.mock("@/lib/auth", () => ({ getOrgContext: async () => ({ orgId: "org_oauth", userId: "u1" }) }));
vi.mock("@/lib/permissions", () => ({ effectiveAccess: async () => ({ can: () => true }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (k === OAUTH_STATE_COOKIE && cookie ? { value: cookie } : undefined) }) }));

// A second provider, so the route is proven generic rather than Google-shaped.
OAUTH_PROVIDERS.acme = {
  key: "acme", name: "Acme", authorizeUrl: "https://acme.test/authorize", tokenUrl: "https://acme.test/token",
  clientIdEnv: "ACME_CLIENT_ID", clientSecretEnv: "ACME_CLIENT_SECRET", scopesFor: () => ["read"], refresh: "standard",
};
CONNECTOR_CATALOG.push({ source: "acme", name: "Acme", description: "t", connect: "oauth", oauthProvider: "acme", instant: false, poll: true, autoWebhook: false, credentialFields: [] });
registerConnector({ source: "acme", authType: "oauth2", verifySignature: () => false, poll: async () => ({ records: [], nextCursor: null }) });

const { GET: start } = await import("@/app/api/oauth/[provider]/start/route");
const { GET: callback } = await import("@/app/api/oauth/[provider]/callback/route");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.ACME_CLIENT_ID = "id";
  process.env.ACME_CLIENT_SECRET = "secret";
  process.env.APP_BASE_URL = "https://app.test";
});
afterEach(async () => {
  await close();
  vi.unstubAllGlobals();
});

describe("/api/oauth/[provider]", () => {
  it("start redirects to the provider's authorize URL with a state cookie", async () => {
    const res = await start(new Request("https://app.test/api/oauth/acme/start?source=acme"), { params: Promise.resolve({ provider: "acme" }) });
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://acme.test/authorize");
    expect(loc.searchParams.get("scope")).toBe("read");
    expect(res.headers.get("set-cookie")).toContain(OAUTH_STATE_COOKIE);
  });
  it("start refuses an unknown provider and a source that does not belong to the provider", async () => {
    const a = await start(new Request("https://app.test/api/oauth/nope/start?source=acme"), { params: Promise.resolve({ provider: "nope" }) });
    expect(a.headers.get("location")).toContain("error=oauth_unknown");
    const b = await start(new Request("https://app.test/api/oauth/acme/start?source=gsheets"), { params: Promise.resolve({ provider: "acme" }) });
    expect(b.headers.get("location")).toContain("error=oauth_unknown");
  });
  it("callback exchanges the code and creates the connection named by the catalog entry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", headers: { get: () => null }, json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" }), text: async () => "" })));
    const { state, nonce } = createOAuthState({ provider: "acme", source: "acme" });
    cookie = nonce;
    const res = await callback(new Request(`https://app.test/api/oauth/acme/callback?code=c&state=${state}`), { params: Promise.resolve({ provider: "acme" }) });
    expect(res.headers.get("location")).toMatch(/\/connections\/[0-9a-f-]{36}$/);
    const { connections } = await import("@/db/schema");
    const [row] = await db.select().from(connections);
    expect(row.source).toBe("acme");
    expect(row.authType).toBe("oauth2");
    expect(row.name).toBe("Acme");
  });
  it("callback rejects a state whose nonce does not match the cookie", async () => {
    const { state } = createOAuthState({ provider: "acme", source: "acme" });
    cookie = "other";
    const res = await callback(new Request(`https://app.test/api/oauth/acme/callback?code=c&state=${state}`), { params: Promise.resolve({ provider: "acme" }) });
    expect(res.headers.get("location")).toContain("error=state_mismatch");
  });
});
```

Rewrite `tests/oauth-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createOAuthState, parseOAuthState, isValidOAuthState } from "@/lib/oauth-state";

describe("oauth state (CSRF protection, provider and source carried inside)", () => {
  it("round-trips a random nonce, the provider and the source", () => {
    const { state, nonce } = createOAuthState({ provider: "google", source: "gcal" });
    expect(parseOAuthState(state)).toEqual({ nonce, provider: "google", source: "gcal" });
    expect(nonce.length).toBeGreaterThan(20);
  });
  it("validates a matching nonce and rejects a mismatch, a missing cookie, and garbage", () => {
    const { state, nonce } = createOAuthState({ provider: "google", source: "gsheets" });
    expect(isValidOAuthState(state, nonce)).toBe(true);
    expect(isValidOAuthState(state, "different-nonce")).toBe(false);
    expect(isValidOAuthState(state, undefined)).toBe(false);
    expect(isValidOAuthState("not-base64-json", nonce)).toBe(false);
    expect(parseOAuthState("not-base64-json")).toEqual({ nonce: null, provider: null, source: null });
  });
  it("refuses a source the provider does not own", () => {
    const { state } = createOAuthState({ provider: "google", source: "close" });
    expect(parseOAuthState(state).source).toBeNull();
  });
});
```

In `tests/integrations-errors.test.ts` replace the two emitter paths with `"src/app/api/oauth/[provider]/callback/route.ts"` and `"src/app/api/oauth/[provider]/start/route.ts"`.

In `tests/connector-population.test.ts` change the oauth assertion to `expect(oauthProvider(e.oauthProvider), `${e.source}: registered oauthProvider`).toBeDefined();` with `import { oauthProvider } from "@/lib/oauth/providers";`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/oauth-providers.test.ts tests/oauth-route.test.ts tests/oauth-state.test.ts`
Expected: FAIL — modules not found / old signatures.

- [ ] **Step 3: Implement**

```ts
// src/lib/oauth/providers.ts
import { catalogEntry } from "@/connectors/catalog";

export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number; email?: string };

export type OAuthProvider = {
  key: string;
  /** Display name for messages: "Google access has expired…". */
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** The scopes to request for a given source (one provider can back several). */
  scopesFor: (source: string) => string[];
  /** Extra authorize-URL params, appended after `scope` and before `state`. */
  authParams?: Record<string, string>;
  /** "standard" = refresh_token grant at `tokenUrl`; "none" = tokens do not expire. */
  refresh: "standard" | "none";
  /** A label for the connection from the raw token response (Google: the id_token's email). */
  identity?: (raw: Record<string, unknown>) => string | undefined;
};

const GOOGLE_SCOPES: Record<string, string[]> = {
  gsheets: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
  gcal: ["https://www.googleapis.com/auth/calendar.readonly"],
};

function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.includes("@") ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    key: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopesFor: (source) => ["openid", "email", ...(GOOGLE_SCOPES[source] ?? [])],
    authParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent select_account" },
    refresh: "standard",
    identity: (raw) => emailFromIdToken(raw["id_token"]),
  },
};

export function oauthProvider(key: string | null | undefined): OAuthProvider | undefined {
  return key ? OAUTH_PROVIDERS[key] : undefined;
}

/** The provider a source authenticates through, from its catalog entry. */
export function oauthProviderFor(source: string | null | undefined): OAuthProvider | undefined {
  const entry = catalogEntry(source ?? "");
  if (!entry) return undefined;
  if (entry.connect === "google") return OAUTH_PROVIDERS.google;
  if (entry.connect === "oauth") return oauthProvider(entry.oauthProvider);
  return undefined;
}
```

```ts
// src/lib/oauth/flow.ts
import { fetchJson } from "@/lib/http-client";
import type { OAuthProvider, OAuthTokens } from "./providers";

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** `<KEY>_REDIRECT_URI` overrides; otherwise `${APP_BASE_URL}/api/oauth/<key>/callback` — the path Google already has registered. */
export function redirectUriFor(p: OAuthProvider): string {
  return process.env[`${p.key.toUpperCase()}_REDIRECT_URI`] ?? `${appBaseUrl()}/api/oauth/${p.key}/callback`;
}

export function buildAuthUrl(p: OAuthProvider, opts: { source: string; state: string }): string {
  const clientId = reqEnv(p.clientIdEnv);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(p),
    response_type: "code",
    scope: p.scopesFor(opts.source).join(" "),
    ...(p.authParams ?? {}),
    state: opts.state,
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string } & Record<string, unknown>;

async function tokenRequest(p: OAuthProvider, body: URLSearchParams): Promise<TokenResponse> {
  return fetchJson<TokenResponse>(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

export async function exchangeCode(p: OAuthProvider, code: string): Promise<OAuthTokens> {
  const res = await tokenRequest(
    p,
    new URLSearchParams({
      code,
      client_id: reqEnv(p.clientIdEnv),
      client_secret: reqEnv(p.clientSecretEnv),
      redirect_uri: redirectUriFor(p),
      grant_type: "authorization_code",
    }),
  );
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
    email: p.identity?.(res),
  };
}

export async function refreshTokens(p: OAuthProvider, refreshToken: string): Promise<OAuthTokens> {
  const res = await tokenRequest(
    p,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: reqEnv(p.clientIdEnv),
      client_secret: reqEnv(p.clientSecretEnv),
      grant_type: "refresh_token",
    }),
  );
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
  };
}
```

```ts
// src/lib/oauth-state.ts (whole file)
import { randomBytes } from "node:crypto";
import { oauthProvider, oauthProviderFor } from "@/lib/oauth/providers";

export const OAUTH_STATE_COOKIE = "g_oauth_state";

export type OAuthState = { nonce: string | null; provider: string | null; source: string | null };

export function createOAuthState(s: { provider: string; source: string }): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const state = Buffer.from(JSON.stringify({ nonce, provider: s.provider, source: s.source })).toString("base64url");
  return { state, nonce };
}

/** Nulls for anything unreadable — a null field sends the callback to `state_mismatch`. */
export function parseOAuthState(state: string | null): OAuthState {
  try {
    const parsed = JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf8")) as { nonce?: unknown; provider?: unknown; source?: unknown };
    const nonce = typeof parsed.nonce === "string" && parsed.nonce.length > 0 ? parsed.nonce : null;
    const provider = typeof parsed.provider === "string" && oauthProvider(parsed.provider) ? parsed.provider : null;
    const source =
      typeof parsed.source === "string" && provider && oauthProviderFor(parsed.source)?.key === provider ? parsed.source : null;
    return { nonce, provider, source };
  } catch {
    return { nonce: null, provider: null, source: null };
  }
}

export function isValidOAuthState(stateParam: string | null, cookieNonce: string | undefined): boolean {
  const { nonce } = parseOAuthState(stateParam);
  if (!nonce || !cookieNonce) return false;
  return nonce === cookieNonce;
}
```

```ts
// src/app/api/oauth/[provider]/start/route.ts
import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
import { oauthProvider, oauthProviderFor } from "@/lib/oauth/providers";
import { buildAuthUrl } from "@/lib/oauth/flow";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const org = await getOrgContext();
  if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await effectiveAccess(getDb(), org);
  if (!access.can("connect_integrations")) {
    return NextResponse.redirect(new URL("/integrations?error=rank_forbidden", req.url));
  }
  const { provider: key } = await ctx.params;
  const provider = oauthProvider(key);
  const source = new URL(req.url).searchParams.get("source") ?? "";
  // The source must belong to this provider — a URL cannot borrow Google's
  // consent screen for another connector.
  if (!provider || oauthProviderFor(source)?.key !== provider.key) {
    return NextResponse.redirect(new URL("/integrations?error=oauth_unknown", req.url));
  }
  const { state, nonce } = createOAuthState({ provider: provider.key, source });
  const res = NextResponse.redirect(buildAuthUrl(provider, { source, state }));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
```

```ts
// src/app/api/oauth/[provider]/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
import { catalogEntry } from "@/connectors/catalog";
import { oauthProvider } from "@/lib/oauth/providers";
import { exchangeCode } from "@/lib/oauth/flow";
import { createConnection } from "@/lib/connections";
import { CapError } from "@/lib/limits";
import { parseOAuthState, isValidOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const org = await getOrgContext();
  if (!org) return NextResponse.redirect(new URL("/", req.url));
  {
    const access = await effectiveAccess(getDb(), org);
    if (!access.can("connect_integrations")) {
      return NextResponse.redirect(new URL("/integrations?error=rank_forbidden", req.url));
    }
  }
  const { provider: key } = await ctx.params;
  const provider = oauthProvider(key);
  if (!provider) return NextResponse.redirect(new URL("/integrations?error=oauth_unknown", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const jar = await cookies();
  const cookieNonce = jar.get(OAUTH_STATE_COOKIE)?.value;
  const clearStateCookie = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };
  if (!code) return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=oauth_denied", req.url)));
  const state = parseOAuthState(stateParam);
  if (!isValidOAuthState(stateParam, cookieNonce) || state.provider !== provider.key || !state.source) {
    return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=state_mismatch", req.url)));
  }
  const entry = catalogEntry(state.source);
  if (!entry) return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=oauth_unknown", req.url)));
  try {
    const tokens = await exchangeCode(provider, code);
    const conn = await createConnection({
      orgId: org.orgId,
      source: state.source,
      name: tokens.email ? `${entry.name} · ${tokens.email}` : entry.name,
      authType: "oauth2",
      credentials: tokens as unknown as Record<string, unknown>,
      config: {},
    });
    return clearStateCookie(NextResponse.redirect(new URL(`/connections/${conn.id}`, req.url)));
  } catch (err) {
    const dest = err instanceof CapError ? "/integrations?error=connection_limit" : "/integrations?error=oauth_exchange";
    return clearStateCookie(NextResponse.redirect(new URL(dest, req.url)));
  }
}
```

`src/lib/credentials.ts` — replace the `refreshGoogleToken` import with `import { oauthProviderFor } from "@/lib/oauth/providers"; import { refreshTokens } from "@/lib/oauth/flow";` and the body of `getConnectionCredentials` with:

```ts
  const creds = decryptCredentials(conn);
  const provider = oauthProviderFor(conn.source);
  const expiresAt = typeof creds.expiresAt === "number" ? creds.expiresAt : 0;
  const refreshToken = typeof creds.refreshToken === "string" ? creds.refreshToken : null;
  if (provider?.refresh === "standard" && refreshToken && expiresAt < Date.now() + 60_000) {
    try {
      const refreshed = await refreshTokens(provider, refreshToken);
      const merged = { ...creds, ...refreshed };
      await db
        .update(connections)
        .set({ credentialsEncrypted: encrypt(JSON.stringify(merged), getEncryptionKey()), updatedAt: new Date() })
        .where(eq(connections.id, conn.id));
      return merged;
    } catch (err) {
      if (err instanceof HttpError && err.body.includes("invalid_grant")) {
        throw new Error(`${provider.name} access has expired or been revoked. Reconnect this ${provider.name} account from Integrations.`);
      }
      throw err;
    }
  }
  return creds;
```

`src/app/integrations/page.tsx:128`:

```ts
    oauthHref:
      entry.connect === "google"
        ? `/api/oauth/google/start?source=${entry.source}`
        : entry.connect === "oauth" && entry.oauthProvider
          ? `/api/oauth/${entry.oauthProvider}/start?source=${entry.source}`
          : undefined,
```

`src/app/integrations/error-messages.ts` — add before `default:`:

```ts
    case "oauth_unknown":
      return "That sign-in link doesn't match any app we can connect, so nothing was connected. Start again from the app's card.";
```

Delete `src/lib/google-oauth.ts` and the two `src/app/api/oauth/google/**/route.ts` files. Then `grep -rn "google-oauth\|GOOGLE_SCOPES\|buildGoogleAuthUrl\|exchangeGoogleCode\|refreshGoogleToken\|GoogleSource" src tests` must return nothing except `.env.example` comments.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/oauth-providers.test.ts tests/oauth-route.test.ts tests/oauth-state.test.ts tests/credentials.test.ts tests/integrations-errors.test.ts tests/connector-population.test.ts && pnpm typecheck && pnpm check:orphans`
Expected: PASS. `credentials.test.ts` passes unchanged (same env names, same message).

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/oauth src/lib/oauth-state.ts src/lib/credentials.ts 'src/app/api/oauth' src/app/integrations/page.tsx src/app/integrations/error-messages.ts tests/oauth-providers.test.ts tests/oauth-route.test.ts tests/oauth-state.test.ts tests/integrations-errors.test.ts tests/connector-population.test.ts
git commit -m "Make OAuth a provider table, and move Google onto it

One start and one callback route serve every provider; the URL Google has
registered is unchanged. A pin test proves the authorize URL is byte for byte
what the retired builder produced. HubSpot, Shopify and the rest become one
entry in OAUTH_PROVIDERS plus their client id and secret.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: prober harness, scaffold, inventory, and the generic CI step

**Files:**
- Create: `scripts/lib/probe.ts`, `scripts/new-connector.ts`, `scripts/verify-all.ts`, `scripts/connector-inventory.ts`
- Modify: `.github/workflows/verify-providers.yml` (one new step before "Summary"), `package.json` scripts (`"connector:new": "tsx scripts/new-connector.ts"`, `"connector:inventory": "tsx scripts/connector-inventory.ts"`)
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- Produces: `createProbe(label): Probe` where `Probe = { check(name, ok, observed): void; note(name, observed): void; skip(name, why): void; head(title): void; section<T>(label, fn: () => Promise<T>): Promise<T | null>; report(): never; count(): number }`; `attemptJson(url, init?)`, `requireEnv(name, hint)`, `pace(ms)`; scaffold CLI `pnpm connector:new <source> --name "<Name>" --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]`.

- [ ] **Step 1: Write the failing scaffold test**

```ts
// tests/scaffold.test.ts
import { describe, it, expect } from "vitest";
import { renderScaffold } from "../scripts/new-connector";

describe("the connector scaffold", () => {
  const out = renderScaffold({ source: "acme", name: "Acme", auth: "apiKey", instant: true, poll: true, stream: null, today: "2026-09-07" });
  it("emits five files at the expected paths", () => {
    expect(Object.keys(out).sort()).toEqual([
      "scripts/verify-acme.ts",
      "src/connectors/acme.ts",
      "tests/acme.test.ts",
      "catalog-entry.txt",
      "registry-line.txt",
    ].sort());
  });
  it("the connector compiles against the kit and fails closed", () => {
    const c = out["src/connectors/acme.ts"];
    expect(c).toContain('source: "acme"');
    expect(c).toContain('authType: "apiKey"');
    expect(c).toContain("if (!secret) return false");
    expect(c).toContain("windowedWalk(");
    expect(c).toContain("from \"./kit\"");
  });
  it("the catalog entry carries the marker the population test rejects until it is filled", () => {
    const e = out["catalog-entry.txt"];
    expect(e).toContain('readOn: "FILL-ME"');
    expect(e).toContain("verified: { live: null }");
    expect(e).toContain("brand: { color:");
  });
  it("a stream-scoped scaffold declares the flow field", () => {
    const s = renderScaffold({ source: "acme", name: "Acme", auth: "apiKey", instant: false, poll: true, stream: "formId", today: "2026-09-07" });
    expect(s["catalog-entry.txt"]).toContain('key: "formId"');
    expect(s["src/connectors/acme.ts"]).toContain("listOptions(");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/scaffold.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the harness, the scaffold, the runners**

```ts
// scripts/lib/probe.ts
/**
 * The live-prober harness. A prober prints MEASUREMENTS and asserts only
 * comparisons between responses it made itself; a human reads the output and
 * decides (docs/CONNECTOR_SPEC_PROPOSAL.md §1.5). PASS/FAIL lines feed the
 * verify-providers workflow's summary table.
 */
export type Probe = {
  check(name: string, ok: boolean, observed: string): void;
  note(name: string, observed: string): void;
  skip(name: string, why: string): void;
  head(title: string): void;
  section<T>(label: string, fn: () => Promise<T>): Promise<T | null>;
  /** Print the summary and exit: 0 when nothing failed, 1 otherwise. */
  report(): never;
  count(): number;
};

export function createProbe(label: string): Probe {
  const failures: string[] = [];
  const findings: string[] = [];
  let requests = 0;
  const probe: Probe = {
    check(name, ok, observed) {
      console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}\n         observed: ${observed}`);
      if (!ok) failures.push(name);
    },
    note(name, observed) {
      console.log(`  [INFO] ${name}\n         observed: ${observed}`);
      findings.push(`${name}: ${observed}`);
    },
    skip(name, why) {
      console.log(`  [SKIP] ${name}\n         reason: ${why}`);
      findings.push(`${name} SKIPPED: ${why}`);
    },
    head(title) {
      console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
    },
    async section(label, fn) {
      try {
        return await fn();
      } catch (e) {
        probe.check(`${label} (could not run)`, false, e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    report() {
      console.log(`\n${"═".repeat(72)}\n${label}: ${requests} request(s), ${failures.length} failure(s), ${findings.length} finding(s)`);
      for (const f of findings) console.log(`  · ${f}`);
      if (failures.length > 0) {
        console.log(`\nFAILED: ${failures.join("; ")}`);
        process.exit(1);
      }
      process.exit(0);
    },
    count: () => requests,
  };
  return new Proxy(probe, {
    get(target, key) {
      if (key === "bump") return () => (requests += 1);
      return Reflect.get(target, key);
    },
  });
}

export type Attempt = { ok: true; status: number; body: unknown } | { ok: false; status: number; body: string };

/** One request, counted, never thrown: a 4xx is a measurement, not an error. */
export async function attemptJson(probe: Probe, url: string, init?: RequestInit): Promise<Attempt> {
  (probe as unknown as { bump: () => void }).bump();
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  try {
    return { ok: true, status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: true, status: res.status, body: text };
  }
}

export function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} (${hint}) and re-run.`);
    process.exit(2);
  }
  return v;
}

export function pace(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

```ts
// scripts/new-connector.ts
/**
 * Scaffold a connector: module on the kit, catalog entry, registry line,
 * test file, live prober. Usage:
 *   pnpm connector:new <source> --name "<Name>" --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]
 * Writes src/connectors/<source>.ts, tests/<source>.test.ts, scripts/verify-<source>.ts,
 * and PRINTS the catalog entry and registry line for you to paste — those two files
 * carry hand-written prose around every entry, so a script does not edit them.
 */
import { writeFileSync, existsSync } from "node:fs";

export type ScaffoldInput = {
  source: string;
  name: string;
  auth: "apiKey" | "secret" | "oauth";
  instant: boolean;
  poll: boolean;
  stream: string | null;
  today: string;
};

const pascal = (s: string) => s.replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase());

export function renderScaffold(i: ScaffoldInput): Record<string, string> {
  const Name = pascal(i.source);
  const authType = i.auth === "oauth" ? "oauth2" : i.auth;
  const credentialFields =
    i.auth === "apiKey"
      ? `[{ key: "apiKey", label: "API key", placeholder: "…" }${i.instant ? `, { key: "webhookSecret", label: "Webhook signing secret (optional)", placeholder: "whsec_…" }` : ""}]`
      : i.auth === "secret"
        ? `[{ key: "webhookSecret", label: "Webhook signing secret", placeholder: "…" }]`
        : "[]";
  const flowFields = i.stream
    ? `
    flowFields: [
      { key: "${i.stream}", label: "${pascal(i.stream)}", required: true, dynamic: true, placeholder: "Choose…" },
    ],`
    : "";

  const connector = `import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult${i.stream ? ", ListOptionsArgs, SourceOption" : ""} } from "./types";
import { asObject, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, parseDate, requireCredential, windowedWalk } from "./kit";

/**
 * ${i.name}. Facts below were read from the provider's documentation on ${i.today};
 * each one is cited on the catalog entry. Nothing here has been probed live yet
 * (\`verified.live: null\`) — run \`scripts/verify-${i.source}.ts\` with a key and record the date.
 */
const API = "https://api.example.com/v1"; // FILL-ME: base URL from the docs
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };

const EVENT_TYPES: Record<string, string> = {
  // "provider.event.name": "our_event_type",
};

function client(credentials?: Record<string, unknown> | null) {
  return bearerClient(API, requireCredential(credentials, "apiKey", "${i.name}"), "${i.name}");
}

function toCanonical(row: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const id = str(row["id"]);
  if (!id) return null;
  const type = str(row["type"]) ?? "event";
  return {
    eventId: eventId("${i.source}", connectionId, id),
    eventType: EVENT_TYPES[type] ?? type,
    subject: str(row["email"]) ?? null,
    occurredAt: parseDate(str(row["created_at"]), "created_at") ?? fallback ?? new Date(),
    properties: row,
  };
}

export const ${Name}Connector: Connector = {
  source: "${i.source}",
  authType: "${authType}",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-signature", encoding: "hex" }); // FILL-ME: the provider's scheme
  },
${
  i.instant
    ? `  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const ev = toCanonical(body, ctx.connectionId, ctx.fallbackOccurredAt);
    return ev ? [ev] : [];
  },
`
    : ""
}${
  i.poll
    ? `  async poll(args: PollArgs): Promise<PollResult> {
    const api = client(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await api.get<{ data?: unknown[]; next_cursor?: string | null }>("/events", {
          updated_after: since.toISOString(), // FILL-ME: the provider's filter param
          limit: 100,
          cursor: cont ?? undefined,
        });
        return { rows: (page.data ?? []).map(asObject), next: page.next_cursor ?? null, rateLimit: api.rateLimit() };
      },
      changedAt: (r) => isoOrNull(r["updated_at"]),
      happenedAt: (r) => isoOrNull(r["created_at"]),
      map: (r) => toCanonical(r, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
`
    : ""
}${
  i.stream
    ? `  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "${i.stream}") return [];
    const api = client(args.credentials);
    const res = await api.get<{ data?: unknown[] }>("/resources"); // FILL-ME
    return (res.data ?? []).map(asObject).map((r) => ({ value: str(r["id"]) ?? "", label: str(r["name"]) ?? str(r["id"]) ?? "Untitled" })).filter((o) => o.value);
  },
`
    : ""
}  operations: ["api.request"] as const,
  operationFor: () => "api.request",
};
`;

  const catalog = `  {
    source: "${i.source}",
    name: "${i.name}",
    description: "FILL-ME: one sentence, the events a customer counts with it.",
    brand: { color: "#64748B", short: "${Name.slice(0, 2)}" },
    connect: "${i.auth === "oauth" ? "oauth" : "apiKey"}",${i.auth === "oauth" ? `\n    oauthProvider: "${i.source}",` : ""}
    instant: ${i.instant},
    poll: ${i.poll},
    autoWebhook: false,
    docs: { url: "https://FILL-ME", readOn: "FILL-ME", webhooks: "https://FILL-ME" },
    verified: { live: null },
    // Cite the page and date for every figure. Declared on "api.request" because
    // the provider publishes one account-wide limit; split per endpoint if it does not.
    rateLimits: { "api.request": { requestsPerMinute: 60 } },
    credentialFields: ${credentialFields},${flowFields}
  },`;

  const registry = `import { ${Name}Connector } from "./${i.source}";\n  ${Name}Connector,`;

  const test = `import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { ${Name}Connector } from "@/connectors/${i.source}";
import { catalogEntry } from "@/connectors/catalog";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";
const SECRET = "s3cret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");

describe("${i.name}: signature", () => {
  it("accepts a correctly signed delivery and fails closed otherwise", () => {
    const body = JSON.stringify({ id: "e1", type: "event", created_at: "2026-09-01T10:00:00Z" });
    expect(${Name}Connector.verifySignature({ rawBody: body, headers: { "x-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(${Name}Connector.verifySignature({ rawBody: body, headers: { "x-signature": sign(body) }, secret: null })).toBe(false);
    expect(${Name}Connector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(${Name}Connector.verifySignature({ rawBody: body + " ", headers: { "x-signature": sign(body) }, secret: SECRET })).toBe(false);
  });
});
${
  i.instant
    ? `
describe("${i.name}: normalize", () => {
  it("maps a delivery to a dated, namespaced event", () => {
    const [ev] = ${Name}Connector.normalize!({ id: "e1", type: "event", email: "a@b.io", created_at: "2026-09-01T10:00:00Z" }, { connectionId: CONN });
    expect(ev.eventId).toBe("${i.source}:conn_1:e1");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(ev.subject).toBe("a@b.io");
  });
});
`
    : ""
}${
  i.poll
    ? `
describe("${i.name}: poll", () => {
  it("walks pages under the budget and settles to a high-water mark", async () => {
    const rows = Array.from({ length: 3 }, (_, n) => ({ id: \`r\${n}\`, type: "event", created_at: \`2026-09-0\${n + 1}T10:00:00Z\`, updated_at: \`2026-09-0\${n + 1}T10:00:00Z\` }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", headers: { get: () => null }, json: async () => ({ data: rows, next_cursor: null }), text: async () => "" })));
    const res = await ${Name}Connector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } });
    expect(res.records).toHaveLength(3);
    expect(res.nextCursor).toBe("2026-09-03T10:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
  });
});
`
    : ""
}
describe("${i.name}: catalog", () => {
  it("is registered with provenance", () => {
    const e = catalogEntry("${i.source}")!;
    expect(e.docs?.readOn).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/);
    expect(e.verified).toEqual({ live: null });
  });
});
`;

  const prober = `/**
 * Live prober for ${i.name}. Prints measurements; asserts only comparisons
 * between its own responses. Run: ${i.source.toUpperCase().replace(/-/g, "_")}_API_KEY=… pnpm tsx scripts/verify-${i.source}.ts
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.example.com/v1"; // FILL-ME: keep in step with src/connectors/${i.source}.ts
const probe = createProbe("${i.name}");
const key = requireEnv("${i.source.toUpperCase().replace(/-/g, "_")}_API_KEY", "an API key for a test account");
const headers = { authorization: \`Bearer \${key}\` };

async function main() {
  probe.head("SECTION 1 — the list endpoint answers, and says which field it is ordered by");
  const page = await probe.section("list", () => attemptJson(probe, \`\${API}/events?limit=5\`, { headers }));
  if (page) probe.check("list endpoint responds 2xx", page.ok, \`HTTP \${page.status}\`);

  probe.head("SECTION 2 — does the date filter FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, \`\${API}/events?limit=50\`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, \`\${API}/events?limit=50&updated_after=2030-01-01T00:00:00Z\`, { headers }));
  if (all?.ok && bounded?.ok) {
    const n = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);
    probe.check("a future bound returns fewer rows than no bound (the parameter is honoured)", n(bounded.body) < n(all.body), \`unbounded=\${n(all.body)} bounded=\${n(bounded.body)}\`);
  }

  probe.head("SECTION 3 — rate-limit headers");
  const res = await fetch(\`\${API}/events?limit=1\`, { headers });
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => \`\${k}=\${v}\`).join(", ") || "none");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;

  return {
    [`src/connectors/${i.source}.ts`]: connector,
    [`tests/${i.source}.test.ts`]: test,
    [`scripts/verify-${i.source}.ts`]: prober,
    "catalog-entry.txt": catalog,
    "registry-line.txt": registry,
  };
}

function parseArgs(argv: string[]): ScaffoldInput {
  const [source, ...rest] = argv;
  if (!source || !/^[a-z][a-z0-9-]*$/.test(source)) {
    console.error("usage: pnpm connector:new <source> --name <Name> --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]");
    process.exit(2);
  }
  const flag = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const auth = (flag("--auth") ?? "apiKey") as ScaffoldInput["auth"];
  if (!["apiKey", "secret", "oauth"].includes(auth)) { console.error("--auth must be apiKey, secret or oauth"); process.exit(2); }
  return {
    source,
    name: flag("--name") ?? source,
    auth,
    instant: rest.includes("--instant"),
    poll: rest.includes("--poll"),
    stream: flag("--stream") ?? null,
    today: new Date().toISOString().slice(0, 10),
  };
}

if (process.argv[1]?.endsWith("new-connector.ts")) {
  const input = parseArgs(process.argv.slice(2));
  const files = renderScaffold(input);
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith(".txt")) continue;
    if (existsSync(path)) { console.error(`${path} exists — refusing to overwrite`); process.exit(1); }
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
  console.log("\nPaste into CONNECTOR_CATALOG (src/connectors/catalog.ts):\n" + files["catalog-entry.txt"]);
  console.log("\nAdd to src/connectors/registry.ts (import, then the array):\n" + files["registry-line.txt"]);
  console.log("\nThen: replace every FILL-ME, run the tests, and run pnpm check:orphans.");
}
```

```ts
// scripts/verify-all.ts
/**
 * Runs every generated prober whose secret is present. Secrets arrive as
 * SECRETS_JSON (the workflow passes `toJSON(secrets)`) or as plain env vars.
 * Appends PASS|FAIL|SKIP lines to $RESULTS when set, as the bespoke steps do.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { CONNECTOR_CATALOG } from "../src/connectors/catalog";

const BESPOKE = new Set(["close", "calendly", "instantly"]); // their own steps in the workflow
const secrets: Record<string, string> = process.env.SECRETS_JSON ? (JSON.parse(process.env.SECRETS_JSON) as Record<string, string>) : {};
const line = (s: string) => {
  console.log(s);
  if (process.env.RESULTS) appendFileSync(process.env.RESULTS, s + "\n");
};
let failed = 0;
for (const e of CONNECTOR_CATALOG) {
  if (BESPOKE.has(e.source)) continue;
  const script = `scripts/verify-${e.source}.ts`;
  if (!existsSync(script)) continue;
  const envName = `${e.source.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  const key = process.env[envName] ?? secrets[envName];
  if (!key) {
    line(`SKIP|${e.name}|Secret ${envName} is not set on this repository.`);
    continue;
  }
  const r = spawnSync("pnpm", ["tsx", script], { stdio: "inherit", env: { ...process.env, [envName]: key } });
  if (r.status === 0) line(`PASS|${e.name}|No check contradicted the pinned contract — read the INFO lines.`);
  else {
    failed += 1;
    line(`FAIL|${e.name}|Script exited ${r.status} — see the ${e.name} output above.`);
  }
}
process.exit(failed > 0 ? 1 : 0);
```

```ts
// scripts/connector-inventory.ts
import { CONNECTOR_CATALOG } from "../src/connectors/catalog";

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
console.log(`${pad("source", 12)} ${pad("connect", 8)} ${pad("in", 3)} ${pad("poll", 5)} ${pad("sync", 15)} ${pad("docs read", 11)} ${pad("live", 11)}`);
for (const e of CONNECTOR_CATALOG) {
  console.log(
    `${pad(e.source, 12)} ${pad(e.connect, 8)} ${pad(e.instant ? "y" : "-", 3)} ${pad(e.poll ? "y" : "-", 5)} ${pad(e.sync ?? (e.poll ? "incremental" : "webhook-only"), 15)} ${pad(e.docs?.readOn ?? "(legacy)", 11)} ${pad(e.verified ? (e.verified.live ?? "unprobed") : "(legacy)", 11)}`,
  );
}
```

`.github/workflows/verify-providers.yml` — add this step after the Instantly step and before `Summary`:

```yaml
      - name: Every other connector — its generated prober, if its key is set
        if: ${{ inputs.providers == 'all' }}
        continue-on-error: true
        env:
          SECRETS_JSON: ${{ toJSON(secrets) }}
        run: |
          set -uo pipefail
          pnpm tsx scripts/verify-all.ts
```

`package.json` scripts: add `"connector:new": "tsx scripts/new-connector.ts"` and `"connector:inventory": "tsx scripts/connector-inventory.ts"`.

- [ ] **Step 4: Run the tests and the scripts**

Run: `pnpm vitest run tests/scaffold.test.ts && pnpm typecheck && pnpm connector:inventory && pnpm check:orphans`
Expected: PASS; the inventory prints seven rows with `(legacy)`; orphans clean (`renderScaffold` is called by its own CLI block in `scripts/`, `createProbe`/`attemptJson`/`requireEnv`/`pace` — `pace` has no caller yet: allowlist it as `pace: "prober harness — first consumer: the Smartlead prober (connectors batch 1)"`).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/probe.ts scripts/new-connector.ts scripts/verify-all.ts scripts/connector-inventory.ts scripts/check-orphans.ts .github/workflows/verify-providers.yml package.json tests/scaffold.test.ts
git commit -m "Scaffold a connector, and give every one a live prober the workflow runs

pnpm connector:new writes the module, test and prober and prints the catalog
entry. The prober harness is the Close script's check/note/skip extracted;
verify-all runs every generated prober whose secret exists.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: docs

**Files:**
- Create: `docs/ADDING_A_CONNECTOR.md`
- Modify: `docs/DATA_MODEL.md:87-96` (guarantee table gains a sentence), `docs/HOW_THE_BACKEND_WORKS.md:126-135` (§4 gains a paragraph), `docs/CONNECTOR_SPEC_PROPOSAL.md:1-6` (status note)

- [ ] **Step 1: Write `docs/ADDING_A_CONNECTOR.md`**

```markdown
# Adding a connector

One module, one catalog entry, one registry line, one test file, one prober.
Nothing else: no roster to join, no brand map, no route. The population test
(`tests/connector-population.test.ts`) tells you what you forgot.

## 1. Read the docs first, and write down when

Open the provider's API reference and webhook guide. For every fact the
connector relies on — base URL, list endpoint, the parameter that FILTERS by
time, the field that says when a record CHANGED, the field that says when the
thing HAPPENED, page size and pagination style, the signature scheme, rate
limits, history retention — note the page and the date. They go on the catalog
entry (`docs: { url, readOn, webhooks }`) and in comments next to each figure,
the way the Instantly entry cites its rate limit. A claim without a date is
folklore.

## 2. Scaffold

    pnpm connector:new <source> --name "<Name>" --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]

- `--instant`: the provider delivers webhooks. You will implement
  `verifySignature` (fails closed: no secret, no acceptance) and `normalize`.
- `--poll`: the provider has a dated list endpoint. You will implement `poll`
  on `windowedWalk` from `src/connectors/kit`.
- `--stream <fieldKey>`: the resource is chosen per flow (a form, a campaign,
  a base). The flow field is declared on the entry and `listOptions` lists them.

Paste the printed catalog entry into `CONNECTOR_CATALOG` and the registry line
into `registry.ts`. Replace every `FILL-ME`. Pick the brand colour from the
vendor's own guidelines.

## 3. The four rules

**Date by when it HAPPENED.** `occurredAt` is the moment the countable thing
occurred: a booking is dated when it was booked, a payment when it settled, a
call when it started. A meeting's start time, a deal's forecast close date, an
SLA deadline and an accountant's editable transaction date are NOT that; keep
them in `properties`. Every window on the dashboard excludes the future.

**The watermark is the field the provider FILTERS on.** `changedAt` in
`windowedWalk` must be the same field the request bounds with `since`. Close
sent `date_created__gte` while the API filtered on `date_updated`, and every
request was unbounded for months.

**Fail closed.** `verifySignature` returns false without a secret. The only
open endpoint is the custom webhook, whose openness is the product.

**Namespace every id.** `eventId(source, connectionId, …)` — two customers'
record 42 must never collide, and neither must two of one customer's resources
(embed the stream hash where natural ids repeat across resources).

## 4. What the kit gives you

- `windowedWalk` — cursor-forward polling with overlap, bounded by budget and
  deadline, that never strands a record. Same cursor grammar as Close.
- `standardWebhooksVerify`, `timestampedHmacVerify`, `hmacHeaderVerify`,
  `sharedTokenVerify` — every signature scheme seen so far.
- `bearerClient` / `basicClient` / `headerKeyClient` — URL joining, params,
  rate-limit capture, a 401 that says "reconnect".
- `eventId`, `naturalOrHash`, `epochToDate`, `ymd`, `isoOrNull`, `parseDate`.

Budgets: declare `operations` and the matching `rateLimits` keys, or leave both
off for a provider with one account-wide limit (`"*"`).

## 5. Tests that must exist

`tests/<source>.test.ts` covers: signature (valid, wrong secret, missing
header, stale timestamp, no secret); normalize (each event type → eventType,
occurredAt, subject, value); poll (pages under a budget, cursor round trip, a
burst larger than the page cap is fully drained). The scaffold writes the
skeleton.

## 6. Verify live when you can

`scripts/verify-<source>.ts` prints measurements against a real account. Run
it the day you get a key, put the date in `verified.live`, and fix what it
contradicts. Until then the entry says `verified: { live: null }` and
`pnpm connector:inventory` shows it as unprobed. The `Verify providers`
workflow runs every prober whose `<SOURCE>_API_KEY` secret exists.

## 7. Provider forgets its history?

Declare `retention: { days, alarmAfterDays, watermarkOf }` on the connector and
add a `historyNote` to the entry. The nightly scan alarms before data behind
the watermark becomes unfetchable. Declare `importProgress` if a first sync
walks in pages, so the connection page can say "covering 12 of 30 days".
```

- [ ] **Step 2: Update the other three docs**

`docs/DATA_MODEL.md` — after the guarantee table (line 96) add:

```markdown
New connectors are built on `src/connectors/kit/` and documented in
`docs/ADDING_A_CONNECTOR.md`; their catalog entries carry `docs.readOn` (when
the provider's documentation was read) and `verified.live` (when a live prober
last ran, or null).
```

`docs/HOW_THE_BACKEND_WORKS.md` — in §4 after the first bullet add:

```markdown
- Apps that sign in with OAuth (Google today; more to come) share one flow:
  `/api/oauth/<provider>/start` sends the customer to the provider,
  `/api/oauth/<provider>/callback` brings them back and stores the tokens
  encrypted like any other key. Adding a provider is one table entry plus its
  client id and secret in the environment.
```

`docs/CONNECTOR_SPEC_PROPOSAL.md` — replace line 3 (`**PROPOSAL.** …`) with:

```markdown
**STATUS (7 Sep 2026).** The duplicated code §2 measures was extracted as
functions rather than as a typed spec (`src/connectors/kit/`, spec in
`docs/superpowers/specs/2026-09-07-connector-kit-and-first-twenty-design.md`).
The live gate of §1 survives as a generated prober per connector and the
`verified.live` date on its catalog entry. §6's Close fix shipped separately.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ADDING_A_CONNECTOR.md docs/DATA_MODEL.md docs/HOW_THE_BACKEND_WORKS.md docs/CONNECTOR_SPEC_PROPOSAL.md
git commit -m "Write down how a connector is added, now that it is one page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: the whole bar, then push

- [ ] **Step 1: Stop any dev server and run everything**

```bash
PID=$(lsof -nP -iTCP:3001 -sTCP:LISTEN -t 2>/dev/null); [ -n "$PID" ] && kill $PID; PID=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null); [ -n "$PID" ] && kill $PID
pnpm typecheck && pnpm check:orphans && pnpm check:ui && pnpm vitest run --maxWorkers=2 && pnpm build
```

Expected: all green. If `pnpm build` complains about `.env.local`, copy it in for the build and `rm -f .env.local` before committing anything.

- [ ] **Step 2: Sabotage sweep** — one at a time, revert after each: (a) make `windowedWalk` skip the deadline check → `kit-windowed-walk` fails; (b) make `standardWebhooksVerify` return true without a secret → `kit-verify` AND `connector-population` fail; (c) remove `brand` from the Whop entry → `source-style` and `connector-population` fail; (d) change Google's `prompt` param → `oauth-providers` fails.

- [ ] **Step 3: Push**

```bash
git push origin worktree-figma-overview-match:main
```

Then tell Elias: infra is on main; what changed for him (nothing to do); what the connectors plan does next.

---

## Self-review

**Spec coverage.** Part 1 → Tasks 1–3. Part 2 → Task 5. Part 3 → Task 4 (plus `docs`/`verified` required by Task 6's population test). Part 4 → Task 7. Part 5 → Task 6 (tightened in Task 7). Part 6 → Tasks 8–9. Part 8 → Task 10. Part 7 (the nineteen connectors) is the second plan. Gap check: the spec's "Google migrates onto it with its old routes kept as aliases" — this plan deletes the Google route files because the `[provider]` routes serve the identical URLs, which is the stronger form of the same promise and is pinned by `oauth-providers.test.ts`.

**Placeholders.** The only `FILL-ME` strings are inside the scaffold's generated output, where they are the mechanism (the population test rejects them). No TBD elsewhere.

**Type consistency.** `WalkCursor`/`parseWalkCursor`/`serializeWalkCursor`/`walkImportProgress` (Task 1) are the names the scaffold (Task 8) and the docs (Task 9) use. `ProviderClient.rateLimit()` returns `ObservedRateLimit | null`, which `WalkPage.rateLimit` accepts. `Connector.retention.alarmAfterDays` is used by both the hook test and `cursorLag`. `OAuthProvider.name` is used by `credentials.ts`. `oauthProvider(key)` and `oauthProviderFor(source)` are distinct and both used by `oauth-state.ts` and the routes.
