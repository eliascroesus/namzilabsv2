import { unstable_cache } from "next/cache";
import type { DB } from "@/db/types";
import { publishedFlowTiles } from "./materialize";

/**
 * THE BOARD'S TILE READ, KEYED BY THE VERSION OF WHAT IT READS.
 *
 * `publishedFlowTiles` calls itself "the one query that runs on every dashboard
 * render, against a database that bills every byte it returns" — a tile jsonb
 * per published Output, on the most-rendered page in the product.
 *
 * IT DOES NOT DEPEND ON THE SELECTED RANGE. The range picks a key out of
 * `byRange` AFTER the rows arrive, so 7d -> today -> 7d issued three identical
 * queries for bytes the browser was already holding. That is the cost this
 * removes: the switch still re-renders, but it no longer reads the database.
 *
 * WHY THE KEY IS A VERSION AND NOT A TIME-TO-LIVE. A TTL buys the saving with
 * lies — press Refresh and the board shows pre-refresh numbers until the window
 * lapses, which on a page whose whole job is "what is true now" is the wrong
 * trade at any price. `resultsVersion` is the change detector the freshness
 * poller ALREADY compares every twelve seconds (`/api/results-version`): it
 * moves when a tile recomputes, when one goes non-fresh, and when an import
 * deepens. A moved version is a different cache key, so the next read misses
 * and returns the new numbers. Cost falls; staleness does not rise.
 *
 * IT MOSTLY SIDESTEPS THE TRAP `nav-views.ts` DOCUMENTS. On the ordinary path
 * the key changing IS the invalidation — a mechanism with no timing to get
 * wrong — so no revalidation lands mid-drag to race `BoardLayout` seeding its
 * arrangement. The one exception is `flowTilesTag` below, cleared by two Server
 * Actions that already revalidate the dashboard path; it adds no race those
 * call sites were not already carrying.
 *
 * WHAT IS DELIBERATELY NOT CACHED: the layout reads. `resultsVersion` counts
 * `flow_results` and backfill jobs, and a drag writes a PLACEMENT while a
 * rename writes a GROUP — neither moves that string. Caching those here would
 * freeze a board's arrangement until an unrelated recompute happened to bump
 * the key, which is a worse bug than the cost this fixes.
 */

/**
 * THE ONE CHANGE THE VERSION CANNOT SEE, named so both writers can clear it.
 *
 * `resultsVersion` counts stored results and backfill progress. Turning a flow
 * OFF touches neither — it flips `flows.status`, and `publishedFlowTiles` stops
 * joining to rows that are still sitting there unchanged. The set of tiles
 * moves while every number the version counts stands still, so that one
 * transition needs an explicit tag. Publishing takes it too, since a flow can
 * become published before anything has computed for it.
 *
 * Per org, so one workspace's toggle cannot drop another's cached board.
 */
export function flowTilesTag(orgId: string): string {
  return `flow-tiles:${orgId}`;
}

/**
 * The parts the two projections and the two orgs are told apart by. Pure, so
 * the "new data means a new key" property is a test rather than a claim.
 */
export function tileCacheKey(orgId: string, version: string, withDays: boolean): string[] {
  return ["published-flow-tiles", orgId, version, withDays ? "days" : "no-days"];
}

/**
 * A CACHE HIT COMES BACK AS JSON; A MISS COMES BACK AS ITSELF.
 *
 * The row type declares `computedAt: Date | null` and the tile renders it as a
 * relative time. Through the data cache a `Date` serializes to a string, so on
 * the hit path that declared type would be a lie — and on the miss path a
 * blanket `new Date(...)` would rebuild an object that was never broken.
 * Handling both is what makes the two paths indistinguishable to callers.
 */
export function reviveTileRows<T extends { computedAt?: Date | string | null }>(
  rows: T[],
): Array<Omit<T, "computedAt"> & { computedAt: Date | null }> {
  return rows.map((r) => ({
    ...r,
    computedAt: r.computedAt == null ? null : r.computedAt instanceof Date ? r.computedAt : new Date(r.computedAt),
  }));
}

/**
 * `publishedFlowTiles`, read at most once per results version.
 *
 * THE VERSION IS PASSED IN, NOT COMPUTED HERE, because the dashboard already
 * has one in flight: `resultsVersionP` seeds the freshness poller from the same
 * `getReadDb()` handle, so a second pair of aggregates would be a duplicate
 * query and could disagree with the number the poller starts comparing against.
 *
 * `undefined` — the version read failed — falls through to an UNCACHED read.
 * A key built from a missing version would be shared by every render until the
 * aggregate recovered, which is the one way this could serve a stale board.
 * Paying for the query is the cheaper mistake.
 *
 * ON THE EXTRA HOP: a miss now costs the version round trip before the read.
 * The dashboard awaits these rows AFTER its board reads (see `flowRowsP`), so
 * that hop overlaps work that was happening anyway — and a miss only occurs
 * when the data actually moved, which is the render that had to pay regardless.
 */
export async function versionedFlowTiles(
  db: DB,
  orgId: string,
  opts: { withDays?: boolean; version: string | undefined },
) {
  const withDays = opts.withDays === true;
  if (opts.version === undefined) return reviveTileRows(await publishedFlowTiles(db, orgId, { withDays }));
  const read = unstable_cache(
    () => publishedFlowTiles(db, orgId, { withDays }),
    tileCacheKey(orgId, opts.version, withDays),
    {
      /**
       * A CEILING, NOT THE INVALIDATION — the version does that. This only stops
       * a workspace that has gone quiet from pinning an entry forever, since a
       * key nothing revalidates is otherwise kept indefinitely.
       */
      revalidate: 3600,
      tags: [flowTilesTag(orgId)],
    },
  );
  return reviveTileRows(await read());
}
