import styles from "@/app/ledger.module.css";

/**
 * A crop of the metric canvas, DRAWN rather than photographed.
 *
 * A screenshot would be the honest choice if the product's canvas were stable
 * enough to photograph once; it is not, and a stale PNG of a builder that has
 * since been rebuilt is a lie with a long shelf life. This is a drawing of the
 * same four steps the real canvas runs — pull, keep, match, total — carrying
 * the real vocabulary, so it goes out of date loudly (the words stop matching
 * the app) rather than quietly (the pixels do).
 *
 * ═══ IT IS ONE SVG, AND THAT IS A BUG FIX RATHER THAN A PREFERENCE ═══
 *
 * The first version placed the step cards with CSS percentages and drew the
 * wires in an SVG viewBox on top. Those are two coordinate systems: the cards
 * were sized in fixed pixels and the wires in viewBox units, so they agreed at
 * exactly one width and nowhere else. On screen the wires left from empty
 * space and arrived beside the cards rather than at them — which, on a page
 * whose entire argument is that things line up, is the worst possible detail
 * to get wrong. Cards and wires now share one viewBox and cannot drift.
 *
 * ═══ THIS IS THE ONE PLACE THE APP'S BLUE IS ALLOWED ═══
 *
 * §5.5: the marketing page does not use blue; the software inside the
 * screenshots does. That contrast separates the argument from the artefact —
 * the page is making a case, and this is the thing the case is about. Which is
 * also why the frame has a 12px radius while every sheet of paper around it
 * has none: on this page, radius means "software".
 */
const NODES = [
  { x: 40, y: 80, label: "Get data", value: "Calendly · events", accent: false },
  { x: 315, y: 80, label: "Keep", value: "status is held", accent: true },
  { x: 315, y: 250, label: "Match", value: "email, then name", accent: false },
  { x: 590, y: 165, label: "Total", value: "count of rows", accent: true },
];

const W = 170;
const H = 54;

export function CanvasShot() {
  return (
    <figure className={styles.ui}>
      <figcaption className={styles.uiBar}>Meetings held · draft</figcaption>
      <svg className={styles.uiCanvas} viewBox="0 0 800 450" role="img" aria-label="Four steps on the metric canvas: get data from Calendly, keep held meetings, match the same person across sources, total what is left.">
        <defs>
          <pattern id="ledger-canvas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0 L0 0 0 24" fill="none" stroke="rgba(21,36,27,0.07)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="800" height="450" fill="url(#ledger-canvas-grid)" />

        <g className={styles.uiWire}>
          <path d="M210 107 L315 107" />
          <path d="M210 107 C 262 107, 262 277, 315 277" />
          <path d="M485 107 C 537 107, 537 192, 590 192" />
          <path d="M485 277 C 537 277, 537 192, 590 192" />
        </g>

        {NODES.map((node) => (
          <g key={node.label}>
            <rect
              x={node.x}
              y={node.y}
              width={W}
              height={H}
              rx={10}
              className={styles.uiSheet}
              stroke="var(--rule)"
              vectorEffect="non-scaling-stroke"
            />
            <text x={node.x + 14} y={node.y + 21} fontSize="9" className={styles.uiLabel}>
              {node.label}
            </text>
            <text
              x={node.x + 14}
              y={node.y + 39}
              fontSize="12"
              className={node.accent ? styles.uiAccent : styles.uiInk}
            >
              {node.value}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
