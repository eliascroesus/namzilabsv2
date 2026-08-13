import { describe, it, expect, vi, afterEach } from "vitest";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import type { CanonicalEvent, Connector } from "@/connectors/types";

/**
 * THE CONTRACT LANE — the CI half of the verification gate in
 * `docs/CONNECTOR_SPEC_PROPOSAL.md` §1.4.
 *
 * `stranding-contract.test.ts` already asks the one question that class of bug
 * turns on: can a record become unreachable. This file asks the questions that
 * would have caught the OTHER two, both of which shipped and neither of which
 * any fixture could fail:
 *
 * 1. **Does the connector bound its window on the field it advances its cursor
 *    on?** Close bounded on `date_created` and advanced on `date_created`, while
 *    the endpoint filtered on `date_updated` — so the bound was discarded and
 *    the pairing would have lost records the moment it was corrected halfway.
 * 2. **Is an ordering assumption DECLARED?** A walk that stops when a page falls
 *    below its floor is assuming the provider sorts newest-first. That is a fine
 *    thing to assume and a terrible thing to assume silently, because every
 *    fixture anyone writes satisfies it.
 *
 * WHAT THIS LANE CANNOT DO, stated so nobody trusts it further than it goes: a
 * mock is built from the declaration, so it honours whatever the declaration
 * says. It cannot discover that a provider ignores a parameter — that needs the
 * live lane (`scripts/verify-close-pagination.ts` SECTION 0). This file proves
 * the code agrees with what we believe; only the live run tests the belief.
 */

const DAY = 86_400_000;

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

type Row = Record<string, unknown>;

type Contract = {
  source: string;
  connector: Connector;
  credentials: Record<string, unknown>;
  config?: Record<string, unknown>;
  /**
   * The query parameter that bounds the window SERVER-side, or null when the
   * connector fetches unbounded and filters in its own loop.
   *
   * Null is a real answer and not a gap — but it is the shape that makes a walk
   * depend on ordering, so the two fields below are usually not independent.
   */
  boundParam: string | null;
  /** The payload field whose maximum must become the next cursor. */
  cursorField: string;
  /** A second date field on the same record that must NOT drive the cursor. */
  decoyField: string;
  /**
   * Does this walk depend on the provider returning newest-first?
   *
   * Declared rather than discovered, and asserted either way: a connector that
   * says "no" is run against a reversed log and must still be complete; a
   * connector that says "yes" must DEMONSTRABLY degrade when reversed, or the
   * declaration is stale and somebody will delete the live check that guards it.
   */
  assumesNewestFirst: boolean;
  /** Build one provider record with the two date axes set independently. */
  row: (id: string, cursorAt: string, decoyAt: string) => Row;
  /** Stub `fetch` with a provider holding exactly `rows`, in the given order. */
  serve: (rows: Row[]) => { calls: URLSearchParams[] };
  /** Records needed to exceed one poll's page budget. */
  burst: number;
  /** Pull the high-water mark out of whatever cursor shape this connector uses. */
  mark: (cursor: string | null) => string | null;
};

/** `{hw, cont, maxSeen}`, serialized plain when idle and JSON mid-walk. */
const hwMark = (cursor: string | null): string | null => {
  if (!cursor) return null;
  if (!cursor.startsWith("{")) return cursor;
  const p = JSON.parse(cursor) as { hw?: string | null; maxSeen?: string | null };
  return p.maxSeen ?? p.hw ?? null;
};

