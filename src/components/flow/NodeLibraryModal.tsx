"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NodeType } from "@/lib/flow/types";
import { ALL_TYPES, NODE_META, STAGES } from "./node-meta";
import { NodeIcon } from "./icons";

/** Where to anchor the picker — a point next to the "Add step" button that opened it. */
export type PickerAnchor = { x: number; y: number } | null;

const WIDTH = 340;

/**
 * The step picker — Make.com style: it springs up NEXT TO the button that opened
 * it (no page dimming), a compact card of colourful, stacked step rows. Scales in
 * on open and out on close.
 */
export function NodeLibraryModal({ onClose, onPick, anchor }: { onClose: () => void; onPick: (type: NodeType) => void; anchor: PickerAnchor }) {
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${m.label} ${m.blurb} ${m.keywords} ${m.stage}`.toLowerCase().includes(query);
  };
  const byStage = STAGES.map((stage) => ({ stage, types: ALL_TYPES.filter((t) => NODE_META[t].stage === stage && !NODE_META[t].hidden && matches(t)) })).filter((g) => g.types.length > 0);

  // Play the exit animation, then actually unmount.
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 120);
  };

  // Place the card beside the anchor: to its right by default, flipping left when
  // it would run off-screen, clamped fully into the viewport.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !anchor) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.x + 14;
    let originX = "left";
    if (left + w > vw - 12) {
      left = anchor.x - w - 14;
      originX = "right";
    }
    left = Math.max(12, Math.min(left, vw - w - 12));
    let top = Math.max(12, anchor.y - 16);
    top = Math.min(top, vh - h - 12);
    top = Math.max(12, top);
    setPos({ top, left, origin: `top ${originX}` });
  }, [anchor]);

  // Outside-click and Escape close (with the exit animation).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) requestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const style: React.CSSProperties = anchor
    ? { position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH, transformOrigin: pos?.origin ?? "top left", visibility: pos ? "visible" : "hidden" }
    : { position: "fixed", top: "50%", left: "50%", width: WIDTH, transform: "translate(-50%, -50%)", transformOrigin: "center" };

  return (
    <div className="fixed inset-0 z-50" onClick={requestClose}>
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        style={style}
        className={`flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white flow-shadow ${closing ? "flow-pop-out" : "flow-pop-in"}`}
      >
        <div className="border-b border-neutral-100 p-2.5">
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search steps…"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {byStage.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">No matching steps.</p>}
          {byStage.map(({ stage, types }) => (
            <div key={stage} className="mb-1.5 last:mb-0">
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{stage}</p>
              <div className="flex flex-col">
                {types.map((t) => (
                  <button
                    key={t}
                    onClick={() => onPick(t)}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-100"
                  >
                    <NodeIcon type={t} size={34} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-neutral-800">{NODE_META[t].label}</span>
                      <span className="block truncate text-xs text-neutral-500">{NODE_META[t].blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
