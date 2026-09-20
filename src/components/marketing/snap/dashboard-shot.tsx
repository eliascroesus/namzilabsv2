"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "@/app/snap.module.css";

/** The one path the hero looks for. Documented in `public/README.md`. */
const DASHBOARD_SHOT = "/dashboard.png";

/**
 * The source file's own pixels. Required by `next/image` and worth stating
 * rather than guessing: they fix the aspect ratio, so the hero reserves the
 * right box before the image arrives and nothing shifts underneath it.
 */
const NATURAL = { width: 3456, height: 1922 };

/**
 * THE SCREENSHOT ARRIVES INSIDE ITS OWN WINDOW FRAME, and it is cropped off.
 *
 * Measured off the file rather than eyeballed — sampling the edges finds a
 * #121212 border 12px along the top and 14px along the right and bottom, which
 * is the captured window's chrome. Left is not cropped by the same amount
 * because the app's OWN navigation rail is that colour, so there is nothing to
 * find there; it takes the same trim as the right for symmetry.
 *
 * Left in place it reads as a black mat down two sides of the picture. Cropped,
 * the board runs to the corner radius like a screenshot should. The values are
 * percentages, so an image swapped in later without a frame loses less than
 * half a percent — invisible — rather than breaking.
 */
const FRAME = { top: 12, right: 14, bottom: 14, left: 14 };
const CROPPED = {
  width: NATURAL.width - FRAME.left - FRAME.right,
  height: NATURAL.height - FRAME.top - FRAME.bottom,
};

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

  /**
   * `next/image` RATHER THAN A BARE `<img>`, and the reasoning is the opposite
   * of the profile page's.
   *
   * That avatar is a user-supplied URL on a blob host, so optimising it would
   * mean allow-listing a hostname in next.config — configuration that fails
   * closed at runtime, on a 96px image where the optimizer saves nothing. This
   * is a local file in `public/`: no allow-list, and the saving is the whole
   * point. The source is a 281KB PNG at 3456px wide displayed at 720, so the
   * optimizer serves WebP at the width actually needed — roughly a fifth of
   * the bytes, on the element that IS this page's Largest Contentful Paint.
   *
   * `priority` preloads it for the same reason. `quality` is lifted above the
   * default because this is a screenshot full of small text, which is exactly
   * what aggressive compression smears.
   */
  return (
    /* The crop lives on a wrapper rather than on the image: `clip-path` would
       have taken the drop shadow with it, and the shadow is what lifts the
       board off the bloom. */
    <span
      className={styles.dashboardShot}
      style={{ aspectRatio: `${CROPPED.width} / ${CROPPED.height}` }}
    >
      <Image
        ref={ref}
        className={styles.dashboardShotImg}
        style={{
          left: `${(-FRAME.left / CROPPED.width) * 100}%`,
          top: `${(-FRAME.top / CROPPED.height) * 100}%`,
          width: `${(NATURAL.width / CROPPED.width) * 100}%`,
          height: `${(NATURAL.height / CROPPED.height) * 100}%`,
        }}
        src={DASHBOARD_SHOT}
        alt="The Namzilabs board: leads, booked leads, calls showed, customers, revenue and AOV, each reconciled from several tools."
        onError={() => setMissing(true)}
        width={NATURAL.width}
        height={NATURAL.height}
        sizes="(max-width: 1023px) 92vw, 760px"
        quality={90}
        priority
      />
    </span>
  );
}
