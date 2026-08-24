import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

/**
 * THE FRAME: one wash, painted once, with the canvas sitting inside it.
 *
 * The canvas is cut 32px at its left corners, and something has to show
 * through the notches — the rail's colour. The obvious way to get that is to
 * put the rail's background on a second element behind the canvas, and it is
 * the wrong way: the rail's wash is a GRADIENT, so two elements carrying the
 * same declaration resolve it over two different widths and land on two
 * different colours at the seam. They would also be two values a future edit
 * has to remember to change together, which is a promise no file can keep.
 *
 * So: this outer div is the ONLY thing that paints the wash. The rail is
 * transparent and sits on top of it, and the canvas sits on top of it too,
 * opaque, covering all of it but the two notches. The colour behind the canvas
 * and the colour of the rail are therefore not two values in sync — they are
 * one gradient, and cannot drift.
 *
 * Only the left corners are cut, and only when `framed` is set. The cut belongs
 * to the BUILDER: a canvas is a workspace you look into, and the 32px notch is
 * what says the app is holding it. A list of flows is not a workspace — it is a
 * document — and it reads better running flush off the rail, square, with no
 * gutter of wash between the navigation and the thing you came to read. The
 * right, top and bottom edges stay flush to the viewport either way, because a
 * card inset on all four sides is a different (and smaller-feeling) app.
 *
 * The wash is painted unconditionally regardless: an unframed page covers it
 * completely, so there is nothing to switch off, and one code path means the
 * framed and unframed pages can never disagree about the colour.
 *
 * `surface` is the caller's, because the pages genuinely disagree: list pages
 * scroll on white, the builder does not scroll and sits on the canvas grey. It
 * must carry an overflow value — rounded corners only cut the content if the
 * box clips.
 */
export function AppFrame({
  account,
  surface,
  framed = false,
  hide,
  ownsMain = false,
  children,
}: {
  account?: { initials: string; panel: ReactNode };
  surface: string;
  /** Cut the canvas into the rail's wash. The flow builder, and nothing else. */
  framed?: boolean;
  /** Rail items (by label) this viewer shouldn't see; AppShell decides. */
  hide?: string[];
  /**
   * Render the scroll region AS the page's `<main>` landmark.
   *
   * THIS FRAME USED TO BE A `<main>` UNCONDITIONALLY, and every page inside it
   * renders `PageContainer`, which is also a `<main>` — so all eight list
   * screens shipped with a `<main>` nested inside a `<main>`. That is invalid
   * HTML, and it costs a real user something: with two main landmarks, "jump
   * to main content" stops being an unambiguous move, and the skip link at the
   * top of the document has no single place to point.
   *
   * So the region is an ordinary `<div>` by default and the PAGE brings the
   * landmark. The builder is the one screen with no `PageContainer` — the
   * canvas fills the frame — so it opts in here instead, and every route ends
   * up with exactly one `<main id="main">`.
   */
  ownsMain?: boolean;
  children: ReactNode;
}) {
  // `relative` so anything a page floats over the canvas is measured against
  // the canvas, not the viewport. It belongs here rather than in a wrapper each
  // page remembers to add — the builder had exactly such a wrapper, and it was
  // one nesting level doing nothing else.
  const className = `relative min-w-0 flex-1 ${framed ? "rounded-l-frame" : ""} ${surface}`;

  return (
    // `h-dvh`, not `h-screen`: on mobile Safari `100vh` is the height the
    // viewport has with the browser chrome RETRACTED, so a full-height frame
    // is permanently taller than the window and the rail's account control
    // sits below the fold with nothing to scroll it into view.
    //
    // The safe-area padding is the other half of `viewportFit: "cover"` in
    // layout.tsx. Cover lets the wash run edge to edge — which is what you want
    // for a full-bleed dark rail — but without these insets the rail's mark
    // sits under the camera cutout in landscape, and its account avatar under
    // the home indicator. Padding the FRAME rather than the rail keeps the
    // colour full-bleed and moves only the content.
    <div
      className="bg-rail flex h-dvh"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <Sidebar account={account} hide={hide} />
      {ownsMain ? (
        <main id="main" className={className}>
          {children}
        </main>
      ) : (
        <div className={className}>{children}</div>
      )}
    </div>
  );
}
