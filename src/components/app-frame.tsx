import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { cn } from "@/lib/utils";
import type { BoardView } from "@/lib/board/types";

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
  firstName,
  metricCount,
  views,
  surface,
  hide,
  ownsMain = false,
  children,
}: {
  account?: { initials: string; panel: ReactNode };
  /** The workspace's own name — shown beside its avatar in the top bar. */
  workspace?: string;
  /**
   * The signed-in person's first name, for the top bar's greeting.
   *
   * A SEAM, not a decoration: the greeting falls back to a nameless "Welcome
   * back!" until something upstream can supply this, and the shell is the only
   * place that can — it is the one component in the frame that has already
   * resolved the session.
   */
  firstName?: string;
  /**
   * How many metrics this workspace has, for the top bar's ring.
   *
   * A PASS-THROUGH, and it stays one. This frame is handed the number because
   * the only component that can produce it is the PAGE — the dashboard counts
   * its published flow tiles and classic metrics as part of the work it already
   * does, and every other route genuinely does not read the metrics table at
   * all. Resolving it here instead would mean one more query on every render of
   * every screen in the product to fill in a decoration, which is the trade the
   * whole file is built to avoid (see `firstName` above: same seam, same
   * reason). Left undefined, the ring stands down — see `TopBar`.
   */
  metricCount?: number;
  /**
   * The workspace's dashboard views, for the rail's nested list under Dashboard.
   *
   * A PASS-THROUGH, like `metricCount` — but resolved in the shell rather than
   * by each page, because unlike a metric count this is NAVIGATION and has to be
   * the same on every route. `navViews` is per-request cached so the dashboard
   * does not pay for it twice; see that file.
   */
  views?: BoardView[];
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
  //
  /**
   * THE GROUND IS DECIDED HERE, ONCE, AND NOT ON A PAGE.
   *
   * `bg-canvas-bg` used to be re-typed by every caller of this frame, which
   * meant the answer to "what colour is the page under the board" lived in as
   * many places as there were routes — and the one that mattered most, the
   * dashboard's, lived in `app-shell.tsx` beside a WorkOS membership fetch.
   * The frame owns the surface it paints; `surface` is about SCROLLING, which
   * is the one thing the pages genuinely disagree about.
   *
   * `cn` rather than interpolation is what makes the override honest. Two
   * `bg-*` classes in one attribute are settled by their order in the
   * generated stylesheet, not by the call site — so a caller that named its
   * own ground was relying on luck. tailwind-merge resolves them last-wins,
   * so the kit page keeps its white sheet (`bg-card`) and the builder keeps
   * the canvas grey it pans over (`bg-canvas-bg`) by SAYING so, and every
   * other route gets the ground without mentioning it.
   */
  const className = cn("relative min-w-0 flex-1 bg-ground", surface);

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
      {/* THE RAIL TAKES ONLY `hide` NOW. It used to be handed the workspace
          name and the account panel because it opened with a switcher and
          closed with an avatar; at 70px it carries neither — the workspace
          identity and the account menu are both in the top bar, which is where
          every reference puts them. Passing them anyway would be two props a
          component ignores, which is how a signature stops describing what a
          thing actually needs. */}
      <Sidebar hide={hide} views={views} />
      {/* The top bar belongs to the CONTENT column, not the viewport: the
          sidebar runs full height beside it, exactly as it does in Miro and
          Notion. A bar spanning both would put the workspace switcher above
          the navigation that switching it changes. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* THE BAR IS WHERE IDENTITY LANDS. The workspace's name and the
            account panel used to go to the rail; at 70px the rail is icons and
            nothing else, so both come here — the workspace avatar and name at
            the reading edge, the account at the far one. */}
        <TopBar account={account} workspace={workspace} firstName={firstName} metricCount={metricCount} />
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
