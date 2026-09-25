"use client";

import { useState } from "react";
import { CalendarDays, LayoutDashboard, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceMark } from "@/components/source-mark";
import { sourceStyle } from "@/components/flow/controls/source-style";
import { groupAccent, groupBadge, groupInk, groupWash } from "@/components/flow/node-accent";
import { CHART_ICONS } from "@/lib/board/chart-icons";
import { asChartId, BLOCK_IDS } from "@/lib/board/charts";
import type { SnapshotTile, SnapshotView, TemplateSnapshot } from "@/lib/templates/snapshot";
import { cn } from "@/lib/utils";

/**
 * A TEMPLATE, DRAWN — what somebody gets before they decide to get it.
 *
 * The research this feature started from said it plainly: every product that
 * shares templates shows them before the copy is made (Notion's "View
 * template", Looker's preview, AgencyAnalytics' pane), and the ones that
 * fill the preview with DEMO NUMBERS teach a student to mistake a sample for
 * their own. So this draws the board as it will actually arrive: the same
 * boxes in the same places, dashed, each saying which metric goes in it — and
 * not one number anywhere.
 *
 * DRAWN FROM THE SNAPSHOT ALONE. It takes the same object `planApply` turns
 * into rows, so the preview cannot promise a board the copy does not make —
 * the argument `presets.ts` makes for drawing a layout thumbnail from the
 * preset's own array.
 *
 * Its own components rather than the board's: the live board is an editor
 * that loads actions, drag and a data layer, and a stranger's first look at a
 * template should load none of that.
 */
export function TemplatePreview({ snapshot }: { snapshot: TemplateSnapshot }) {
  const [active, setActive] = useState(0);
  const view = snapshot.views[Math.min(active, snapshot.views.length - 1)];
  return (
    <div data-template-preview>
      {snapshot.views.length > 1 && (
        /* TOGGLE BUTTONS, NOT A TAB LIST — the view switch's own reasoning in
           ConnectionRow.tsx: a real tablist owes arrow-key navigation, and a
           half-built one is a promise to a screen reader it does not keep. */
        <div aria-label="Views in this template" className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
          {snapshot.views.map((v, i) => {
            const Icon = v.kind === "calendar" ? CalendarDays : v.kind === "custom" ? LayoutDashboard : Users;
            return (
              <Button
                key={i}
                aria-pressed={i === active}
                variant={i === active ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActive(i)}
                className="shrink-0"
              >
                <Icon aria-hidden />
                {v.name}
              </Button>
            );
          })}
        </div>
      )}
      <div aria-label={view.name} className="rounded-card border border-border bg-muted/50 p-3 sm:p-4">
        <ViewBody view={view} />
      </div>
    </div>
  );
}

function ViewBody({ view }: { view: SnapshotView }) {
  if (view.kind === "custom") return <CanvasPreview tiles={view.tiles} />;
  if (view.kind === "groups") return <ColumnsPreview groups={view.groups} />;
  return <CalendarPreview note={view.note} apps={view.apps} />;
}

/**
 * THE CANVAS AT ITS OWN GEOMETRY, SMALLER. Twelve columns and the tiles' own
 * boxes, at a 20px row where the board uses 40 — the proportions are the
 * board's, the scale is a preview's. Below `sm` the grid gives way to a stack
 * in reading order, which is what the live board does on a phone too.
 */
function CanvasPreview({ tiles }: { tiles: SnapshotTile[] }) {
  if (tiles.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">An empty canvas, ready for charts.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:auto-rows-[20px]">
      {tiles.map((t, i) => (
        <div
          key={i}
          style={
            {
              "--c": `${t.x + 1} / span ${t.w}`,
              "--r": `${t.y + 1} / span ${t.h}`,
              "--h": `${Math.max(2, t.h) * 20}px`,
            } as React.CSSProperties
          }
          className="min-h-[var(--h)] sm:min-h-0 sm:[grid-column:var(--c)] sm:[grid-row:var(--r)]"
        >
          <TilePreview tile={t} />
        </div>
      ))}
    </div>
  );
}

const TEXT_SIZE: Record<string, string> = { sm: "text-xs", md: "text-sm", lg: "text-md", xl: "text-lg", "2xl": "text-xl" };
const TEXT_WEIGHT: Record<string, string> = { normal: "font-normal", medium: "font-medium", semibold: "font-semibold" };

