"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "@/app/ledger.module.css";

type Line = { key: string; value: string };

/**
 * S05, and the one thing on this page that has to be DEMONSTRATED rather than
 * described. Every competitor can write "trusted numbers" on a slide; none of
 * them can open the arithmetic beside the figure while you read the sentence
 * claiming they can.
 *
 * ═══ WHY IT IS `cursor: help` AND NOT `cursor: pointer` ═══
 *
 * A pointer promises navigation. This control reveals — it opens a footnote
 * where you already are. The cursor, the superscript marker and the dotted
 * underline are three different signals saying the same thing, because the one
 * interaction the whole section depends on has to be discovered without a
 * label telling people to click.
 *
 * ═══ IT DOES NOT AUTO-OPEN AND IT DOES NOT AUTO-CLOSE ═══
 *
 * Not on scroll-into-view: the visitor has to act, or the demonstration proves
 * nothing about what THEY can do. And not on mouse-out either — somebody
 * reading a receipt moves their cursor, and a panel that vanishes mid-sentence
 * is a panel that taught them the feature is unreliable.
 */
export function ReceiptFigure({
  lead,
  label,
  value,
  marker,
  metric,
  lines,
  note,
}: {
  lead: React.ReactNode;
  label: string;
  value: string;
  marker: number;
  metric: string;
  lines: Line[];
  note: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Focus goes back where it came from, or the reader is stranded at the
      // top of the document having dismissed something they can't find again.
      triggerRef.current?.focus();
    };
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    // The lead paragraph shares the figure's grid rather than sitting in a row
    // above it: §7 puts the panel top-aligned WITH the paragraph, and two
    // stacked grids made it sit below, which read as an afterthought instead
    // of as the thing the paragraph is describing.
    <div className={styles.receiptRow} ref={wrapRef}>
      <div className={styles.receiptLead}>{lead}</div>
      <div className={styles.figurePanelCell}>
        <div className={styles.sheetPanel}>
          <button
            type="button"
            ref={triggerRef}
            className={styles.figureBtn}
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={`${value} ${label}, show receipt`}
          >
            <span className={`${styles.bodyS} ${styles.figureLabel}`}>{label}</span>
            <span className={`${styles.fig} ${styles.f2} ${styles.figureValue}`}>
              {value}
              <span className={`${styles.fig} ${styles.marker}`} aria-hidden>
                {marker}
              </span>
            </span>
            <span className={styles.figureUnderline} aria-hidden />
          </button>
        </div>
      </div>

      {open ? (
        <div className={styles.receiptCell}>
          <div className={styles.receipt} id={panelId} role="region" aria-label={`Receipt for ${metric}`}>
            <div className={styles.receiptHead}>
              <span className={styles.h4}>{metric}</span>
              <span className={`${styles.fig} ${styles.f4}`} style={{ color: "var(--verified)" }}>
                {value}
              </span>
            </div>
            <div className={styles.receiptDivider} />
            <dl className={styles.receiptLines}>
              {lines.map((line) => (
                <div className={styles.receiptLine} key={line.key}>
                  <dt className={styles.caption}>{line.key}</dt>
                  <dd className={`${styles.fig} ${styles.f5}`}>{line.value}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.receiptDivider} />
            <p className={`${styles.bodyS} ${styles.receiptNote}`}>{note}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
