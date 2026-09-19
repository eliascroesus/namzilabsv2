"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/ledger.module.css";

type Step = { title: string; body: string };

/**
 * S04. Three steps, genuinely sequential, which is what earns the numbering —
 * a numbered list whose items could be shuffled is a decorated bullet list.
 *
 * ═══ THE RULES BESIDE THE NUMERALS ARE THE PAGE'S ONLY SCROLL-LINKED MOTION ═══
 *
 * And it is a progress indicator, not an entrance. The distinction is the
 * whole motion policy: sections on this page do not fade up as you reach them,
 * because a document does not animate itself into existence — it is already
 * written when you turn to it. What DOES move here is a line that reports how
 * far through the three steps the reader has scrolled, which is information
 * they did not otherwise have.
 *
 * It is tied to scroll POSITION rather than to a timer, so scrubbing backwards
 * un-draws it. A timer fired by an intersection would run to completion whether
 * or not the reader was still there, which is an entrance wearing a progress
 * indicator's clothes.
 */
export function Steps({ steps }: { steps: Step[] }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const ruleRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ruleRefs.current.forEach((rule) => rule?.style.setProperty("--progress", "1"));
      return;
    }

    // Step 1 completes when the section's top reaches 60% of viewport height,
    // steps 2 and 3 at 50% and 40% — so the three lines fill in order as the
    // block climbs the screen rather than all at once.
    const COMPLETE_AT = [0.6, 0.5, 0.4];
    let queued = false;

    const measure = () => {
      queued = false;
      const top = section.getBoundingClientRect().top;
      const viewport = window.innerHeight;
      ruleRefs.current.forEach((rule, index) => {
        if (!rule) return;
        const finish = viewport * (COMPLETE_AT[index] ?? 0.4);
        const span = viewport - finish;
        const progress = span <= 0 ? 1 : Math.min(Math.max((viewport - top) / span, 0), 1);
        rule.style.setProperty("--progress", String(progress));
      });
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className={styles.steps} ref={sectionRef}>
      {steps.map((step, index) => (
        <div className={styles.step} key={step.title}>
          <div className={styles.stepHead}>
            <span className={`${styles.fig} ${styles.f3} ${styles.stepNum}`}>{index + 1}</span>
            <span
              className={styles.stepRule}
              aria-hidden
              ref={(node) => {
                ruleRefs.current[index] = node;
              }}
            />
          </div>
          <h3 className={`${styles.h4} ${styles.stepTitle}`}>{step.title}</h3>
          <p className={`${styles.bodyS} ${styles.stepBody}`}>{step.body}</p>
        </div>
      ))}
    </div>
  );
}
