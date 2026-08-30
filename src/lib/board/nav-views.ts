import { cache } from "react";
import { getReadDb } from "@/db/client";
import { listBoardViews } from "./store";
import type { BoardView } from "./types";

/**
 * THE VIEW LIST, RESOLVED ONCE PER REQUEST — and that is the entire point.
 *
 * The rail shows a workspace's views nested under Dashboard, so it needs them on
 * every authenticated route. That is exactly the read `AppShell` is documented
 * as the wrong place for: it renders on ten routes, it runs strictly AFTER the
 * page's own awaits, and `FreshnessPoller` re-renders it every twelve seconds in
 * every open tab. `metricCount` is passed down from the page for precisely this
 * reason. A view list cannot be — the whole feature is jumping to a view from
 * somewhere that is not the dashboard.
 *
 * React's `cache()` is the way out, and the codebase already relies on it for
 * the same shape of problem: `requestAccess` is cached so that "AppShell shares
 * this very promise" rather than re-resolving what the page just resolved. Same
 * here, with a better payoff, because the DASHBOARD — the one route where this
 * read would be duplicated, and the one route that re-renders on a timer —
 * already lists views for its own tab strip. On that route the rail costs
 * nothing at all: it awaits a promise that is already in flight.
 *
 * On the other nine it is one narrow read of a handful of rows on an indexed
 * column, and `AppShell` starts it BEFORE its own await so it overlaps rather
 * than queues.
 *
 * NOT `unstable_cache`, deliberately. A stored cache would need invalidating
 * from the view actions, and those actions document at length why they must not
 * revalidate the dashboard: `BoardLayout` seeds its arrangement once and a
 * revalidation mid-drag races it. A per-request cache has nothing to invalidate,
 * so a view created, renamed or deleted is in the rail on the very next render
 * with no cache-busting to get wrong.
 */
export const navViews = cache(async (orgId: string): Promise<BoardView[]> => listBoardViews(getReadDb(), orgId));

/**
 * The same list, but never throwing — for the SHELL, which must render even
 * when a read fails.
 *
 * The dashboard turns a failed view read into its load-error banner, because
 * there the views ARE the page. In the rail they are a convenience: a workspace
 * whose view list could not be fetched still needs its navigation, and a chrome
 * that 500s because a nested list of links was unavailable would take out every
 * route at once. So the rail degrades to the six destinations it always had.
 */
export async function navViewsOrNone(orgId: string): Promise<BoardView[]> {
  try {
    return await navViews(orgId);
  } catch (err) {
    console.error("[rail] view list read failed", err);
    return [];
  }
}
