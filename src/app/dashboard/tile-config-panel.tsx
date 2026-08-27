"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FieldHint, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { PANEL_SHELL, PanelTabs } from "@/components/flow/panel-chrome";
import { GROUP_ACCENT, groupAccent } from "@/components/flow/node-accent";
import { CHARTS, asChartId, blockKindOf, blockTileKey, type BlockId, type ChartId } from "@/lib/board/charts";
import { fieldsFor, type TileConfig } from "@/lib/board/tile-config";
import { RANGE_OPTIONS, MATERIALIZED_RANGES } from "@/lib/metrics/range";
import { MetricList } from "./add-tile-picker";
import type { CustomTileOption } from "@/lib/board/types";

/**
 * EVERYTHING ABOUT ONE TILE, IN ONE PLACE.
 *
 * Adding a chart lands it immediately, bound to the first metric that can be
 * drawn that way — that was the whole point of killing the two-step modal. The
 * consequence is that every other decision has to be askable AFTERWARDS, on the
 * tile, and this is where they are asked.
 *
 * WHAT IT OFFERS IS NOT WRITTEN HERE. `fieldsFor(chart)` is the one table, and
 * the renderer reads the same one to decide what to honour — so a control that
 * appears here is a control the drawing actually reads, and a setting the
 * drawing ignores cannot appear. The pie has no colour picker not because this
 * file remembered, but because `PieChart` takes no accent and the table says so.
 *
 * NOT THE FLOW BUILDER'S FLYOUT. `ConfigPanel` positions itself against
 * `top-chrome-band` — 106px of toolbar island that exists on the flow canvas
 * and nowhere else — and its Popover variant measures `[data-config-panel]`.
 * Inheriting either would be inheriting a fact about a different page. What IS
 * shared is the part that should be: `PANEL_SHELL`, the tab row, and the
 * `min-h-0 flex-1 overflow-y-auto` body, so the two panels are one design
 * rather than two that resemble each other.
 *
 * EVERY WRITE IS OPTIMISTIC AND KEY-SCOPED. The value changes here the instant
 * it is clicked, the action writes behind it, and a failure puts back only the
 * keys that write touched — never a whole snapshot, because a neighbouring
 * edit may be in flight. That is `useSettle`'s contract, applied per setting.
 */

const TABS = ["data", "style"] as const;
type Tab = (typeof TABS)[number];

/**
 * A labelled field. The panel is a stack of these and nothing else, so the
 * rhythm between them IS the panel's design: one label size, one gap, one hint
 * position. `mb-1.5` comes from `FieldLabel`, which is the kit's single value
 * for it.
 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

/**
 * A hairline between groups of fields.
 *
 * Six controls in one flat column is a list to be read top to bottom; the same
 * six in three named groups is a form to be scanned. The rule carries the
 * grouping without a second type size or a second surface colour — the panel is
 * ONE plane, the argument `panel-chrome.tsx` makes for the builder's.
 */
function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      {label && (
        <p className="-mb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      )}
      {children}
    </div>
  );
}

/** A switch with its label on the left, which is the only shape a toggle row takes. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <FieldLabel className="mb-0">{label}</FieldLabel>
        {hint && <FieldHint className="mt-0.5">{hint}</FieldHint>}
      </div>
      <Switch
        checked={checked}
        onClick={() => onChange(!checked)}
        aria-label={label}
        size="sm"
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

/**
 * A NUMBER THAT MAY BE BLANK, and blank means "follow the metric".
 *
 * Typing is local state, not a write per keystroke: `12` typed one digit at a
 * time would otherwise write `1` and then `12`, and the first is a real value
 * somebody could be left with if the second failed. It commits on blur and on
 * Enter, and an empty field CLEARS the key rather than storing zero — the
 * difference between "no goal set" and "a goal of nothing".
 */
function NumberRow({
  label,
  hint,
  value,
  placeholder,
  min,
  max,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  onCommit: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  // Follow the tile when it changes underneath — a chart switch or a revert.
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);

  const commit = () => {
    const t = draft.trim();
    if (!t) return onCommit(undefined);
    const n = Number(t);
    if (!Number.isFinite(n)) return setDraft(value == null ? "" : String(value));
    onCommit(n);
  };

  return (
    <Row label={label} hint={hint}>
      <Input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-8 w-full"
      />
    </Row>
  );
}

