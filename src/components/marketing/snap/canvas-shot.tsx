import styles from "@/app/snap.module.css";

/**
 * A crop of the metric canvas, DRAWN rather than photographed.
 *
 * A screenshot is the honest choice when the thing photographed is stable
 * enough to photograph once. This builder is not, and a stale PNG of a canvas
 * that has since been rebuilt is a lie with a long shelf life. This draws the
 * same four steps the real canvas runs — pull, keep, match, total — in the
 * real vocabulary, so it goes out of date LOUDLY (the words stop matching the
 * app) rather than quietly (the pixels do).
 *
 * ═══ ONE SVG, ONE COORDINATE SYSTEM ═══
 *
 * An earlier version placed the cards with CSS percentages and drew the wires
 * in an SVG viewBox on top. Those are two coordinate systems that agree at
 * exactly one width: the wires left from empty space and arrived beside the
 * cards instead of at them. On a page arguing that things line up, that is the
 * worst available detail to get wrong.
 */
const NODES = [
  { x: 80, y: 180, label: "Get data", value: "Calendly · events", source: "--src-coral" },
  { x: 470, y: 120, label: "Keep", value: "status is held", source: null },
  { x: 470, y: 330, label: "Match", value: "email, then name", source: null },
  { x: 860, y: 225, label: "Total", value: "count of rows", source: null },
];

export function CanvasShot() {
  return (
    <svg
      className={styles.shotCanvas}
      viewBox="0 0 1200 675"
      role="img"
      aria-label="Four steps on the metric canvas: get data from Calendly, keep the meetings marked held, match the same person across sources, and total what is left."
    >
      <defs>
        <pattern id="snap-canvas-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0 L0 0 0 40" fill="none" stroke="rgba(20,20,28,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1200" height="675" className={styles.shotGround} />
      <rect width="1200" height="675" fill="url(#snap-canvas-grid)" />

      <g className={styles.shotWire}>
        <path d="M340 225 C 405 225, 405 165, 470 165" />
        <path d="M340 225 C 405 225, 405 375, 470 375" />
        <path d="M730 165 C 795 165, 795 270, 860 270" />
        <path d="M730 375 C 795 375, 795 270, 860 270" />
      </g>

      {NODES.map((node) => (
        <g key={node.label}>
          <rect
            x={node.x}
            y={node.y}
            width={260}
            height={90}
            rx={18}
            className={styles.shotNode}
            vectorEffect="non-scaling-stroke"
          />
          {node.source ? (
            <rect x={node.x + 20} y={node.y + 26} width={38} height={38} rx={13} fill={`var(${node.source})`} />
          ) : (
            <rect x={node.x + 20} y={node.y + 26} width={38} height={38} rx={13} className={styles.shotChipNeutral} />
          )}
          <text x={node.x + 72} y={node.y + 42} fontSize="13" fontWeight="500" className={styles.shotLabel}>
            {node.label}
          </text>
          <text x={node.x + 72} y={node.y + 64} fontSize="17" fontWeight="600" className={styles.shotValue}>
            {node.value}
          </text>
        </g>
      ))}
    </svg>
  );
}
