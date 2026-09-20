import styles from "@/app/snap.module.css";
import { Mark } from "./marks";

/**
 * S02 — the full-bleed band, flush against the hero above it and the
 * disagreement below. Zero section padding is not an oversight: that flush
 * contact is what makes it read as a BAND rather than as another section, and
 * it is the "thin" beat in the density rhythm between "big, airy" and "dense".
 *
 * ═══ IT IS aria-hidden, ON PURPOSE ═══
 *
 * The rail is decorative repetition of S08, which is the real, searchable,
 * accessible list of the same 33 sources. Announcing a marquee — twice over,
 * since the track is duplicated to hide the seam — would be describing an
 * implementation detail to somebody who has a better version of it waiting
 * further down the page. The section still carries an accessible name so it
 * can be skipped rather than waded through.
 */
export function SourceRail({ sources, count, id }: { sources: Array<{ source: string; name: string }>; count: number; id?: string }) {
  const items = sources.map((source) => (
    <span className={styles.railPill} key={source.name}>
      <Mark source={source.source} size={28} radius="50%" />
      {source.name}
    </span>
  ));

  return (
    <>
      <p className={`${styles.caption} ${styles.railLeadMobile}`}>Reads directly from {count} sources.</p>
      <section id={id} className={styles.rail} aria-label={`Reads directly from ${count} sources`}>
        <span className={styles.railLead}>Reads directly from {count} sources.</span>
        <span className={styles.railDivider} aria-hidden />
        <div className={styles.railViewport} aria-hidden>
          {/* Duplicated because the keyframe translates to -50%: the second
              copy sits exactly where the first started when it wraps, so
              there is nothing at the seam to see. */}
          <div className={`${styles.railTrack} ${styles.railScrolling}`}>
            {items}
            {items}
          </div>
          <div className={`${styles.railTrack} ${styles.railStatic}`}>
            {items.slice(0, 7)}
            <span className={styles.badge}>and {count - 7} more</span>
          </div>
        </div>
      </section>
    </>
  );
}
