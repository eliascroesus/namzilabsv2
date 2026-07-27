import { describe, it, expect, vi, afterEach } from "vitest";
import { closeConnector } from "@/connectors/close";
import { sendblueConnector } from "@/connectors/sendblue";
import { instantlyConnector } from "@/connectors/instantly";
import type { CanonicalEvent, Connector } from "@/connectors/types";

/**
 * ONE contract, enforced on every windowed connector: **a poll may not leave a
 * record unreachable.**
 *
 * Each of these walks a bounded number of pages per call and carries the rest
 * forward in its cursor. The failure mode is always the same shape and always
 * invisible from the outside — the cursor jumps to the NEWEST record seen
 * instead of persisting a continuation, so everything between the newest page
 * and the previous mark is never requested by anything again. It is not an
 * error, it is not a zero, it is not a slow sync. The rows simply are not there,
 * and nothing says so.
 *
 * It has now happened twice (Close, "Defect #2") and shipped a third time
 * (Sendblue, which grew the multi-page walk but not the continuation — raising
 * the burst threshold from 100 to 300 rather than removing it). Both were found
 * by reading, not by a test, which is why this file exists: a burst deeper than
 * one poll's budget, walked to exhaustion, asserting the union is complete.
 *
 * Adding a connector with a paged poll means adding a case here.
 */

const DAY = 86_400_000;
/** Sweeps a case may take to drain. Generous — this bounds the loop, not the contract. */
const MAX_SWEEPS = 25;

