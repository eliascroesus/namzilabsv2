"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE DIALOG. One scrim, one card, one way in and out — the app had three
 * backdrop recipes (two blurred slates and a flat black) and one modal with
 * no border while its siblings had one.
 *
 * Deliberately lean: no portal (the app's stacking contexts don't need one),
 * no focus trap library — Escape and outside-press close it, and the caller
 * conditionally renders it so unmount IS close.
 */
export type ModalProps = {
  onClose: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
};

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * The dialog's own name, handed to `ModalTitle` so the two agree without the
 * caller wiring an id. `aria-modal` without `aria-labelledby` announces as
 * "dialog" and nothing else — the title is on screen, so the only thing
 * missing was the pointer to it.
 */
const TitleId = React.createContext<string | undefined>(undefined);

export function Modal({ onClose, size = "sm", className, children }: ModalProps) {
  const titleId = React.useId();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/30 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        // The scrim itself, not a click that started inside the card.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flow-pop-in w-full rounded-surface border border-border bg-card p-5 shadow-panel",
          SIZES[size],
          className,
        )}
      >
        <TitleId.Provider value={titleId}>{children}</TitleId.Provider>
      </div>
    </div>
  );
}

export function ModalTitle({ className, id, ...props }: React.ComponentProps<"h2">) {
  const ctx = React.useContext(TitleId);
  return (
    <h2
      id={id ?? ctx}
      className={cn("text-title font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  );
}
