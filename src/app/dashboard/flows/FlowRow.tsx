"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFlowAction, duplicateFlowAction } from "./actions";

/** One flow in the overview list: open it, or delete it (with an inline confirm). */
export function FlowRow({ id, name, status, updatedAt }: { id: string; name: string; status: string; updatedAt: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const del = () =>
    startTransition(async () => {
      const r = await deleteFlowAction(id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  const duplicate = () =>
    startTransition(async () => {
      const r = await duplicateFlowAction(id);
      if (r.ok) router.push(`/dashboard/flows/${r.id}`);
      else setError(r.error);
    });

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50">
      <Link href={`/dashboard/flows/${id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
        {name}
      </Link>
      <div className="flex shrink-0 items-center gap-3 text-sm text-neutral-500">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${status === "published" ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-600"}`}>{status}</span>
        <span className="hidden sm:inline">{new Date(updatedAt).toLocaleDateString()}</span>
        <button onClick={duplicate} disabled={pending} className="text-xs text-neutral-500 hover:text-neutral-800 hover:underline disabled:opacity-50" title="Copy this flow as a new draft">
          Duplicate
        </button>
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-neutral-500">Delete?</span>
            <button onClick={del} disabled={pending} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button onClick={() => setConfirming(false)} disabled={pending} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100">
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-red-600" title="Delete flow" aria-label="Delete flow">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}

/**
 * The flows list with a client-side search box. Filtering happens in the
 * browser — the list is already loaded, and a round trip per keystroke would
 * buy nothing.
 */
export function FlowList({ flows }: { flows: Array<{ id: string; name: string; status: string; updatedAt: string }> }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const visible = query ? flows.filter((f) => f.name.toLowerCase().includes(query)) : flows;
  return (
    <div className="mt-8">
      {flows.length > 5 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search flows…"
          className="mb-3 w-full max-w-xs rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      )}
      <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
        {visible.map((f) => (
          <FlowRow key={f.id} id={f.id} name={f.name} status={f.status} updatedAt={f.updatedAt} />
        ))}
        {visible.length === 0 && <p className="p-6 text-center text-sm text-neutral-400">No flows match &ldquo;{q}&rdquo;.</p>}
      </div>
    </div>
  );
}
