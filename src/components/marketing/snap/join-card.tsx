import Image from "next/image";
import styles from "@/app/snap.module.css";
import { Mark } from "./marks";

/**
 * THE HERO STAGE — the real board, wired to the tools that feed it.
 *
 * The product screenshot is the centrepiece and the sources are nodes around
 * it, drawn as the same pills the source rail uses. That consistency is the
 * point: a reader meets the pill here and meets it again forty pixels of
 * scroll later, so the rail reads as more of the same thing rather than as a
 * different component.
 *
 * ═══ THE LINES ARE ORTHOGONAL, NOT CURVES ═══
 *
 * Four soft converging curves read as decoration. A bus — each node running
 * straight to a trunk, the trunk running straight into the board — reads as
 * WIRING, which is what it is. The corners are rounded by 16px so it stays a
 * drawn object rather than a wireframe, and the stroke sits at 22% rather than
 * the 16% the curves used, because a line too faint to follow is the same
 * failure as decoration too faint to read.
 */
const NATURAL = { width: 3456, height: 1922 };

/**
 * The screenshot arrives inside its own window chrome — measured off the file,
 * a #121212 border 12px along the top and 14px along the right and bottom.
 * Left is not cropped by the same amount because the app's own navigation rail
 * is that colour. Percentages, so an image swapped in later without a frame
 * loses less than half a percent rather than breaking.
 */
const FRAME = { top: 12, right: 14, bottom: 14, left: 14 };
const CROPPED = {
  width: NATURAL.width - FRAME.left - FRAME.right,
  height: NATURAL.height - FRAME.top - FRAME.bottom,
};

const LEFT = [
  { source: "calendly", name: "Calendly" },
  { source: "close", name: "Close CRM" },
  { source: "gsheets", name: "Google Sheets" },
];

const RIGHT = [
  { source: "stripe", name: "Stripe" },
  { source: "instantly", name: "Instantly" },
  { source: "aircall", name: "Aircall" },
];

/** Stage 1200 × 420. Board x 280–920, its left/right edge centres at y 210. */
const WIRES = [
  "M190 82 L 224 82 Q 240 82 240 98 L 240 194 Q 240 210 256 210 L 280 210",
  "M190 210 L 280 210",
  "M190 338 L 224 338 Q 240 338 240 322 L 240 226 Q 240 210 256 210 L 280 210",
  "M1010 82 L 976 82 Q 960 82 960 98 L 960 194 Q 960 210 944 210 L 920 210",
  "M1010 210 L 920 210",
  "M1010 338 L 976 338 Q 960 338 960 322 L 960 226 Q 960 210 944 210 L 920 210",
];

function Pill({ source, name, delay }: { source: string; name: string; delay: number }) {
  return (
    <span className={styles.nodePill} style={{ animationDelay: `${delay}ms` }}>
      <Mark source={source} size={28} radius="50%" />
      {name}
    </span>
  );
}

export function JoinCard() {
  return (
    <div className={styles.stage}>
      <div className={styles.nodeCol}>
        {LEFT.map((s, i) => (
          <Pill key={s.source} source={s.source} name={s.name} delay={1240 + i * 90} />
        ))}
      </div>

      <svg className={styles.wires} viewBox="0 0 1200 420" fill="none" aria-hidden preserveAspectRatio="none">
        {WIRES.map((d) => (
          <path key={d} className={styles.wire} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <span className={styles.board} style={{ aspectRatio: `${CROPPED.width} / ${CROPPED.height}` }}>
        <Image
          className={styles.boardImg}
          style={{
            left: `${(-FRAME.left / CROPPED.width) * 100}%`,
            top: `${(-FRAME.top / CROPPED.height) * 100}%`,
            width: `${(NATURAL.width / CROPPED.width) * 100}%`,
            height: `${(NATURAL.height / CROPPED.height) * 100}%`,
          }}
          src="/dashboard.png"
          alt="The Namzilabs board: leads, booked leads, calls showed, customers, revenue and AOV, each reconciled from several tools."
          width={NATURAL.width}
          height={NATURAL.height}
          sizes="(max-width: 1023px) 92vw, 640px"
          priority
        />
      </span>

      <div className={`${styles.nodeCol} ${styles.nodeColRight}`}>
        {RIGHT.map((s, i) => (
          <Pill key={s.source} source={s.source} name={s.name} delay={1240 + i * 90} />
        ))}
      </div>
    </div>
  );
}