const CONTRACTS: Contract[] = [
  {
    source: "close",
    connector: closeConnector,
    credentials: { apiKey: "k" },
    boundParam: "date_updated__gte",
    cursorField: "date_updated",
    decoyField: "date_created",
    // Close ingests every record on every page and stops only on cursor
    // exhaustion, so a reversed log costs nothing.
    assumesNewestFirst: false,
    row: (id, cursorAt, decoyAt) => ({
      id,
      object_type: "activity.sms",
      action: "created",
      date_updated: cursorAt,
      date_created: decoyAt,
    }),
    serve(rows) {
      const calls: URLSearchParams[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const p = new URL(String(input)).searchParams;
          calls.push(p);
          const gte = p.get("date_updated__gte");
          const kept = gte ? rows.filter((r) => Date.parse(String(r.date_updated)) >= Date.parse(gte)) : rows;
          const offset = p.get("_cursor") ? Number(p.get("_cursor")) : 0;
          const page = kept.slice(offset, offset + Number(p.get("_limit") ?? 50));
          return respond({ data: page, cursor_next: offset + page.length < kept.length ? String(offset + page.length) : null });
        }),
      );
      return { calls };
    },
    burst: 260,
    mark: hwMark,
  },
  {
    source: "instantly",
    connector: instantlyConnector,
    config: { streamType: "raw_emails", campaignId: "camp1", days: 30 },
    credentials: { apiKey: "k" },
    // Sends `limit` and `campaign_id` only — the window is applied in its own
    // loop, after the provider has returned whatever it chose to.
    boundParam: null,
    cursorField: "timestamp_created",
    decoyField: "timestamp_email",
    // Its walk stops on `pageAllBelowFloor`, which is only correct if the oldest
    // records arrive last. See the assertion below for what that costs.
    assumesNewestFirst: true,
    row: (id, cursorAt, decoyAt) => ({
      id,
      ue_type: 1,
      timestamp_created: cursorAt,
      timestamp_email: decoyAt,
      to_address_email_list: "a@b.io",
    }),
    serve(rows) {
      const calls: URLSearchParams[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const p = new URL(String(input)).searchParams;
          calls.push(p);
          const after = p.get("starting_after");
          const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
          const page = rows.slice(start, start + Number(p.get("limit") ?? 50));
          return respond({
            items: page,
            next_starting_after: start + page.length < rows.length ? (page[page.length - 1]?.id ?? null) : null,
          });
        }),
      );
      return { calls };
    },
    burst: 210,
    mark: hwMark,
  },
];

/**
 * `n` records one minute apart ending an hour ago, NEWEST FIRST, with the decoy
 * axis running the other way AND offset a day back.
 *
 * Both properties are load-bearing and the first draft of this fixture had
 * neither. Running the axes in opposite directions is not enough on its own —
 * mirrored ranges share a maximum, so a connector reading the wrong field lands
 * on the right answer by coincidence and the test passes while proving nothing.
 * The day of offset is what separates the two maxima.
 */
function skewed(c: Contract, n: number): Row[] {
  const end = Date.now() - 3_600_000;
  const rows = Array.from({ length: n }, (_, i) => {
    const cursorAt = new Date(end - (n - 1 - i) * 60_000).toISOString();
    const decoyAt = new Date(end - DAY - i * 60_000).toISOString();
    return c.row(`r${i + 1}`, cursorAt, decoyAt);
  });
  return rows.reverse(); // newest cursorField first
}

/**
 * Records that STRADDLE the first-sync floor: `out` of them well outside the
 * 30-day window, `inside` of them from the last hour, newest first.
 *
 * The ordering test needs this and the fixture above cannot substitute. A walk
 * that stops when a page falls below its floor only reveals that dependence when
 * a page actually IS below the floor — with every record inside the window the
 * early exit never fires and an order-dependent connector looks
 * order-independent. That is exactly what the first version of this file
 * concluded, wrongly.
 */
function straddle(c: Contract, inside: number, out: number): Row[] {
  const now = Date.now();
  const recent = Array.from({ length: inside }, (_, i) => {
    const at = new Date(now - 3_600_000 - (inside - 1 - i) * 60_000).toISOString();
    return c.row(`in${i + 1}`, at, at);
  }).reverse();
  const ancient = Array.from({ length: out }, (_, i) => {
    const at = new Date(now - 60 * DAY - (out - 1 - i) * 60_000).toISOString();
    return c.row(`out${i + 1}`, at, at);
  }).reverse();
  return [...recent, ...ancient]; // newest first, oldest last
}

