"use client";

import { useRef, useState } from "react";
import styles from "@/app/snap.module.css";
import { CountUp } from "./count-up";
import { Mark } from "./marks";

export type Metric = {
  tab: string;
  figure: string;
  value: number;
  kind: "count" | "currency" | "duration";
  sources: Array<{ source: string; name: string }>;
  records: string;
  /** Only where a real prior value exists. Never "unchanged". */
  change?: string;
  lines: Array<{ key: string; value: string; excluded?: boolean }>;
  note: string;
};

const FORMATTERS: Record<Metric["kind"], (value: number) => string> = {
  count: (value) => String(Math.round(value)),
  currency: (value) => `$${value.toFixed(2)}`,
  duration: (value) => `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s`,
};

/**
 * S05 — ONE card, split down the middle.
 *
 * ═══ WHY IT STOPPED BEING TWO ═══
 *
 * Two cards meant two heights, so their bottoms never lined up; a hairline
 * connector between them ended in a rotated nub that read as a glitch rather
 * than a join; and the ink card carried a dead band between the figure and its
 * provenance. One surface deletes all three problems at once — there is
 * nothing left to connect, and both halves end on the same edge because they
 * are the same card.
 *
 * ═══ THE TABS MOVED TO THE TOP ═══
 *
 * That is what clears the ink panel's empty band, and it makes the control the
 * first thing read rather than the last — which is the right order for
 * something whose whole job is "pick a metric, then read its working".
 *
 * ═══ CROSS-HIGHLIGHTING IS THE ARGUMENT, PERFORMED ═══
 *
 * Hovering `Sources read` rings the logos that produced the figure; hovering a
 * logo tints the row and steps that name up a weight. The names rest at 500 so
 * the step to 600 is visible at all — when they sat at the row's own 600 the
 * highlight declared nothing and nothing moved.
 */
export function ReceiptTabs({ metrics }: { metrics: Metric[] }) {
  const [index, setIndex] = useState(0);
  const [lit, setLit] = useState(false);
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = metrics[index];

  const onKeyDown = (event: React.KeyboardEvent) => {
    const last = metrics.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setIndex(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={styles.receiptCard}>
      <div className={styles.receiptBar}>
        <div className={styles.segTabs} role="tablist" aria-label="Metrics" onKeyDown={onKeyDown}>
          {metrics.map((metric, i) => (
            <button
              key={metric.tab}
              type="button"
              role="tab"
              aria-selected={i === index}
              tabIndex={i === index ? 0 : -1}
              ref={(node) => {
                tabRefs.current[i] = node;
              }}
              className={`${styles.segTab} ${i === index ? styles.segTabOn : ""}`}
              onClick={() => setIndex(i)}
            >
              {metric.tab}
            </button>
          ))}
        </div>
        <span className={`${styles.caption} ${styles.receiptStamp}`}>
          <span className={styles.statusDot} aria-hidden />
          Recomputed 2 minutes ago
        </span>
      </div>

      <div className={styles.receiptSplit}>
        <div className={styles.receiptInk}>
          <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} aria-hidden />
          <div className={styles.receiptInkBody}>
            <span className={`${styles.bodyS} ${styles.figureLabel}`}>{active.tab}</span>
            <span className={`${styles.f2} ${styles.figureValue}`} key={active.tab}>
              <CountUp to={active.value} format={FORMATTERS[active.kind]} duration={420} />
            </span>

            {active.change ? <span className={`${styles.caption} ${styles.changeBadge}`}>{active.change}</span> : null}

            <p className={`${styles.caption} ${styles.readFrom}`}>Read from</p>
            <div className={styles.readMarks}>
              {active.sources.map((s, i) => (
                <span
                  key={s.source}
                  className={`${styles.readMark} ${lit ? styles.readMarkLit : ""}`}
                  style={{ transitionDelay: `${i * 60}ms` }}
                  onMouseEnter={() => setHoveredSource(s.source)}
                  onMouseLeave={() => setHoveredSource(null)}
                  title={s.name}
                >
                  <Mark source={s.source} size={32} />
                </span>
              ))}
              <span className={`${styles.caption} ${styles.readCount}`}>{active.records}</span>
            </div>
          </div>
        </div>

        <div className={styles.receiptWhite} role="tabpanel" aria-label={active.tab}>
          <div className={styles.receiptSwap} key={active.tab}>
            <dl className={styles.receiptRows}>
              {active.lines.map((line) => {
                const isSources = line.key === "Sources read";
                return (
                  <div
                    className={`${styles.receiptRow} ${isSources ? styles.receiptSourcesLine : ""} ${
                      isSources && hoveredSource ? styles.receiptLineLit : ""
                    }`}
                    key={line.key}
                    onMouseEnter={isSources ? () => setLit(true) : undefined}
                    onMouseLeave={isSources ? () => setLit(false) : undefined}
                  >
                    <dt>
                      {/* The deleted incompleteness section's claim, attached to
                          a real number. It dims rather than disappearing at
                          zero so the row keeps its shape across tabs. */}
                      {line.excluded ? (
                        <span className={`${styles.flagDot} ${line.value === "0" ? styles.flagDotZero : ""}`} aria-hidden />
                      ) : null}
                      {line.key}
                    </dt>
                    <dd>
                      {isSources
                        ? active.sources.map((s, i) => (
                            <span key={s.source} className={hoveredSource === s.source ? styles.sourceNameLit : styles.sourceNames}>
                              {s.name}
                              {i < active.sources.length - 1 ? ", " : ""}
                            </span>
                          ))
                        : line.value}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className={`${styles.bodyS} ${styles.receiptNote}`}>{active.note}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
