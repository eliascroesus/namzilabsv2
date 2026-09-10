import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowTilesTag, reviveTileRows, tileCacheKey, versionedFlowTiles } from "@/lib/flow/tile-cache";

/**
 * THE BOARD READ, KEYED BY THE VERSION OF WHAT IT READS.
 *
 * `publishedFlowTiles` is, in its own words, "the one query that runs on every
 * dashboard render, against a database that bills every byte it returns". It
 * does NOT depend on the selected range: the range picks a key out of the tile
 * jsonb AFTER the rows arrive. So switching 7d -> today -> 7d issued three
 * identical queries for bytes the browser already had.
 *
 * WHY THE KEY IS `resultsVersion` AND NOT A TTL. A plain time-to-live trades
 * money for lies: press Refresh, and the board shows pre-refresh numbers until
 * the window lapses. The version string is exactly the change detector the
 * freshness poller already compares (`/api/results-version`), so a recompute
 * moves the key and the next read MISSES. Cost falls, staleness does not rise.
 *
 * IT MOSTLY AVOIDS THE TRAP `nav-views.ts` DOCUMENTS, where a revalidation
 * landing mid-drag races `BoardLayout` seeding its arrangement: on the ordinary
 * path the key changing IS the invalidation, and nothing is revalidated at all.
 * The single exception is the `flows.status` gap below, whose two call sites
 * already revalidate the dashboard path — so the tag adds no race that those
 * actions were not already carrying.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the cache key", () => {
  it("separates orgs, versions and the two projections", () => {
    const a = tileCacheKey("org_a", "3.0.111", false);
    expect(tileCacheKey("org_b", "3.0.111", false)).not.toEqual(a);
    // The whole point: new data, new key, no stale board.
    expect(tileCacheKey("org_a", "3.0.222", false)).not.toEqual(a);
    // `withDays` selects a DIFFERENT projection — the one that keeps `byDay`.
    // Sharing a key would serve a custom range a tile with no day map, or make
    // every preset render pay for sixty entries it never reads.
    expect(tileCacheKey("org_a", "3.0.111", true)).not.toEqual(a);
  });

  it("is a flat array of strings, which is what the cache accepts", () => {
    for (const part of tileCacheKey("org_a", "3.0.111", true)) expect(typeof part).toBe("string");
  });
});

describe("reviving a row that has been through the cache", () => {
  /**
   * A HIT COMES BACK AS JSON, A MISS COMES BACK AS ITSELF — and the row type
   * declares `computedAt: Date | null`. Handling only one of the two leaves the
   * declared type lying on whichever path was not considered.
   */
  it("turns the serialized string back into a Date", () => {
    const [row] = reviveTileRows([{ computedAt: "2026-09-10T16:24:59.629Z" }]);
    expect(row.computedAt).toBeInstanceOf(Date);
    expect(row.computedAt?.toISOString()).toBe("2026-09-10T16:24:59.629Z");
  });

  it("leaves a real Date alone rather than rebuilding it", () => {
    const at = new Date("2026-09-10T16:24:59.629Z");
    const [row] = reviveTileRows([{ computedAt: at }]);
    expect(row.computedAt).toBeInstanceOf(Date);
    expect(row.computedAt?.getTime()).toBe(at.getTime());
  });

  it("keeps null null — a tile that has never computed", () => {
    expect(reviveTileRows([{ computedAt: null }])[0].computedAt).toBeNull();
  });

  it("does not otherwise touch the row", () => {
    const rows = reviveTileRows([{ computedAt: null, flowId: "f1", tile: { name: "Calls" } }]);
    expect(rows[0]).toMatchObject({ flowId: "f1", tile: { name: "Calls" } });
  });
});

