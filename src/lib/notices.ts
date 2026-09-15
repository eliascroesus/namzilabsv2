import { and, desc, eq, sql } from "drizzle-orm";
import { connections, flowResults, flows } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * WHAT IS BROKEN RIGHT NOW — the list behind the top bar's bell.
 *
 * THE BELL USED TO BE A LIE. It rendered with `unread = 1` as a DEFAULT and
 * nobody ever passed it, so every workspace in the product carried a permanent
 * blue "1" over a button that did nothing when pressed. A badge that is always
 * on is worse than no badge: it trains the one habit a notification exists to
 * break, which is looking.
 *
 * SO THIS READS THE TWO THINGS THAT CAN ACTUALLY BE BROKEN, and nothing else.
 * Not a feed, not announcements, not "your import finished" — a list of things
 * that are wrong and are costing the customer a number they expected to have:
 *
 *   - a CONNECTION that is erroring, paused by its breaker, or disabled
 *     while flows still read from it;
 *   - a published METRIC whose last compute failed.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. `importing` and `computing` are expected
 * work — `attentionOf` on the dashboard makes the same call and for the same
 * reason: floating every backfilling metric on the day a workspace connects an
 * app would make the bell useless exactly when it is most looked at. `stale` is
 * also out: a metric that is merely behind recovers on the next sweep without
 * anybody doing anything, and the tile already says so on its own face.
 *
 * The SHAPING is pure (`noticesFrom`) and the READ is three lines around it, so
 * the rules can be tested without a database — which matters here, because the
 * rules are the whole feature and the queries are not.
 */

/** One thing that is wrong, in the order a person would want to hear it. */
export type Notice = {
  /** Stable within a render — the row's own id, so React keys do not collide. */
  id: string;
  kind: "connection" | "metric";
  /** `error` is broken now; `warn` is degraded and will retry itself. */
  severity: "error" | "warn";
  /** The thing's own name — "Calendly", "Meetings booked". Never a code. */
  title: string;
  /** One line saying what is wrong, in the product's words or the provider's. */
  detail: string;
  /** Where to go and do something about it. */
  href: string;
};

/** The shape the read hands the shaper, so a test can build one by hand. */
export type ConnectionRow = {
  id: string;
  name: string;
  source: string;
  status: string;
  syncStatus: string;
  lastError: string | null;
  pausedUntil: Date | null;
  pausedReason: string | null;
};

export type MetricRow = {
  id: string;
  flowId: string;
  name: string | null;
  error: string | null;
};

/** How many the panel will draw before it stops and says how many are left. */
export const NOTICE_LIMIT = 12;

/**
 * A provider's error text is not a sentence anybody wants in a panel — it
 * arrives as `401 Unauthorized {"error":"token expired"}` or worse, and at full
 * length it pushes every other notice off the screen. One line, trimmed, and
 * the connection page has the whole thing.
 */
function oneLine(text: string | null | undefined, fallback: string): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return fallback;
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

/**
 * THE RULES, WITH NO DATABASE IN THEM.
 *
 * `now` is a parameter rather than `new Date()` because a paused connection's
 * message depends on the clock, and a rule that reads the clock itself is a
 * rule that cannot be tested at the two minutes either side of the boundary.
 */
export function noticesFrom(
  input: { connections: ConnectionRow[]; metrics: MetricRow[] },
  now: Date = new Date(),
): Notice[] {
  const out: Notice[] = [];

  for (const c of input.connections) {
    const href = `/integrations?connection=${encodeURIComponent(c.id)}`;
    if (c.status === "error" || c.syncStatus === "error") {
      out.push({
        id: `conn:${c.id}`,
        kind: "connection",
        severity: "error",
        title: c.name,
        detail: oneLine(c.lastError, "This connection stopped working. Reconnect it to start receiving records again."),
        href,
      });
      continue;
    }
    /**
     * PAUSED IS A WARNING, NOT AN ERROR, and the distinction is the product's
     * own: `pausedUntil` is never a terminal state (see the schema note) — the
     * breaker retries on its own. Saying "broken" about something that will fix
     * itself in an hour is how a panel loses the reader's trust for the notice
     * underneath it that will not.
     */
    if (c.pausedUntil && c.pausedUntil.getTime() > now.getTime()) {
      out.push({
        id: `conn:${c.id}`,
        kind: "connection",
        severity: "warn",
        title: c.name,
        detail: oneLine(c.pausedReason, "Paused after repeated failures. It will retry on its own."),
        href,
      });
      continue;
    }
    // Disabled is a CHOICE somebody made, so it is only worth saying when it
    // is still costing something — and from here that is unknowable, so it is
    // left to the Apps page rather than guessed at in a bell.
  }

  for (const m of input.metrics) {
    out.push({
      id: `metric:${m.id}`,
      kind: "metric",
      severity: "error",
      title: m.name?.trim() || "A published metric",
      detail: oneLine(m.error, "Its last recompute failed, so the tile is showing nothing."),
      href: `/dashboard/flows/${m.flowId}`,
    });
  }

  // Errors above warnings, and connections above metrics inside each — a broken
  // connection is usually the CAUSE of the broken metric under it, and a list
  // that puts the symptom first sends somebody to fix the wrong thing.
  const rank = (n: Notice) => (n.severity === "error" ? 0 : 1) * 2 + (n.kind === "connection" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * The read. Two queries, both capped, both walled by `org_id` — this runs in
 * the shell on every authenticated route, so it may not be expensive and it may
 * not be allowed to fail: a bell that throws takes the whole frame with it.
 */
export async function listNotices(db: DB, orgId: string): Promise<Notice[]> {
  const cap = NOTICE_LIMIT + 1; // one over, so "and N more" can be honest
  const [conns, metrics] = await Promise.all([
    db
      .select({
        id: connections.id,
        name: connections.name,
        source: connections.source,
        status: connections.status,
        syncStatus: connections.syncStatus,
        lastError: connections.lastError,
        pausedUntil: connections.pausedUntil,
        pausedReason: connections.pausedReason,
      })
      .from(connections)
      .where(
        and(
          eq(connections.orgId, orgId),
          // Only rows that could possibly produce a notice. The alternative is
          // reading every connection in the workspace on every page render.
          sql`(${connections.status} = 'error' or ${connections.syncStatus} = 'error' or ${connections.pausedUntil} > now())`,
        ),
      )
      .limit(cap),
    db
      .select({ id: flowResults.id, flowId: flowResults.flowId, name: flows.name, error: flowResults.error })
      .from(flowResults)
      .innerJoin(flows, eq(flows.id, flowResults.flowId))
      .where(and(eq(flowResults.orgId, orgId), eq(flowResults.status, "error")))
      .orderBy(desc(flowResults.createdAt))
      .limit(cap),
  ]);
  return noticesFrom({ connections: conns, metrics });
}
