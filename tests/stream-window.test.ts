import { describe, it, expect, afterEach, vi } from "vitest";
import { calendlyConnector } from "@/connectors/calendly";

/**
 * 6.2 — the stream owns its window, and ONE value drives both halves of it.
 *
 * This blocks every other part of Phase 6. A backfill that imports 90 days of
 * past meetings is soft-deleted by the next completed sweep, because Calendly
 * declares `retireOutsideWindow {now-30d, now+90d}` and `syncStream` prunes
 * outside it. Fetching deeper without declaring deeper is not a partial fix; it
 * is a way to spend provider calls on rows that are tombstoned minutes later.
 *
 * So the test that matters is not "does it fetch further back" but "does what
 * it FETCHES match what it DECLARES" — those two numbers are what cannot be
 * allowed to disagree.
 */

const DAY = 86_400_000;

function serveEmpty() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("/users/me")
        ? { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } }
        : { collection: [], pagination: { next_page_token: null } };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return urls;
}

const poll = (windowFloor: Date | null) =>
  calendlyConnector.poll!({
    connectionId: "c1",
    cursor: null,
    credentials: { accessToken: "t" },
    config: { scope: "user" },
    streamHash: "h1",
    windowFloor,
  });

/** The `min_start_time` the request actually asked the provider for. */
const requestedFloor = (urls: string[]): Date => {
  const listing = urls.find((u) => u.includes("min_start_time"))!;
  return new Date(new URL(listing).searchParams.get("min_start_time")!);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a stream's window drives the request AND the retire", () => {
  it("uses the connector default when the stream declares nothing", async () => {
    const urls = serveEmpty();
    const res = await poll(null);

    const floor = requestedFloor(urls);
    const declared = res.retireOutsideWindow!.from;
    expect(declared.getTime()).toBe(floor.getTime());
    // ~30 days back, the connector's own default.
    expect(Math.round((Date.now() - floor.getTime()) / DAY)).toBe(30);
  });

  it("reaches back to the stream's floor when it has one", async () => {
    const deep = new Date(Date.now() - 90 * DAY);
    const urls = serveEmpty();
    const res = await poll(deep);

    expect(Math.round((Date.now() - requestedFloor(urls).getTime()) / DAY)).toBe(90);
    expect(res.retireOutsideWindow!.from.getTime()).toBe(requestedFloor(urls).getTime());
  });

  /**
   * THE assertion of 6.2, stated as the thing that must never differ. A
   * deepened stream whose declaration still described the default would fetch
   * 90 days and then retire everything older than 30 on the same sweep.
   */
  it("never declares a window narrower than the one it fetched", async () => {
    for (const days of [30, 45, 90, 365]) {
      vi.unstubAllGlobals();
      const urls = serveEmpty();
      const res = await poll(new Date(Date.now() - days * DAY));

      const fetched = requestedFloor(urls).getTime();
      const declared = res.retireOutsideWindow!.from.getTime();
      expect(declared, `declared window must not be newer than the fetched floor at ${days}d`).toBeLessThanOrEqual(fetched);
    }
  });

  /**
   * A floor NEWER than the default would narrow the window, and narrowing
   * retires history the stream is supposed to hold. Degrading to the default is
   * the only safe reading of a nonsensical value.
   */
  it("ignores a floor that would narrow the window", async () => {
    const shallow = new Date(Date.now() - 5 * DAY);
    const urls = serveEmpty();
    const res = await poll(shallow);

    expect(Math.round((Date.now() - requestedFloor(urls).getTime()) / DAY)).toBe(30);
    expect(res.retireOutsideWindow!.from.getTime()).toBe(requestedFloor(urls).getTime());
  });
});