function TilePreview({ tile }: { tile: SnapshotTile }) {
  const block = (BLOCK_IDS as readonly string[]).includes(tile.chart) ? tile.chart : null;
  if (block === "divider") {
    return (
      <div className="flex h-full items-center" aria-hidden>
        <div className="h-px w-full bg-border" />
      </div>
    );
  }
  if (block) {
    const c = tile.config as { text?: string; textSize?: string; textWeight?: string; align?: string; valign?: string };
    return (
      <div
        className={cn(
          "flex h-full overflow-hidden px-1",
          c.valign === "top" ? "items-start" : c.valign === "bottom" ? "items-end" : "items-center",
        )}
      >
        <p
          className={cn(
            "w-full whitespace-pre-line text-foreground",
            TEXT_SIZE[c.textSize ?? "xl"] ?? "text-lg",
            TEXT_WEIGHT[c.textWeight ?? "semibold"] ?? "font-semibold",
            c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : "text-left",
          )}
        >
          {c.text || (block === "heading" ? "Heading" : "Text")}
        </p>
      </div>
    );
  }
  const Icon = CHART_ICONS[asChartId(tile.chart)];
  /* THE NOTE LEADS AND THE FURNITURE FOLLOWS. A number slot is four 20px rows
     here, and giving the chart glyph a row of its own cut a two-line note off
     mid-sentence with no ellipsis; beside the apps it costs no height at all. */
  return (
    <div
      data-template-slot
      className="flex h-full flex-col gap-1.5 overflow-hidden rounded-surface border border-dashed border-border bg-card p-2.5"
    >
      <p className={cn("line-clamp-3 text-sm", tile.note ? "font-medium text-foreground" : "text-muted-foreground")}>
        {tile.note ?? "Any metric you like"}
      </p>
      <p className="mt-auto flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <AppMarks apps={tile.apps} />
      </p>
    </div>
  );
}

function AppMarks({ apps }: { apps: string[] }) {
  if (apps.length === 0) return null;
  return (
    <>
      <span className="flex shrink-0 items-center gap-1" aria-hidden>
        {apps.slice(0, 3).map((a) => (
          <SourceMark key={a} source={a} size={14} />
        ))}
      </span>
      <span className="truncate">{apps.map((a) => sourceStyle(a).label).join(", ")}</span>
    </>
  );
}

function Apps({ apps, className }: { apps: string[]; className?: string }) {
  if (apps.length === 0) return null;
  return (
    <p className={cn("mt-auto flex max-w-full items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <AppMarks apps={apps} />
    </p>
  );
}

/** The columns, each saying which metrics belong in it — the board's own colours. */
function ColumnsPreview({ groups }: { groups: Extract<SnapshotView, { kind: "groups" }>["groups"] }) {
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Every metric in the workspace, on one board — no columns yet.
      </p>
    );
  }
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {groups.map((g, i) => (
        <section
          key={i}
          aria-label={g.name}
          className="w-60 shrink-0 overflow-hidden rounded-card"
          style={{ background: groupWash(g.color), boxShadow: `inset 0 0 0 1px ${groupAccent(g.color)}24` }}
        >
          <div className="h-1 w-full" style={{ background: groupAccent(g.color) }} aria-hidden />
          <div className="flex h-10 items-center px-2.5">
            <span className="flex min-w-0 items-center gap-1.5 rounded-xs py-1 pl-2 pr-2" style={{ background: groupBadge(g.color) }}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: groupAccent(g.color) }} aria-hidden />
              <span className="truncate text-sm font-semibold" style={{ color: groupInk(g.color) }}>
                {g.name}
              </span>
            </span>
          </div>
          <div className="px-2.5 pb-2.5">
            <div
              className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-surface border border-dashed px-3 py-3 text-center text-xs"
              style={{ borderColor: `${groupAccent(g.color)}59`, color: groupInk(g.color) }}
            >
              {g.note ? <p className="line-clamp-4 text-sm font-medium">{g.note}</p> : <p>Any metrics you like</p>}
              <Apps apps={g.apps} className="mt-0 justify-center" />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** A month of empty days, and what the calendar is meant to count. */
function CalendarPreview({ note, apps }: { note: string | null; apps: string[] }) {
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        A calendar of <span className="font-medium text-foreground">{note ?? "one metric, day by day"}</span>
      </p>
      <div className="grid grid-cols-7 gap-1.5" aria-hidden>
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="aspect-square rounded-xs bg-card" />
        ))}
      </div>
      <Apps apps={apps} className="mt-3" />
    </div>
  );
}
