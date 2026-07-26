"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { renameConnectionAction, disconnectAction } from "./actions";

/**
 * One row in "Your connections": links to the connection page, with an inline
 * rename (pencil) so users can label accounts themselves ("Sheets — sales team"),
 * and an inline remove (trash) so an integration can be undone from the list
 * rather than only from its own page.
 *
 * Removal confirms in place rather than firing on the first click. Rows sit
 * directly on top of each other, so a single-click delete here is a mis-click
 * away from taking out the wrong integration — and unlike rename, the user
 * cannot see what they destroyed in order to put it back.
 */
export function ConnectionRow({ id, name, source, status }: { id: string; name: string; source: string; status: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    setSaving(true);
    await renameConnectionAction(id, next);
    setSaving(false);
    router.refresh();
  };

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-red-50/60 px-4 py-3">
        <p className="min-w-0 text-sm text-neutral-700">
          Remove <span className="font-medium">{name}</span>? Its synced records stop appearing in dashboards
          and flows, and it stops syncing. Any flow reading from it will have no data.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-white"
          >
            Cancel
          </button>
          <form action={disconnectAction}>
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Remove
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between px-4 py-3 hover:bg-neutral-50">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm font-medium focus:border-neutral-400 focus:outline-none"
        />
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/connections/${id}`} className="truncate font-medium hover:underline">
            {saving ? draft : name}
          </Link>
          <button
            type="button"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            title="Rename this connection"
            aria-label="Rename this connection"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M11.1 2.4a1.6 1.6 0 0 1 2.3 2.3l-7.6 7.6-3 .7.7-3 7.6-7.6Z" />
            </svg>
          </button>
        </span>
      )}
      <span className="ml-3 flex shrink-0 items-center gap-3 text-sm text-neutral-500">
        <span>{source}</span>
        <StatusDot status={status} />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus-visible:outline focus-visible:outline-2 group-hover:opacity-100"
          title={`Remove ${name}`}
          aria-label={`Remove ${name}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M2.5 4h11M6.5 4V2.8h3V4M4 4l.6 9.2h6.8L12 4M6.6 6.5v4.3M9.4 6.5v4.3" />
          </svg>
        </button>
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "active" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-neutral-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={status} />;
}
