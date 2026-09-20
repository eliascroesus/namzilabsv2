import styles from "@/app/snap.module.css";
import { Mark, Tick } from "./marks";

const ROWS = [
  { name: "Close rate", was: "was 27.4%", now: "20.0%", flagged: true },
  { name: "Show-up rate", was: "unchanged", now: "69%", flagged: false },
  { name: "Speed to lead", was: "was 8m 39s", now: "31m 12s", flagged: true },
];

const READING = [
  { source: "close", name: "Close CRM" },
  { source: "calendly", name: "Calendly" },
  { source: "instantly", name: "Instantly" },
];

/**
 * S07's preview card — a still image of a FINISHED exchange.
 *
 * ═══ THE TWO FLAGGED ROWS ARE THE HIGHEST-VALUE THING HERE ═══
 *
 * Three identical rows make the eye read all three to find out which one
 * matters. Tinting the two that moved puts the diagnosis on screen before a
 * word is read — which is the whole claim of the section, since what is being
 * sold is not a fact-check but a diagnosis.
 *
 * ═══ NO TYPEWRITER, NO MESSAGE-BY-MESSAGE REVEAL ═══
 *
 * A typing animation would undercut the one thing this section asserts: that
 * these are real published figures rather than a performance. The only motion
 * is the header's connection dot and the source marks appearing once when the
 * card first reaches the viewport.
 *
 * The follow-up pills are `aria-hidden` and `cursor: default` on purpose. They
 * exist to show the conversation continues; making them look clickable when
 * nothing happens is how a visitor learns the whole card is a mock-up.
 */
export function AiPanel() {
  return (
    <div className={styles.aiCard}>
      <div className={styles.aiCardHead}>
        <span className={styles.aiAssistantMark} aria-hidden />
        <span className={`${styles.bodyS} ${styles.aiAssistant}`}>Claude</span>
        <span className={styles.aiCardHeadRight}>
          <span className={styles.statusDot} aria-hidden />
          <span className={`${styles.caption} ${styles.faint}`}>Namzilabs workspace</span>
        </span>
      </div>

      <div className={styles.aiCardBody}>
        <p className={`${styles.bodyS} ${styles.bubble}`}>Why did our close rate drop last week?</p>

        <p className={`${styles.caption} ${styles.aiReading}`}>
          <span className={styles.goodDot} aria-hidden />
          Reading 3 metrics
          <span className={styles.aiReadingMarks}>
            {READING.map((s, i) => (
              <span key={s.source} className={styles.aiReadingMark} style={{ animationDelay: `${i * 90}ms` }}>
                <Mark source={s.source} size={20} />
              </span>
            ))}
          </span>
        </p>

        <div className={styles.aiMetrics}>
          {ROWS.map((row) => (
            <div className={`${styles.aiMetric} ${row.flagged ? styles.aiMetricFlagged : ""}`} key={row.name}>
              {row.flagged ? <span className={styles.aiFlagDot} aria-hidden /> : null}
              <span className={`${styles.bodyS} ${styles.aiMetricName}`}>{row.name}</span>
              <span className={`${styles.bodyS} ${styles.aiMetricWas}`}>{row.was}</span>
              <span className={styles.f4}>{row.now}</span>
            </div>
          ))}
        </div>

        <p className={`${styles.bodyS} ${styles.aiAnswer}`}>
          Show-up rate held, so it isn&rsquo;t the calls. Speed to lead went from{" "}
          <strong className={styles.aiFigure}>8m 39s</strong> to <strong className={styles.aiFigure}>31m 12s</strong> on
          Tuesday, the same day two reps were out. Close rate tracks that, not lead quality.
        </p>

        <div className={styles.followUps} aria-hidden>
          <span className={styles.followUp}>What did that cost us?</span>
          <span className={styles.followUp}>Show me by rep</span>
        </div>

        <span className={`${styles.badge} ${styles.aiFoot}`}>
          <Tick size={14} />
          Read-only. Every figure is a metric you published.
        </span>
      </div>
    </div>
  );
}
