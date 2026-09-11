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
import { PARTS_SLOT, fieldsFor, type TileConfig } from "@/lib/board/tile-config";
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
function PartsGroup({
  chart,
  stored,
  anchorKey,
  anchorName,
  options,
  busy,
  onParts,
}: {
  chart: ChartId;
  /** `config.parts` as the SERVER last agreed it — see the draft below. */
  stored: string[];
  /** The tile's own `tile_key`. Fixed: it is the tile, not a member it chose. */
  anchorKey: string;
  anchorName: string;
  options: CustomTileOption[];
  busy: boolean;
  /** The WHOLE array, every time. An empty one clears the key — see the panel. */
  onParts: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const slot = PARTS_SLOT[chart];
  /** Funnel and pipeline count stages, anchor included; a pie has a whole and its parts. */
  const stages = chart === "funnel" || chart === "pipeline";

  /**
   * THE CHIPS ARE DRAWN FROM A LOCAL DRAFT, AND THAT IS NOT A PREFERENCE.
   *
   * A parts edit is the one config write that does NOT go through the board's
   * optimistic overlay: each part's numbers are resolved on the server, so
   * `editTile` refreshes instead (see its own note — an overlaid reorder would
   * draw the old numbers under the new labels). The consequence lands here. The
   * `stored` prop is the server's answer and does not move until the refresh
   * returns, so without a draft this list would sit still for the length of a
   * round trip, and — far worse — a SECOND edit made in that window would be
   * computed from the stale array and silently undo the first: move a stage up,
   * remove another before the refresh lands, and the write that removes is
   * built from the pre-move order.
   *
   * So the draft is what makes two quick edits compose: it follows the prop
   * whenever the server's array actually CHANGES.
   *
   * A REFUSED WRITE IS THE HOLE IN THAT, and it is written down rather than
   * implied. `editTile`'s refresh branch passes a no-op revert, so a refusal
   * leaves the server's array exactly where it was — the signature never moves,
   * this draft is never resynced, and the chips go on showing an order the
   * server rejected while a toast explains why. The tile itself is correct
   * throughout; it is the chips that are ahead. Reopening the panel clears it.
   * Closing it properly means threading a revert down here, which is more
   * machinery than a refusal — a rank losing sight of a metric mid-edit — is
   * worth until somebody actually hits it.
   *
   * ADJUSTED DURING RENDER RATHER THAN IN AN EFFECT, which is React's own
   * prescription for "state that follows a prop": an effect would paint the
   * stale order for a frame first, and `stored` is a fresh array identity on
   * every render (the config bag is re-parsed server-side), so an identity dep
   * would loop and a value dep is exactly the signature compared here.
   */
  const signature = stored.join("\n");
  const [seen, setSeen] = useState(signature);
  const [parts, setParts] = useState(stored);
  if (seen !== signature) {
    setSeen(signature);
    setParts(stored);
  }

  const write = (next: string[]) => {
    setParts(next);
    onParts(next);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = parts.slice();
    const [lifted] = next.splice(i, 1);
    next.splice(i + by, 0, lifted);
    write(next);
  };

  const full = parts.length >= slot.max;
  const missing = slot.min - parts.length;
  const noun = stages ? "stage" : "part";
  /**
   * THE HINT SAYS ONE THING AT A TIME. Below the floor it says what the chart
   * is still waiting for, because that is the state where the tile is drawing a
   * refusal instead of a chart and the panel is where the fix lives. Once it can
   * be drawn, it explains the anchor — and for a pie that sentence is also why
   * there is no "Show at most" control above: the residual is arithmetic, not a
   * roll-up of the rows that did not fit.
   */
  /**
   * IS COMPOSITION WHAT DRAWS THIS TILE? The panel has to answer it exactly as
   * `custom-tile.tsx` does, or it prints a refusal the renderer is not making.
   *
   * A funnel or pipeline has no other way to exist on a flow tile — no stored
   * shape produces a `FunnelResult` — so composition always draws it. A PIE HAS
   * A SECOND DOOR: a tile carrying its own `groups` draws them directly, and
   * composition only takes over once the author has named parts. Without this,
   * every grouped pie on the board grew a red-herring "Add 2 more parts before
   * this can be drawn" over a chart that was drawing perfectly.
   */
  const composing = stages || parts.length > 0;
  const hint =
    composing && missing > 0
      ? `Add ${missing === 1 ? "one" : missing} more ${noun}${missing === 1 ? "" : "s"} before this can be drawn.`
      : stages
        ? "Stage 1 is this tile’s own metric. Each stage is counted on its own over the period."
        : "The whole is this tile’s own metric. Whatever the parts don’t account for is drawn as “Other”.";

  /** A chip is one row: what it is, what it is called, and what can be done to it. */
  const CHIP = "flex items-center gap-1 rounded-control border border-border bg-control px-2 py-1";
  /**
   * THE ROLE AND THE NAME ARE ONE TEXT RUN, not a caps eyebrow beside a label.
   * "Stage 2 · Booked Leads" is a single thing being said, and splitting it in
   * two would let the name truncate while its position stayed — the half a
   * narrow panel can least afford to lose is the name. Colour carries the
   * difference instead, which is what the rest of the panel does between a
   * label and its hint.
   */
  const ROLE = "text-muted-foreground";

  return (
    <Group
      label={`${stages ? "Stages" : "Parts"} (${stages ? parts.length + 1 : parts.length} of ${
        stages ? slot.max + 1 : slot.max
      })`}
    >
      <div>
        <div className="flex flex-col gap-1">
          <div className={CHIP}>
            <span className="min-w-0 flex-1 truncate py-0.5 text-sm text-foreground">
              <span className={ROLE}>{stages ? "Stage 1" : "Whole"} · </span>
              {anchorName}
            </span>
          </div>

          {parts.map((key, i) => {
            /**
             * A PART WHOSE METRIC IS GONE STILL GETS A CHIP. It may have been
             * unpublished, deleted, or restricted to a rank this viewer is not
             * — `options` holds none of those — and dropping the row would
             * leave a key in the bag with nothing on screen to remove it,
             * while the tile refuses to draw. So it says what it is and keeps
             * its buttons.
             */
            const name = options.find((o) => o.key === key)?.title;
            const what = name ?? (stages ? `stage ${i + 2}` : `part ${i + 1}`);
            return (
              <div key={key} className={CHIP}>
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${name ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {stages && <span className={ROLE}>Stage {i + 2} · </span>}
                  {name ?? "This metric isn’t published any more"}
                </span>
                <Button
                  variant="ghost"
                  size="iconXs"
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${what} up`}
                  title="Move up"
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="iconXs"
                  disabled={busy || i === parts.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${what} down`}
                  title="Move down"
                >
                  <ChevronDown />
                </Button>
                <Button
                  variant="ghost"
                  size="iconXs"
                  disabled={busy}
                  onClick={() => write(parts.filter((_, j) => j !== i))}
                  aria-label={`Remove ${what}`}
                  title="Remove"
                >
                  <X />
                </Button>
              </div>
            );
          })}
        </div>

        {/*
          THE PICKER OPENS INLINE, NOT IN A MODAL, and that is a fact about this
          panel rather than a preference. A press anywhere outside
          `[data-tile-panel]` or a Radix popper closes the whole panel — see the
          pointerdown handler — and `Modal` portals to the body under neither
          marker, so choosing a stage from a modal would dismiss the settings
          behind it mid-edit. Inline is also where the answer belongs: the list
          appears directly under the chips it is about to add to.
        */}
        {adding && (
          <div className="mt-1 rounded-control border border-border p-1">
            <MetricList
              options={options}
              chart={chart}
              /**
               * A STAGE MUST BE ELIGIBLE FOR THE CHART IT IS JOINING, which is
               * a narrower question than "does it give one number".
               *
               * `"number"` was the obvious answer and the wrong one: every
               * metric answers with a number, so the list offered durations and
               * rates as stages and `compose.ts` refused them one press later.
               * Asking for the composing chart routes the question through
               * `tileOptions`, which has already subtracted the composed charts
               * from any metric whose facts say it is not a tally — so the
               * stage picker and the metric picker agree by construction rather
               * than by two lists happening to be filtered the same way.
               */
              slot={chart}
              exclude={[anchorKey, ...parts]}
              busy={busy}
              onPick={(key) => {
                write([...parts, key]);
                setAdding(false);
              }}
            />
          </div>
        )}

        <Button
          variant={adding ? "ghost" : "secondary"}
          size="sm"
          /* Open is always closable; the cap only ever blocks OPENING it. */
          disabled={busy || (!adding && full)}
          onClick={() => setAdding((v) => !v)}
          className="mt-1 w-full justify-start"
        >
          {adding ? <X /> : <Plus />}
          <span>{adding ? "Cancel" : `Add ${noun}`}</span>
        </Button>

        <FieldHint>{hint}</FieldHint>
      </div>
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
                  {/* THE ANCHOR CANNOT BE A METRIC THAT IS ALREADY A STAGE.
                      The parts picker excludes the anchor; without the mirror
                      of that here, repointing this row onto a metric already in
                      `parts` puts the same metric in the composition twice —
                      and `compose.ts` catches it only incidentally, by
                      identical labels, answering "rename one so they can be
                      told apart" about a single metric that cannot be renamed
                      apart from itself. */}
                  <MetricList
                    options={options}
                    chart={chart}
                    busy={busy}
                    selected={tileKey}
                    exclude={offers.has("parts") ? (config.parts ?? []) : undefined}
                    onPick={onMetric}
                  />
                </div>
              </Row>
              </Group>

              {/*
                THE COMPOSITION, DIRECTLY UNDER THE METRIC IT IS BUILT ON,
                because the row above IS the anchor — the tile's own `tile_key`
                is stage 1 of a funnel and the whole of a pie. Repointing that
                row re-heads the composition, so the two questions belong
                together and in this order.

                Offered from the one table, like every other control here:
                `parts` appears on the funnel, pipeline and pie rows of
                `CONFIG_FIELDS`, and a chart that does not read it cannot show
                the editor.

                AND ONLY FOR A FLOW TILE, which the table cannot express —
                exactly as the Period control below is a fact about the DATA
                rather than about the chart. A classic funnel metric is legal as
                `funnel`, so `offers.has("parts")` alone handed it a working
                "Add stage" picker whose keys stored fine and then did nothing
                at all: `page.tsx` attaches `source.parts` to the flow source
                only, and the whole composition block in `custom-tile.tsx` sits
                inside `source.kind === "flow"`. A control that writes a value
                nothing can read is the precise thing `CONFIG_FIELDS` exists to
                prevent one level up.
              */}
              {offers.has("parts") && isFlow && (
                <PartsGroup
                  chart={chart}
                  stored={config.parts ?? []}
                  anchorKey={tileKey}
                  /* The METRIC's name, not the tile's — the chips name the
                     members of the composition, and a renamed tile does not
                     rename the metric a stage is counted from. */
                  anchorName={metricName}
                  options={options}
                  busy={busy}
                  onParts={(next) =>
                    /*
                     * AN EMPTY ARRAY IS A CLEAR, NEVER A WRITE. The schema's
                     * `parts` is `.min(1)`, so `[]` does not survive
                     * `parseTileConfig` — and `setCustomTileAction` refuses
                     * anything the parser shrinks, out loud and wholesale
                     * ("That setting won't work: parts"). Removing the LAST
                     * stage is exactly that case, and it is the one edit most
                     * likely to be made by somebody starting over.
                     */
                    set("parts", next.length > 0 ? next : undefined)
                  }
                />
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
                    <option value="label_asc">By name</option>
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
