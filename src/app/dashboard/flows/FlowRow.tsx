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
import { sourceStyle } from "@/components/flow/controls/source-style";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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

/**
 * STATE KEEPS THE TRIOS, AND THE ACCENT SET STAYS OFF IT.
 *
 * The list wants colour and it gets it on the connector chip — but not here.
 * The sheet's three accents are the DECORATIVE range ("which one is this"), and
 * success/warn/danger are the only vocabulary allowed to say how something is
 * GOING. A peri pill — or the brand, which left the decorative set when it
 * became the brand and would arrive here carrying even more weight — would be a
 * fourth status colour that means nothing, in the one cell of the row where a
 * colour is read as a verdict.
 *
 * `pending` is grey on purpose: nothing transient gets a colour of its own.
 */
const STATE_META: Record<FlowState, { label: string; tone: StatusPillProps["tone"]; dot?: boolean }> = {
  active: { label: "Active", tone: "success", dot: true },
  paused: { label: "Paused", tone: "warn" },
  draft: { label: "Draft", tone: "pending" },
};

/**
 * THE THREE RIGHT-HAND COLUMNS, MEASURED ONCE.
 *
 * The header labels and every row read these, which is the only thing keeping
 * the columns in line: each row lays itself out independently (there is no
 * shared grid across rows), so alignment here is a matter of the cells being
 * literally the same width everywhere they appear. Two spellings and the
 * column labels drift off the things they label — silently, and only at the
 * one status word that happens to be long.
 *
 * `w-30` (120px) on the actions cell is the CONFIRM state's width, not the
 * resting one: a `sm` Delete plus its cancel is ~114px where the icon pair is
 * 74px, and sizing the column to the smaller of the two would have the row's
 * right edge jump the moment you press Delete.
 */
const COL = {
  status: "w-24",
  toggle: "w-11",
  actions: "w-30",
} as const;

