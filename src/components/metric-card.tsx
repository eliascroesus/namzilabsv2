import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * THE METRIC CARD — one shell, every tile on the board.
 *
 * WHY THIS FILE EXISTS. The dashboard rendered its numbers through THREE
 * components that had drifted into three different cards, sitting in one grid:
 *
 *   `FlowTile`    variant="tile"     p-4   the micro-label voice   tray
 *   `MetricTile`  variant="surface"  p-4   the micro-label voice   "Drill in"
 *   `ChartFrame`  variant="tile"     p-4   the micro-label voice   footer line
 *
 * ALL THREE ARE 16px NOW. This tile ran `p-5` — twenty — against a kit whose
 * card padding is sixteen and a page whose gutter is twenty-four. One tile
 * padded four pixels wider than every other card on the same board is not a
 * hierarchy, it is the near-miss that makes a row of tiles look hand-placed.
 *
 * `MetricTile`'s own comment claimed it was "kept in step with FlowTile's shape
 * on purpose" — it disagreed on the shell, the padding, the title recipe and
 * the footer. A workspace with one legacy metric beside one flow metric showed
 * two different objects and no reason for the difference. The two of them come
 * through here now, so the shape is decided once.
 *
 * `ChartFrame` deliberately does NOT: its `padding="compact"` is measured
 * arithmetic on the canvas board (see tests/board-blocks.test.ts, where the
 * cartesian floor is computed against it at ROW_UNIT_PX 48), and a tile there
 * can be four grid rows tall. It shares this file's VOICE — the same micro
 * label, the same headline recipe — without sharing its geometry.
 *
 * ── THE SHAPE, AND THE TWO ARGUMENTS BEHIND IT ──────────────────────────────
 *
 * NO TRAY. The old card ended in a band with a hairline above it and a 3% wash
 * behind it — a whole surface deployed to say "this row is quieter", which type
 * and space already say. The card is one block of padding now, which is what
 * every other surface in the kit is.
 *
 * NO LEADING EDGE, AS OF THE 4 SEP 2026 BLUE RETHEME. The card used to wear
 * 4px of its group's colour on this edge, borrowed from the builder's step
 * card — the one device that let a tile floating loose in a coloured COLUMN
 * refer back to the tint it sat on. The Figma's default board draws no such
 * edge on any tile, so the strip went. The `--tile-edge` property that fed it
 * and the one-child flex wrapper that held it followed on 6 Sep 2026: the
 * lane in `board-column.tsx` had gone on publishing the property for two
 * days with no reader anywhere in the app, canvas board included.
 *
 * ── TWO ROWS, AND NO FOOTLINE AT ALL, AS OF THE 6 SEP 2026 FIGMA ────────────
 *
 * The card had THREE rows: a name, a figure, and a footline carrying the
 * timestamp beside Refresh and Open. The `node-id=14:4` frame draws two, and
 * the arithmetic is exact rather than approximate — 16px of padding, a 22px
 * name, 16px of air, a 36px numeral, 16px of padding, inside a 1px border:
 *
 *     1 + 16 + 22 + 16 + 36 + 16 + 1  =  108px
 *
 * which is the height the export measures (108.22). Every one of those six
 * numbers was different here, and the sum was 92 — a card that read as the
 * right idea at the wrong size.
 *
 * WHERE THE TWO ACTS WENT. The footline's timestamp moves UP, onto the name's
 * own line beside the freshness dot, which is where the export puts it and
 * which is what buys the third row back. Refresh and Open moved to the tile's
 * hover MENU (`board-tile-menu.tsx`) rather than being deleted: the export
 * draws no footline, but "the only way into this flow" is not a decoration to
 * drop on a drawing's say-so. The menu is where this board already keeps its
 * per-tile acts, so they cost the card no height and stay one gesture away.
 *
 * SO THERE IS NO `actions` PROP ANY MORE. A prop whose only renderer has been
 * deleted still reads as a feature to whoever finds it next — the same reason
 * the metrics-setup ring's count chain went out of `TopBar` in one commit
 * instead of being left exported.
 *
 * The body stays `flex-1 justify-center`: a bare scalar centres its figure
 * instead of hanging it off the top of a stretched card, which is the dead
 * space the old card had. On a tile taller than 108px (the canvas board lets
 * one span four rows) that is what keeps the figure looking placed.
 */
