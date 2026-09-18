import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";
import { PauseOffscreen } from "@/components/marketing/pause-offscreen";

/**
 * THE CHUTES — two angled pipes pouring the connector marks into the board.
 *
 * ── THE SANDWICH, WHICH IS THE WHOLE EFFECT ────────────────────────────────
 *
 * Three layers, and the middle one is the point:
 *
 *   chute-back    the tube, WITH its open mouth        (behind the marks)
 *   chute-stream  the connector marks, travelling
 *   chute-front   the tube's NEAR LIP only             (in front of the marks)
 *
 * A mark leaving the pipe passes IN FRONT of the far wall and BEHIND the near
 * lip, which is what makes it read as coming out of a hole rather than sliding
 * across a picture of one. With a single layer — which is what the last
 * version had — the art is either entirely over the marks (they never appear)
 * or entirely under them (they look stuck on).
 *
 * WHICH FILE PLAYS WHICH PART, and it is the opposite of what the names
 * suggest. `pipe-front.png` is the cylinder WITH the dark ellipse, so it is the
 * one you must see through — it goes at the BACK. `pipe-back.png` is the plain
 * body with no opening, which is exactly what a lip looks like, so it goes at
 * the FRONT, masked down to its lower edge. Named for how they were exported
 * rather than for the job they do.
 *
 * ── AND THE RIG ────────────────────────────────────────────────────────────
 *
 * One rotated container per chute, holding the art at one end and the stream
 * running along its own axis — the reference's construction. Everything inside
 * is axis-aligned; the container's rotation is what makes it diagonal.
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
      <span aria-hidden className="chute-back" />

      <span className="chute-stream">
        <span className="chute-travel" data-side={side}>
          {marksFor(side).map((entry, i) => (
            <span
              key={`${entry.source}-${i}`}
              className="chute-mark"
              style={{ transform: `rotate(${counter + (i % 2 ? 7 : -7)}deg)` }}
            >
              <SourceMark source={entry.source} size={56} className="stat-numeral" />
            </span>
          ))}
        </span>
      </span>

      <span aria-hidden className="chute-front" />
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

/**
 * THE CLOUDS — drifting over the sky, and over the chutes.
 *
 * WHY THEY SIT IN FRONT OF THE PIPES rather than only behind them. The
 * reference passes cloud in front of its chute, and that single overlap does
 * more for the illusion than the pipe art does: something crossing in front of
 * an object puts it in a SCENE — at a distance, with air between it and the
 * viewer — instead of on a backdrop. One cloud behind and two in front is
 * enough to say that.
 *
 * Their drift is slow enough to be noticed only if you stop and look at it,
 * which is the right amount for something the eye should not be tracking.
 */
const CLOUDS: Array<{ src: string; className: string; style: React.CSSProperties }> = [
  { src: "/cloud.png", className: "cloud cloud-far", style: { left: "-6%", top: "6%", width: "38rem" } },
  { src: "/cloud1.png", className: "cloud cloud-near", style: { left: "-10%", top: "34%", width: "30rem" } },
  { src: "/cloud.png", className: "cloud cloud-near", style: { right: "-8%", top: "26%", width: "34rem" } },
];

export function Clouds({ layer }: { layer: "behind" | "front" }) {
  const want = layer === "behind" ? "cloud-far" : "cloud-near";
  return (
    <div aria-hidden className={`cloud-field pointer-events-none ${layer}`}>
      {CLOUDS.filter((c) => c.className.includes(want)).map((c, i) => (
        <span key={i} className={c.className} style={{ ...c.style, backgroundImage: `url(${c.src})` }} />
      ))}
    </div>
  );
}
