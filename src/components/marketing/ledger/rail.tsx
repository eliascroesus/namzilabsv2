import styles from "@/app/ledger.module.css";
import { SourceTile } from "./marks";

/**
 * S02. Answers "does it read my stack?" in one glance, before any argument is
 * made — which is why it sits flush against the hero with no section padding
 * on either side, rather than getting a heading and a breath of its own.
 *
 * ═══ THE LOOP IS THE PAGE'S ONLY AMBIENT MOTION ═══
 *
 * Everything else moves when a person does something. This one exception earns
 * itself: a static row of seven logos answers "seven", and the thing the
 * reader needs to know is that the list keeps going. 44 seconds for a full
 * cycle is slow enough to read a name off it and fast enough not to look
 * stalled, and it pauses on hover so that reading one is possible.
 *
 * ═══ THE TRACK IS DUPLICATED, AND THAT IS LOAD-BEARING ═══
 *
 * The keyframe translates to -50%, so the second copy is exactly where the
 * first started when the animation wraps — the seam is invisible because there
 * is nothing at the seam. The duplicate is `aria-hidden`: a screen reader that
 * announced all 33 sources twice would be describing an implementation detail.
 */
export function SourceRail({ sources, count }: { sources: Array<{ name: string; short?: string }>; count: number }) {
  const items = (
    <>
      {sources.map((source) => (
        <span className={styles.railItem} key={source.name}>
          <SourceTile name={source.name} short={source.short} />
          {source.name}
          <span className={styles.railSep} aria-hidden />
        </span>
      ))}
    </>
  );

  return (
    <>
      <p className={`${styles.caption} ${styles.railLeadMobile}`}>Reads directly from {count} sources.</p>
      <section className={styles.rail} aria-label={`Reads directly from ${count} sources`}>
        <span className={styles.railLead}>Reads directly from {count} sources.</span>
        <span className={styles.railDivider} aria-hidden />
        <div className={styles.railViewport}>
          <div className={`${styles.railTrack} ${styles.railScrolling}`}>
            {items}
            <span aria-hidden>{items}</span>
          </div>
          {/* Reduced motion gets a static row rather than a slower one: a
              marquee that crawls is still a marquee. */}
          <div className={`${styles.railTrack} ${styles.railStatic}`}>
            {sources.slice(0, 7).map((source) => (
              <span className={styles.railItem} key={source.name}>
                <SourceTile name={source.name} short={source.short} />
                {source.name}
                <span className={styles.railSep} aria-hidden />
              </span>
            ))}
            <span className={`${styles.railItem} ${styles.faint}`}>and {count - 7} more</span>
          </div>
        </div>
      </section>
    </>
  );
}
