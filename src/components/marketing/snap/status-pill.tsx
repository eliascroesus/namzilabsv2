import styles from "@/app/snap.module.css";

/**
 * The first thing on the page that moves, and it arrives before the headline.
 *
 * The band between the nav and the headline was 92px of nothing. A visitor
 * decides in about two seconds whether a product is alive; a page that paints
 * a large static headline and then waits ~1s for its first motion has spent
 * most of that budget proving the opposite. This enters at t=60ms — inside a
 * tenth of a second — so something is breathing before a word is read.
 *
 * IT IS THE SMALLEST POSSIBLE LOOP. One 8px dot on a 2s cycle, which is the
 * one new ambient animation the page gains, and it stops under
 * `prefers-reduced-motion` like the rest.
 *
 * `last sweep 2 min ago` is a STATIC value and deliberately not a counter. A
 * number that claims to be live and never moves while somebody watches it is
 * worse than one that never claimed to be.
 */
export function StatusPill({ count }: { count: number }) {
  return (
    <div className={styles.statusPill}>
      <span className={styles.statusDot} aria-hidden />
      <span className={styles.caption}>Reading {count} sources</span>
      <span className={styles.statusDivider} aria-hidden />
      <span className={`${styles.caption} ${styles.faint}`}>last sweep 2 min ago</span>
    </div>
  );
}
