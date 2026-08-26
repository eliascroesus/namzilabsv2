"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * G.4 client wire-up: poll the results-version beacon and refresh the
 * (server-rendered) dashboard when it moves. Deliberately near-free:
 * - visibility-gated — a background tab polls nothing;
 * - conditional — If-None-Match makes an unchanged poll a bodyless 304;
 * - refresh only fires on an actual version change, so server re-renders
 *   scale with data-change rate, not with viewers.
 */
export function FreshnessPoller({ intervalMs = 12_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const etag = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);

    // Coming back to the tab checks immediately — the user expects current data.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      /**
       * THE PENDING TIMER DIES FIRST. `tick` always schedules its successor,
       * so calling it with one already queued FORKS the chain — every
       * tab-focus added another concurrent 12-second loop, and a tab focused
       * five times was polling six times per interval, forever. One chain,
       * whoever starts it.
       */
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);

  return null;
}
