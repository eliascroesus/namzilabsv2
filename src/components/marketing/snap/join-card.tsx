import styles from "@/app/snap.module.css";
import { Mark, Tick } from "./marks";
import { CountUp } from "./count-up";

/**
 * THE HERO'S ONE OBJECT.
 *
 * It replaces seven: five floating chips, a separate resolved card and a
 * dashboard screenshot. Those asked the eye to FIND the relationship between
 * scattered things. This states it in reading order — four partial answers,
 * they converge, here is the whole one — on a single baseline, nothing
 * rotated, nothing faded, nothing clipped.
 *
 * ═══ WHY THE SCATTERED VERSION FAILED ═══
 *
 * Two of its pieces were decoration too faint to be understood, and at that
 * point they are indistinguishable from a defect: half-opacity blurred chips
 * rotated and cut by the viewport edge read as UI that failed to load, not as
 * atmosphere. The rule the redesign enforces is that if an element is worth
 * having it is worth being legible, and if it is not worth being legible it is
 * not worth having.
 *
 * It is also 320px tall instead of 460, which is what finally gets the answer
 * itself — the `41` — above the fold on a 900px screen.
 */
const ROWS = [
  { source: "calendly", name: "Calendly", label: "invitee-created events", figure: "41" },
  { source: "close", name: "Close CRM", label: "meetings logged to a lead", figure: "38" },
  { source: "gsheets", name: "Google Sheets", label: "the sheet kept by hand", figure: "44" },
  { source: "instantly", name: "Instantly", label: "replies that booked something", figure: "12" },
];

/**
 * One path per row, from the centre of its right edge to a single point. They
 * converge INSIDE the ink card's left edge so the meeting point is absorbed by
 * it rather than terminating in open space — four lines ending in mid-air is a
 * diagram of nothing.
 */
const WIRES = ROWS.map((_, i) => {
  const y = 34 + i * 68;
  return `M0 ${y} C 70 ${y}, 60 160, 130 160`;
});

export function JoinCard() {
  return (
    <div className={styles.join}>
      <div className={styles.joinRows}>
        {ROWS.map((row, i) => (
          <div className={styles.joinRow} key={row.source} style={{ animationDelay: `${1340 + i * 90}ms` }}>
            <Mark source={row.source} size={26} />
            <span className={styles.joinName}>{row.name}</span>
            <span className={styles.joinLabel}>{row.label}</span>
            <span className={styles.joinFigure}>{row.figure}</span>
          </div>
        ))}
      </div>

      <svg className={styles.joinWires} viewBox="0 0 130 320" fill="none" aria-hidden preserveAspectRatio="none">
        {WIRES.map((d) => (
          <path key={d} className={styles.joinWire} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <div className={styles.joinInk}>
        <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} aria-hidden />
        <div className={styles.joinInkBody}>
          <div className={styles.joinInkTop}>
            <span className={styles.joinInkMark} aria-hidden />
            <span className={styles.joinInkName}>Namzilabs</span>
            <span className={styles.joinInkTick}>
              <Tick size={20} onDark />
            </span>
          </div>

          <div className={styles.joinInkFigure}>
            <span className={styles.f2}>
              <CountUp to={41} from={0} delay={2620} duration={500} />
            </span>
            <span className={`${styles.bodyS} ${styles.joinInkUnit}`}>meetings held</span>
          </div>

          <p className={`${styles.caption} ${styles.joinInkSub}`}>123 in · 82 matched · 41 unique</p>
        </div>
      </div>
    </div>
  );
}
