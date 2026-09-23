import Link from "next/link";
import styles from "@/app/snap.module.css";
import { GoogleMark } from "@/components/google-mark";

/**
 * THE PAGE'S ONE ACTION, STATED AS TWO DOORS INTO THE SAME ROOM.
 *
 * ═══ WHY TWO BUTTONS AND NOT ONE ═══
 *
 * `Connect your first tool` described the first thing a person would do
 * INSIDE the product, which meant the page's primary control promised a step
 * that does not happen until after two screens they had not been told about.
 * `Start free with email` and `Start free with Google` name what the click
 * actually does, and the second one is a genuinely different path — it lands
 * on Google, not on a form — so it earns a button rather than a line of small
 * print.
 *
 * Google goes SECOND here, unlike on the sign-up card where it goes first.
 * The card is a form and Google is the way to skip it; this is a page, where
 * the thing being offered is the product and the fastest route is the smaller
 * of the two claims. The order also keeps the heavier button nearest the copy
 * it belongs to.
 *
 * ═══ NEITHER ONE IS BLACK ═══
 *
 * See `.btn` in the stylesheet for the whole argument. Briefly: ink was the
 * only fill on this page because a pale blue pill disappeared into a pale
 * blue bloom, and the bloom is a different colour now.
 *
 * ═══ A SIGNED-IN READER IS OFFERED NEITHER ═══
 *
 * `Start free` is a lie told to somebody who already has an account, and the
 * two links would send them through sign-up to arrive back where they
 * started. They get one button that goes where they were already going. The
 * label changing with the reader is fine here in a way it is not for a
 * marketing claim: this one describes the READER's state, not the product's.
 */
export function StartButtons({
  signedIn,
  tone = "light",
  align = "start",
  className,
}: {
  signedIn: boolean;
  /** `dark` is the closing panel: paper fills on ink, rather than ink on paper. */
  tone?: "light" | "dark";
  align?: "start" | "centre";
  className?: string;
}) {
  const row = [styles.ctaRow, align === "centre" ? styles.ctaRowCentre : "", className].filter(Boolean).join(" ");

  if (signedIn) {
    return (
      <div className={row}>
        <Link className={`${styles.btn} ${tone === "dark" ? styles.btnOnDark : ""}`} href="/dashboard">
          Go to your dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className={row}>
      <Link className={`${styles.btn} ${tone === "dark" ? styles.btnOnDark : ""}`} href="/signup">
        Start free with email
      </Link>
      {/* Straight to Google rather than to the hosted sign-in page — see
          `src/app/auth/google/route.ts`, which swaps one query parameter on the
          SDK's own authorize URL to get there. */}
      <Link className={`${styles.btnPaper} ${tone === "dark" ? styles.btnPaperOnDark : ""}`} href="/auth/google">
        <GoogleMark size={20} />
        Start free with Google
      </Link>
    </div>
  );
}
