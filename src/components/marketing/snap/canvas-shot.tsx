"use client";

import { useEffect, useRef, useState } from "react";
import { Blend, Divide, Filter } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { glyphInk, nodeAccent } from "@/components/flow/node-accent";
import { CountUp } from "@/components/marketing/snap/count-up";
import styles from "@/app/snap.module.css";

/**
 * A METRIC BEING BUILT — light, labelled, and on a grid.
 *
 * ═══ WHY THIS IS NOT THE DARK BOX IT REPLACES ═══
 *
 * The previous drawing was one SVG on a near-black ground with unlabelled
 * tiles floating in it. Two things were wrong with that and only one was
 * cosmetic. The cosmetic one: this page's own rule is that S07 and S10 are the
 * only dark sections, and a third dark panel in the middle flattened the
 * rhythm the section padding is tuned to produce. The load-bearing one: a
 * reader could not tell what any tile DID. The picture is an argument — two
 * apps that each hold half an answer, joined into one figure — and an argument
 * made in unlabelled icons is not made at all.
 *
 * So every node now carries its own name and its own object: not `Match` but
 * `Match / same person`, not `Divide` but `Divide / by booked`. Five nodes and
 * one answer, left to right, no branching. The earlier version forked into
 * held and booked and rejoined, which is more faithful to the builder and much
 * harder to read at a glance; a landing page owes the reader the shape of the
 * idea, not the shape of the implementation.
 *
 * ═══ THE OUTPUT IS INK BECAUSE IT IS AN ANSWER ═══
 *
 * Same rule as the fold's board, restated at 176px: the sources are paper and
 * the reconciled figure is ink. That is the only dark thing in the section
 * and it is the thing the section is about.
 *
 * ═══ HTML NODES, SVG EDGES, ONE PIXEL GRID ═══
 *
 * The old drawing put cards and wires in one SVG so they could not drift.
 * That worked, and cost real text: SVG `<text>` gets no font features, no
 * wrapping, no tabular figures, and a count-up inside it cannot reuse
 * `CountUp`. Here the nodes are HTML positioned in px and the edges are one
 * SVG layer at the SAME px size with no scaling — `width: 1200; height: 460`
 * and a matching viewBox — so the two coordinate systems are literally the
 * same one. Nothing scales, so nothing can drift.
 */

const NODE_W = 200;
const NODE_H = 64;
/** 116, not 108: see `.cvOut` — the answer is a card, not a cube, and its
    width (176) is the stylesheet's business because nothing here measures it. */
const OUT_H = 116;

type Src = { kind: "source"; id: string; x: number; y: number; source: string; name: string; sub: string };
type Step = { kind: "step"; id: string; x: number; y: number; type: string; variant?: string; name: string; sub: string };

const SOURCES: Src[] = [
  { kind: "source", id: "gcal", x: 40, y: 120, source: "gcal", name: "Google Calendar", sub: "Meetings" },
  { kind: "source", id: "gsheets", x: 40, y: 276, source: "gsheets", name: "Google Sheets", sub: "Show-ups" },
];

const STEPS: Step[] = [
  { kind: "step", id: "match", x: 300, y: 198, type: "unite", variant: "unite_match", name: "Match", sub: "same person" },
  { kind: "step", id: "filter", x: 540, y: 198, type: "filter", name: "Filter", sub: "held only" },
  { kind: "step", id: "divide", x: 780, y: 198, type: "formula", variant: "formula_compare", name: "Divide", sub: "by booked" },
];

const OUT = { x: 1000, y: 172 };

const GLYPH: Record<string, typeof Blend> = { match: Blend, filter: Filter, divide: Divide };

