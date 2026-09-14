"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FieldHint, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { PANEL_SHELL, PanelTabs } from "@/components/flow/panel-chrome";
import { GROUP_ACCENT, groupAccent } from "@/components/flow/node-accent";
import { CHARTS, asChartId, blockKindOf, blockTileKey, type BlockId, type ChartId } from "@/lib/board/charts";
import { EXITS_MAX, PARTS_SLOT, fieldsFor, type TileConfig } from "@/lib/board/tile-config";
import { RANGE_OPTIONS, MATERIALIZED_RANGES } from "@/lib/metrics/range";
import { MetricList, SEARCH_AT } from "./add-tile-picker";
import { partsOnOffer } from "@/lib/board/picker";
import { cn } from "@/lib/utils";
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
        <p className="-mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
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

/**
 * THE STAGES OF A COMPOSED FUNNEL, OR THE PARTS OF A COMPOSED PIE.
 *
 * ONE `tile_key`, TWO MEANINGS — AND THE LABEL IS THE WHOLE SAFETY DEVICE. The
 * tile's own metric is the ANCHOR of the composition, and what that means
 * depends entirely on the chart: stage 1 of a funnel, the WHOLE of a pie.
 * Switching chart changes the `chart` column and nothing else — `honoured()`
 * keeps `parts` because the pie's row lists it too — so the same four metrics
 * silently stop being "a funnel from Total Leads down" and become "shares of
 * Total Leads". Nothing in the stored bag records which was meant. Printing
 * "Stage 1 · Total Leads" or "Whole · Total Leads" in the first chip is what
 * makes that reinterpretation visible at the moment it happens, rather than a
 * drawing that is still confident and now means something else.
 *
 * THE CAP IS SHOWN, NEVER WALKED INTO. The heading counts what this chart can
 * hold — `PARTS_SLOT`, the same row `compose.ts` refuses against — and Add goes
 * flat at the ceiling. An author who has to discover a limit by being refused
 * has already built the thing the limit forbids.
 *
 * NOTE THE ARITHMETIC, which differs per chart because the anchor is counted in
 * one and not the other. A funnel's 7 parts are 8 STAGES (the anchor is stage
 * 1), so its heading reads "Stages (4 of 8)"; a pie's 5 parts are 5 PARTS (the
 * anchor is the whole, and a whole is not a slice — see `composePie`), so its
 * heading reads "Parts (3 of 5)".
 *
 * THE CHART CAN LEAVE THE COUNT OVER THE CAP, and the heading says so rather
 * than hiding it: a 7-part funnel switched to a pie reads "Parts (7 of 5)" with
 * Add disabled and seven remove buttons in reach, which is what the tile's own
 * refusal ("A pie shows at most 5 parts — remove some in the tile's settings")
 * sends the author here to do.
 */
/**
 * A LIST OF METRIC KEYS THE AUTHOR IS EDITING, held locally until the server
 * agrees. Shared by the stages picker and the exits picker, which write to
 * different config fields down the identical path — the full reasoning for why
 * a draft is needed at all is at the call site in `PartsGroup`, and duplicating
 * that mechanism per field is how the two would drift.
 */
function useComposedDraft(stored: string[], onChange: (next: string[]) => void): [string[], (next: string[]) => void] {
  const signature = stored.join("\n");
  const [seen, setSeen] = useState(signature);
  const [draft, setDraft] = useState(stored);
  if (seen !== signature) {
    setSeen(signature);
    setDraft(stored);
  }
  return [
    draft,
    (next: string[]) => {
      setDraft(next);
      onChange(next);
    },
  ];
}

/**
 * OUTCOMES BESIDE THE FUNNEL — the strip under the mark, not bands in it.
 *
 * Deliberately NOT a third mode of `PartsGroup`. That component is built around
 * a single distinction (stages versus parts) which it spends in eight places —
 * the anchor chip, the "Stage N ·" prefix, the cap arithmetic, the hint, the
 * noun — and every one of those is wrong for an exit. An exit has no anchor to
 * head a list, no position in a sequence to name, and no floor to be short of.
 * The draft mechanism is the only part genuinely shared, and it is shared.
 *
 * NO REORDER BUTTONS, which is a real difference rather than an omission. The
 * chips for a funnel's stages carry them because the ORDER IS THE CHART: move
 * stage 3 above stage 2 and the mark, the ratios and the bottleneck all change.
 * The strip's order is reading order for a handful of independent figures, so
 * two buttons per row would buy a preference at the cost of the widest control
 * in a narrow panel.
 */
