"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Popover } from "./Popover";
import { SourceBadge } from "./Pill";
import type { DataField, DataGroup, FieldRef } from "./types";
import { childFields, filterFields, formatSample, makeFieldRef, FIELD_TYPE_FILTERS, type FieldTypeFilter } from "./field-utils";

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
  // Narrow the list to one kind of value (text / numbers / dates). Transient
  // browse state like the search — reset when the flyout closes.
  const [typeFilter, setTypeFilter] = useState<FieldTypeFilter>("all");
  // Drill state: which step, and the trail of container fields we've descended into.
  const [drill, setDrill] = useState<{ groupId: string; trail: DataField[] } | null>(null);
  // Which step groups are expanded. Collapsed by default so the user first sees every
  // available step (a lone group auto-expands, below); a search reveals matches.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Which long lists the user chose to see in full, keyed by group (or drill
  // trail). Reset with the flyout, like every other transient browse state.
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [flyoutWidth, setFlyoutWidth] = useState(savedFlyoutWidth);

  const setOpen = (o: boolean) => {
    setOpenRaw(o);
    if (!o) {
      setQ("");
      setTypeFilter("all");
      setDrill(null);
      setExpanded(new Set());
      setShowAll(new Set());
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

  /**
   * A long list opens at its most useful end and says how much more there
   * is. Search is unaffected — it always spans every field, so nothing here
   * can hide an answer, only defer it by one click.
   */
  const VISIBLE = 25;
  const CAP_AFTER = 30;
  const capped = (key: string, fields: DataField[], searching: boolean) => {
    if (searching || showAll.has(key) || fields.length <= CAP_AFTER) return { shown: fields, hidden: 0 };
    return { shown: fields.slice(0, VISIBLE), hidden: fields.length - VISIBLE };
  };
  const ShowAllRow = ({ k, hidden }: { k: string; hidden: number }) => (
    <button
      type="button"
      onClick={() => setShowAll((prev) => new Set(prev).add(k))}
      className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium text-indigo-600 hover:bg-indigo-50"
    >
      Show all {hidden + VISIBLE} fields
    </button>
  );

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

        <div className="space-y-2 border-b border-neutral-100 p-2.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search names or values…"
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
          {/* One kind of value at a time — "which date field?" shouldn't mean
              scrolling past forty text fields to compare three dates. */}
          <div className="flex gap-1">
            {FIELD_TYPE_FILTERS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTypeFilter(t.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  typeFilter === t.key ? "bg-indigo-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
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
                const allKids = childFields(drillField, 300);
                const kids = filterFields(allKids, q, typeFilter);
                if (kids.length === 0) {
                  // "Nothing inside this field." must mean EMPTY — when a chip
                  // or the search hid children that exist, say that instead
                  // (same wording family as the top-level empty state): a
                  // false statement of emptiness one chip away from visible
                  // contents reads as data loss.
                  const msg =
                    allKids.length === 0
                      ? "Nothing inside this field."
                      : q.trim()
                        ? `No fields in here match “${q.trim()}”${typeFilter !== "all" ? " with that type" : ""}.`
                        : "No fields of that type in here.";
                  return <p className="px-2 py-4 text-center text-xs text-neutral-400">{msg}</p>;
                }
                const key = `${drill.groupId}:${drill.trail.map((t) => t.path).join(">")}`;
                const { shown, hidden } = capped(key, kids, q.trim().length > 0 || typeFilter !== "all");
                return (
                  <div className="space-y-1">
                    {shown.map((f) => (
                      <FieldRow
                        key={f.path}
                        field={f}
                        onPick={() => pick(drillGroup, f)}
                        onDrill={() => setDrill({ groupId: drill.groupId, trail: [...drill.trail, f] })}
                      />
                    ))}
                    {hidden > 0 && <ShowAllRow k={key} hidden={hidden} />}
                  </div>
                );
              })()}
            </>
          )}

          {/* Top level: every valid earlier step as a collapsible group. */}
          {!drill &&
            anyFields &&
            groups.map((g) => {
              const fields = filterFields(g.fields, q, typeFilter);
              // An active type chip behaves like a search: groups auto-expand
              // to their matches and empty ones step aside.
              const searching = q.trim().length > 0 || typeFilter !== "all";
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
                    {/* While filtering, the count is the MATCHES — a "62" over
                        three visible rows reads as 59 fields being hidden. */}
                    <span className="shrink-0 text-[10px] text-neutral-400">{searching ? fields.length : g.fields.length}</span>
                  </button>
                  {isOpen && (() => {
                    const { shown, hidden } = capped(g.stepId, fields, searching);
                    return (
                      <div className="mt-1 space-y-1 pl-2.5">
                        {shown.map((f) => (
                          <FieldRow key={f.path} field={f} onPick={() => pick(g, f)} onDrill={() => setDrill({ groupId: g.stepId, trail: [f] })} />
                        ))}
                        {hidden > 0 && <ShowAllRow k={g.stepId} hidden={hidden} />}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

          {/* Search / type filter with no matches anywhere. */}
          {!drill && anyFields && (q.trim() || typeFilter !== "all") && groups.every((g) => filterFields(g.fields, q, typeFilter).length === 0) && (
            <p className="px-2 py-4 text-center text-xs text-neutral-400">
              {q.trim() ? <>No fields match “{q.trim()}”{typeFilter !== "all" ? " with that type" : ""}.</> : <>No fields of that type here.</>}
            </p>
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
            {/* Says what it DOES — now that search also matches values, this
                hatch must not read as "pick the record with this email". */}
            Use “<span className="font-medium text-neutral-800">{q.trim()}</span>” as a field path, exactly as typed
          </button>
        )}
      </>
    </Popover>
  );
}