function respond(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Case = {
  source: string;
  connector: Connector;
  config?: Record<string, unknown>;
  credentials: Record<string, unknown>;
  /** Records to synthesize — must exceed this connector's pages × pageSize. */
  total: number;
  /** Stub fetch with a provider holding `total` records, newest-first. */
  serve: (total: number) => void;
  /** The natural id carried on a canonical event, for set comparison. */
  idOf: (e: CanonicalEvent) => string;
};

/** ids `r1` (oldest) … `rN` (newest), one minute apart, ending an hour ago. */
function timeline(total: number): Array<{ id: string; at: string }> {
  const end = Date.now() - 3_600_000;
  return Array.from({ length: total }, (_, i) => ({
    id: `r${i + 1}`,
    at: new Date(end - (total - 1 - i) * 60_000).toISOString(),
  }));
}

const CASES: Case[] = [
  {
    source: "close",
    connector: closeConnector,
    credentials: { apiKey: "k" },
    total: 260, // 4 pages × 50 = 200 per poll
    serve(total) {
      const newestFirst = [...timeline(total)].reverse();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const p = new URL(String(input)).searchParams;
          const gte = p.get("date_created__gte");
          const rows = newestFirst
            .filter((r) => !gte || Date.parse(r.at) >= Date.parse(gte))
            .map((r) => ({ id: r.id, object_type: "activity.sms", action: "created", date_created: r.at }));
          const offset = p.get("_cursor") ? Number(p.get("_cursor")) : 0;
          const page = rows.slice(offset, offset + Number(p.get("_limit") ?? 50));
          return respond({ data: page, cursor_next: offset + page.length < rows.length ? String(offset + page.length) : null });
        }),
      );
    },
    idOf: (e) => e.eventId.split(":").pop()!,
  },
  {
    source: "sendblue",
    connector: sendblueConnector,
    credentials: { apiKey: "kid", apiSecret: "ksec" },
    total: 420, // 3 pages × 100 = 300 per poll
    serve(total) {
      const newestFirst = [...timeline(total)].reverse();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const p = new URL(String(input)).searchParams;
          const offset = Number(p.get("offset") ?? 0);
          const limit = Number(p.get("limit") ?? 100);
          const page = newestFirst.slice(offset, offset + limit).map((r) => ({
            message_handle: r.id,
            status: "DELIVERED",
            is_outbound: true,
            to_number: "+15551230000",
            date_sent: r.at,
          }));
          return respond({ messages: page });
        }),
      );
    },
    idOf: (e) => e.eventId.split(":").pop()!,
  },
  {
    source: "instantly",
    connector: instantlyConnector,
    config: { streamType: "raw_emails", campaignId: "camp1", days: 30 },
    credentials: { apiKey: "k" },
    total: 210, // 3 pages × 50 = 150 per poll
    serve(total) {
      const newestFirst = [...timeline(total)].reverse();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const p = new URL(String(input)).searchParams;
          const after = p.get("starting_after");
          const start = after ? newestFirst.findIndex((r) => r.id === after) + 1 : 0;
          const limit = Number(p.get("limit") ?? 50);
          const page = newestFirst.slice(start, start + limit);
          return respond({
            items: page.map((r) => ({ id: r.id, ue_type: 1, timestamp_created: r.at, to_address_email_list: "a@b.io" })),
            next_starting_after: start + page.length < newestFirst.length ? page[page.length - 1]?.id ?? null : null,
          });
        }),
      );
    },
    idOf: (e) => e.eventId.split(":").pop()!,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("no poll may strand a record", () => {
  for (const c of CASES) {
    it(`${c.source}: a burst deeper than one poll's budget is reachable in full`, async () => {
      const seen = new Set<string>();
      let cursor: string | null = null;
      let sweeps = 0;

      // Drain the way the sweep does: feed each nextCursor straight back.
      //
      // "Settled" is NOT `nextCursor == null`. These connectors return their
      // high-water mark when a window drains, because null means START OVER
      // (PollResult.nextCursor) and re-importing everything every sweep is the
      // opposite of what they want. So the walk is over when a sweep is no
      // longer mid-continuation AND brought nothing new.
      for (; sweeps < MAX_SWEEPS; sweeps++) {
        c.serve(c.total);
        const res = await c.connector.poll!({
          connectionId: "c1",
          cursor,
          credentials: c.credentials,
          config: c.config,
        });
        const before = seen.size;
        for (const r of res.records) seen.add(c.idOf(r));
        cursor = res.nextCursor;
        const midWalk = typeof cursor === "string" && cursor.startsWith("{");
        if (cursor == null || (!midWalk && seen.size === before)) break;
      }

      expect(sweeps).toBeLessThan(MAX_SWEEPS); // the walk terminated on its own
      const missing = Array.from({ length: c.total }, (_, i) => `r${i + 1}`).filter((id) => !seen.has(id));
      // Naming the oldest few makes a failure diagnosable: stranding always
      // eats the OLDEST end of the burst, never a random scatter.
      expect({ missing: missing.slice(0, 5), count: missing.length }).toEqual({ missing: [], count: 0 });
    });
  }

  /**
   * The other half of the contract. A connector that has more to fetch must not
   * report a mark implying it is finished — that is the exact step by which a
   * stranded record becomes unreachable rather than merely late.
   */
  it("a cursor that still has work encodes a continuation, not a bare high-water mark", async () => {
    for (const c of CASES) {
      c.serve(c.total);
      const first = await c.connector.poll!({
        connectionId: "c1",
        cursor: null,
        credentials: c.credentials,
        config: c.config,
      });
      expect(first.nextCursor, `${c.source} stopped mid-burst with no cursor`).not.toBeNull();
      expect(
        first.nextCursor!.startsWith("{"),
        `${c.source} returned a bare mark mid-burst — everything older than this page is now unreachable`,
      ).toBe(true);
      vi.unstubAllGlobals();
    }
  });
});

/**
 * A window that is genuinely exhausted must settle, or every sweep re-imports
 * the same history forever. This is the counterweight to the assertions above:
 * "never strand" is trivially satisfiable by never advancing.
 */
describe("a drained window settles", () => {
  it("close: a burst inside one poll's budget drains in a single sweep", async () => {
    const c = CASES[0];
    c.serve(120); // under 200
    const res = await c.connector.poll!({ connectionId: "c1", cursor: null, credentials: c.credentials });
    expect(res.records).toHaveLength(120);
    expect(res.nextCursor!.startsWith("{")).toBe(false); // plain high-water mark
    expect(res.incomplete).toBeFalsy();
  });
});

/** Guards against a case being silently dropped from the table. */
it("covers every connector with a paged poll", () => {
  expect(CASES.map((c) => c.source).sort()).toEqual(["close", "instantly", "sendblue"]);
  expect(CASES.every((c) => c.total > 0)).toBe(true);
});

/** Days are only used to keep fixtures inside every connector's own window. */
it("fixtures sit inside the connectors' first-sync windows", () => {
  for (const c of CASES) {
    const oldest = Date.parse(timeline(c.total)[0].at);
    expect(Date.now() - oldest).toBeLessThan(30 * DAY);
  }
});
