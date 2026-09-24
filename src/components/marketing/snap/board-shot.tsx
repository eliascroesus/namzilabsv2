import Image from "next/image";
import { Mark } from "./marks";
import styles from "@/app/snap.module.css";

/**
 * THE FOLD'S OBJECT — the real board, with the tools plugged into its side.
 *
 * ═══ WHY A SCREENSHOT AND NOT A DRAWING ═══
 *
 * The three fanned cards this replaces argued the product rather than showing
 * it: a reader had to accept that three numbers disagreeing and one card in
 * front of them meant something, and the thing they were being sold — a board
 * they would look at every morning — appeared nowhere above the fold. A
 * drawing of a product is always a claim; the product is evidence. So the
 * first screen now carries the actual dashboard, and the argument the cards
 * were making moves to S03, where it is made in words and real figures.
 *
 * `public/dashboard.png` is a genuine capture, workspace name blurred. That
 * means it dates: when the board changes, re-shoot it. A stale screenshot is
 * the one failure mode a drawing did not have, and it is worth the trade
 * exactly once — for the fold.
 *
 * ═══ THE CONNECTION IS DRAWN, BECAUSE IT IS THE PRODUCT ═══
 *
 * A screenshot alone says "we have a dashboard", which is the least
 * interesting true thing about this product. Four source marks rest on the
 * board's left edge — almost all on the page, their green dots on the border,
 * so they cross it without covering the rail's menu — and a hairline runs
 * from each one across the board's own navigation rail to a single port.
 * Four separate tools entering one place, physically. That is the sentence
 * the headline makes, made again in objects, and it is why the marks sit ON
 * the edge rather than beside it: a chip floating near a picture is
 * decoration, a chip crossing its border is a connection.
 *
 * ═══ THE RIG IS FIXED, THE BOARD IS FLUID ═══
 *
 * The marks, the wires and the port are one 200 × 540 coordinate space — the
 * `rig` — pinned to the board's left edge and scaled by a single dial. The
 * board itself has no width of its own: it runs from the rig to the right
 * edge of the VIEWPORT, so it grows on a wide screen instead of leaving a
 * gutter, and its right corner is square because there is no corner to round
 * — it has left the screen. Nothing in the rig moves when the board grows,
 * which is what keeps the wires landing on the navigation rail at every width
 * rather than drifting into the charts.
 */

/** The rig's coordinate space. Everything below is in it. */
const CHIP = 56;
/**
 * 158 rather than the rail's exact edge. The board starts at 50 in rig units
 * (`.boardFrame`'s inset — the two move together) and its navigation rail is
 * ~131 CSS px wide at every tier (its width follows the board's HEIGHT, which
 * the rig's dial tracks), so 158 lands the port inside the dark rather than
 * straddling the boundary — where the port's own ring painted half onto white
 * and read as a chipped dot.
 */
const PORT_X = 158;
const PORT_Y = 270;

/**
 * FOUR, AND THESE FOUR. A calendar, a CRM, a payment processor and the
 * spreadsheet somebody is still keeping by hand — the four corners of the
 * stack this product joins, and the four named in S03's disagreement. A fifth
 * adds a logo and no argument.
 */
const PORTS = [
  { source: "calendly", name: "Calendly", y: 74 },
  { source: "close", name: "Close CRM", y: 186 },
  { source: "stripe", name: "Stripe", y: 298 },
  { source: "gsheets", name: "Google Sheets", y: 410 },
];

/**
 * Chip's right edge to the port, bowing through the gap. The control points
 * sit halfway so all four curves share one bend and read as a loom rather
 * than as four unrelated arcs.
 */
function wire(y: number) {
  const y0 = y + CHIP / 2;
  const bend = (PORT_X - CHIP) / 2;
  return `M${CHIP} ${y0} C ${CHIP + bend} ${y0}, ${PORT_X - bend} ${PORT_Y}, ${PORT_X} ${PORT_Y}`;
}

export function BoardShot() {
  return (
    <div
      className={styles.shotStage}
      role="img"
      aria-label="The Namzilabs board — leads, booked leads, calls showed, customers, revenue and average order value for the last 90 days — with Calendly, Close CRM, Stripe and Google Sheets connected to it."
    >
      <div className={styles.boardFrame}>
        {/*
          `fill` with `object-fit: cover` and the crop pinned LEFT: the board's
          navigation rail is the one part of the picture the wires have to
          land on, so it is the one part that may never be cropped away. The
          right-hand side is what the viewport eats, and it is charts — the
          part a reader recognises without reading.

          `priority` because this is the largest element on the first screen.
          The headline is still the LCP element, and this is the thing that
          would otherwise pop in behind it half a second later.
        */}
        <Image
          className={styles.boardImg}
          src="/dashboard.png"
          alt=""
          fill
          sizes="(max-width: 1023px) 100vw, 60vw"
          priority
        />
      </div>

      <div className={styles.boardRig}>
        {/* Under the marks and over the board: the wires cross the board's own
            rail, which is the darkest, quietest part of the picture and the
            only place a hairline stays legible. */}
        <svg
          className={styles.boardWires}
          width="200"
          height="540"
          viewBox="0 0 200 540"
          aria-hidden
          focusable="false"
        >
          {PORTS.map((p, i) => (
            <path
              key={p.source}
              className={styles.boardWire}
              d={wire(p.y)}
              style={{ "--d": `${1240 + i * 90}ms` } as React.CSSProperties}
            />
          ))}
          {/* One port, arriving after the last wire reaches it. */}
          <circle className={styles.boardPortRing} cx={PORT_X} cy={PORT_Y} r={11} />
          <circle className={styles.boardPort} cx={PORT_X} cy={PORT_Y} r={4.5} />
        </svg>

        {PORTS.map((p, i) => (
          <span
            className={styles.boardChip}
            key={p.source}
            style={{ top: p.y, "--d": `${1040 + i * 90}ms` } as React.CSSProperties}
          >
            <Mark source={p.source} size={28} />
            {/* Green, small, and never the only carrier of the meaning — the
                stage's own label says these four are connected in words. */}
            <span className={styles.boardChipDot} aria-hidden />
          </span>
        ))}
      </div>
    </div>
  );
}
