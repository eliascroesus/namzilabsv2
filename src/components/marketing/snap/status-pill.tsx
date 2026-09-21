import styles from "@/app/snap.module.css";

/**
 * The first thing on the page that moves after the rail, and it arrives before
 * the headline — something is breathing inside a tenth of a second.
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
