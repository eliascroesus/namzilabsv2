import { BarChart3, Blend, Divide, Filter } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { glyphInk, nodeAccent } from "@/components/flow/node-accent";
import styles from "@/app/snap.module.css";

/**
 * A METRIC ON THE CANVAS — and the metric is the whole point of the section.
 *
 * ═══ IT BUILDS A SHOW-UP RATE FROM TWO APPS, WHICH NO ONE APP CAN ═══
 *
 * It used to draw a single Calendly source counted into a number, which is a
 * thing Calendly already does for you — so the picture quietly argued that the
 * product is a slower way to get a figure you have. This one takes a calendar
 * and a spreadsheet, matches the same person across them, splits into the
 * meetings that were attended and every meeting booked, and divides. That is a
 * figure neither app holds, built from two that each hold half, which is the
 * claim the whole page rests on.
 *
 * The arithmetic ties back on purpose: 66.8% is the show-up rate on the board
 * in the hero. The two pictures describe one workspace.
 *
 * ═══ THE STEPS ARE THE PRODUCT'S, NOT INVENTED FOR THE DRAWING ═══
 *
 * Get data, Match, Filter, Summarize and Calculate are entries in the real
 * `NODE_LIBRARY`; the glyphs are the same lucide icons the canvas draws; and
 * the tile colours come from `nodeAccent`, so a step that is indigo here is
 * indigo in the builder. A connected Get-data step wears its app's real logo
 * bare, exactly as `NodeIcon` does — which also fixes the grey squares this
 * drawing used to show, one of which had been rendering BLACK since the
 * invented `--src-*` palette was deleted out from under it.
 *
 * ═══ ONE SVG, ONE COORDINATE SYSTEM ═══
 *
 * Cards and wires share a viewBox so they cannot drift. An earlier version
 * placed cards with CSS percentages and drew wires in SVG units: they agreed
 * at exactly one width, and everywhere else the wires left from empty space.
 */
const W = 210;
const H = 84;

/** Centre of a node's left and right edge, for wiring. */
const midY = (y: number, h = H) => y + h / 2;

const NODES = [
  { id: "cal", x: 30, y: 88, label: "Get data", value: "Google Calendar", source: "gcal" },
  { id: "sheet", x: 30, y: 328, label: "Get data", value: "Google Sheets", source: "gsheets" },
  { id: "match", x: 270, y: 208, label: "Match", value: "email, then name", type: "unite", variant: "unite_match" },
  { id: "filter", x: 510, y: 88, label: "Filter", value: "attended is yes", type: "filter" },
  { id: "booked", x: 510, y: 328, label: "Summarize", value: "meetings booked", type: "formula" },
  { id: "held", x: 750, y: 88, label: "Summarize", value: "meetings held", type: "formula" },
  { id: "rate", x: 985, y: 195, label: "Calculate", value: "held ÷ booked", type: "formula", variant: "formula_compare", h: 110, result: "66.8%" },
];

const GLYPH = { unite_match: Blend, filter: Filter, formula: BarChart3, formula_compare: Divide };

/** Right edge of A to left edge of B, bowing through the gap between them. */
const wire = (a: (typeof NODES)[number], b: (typeof NODES)[number]) => {
  const x1 = a.x + W;
  const y1 = midY(a.y, a.h);
  const x2 = b.x;
  const y2 = midY(b.y, b.h);
  const bend = (x2 - x1) / 2;
  return `M${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
};

const N = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<string, (typeof NODES)[number]>;

const WIRES = [
  wire(N.cal, N.match),
  wire(N.sheet, N.match),
  wire(N.match, N.filter),
  wire(N.match, N.booked),
  wire(N.filter, N.held),
  wire(N.held, N.rate),
  wire(N.booked, N.rate),
];

export function CanvasShot() {
  return (
    <svg
      className={styles.shotCanvas}
      viewBox="0 0 1200 500"
      role="img"
      aria-label="A metric on the canvas: Google Calendar and Google Sheets are matched on email then name, split into the meetings that were attended and every meeting booked, and divided into a show-up rate of 66.8 per cent."
    >
      <defs>
        <pattern id="snap-canvas-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0 L0 0 0 40" fill="none" stroke="rgba(20,20,28,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1200" height="500" className={styles.shotGround} />
      <rect width="1200" height="500" fill="url(#snap-canvas-grid)" />

      <g className={styles.shotWire}>
        {WIRES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {NODES.map((node) => {
        const h = node.h ?? H;
        const accent = node.type ? nodeAccent(node.type, node.variant) : null;
        const Glyph = node.variant
          ? GLYPH[node.variant as keyof typeof GLYPH]
          : node.type
            ? GLYPH[node.type as keyof typeof GLYPH]
            : null;
        const iconY = node.y + (h - 34) / 2;

        return (
          <g key={node.id}>
            <rect x={node.x} y={node.y} width={W} height={h} rx={16} className={styles.shotNode} vectorEffect="non-scaling-stroke" />

            {/* A connected Get-data step wears its app's mark bare; every other
                step wears its accent tile with the builder's own glyph. */}
            {node.source ? (
              <g transform={`translate(${node.x + 16} ${iconY})`}>
                <BrandLogo source={node.source} size={34} />
              </g>
            ) : accent && Glyph ? (
              <g transform={`translate(${node.x + 16} ${iconY})`}>
                <rect width={34} height={34} rx={10} fill={accent} />
                <g transform="translate(7 7)">
                  {/* No `strokeWidth`: globals.css declares the kit's 2.25 once, on
                      `svg.lucide`, and a zero-specificity rule still beats lucide's own
                      presentation attribute. Re-spelling it here is a build failure. */}
                  <Glyph width={20} height={20} color={glyphInk(accent)} />
                </g>
              </g>
            ) : null}

            <text x={node.x + 62} y={node.y + (node.result ? 38 : 38)} fontSize="12" fontWeight="500" className={styles.shotLabel}>
              {node.label}
            </text>
            <text x={node.x + 62} y={node.y + (node.result ? 58 : 60)} fontSize="14" fontWeight="600" className={styles.shotValue}>
              {node.value}
            </text>
            {node.result ? (
              <text x={node.x + 62} y={node.y + 88} fontSize="22" fontWeight="700" className={styles.shotResult}>
                {node.result}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
