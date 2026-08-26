"use client";

import { useCallback } from "react";

/** What every arrangement action answers with. */
export type SettleResult = { ok: true } | { ok: false; error: string };

/**
 * A WRITE THAT NEVER ANSWERED IS A WRITE THAT FAILED.
 *
 * Both boards make optimistic changes — a tile moves the instant you drop it,
 * and the server is told afterwards — so both need the same answer to "what if
 * the telling fails". This is that answer, in ONE place, because two copies is
 * exactly how the bug it fixes comes back.
 *
 * BOTH HALVES MATTER, and the second is the one that was missing. A server
 * action can RESOLVE `{ ok: false }`, which is a refusal and obvious. It can
 * also REJECT: an expired session, a network blip, and above all a DEPLOYMENT —
 * Next mints a new id for every action it builds, so a tab left open across one
 * calls an id the server has forgotten and the fetch simply fails. With no
 * `.catch` that was silent AND invisible: the optimistic change stayed on
 * screen, nothing was written, and the arrangement was back on the next load.
 * From the outside, indistinguishable from "the drag doesn't work".
 *
 * `revert` is deliberately the CALLER's, and deliberately narrow. It puts back
 * only what this write touched, never a whole snapshot — a neighbouring gesture
 * may be in flight, and restoring everything would undo that too.
 */
export function useSettle(setToast: (message: string) => void) {
  return useCallback(
    (p: Promise<SettleResult>, revert: () => void) => {
      p.then((r) => {
        if (r.ok) return;
        revert();
        setToast(r.error);
      }).catch(() => {
        revert();
        setToast("Couldn't save that — the page may be out of date. Reload and try again.");
      });
    },
    [setToast],
  );
}
