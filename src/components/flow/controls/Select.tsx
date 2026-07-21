"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "./Popover";

export type Option = { value: string; label: string; hint?: string; group?: string; disabled?: boolean };

const BTN = "flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-left text-sm hover:border-neutral-400 focus:border-neutral-400 focus:outline-none";

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
  align = "left",
  buttonClassName,
  disabled = false,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  searchable?: boolean;
  width?: number;
  align?: "left" | "right";
  buttonClassName?: string;
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
      align={align}
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
          className={`${buttonClassName ?? BTN} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          <span className={`min-w-0 truncate ${current ? "text-neutral-800" : "text-neutral-400"}`}>{current?.label ?? placeholder}</span>
          <span className="shrink-0 text-neutral-400">▾</span>
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
            className="mb-1 w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none"
          />
        )}
        {filtered.length === 0 && <p className="p-2 text-center text-xs text-neutral-400">No matches</p>}
        {grouped.map(([g, opts]) => (
          <div key={g || "_"}>
            {g && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g}</p>}
            {opts.map((o) => {
              flatIndex += 1;
              const i = flatIndex;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  onClick={() => {
                    if (!o.disabled) pick(o.value);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${o.disabled ? "cursor-not-allowed opacity-50" : i === active ? "bg-neutral-100" : ""}`}
                >
                  <span className="min-w-0">
                    <span className={`block ${o.disabled ? "" : "truncate"} ${o.value === value ? "font-medium text-neutral-900" : "text-neutral-700"}`}>{o.label}</span>
                    {o.hint && <span className={`block text-[10px] text-neutral-400 ${o.disabled ? "whitespace-normal" : "truncate"}`}>{o.hint}</span>}
                  </span>
                  {o.value === value && <span className="shrink-0 text-neutral-500">✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Popover>
  );
}
