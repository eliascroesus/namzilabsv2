import styles from "@/app/snap.module.css";

/**
 * THE SECOND BAND — the same object as the source rail, carrying the other
 * half of the sentence.
 *
 * S02 answers "what does it read". This answers "what does it produce", and
 * it sits where the reader has just watched one metric being assembled and is
 * about to be shown that metric's receipt. Between the two, a band of the
 * things the assembly is FOR.
 *
 * ═══ THE FIGURES ARE NOT INVENTED, AND THAT MATTERED ═══
 *
 * A marquee of round numbers on a marketing page is ordinarily a wall of
 * fiction, and this page has refused invented proof everywhere else. So every
 * figure below is one the page already shows somewhere, or the division of
 * two of them:
 *
 *   Booking, show-up and close rate    the board in the fold shows all three
 *   Cost per held meeting, speed to lead   S05's receipts, exactly
 *   Revenue per lead                   $259,748 ÷ 719 leads, both on the board
 *   Reply-to-meeting rate              41 booked ÷ 112 replies, both in S03
 *   Cost per reply                     $3,542 spend ÷ 112 replies, S05 and S03
 *
 * So a reader who checks is rewarded rather than caught, which is the same
 * contract S05 makes. None of it is attributed to a customer, because there
 * are none to attribute it to — the lead line names these as metrics that
 * NEED two tools, not as results somebody got.
 *
 * ═══ EVERY ONE OF THEM IS CROSS-SOURCE, WHICH IS THE POINT ═══
 *
 * Revenue is not here. Nor is lead count, nor AOV. Any single tool can show
 * those, and a band of metrics this product does not need to exist for would
 * argue against the page it sits in. Each row below requires at least two
 * tools read together, which is the one thing none of them can do alone.
 */
const METRICS = [
  { name: "Show-up rate", figure: "66.8%" },
  { name: "Cost per held meeting", figure: "$86.40" },
  { name: "Speed to lead", figure: "8m 39s" },
  { name: "Booking rate", figure: "50.8%" },
  { name: "Revenue per lead", figure: "$361" },
  { name: "Close rate", figure: "34.4%" },
  { name: "Reply-to-meeting rate", figure: "36.6%" },
  { name: "Cost per reply", figure: "$31.63" },
];

/**
 * `aria-hidden` on the track, for the same reason S02's is: a marquee is
 * duplicated to hide its seam, so a screen reader would be read sixteen
 * figures for eight. The band keeps an accessible name, and the static list
 * below the SM breakpoint is the one a reader who is not being animated at
 * gets.
 */
export function MetricRail({ id }: { id?: string }) {
  const items = METRICS.map((metric) => (
    <span className={styles.metricPill} key={metric.name}>
      <span className={styles.metricName}>{metric.name}</span>
      <span className={styles.metricFigure}>{metric.figure}</span>
    </span>
  ));

  return (
    <>
      <p className={`${styles.caption} ${styles.railLeadMobile}`}>Metrics that need two tools to exist.</p>
      <section id={id} className={`${styles.rail} ${styles.metricRail}`} aria-label="Metrics that need two tools to exist">
        <span className={styles.railLead}>Metrics that need two tools to exist.</span>
        <span className={styles.railDivider} aria-hidden />
        <div className={styles.railViewport} aria-hidden>
          {/* Right to left, against S02's direction. Two marquees running the
              same way a scroll apart read as one long belt that the page is
              sitting on; running opposite ways they read as two separate
              things, which is what they are. */}
          <div className={`${styles.railTrack} ${styles.railScrolling} ${styles.metricTrack}`}>
            {items}
            {items}
          </div>
          <div className={`${styles.railTrack} ${styles.railStatic}`}>{items.slice(0, 4)}</div>
        </div>
      </section>
    </>
  );
}
