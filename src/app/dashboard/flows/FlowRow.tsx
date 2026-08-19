"use client";

import { Copy, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NodeIcon } from "@/components/flow/icons";
import { deleteFlowAction, duplicateFlowAction, setFlowEnabledAction } from "./actions";
import type { FlowState } from "@/lib/flow/store";

export type FlowListItem = {
  id: string;
  name: string;
  state: FlowState;
  updatedAt: string;
  /** "3 steps · Google Sheets" — derived from the draft graph on the server. */
  summary: string;
  /** The first Get-data step's source, for the row's icon. */
  source: string | null;
};

const FILTERS: Array<{ key: "all" | FlowState; label: string }> = [
  { key: "all", label: "All flows" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Drafts" },
  { key: "paused", label: "Paused" },
];

const STATE_META: Record<FlowState, { label: string; dot: string; pill: string }> = {
  active: { label: "Active", dot: "bg-success", pill: "bg-success-soft text-success-ink" },
  paused: { label: "Paused", dot: "bg-warn", pill: "bg-warn-soft text-warn-ink" },
  draft: { label: "Draft", dot: "bg-neutral-400", pill: "bg-neutral-100 text-neutral-600" },
};

/**
 * The flows list: a table, with the flow's own on/off switch in it.
 *
 * It was a bare row of name + status word + date. Two things were missing that
 * every comparable list has — a way to tell at a glance WHICH flows are
 * running (Zapier's per-row toggle) and a way to narrow to them (the filter
 * tabs, with live counts). Both matter more here than in an automation tool,
 * because a paused flow silently removes tiles from the dashboard, and the
 * only place that fact can live is this list.
 */
export function FlowList({ flows }: { flows: FlowListItem[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | FlowState>("all");

  const query = q.trim().toLowerCase();
  const counts = {
    all: flows.length,
    active: flows.filter((f) => f.state === "active").length,
    draft: flows.filter((f) => f.state === "draft").length,
    paused: flows.filter((f) => f.state === "paused").length,
  };
  const visible = flows.filter(
    (f) => (filter === "all" || f.state === filter) && (!query || f.name.toLowerCase().includes(query)),
  );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Counts live on the tabs, so "how many are actually running" is
            answered without clicking anything. */}
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-small font-semibold transition-colors ${
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-neutral-600 hover:bg-muted"
                }`}
              >
                {f.label}
                <span className={`rounded-full px-1.5 text-micro font-bold ${active ? "bg-white/25" : "bg-neutral-100 text-neutral-500"}`}>
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
        {flows.length > 5 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search flows…"
            className="w-56 rounded-control border border-neutral-200 px-3 py-1.5 text-small transition-colors focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-border bg-card shadow-raised">
        <div className="grid grid-cols-[1fr_150px_180px_120px] items-center gap-4 border-b border-neutral-200 bg-neutral-50/70 px-4 py-2.5 text-micro font-semibold uppercase tracking-wide text-neutral-500">
          <span>Flow name</span>
          <span>Status</span>
          <span>Last updated</span>
          <span className="text-right">Actions</span>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-small text-neutral-500">
            {query ? `No flows match “${q.trim()}”.` : `No ${filter === "all" ? "" : filter} flows.`}
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {visible.map((f) => (
              <Row key={f.id} flow={f} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-tiny text-neutral-400">
        {visible.length} of {flows.length} flow{flows.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function Row({ flow }: { flow: FlowListItem }) {
  // Optimistic, because a toggle that waits for a round trip before moving
  // reads as broken. Reverted from the action's own answer if it disagrees —
  // which it will for a never-published flow, where "on" is not available.
  const [state, setState] = useState<FlowState>(flow.state);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const meta = STATE_META[state];

  const toggle = () => {
    const next = state === "active" ? "paused" : "active";
    setState(next);
    setError(null);
    startTransition(async () => {
      const r = await setFlowEnabledAction(flow.id, next === "active");
      if (r.ok) setState(r.state);
      else {
        setState(flow.state);
        setError(r.error);
      }
    });
  };

  const duplicate = () =>
    startTransition(async () => {
      const r = await duplicateFlowAction(flow.id);
      if (r.ok) router.push(`/dashboard/flows/${r.id}`);
      else setError(r.error);
    });

  const del = () =>
    startTransition(async () => {
      const r = await deleteFlowAction(flow.id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  return (
    <div className="grid grid-cols-[1fr_150px_180px_120px] items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/40">
      <Link href={`/dashboard/flows/${flow.id}`} className="flex min-w-0 items-center gap-3">
        <NodeIcon type="app" source={flow.source ?? undefined} size={34} />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-neutral-900">{flow.name}</span>
          <span className="block truncate text-tiny text-neutral-500">{flow.summary}</span>
        </span>
      </Link>

      <span className="flex items-center gap-2.5">
        {/* A never-published flow has nothing to switch on, so the control says
            so rather than failing on click. */}
        <Toggle
          on={state === "active"}
          disabled={state === "draft" || pending}
          onChange={toggle}
          label={state === "draft" ? "Publish this flow before turning it on" : state === "active" ? "Turn off" : "Turn on"}
        />
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-bold ${meta.pill}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
          {meta.label}
        </span>
      </span>

      <span className="text-tiny text-neutral-500">
        {new Date(flow.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        <span className="block text-neutral-400">
          {new Date(flow.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
      </span>

      <span className="flex items-center justify-end gap-1">
        {error && <span className="mr-1 truncate text-micro text-red-600" title={error}>Failed</span>}
        <Button variant="ghost" size="icon" onClick={duplicate} disabled={pending} title="Duplicate" aria-label="Duplicate">
          <Copy />
        </Button>
        {confirming ? (
          <span className="flex items-center gap-1">
            <Button variant="destructive" size="sm" onClick={del} disabled={pending}>
              {pending ? "…" : "Delete"}
            </Button>
            <Button variant="ghost" size="iconSm" onClick={() => setConfirming(false)} aria-label="Cancel">
              <X />
            </Button>
          </span>
        ) : (
          <Button variant="destructiveGhost" size="icon" onClick={() => setConfirming(true)} disabled={pending} title="Delete" aria-label="Delete">
            <Trash2 />
          </Button>
        )}
      </span>
    </div>
  );
}

/** The on/off switch. Zapier's control, because it is the one everyone reads. */
function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? "bg-primary" : "bg-neutral-200"
      } ${disabled ? "cursor-not-allowed opacity-50" : "hover:brightness-105"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ${on ? "left-[18px]" : "left-0.5"}`}
        style={{ transition: "left .22s cubic-bezier(.34,1.56,.64,1)" }}
        aria-hidden
      />
    </button>
  );
}
