import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";
import { PauseOffscreen } from "@/components/marketing/pause-offscreen";

/**
 * THE PIPES — two troughs running in from the edges of the screen, carrying
 * the connector marks into the dashboard.
 *
 * ── WHY THIS IS THE SECOND VERSION ─────────────────────────────────────────
 *
 * The first was seven VERTICAL tubes standing above the board like organ
 * pipes, and the owner's layout sketch is unambiguous that this is not it: two
 * runs, horizontal, entering from the left and right edges at the board's own
 * mid-height, with the marks travelling along them into its sides.
 *
 * The sketch is also the better composition, and it is worth saying why rather
 * than just complying. Vertical tubes ABOVE the card make the board look like
 * something the pipes are pouring onto. Horizontal runs entering its SIDES make
 * the board the thing they connect to — which is the actual relationship: the
 * dashboard is not underneath the tools, it is what they join up into. It also
 * uses the empty width either side of a centred card, which the vertical
 * version left as dead sky.
 *
 * ── WHY THE TROUGH IS TWO LAYERS ───────────────────────────────────────────
 *
 * A mark has to travel INSIDE the tube, so it needs a far wall behind it and a
 * near lip in front of it. One image and the logos sit on top of a picture of a
 * pipe — stickers on a tube rather than objects inside one. The reference
 * builds it the same way and calls the halves "Bamboo Top" and "Bamboo Bottom".
 *
 * ── WHY THE ART IS OPTIONAL ────────────────────────────────────────────────
 *
 * `pipe-back.png` and `pipe-front.png` are referenced from CSS as background
 * layers over a drawn fallback. If they are absent the fallback is what shows
 * and it is built to stand on its own; if they are present they paint over it.
 * Neither state can break a build, so the art can land whenever it lands.
 */

/**
 * WHICH MARKS RIDE WHICH SIDE — every other one, so the two runs never carry
 * the same logo at the same moment and the field reads as one catalogue split
 * in half rather than as one list played twice.
 */
function marksFor(side: "left" | "right") {
  const start = side === "left" ? 0 : 1;
  const picked = CONNECTOR_CATALOG.filter((_, i) => i % 2 === start);
  /* Doubled, because the travel runs a full -50%: the second copy has to be
     sitting exactly where the first began or the loop visibly jumps. */
  return [...picked, ...picked];
}

function Run({ side }: { side: "left" | "right" }) {
  return (
    <div className="pipe-run absolute inset-y-0" data-side={side}>
      {/* ── the far wall ─────────────────────────────────────────────────
          Drawn first so everything else stacks on top of it. */}
      <span aria-hidden className="pipe-back absolute inset-0" />

      {/* ── what travels inside ──────────────────────────────────────────
          THE MASK IS ON THE TRAVEL, NOT ON THE TUBE. The trough itself runs to
          a hard edge — a pipe that fades out has no mouth — but a mark that
          pops into existence at that edge reads as a glitch, so the marks
          alone dissolve in over the first tenth of the run. */}
      <span className="pipe-window absolute inset-x-0 top-1/2 -translate-y-1/2">
        <span
          className="pipe-travel flex items-center gap-10 sm:gap-14"
          style={{
            /* Inward on both sides: the left run travels right, the right run
               travels left, and both arrive at the board. Two runs going the
               same way would read as a conveyor passing through rather than as
               two feeds converging. */
            animationDirection: side === "left" ? "normal" : "reverse",
            animationDuration: side === "left" ? "26s" : "31s",
          }}
        >
          {marksFor(side).map((entry, i) => (
            <span
              key={`${entry.source}-${i}`}
              /* A few degrees, alternating, so they read as objects being
                 carried rather than a row of centred stickers. */
              style={{ transform: `rotate(${i % 2 ? 7 : -7}deg)` }}
              className="shrink-0"
            >
              <SourceMark source={entry.source} size={38} className="stat-numeral" />
            </span>
          ))}
        </span>
      </span>

      {/* ── the near lip, over the marks ────────────────────────────────── */}
      <span aria-hidden className="pipe-front absolute inset-0" />
    </div>
  );
}

export function Pipes() {
  return (
    <PauseOffscreen>
      {/* THE RUNS BLEED PAST THE VIEWPORT on their outer ends and past the
          board's edge on their inner ones, so neither end is ever a visible
          stop: the tube comes from off-screen and disappears behind the card.
          The hero section clips the outer overflow. */}
      <div aria-hidden className="pipe-field pointer-events-none absolute inset-x-0 z-0">
        <Run side="left" />
        <Run side="right" />
      </div>
    </PauseOffscreen>
  );
}