export function MetricCard({
  title,
  /** Chips that qualify the name — a chart label, an overridden period. */
  titleSuffix,
  /** The freshness marker: a 4px dot when fine, a chip when not. */
  marker,
  /**
   * Pre-formatted. `null` prints the em-dash — "no answer for this period" and
   * "the answer is zero" are different facts and the card must not conflate
   * them. `undefined` prints no headline row at all, for a tile whose mark IS
   * the answer (a funnel has no single figure to head).
   */
  headline,
  delta,
  /** The mark: sparkbars, a goal bar, a breakdown, a funnel. */
  children,
  /** Beside the number, never instead of it — errors, imports, undated rows. */
  qualifications,
  /**
   * A relative timestamp, or nothing where there is none. It sits on the
   * NAME's line beside `marker` — see the file note. It used to head a
   * footline, and moving it is what lets the card be two rows.
   */
  provenance,
  className,
  ...rest
}: {
  title: ReactNode;
  titleSuffix?: ReactNode;
  marker?: ReactNode;
  headline?: string | null;
  delta?: ReactNode;
  children?: ReactNode;
  qualifications?: ReactNode;
  provenance?: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"div">, "title" | "children">) {
  return (
    <Card variant="tile" padding="none" className={cn("lift flex flex-col overflow-hidden", className)} {...rest}>
      {/* ── THE NAME'S ROW ───────────────────────────────────────────────
          `pt-4 px-4` AND NO BOTTOM PADDING, which is the export's own split:
          the header opens the 16px box and the body below closes it, so the
          air between the name and the figure is the BODY's `p-4` rather than
          a gap either row owns. Spelling it as `p-4` here and `pt-0` there
          would measure the same and read as two decisions instead of one. */}
      <div className="flex min-w-0 items-start justify-between gap-3 px-4 pt-4">
        {/* A CARD TITLE, NOT A MICRO-LABEL — AND MUTED AGAIN AS OF THE
            4 SEP 2026 BLUE RETHEME. This was 13px ALL-CAPS semibold
            muted, on the argument that a metric's name LABELS the figure
            under it and that caps-and-muted is what keeps the NUMBER the
            loud thing. The size half of that overcorrected: every tile
            read as a caption with a graph under it, two steps below the
            body text everywhere else in the product, so the name moved
            up to body size (`text-sm`, 15px) against a 28px numeral —
            still a two-step gap, the number is in no danger.
            THE INK HALF CAME BACK MUTED. The body-size name briefly
            carried `font-medium text-foreground`, on the argument that a
            name the customer wrote earned full ink; the Figma draws it
            `text-muted-foreground` at body weight instead, so the
            numeral stays the one full-ink object the card has. The
            micro-label voice is still the wrong one here — it is for a
            STATUS or a column head, strings you scan, not a name someone
            wrote — the size argument above still holds at 15px muted. */}
        {/* `flex-1` IS WHAT MAKES `truncate` WORK. The h3 had `min-w-0`
            and its span had `truncate`, and a long name still wrapped to
            two lines — because without a flex basis the h3 sizes to its
            CONTENT inside a `justify-between` row, so there is no width
            for the ellipsis to trigger against. "Speed To Lead (Armaan)"
            was the case that showed it. */}
        <h3 className="flex min-w-0 flex-1 items-baseline text-sm font-normal text-muted-foreground">
          <span className="truncate">{title}</span>
          {titleSuffix}
        </h3>
        {/* THE FRESHNESS AND THE TIME, ON ONE LINE, IN THAT ORDER — the pair
            the export draws in this corner, 6px apart. The time used to head
            a footline; see the file note for what moving it buys.

            `pr-6` IS THE KEBAB'S LANE, reserved rather than negotiated: the
            board floats a 28px tile menu at `right-2 top-2`, which lands
            inside this row's own 16px padding and straight on top of the
            timestamp. The two components cannot see each other — the menu
            belongs to the board's cell wrapper and this to the card — so the
            width is bought unconditionally. Same reservation, same reason, as
            the chart frame's header. */}
        <span className="flex shrink-0 items-center gap-1.5 pr-6 text-xs text-muted-foreground">
          {marker}
          {provenance}
        </span>
      </div>

      {/* ── THE FIGURE'S ROW ─────────────────────────────────────────────
          `justify-between`, NOT a baseline row with a gap. The export sets the
          numeral against the card's left edge and the delta against its RIGHT
          one, with the whole width between them; the chip trailing the number
          by 10px is a different object — it reads as a suffix on the figure
          rather than as the card's second column. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center p-4">
        {headline !== undefined && (
          <div className="flex items-center justify-between gap-3">
            {/* `text-heading`, SAID OUT LOUD. It used to inherit
                `--card-foreground` and looked right, because in the dark
                theme `--heading` and `--foreground` are the same white. In
                light they are not — #313131 against #000000 — and the spec
                asks for the heading step. `cn` still lets the em-dash case
                win: tailwind-merge drops `text-heading` when
                `text-muted-foreground` is appended for a null headline.

                `leading-9` IS 36px, AND IT IS THE CARD'S HEIGHT. The step's
                own line-height is 40 (`--text-display-md--line-height`) and
                the chart card takes it unchanged; this card's export measures
                36, which is the 4px that makes the sum come to 108. It was
                `leading-none` — 28px — which is neither. */}
            <p
              className={cn(
                "stat-numeral text-display-md leading-9 text-heading",
                headline == null && "text-muted-foreground",
              )}
            >
              {headline ?? "—"}
            </p>
            {delta}
          </div>
        )}

        {children}
        {qualifications}
      </div>
    </Card>
  );
}
