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
import { SourceMark } from "@/components/source-mark";
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
 * THE FLOWS LIST — a board of cards, not a spreadsheet of rows.
 *
 * It has been two things before this. A bare line of name + status word + date,
 * and then a four-column grid table with the toggle wedged into a 150px column.
 * Both were LISTS OF RECORDS, and a flow is not a record: it is a small program
 * with a shape, a source, a state and an on/off switch, and the thing a person
 * comes here to do is recognise one and open it.
 *
 * So each flow is a card the size of a dashboard tile, in the same grid, on the
 * same warm canvas, wearing the same 16px radius and the same elevation — the
 * two screens you move between most are now built out of the same object. The
 * card is clickable as a whole (the title's `after:` overlay stretches over it)
 * with the controls floated above that overlay, which is what lets a big soft
 * target and small precise ones live on one surface.
 *
 * What was already right and is kept: the per-row switch (a paused flow
 * silently removes tiles from the dashboard, and this list is the only place
 * that fact can live) and the filter chips with live counts.
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
      {/* The same island the dashboard's range bar sits in — one control bar
          recipe for the whole app, so moving between the two screens does not
          change what a filter row looks like. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-surface border border-border bg-card p-2 shadow-card">
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

      {visible.length === 0 ? (
        <p className="mt-4 rounded-surface border border-dashed border-border bg-card px-4 py-12 text-center text-small text-muted-foreground">
          {query ? `No flows match “${q.trim()}”.` : `No ${filter === "all" ? "" : filter} flows.`}
        </p>
      ) : (
        // NOT `items-start`: the cards stretch to the tallest in their row and
        // each one's footer is pushed down by a `flex-1` body, so the switches
        // and dates line up across the row even when one flow carries an extra
        // line. A ragged row of footers is the difference between a board and a
        // pile.
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((f) => (
            <Row key={f.id} flow={f} />
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-tiny text-muted-foreground">
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

  const toggleLabel =
    state === "draft" ? "Publish this flow before turning it on" : state === "active" ? "Turn off" : "Turn on";

  return (
    // `lift` is the app's shared hover, and `relative` is what lets the title's
    // overlay claim the whole card without swallowing the controls below it.
    <div className="lift relative flex flex-col rounded-surface border border-border bg-card shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-3">
          {/* THE APP'S OWN MARK, not the step's.
              This was `NodeIcon type="app"`, which paints every Get-data step
              in the step type's green ON PURPOSE — on a canvas the question is
              "what kind of step is this", and a row of differently-coloured
              Get-data tiles would answer a question nobody asked. A list of
              FLOWS is the opposite case: the only thing the mark can usefully
              say is which app the flow reads, and it was saying it in green
              while the dashboard's activity feed said it in Close's blue two
              clicks away. Same component as that feed now. */}
          <SourceMark source={flow.source} size={38} />
          {/* THE WHOLE CARD IS THE LINK. `after:inset-0` stretches this anchor
              over the card, so the soft target is the whole tile while the
              focus ring stays on the words — which is the only part a keyboard
              user can see. Everything that must stay separately clickable sits
              in the footer with `relative z-10`, above the overlay. */}
          <Link
            href={`/dashboard/flows/${flow.id}`}
            className="min-w-0 flex-1 truncate rounded-control text-base font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
          >
            {flow.name}
          </Link>
          <StatusPill tone={meta.tone} dot={meta.dot} className="shrink-0">
            {meta.label}
          </StatusPill>
        </div>

        {/* THE SUMMARY GETS ITS OWN LINE, at the card's full width. Tucked
            under the name it shared a column with the status pill, so
            "6 steps · Close CRM" truncated to "6 steps · Close …" with 90px of
            empty card beside it — the one line that says what the flow IS,
            cut short to make room for a word that was already legible. */}
        <p className="mt-2 truncate text-tiny text-muted-foreground">{flow.summary}</p>
      </div>

      <div className="relative z-10 flex items-center gap-2 border-t border-border px-3 py-2">
        {/* A never-published flow has nothing to switch on, so the control says
            so rather than failing on click. */}
        <Switch
          size="sm"
          checked={state === "active"}
          disabled={state === "draft" || pending}
          onClick={toggle}
          aria-label={toggleLabel}
          title={toggleLabel}
        />
        {/* ONE LINE, THREE THINGS IT CAN SAY, in order of what needs the user.
            A failed action first; then the fact that the dashboard is serving
            a different version of this flow (which is about the PRODUCT, not
            about the editing session, and is the only one wearing a tone);
            then, when neither applies, when it was last touched.

            Stacking them instead would make one card in a row taller than the
            rest, and a grid of cards whose footers do not line up reads as a
            pile. The full timestamp stays in the title either way. */}
        <span
          className="min-w-0 flex-1 truncate text-tiny text-muted-foreground"
          title={`Edited ${formatDate(new Date(flow.updatedAt))} ${formatTime(new Date(flow.updatedAt))}`}
        >
          {error ? (
            <span className="text-danger-ink">{error}</span>
          ) : flow.unpublished ? (
            // "Changes not live" and not "Edited since publishing": the same
            // words the builder's toolbar pill uses for the same fact, and
            // short enough to survive a 370px card without an ellipsis eating
            // the half that carries the meaning.
            <span className="inline-flex items-center gap-1.5 text-warn-ink" title="The dashboard is still showing the last published version of this flow">
              <PencilLine size={12} className="shrink-0" aria-hidden />
              Changes not live
            </span>
          ) : (
            `Edited ${formatDate(new Date(flow.updatedAt))}`
          )}
        </span>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button variant="destructive" size="sm" onClick={del} disabled={pending}>
              {pending ? "…" : "Delete"}
            </Button>
            <Button variant="ghost" size="iconSm" onClick={() => setConfirming(false)} aria-label="Cancel">
              <X />
            </Button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={duplicate} disabled={pending} title="Duplicate" aria-label="Duplicate">
              <Copy />
            </Button>
            <Button variant="destructiveGhost" size="icon" onClick={() => setConfirming(true)} disabled={pending} title="Delete" aria-label="Delete">
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

