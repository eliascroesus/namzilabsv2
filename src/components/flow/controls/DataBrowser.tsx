"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Popover } from "./Popover";
import { SourceBadge } from "./Pill";
import type { DataField, DataGroup, FieldRef } from "./types";
import { childFields, filterFields, formatSample, makeFieldRef } from "./field-utils";

/** Remembered across opens within the session (persists a drag-resize). */
let savedFlyoutWidth = 340;

/** One selectable field row — a soft grey card so each value/sample pair reads as
 *  a distinct, easy-to-scan item. Human label + type + real sample; containers drill. */
function FieldRow({ field, onDrill, onPick }: { field: DataField; onDrill: () => void; onPick: () => void }) {
  const sample = formatSample(field.sample);
  return (
    <button
      type="button"
      onClick={field.container ? onDrill : onPick}
      className="flex w-full items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/50"
    >
      <span className="flex min-w-0 max-w-[55%] shrink-0 items-center gap-1.5">
        <span className="truncate text-sm text-neutral-800">{field.label}</span>
        {field.type && field.type !== "unknown" && (
          <span className="shrink-0 rounded border border-neutral-200 bg-white px-1 text-[9px] uppercase tracking-wide text-neutral-400">{field.type}</span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-neutral-400">{sample ?? ""}</span>
      {field.container && <span className="shrink-0 text-neutral-400" aria-hidden>›</span>}
    </button>
  );
}

/**
 * The "Insert data" browser — Zapier's Previous Steps browser. Shows fields produced by
 * earlier steps, grouped by step, with the app badge, step number, human field names,
 * real sample values, and data types. Objects/arrays drill in (nested values); a search
 * filters the current level. Picking a field emits a {@link FieldRef} (identity by
 * producing step + path).
 *
 * It opens as a flyout to the LEFT of the config window (top-aligned with its tabs,
 * height wrapping the content up to the window's height), a touch narrower than the
 * window and resizable by dragging its left edge.
 */
export function DataBrowser({
  groups,
  onPick,
  onCustom,
  trigger,
}: {
  groups: DataGroup[];
  onPick: (ref: FieldRef) => void;
  /** When set, the search text can be committed as-is (a custom field path). */
  onCustom?: (text: string) => void;
  trigger: (o: { open: boolean; toggle: () => void }) => ReactNode;
}) {
  const [open, setOpenRaw] = useState(false);
  const [q, setQ] = useState("");
  // Drill state: which step, and the trail of container fields we've descended into.
  const [drill, setDrill] = useState<{ groupId: string; trail: DataField[] } | null>(null);
  // Which step groups are expanded. Collapsed by default so the user first sees every
  // available step (a lone group auto-expands, below); a search reveals matches.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flyoutWidth, setFlyoutWidth] = useState(savedFlyoutWidth);

  const setOpen = (o: boolean) => {
    setOpenRaw(o);
    if (!o) {
      setQ("");
      setDrill(null);
      setExpanded(new Set());
    }
  };
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggle = () => setOpen(!open);

  // Drag the left edge to widen/narrow the flyout (its right edge stays glued to
  // the config window). The chosen width persists for the session.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = flyoutWidth;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(280, Math.min(760, startW + (startX - ev.clientX)));
      setFlyoutWidth(next);
      savedFlyoutWidth = next;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const drillGroup = drill ? groups.find((g) => g.stepId === drill.groupId) : undefined;
  const drillField = drill && drill.trail.length ? drill.trail[drill.trail.length - 1] : undefined;

  const pick = (group: DataGroup, field: DataField) => {
    onPick(makeFieldRef(group, field));
    setOpen(false);
  };

  const anyFields = useMemo(() => groups.some((g) => g.fields.length > 0), [groups]);
  // A single available step is auto-expanded (nothing to choose between); with more
  // than one, they stay collapsed so the user picks the step first.
  const soleGroup = groups.length === 1;

  return (
    <Popover
      open={open}
      setOpen={setOpen}
      width={flyoutWidth}
      fixed
      placement="left"
      anchorRect={() => {
        const panel = document.querySelector<HTMLElement>("[data-config-panel]");
        if (!panel) return null;
        const pr = panel.getBoundingClientRect();
        // Top-align with the tab strip (just under the header), spanning to the bottom.
        const tabs = document.querySelector<HTMLElement>("[data-config-tabs]");
        const top = tabs ? tabs.getBoundingClientRect().top : pr.top;
        return new DOMRect(pr.left, top, pr.width, pr.bottom - top);
      }}
      panelClassName="rounded-2xl border border-neutral-200 bg-white flow-shadow"
      anchor={trigger({ open, toggle })}
    >
      <>
        {/* Left-edge resize handle. */}
        <div onPointerDown={startResize} title="Drag to resize" className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize transition-colors hover:bg-indigo-200/70" />

        <div className="border-b border-neutral-100 p-2.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search fields…"
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
        </div>

        {/* Drill breadcrumb */}
        {drill && drillGroup && (
          <div className="flex items-center gap-1 border-b border-neutral-100 px-2 py-1 text-[11px] text-neutral-500">
            <button
              type="button"
              onClick={() => setDrill(drill.trail.length > 1 ? { groupId: drill.groupId, trail: drill.trail.slice(0, -1) } : null)}
              className="rounded px-1 hover:bg-neutral-100"
            >
              ‹ Back
            </button>
            <span className="truncate">
              {drillGroup.title}
              {drill.trail.map((f) => ` › ${f.label}`).join("")}
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!anyFields && (
            <p className="px-2 py-6 text-center text-xs text-neutral-400">No data yet. Test an earlier step to bring its fields here.</p>
          )}

          {/* Drilled-in view: children of the current container field. */}
          {drill && drillGroup && drillField && (
            <>
              {(() => {
                const kids = filterFields(childFields(drillField), q);
                if (kids.length === 0) return <p className="px-2 py-4 text-center text-xs text-neutral-400">Nothing inside this field.</p>;
                return (
                  <div className="space-y-1">
                    {kids.map((f) => (
                      <FieldRow
                        key={f.path}
                        field={f}
                        onPick={() => pick(drillGroup, f)}
                        onDrill={() => setDrill({ groupId: drill.groupId, trail: [...drill.trail, f] })}
                      />
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {/* Top level: every valid earlier step as a collapsible group. */}
          {!drill &&
            anyFields &&
            groups.map((g) => {
              const fields = filterFields(g.fields, q);
              const searching = q.trim().length > 0;
              if (searching && fields.length === 0) return null;
              const isOpen = searching || soleGroup || expanded.has(g.stepId);
              return (
                <div key={g.stepId} className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.stepId)}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50"
                  >
                    <span className={`shrink-0 text-neutral-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
                    {g.system ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-neutral-200 text-[8px] font-semibold text-neutral-500" aria-hidden>⚙</span>
                    ) : (
                      <SourceBadge source={g.source} size={16} />
                    )}
                    {g.stepNo != null && <span className="text-[11px] font-semibold text-neutral-400">{g.stepNo}.</span>}
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700">{g.title}</span>
                    <span className="shrink-0 text-[10px] text-neutral-400">{g.fields.length}</span>
                  </button>
                  {isOpen && (
                    <div className="mt-1 space-y-1 pl-2.5">
                      {fields.map((f) => (
                        <FieldRow key={f.path} field={f} onPick={() => pick(g, f)} onDrill={() => setDrill({ groupId: g.stepId, trail: [f] })} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Search with no matches anywhere. */}
          {!drill && anyFields && q.trim() && groups.every((g) => filterFields(g.fields, q).length === 0) && (
            <p className="px-2 py-4 text-center text-xs text-neutral-400">No fields match “{q.trim()}”.</p>
          )}
        </div>

        {/* Free-typing escape hatch: commit the search text as a custom field path. */}
        {onCustom && !drill && q.trim() && (
          <button
            type="button"
            onClick={() => {
              onCustom(q.trim());
              setOpen(false);
            }}
            className="border-t border-neutral-100 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50"
          >
            Use “<span className="font-medium text-neutral-800">{q.trim()}</span>” exactly as typed
          </button>
        )}
      </>
    </Popover>
  );
}
