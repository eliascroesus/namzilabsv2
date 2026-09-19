"use client";

import { useEffect, useState } from "react";

/**
 * ONE STEP, CARRIED BETWEEN FLOWS.
 *
 * Duplicating a step has always worked inside one flow. Rebuilding the same
 * Filter in a second flow did not: you reopened the first, read its conditions
 * off the panel, and typed them again — which is how two flows that are meant
 * to agree quietly stop agreeing.
 *
 * WHY localStorage AND NOT THE SYSTEM CLIPBOARD. Two flows open in two tabs is
 * the case this is for, and `localStorage` crosses tabs, survives a reload, and
 * needs no permission prompt. `navigator.clipboard` would also cross browser
 * windows, but it is async, permission-gated, and would mean parsing whatever
 * text happened to be on the clipboard on every paste — a much larger surface
 * for a feature whose whole job is "the step I just copied".
 *
 * WHAT TRAVELS is the step's shape and settings, never its results: `lastTest`
 * is a record of a run against a DIFFERENT flow's data and would be a lie on
 * the far side. The pasted card arrives untested, which is what it is.
 */

const KEY = "namzilabs.flow.node-clipboard";

/**
 * `v` is not ceremony. This is persisted JSON living in a browser for weeks; a
 * payload written by an older build and read by a newer one is the ordinary
 * case, not the exotic one, and an unrecognised version is dropped rather than
 * half-read into a node nobody can explain.
 */
export type ClipboardNode = {
  v: 1;
  /** React Flow node type — "app", "filter", "paths", … */
  type: string;
  label?: string;
  config: Record<string, unknown>;
  /** What the picker calls it: "Paste Filter". */
  title: string;
  /** Where it came from, for the one case worth telling apart: the same flow. */
  fromFlowId: string | null;
  at: number;
};

function isPayload(v: unknown): v is ClipboardNode {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return c.v === 1 && typeof c.type === "string" && typeof c.title === "string" && !!c.config && typeof c.config === "object";
}

/**
 * Every access is wrapped: `localStorage` THROWS rather than returning null in
 * a browser set to block site data, and an exception raised while reading a
 * convenience feature must not take the canvas down with it.
 */
export function readNodeClipboard(): ClipboardNode | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeNodeClipboard(payload: Omit<ClipboardNode, "v" | "at">): boolean {
  try {
    const full: ClipboardNode = { ...payload, v: 1, at: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(full));
    // `storage` does not fire in the tab that wrote it, so the picker in THIS
    // tab would not learn about the copy until something else re-rendered it.
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    return true;
  } catch {
    return false;
  }
}

const LOCAL_EVENT = "namzilabs:node-clipboard";

/**
 * The clipboard's current contents, kept live.
 *
 * Reads lazily on mount rather than during render: `localStorage` does not
 * exist on the server, and touching it while rendering is how a component that
 * works in the browser fails the moment it is server-rendered.
 */
export function useNodeClipboard(): ClipboardNode | null {
  const [value, setValue] = useState<ClipboardNode | null>(null);

  useEffect(() => {
    const sync = () => setValue(readNodeClipboard());
    sync();
    // `storage` covers the OTHER tab copying; the custom event covers this one.
    window.addEventListener("storage", sync);
    window.addEventListener(LOCAL_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(LOCAL_EVENT, sync);
    };
  }, []);

  return value;
}
