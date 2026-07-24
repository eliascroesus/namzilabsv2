"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NodeType } from "@/lib/flow/types";
import { ALL_TYPES, NODE_META, STAGES } from "./node-meta";
import { NodeIcon } from "./icons";

/** Where to anchor the picker: the button's right edge + vertical centre (and its
 *  left edge, used when the card has to flip to the button's other side). */
export type PickerAnchor = { x: number; y: number; leftX?: number } | null;

/** The anchor for a picker opened from a button, from that button's rect. */
export function anchorFromRect(r: DOMRect): { x: number; y: number; leftX: number } {
  return { x: r.right, y: r.top + r.height / 2, leftX: r.left };
}

const WIDTH = 380;
const GAP = 14;
const MARGIN = 12;

/**
 * The step picker — Make.com style: a roomy card of big, colourful, stacked step
 * rows that springs up beside the button that opened it (no page dimming),
 * vertically centred on it. The canvas stays pannable while it's open — when an
 * `anchorSelector` is given it stays glued to that button as the canvas moves.
 */
export function NodeLibraryModal({
  onClose,
  onPick,
  anchor,
  anchorSelector,
}: {
  onClose: () => void;
  onPick: (type: NodeType) => void;
  anchor: PickerAnchor;
  anchorSelector?: string | null;
}) {
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${m.label} ${m.blurb} ${m.keywords} ${m.stage}`.toLowerCase().includes(query);
  };
  // A single flat list in stage order — no section headers.
  const items = STAGES.flatMap((stage) => ALL_TYPES.filter((t) => NODE_META[t].stage === stage && !NODE_META[t].hidden && matches(t)));

  const centered = !anchor && !anchorSelector;

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 120);
  };

  // Position the card beside the anchor, vertically centred, flipping left when it
  // would run off-screen. Re-run each frame so it stays glued to a moving button
  // (canvas pan). Positioning is done via direct style writes — no re-render.
  useLayoutEffect(() => {
    if (centered) return;
    let raf = 0;
    const place = () => {
      const el = panelRef.current;
      if (el) {
        let a = anchor;
        if (anchorSelector) {
          const target = document.querySelector<HTMLElement>(anchorSelector);
          if (target) a = anchorFromRect(target.getBoundingClientRect());
        }
        if (a) {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          let left = a.x + GAP;
          let side = "left";
          if (left + w > vw - MARGIN) {
            left = (a.leftX ?? a.x) - w - GAP;
            side = "right";
          }
          left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
          let top = a.y - h / 2;
          top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
          el.style.transformOrigin = `${side} center`;
          el.style.visibility = "visible";
        }
      }
      raf = requestAnimationFrame(place);
    };
    place(); // position synchronously before first paint, then follow each frame
    return () => cancelAnimationFrame(raf);
  }, [anchor, anchorSelector, centered]);

  // Close on an outside CLICK (a canvas drag/pan fires no click, so panning keeps
  // it open) or Escape.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) requestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const style: React.CSSProperties = centered
    ? { position: "fixed", top: "50%", left: "50%", width: WIDTH, transform: "translate(-50%, -50%)", transformOrigin: "center" }
    : { position: "fixed", width: WIDTH, top: -9999, left: -9999, visibility: "hidden" };

  return (
    // pointer-events-none so the canvas stays pannable underneath; the panel itself
    // re-enables them.
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        style={style}
        className={`pointer-events-auto flex max-h-[74vh] flex-col overflow-hidden rounded-2xl bg-white flow-shadow ${closing ? "flow-pop-out" : "flow-pop-in"}`}
      >
        <div className="p-3 pb-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search steps…"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-3 text-[15px] text-neutral-800 placeholder:text-neutral-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-1">
          {items.length === 0 ? (
            <p className="p-8 text-center text-sm text-neutral-500">No matching steps.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((t) => (
                <button
                  key={t}
                  onClick={() => onPick(t)}
                  className="group flex items-center gap-3.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-neutral-100"
                >
                  <NodeIcon type={t} size={40} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold leading-tight text-neutral-900">{NODE_META[t].label}</span>
                    <span className="mt-0.5 block truncate text-[13px] leading-tight text-neutral-500">{NODE_META[t].blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
