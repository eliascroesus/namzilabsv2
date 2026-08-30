"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/input";
import { Popover } from "./Popover";

export type Option = { value: string; label: string; hint?: string; group?: string; disabled?: boolean };

const BTN = cn(fieldClasses, "flex items-center justify-between gap-2 px-3 py-2 text-left hover:border-ring/50");

/**
 * A custom (non-native) select. Set `searchable` for combobox behaviour. Full keyboard
 * navigation (↑/↓/Home/End/Enter/Escape), Escape + outside-click close via Popover.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Choose…",
  searchable = false,
  width = 260,
  disabled = false,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  searchable?: boolean;
  width?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (searchable && query ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(query)) : options),
    [options, searchable, query],
  );
  const current = options.find((o) => o.value === value);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setQ("");
    setActive(Math.max(0, filtered.findIndex((o) => o.value === value)));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[active];
      if (o && !o.disabled) pick(o.value);
    }
  };

  // Group options under headers when any option has a `group`.
  /**
   * KEEP THE KEYBOARD HIGHLIGHT ON SCREEN.
   *
   * `listRef` was attached to the scroller and never read, so arrowing down a
   * long list — a Close connection's record types, a spreadsheet picker, the
   * ten date presets — moved the highlight out of view and left the user
   * scrolling blind, with Enter about to choose something they could not see.
   * The list is capped at `max-h-72`, so this bites on any list past about
   * nine options.
   */
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-opt="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Option[]>();
    for (const o of filtered) {
      const g = o.group ?? "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(o);
    }
    return [...groups.entries()];
  }, [filtered]);

  let flatIndex = -1;

  return (
    <Popover
      open={open}
      setOpen={setOpen}
      width={width}
      fixed
      anchor={
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
              e.preventDefault();
              openMenu();
            } else if (open) {
              onKey(e);
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={BTN}
        >
          <span className={`min-w-0 truncate ${current ? "text-foreground" : "text-muted-foreground"}`}>{current?.label ?? placeholder}</span>
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      }
    >
      <div ref={listRef} className="max-h-72 overflow-y-auto p-1" role="listbox">
        {searchable && (
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Search…"
            className={cn(fieldClasses, "mb-1 h-8 px-2.5")}
          />
        )}
        {filtered.length === 0 && <p className="p-2 text-center text-xs text-muted-foreground">No matches</p>}
        {grouped.map(([g, opts]) => (
          <div key={g || "_"}>
            {g && <p className="px-2 pb-0.5 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>}
            {opts.map((o) => {
              flatIndex += 1;
              const i = flatIndex;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  data-opt={i}
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  onClick={() => {
                    if (!o.disabled) pick(o.value);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted ${o.disabled ? "cursor-not-allowed opacity-50" : i === active ? "bg-accent text-accent-foreground" : ""}`}
                >
                  <span className="min-w-0">
                    <span className={`block ${o.disabled ? "" : "truncate"} ${o.value === value ? "font-medium text-foreground" : "text-foreground"}`}>{o.label}</span>
                    {o.hint && <span className={`block text-xs text-muted-foreground ${o.disabled ? "whitespace-normal" : "truncate"}`}>{o.hint}</span>}
                  </span>
                  {o.value === value && <Check size={14} className="shrink-0 text-muted-foreground" aria-hidden />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Popover>
  );
}