/**
 * THE FLOWS LIST — one panel of full-width rows, not a board of cards.
 *
 * It has been three things before this: a bare line of name + status + date, a
 * four-column grid table, and then a board of tiles in the dashboard's own
 * BOARD_GRID. The board was the right instinct badly aimed. A dashboard tile
 * earns its size because it carries a NUMBER you stop and read; a flow carries
 * a name, a source, a state and a switch, and blowing that up to 370×150 meant
 * three flows filled a screen that can comfortably hold a dozen. The thing
 * people come here to do is find one among many and open it, and a list is
 * what that shape is called.
 *
 * So: one card containing the whole list, hairlines between rows, and a header
 * strip naming the columns. That is Miro's "Boards in this team" and it is the
 * right reference — the same reason it works there works here.
 *
 * WHERE THE COLOUR AND THE MATERIALS ARE, since the chrome around this screen
 * is monochrome now and the content is where colour is allowed to live:
 *
 *   · THE CONNECTOR CHIP is the one thing that legitimately varies row to row,
 *     so it keeps its block of the vendor's own hue. A column of Close /
 *     Calendly / Sheets rows reads by colour before it reads by word, which is
 *     what makes a list scannable rather than merely compact.
 *   · THE HEADER STRIP IS THE OFF-WHITE, and it is the only off-white on the
 *     page — a recessed band inside a white card, the way Miro's templates rail
 *     is a tinted strip inside a white page rather than a wash over everything.
 *     Two materials in one object is what gives the list a head.
 *   · THE ROW ANSWERS THE POINTER IN VIOLET, wash and text together, because
 *     the whole row is one link and the marker's tint pair is exactly what the
 *     kit gives a thing that is selected without being a filled object.
 *     Hovering previews what clicking does, which is the same argument `Chip`
 *     makes for its own off-state hover.
 *
 * What was already right and is kept whole: the row as one stretched link, the
 * optimistic switch that reverts when the server disagrees, the filter chips
 * with live counts, and the search field that only appears once there is
 * enough to search.
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
            answered without clicking anything. `Chip` is already the sheet's
            pill — `rounded-full`, 12px, ALL CAPS, `tracking-wide` — and the
            selected one takes the brand as a FILL, which is the one shape the
            brand is allowed to take. */}
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
            className="h-8 w-56 text-sm"
          />
        )}
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-surface border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {query ? `No flows match “${q.trim()}”.` : `No ${filter === "all" ? "" : filter} flows.`}
        </p>
      ) : (
        // ONE CARD AROUND THE WHOLE LIST, not a card per flow. `overflow-hidden`
        // is what lets the header's fill and the first/last row's hover take the
        // panel's own 16px corner instead of squaring it off.
        <div className="mt-4 overflow-hidden rounded-surface border border-border bg-card shadow-card">
          {/* THE COLUMN LABELS, in the kit's micro voice — 12px, ALL CAPS,
              `tracking-wide`, the same setting `SectionHeading` and every chip
              in the product use. Caps is what makes a 12px string read as a
              LABEL rather than as a very small sentence sitting above the list.

              `bg-foreground/5` and not `bg-muted`, for the reason the flows
              board's old footer tray already gave: `--muted` and the page are
              both the same off-white, so a muted strip on a white card is the
              page colour leaking through the card, and in the dark theme muted
              and card are the SAME token — i.e. no strip at all. An alpha of
              the foreground computes to the sheet's off-white over white and
              stays one step recessed on a dark card, with no variant to keep
              in sync.

              Hidden below `sm`, where the row itself wraps and there are no
              columns left to label.

              The actions cell is deliberately unlabelled: two icon buttons
              whose names are already on them do not need a word over the top,
              and "ACTIONS" over an empty 120px is a label doing nothing. It
              still holds its width, because the label row and the rows have to
              agree about where the columns are. */}
          <div className="hidden items-center gap-3 border-b border-border bg-foreground/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
            <span className="min-w-0 flex-1">Flow</span>
            <span className={COL.status}>Status</span>
            <span className={cn(COL.toggle, "text-center")}>On</span>
            <span aria-hidden className={COL.actions} />
          </div>
          {/* Hairlines BETWEEN rows and none at the ends — a rule under the last
              row would draw a second edge a pixel inside the card's own. */}
          <div className="divide-y divide-border">
            {visible.map((f) => (
              <Row key={f.id} flow={f} />
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-muted-foreground">
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
  // The connector's own brand colour, from the same pure lookup `SourceMark`
  // reads. Taken here so the WASH behind the mark can be mixed from it — a
  // hex in this file would fail the kit gate, and rightly: the value belongs
  // to the vendor's map, not to a row.
  const brand = sourceStyle(flow.source).color;
  const edited = new Date(flow.updatedAt);

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
    // `group` is what lets the name answer a pointer anywhere on the row, and
    // `relative` is what lets the name's overlay claim the whole row without
    // swallowing the controls sitting above it.
    //
    // NO `.lift` HERE. That class translates its element on hover, which is
    // right for a tile you pick up out of a grid and wrong for a row in a
    // stack: eleven neighbours hold the row's edges, so the same 2px lift
    // reads as the list flinching. The row moves in COLOUR instead.
    //
    // THE EXACT TIMESTAMP LIVES ON THIS ELEMENT. It used to sit on the card's
    // footer, which was above the stretched link and could therefore own a
    // tooltip of its own; the meta line is now UNDER that overlay, so a
    // `title` on it could never fire. Titles resolve up the tree from whatever
    // is hovered, so putting it on the row means the overlay surfaces it — and
    // the switch, the two icon buttons and the connector chip all carry their
    // own, which win where they sit.
    <div
      className="group relative flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-accent"
      title={`Edited ${formatDate(edited)} ${formatTime(edited)}`}
    >
      {/* `basis-64` is the wrap point rather than a breakpoint: the name block
          keeps its own minimum and the right-hand cluster drops to a second
          line when the row genuinely cannot hold both, which is the behaviour
          a phone and a narrow split-screen window both want. */}
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
        {/* THE APP'S MARK ON A CHIP OF ITS OWN COLOUR — the wash is the mark's
            hue at 14%, mixed rather than hard-coded, so a connector added
            tomorrow brings its chip with it and nothing here needs editing.
            `color-mix` against `transparent` (not against white) so the tint
            composites onto whatever surface is behind it, including the violet
            hover and the dark theme's card. */}
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-card"
          style={{ backgroundColor: `color-mix(in srgb, ${brand} 14%, transparent)` }}
        >
          <SourceMark source={flow.source} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          {/* THE WHOLE ROW IS THE LINK. `after:inset-0` stretches this anchor
              over the row, so the soft target is everything from the chip to
              the status column while the focus ring stays on the words — the
              only part a keyboard user can see.

              16px semibold over a 14px line: one clear step, which is all a
              row has room for and all it needs. The card set the name at 18
              because a 370px tile had a whole line to itself; a row does not.

              THE VIOLET IS ON THIS ELEMENT rather than inherited, so the name
              and the row's fill ease together on the same duration. */}
          <Link
            href={`/dashboard/flows/${flow.id}`}
            className="block truncate rounded-control text-md font-semibold text-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) after:absolute after:inset-0 after:content-[''] group-hover:text-accent-foreground"
          >
            {flow.name}
          </Link>
          {/* THE SECOND LINE IS THE WHOLE OF WHAT THE FLOW IS: how big it is,
              what it reads, and when it was last touched — the three facts the
              card spent two separate zones saying. Same order of precedence
              the footer used for its trailing clause: a failed action first,
              then the fact that the dashboard is serving a different version of
              this flow, then the date.

              The summary SURVIVES all three now instead of being replaced by
              them. "6 steps · Close CRM" is the row's identity and blanking it
              to show an error meant the one line that says what the flow IS
              disappeared exactly when you needed to recognise it. */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate">{flow.summary}</span>
            <span aria-hidden className="shrink-0">
              ·
            </span>
            {error ? (
              <span className="truncate text-danger-ink">{error}</span>
            ) : flow.unpublished ? (
              // "Changes not live" and not "Edited since publishing": the same
              // words the builder's toolbar pill uses for the same fact, and
              // short enough to survive a narrow row without an ellipsis eating
              // the half that carries the meaning.
              <span className="inline-flex shrink-0 items-center gap-1 text-warn-ink">
                <PencilLine size={12} className="shrink-0" aria-hidden />
                Changes not live
              </span>
            ) : (
              <span className="shrink-0">{`Edited ${formatDate(edited)}`}</span>
            )}
          </div>
        </div>
      </div>

      {/* THE THREE COLUMNS, right-aligned and fixed-width so they line up with
          the header and with each other. `ml-auto` is for the wrapped case: on
          a second line the cluster stays against the row's right edge instead
          of sliding under the chip. */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/* NO z-INDEX ON THE STATUS CELL, deliberately: it is a word, not a
            control, so the ~96px it occupies stays part of the link's target.
            The two cells that follow have to sit above the overlay, because
            they are things you press. */}
        <span className={cn(COL.status, "flex")}>
          <StatusPill tone={meta.tone} dot={meta.dot}>
            {meta.label}
          </StatusPill>
        </span>
        {/* A never-published flow has nothing to switch on, so the control says
            so rather than failing on click. This is also the row's second
            reading of "draft" — the card drew that state as a dashed border,
            which a row has no edge of its own to carry; the labelled status
            column the card never had says it in a word instead. */}
        <span className={cn(COL.toggle, "relative z-10 flex justify-center")}>
          <Switch
            size="sm"
            checked={state === "active"}
            disabled={state === "draft" || pending}
            onClick={toggle}
            aria-label={toggleLabel}
            title={toggleLabel}
          />
        </span>
        {confirming ? (
          <span className={cn(COL.actions, "relative z-10 flex items-center justify-end gap-1")}>
            <Button variant="destructive" size="sm" onClick={del} disabled={pending}>
              {pending ? "…" : "Delete"}
            </Button>
            <Button variant="ghost" size="iconSm" onClick={() => setConfirming(false)} aria-label="Cancel">
              <X />
            </Button>
          </span>
        ) : (
          // `iconSm`, not `icon`, and the reason is the branch above it: the
          // confirm state is built from `sm` (36px) controls, so a 44px pair
          // here meant the row's height CHANGED the moment you pressed Delete —
          // the list resizing under the cursor at the one moment you are being
          // asked to aim.
          <span className={cn(COL.actions, "relative z-10 flex items-center justify-end gap-0.5")}>
            <Button variant="ghost" size="iconSm" onClick={duplicate} disabled={pending} title="Duplicate" aria-label="Duplicate">
              <Copy />
            </Button>
            <Button variant="destructiveGhost" size="iconSm" onClick={() => setConfirming(true)} disabled={pending} title="Delete" aria-label="Delete">
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
