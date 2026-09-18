import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";
import { PauseOffscreen } from "@/components/marketing/pause-offscreen";

/**
 * THE CHUTES — two angled pipes pouring the connector marks into the board.
 *
 * ── HOW THE REFERENCE ACTUALLY BUILDS THIS ─────────────────────────────────
 *
 * Reading wissly.framer.website's markup settles what two rounds of guessing
 * did not. It is ONE container with `transform: rotate(-43deg)` on it, holding:
 * a chute at one end, a second chute at the other, and a vertical ticker
 * running between them. Everything inside is axis-aligned; the container's
 * rotation is what makes the whole assembly diagonal.
 *
 * That is the trick worth stealing, and it is why the last two attempts looked
 * wrong. A rotated RIG means the icons need no per-icon geometry — they are a
 * plain row inside a box that happens to be turned. Rotating each piece
 * separately, which is what I was doing, gets the maths right and the drawing
 * wrong.
 *
 * ── THE THREE THINGS THAT MADE MINE LOOK LIKE A TIN CAN ────────────────────
 *
 *   1. SIZE. The reference draws its chute at 457px against a ~1400px page.
 *      Mine was 168px. A pipe that small is a lozenge.
 *   2. IT WAS PERFECTLY HORIZONTAL. The reference is at 43 degrees, which is
 *      what makes it read as a three-dimensional object rather than a sticker.
 *   3. THE WHOLE THING WAS ON SCREEN, back end included. The reference crops
 *      hard on the viewport edge so all you ever see is the mouth and a
 *      stretch of barrel — the pipe comes from somewhere, rather than being a
 *      finite object floating in the sky.
 *
 * ── AND THE MARKS COME OUT OF IT ───────────────────────────────────────────
 *
 * `pipe-front.png` is an opaque cylinder with an open mouth, so nothing can be
 * inside it. The marks emerge from BEHIND the mouth — the chute is painted
 * last, over the stream — and fly down the rig into the board, where the card
 * covers them. Pipes outside, icons in the gap, board in the middle: the
 * owner's sketch.
 */

/** Every other mark per side, so the two streams never carry the same logo. */
function marksFor(side: "left" | "right") {
  const picked = CONNECTOR_CATALOG.filter((_, i) => i % 2 === (side === "left" ? 0 : 1));
  /* Doubled: the travel runs a full -50%, so the second copy has to sit exactly
     where the first began or the loop visibly jumps. */
  return [...picked, ...picked];
}

function Rig({ side }: { side: "left" | "right" }) {
  /* The rig is turned, so a mark inside it is turned too. Cancelling most of
     that angle keeps the logos readable while leaving a few degrees of tilt —
     the reference skews its icons rather than levelling them, and a perfectly
     upright logo on a diagonal stream reads as pasted on. */
  const counter = side === "left" ? -18 : 18;

  return (
    <div className="chute-rig" data-side={side}>
      {/* The stream first: the chute is painted over it, so a mark emerges from
          behind the lip rather than appearing on top of it. */}
      <span className="chute-stream">
        <span className="chute-travel" data-side={side}>
          {marksFor(side).map((entry, i) => (
            <span
              key={`${entry.source}-${i}`}
              className="chute-mark"
              style={{ transform: `rotate(${counter + (i % 2 ? 7 : -7)}deg)` }}
            >
              <SourceMark source={entry.source} size={52} className="stat-numeral" />
            </span>
          ))}
        </span>
      </span>

      <span aria-hidden className="chute-mouth" />
    </div>
  );
}

export function Pipes() {
  return (
    <PauseOffscreen>
      <div aria-hidden className="chute-field pointer-events-none">
        <Rig side="left" />
        <Rig side="right" />
      </div>
    </PauseOffscreen>
  );
}
