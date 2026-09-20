import styles from "@/app/snap.module.css";
import { Mark } from "./marks";

/**
 * ATMOSPHERE IN THE SIDE MARGINS, NOT CONTENT.
 *
 * At 1440 the headline block leaves ~280px of empty bloom either side. Four
 * small chips drift there at half opacity, behind the headline's optical edge.
 *
 * THEY MUST NOT BE READABLE ENOUGH TO LOOK AT. Half opacity plus a 2px blur is
 * the point: they read as depth behind the words. If they ever start pulling
 * the eye off the headline the fix is less opacity, never more chips.
 *
 * THEY ARE FOUR SOURCES THE SNAP STAGE DOES NOT USE, on purpose. Nine
 * different tools across the fold says "it reads your stack"; the same five
 * twice says "something rendered wrong".
 *
 * They never converge, never resolve and never animate in — they are simply
 * already there when the page paints, which is what separates atmosphere from
 * a second performance competing with the hero's.
 */
const AMBIENT = [
  { source: "whop", name: "Whop", figure: "212", x: 84, y: 268, rot: -5, side: "left" },
  { source: "ganalytics", name: "Google Analytics", figure: "1.4k", x: 140, y: 470, rot: 4, side: "left" },
  { source: "typeform", name: "Typeform", figure: "96", x: 272, y: 232, rot: 5.5, side: "right" },
  { source: "aircall", name: "Aircall", figure: "306", x: 216, y: 452, rot: -4, side: "right" },
] as const;

export function AmbientChips() {
  return (
    <div className={styles.ambient} aria-hidden>
      {AMBIENT.map((chip, i) => (
        <div
          key={chip.source}
          className={`${styles.ambientChip} ${chip.side === "right" ? styles.ambientRight : ""} ${i % 2 === 1 ? styles.ambientLower : ""}`}
          /* `x` is a LEFT edge in both columns — the spec gives the right-hand
             pair as `viewport − 272`. Mapping it to `right` instead put their
             RIGHT edge there, which slid both chips 188px inward and landed one
             of them on top of the word "metrics". */
          style={
            {
              left: chip.side === "left" ? chip.x : `calc(100% - ${chip.x}px)`,
              top: chip.y,
              "--rot-base": `${chip.rot}deg`,
              animationDelay: `${i * 900}ms`,
            } as React.CSSProperties
          }
        >
          <Mark source={chip.source} size={30} />
          <span className={styles.ambientName}>{chip.name}</span>
          <span className={styles.ambientFigure}>{chip.figure}</span>
        </div>
      ))}
    </div>
  );
}
