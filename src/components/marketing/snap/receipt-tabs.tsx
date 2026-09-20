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
  /** The connectors that fed this figure, in the order the receipt lists them. */
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
 * S05 — the section that has to DEMONSTRATE the moat rather than describe it.
 *
 * ═══ THE FIGURE CARD IS INK ═══
 *
 * Two white boxes side by side is what this was, and the left one had a large
 * dead region between the figure and the tabs. Making the answer black fixes
 * both: it states the page's central idea a second time without repeating a
 * layout (the hero's resolved object is the same colour for the same reason),
 * and it gives the empty region something to be — the sources that fed the
 * number, which is the one piece of information that makes a figure mean
 * anything.
 *
 * ═══ CROSS-HIGHLIGHTING IS THE ARGUMENT, PERFORMED ═══
 *
 * Hovering `Sources read` in the receipt raises the very squircles on the ink
 * card that produced the figure, and hovering a squircle tints the row back.
 * It costs almost nothing and it shows what a sentence can only assert: that
 * this number knows where it came from.
 *
 * ═══ A REAL TABLIST ═══
 *
 * Arrow keys move, Home/End jump, `aria-selected` reports. The pattern is the
 * difference between a control a keyboard user can operate and a decoration
 * they cannot see.
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
    <div className={styles.receiptPair}>
      <div className={styles.pairConnector} aria-hidden />

      <div className={styles.figureCard}>
        <div className={styles.panelBlooms} aria-hidden>
          <div className={`${styles.panelBloom} ${styles.panelBloomLilac}`} />
        </div>
        <div className={styles.figureCardBody}>
          <span className={`${styles.bodyS} ${styles.figureLabel}`}>{active.tab}</span>
          <span className={`${styles.f2} ${styles.figureValue}`} key={active.tab}>
            <CountUp to={active.value} format={FORMATTERS[active.kind]} duration={420} />
          </span>

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

          {active.change ? <span className={`${styles.caption} ${styles.changeBadge}`}>{active.change}</span> : null}

          <div className={styles.tabs} role="tablist" aria-label="Metrics" onKeyDown={onKeyDown}>
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
                className={`${styles.tabDark} ${i === index ? styles.tabDarkActive : ""}`}
                onClick={() => setIndex(i)}
              >
                {metric.tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.receiptCell}>
        <div className={styles.receipt} role="tabpanel" aria-label={active.tab}>
          <span className={styles.receiptNub} aria-hidden />
          <div className={styles.receiptSwap} key={active.tab}>
            <div className={styles.receiptHead}>
              <span className={styles.h4}>{active.tab}</span>
              <span className={styles.f4}>{active.figure}</span>
            </div>
            <div className={styles.receiptDivider} />
            <dl className={styles.receiptLines}>
              {active.lines.map((line) => {
                const isSources = line.key === "Sources read";
                return (
                  <div
                    className={`${styles.receiptLine} ${isSources ? styles.receiptSourcesLine : ""} ${
                      isSources && hoveredSource ? styles.receiptLineLit : ""
                    }`}
                    key={line.key}
                    onMouseEnter={isSources ? () => setLit(true) : undefined}
                    onMouseLeave={isSources ? () => setLit(false) : undefined}
                  >
                    <dt className={styles.caption}>
                      {/* The deleted incompleteness section's claim, attached to
                          a real number instead of announced as a principle. It
                          dims rather than disappearing at zero so the row keeps
                          its shape across tabs. */}
                      {line.excluded ? (
                        <span className={`${styles.flagDot} ${line.value === "0" ? styles.flagDotZero : ""}`} aria-hidden />
                      ) : null}
                      {line.key}
                    </dt>
                    <dd className={styles.bodyS}>
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
            <div className={styles.receiptDivider} />
            <p className={`${styles.bodyS} ${styles.receiptNote}`}>{active.note}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
