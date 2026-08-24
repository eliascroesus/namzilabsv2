"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE DIALOG. One scrim, one card, one way in and out — the app had three
 * backdrop recipes (two blurred slates and a flat black) and one modal with
 * no border while its siblings had one.
 *
 * Deliberately lean: no portal (the app's stacking contexts don't need one)
 * and no focus-trap library — but "lean" used to mean "no focus management at
 * all", and that is a different thing. `aria-modal="true"` is a PROMISE to a
 * screen reader that the rest of the document is inert; with focus free to
 * tab out of the card, the promise was false, and a keyboard user who tabbed
 * past the last button landed on the page behind a dialog they could still
 * see but no longer reach. The three effects below are what makes the
 * attribute true, in about thirty lines and no dependency:
 *
 *   1. focus moves INTO the dialog on open, and back to whatever opened it on
 *      close — otherwise dismissing a modal drops you at the top of the page;
 *   2. Tab and Shift+Tab wrap at the ends, so focus cannot leave;
 *   3. the page behind stops scrolling, because a scrim you can scroll under
 *      reads as a broken overlay.
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

/** Everything focusable inside the card, in DOM order, minus anything hidden. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ onClose, size = "sm", className, children }: ModalProps) {
  const titleId = React.useId();
  const cardRef = React.useRef<HTMLDivElement>(null);

  // `onClose` is usually an inline arrow at the call site, so it is a new
  // function every render. Held in a ref, the effects below depend only on
  // mount — otherwise the whole trap tears down and re-arms on every keystroke
  // typed into a field inside the dialog.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;

    // Focus the first control, or the card itself when there is none (a
    // confirm dialog whose only button is rendered later). `tabIndex={-1}` on
    // the card is what makes that second case possible.
    const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? cardRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      // Re-queried per keypress, not cached: a dialog's contents change as it
      // is used (a disabled Save becomes enabled, a picker expands), and a
      // stale list is a trap with holes in it.
      const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      // Only the ENDS are handled; everything in between is the browser's own
      // tab order, which is already correct and much better than re-deriving.
      if (document.activeElement === edge || !cardRef.current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };

    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under the scrim. Restored to whatever it
    // was rather than to "" — a nested dialog would otherwise unlock the body
    // when the inner one closes.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Back to the button that opened it. Without this, closing a dialog
      // leaves focus on <body> and the next Tab starts from the top of the
      // document — which, on the builder, is the whole navigation rail.
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        // The scrim itself, not a click that started inside the card.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          // `max-h`/`overflow-y-auto`: a dialog taller than the window used to
          // run off both ends with its buttons unreachable — the review-and-
          // publish modal does exactly that on a laptop once a flow has more
          // than a few steps.
          // `overscroll-contain`: without it, scrolling to the end of a tall
          // dialog hands the remaining momentum to the page behind the scrim,
          // which then scrolls under a modal that is supposed to have stopped
          // it. (The body is locked while open, so the visible symptom is the
          // rubber-band bounce on iOS rather than a full scroll — still wrong.)
          "flow-pop-in max-h-[calc(100dvh-2rem)] w-full overflow-y-auto overscroll-contain rounded-surface border border-border bg-card p-5 shadow-panel outline-none",
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
