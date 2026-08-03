import { describe, it, expect, afterEach, vi } from "vitest";
import { instantlyConnector } from "@/connectors/instantly";

/**
 * A QUIET CAMPAIGN IS NOT A DELETED CAMPAIGN.
 *
 * `mirrorScope` is the connector telling the runner "this read is COMPLETE for
 * this window", which licenses `retireAbsent` to tombstone every stored row
 * inside it that the read did not produce. With an empty record set that is
 * every row inside the window: `retireAbsent` drops its `notInArray` clause when
 * there is nothing present to exclude.
 *
 * This was live. A verification run against a real workspace returned zero daily
 * rows for two campaigns of three (`ffc12960:0`, `e9f4dc61:0`, `e81c1200:3`), so
 * every sweep tombstoned those campaigns' last 30 days and the next response
 * that carried rows brought them back — a number emptying and refilling with
 * nothing on screen to explain it.
 *
 * The distinction from a spreadsheet is the point. A whole-resource mirror has
 * READ the whole resource, so an empty read means an empty resource, and
 * `tests/mirror-window.test.ts` pins that deliberately. This endpoint reports
 * only days that had activity, so a quiet campaign returns nothing at all —
 * which is indistinguishable from one whose days were withdrawn.
 */

const CAMPAIGN = "camp-quiet";

function serve(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as unknown as Response,
    ),
  );
}

const poll = () =>
  instantlyConnector.poll!({
    connectionId: "c1",
    cursor: null,
    credentials: { apiKey: "k" },
    config: { streamType: "analytics_daily", campaignId: CAMPAIGN, days: 30 },
    streamHash: "h1",
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("instantly daily analytics: an empty window declares no mirrorScope", () => {
  it("a campaign with no activity retires nothing", async () => {
    serve({ items: [] });
    const res = await poll();

    expect(res.records).toHaveLength(0);
    expect(res.mirrorScope).toBeUndefined();
  });

  /**
   * The other route to an empty record set: rows came back, none of them could
   * be attributed to the requested campaign, and the connector deliberately
   * stored nothing. Having decided that, it must not also claim to have
   * enumerated the window.
   */
  it("declares nothing when it deliberately discarded an unscopable response", async () => {
    serve({
      items: [
        { date: "2026-08-01", sent: 10 },
        { date: "2026-08-01", sent: 20 },
        { date: "2026-08-02", sent: 30 },
      ],
    });
    const res = await poll();

    expect(res.records).toHaveLength(0);
    expect(res.mirrorScope).toBeUndefined();
  });

  /**
   * The counterweight: a read that DID produce rows still declares its window,
   * so a day that genuinely stops being reported is still retired. "Never
   * strand" is trivially satisfiable by never retiring anything.
   */
  it("still declares the window when the read produced rows", async () => {
    serve({ items: [{ campaign_id: CAMPAIGN, date: "2026-08-01", sent: 10 }] });
    const res = await poll();

    expect(res.records).toHaveLength(1);
    expect(res.mirrorScope).toBeDefined();
    expect(res.mirrorScope!.to.getTime()).toBeGreaterThan(res.mirrorScope!.from.getTime());
  });
});
