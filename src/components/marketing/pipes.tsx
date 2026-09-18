import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";
import { PauseOffscreen } from "@/components/marketing/pause-offscreen";

/**
 * THE CHUTES — two pipe mouths at the edges of the screen, pouring the
 * connector marks toward the dashboard.
 *
 * ── WHAT THE PREVIOUS VERSION GOT WRONG ────────────────────────────────────
 *
 * It put the marks INSIDE the tube, travelling along it. That is not what the
 * reference does and not what the owner's sketch shows, and once the real art
 * arrived it was obviously impossible: `pipe-front.png` is an opaque cylinder,
 * so anything "inside" was covered by it completely. What he saw was a stubby
 * green lozenge with nothing in it.
 *
 * ── WHAT THE ART ACTUALLY IS ───────────────────────────────────────────────
 *
 * `pipe-front.png` is a cylinder WITH AN OPEN MOUTH — the dark ellipse at the
 * top is the hole you look into. `pipe-back.png` is the same cylinder without
 * it: a plain body. That is the reference's pair exactly ("Bamboo Top" and
 * "Bamboo Bottom"), and the way it composes is that the marks pour OUT of the
 * mouth and travel through OPEN SKY. Nothing is ever inside the tube.
 *
 * So: a chute at each edge with its mouth turned inward, and the marks flying
 * from each mouth toward the board, where they disappear behind it. Which is
 * the sketch — the pipes outside, the icons in the gap, the board in the
 * middle.
 *
 * ── WHY THE ART IS ROTATED RATHER THAN RE-EXPORTED ─────────────────────────
 *
 * Both files are drawn as upright cylinders. Rotating in CSS means the
 * composition's direction can change without anybody opening a design tool,
 * and means one file serves both sides — the right-hand chute is the same
 * image turned the other way.
 */

/**
 * WHICH MARKS POUR FROM WHICH SIDE — every other one, so the two streams never
 * carry the same logo at the same moment and the field reads as one catalogue
 * split in half rather than one list played twice.
 */
function marksFor(side: "left" | "right") {
  const picked = CONNECTOR_CATALOG.filter((_, i) => i % 2 === (side === "left" ? 0 : 1));
  /* Doubled: the travel runs a full -50%, so the second copy has to sit exactly
     where the first began or the loop visibly jumps. */
  return [...picked, ...picked];
}

function Chute({ side }: { side: "left" | "right" }) {
  return (
    <>
      {/* ── the marks, BEHIND the chute ──────────────────────────────────
          Drawn first so the chute's lip overlaps the mark currently leaving
          it. That overlap is the only thing that makes them read as coming OUT
          of the mouth rather than as passing in front of a picture of a pipe. */}
      <span className="pipe-flow" data-side={side}>
        <span className="pipe-travel" data-side={side}>
          {marksFor(side).map((entry, i) => (
            <span
              key={`${entry.source}-${i}`}
              /* A few degrees, alternating, so they read as objects in flight
                 rather than a row of centred stickers. */
              style={{ transform: `rotate(${i % 2 ? 8 : -8}deg)` }}
              className="pipe-mark"
            >
              <SourceMark source={entry.source} size={44} className="stat-numeral" />
            </span>
          ))}
        </span>
      </span>

      {/* ── the chute itself ─────────────────────────────────────────────
          A fixed box holding the art, which is rotated inside it. The box is
          the FOOTPRINT after rotation; the art inside carries the unrotated
          dimensions. Doing it the other way round makes `contain` fit the
          image to the box before the turn, which squashes it. */}
      <span aria-hidden className="pipe-chute" data-side={side}>
        <span className="pipe-art" />
      </span>
    </>
  );
}

export function Pipes() {
  return (
    <PauseOffscreen>
      {/* FULL-BLEED, NOT THE CARD'S WIDTH. The chutes belong at the SCREEN's
          edges — on a 1440 laptop a `max-w-6xl` card leaves 144px either side,
          which is less than one chute, so anchoring to the card would have
          buried them under it. Anchored to the viewport they sit in the gap on
          a wide display and bleed off the edge on a narrow one, which is the
          right behaviour in both directions. The hero clips the overflow. */}
      <div aria-hidden className="pipe-field pointer-events-none">
        <Chute side="left" />
        <Chute side="right" />
      </div>
    </PauseOffscreen>
  );
}
