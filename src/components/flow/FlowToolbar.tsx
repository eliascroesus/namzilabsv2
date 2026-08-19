"use client";

import Link from "next/link";
import { useState } from "react";
import { Popover } from "./controls/Popover";

/**
 * THE BUILDER'S CHROME: two floating islands, not a bar.
 *
 * The editor used to carry the app's left rail plus a full-width top bar, so
 * roughly a fifth of the screen was furniture around a canvas whose whole
 * point is space. Miro's answer — and Figma's, and FigJam's — is that on a
 * canvas the chrome floats ON the work rather than framing it: two rounded
 * islands, the canvas visible around and between them, and no edge-to-edge
 * band anywhere.
 *
 * Navigation moves into the ⋮ menu because in the editor it is the rarest
 * thing anyone wants. What is left on screen is what this page is actually
 * for: which flow this is, and what you can do to it.
 *
 * The right island SLIDES when the config panel opens. Both want the same
 * corner, and a Publish button hidden behind a panel is a Publish button that
 * does not exist.
 */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/flows", label: "Flows" },
  { href: "/integrations", label: "Integrations" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function FlowToolbar({
  name,
  onRename,
  saveState,
  onRetrySave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onTestAll,
  onStopTestAll,
  runAll,
  showTestAll,
  publishedVersion,
  isPublished,
  publishing,
  onReview,
  panelOpen,
}: {
  name: string;
  onRename: (v: string) => void;
  saveState: SaveState;
  onRetrySave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onTestAll: () => void;
  onStopTestAll: () => void;
  runAll: { at: number; of: number } | null;
  showTestAll: boolean;
  publishedVersion: number | null;
  isPublished: boolean;
  publishing: boolean;
  onReview: () => void;
  panelOpen: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* ---- Left island: what this is ---- */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(46vw,540px)] items-center">
        <div className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-card bg-white p-1.5 flow-shadow">
          <Link
            href="/dashboard"
            title="Namzilabs — back to dashboard"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-600 text-small font-bold text-white transition-colors hover:bg-brand-700"
          >
            N
          </Link>

          <input
            value={name}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Flow name"
            placeholder="Untitled flow"
            className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-2 py-1.5 text-base font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          />

          <SaveChip state={saveState} onRetry={onRetrySave} />

          <Popover
            open={menuOpen}
            setOpen={setMenuOpen}
            width={196}
            align="left"
            anchor={
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                title="Menu"
                aria-label="Menu"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
            }
          >
            <div className="p-1.5">
              <p className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-neutral-400">Go to</p>
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-control px-2 py-1.5 text-small font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </Popover>
        </div>
      </div>

      {/* ---- Right island: what you can do ----
          It steps aside for the config panel rather than sitting under it. */}
      <div
        className="pointer-events-none absolute top-3 z-10 flex items-center transition-[right] duration-200 ease-out"
        style={{ right: panelOpen ? "calc(min(452px, 100vw - 2rem) + 1.75rem)" : "0.75rem" }}
      >
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-card bg-white p-1.5 flow-shadow">
          <div className="flex items-center gap-0.5">
            <IconButton onClick={onUndo} disabled={!canUndo} label="Undo">
              <path d="M3 10h11a5 5 0 0 1 0 10h-3" />
              <path d="M7 6l-4 4 4 4" />
            </IconButton>
            <IconButton onClick={onRedo} disabled={!canRedo} label="Redo">
              <path d="M21 10H10a5 5 0 0 0 0 10h3" />
              <path d="M17 6l4 4-4 4" />
            </IconButton>
          </div>

          {showTestAll && (
            <>
              <span className="h-5 w-px bg-neutral-200" aria-hidden />
              <button
                onClick={runAll ? onStopTestAll : onTestAll}
                title={runAll ? "Stop the run" : "Run every step, top to bottom"}
                className={`rounded-control px-3 py-1.5 text-base font-medium transition-colors ${
                  runAll ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : "text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {runAll ? `${runAll.at}/${runAll.of} — Stop` : "Test flow"}
              </button>
            </>
          )}

          {isPublished && publishedVersion != null && (
            <span className="rounded-control bg-green-50 px-2 py-1 text-micro font-semibold text-green-700" title="This flow is live on your dashboard">
              Live · v{publishedVersion}
            </span>
          )}

          <button
            onClick={onReview}
            disabled={publishing}
            className="rounded-control bg-brand-600 px-4 py-1.5 text-base font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {isPublished ? "Edit output" : "Review & publish"}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The save state, as a chip inside the island.
 *
 * A failed save is the one thing here that can silently cost work, so it is
 * the only state that gets words and colour; the rest is a dot, because
 * "Saved" is the answer to a question nobody asked and does not deserve a
 * sentence in a 44px bar.
 */
function SaveChip({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-control bg-red-50 px-2 py-1 text-micro font-medium text-red-700">
        Not saved
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 px-1.5 text-tiny text-neutral-400"
      title={state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : "Unsaved changes"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state === "saved" ? "bg-green-500" : "bg-amber-400"}`} aria-hidden />
      <span className="hidden sm:inline">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Unsaved"}</span>
    </span>
  );
}

function IconButton({ onClick, disabled, label, children }: { onClick: () => void; disabled?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-control text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-default disabled:text-neutral-300 disabled:hover:bg-transparent"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
