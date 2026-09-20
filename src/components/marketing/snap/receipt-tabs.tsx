"use client";

import { useId, useRef, useState } from "react";
import styles from "@/app/snap.module.css";
import { CountUp } from "./count-up";

export type Metric = {
  tab: string;
  figure: string;
  /** The numeric part, so the figure can count from one tab's value to the
      next, plus how to render it back. */
  value: number;
  /**
   * A NAME rather than a function, and that is a boundary constraint, not a
   * style choice: this data is built in a server component and a function
   * cannot cross the server/client boundary — React refuses to serialise it.
   * The formatter itself lives on this side and is chosen by the name.
   */
  kind: "count" | "currency" | "duration";
  lines: Array<{ key: string; value: string }>;
  note: string;
};

const FORMATTERS: Record<Metric["kind"], (value: number) => string> = {
  count: (value) => String(Math.round(value)),
  currency: (value) => `$${value.toFixed(2)}`,
  duration: (value) => `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s`,
};

/**
 * S05 — and the one change from the previous version that matters most.
 *
 * The receipt used to be hidden behind a hover on a figure. That put the
 * product's only real moat behind an interaction most visitors never perform:
 * the section CLAIMED every number shows its working, and then declined to
 * show any working unless you happened to mouse over the right element. The
 * receipt is now rendered by default, and the interactivity moved to tabs —
 * three real metrics you can switch between — so the section is still alive
 * without hiding its own point.
 *
 * ═══ A REAL TABLIST, NOT DIVS WITH HANDLERS ═══
 *
 * Arrow keys move between tabs, Home and End jump to the ends, `aria-selected`
 * reports the state, and focus follows selection. §10 asks for the pattern by
 * name; it is also the difference between a control a keyboard user can
 * operate and a decoration they cannot see.
 */
export function ReceiptTabs({ metrics }: { metrics: Metric[] }) {
  const [index, setIndex] = useState(0);
  const baseId = useId();
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
        <span className={`${styles.bodyS} ${styles.figureLabel}`}>{active.tab}</span>
        <span className={`${styles.f2} ${styles.figureValue}`} key={active.tab}>
          <CountUp to={active.value} format={FORMATTERS[active.kind]} duration={420} />
        </span>

        <div className={styles.tabs} role="tablist" aria-label="Metrics" onKeyDown={onKeyDown}>
          {metrics.map((metric, i) => (
            <button
              key={metric.tab}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={i === index}
              aria-controls={`${baseId}-panel`}
              tabIndex={i === index ? 0 : -1}
              ref={(node) => {
                tabRefs.current[i] = node;
              }}
              className={`${styles.badge} ${styles.tab} ${i === index ? styles.tabActive : ""}`}
              onClick={() => setIndex(i)}
            >
              {metric.tab}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.receiptCell}>
        <div
          className={styles.receipt}
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${index}`}
        >
          {/* Keyed on the tab so React remounts the contents and the swap
              animation replays — without the key the panel would cross-fade
              nothing, because the DOM nodes never change identity. */}
          <div className={styles.receiptSwap} key={active.tab}>
            <div className={styles.receiptHead}>
              <span className={styles.h4}>{active.tab}</span>
              <span className={styles.f4}>{active.figure}</span>
            </div>
            <div className={styles.receiptDivider} />
            <dl className={styles.receiptLines}>
              {active.lines.map((line) => (
                <div className={styles.receiptLine} key={line.key}>
                  <dt className={styles.caption}>{line.key}</dt>
                  <dd className={styles.bodyS}>{line.value}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.receiptDivider} />
            <p className={`${styles.bodyS} ${styles.receiptNote}`}>{active.note}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
