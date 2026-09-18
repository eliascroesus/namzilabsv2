"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * THE PAGE'S ONE PIECE OF SCROLL MOTION.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * The owner's verdict on the page without it was "extremely boring and
 * mundane", and he is right about the mechanism: every section arrived fully
 * formed, all at once, identically. A page that never acknowledges being
 * scrolled feels like a PDF.
 *
 * ── WHY IT DOES NOT FLASH, AND WHY IT SURVIVES A DEAD BUNDLE ───────────────
 *
 * This is the part that is usually got wrong. The obvious build renders the
 * hidden state in the HTML and lets JavaScript reveal it — which means a
 * visitor whose bundle fails, or who is served the page by a crawler that runs
 * no script, gets a blank document. Nothing about a decoration justifies that.
 *
 * So the server renders VISIBLE. The hidden state is applied in an effect, and
 * only to elements that are BELOW THE FOLD at that moment — anything already on
 * screen is left alone and never animates, because animating what somebody is
 * already looking at is a flash rather than an entrance. Off-screen elements
 * can be hidden without anybody seeing it happen.
 *
 * ── WHY `translate3d` AND NOT `top`/`margin` ───────────────────────────────
 *
 * Transform and opacity are the two properties a browser can animate on the
 * compositor without touching layout. Anything else re-runs layout for the
 * whole document on every frame of every reveal, which is the exact kind of
 * cost the scroll pass just finished taking off this page.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
}: {
  children: React.ReactNode;
  /** Stagger, in ms. Kept small — 60-90ms between siblings reads as one
   *  gesture; 300ms reads as a queue and makes a grid feel slow. */
  delay?: number;
  as?: "div" | "li" | "section";
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* Somebody who asked for less motion gets none, and gets it without ever
       being hidden in the first place. */
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    /* ALREADY VISIBLE: leave it exactly as the server drew it. */
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    el.dataset.reveal = "";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.shown = "true";
        io.disconnect();
      },
      /* A negative bottom margin so it fires when the element is properly in
         the frame rather than the instant its first pixel appears. */
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * A NUMBER THAT COUNTS UP TO ITSELF.
 *
 * Reserved for the figures the page is ACTUALLY ABOUT — the resolved 41 in the
 * receipts section, and the three that disagree with it. A page where every
 * number ticks is a slot machine; three that do are the ones you are meant to
 * read.
 *
 * THE SERVER RENDERS THE FINAL VALUE, for the same reason `Reveal` renders
 * visible: a bundle that never arrives must leave a number on the page, not a
 * zero. The count only ever runs on a client that is watching.
 */
export function CountUp({ to, className, prefix = "" }: { to: number; className?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();

        const DURATION = 900;
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION);
          /* Ease-out cubic: fast at the start, settling at the end. A linear
             count reads as a loading spinner; this reads as an answer being
             arrived at. */
          const eased = 1 - (1 - t) ** 3;
          el.textContent = `${prefix}${Math.round(to * eased).toLocaleString("en-US")}`;
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, prefix]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {to.toLocaleString("en-US")}
    </span>
  );
}