/** Right edge of A to left edge of B, bowing through the gap between them. */
function edge(x1: number, y1: number, x2: number, y2: number) {
  const bend = (x2 - x1) / 2;
  return `M${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

const R = (x: number, y: number, w = NODE_W, h = NODE_H) => [x + w, y + h / 2] as const;
const L = (x: number, y: number, h = NODE_H) => [x, y + h / 2] as const;

const EDGES = [
  { d: edge(...R(40, 120), ...L(300, 198)), delay: 200 },
  { d: edge(...R(40, 276), ...L(300, 198)), delay: 240 },
  { d: edge(...R(300, 198), ...L(540, 198)), delay: 500 },
  { d: edge(...R(540, 198), ...L(780, 198)), delay: 740 },
  { d: edge(...R(780, 198), ...L(OUT.x, OUT.y, OUT_H)), delay: 980 },
];

/** Where an edge starts and ends, for the endpoint dots. */
const DOTS = [
  R(40, 120),
  R(40, 276),
  L(300, 198),
  R(300, 198),
  L(540, 198),
  R(540, 198),
  L(780, 198),
  R(780, 198),
  L(OUT.x, OUT.y, OUT_H),
];

const NODE_DELAY: Record<string, number> = { gcal: 0, gsheets: 100, match: 400, filter: 640, divide: 880, out: 1120 };

export function CanvasShot() {
  const stage = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);

  /**
   * ONCE, ON FIRST ENTRY — and it disconnects itself, so scrolling back does
   * not replay it. A drawing that re-animates every time it passes the fold
   * reads as a loading state rather than as a thing that finished.
   */
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLive(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.cvFit}>
      <div
        ref={stage}
        className={styles.cvStage}
        data-live={live ? "true" : undefined}
        role="img"
        aria-label="A metric being built: Google Calendar's meetings and Google Sheets' show-ups are matched to the same person, filtered to held only, and divided by booked, giving a show-up rate of 66.8 per cent — 247 meetings held of 370 booked."
      >
        <svg className={styles.cvEdges} width="1200" height="460" viewBox="0 0 1200 460" aria-hidden focusable="false">
          {EDGES.map((e) => (
            <path key={e.d} className={styles.cvEdge} d={e.d} style={{ "--d": `${e.delay}ms` } as React.CSSProperties} />
          ))}
        </svg>

        {SOURCES.map((n) => (
          <div
            key={n.id}
            className={`${styles.cvNode} ${styles.cvNodeStd}`}
            style={{ left: n.x, top: n.y, "--d": `${NODE_DELAY[n.id]}ms` } as React.CSSProperties}
          >
            <span className={styles.cvLogo} aria-hidden>
              <BrandLogo source={n.source} size={28} />
            </span>
            <span className={styles.cvNodeText}>
              <span className={`${styles.bodyS} ${styles.cvNodeName}`}>{n.name}</span>
              <span className={`${styles.caption} ${styles.cvNodeSub}`}>{n.sub}</span>
            </span>
          </div>
        ))}

        {STEPS.map((n) => {
          const accent = nodeAccent(n.type, n.variant);
          const Glyph = GLYPH[n.id];
          return (
            <div
              key={n.id}
              className={`${styles.cvNode} ${styles.cvNodeStd}`}
              style={{ left: n.x, top: n.y, "--d": `${NODE_DELAY[n.id]}ms` } as React.CSSProperties}
            >
              <span className={styles.cvTile} style={{ background: accent }} aria-hidden>
                {/* No `strokeWidth`: globals.css declares the kit's 2.25 once, on
                    `svg.lucide`, and a zero-specificity rule still beats lucide's
                    own presentation attribute. Re-spelling it here is a build
                    failure waiting for the next kit change. */}
                <Glyph width={16} height={16} color={glyphInk(accent)} />
              </span>
              <span className={styles.cvNodeText}>
                <span className={`${styles.bodyS} ${styles.cvNodeName}`}>{n.name}</span>
                <span className={`${styles.caption} ${styles.cvNodeSub}`}>{n.sub}</span>
              </span>
            </div>
          );
        })}

        {/* THE HANDLES ARE A SECOND LAYER, ABOVE THE NODES, and that is the
            whole reason they are not in the SVG above. A handle sits ON a
            node's border by definition; drawn underneath, every one of the
            nine was exactly half-hidden by the card it belonged to, which at
            6px means invisible. The edges still have to pass BEHIND the
            cards, so one layer cannot do both jobs. */}
        <svg className={styles.cvHandles} width="1200" height="460" viewBox="0 0 1200 460" aria-hidden focusable="false">
          {DOTS.map(([x, y]) => (
            <circle key={`${x}-${y}`} className={styles.cvDot} cx={x} cy={y} r={3} />
          ))}
        </svg>

        {/* THE ARITHMETIC IS ON THE CARD, and that is not a decoration on the
            drawing — it is the drawing's conclusion. Four nodes above say what
            was done; `247 of 370 booked` is what it produced, and it divides
            out to the percentage beside it, which is a thing a reader can
            check in their head and the page had not previously offered them
            anywhere above the receipt. */}
        <div
          className={`${styles.cvNode} ${styles.cvOut}`}
          style={{ left: OUT.x, top: OUT.y, "--d": `${NODE_DELAY.out}ms` } as React.CSSProperties}
        >
          <span className={`${styles.caption} ${styles.cvOutLabel}`}>Show-up rate</span>
          <span className={styles.cvOutFigure}>
            {live ? <CountUp to={66.8} from={0} delay={60} duration={620} format={(v) => `${v.toFixed(1)}%`} /> : "66.8%"}
          </span>
          <span className={`${styles.caption} ${styles.cvOutFoot}`}>247 of 370 booked</span>
        </div>
      </div>
    </div>
  );
}
