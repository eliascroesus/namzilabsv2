import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";
import { PauseOffscreen } from "@/components/marketing/pause-offscreen";

/**
 * THE PIPES — connector marks falling down glass tubes into the dashboard.
 *
 * ── WHAT IT IS COPYING, AND WHAT IT DELIBERATELY IS NOT ────────────────────
 *
 * The reference the owner sent (wissly.framer.website) runs coloured app icons
 * down a bamboo chute laid diagonally across a photographic sky. The mechanism
 * is lovely and the meaning is nil: it is an education brand, bamboo is
 * pretty, and the icons are invented.
 *
 * Ours borrows the mechanism and gives it the product's own job. These are
 * VERTICAL — the owner's call, and the right one — they carry the REAL
 * connector marks out of `CONNECTOR_CATALOG`, and they run down BEHIND the
 * dashboard window rather than past it. Tools, through pipelines, into one
 * board. That is a sentence this page spends three sections making below the
 * fold, said here in a picture before a word is read.
 *
 * It is also the reason the composition holds together rather than being a
 * headline with an ornament next to it: the pipes have somewhere to GO.
 *
 * ── WHY THE FIELD IS SHAPED THE WAY IT IS ──────────────────────────────────
 *
 * Seven pipes, of four different lengths, at four different speeds, starting at
 * four different offsets. Every one of those is doing the same job: a row of
 * identical tubes running in step reads as one striped object sliding, which
 * is exactly the flat, mechanical look this was meant to avoid. Uneven lengths
 * also let the field describe a soft arc — shorter at the edges, longer toward
 * the middle — so the eye is funnelled into the dashboard instead of being
 * held at the margins.
 *
 * THE OUTER PIPES DROP AWAY ON SMALL SCREENS. Seven tubes behind a 390px phone
 * is a texture, not a diagram. THREE is the floor, not one: a single tube in
 * the middle of an empty sky reads as a stray object, and it takes at least
 * three before the eye sees "a set of pipes feeding a thing" rather than "a
 * cylinder".
 */
type Pipe = {
  /** Height in rem. Every pipe is cut long enough to reach behind the
   *  dashboard; the number only decides how far past it the tube runs, which
   *  nobody sees. */
  h: number;
  /**
   * How far down the field this tube's MOUTH starts, in rem — and this is the
   * one that does visible work.
   *
   * Height cannot carry the field's shape, because every pipe disappears
   * behind the same card: cutting one shorter changes only how much of it is
   * hidden. The TOP is what the eye actually reads, so the outer tubes hang
   * from the ceiling and the inner ones start progressively lower, which draws
   * a shallow funnel pointing straight into the middle of the board.
   */
  top: number;
  /** Seconds for one full cycle. Slower reads as heavier and further away. */
  s: number;
  /** Fraction of the cycle to start at, so no two pipes are ever in phase. */
  offset: number;
  hide?: string;
};

const PIPES: Pipe[] = [
  { h: 34, top: 0, s: 26, offset: 0.62, hide: "hidden lg:flex" },
  { h: 32, top: 2.5, s: 19, offset: 0.18, hide: "hidden md:flex" },
  { h: 30, top: 4.5, s: 23, offset: 0.81 },
  { h: 28, top: 6, s: 16, offset: 0.35 },
  { h: 30, top: 4.5, s: 21, offset: 0.07 },
  { h: 32, top: 2.5, s: 28, offset: 0.54, hide: "hidden md:flex" },
  { h: 34, top: 0, s: 18, offset: 0.29, hide: "hidden lg:flex" },
];

/**
 * Which marks travel in which tube.
 *
 * THE CATALOGUE IS DEALT ROUND THE PIPES rather than each pipe getting the
 * same list: the same seven logos falling in seven columns is a wallpaper
 * pattern, and the whole claim being made here is that there are a LOT of
 * these. Stepping by the pipe count deals them like cards, so adjacent tubes
 * never carry the same mark at the same height.
 */
function marksFor(index: number) {
  const out = CONNECTOR_CATALOG.filter((_, i) => i % PIPES.length === index % PIPES.length);
  /* Doubled, because `pipe-fall` runs a full -50% — the second copy has to be
     sitting exactly where the first began or the loop visibly jumps. */
  return [...out, ...out];
}

export function Pipes() {
  return (
    <PauseOffscreen>
      {/* `items-start` so the tubes hang from a common ceiling and differ at
          the FOOT. Centring them would make the arc read as a bulge instead of
          as a set of pipes of different depths reaching down toward the
          board. */}
      {/* THE FIELD SPANS THE BOARD, NOT THE MIDDLE THIRD. At `gap-7` the seven
          tubes covered about 600px under a 1152px card, which read as a clump
          of pipes standing near it rather than as a field feeding it. Widened
          until the outer tubes sit close to the card's own edges, so the whole
          width of the board is being fed. */}
      <div aria-hidden className="flex items-start justify-center gap-5 sm:gap-10 lg:gap-16">
        {PIPES.map((pipe, i) => (
          <div
            key={i}
            className={`pipe w-12 shrink-0 sm:w-14 lg:w-[4.25rem] ${pipe.hide ?? "flex"}`}
            style={{ height: `${pipe.h}rem`, marginTop: `${pipe.top}rem` }}
          >
            <div className="pipe-flow size-full">
              <div
                className="pipe-column items-center gap-6 py-6 sm:gap-8"
                style={{
                  ["--pipe-duration" as string]: `${pipe.s}s`,
                  /* A NEGATIVE DELAY starts the animation mid-cycle on the
                     first frame, rather than making the pipe wait its turn
                     before anything moves. Positive delays would leave the
                     field visibly filling up on load. */
                  animationDelay: `-${(pipe.offset * pipe.s).toFixed(1)}s`,
                }}
              >
                {marksFor(i).map((entry, k) => (
                  <span
                    key={`${entry.source}-${k}`}
                    /* A few degrees of tilt, alternating, so the marks look
                       like objects being carried rather than a column of
                       centred stickers. The reference skews its icons for the
                       same reason. */
                    style={{ transform: `rotate(${k % 2 ? 6 : -6}deg)` }}
                    className="shrink-0"
                  >
                    <SourceMark source={entry.source} size={34} className="stat-numeral" />
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </PauseOffscreen>
  );
}
