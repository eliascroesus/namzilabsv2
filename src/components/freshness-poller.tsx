"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { resultsEtag } from "@/lib/flow/results-etag";

/**
 * G.4 client wire-up: poll the results-version beacon and refresh the
 * (server-rendered) dashboard when it moves. Deliberately near-free:
 * - visibility-gated — a background tab polls nothing;
 * - conditional — If-None-Match makes an unchanged poll a bodyless 304;
 * - refresh only fires on an actual version change, so server re-renders
 *   scale with data-change rate, not with viewers.
 *
 * AND NOW: IT SLOWS DOWN WHEN NOBODY IS THERE.
 *
 * The three properties above made each poll cheap and stopped short of the one
 * that actually costs money. Neon bills the hours the compute endpoint is
 * AWAKE, and it stays awake for the whole autosuspend window after the last
 * query — so a `count(*)` every twelve seconds does not cost twelve seconds of
 * compute, it holds the database open indefinitely. A dashboard left open on a
 * second monitor overnight kept the endpoint awake until morning, entirely on
 * its own, to fetch a 304 nine hours in a row.
 *
 * Visibility alone does not catch that: the tab is VISIBLE, nobody is looking
 * at it. So the cadence follows the last sign of a human instead.
 *
 * ACCURACY IS UNCHANGED WHERE IT CAN BE OBSERVED, which is the whole argument
 * for doing it this way. The fast rung is exactly the case where somebody is
 * present; the slow rungs are reached only after minutes of no interaction, and
 * ANY touch — pointer, key, scroll, focus, tab switch — resets to fast and
 * fires an immediate check. There is no state in which a person is watching the
 * screen and getting stale numbers.
 */

/**
 * The rungs, and how long without a human it takes to fall to each.
 *
 * 12s is the original cadence and stays the active one. The steps are wide
 * rather than gradual: the point is to fall off a cliff once nobody is there,
 * and a gentle ramp would spend most of its time in the middle still holding
 * the database open.
 *
 * THE LAST RUNG IS 15 MINUTES, AND IT WAS 5 — which was the bug. Neon
 * suspends after five minutes WITHOUT a query, so a check every five minutes
 * lands just as the window closes and the endpoint never sleeps: an idle tab on
 * a second monitor held production awake around the clock, which on 25 Sep
 * 2026 was a visible part of the bill. Fifteen leaves the compute ten minutes
 * asleep between checks, and nobody is looking at the tab by definition — the
 * rung is reached only after ten minutes with no pointer, key, scroll or focus.
 */
const RUNGS = [
  { after: 0, every: 12_000 },
  { after: 2 * 60_000, every: 60_000 },
  { after: 10 * 60_000, every: 15 * 60_000 },
] as const;

/**
 * AN HOUR WITH NOBODY THERE AND IT STOPS ASKING. A wall screen still gets a
 * check every fifteen minutes for its first hour; after that the chain simply
 * does not reschedule, and the first sign of a person — any activity below, or
 * the tab coming back — restarts it WITH an immediate check, so the numbers are
 * current the moment somebody is actually there to read them.
 */
export const STOP_AFTER_MS = 60 * 60_000;

/**
 * Pointer/keys/scroll: enough to notice a person, cheap enough to ignore.
 * `pointermove` joined on 25 Sep 2026 — somebody reading the board with a hand
 * on the mouse is present, and without it they fell to the slow rungs for
 * doing nothing but look. The handler only stamps a clock, so a stream of
 * moves costs a `Date.now()` each.
 */
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export function FreshnessPoller({
  intervalMs = RUNGS[0].every,
  initialVersion,
}: {
  intervalMs?: number;
  /**
   * C16 — the version this page actually rendered, so the ref does not start
   * empty. `changed` below requires a non-null previous tag, so an unseeded
   * ref reads every first answer as "nothing to compare, carry on" even when
   * the version moved between this render and the first poll — a change in
   * that gap stayed invisible until some later, unrelated recompute happened
   * to move the tag again. Seeding also means the very first request already
   * carries `If-None-Match`, so an unchanged world is a 304 from poll one
   * instead of poll two.
   */
  initialVersion?: string;
}) {
  const router = useRouter();
  // Only ever read on mount — React ignores later changes to a `useRef`
  // initializer, which is exactly right here: `router.refresh()` re-renders
  // this component with a fresh `initialVersion`, and re-seeding from it on
  // every refresh would fight the ref's own bookkeeping of what the last
  // poll actually saw.
  const etag = useRef<string | null>(initialVersion != null ? resultsEtag(initialVersion) : null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastActivity = Date.now();

    /** How long to wait before the next check, given how long since a human. */
    const delay = () => {
      const idleFor = Date.now() - lastActivity;
      let ms = intervalMs;
      for (const r of RUNGS) if (idleFor >= r.after) ms = r.after === 0 ? intervalMs : r.every;
      return ms;
    };

    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/results-version", {
            headers: etag.current ? { "if-none-match": etag.current } : {},
            cache: "no-store",
          });
          if (res.status === 200) {
            const nextTag = res.headers.get("etag");
            const changed = etag.current != null && nextTag !== etag.current;
            etag.current = nextTag;
            if (changed) router.refresh();
          }
          // 304: unchanged — nothing to do. Errors: silently retry next tick.
        } catch {
          // Network hiccup — the next tick retries.
        }
      }
      if (stop) return;
      // Idle past the last hour: let the chain end. `onActivity`/`onVisible`
      // start it again (and check at once) — see STOP_AFTER_MS.
      if (Date.now() - lastActivity >= STOP_AFTER_MS) {
        timer = null;
        return;
      }
      timer = setTimeout(tick, delay());
    };
    timer = setTimeout(tick, delay());

    /**
     * THE PENDING TIMER DIES FIRST, ALWAYS.
     *
     * `tick` schedules its own successor, so calling it while one is queued
     * FORKS the chain — a tab focused five times was polling six times per
     * interval, forever. Every path that starts a tick goes through here, which
     * is the only reason it is safe to have four more of them than before.
     */
    const restart = () => {
      if (stop) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    // Coming back to the tab checks immediately — the user expects current data.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      lastActivity = Date.now();
      restart();
    };

    /**
     * ACTIVITY ONLY STAMPS THE CLOCK — it does NOT poll. Fetching on every
     * keystroke would be a far worse version of the problem this exists to fix.
     * The immediate check happens only when we had actually backed off, which is
     * the case where the reader is owed one: they have just come back to a page
     * whose numbers may be up to fifteen minutes old, or to a chain
     * that had stopped after an hour and is started again here.
     */
    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity >= RUNGS[1].after;
      lastActivity = Date.now();
      if (wasIdle) restart();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    for (const e of ACTIVITY) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      for (const e of ACTIVITY) window.removeEventListener(e, onActivity);
    };
  }, [router, intervalMs]);

  return null;
}