describe("what is cached and what deliberately is not", () => {
  const page = read("src/app/dashboard/page.tsx");

  it("reads the board's tiles through the versioned wrapper", () => {
    expect(page).toMatch(/versionedFlowTiles\(/);
  });

  it("leaves the LAYOUT reads uncached, because the version cannot see them", () => {
    /**
     * `resultsVersion` counts flow_results and backfill jobs. A drag writes a
     * PLACEMENT and a rename writes a GROUP — neither moves that string. Caching
     * them under it would freeze a board's arrangement until some unrelated
     * recompute happened to bump the key, which is a worse bug than the cost
     * this fixes.
     */
    for (const call of ["listTilePlacements(", "listBoardGroups(", "listBoardTiles("]) {
      const at = page.indexOf(call);
      expect(at, `${call} not found`).toBeGreaterThan(-1);
      expect(page.slice(Math.max(0, at - 200), at)).not.toMatch(/versionedFlowTiles|unstable_cache/);
    }
  });
});

/**
 * THE ONE CHANGE THE VERSION CANNOT SEE.
 *
 * `resultsVersion` counts `flow_results` rows, their non-fresh count, their
 * newest `computed_at`, and backfill progress. `publishedFlowTiles` returns a
 * row only when it JOINS a flow whose status is "published" — and turning a
 * flow off, in `setFlowEnabledAction`'s own words, is "not delete and not
 * unpublish: the immutable version and every stored result stay exactly where
 * they are, the dashboard simply stops joining to them".
 *
 * So the SET of tiles changes while every number the version counts stands
 * still. Without this pairing the cache would keep handing back a tile for a
 * flow the customer had just switched off, and `revalidatePath("/dashboard")`
 * would not help: it re-renders the route, it does not clear a data cache.
 *
 * A TAG IS SAFE HERE precisely because both actions already revalidate the
 * dashboard path. The hazard `nav-views.ts` documents — a revalidation landing
 * mid-drag and racing `BoardLayout`'s arrangement seeding — is one these call
 * sites already carry; this adds no new one.
 */
describe("the tile cache and the two writers of flows.status", () => {
  const actions = read("src/app/dashboard/flows/actions.ts");

  /**
   * The action's OWN body — from the store call to the start of the next
   * exported action. A character window would pass or fail on how long the
   * comments happen to be, which is not the property under test.
   */
  const bodyAfter = (anchor: string) => {
    const at = actions.indexOf(anchor);
    expect(at, `${anchor} not found`).toBeGreaterThan(-1);
    const rest = actions.slice(at);
    const end = rest.indexOf("\nexport async function");
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("is invalidated when a flow is switched off or back on", () => {
    // Within the action's own body, not merely somewhere in the file.
    expect(bodyAfter("setFlowEnabled(getDb()")).toMatch(/updateTag\(flowTilesTag\(orgId\)\)/);
  });

  it("is invalidated when a flow is published", () => {
    expect(bodyAfter("publishFlow(getDb()")).toMatch(/updateTag\(flowTilesTag\(orgId\)\)/);
  });

  it("names one tag per org, so one workspace cannot clear another's", () => {
    expect(flowTilesTag("org_a")).not.toBe(flowTilesTag("org_b"));
    expect(flowTilesTag("org_a")).toContain("org_a");
  });
});

/**
 * A MISSING VERSION READS THROUGH, rather than caching under a hole.
 *
 * `resultsVersionP` swallows its own failure — a poller that cannot seed still
 * works. If that `undefined` were folded into a cache key it would be a key
 * every render shared for as long as the aggregate stayed down, which is the
 * one way this design could serve a genuinely stale board. Paying for the query
 * is the cheaper mistake, so the guard is asserted rather than assumed.
 */
describe("when the version could not be read", () => {
  const stubDb = () => {
    let selects = 0;
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => Promise.resolve([{ flowId: "f1", computedAt: new Date("2026-09-10T00:00:00.000Z") }]),
    };
    return {
      db: { select: () => (selects++, chain) } as never,
      selects: () => selects,
    };
  };

  it("goes to the database instead of caching under an undefined key", async () => {
    const { db, selects } = stubDb();
    const rows = await versionedFlowTiles(db, "org_a", { version: undefined });
    expect(selects()).toBe(1);
    // And it still revives, so callers cannot tell which path they got.
    expect(rows[0].computedAt).toBeInstanceOf(Date);
  });
});
