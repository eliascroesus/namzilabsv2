"use client";

import { Copy, PencilLine, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { StatusPill, type StatusPillProps } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NodeIcon } from "@/components/flow/icons";
import { formatDate, formatTime } from "@/lib/format";
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
  /**
   * Edited since the version the dashboard is computing from. Says the same
   * thing the tile and the toolbar say, in the place people scan to find out
   * which flows are live.
   */
  unpublished?: boolean;
};

const FILTERS: Array<{ key: "all" | FlowState; label: string }> = [
  { key: "all", label: "All flows" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Drafts" },
  { key: "paused", label: "Paused" },
];

const STATE_META: Record<FlowState, { label: string; tone: StatusPillProps["tone"]; dot?: boolean }> = {
  active: { label: "Active", tone: "success", dot: true },
  paused: { label: "Paused", tone: "warn" },
  draft: { label: "Draft", tone: "pending" },
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
          {FILTERS.map((f) => (
            <Chip key={f.key} active={filter === f.key} count={counts[f.key]} onClick={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
        {flows.length > 5 && (
          <Input
            type="search"
            // `type="search"` and not `text`: it gives the field Escape-to-clear
            // and the native clear affordance for free, and mobile keyboards
            // label their return key "Search" instead of "Go".
            aria-label="Search flows"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search flows…"
            className="h-8 w-56 text-small"
          />
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-surface border border-border bg-card shadow-card">
        <div className="grid grid-cols-[1fr_150px_180px_120px] items-center gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Flow name</span>
          <span>Status</span>
          <span>Last updated</span>
          <span className="text-right">Actions</span>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-small text-muted-foreground">
            {query ? `No flows match “${q.trim()}”.` : `No ${filter === "all" ? "" : filter} flows.`}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((f) => (
              <Row key={f.id} flow={f} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-tiny text-muted-foreground">
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
    <div className="grid grid-cols-[1fr_150px_180px_120px] items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40">
      <Link href={`/dashboard/flows/${flow.id}`} className="flex min-w-0 items-center gap-3">
        <NodeIcon type="app" source={flow.source ?? undefined} size={34} />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-foreground">{flow.name}</span>
          {/* The edit note REPLACES the step summary rather than sitting under
              it: "which of these is live" is the more urgent fact, and a third
              line would push the rows past the grid's height. */}
          {flow.unpublished ? (
            <span className="flex items-center gap-1.5 text-tiny text-warn-ink">
              <PencilLine size={12} className="shrink-0" aria-hidden />
              <span className="truncate">Edited since publishing</span>
            </span>
          ) : (
            <span className="block truncate text-tiny text-muted-foreground">{flow.summary}</span>
          )}
        </span>
      </Link>

      <span className="flex items-center gap-2.5">
        {/* A never-published flow has nothing to switch on, so the control says
            so rather than failing on click. */}
        <Switch
          size="sm"
          checked={state === "active"}
          disabled={state === "draft" || pending}
          onClick={toggle}
          aria-label={state === "draft" ? "Publish this flow before turning it on" : state === "active" ? "Turn off" : "Turn on"}
          title={state === "draft" ? "Publish this flow before turning it on" : state === "active" ? "Turn off" : "Turn on"}
        />
        <StatusPill tone={meta.tone} dot={meta.dot}>
          {meta.label}
        </StatusPill>
      </span>

      <span className="text-tiny text-muted-foreground">
        {formatDate(new Date(flow.updatedAt))}
        <span className="block text-muted-foreground">{formatTime(new Date(flow.updatedAt))}</span>
      </span>

      <span className="flex items-center justify-end gap-1">
        {error && <span className="mr-1 truncate text-micro text-danger-ink" title={error}>Failed</span>}
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

