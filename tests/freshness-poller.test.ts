import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resultsEtag } from "@/lib/flow/results-etag";

/**
 * C16 — the freshness poller's ref started `null` on mount, so `changed =
 * etag.current != null && nextTag !== etag.current` was FORCED false on the
 * very first comparison no matter what the beacon said. A results change
 * landing between the server render and the first poll was invisible until
 * some unrelated later recompute happened to bump the tag again. `initialVersion`
 * seeds the ref from the version the page actually rendered, so the first
 * poll compares against something real — and, as a side effect, sends
 * `If-None-Match` from the very first request instead of the second.
 *
 * `react` and `next/navigation` are mocked wholesale, in the mock-then-
 * dynamic-import style `tests/board-render.test.ts` uses: `FreshnessPoller`
 * is called directly as a plain function rather than rendered, its
 * `useEffect` body captured instead of run by a renderer, and stepped by
 * hand. This is a node-environment suite with no jsdom, and the component's
 * own logic (the ETag comparison, the If-None-Match header) has nothing to
 * do with the DOM — only `document`/`window` need stubs, for the
 * visibility gate and the activity listeners.
 */

let effects: Array<() => void | (() => void)> = [];
const router = { refresh: vi.fn(), push: vi.fn() };

vi.mock("react", () => ({
  useRef: (v: unknown) => ({ current: v }),
  useEffect: (fn: () => void | (() => void)) => {
    effects.push(fn);
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { FreshnessPoller } = await import("@/components/freshness-poller");
type Props = Parameters<typeof FreshnessPoller>[0];

/** Runs `FreshnessPoller`, captures its one effect, and runs it — mirroring mount. */
function mount(props: Props): () => void {
  effects.length = 0;
  FreshnessPoller(props);
  expect(effects).toHaveLength(1);
  const cleanup = effects[0]();
  expect(typeof cleanup).toBe("function");
  return cleanup as () => void;
}

/**
 * Fires the one pending timer and drains the microtask queue behind it.
 *
 * NOT `vi.advanceTimersByTimeAsync` / `runAllTimersAsync`: `tick` reschedules
 * itself at the end of every run (that is the whole poller), so an
 * auto-looping advance keeps discovering a freshly-queued zero-delay timer
 * and either spins until Sinon's loop guard aborts it or runs far more polls
 * than the test wants. A synchronous advance fires exactly the timer(s) due
 * right now and returns before `tick`'s post-`await` code has run — nothing
 * new has been scheduled yet — so draining microtasks afterward completes
 * precisely one poll, and the test decides if and when there is a next one.
 */
async function runOnePoll(): Promise<void> {
  vi.advanceTimersByTime(0);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function response(status: number, etag: string | null): unknown {
  return { status, headers: { get: () => etag } };
}

beforeEach(() => {
  effects = [];
  router.refresh.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("window", {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FreshnessPoller seeded from the server render (C16)", () => {
  it("refreshes on the first poll when the version moved since render", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, resultsEtag("v2")));
    vi.stubGlobal("fetch", fetchMock);

    const cleanup = mount({ initialVersion: "v1", intervalMs: 0 });
    await runOnePoll();

    // Sabotage: null out the seed (today's code) and this is the first thing
    // that goes red — `changed` never fires because `etag.current` is null.
    expect(router.refresh).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("sends the render-time tag as If-None-Match on the very first poll", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(304, null));
    vi.stubGlobal("fetch", fetchMock);

    const cleanup = mount({ initialVersion: "v1", intervalMs: 0 });
    await runOnePoll();

    // Sabotage: today's code sends `{}` on the first request — there is no
    // seed to put in the header yet.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: unknown }];
    expect(init.headers).toEqual({ "if-none-match": resultsEtag("v1") });
    cleanup();
  });

  it("does not refresh on a 304, or when the tag comes back unchanged", async () => {
    // A 304 IS "unchanged" — the beacon route says so directly.
    const fetchMock = vi.fn().mockResolvedValue(response(304, null));
    vi.stubGlobal("fetch", fetchMock);
    let cleanup = mount({ initialVersion: "v1", intervalMs: 0 });
    await runOnePoll();
    expect(router.refresh).not.toHaveBeenCalled();
    cleanup();

    // A 200 carrying the exact tag already held is the same fact by a
    // different door — a server that answers without conditional support.
    router.refresh.mockClear();
    fetchMock.mockResolvedValue(response(200, resultsEtag("v1")));
    cleanup = mount({ initialVersion: "v1", intervalMs: 0 });
    await runOnePoll();
    expect(router.refresh).not.toHaveBeenCalled();
    cleanup();
  });

  it("without a seed, records the tag on the first poll and acts on it from the second", async () => {
    // Today's behaviour, unchanged: nothing to compare the first answer
    // against, so it is only ever recorded, never compared, on poll one.
    const fetchMock = vi.fn().mockResolvedValueOnce(response(200, resultsEtag("vA")));
    vi.stubGlobal("fetch", fetchMock);

    const cleanup = mount({ intervalMs: 0 }); // no initialVersion
    await runOnePoll();
    expect(router.refresh).not.toHaveBeenCalled();

    // Second poll: the tag now differs from what was recorded on the first.
    fetchMock.mockResolvedValueOnce(response(200, resultsEtag("vB")));
    await runOnePoll();
    expect(router.refresh).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
