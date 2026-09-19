import styles from "@/app/ledger.module.css";

/**
 * THE TICK — the auditor's check, and the reason it is drawn here rather than
 * imported from lucide.
 *
 * The landing page uses two marks and no icon set. A library checkmark is
 * symmetrical and mechanical; this one is not. The short arm is 38% the length
 * of the long one, which is the proportion a person's hand actually makes when
 * ticking down a column, and at 14px that difference is the whole character of
 * the mark.
 *
 * It is never the only thing carrying a meaning: every `verified` state on the
 * page is paired with this tick, so the state survives for a reader who cannot
 * separate the green from the ink. That is a hard requirement, not a polish
 * item.
 */
export function Tick({ size = 14, draw = false }: { size?: number; draw?: boolean }) {
  return (
    <svg
      aria-hidden
      className={draw ? `${styles.tick} ${styles.tickDraw}` : styles.tick}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <path
        d="M2.83 7.83 L5.5 10.5 L12 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A source's brand tile at row scale.
 *
 * Deliberately NOT the product's `SourceMark`: that one paints each connector
 * in its own brand colour, which is right inside the app — a row is recognised
 * by shape before it is read — and wrong here, where §5.9 caps source marks at
 * monochrome `ink-60`. A wall of brand colours on this page would be the logo
 * wall the design explicitly refuses.
 */
export function SourceTile({ name, short }: { name: string; short?: string }) {
  const initials = short ?? name
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span aria-hidden className={styles.mark}>
      {initials || name.slice(0, 2).toUpperCase()}
    </span>
  );
}
