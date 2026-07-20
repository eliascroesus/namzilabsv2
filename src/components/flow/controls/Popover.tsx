"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A small headless popover: an anchor (trigger) + a floating panel below it. Closes on
 * outside pointer-down and Escape. Positioning is simple (below, left/right aligned),
 * which is all the builder's in-panel controls need. No dependencies.
 */
export function Popover({
  open,
  setOpen,
  anchor,
  children,
  width,
  align = "left",
  panelClassName = "",
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  anchor: ReactNode;
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
  panelClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <div className="relative" ref={wrapRef}>
      {anchor}
      {open && (
        <div
          className={`absolute z-30 mt-1 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg ${align === "right" ? "right-0" : "left-0"} ${panelClassName}`}
          style={width ? { width } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}
