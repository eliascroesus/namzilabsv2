import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A TILE'S SHAPE WHILE ITS NUMBER IS ON ITS WAY.
 *
 * ═══ WHY THIS IS ONE COMPONENT AND WAS FOUR ═══
 *
 * The same placeholder was hand-rolled in four places — the first-load
 * skeleton, the range-switch skeleton, the grid/column skeleton, and the card
 * a newly-added tile shows before the server answers. Each spelled the card as
 * `rounded-surface border border-border bg-card p-4` rather than as the `Card`
 * the real tile is actually built from, and each carried its own stack of bars:
 * three in two of them, four in the third. Four copies of a box that has to
 * match a fifth thing exactly is a drift with a date on it.
 *
 * ═══ THE BUG: A FIXED STACK IN A CELL THAT IS NOT A FIXED HEIGHT ═══
 *
 * The bars were `h-4`, `h-9`, `h-10` with `mt-3` between them — 104px of
 * content, plus 32px of padding, so the card needed 136px to hold it. The
 * canvas puts tiles on a 24px row unit with a 16px gutter, so a three-row stat
 * tile is 104px tall. The placeholder overflowed it by 32px: bars hanging out
 * of the bottom of one card and across the top of the one below, which is
 * exactly what a board full of small tiles looked like on every range change.
 *
 * A minimum height would not have fixed it. `clampBox` floors a tile at ONE
 * row — 24px — so any fixed content is a bug waiting for a short enough tile.
 * The body FLEXES instead: a title bar, then one block that takes whatever is
 * left, which is correct at 24px and at 384px and needs to know neither.
 *
 * ═══ AND FEWER SHAPES ═══
 *
 * Two, not four. The old stack drew a title, a numeral, a mark and a footer —
 * an anatomy that is right for exactly one of the tile kinds on this board and
 * a lie about the rest. A chart tile has no numeral; a scorecard has no table.
 * Guessing wrong in detail reads as clutter in a state nobody is reading
 * anyway, and it made short cards overflow to draw a footer they would never
 * have. A title and a body says the true thing: something the size of this box
 * is coming.
 *
 * `overflow-hidden` is the backstop. Nothing in here can overflow now, and if
 * something is ever added that could, it will be clipped rather than painted
 * over the neighbouring card.
 */
export function TilePlaceholder({
  /**
   * A height, for the call sites whose card is NOT in a sized cell — the grid
   * and column skeletons stack auto-height cards, where `h-full` resolves to
   * nothing and the body would flex to zero. The canvas sites pass nothing and
   * take their cell's height, whatever it is.
   */
  className,
}: {
  className?: string;
}) {
  return (
    <Card
      variant="tile"
      padding="compact"
      aria-busy="true"
      /* The real tile is `<Card variant="tile" padding="compact"` with
         `flex h-full flex-col` — see `custom-tile.tsx`. Same card, same
         variant, same padding, so the box cannot drift from the thing it is
         standing in for. */
      className={cn("flex h-full flex-col gap-3 overflow-hidden", className)}
    >
      <Skeleton className="h-4 w-2/5" />
      {/* `min-h-0` because a flex child's default `min-height: auto` refuses to
          shrink below its content — which in a 24px cell is how a "flexible"
          body overflows anyway. */}
      <Skeleton className="min-h-0 flex-1" />
    </Card>
  );
}