export function TileConfigPanel({
  chart: rawChart,
  charts,
  config,
  metricName,
  tileKey,
  metricTarget,
  isFlow,
  boardRange,
  options,
  busy,
  initialTab = "data",
  onClose,
  onChart,
  onMetric,
  onConfig,
}: {
  chart: string;
  /** What this tile's METRIC can be drawn as — computed server-side by `chartsFor`. */
  charts: string[];
  config: TileConfig;
  metricName: string;
  tileKey: string;
  /** The flow's own goal, shown as the placeholder the tile falls back to. */
  metricTarget?: number | null;
  /** Only a flow tile carries every period; a classic one is computed for one. */
  isFlow: boolean;
  boardRange: string;
  options: CustomTileOption[];
  busy: boolean;
  /**
   * WHICH TAB OPENS. Data, because adding a chart binds it to the first metric
   * that can be drawn that way — deliberately, so the add lands in one press —
   * which makes "is this the right metric?" the one question a new tile always
   * has. Style is one click away and is where a settled tile lives.
   */
  initialTab?: Tab;
  onClose: () => void;
  onChart: (chart: ChartId) => void;
  onMetric: (tileKey: string) => void;
  /** Set some keys, clear others. Both halves optimistic; see the header. */
  onConfig: (set: TileConfig, clear?: Array<keyof TileConfig>) => void;
}) {
  const chart = asChartId(rawChart);
  /**
   * A BLOCK HAS NO DATA TAB, and the tab is HIDDEN rather than shown empty.
   *
   * Every control on Data asks something about a metric — which one, over what
   * period, ordered how — and a heading has no metric to ask about. A tab that
   * opens onto nothing is worse than no tab: it reads as a feature that failed
   * to load rather than one that does not apply.
   */
  const block = blockKindOf(blockTileKey(chart as BlockId));
  const tabs = block ? (["style"] as const) : TABS;
  const [tab, setTab] = useState<Tab>(block ? "style" : initialTab);
  const offers = new Set<string>(fieldsFor(chart));

  // Escape closes it. The panel covers part of the board, so there has to be a
  // way out that is not "find the small X" — the same argument ConfigPanel's
  // own close button was added for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The OUTERMOST layer, so it stands down for anything that claimed the
      // key first — a live drag calls `preventDefault` when it cancels itself,
      // and Escape should not both abandon a gesture and close this.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** One key at a time — an empty value clears rather than stores. */
  const set = <K extends keyof TileConfig>(key: K, value: TileConfig[K] | undefined) =>
    value === undefined ? onConfig({}, [key]) : onConfig({ [key]: value } as TileConfig);

  const legal = CHARTS.filter((c) => charts.includes(c.id));

  return (
    <aside
      data-tile-panel
      aria-label={`Settings for ${config.title || metricName}`}
      /**
       * AS TALL AS ITS CONTENT, capped at the viewport — not pinned top AND
       * bottom. A divider's panel has one sentence in it and a scorecard's has
       * six controls; stretching both to the full window left most of the
       * surface empty and made a short form look like a long one that had
       * failed to load. `max-h` keeps the scroll behaviour for the tallest.
       */
      className={`fixed right-4 top-4 z-30 max-h-[calc(100dvh-2rem)] w-[min(384px,calc(100vw-2rem))] ${PANEL_SHELL}`}
    >
      <div className="flex items-start gap-3 border-b border-border bg-card px-5 py-4">
        <div className="min-w-0 flex-1">
          {/* The eyebrow names the CHART, not the panel: "Chart settings" over
              a title the tile already shows said nothing the header did not. */}
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            {(CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label}
          </p>
          <p className="mt-0.5 truncate text-title font-semibold text-foreground">{config.title || metricName}</p>
        </div>
        <Button variant="ghost" size="iconSm" onClick={onClose} aria-label="Close chart settings" title="Close">
          <X size={18} strokeWidth={2} />
        </Button>
      </div>

      <PanelTabs tabs={tabs} active={tab} onSelect={setTab} />

      <div className="min-h-0 flex-1 overflow-y-auto quiet-scroll">
        <div className="flex flex-col gap-4 p-4">
          {tab === "data" ? (
            <>
              <Group>
              <Row
                label="Metric"
                hint={`Only metrics that can be drawn as a ${(
                  CHARTS.find((c) => c.id === chart) ?? CHARTS[0]
                ).label.toLowerCase()} are listed.`}
              >
                {/* A bordered, scrolling box so the list reads as a LIST
                    rather than as loose rows floating in the panel — the same
                    containment the kit's Table gives a set of rows. */}
                <div className="rounded-control border border-border p-1">
                  <MetricList options={options} chart={chart} busy={busy} selected={tileKey} onPick={onMetric} />
                </div>
              </Row>
              </Group>

              {offers.has("rangeKey") && (
                <Group label="Window">
                <Row
                  label="Period"
                  hint={
                    isFlow
                      ? "Follows the board's pills unless you pin one here. Every period is already computed, so pinning costs nothing."
                      : "This metric is computed live for the board's period, so it can't be pinned to another one."
                  }
                >
                  <NativeSelect
                    value={config.rangeKey ?? ""}
                    disabled={!isFlow}
                    aria-label="Period"
                    onChange={(e) =>
                      set("rangeKey", (e.target.value || undefined) as TileConfig["rangeKey"] | undefined)
                    }
                  >
                    <option value="">
                      Follow the board ({RANGE_OPTIONS.find((r) => r.key === boardRange)?.label ?? boardRange})
                    </option>
                    {RANGE_OPTIONS.filter((r) => (MATERIALIZED_RANGES as string[]).includes(r.key)).map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Row>
                </Group>
              )}

              {(offers.has("sort") || offers.has("limit")) && (
                <Group label="Rows">
                  <>
              {offers.has("sort") && (
                <Row label="Order">
                  <NativeSelect
                    value={config.sort ?? "stored"}
                    aria-label="Order"
                    onChange={(e) => set("sort", e.target.value as TileConfig["sort"])}
                  >
                    <option value="stored">As the metric computed them</option>
                    <option value="value_desc">Largest first</option>
                    <option value="value_asc">Smallest first</option>
                    <option value="label_asc">By name</option>
                  </NativeSelect>
                </Row>
              )}

              {offers.has("limit") && (
                <NumberRow
                  label="Show at most"
                  hint={
                    chart === "pie"
                      ? "Everything past this rolls into one Other slice, and the tile says so."
                      : "The rest stay counted — the tile prints how many it didn't show."
                  }
                  value={config.limit}
                  placeholder={chart === "pie" ? "6" : "All of them"}
                  min={1}
                  max={50}
                  /* CLAMPED, like Decimals below. `min`/`max` on a number
                     input are constraint validation only — `.value` still
                     returns whatever was typed — so 999 rendered optimistically,
                     was refused by the server, and surfaced the raw key name in
                     a toast. */
                  onCommit={(n) => set("limit", n == null ? undefined : Math.max(1, Math.min(50, Math.round(n))))}
                />
              )}
                  </>
                </Group>
              )}
            </>
          ) : block ? (
            /* ONLY its content. A block has no chart to change (`chartsFor`
               never offers one), no colour, no decimals and no goal — the field
               table says so, and this reads the table rather than repeating it. */
            offers.has("text") ? (
              <Row
                label={block === "heading" ? "Heading" : "Note"}
                hint={block === "heading" ? undefined : "Line breaks are kept."}
              >
                <Textarea
                  defaultValue={config.text ?? ""}
                  key={config.text ?? ""}
                  placeholder={block === "heading" ? "Acquisition" : "What this section shows, and where the numbers come from."}
                  aria-label={block === "heading" ? "Heading" : "Note"}
                  maxLength={2000}
                  rows={block === "heading" ? 2 : 6}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (config.text ?? "")) set("text", v || undefined);
                  }}
                  className="w-full"
                />
              </Row>
            ) : (
              <p className="text-small text-muted-foreground">
                A divider has nothing to set — drag its edges to change how much room it takes.
              </p>
            )
          ) : (
            <>
              <Group>
              <Row label="Chart">
                {/* Only what this METRIC can be drawn as. The list came from the
                    server's `chartsFor`; offering an illegal one here and
                    refusing it on click would be a menu that lies. */}
                <div className="grid grid-cols-2 gap-1.5">
                  {legal.map((c) => (
                    <Button
                      key={c.id}
                      variant={c.id === chart ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => onChart(c.id)}
                      aria-pressed={c.id === chart}
                      className="h-auto justify-start px-2 py-1.5 text-left"
                    >
                      <span className="truncate text-small">{c.label}</span>
                    </Button>
                  ))}
                </div>
              </Row>

              <Row label="Name" hint="Leave it empty to follow the metric's own name.">
                <Input
                  defaultValue={config.title ?? ""}
                  key={config.title ?? ""}
                  placeholder={metricName}
                  aria-label="Chart name"
                  maxLength={60}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (config.title ?? "")) set("title", v || undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 w-full"
                />
              </Row>
              </Group>

              <Group label="Appearance">
                <>
              {offers.has("color") && (
                <Row
                  label="Colour"
                  /* On a scorecard the accent reaches the TREND LINE and
                     nothing else — the number is ink and the goal bar is a
                     success/brand token. Saying so is the difference between a
                     control that appears broken and one whose scope is known. */
                  hint={chart === "number" ? "Colours the trend line, when it's shown." : undefined}
                >
                  {/* THE SAME GRID THE GROUP PICKER USES — twelve swatches, two
                      rows, rounded squares rather than discs, and the hue read
                      from the palette BY KEY so a re-solve restyles every board
                      at once. A list of colour names would be twelve rows to
                      say what this says at a glance. */}
                  <div className="grid grid-cols-6 gap-1">
                    {Object.keys(GROUP_ACCENT).map((key) => (
                      <Button
                        key={key}
                        variant="ghost"
                        size="iconSm"
                        onClick={() => set("color", key)}
                        aria-label={key}
                        aria-pressed={config.color === key}
                        title={key}
                        className="flex items-center justify-center"
                      >
                        <span
                          className="flex size-5 items-center justify-center rounded-[calc(var(--radius-control)-3px)]"
                          style={{ background: groupAccent(key) }}
                        >
                          {config.color === key && <Check size={11} strokeWidth={3.5} className="text-white" />}
                        </span>
                      </Button>
                    ))}
                  </div>
                </Row>
              )}

              {offers.has("precision") && (
                <NumberRow
                  label="Decimals"
                  hint="Leave it empty to follow the metric's own."
                  value={config.precision}
                  placeholder="Follow the metric"
                  min={0}
                  max={4}
                  onCommit={(n) =>
                    set("precision", n == null ? undefined : Math.max(0, Math.min(4, Math.round(n))))
                  }
                />
              )}

              {offers.has("target") && (
                <NumberRow
                  label="Goal"
                  hint={
                    metricTarget != null
                      ? "Empty follows the goal set on the metric itself."
                      : "The metric has no goal of its own."
                  }
                  value={config.target ?? undefined}
                  placeholder={metricTarget != null ? String(metricTarget) : "No goal"}
                  onCommit={(n) => set("target", n)}
                />
              )}

                </>
              </Group>

              <Group label="What to show">
                <>
              {offers.has("showGoal") && (
                <ToggleRow
                  label="Mark the goal"
                  hint={chart === "number" ? "Adds a progress bar under the number." : "Draws it as a dashed line."}
                  checked={config.showGoal === true}
                  onChange={(v) => set("showGoal", v)}
                />
              )}

              {offers.has("showDelta") && (
                <ToggleRow
                  label="Compare to the period before"
                  checked={config.showDelta !== false}
                  onChange={(v) => set("showDelta", v)}
                />
              )}

              {offers.has("showSpark") && (
                <ToggleRow
                  label="Show the trend"
                  hint="A small line under the number. Needs a metric with a trend."
                  checked={config.showSpark === true}
                  onChange={(v) => set("showSpark", v)}
                />
              )}

              {offers.has("showLabels") && (
                <ToggleRow
                  label="Label every bar"
                  hint="Printed only when twelve or fewer bars fit."
                  checked={config.showLabels === true}
                  onChange={(v) => set("showLabels", v)}
                />
              )}

              {offers.has("donut") && (
                <ToggleRow label="Cut out the middle" checked={config.donut === true} onChange={(v) => set("donut", v)} />
              )}

              {offers.has("legend") && (
                <Row label="Legend">
                  <NativeSelect
                    value={config.legend ?? ""}
                    aria-label="Legend"
                    onChange={(e) => set("legend", (e.target.value || undefined) as TileConfig["legend"] | undefined)}
                  >
                    <option value="">Follow the tile&rsquo;s width</option>
                    <option value="right">Beside it</option>
                    <option value="bottom">Underneath</option>
                    <option value="none">Hidden</option>
                  </NativeSelect>
                </Row>
              )}
                </>
              </Group>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
