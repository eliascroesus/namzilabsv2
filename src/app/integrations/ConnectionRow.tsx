"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { renameConnectionAction } from "./actions";

/**
 * One row in "Your connections": links to the connection page, with an inline
 * rename (pencil) so users can label accounts themselves ("Sheets — sales team").
 */
export function ConnectionRow({ id, name, source, status }: { id: string; name: string; source: string; status: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50">
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
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "active" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-neutral-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={status} />;
}
