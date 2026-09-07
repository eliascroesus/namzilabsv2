"use client";

import { useEffect } from "react";

/**
 * WHICH DEVICE THE LAST INTERACTION CAME FROM — stamped on `<html>` so CSS can
 * ask.
 *
 * THE PROBLEM IT SOLVES. The product has exactly one focus ring, declared once
 * in globals.css as a `:focus-visible` outline. `:focus-visible` is supposed to
 * mean "this control was reached by keyboard", and for a plain click on a plain
 * button it does. Two things in this app make it fire under a pointer anyway:
 *
 *   RADIX MOVES REAL DOM FOCUS ON HOVER. A menu item's `onPointerMove` calls
 *   `item.focus({ preventScroll: true })` (@radix-ui/react-menu), and Chromium
 *   treats a SCRIPT-DRIVEN focus as "not from the mouse" — so every row the
 *   pointer crosses in the period menu, the workspace switcher or a select
 *   matches `:focus-visible` and wears a 2px blue box. Closing a menu returns
 *   focus to its trigger the same way, which is why the trigger keeps a ring
 *   after a mouse click dismisses it.
 *
 *   A CLICKED CONTROL KEEPS FOCUS UNTIL SOMETHING ELSE TAKES IT. Chromium
 *   re-evaluates `:focus-visible` when a key goes down, so pressing any key
 *   after clicking lights the control still holding focus. That is what put a
 *   ring on the rail's Search field: it has no handler, so focus never leaves.
 *
 * Neither is a bug in the ring, and neither can be fixed where it happens:
 * `tests/vendored-primitives.test.ts` fails any `outline-none` inside
 * `src/components/ui`, and a Tailwind utility could not win anyway — the ring
 * rule is UNLAYERED and utilities live in `@layer utilities`.
 *
 * SO THE ANSWER IS ONE BIT OF STATE. Pointer down means "the pointer is
 * driving"; a key down that is not a bare modifier means "the keyboard is".
 * globals.css reads `html[data-modality="pointer"]` and silences the outline
 * for that case only. Keyboard users are untouched — which is the whole point,
 * because the ring is the only thing telling them where they are.
 *
 * CAPTURE PHASE, so a component that stops propagation (the canvas, the drag
 * layers, a modal's key trap) cannot leave the attribute stale — several in
 * this app do. `passive` on the pointer listener because it never calls
 * `preventDefault`.
 *
 * NO ATTRIBUTE UNTIL THE FIRST INTERACTION, deliberately: a page that has not
 * been touched yet behaves exactly as it did before this file existed, so the
 * first paint is unchanged and there is nothing to get wrong during hydration.
 */
export function InputModality() {
  useEffect(() => {
    const set = (mode: "pointer" | "keyboard") => {
      document.documentElement.dataset.modality = mode;
    };
    const onPointer = () => set("pointer");
    /**
     * A BARE MODIFIER IS NOT NAVIGATION. Holding ⌘ to open a link in a new tab,
     * or Shift to extend a selection, is part of a POINTER gesture — flipping
     * to "keyboard" there would light a ring under the cursor, which is the
     * exact thing this file exists to stop. Tab, the arrows, Enter, Space,
     * Escape and every printable character all fall through and do flip it.
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "CapsLock") return;
      set("keyboard");
    };
    window.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointer, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);
  return null;
}