function ExitsGroup({
  chart,
  stored,
  options,
  busy,
  onExits,
}: {
  chart: ChartId;
  stored: string[];
  options: CustomTileOption[];
  busy: boolean;
  onExits: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [exits, write] = useComposedDraft(stored, onExits);
  const full = exits.length >= EXITS_MAX;
  const CHIP = "flex items-center gap-1 rounded-control border border-border bg-control px-2 py-1";

  return (
    <Group label={`Outcomes (${exits.length} of ${EXITS_MAX})`}>
      <div>
        {exits.length > 0 && (
          <div className="flex flex-col gap-1">
            {exits.map((key, i) => {
              /* A metric that is gone still gets a chip — same reasoning as a
                 part's: dropping the row would leave a key in the bag with
                 nothing on screen able to remove it. */
              const name = options.find((o) => o.key === key)?.title;
              return (
                <div key={key} className={CHIP}>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${name ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {name ?? "This metric isn’t published any more"}
                  </span>
                  <Button
                    variant="ghost"
                    size="iconXs"
                    disabled={busy}
                    onClick={() => write(exits.filter((_, j) => j !== i))}
                    aria-label={`Remove ${name ?? `outcome ${i + 1}`}`}
                    title="Remove"
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {adding && (
          <div className="mt-1 rounded-control border border-border p-1">
            <MetricList
              options={options}
              chart={chart}
              /* Eligible for the chart it is joining, exactly as a stage is —
                 the strip prints a tally, so a rate or a duration is as wrong
                 here as it is in the body. */
              slot={chart}
              exclude={exits}
              busy={busy}
              onPick={(key) => {
                write([...exits, key]);
                setAdding(false);
              }}
            />
          </div>
        )}

        <Button
          variant={adding ? "ghost" : "secondary"}
          size="sm"
          disabled={busy || (!adding && full)}
          onClick={() => setAdding((v) => !v)}
          className="mt-1 w-full justify-start"
        >
          {adding ? <X /> : <Plus />}
          <span>{adding ? "Cancel" : "Add outcome"}</span>
        </Button>

        <FieldHint>
          Counts that left the funnel sideways — “Unqualified”, “No show”. They’re printed under the chart, never
          as a stage in it.
        </FieldHint>
      </div>
    </Group>
  );
}

/**
 * THE METRICS A COMPOSED CHART IS MADE OF — one numbered list, not a picker
 * plus a second section of chips.
 *
 * It was two controls: METRIC, which repointed the tile, and STAGES, which
 * listed everything after it. They are one question asked twice — the owner's
 * reading, and he is right: "have it be a multiple choice thing and then have
 * it be numeric like 1, 2, 3 so we don't have the stages part". Stage 1 was
 * always the tile's own metric, so the two lists were already one ordered
 * sequence with a seam drawn through it.
 *
 * THE FIRST ROW IS STILL THE TILE, and that is why this cannot be a plain
 * checklist. Unticking it does not remove a stage, it REPOINTS the tile — a
 * different write. `editTile` takes `tileKey` and `config` in one patch, so the
 * promotion is atomic: one call, not a repoint racing a parts write.
 *
 * ORDER STAYS EDITABLE, which a plain multi-select cannot do. A funnel's order
 * IS its meaning — leads, then booked, then showed — and "untick everything and
 * retick in the right sequence" is not a reorder. Selected rows sort to the top
 * in their own order and keep the arrows they had as chips.
 *
 * UNITS ARE ONLY POLICED ONCE SOMETHING IS COMPOSED. With a single metric
 * selected there is no shared axis to protect, so any metric may become the
 * anchor — otherwise a percentage chart could never be pointed back at a count
 * and the author would be trapped in the units they started with.
 */
function MetricOrderList({
  chart,
  order,
  options,
  busy,
  onOrder,
}: {
  chart: ChartId;
  /** `[anchor, ...parts]` — the tile's own metric first. */
  order: string[];
  options: CustomTileOption[];
  busy: boolean;
  onOrder: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const slot = PARTS_SLOT[chart];
  /** Anchor included, which is what the author is counting on screen. */
  const max = slot.max + 1;
  const [picked, write] = useComposedDraft(order, onOrder);

  const byKey = new Map(options.map((o) => [o.key, o]));
  /**
   * ONLY ONCE THERE IS SOMETHING TO SHARE AN AXIS WITH — see the note above.
   * `partsOnOffer` applies the chart's own legality rule either way.
   */
  const units = picked.length > 1 ? byKey.get(picked[0])?.units : undefined;
  const offerable = partsOnOffer(options, { need: chart, exclude: picked, units });
  const shown = query.trim()
    ? offerable.filter((o) => o.title.toLowerCase().includes(query.trim().toLowerCase()))
    : offerable;

  const move = (i: number, by: -1 | 1) => {
    const next = picked.slice();
    const [lifted] = next.splice(i, 1);
    next.splice(i + by, 0, lifted);
    write(next);
  };

  const full = picked.length >= max;
  const missing = slot.min + 1 - picked.length;
  const ROW = "flex items-center gap-1 rounded-control border border-border bg-control px-2 py-1";

  return (
    <Group label={`Metrics (${picked.length} of ${max})`}>
      <div className="flex flex-col gap-1">
        {picked.map((key, i) => {
          /**
           * A METRIC THAT IS GONE STILL GETS ITS ROW. It may be unpublished,
           * deleted, or restricted to a rank this viewer is not — `options`
           * holds none of those — and dropping it would leave a key in the bag
           * with nothing on screen to remove it.
           */
          const name = byKey.get(key)?.title;
          return (
            <div key={key} className={ROW}>
              {/* THE NUMBER IS THE POINT. It is the order the chart reads in,
                  stated plainly, where a chip used to spell "Stage 2 ·". */}
              <span className="tnum w-5 shrink-0 text-center text-sm text-muted-foreground">{i + 1}</span>
              <span
                className={cn("min-w-0 flex-1 truncate py-0.5 text-sm", name ? "text-foreground" : "text-muted-foreground")}
                title={name ?? key}
              >
                {name ?? "This metric isn’t published any more"}
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Move ${name ?? "metric"} up`}
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Move ${name ?? "metric"} down`}
                disabled={busy || i === picked.length - 1}
                onClick={() => move(i, 1)}
              >
                <ChevronDown />
              </Button>
              {/* THE LAST ONE CANNOT GO. A tile points at a metric; removing
                  the only one would leave it pointing at nothing, which is a
                  state the board has no way to draw. */}
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Remove ${name ?? "metric"}`}
                disabled={busy || picked.length === 1}
                onClick={() => write(picked.filter((k) => k !== key))}
              >
                <X />
              </Button>
            </div>
          );
        })}
      </div>

      {missing > 0 && (
        <FieldHint>{`Add ${missing === 1 ? "one" : missing} more before this can be drawn.`}</FieldHint>
      )}

      {!full && (
        <div className="mt-1 rounded-control border border-border p-1">
          {offerable.length > SEARCH_AT && (
            <div className="mb-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search metrics"
                aria-label="Search metrics"
                className="h-8 w-full"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto quiet-scroll">
            {shown.length === 0 ? (
              <p className="px-1 py-4 text-center text-sm text-muted-foreground">
                {offerable.length === 0 && picked.length > 1
                  ? "The rest of your metrics are measured differently, so they can’t share this chart’s axis."
                  : query.trim()
                    ? "No metric matches that."
                    : "Every metric here is already in this chart."}
              </p>
            ) : (
              shown.map((o) => (
                <Button
                  key={o.key}
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => write([...picked, o.key])}
                  className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
                >
                  <Plus className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{o.title}</span>
                </Button>
              ))
            )}
          </div>
        </div>
      )}

      {/* THREE CHARTS, THREE SENTENCES. The old two-branch version said "the
          circle is every slice added together" under RANKED BARS, which draw no
          circle and add nothing up — it predated that chart and nobody had
          looked at the panel since. What each one owes the author is different:
          a pipeline counts its stages separately, a pie's whole IS the sum, and
          ranked bars only share a scale. */}
      <FieldHint>
        {chart === "pipeline"
          ? "Number 1 is this tile’s own metric. Each one is counted on its own over the period."
          : chart === "ranked"
            ? "Number 1 is this tile’s own metric. Each bar is drawn to its own length against one shared scale."
            : "Number 1 is this tile’s own metric. The circle is every slice added together, so anything you leave out isn’t shown."}
      </FieldHint>
    </Group>
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
  onOrder,
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
   * WHICH TAB OPENS. Data, because every question a half-built tile has lives
   * there — which metric, over what period, built from which stages.
   *
   * THE REASON THIS COMMENT USED TO GIVE IS NO LONGER TRUE, and it was load
   * bearing, so it is corrected rather than trimmed. It said adding a chart
   * binds it to the first metric that can be drawn that way, making "is this
   * the right metric?" the one question a new tile always has. Adding a chart
   * now lands `UNSET_TILE_KEY` (custom-board.tsx:982), which draws `EmptyTile`
   * and opens the metric PICKER MODAL on click — so the anchor is chosen
   * before this panel is ever seen, and this panel's metric list only ever
   * serves a REPOINT of a tile that already has one.
   *
   * That distinction decides how much room the list deserves: a repoint is
   * rare, and a control used rarely should not be the tallest thing on the tab.
   */
  initialTab?: Tab;
  onClose: () => void;
  onChart: (chart: ChartId) => void;
  onMetric: (tileKey: string) => void;
  /**
   * THE WHOLE ORDERED SEQUENCE OF A COMPOSED CHART — `[anchor, ...parts]`.
   *
   * One callback rather than `onMetric` and a parts write, because promoting a
   * new first metric is BOTH: the tile repoints and the remainder becomes the
   * parts. `editTile` takes `tileKey` and `config` in one patch, so the board
   * can do it atomically — two calls would be a repoint racing a config write,
   * against a parts edit that deliberately does not go through the optimistic
   * overlay.
   */
  onOrder: (order: string[]) => void;
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
  /**
   * A COMPOSED PIE HAS NO "Show at most", AND THAT IS A REFUSAL RATHER THAN
   * TIDYING UP.
   *
   * `limit` means "roll everything past the top N into one Other slice", and
   * the tile prints as much. A composed pie's Other is a different object with
   * the same name: `composePie` appends the arithmetic RESIDUAL, the whole
   * minus the named parts, so that the slices tile the whole by construction.
   * Nothing is ranked and nothing is rolled up, so a limit control there would
   * be a setting that lies about what it does — and one the renderer would
   * never read anyway, since the parts are the author's five, not a top five.
   *
   * KEYED ON THE CHART, NOT ON THE STORED BAG. `config` here is the raw parsed
   * row, not `honoured(chart, …)` — honouring happens at render — so a tile
   * that used to be a composed pie still carries `parts` after a switch to
   * `category`. Asking only "are there parts?" hid the limit control on an
   * ordinary top-N bar chart that was reading `limit` perfectly well, and left
   * no way to clear the array either, since `category` offers no parts editor.
   */
  const showLimit = offers.has("limit") && !(offers.has("parts") && (config.parts?.length ?? 0) > 0);

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

  /**
   * AND A PRESS OUTSIDE CLOSES IT, which Escape alone did not cover.
   *
   * The panel is a docked rail, not a modal — no scrim, so the board behind it
   * stays live and pressing a tile there is the obvious way to move on. It
   * stayed open instead, and you had to find the X or remember Escape, which is
   * how a settings panel ends up feeling stuck.
   *
   * `pointerdown`, NOT `click`. A click fires after the press completes, so a
   * press that begins outside and drags into the panel (or a tile drag started
   * on the board) closes on release — long after the intent was obvious. The
   * capture phase for the same reason a drag uses it: something inside may stop
   * propagation, and this has to see the press regardless.
   *
   * `[data-tile-panel]` is the panel's own marker; `[data-radix-popper-content-wrapper]`
   * is every menu, select and popover the panel OPENS. Those portal to
   * document.body, so a press on one is outside this subtree by DOM and very
   * much inside it by intent — without that half, picking a metric from the
   * panel's own dropdown closed the panel underneath it.
   */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest("[data-tile-panel], [data-radix-popper-content-wrapper]")) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
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
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {(CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label}
          </p>
          <p className="mt-0.5 truncate text-lg font-semibold text-foreground">{config.title || metricName}</p>
        </div>
        <Button variant="ghost" size="iconSm" onClick={onClose} aria-label="Close chart settings" title="Close">
          <X size={18} />
        </Button>
      </div>

      <PanelTabs tabs={tabs} active={tab} onSelect={setTab} />

      <div className="min-h-0 flex-1 overflow-y-auto quiet-scroll">
        <div className="flex flex-col gap-4 p-4">
          {tab === "data" ? (
            <>
              {/*
                ONE LIST FOR A COMPOSED CHART, TWO FOR EVERYTHING ELSE.

                A scorecard or a line has exactly one metric, so the question is
                "which one" and a single-select answers it. A funnel, a pipeline
                or a composed pie is an ORDERED SEQUENCE whose first member is
                the tile's own metric — that was always true, and splitting it
                across a picker and a list of chips drew a seam through one
                question. `MetricOrderList` closes the seam and numbers the
                rows; the repoint and the parts write leave together in one
                `editTile` patch, so promoting a new first metric is atomic.

                ONLY FOR A FLOW TILE, exactly as the parts editor was. A classic
                funnel metric is legal as `funnel`, so `offers.has("parts")`
                alone handed it a working picker whose keys stored fine and then
                did nothing: `page.tsx` attaches `source.parts` to the flow
                source only, and the composition block in `custom-tile.tsx` sits
                inside `source.kind === "flow"`.
              */}
              {offers.has("parts") && isFlow ? (
                <MetricOrderList
                  chart={chart}
                  order={[tileKey, ...(config.parts ?? [])]}
                  options={options}
                  busy={busy}
                  onOrder={onOrder}
                />
              ) : (
                <Group>
                  <Row
                    label="Metric"
                    hint={`Only metrics that can be drawn as a ${(
                      CHARTS.find((c) => c.id === chart) ?? CHARTS[0]
                    ).label.toLowerCase()} are listed.`}
                  >
                    {/* A bordered, scrolling box so the list reads as a LIST
                        rather than as loose rows floating in the panel — the
                        same containment the kit's Table gives a set of rows. */}
                    <div className="rounded-control border border-border p-1">
                      <MetricList options={options} chart={chart} busy={busy} selected={tileKey} onPick={onMetric} />
                    </div>
                  </Row>
                </Group>
              )}

              {/*
                THE OUTCOMES, UNDER THE STAGES THEY SIT BESIDE — and gated on
                `isFlow` for exactly the reason the stages picker above is. A
                classic funnel metric is legal as `funnel`, but `page.tsx`
                attaches `source.exits` to the flow source only, so on a classic
                tile this would be a control writing a key nothing can read.
              */}
              {offers.has("exits") && isFlow && (
                <ExitsGroup
                  chart={chart}
                  stored={config.exits ?? []}
                  options={options}
                  busy={busy}
                  /* An empty array is a CLEAR, never a write — the same rule the
                     stages picker follows, and here it is the ordinary case:
                     removing the last outcome is how an author turns the strip
                     off again. */
                  onExits={(next) => set("exits", next.length > 0 ? next : undefined)}
                />
              )}

              {offers.has("flow") && (
                <Group label="Layout">
                  <Row
                    label="Direction"
                    hint={
                      config.flow === "across"
                        ? "Names sit above each stage and the conversion sits in the gap between two."
                        : "Stages stack downward and the width is the count. Best when there are many."
                    }
                  >
                    <NativeSelect
                      value={config.flow ?? "down"}
                      aria-label="Direction"
                      onChange={(e) => set("flow", (e.target.value || undefined) as TileConfig["flow"])}
                    >
                      <option value="down">Top to bottom</option>
                      <option value="across">Left to right</option>
                    </NativeSelect>
                  </Row>
                </Group>
              )}

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

              {(offers.has("sort") || showLimit) && (
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
                    {/* "A – Z" and "Z – A" rather than one option reading "By
                        name": the old wording named the KEY and left the
                        DIRECTION to be discovered by trying it, and there was no
                        way to ask for the other one. */}
                    <option value="label_asc">A – Z</option>
                    <option value="label_desc">Z – A</option>
                  </NativeSelect>
                </Row>
              )}

              {showLimit && (
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
              <p className="text-sm text-muted-foreground">
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
                      <span className="truncate text-sm">{c.label}</span>
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
                     success/marker token, because a 6px measure carrying no ink
                     of its own is a stroke and the brand cannot draw one.
                     Saying so is the difference between a control that appears
                     broken and one whose scope is known. */
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
