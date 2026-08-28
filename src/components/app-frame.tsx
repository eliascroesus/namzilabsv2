import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * THE FRAME: three surfaces and two hairlines, and nothing else.
 *
 * WHAT IT WAS: one dark gradient painted here, with a transparent rail sitting
 * on it and the canvas cut 32px into it at the left corners so the wash showed
 * through the notch. That whole apparatus is gone with the dark rail — the
 * navigation is a white column now, `--radius-frame` is 0, and this div paints
 * nothing but `background` behind two children that are opaque anyway. The
 * prose is kept short on purpose: what is left is a flex row, and a page of
 * argument about a gradient nobody can see is how a file starts lying.
 *
 * THE SHAPE, AND WHY IT IS THIS ONE. The column runs the full height; the top
 * bar belongs to the CONTENT beside it rather than spanning the viewport,
 * exactly as it does in Miro, Notion and Figma. A bar spanning both would put
 * the workspace switcher above the navigation that switching it changes, and
 * the two hairlines — the column's right edge and the bar's bottom edge — would
 * stop meeting to make the single seam the chrome reads as.
 *
 * `surface` is still the caller's, because the pages genuinely disagree about
 * SCROLLING: list pages scroll, the builder does not.
 */
export function AppFrame({
  account,
  workspace,
  surface,
  hide,
  ownsMain = false,
  children,
}: {
  account?: { initials: string; panel: ReactNode };
  /** The workspace's own name — shown beside the mark in the top bar. */
  workspace?: string;
  surface: string;
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
  const className = `relative min-w-0 flex-1 ${surface}`;

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
      className="flex h-dvh bg-background"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <Sidebar hide={hide} workspace={workspace ?? "Workspace"} account={account} />
      {/* The top bar belongs to the CONTENT column, not the viewport: the
          sidebar runs full height beside it, exactly as it does in Miro and
          Notion. A bar spanning both would put the workspace switcher above
          the navigation that switching it changes. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar account={account} />
        {ownsMain ? (
          <main id="main" className={className}>
            {children}
          </main>
        ) : (
          <div className={className}>{children}</div>
        )}
      </div>
    </div>
  );
}
