"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/snap.module.css";

/** The one path the hero looks for. Documented in `public/README.md`. */
const DASHBOARD_SHOT = "/dashboard.png";

/**
 * THE HERO'S CENTREPIECE — a real screenshot of the product when one exists,
 * and the drawn summary card when it does not.
 *
 * ═══ WHY IT FALLS BACK RATHER THAN ASSUMING ═══
 *
 * The owner asked to be able to drop an image into `public/` and have the page
 * use it, with no code change. Pointing an `<img>` straight at a file that is
 * not there yet would put a broken-image glyph at the centre of the hero — the
 * first thing every visitor sees — for however long it takes to add the file.
 * So the image is rendered optimistically and the drawn card takes over on
 * `error`, which means BOTH states are a finished composition: today's page is
 * exactly what it was, and the day the file lands the page changes by itself.
 *
 * Detecting the file on the server was the other option and it is a trap:
 * Vercel serves `public/` from its CDN and does not ship it inside the
 * serverless bundle, so `fs.existsSync` would answer "missing" in production
 * for a file that is demonstrably being served. The browser is the only place
 * that can answer this honestly.
 *
 * ═══ THE SWAP IS A LAYOUT CHANGE, NOT JUST A PICTURE CHANGE ═══
 *
 * A screenshot is several times the area of the card it replaces, so the stage
 * gets a taller footprint and the centre chip steps out of the way — otherwise
 * the shot lands on top of it. That is why this component owns the class on
 * the stage rather than only rendering an `<img>`.
 */
export function DashboardShot({ fallback }: { fallback: React.ReactNode }) {
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  /**
   * `onError` ALONE IS NOT ENOUGH, and the gap is exactly the state this
   * component exists for.
   *
   * The `<img>` is server-rendered, so the browser requests it and gets its
   * 404 long before React hydrates and attaches a handler. The error event has
   * already been and gone; React never re-fires it; and the hero sat there
   * showing a broken-image glyph with `onError` written right above it.
   * Measured, not reasoned about — the check reported the image still present
   * against a URL returning 404.
   *
   * A finished image that failed reports `complete` with a `naturalWidth` of
   * zero, which is the only way to ask after the fact.
   */
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);

  if (missing) return <>{fallback}</>;

  return (
    <img
      ref={ref}
      className={styles.dashboardShot}
      src={DASHBOARD_SHOT}
      alt="The Namzilabs board: one reconciled figure per metric, each with the sources it was built from."
      onError={() => setMissing(true)}
      /* Hints only — the real dimensions come from the file. They stop the
         layout jumping while it loads. */
      width={1600}
      height={1000}
      decoding="async"
      fetchPriority="high"
    />
  );
}
