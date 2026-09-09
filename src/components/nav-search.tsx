"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Monitor, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { CHOICES } from "@/components/theme";
import { NAV } from "@/components/sidebar";
import { railSearchEntries } from "@/lib/rail-search";
import { viewStrip, type BoardView } from "@/lib/board/types";

/**
 * THE SEARCH FIELD, WHICH USED TO BE THE RAIL'S AND IS THE BAR'S NOW.
 *
 * Node 0:5 draws it in the top bar at 480x40 and draws no search in the rail at
 * all, so the field moved. What moved with it is less obvious and matters more:
 * the RESULTS could not follow the same shape.
 *
 * In the rail the matches replaced the nav column in place, and the file said
 * why — that <nav> is `overflow-y-auto`, which makes it the clipping box for
 * any absolutely-positioned child, so a dropdown under the field would have
 * been cut off at the column's foot. Filtering the column was the way around a
 * box it could not escape.
 *
 * The bar is not that box. It clips nothing, so the constraint that forced
 * in-place filtering is simply gone and the results can be what they wanted to
 * be. The alternative — keeping the field here and the matches over in the left
 * column — would mean typing in one corner of the screen and reading the answer
 * in another, which is the shape the rail was working around rather than the
 * shape it wanted.
 *
 * THE FIGMA DOES NOT DRAW THIS PANEL. It draws the resting field and nothing
 * else, so the open state is the one part of this bar that is not 1:1 with a
 * frame. It is built out of the tokens the rest of the bar uses.
 */

/** The glyph a result wears — from the SAME table the rail's rows draw from, so
 *  a result and the row it points at can never show two different pictures. */
function PageGlyph({ label }: { label: string }) {
  const Icon = NAV.find((n) => n.label === label)?.icon ?? LayoutDashboard;
  return <Icon aria-hidden className="size-[18px] shrink-0" />;
}

function ThemeGlyph({ value }: { value: "light" | "dark" | "system" }) {
  const Icon = CHOICES.find((c) => c.value === value)?.Icon ?? Monitor;
  return <Icon aria-hidden className="size-[18px] shrink-0" />;
}

export function NavSearch({ views = [], hide }: { views?: BoardView[]; hide?: string[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { setTheme } = useTheme();

  /**
   * ⌘K, WHICH TRAVELLED WITH THE FIELD.
   *
   * `aria-keyshortcuts="Meta+K"` announced this binding for months before any
   * code implemented it. It works, and it follows the input rather than staying
   * behind in a column that no longer has one.
   *
   * On `window` and in the CAPTURE phase, because a shortcut whose only
   * listener is the thing it focuses can never fire, and because the canvas and
   * the modals stop propagation.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  /** A press outside closes the panel; the field itself is inside `box`. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const items = NAV.filter((i) => !hide?.includes(i.label)).map(({ label, href }) => ({ label, href }));
  const results = q
    ? railSearchEntries({ items, views: viewStrip(views), themes: CHOICES }).filter((e) =>
        e.label.toLowerCase().includes(q),
      )
    : [];

  return (
    <div ref={box} className="relative flex h-10 flex-1 items-center">
      {/* 410x40 at a 480px group, `--topbar-control` fill, radius 8, and the
          12px inset the Figma puts the magnifier at. `gap-2.5` is the 10px
          between the glyph and the placeholder — one of the four gaps in this
          bar that is not an 8 or a 4. */}
      <div className="flex size-full items-center gap-2.5 rounded-control bg-topbar-control px-3">
        <Search aria-hidden className="size-[18px] shrink-0 text-topbar-muted" />
        <input
          ref={field}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setQuery(""))}
          placeholder="Search..."
          aria-label="Search the navigation"
          aria-keyshortcuts="Meta+K"
          className="min-w-0 flex-1 bg-transparent text-[15px] leading-[22px] text-topbar-foreground outline-none placeholder:text-topbar-muted"
        />
      </div>

      {open && q && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 flex flex-col gap-1 rounded-card border border-border bg-card p-1 shadow-float"
        >
          {results.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No matches.</p>
          ) : (
            results.map((entry) =>
              /* A destination is an <a> the browser can open in a new tab, and
                 setting the theme is a press. Making both a <button> would cost
                 the first its middle-click; making both a link would need an
                 href for something that goes nowhere. */
              entry.kind === "theme" ? (
                <Button
                  key={entry.label}
                  variant="ghost"
                  onClick={() => {
                    setTheme(entry.theme);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="h-auto w-full justify-start gap-2.5 rounded-control px-2 py-1.5 text-left text-sm font-normal text-foreground hover:bg-accent"
                >
                  <ThemeGlyph value={entry.theme} />
                  {entry.label}
                </Button>
              ) : (
                <Link
                  key={`${entry.kind}-${entry.label}-${entry.href}`}
                  href={entry.href}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-foreground transition-colors duration-(--duration-fast) hover:bg-accent"
                >
                  <PageGlyph label={entry.label} />
                  {entry.label}
                </Link>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}