const idOf = (e: CanonicalEvent) => e.eventId.split(":").pop()!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a connector's cursor comes from the field it filters on", () => {
  for (const c of CONTRACTS.filter((x) => x.boundParam)) {
    it(`${c.source}: bounds on ${c.boundParam} and advances on ${c.cursorField}`, async () => {
      const rows = skewed(c, 40);
      const { calls } = c.serve(rows);
      const res = await c.connector.poll!({ connectionId: "c1", cursor: null, credentials: c.credentials, config: c.config });

      for (const p of calls) {
        expect(p.get(c.boundParam!), `${c.source} issued a request with no ${c.boundParam}`).not.toBeNull();
      }
      // The mark must be the newest value of the FILTERED field. On this fixture
      // the decoy's newest is the filtered field's OLDEST, so reading the wrong
      // one is off by the whole span rather than by a rounding error.
      const newestCursorField = rows
        .map((r) => String(r[c.cursorField]))
        .sort()
        .pop()!;
      const newestDecoy = rows
        .map((r) => String(r[c.decoyField]))
        .sort()
        .pop()!;
      expect(Date.parse(c.mark(res.nextCursor)!)).toBe(Date.parse(newestCursorField));
      expect(
        Date.parse(c.mark(res.nextCursor)!),
        `${c.source} advanced its cursor from ${c.decoyField}, which the window is not filtered on`,
      ).not.toBe(Date.parse(newestDecoy));
    });
  }
});

/**
 * THE ORDERING ASSUMPTION, made explicit.
 *
 * Every fixture anyone writes serves newest-first, because that is what the
 * providers do — so a walk that silently depends on it passes every test until
 * a provider changes and it returns nothing. Both directions are asserted here
 * so the declaration cannot rot: a connector claiming independence must survive
 * reversal, and one claiming dependence must actually break under it.
 */
describe("ordering assumptions are declared, and the declaration is true", () => {
  const drain = async (c: Contract, rows: Row[]) => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let sweep = 0; sweep < 12; sweep++) {
      c.serve(rows);
      const res = await c.connector.poll!({ connectionId: "c1", cursor, credentials: c.credentials, config: c.config });
      const before = seen.size;
      for (const r of res.records) seen.add(idOf(r));
      cursor = res.nextCursor;
      vi.unstubAllGlobals();
      const midWalk = typeof cursor === "string" && cursor.startsWith("{");
      if (!midWalk && seen.size === before) break;
    }
    return seen;
  };

  /** In-window records, and enough out-of-window ones to fill a first page. */
  const INSIDE = 130;
  const OUTSIDE = 130;
  const inWindow = (seen: Set<string>) => [...seen].filter((id) => id.startsWith("in")).length;

  for (const c of CONTRACTS.filter((x) => !x.assumesNewestFirst)) {
    it(`${c.source}: declares no ordering dependence — and survives a reversed log`, async () => {
      const rows = straddle(c, INSIDE, OUTSIDE);
      expect(inWindow(await drain(c, rows)), `${c.source} could not drain a newest-first log`).toBe(INSIDE);
      expect(
        inWindow(await drain(c, [...rows].reverse())),
        `${c.source} claims order-independence but lost in-window records on a reversed log`,
      ).toBe(INSIDE);
    });
  }

  for (const c of CONTRACTS.filter((x) => x.assumesNewestFirst)) {
    /**
     * Not a bug report — a PIN. These connectors stop walking when a whole page
     * sits below their floor, which is correct only while the oldest records
     * arrive last. This asserts the dependence is real, so that:
     *
     *   - nobody deletes the live ordering check believing it is cosmetic, and
     *   - the day a connector is made order-independent, this test fails and
     *     forces the declaration above to be corrected.
     *
     * What it costs in production is in the message: on a reversed log the first
     * page is all below the floor, the walk stops before reaching anything newer,
     * and the mark does not advance — so the next sweep repeats it. Not a partial
     * import: no import at all, with no error.
     */
    it(`${c.source}: declares an ordering dependence — and it is real, not stale`, async () => {
      const rows = straddle(c, INSIDE, OUTSIDE);
      expect(inWindow(await drain(c, rows)), `${c.source} could not drain even a newest-first log`).toBe(INSIDE);

      const reversed = inWindow(await drain(c, [...rows].reverse()));
      expect(
        reversed,
        `${c.source} survived a reversed log — the assumesNewestFirst declaration is now stale, correct it`,
      ).toBeLessThan(INSIDE);
    });
  }
});

/** Guards against a connector being quietly dropped from the table. */
it("covers every connector with a windowed poll", () => {
  expect(CONTRACTS.map((c) => c.source).sort()).toEqual(["close", "instantly"]);
});

it("fixtures sit inside every connector's own first-sync window", () => {
  for (const c of CONTRACTS) {
    const oldest = Math.min(...skewed(c, c.burst).map((r) => Date.parse(String(r[c.cursorField]))));
    expect(Date.now() - oldest, `${c.source} fixture is older than its window`).toBeLessThan(30 * DAY);
  }
});
