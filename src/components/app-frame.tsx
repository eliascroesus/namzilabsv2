import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileDrawer } from "./mobile-drawer";
import { cn } from "@/lib/utils";
import type { BoardView } from "@/lib/board/types";

/**
 * THE FRAME — a full-height rail, then a column of [bar | panel].
 *
 * IT RAN THE OTHER WAY FOR FOUR DAYS: a full-width bar across the top with the
 * rail hanging beneath its left end. The argument for it was that a bar
 * spanning both would put the workspace switcher above the navigation that
 * switches it — true when the switcher was IN the bar, and moot once it moved
 * into the rail's own head block.
 *
 * Both 8 September frames draw the row, and their metadata is exact about it:
 * in 58:5824 the sidebar is `x=0 y=0 260x1200`, the FULL height of the frame,
 * and the top bar is `x=260 y=0 1660x65` — a child of the content column, not
 * a sibling above it.
 *
 * THE SYMPTOM OF HAVING IT BACKWARDS was reported as "the navbars are
 * overlapping wrong entirely": the account cluster sat above the workspace
 * switcher instead of beside it, and the rail began 60px down a screen where
 * the design starts it at zero. `pnpm geometry` measures both boxes against
 * those numbers now, because no source-reading test can see a laid-out pixel.
 *
 * THREE MATERIALS NOW, AND THE RAIL IS THE ONE THE MODES ARGUE ABOUT. It used
 * to be true that the rail and the bar were one permanently-dark `--chrome`;
 * the 9 September frame split them (`--rail-*` and `--topbar-*`), and the 10
 * September frames give the rail three grounds across three modes — light in
 * `:root`, near-black in `.mix`, near-black in `.dark`. Every value it draws
 * goes through a `--rail-*` role for exactly that reason: a band on its own
 * ground cannot borrow the content's ink, hairline or control fill, and now it
 * cannot borrow them in either direction.
 *
 * THE NOTCH IS A FRAME NOW. `--radius-frame` was 0 for two days on the
 * argument that a corner cut into #121214 to reveal #121214 draws nothing —
 * true, and it stopped being true the moment node 35:6024 put an 8px gutter of
 * `--background` around the panel. There is a surface behind the corner again,
 * so the corner is back, on all four rather than on the top-right alone, and
 * `--spacing-frame` sits beside `--radius-frame` so the inset and the radius
 * cannot drift apart.
 *
 * THE RAIL IS NOT A CONSTANT ANY MORE EITHER — see the paragraph above. It is
 * light in `:root`, near-black in `.mix` and `.dark`, and every value it draws
 * still goes through `--rail-*`, which is why that swap is a block of CSS and
 * not a change to this file.
 *
 * `surface` is still the caller's, because the pages genuinely disagree about
 * SCROLLING: list pages scroll, the builder does not.
 */
export function AppFrame({
  account,
  workspace,
  views,
  surface,
  hide,
  ownsMain = false,
  children,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /** The workspace's own name — shown beside its avatar in the rail's own head block, not the top bar (see `Sidebar`). */
  workspace?: string;
  /**
   * The workspace's dashboard views, for the rail's nested list under Dashboard.
   *
   * A PASS-THROUGH, resolved in the shell rather than by each page, because
   * this is NAVIGATION and has to be the same on every route. `navViews` is
   * per-request cached so the dashboard does not pay for it twice; see that
   * file.
   */
  views?: BoardView[];
  surface: string;
  /** Rail items (by label) this viewer shouldn't see; AppShell decides. */
  hide?: string[];
  /*
   * `railPinned` retired with the hover rail on 8 September 2026. It was a
   * pass-through for a cookie `AppShell` read on the server, because a pinned
   * rail is 260px of the LAYOUT rather than an overlay and discovering that a
   * frame late would drag the top bar and the page sideways on every load.
   * The column is now always 260px, so there is nothing to know during render.
   */
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
  /**
   * THE CORNER MOVED OUT OF THIS STRING, AND IT IS NOW FOUR CORNERS.
   *
   * It used to be `md:rounded-tr-frame` right here — ONE corner, the top-right
   * one, cut into a panel that was otherwise flush to every edge of the
   * viewport. Node 35:6024 draws something different and simpler: the content
   * column carries an 8px gutter on its top, right and bottom, and the panel
   * inside it is an ordinary rounded, hairlined box. So the radius belongs to
   * that box (see the JSX below) rather than to the scroll region, and this
   * string is back to being about SCROLLING, which is all `surface` ever was.
   *
   * `bg-panel` stays here as well as on the box, and that is not redundant:
   * the box paints the ground the corners cut into, and this paints the ground
   * the content scrolls over. They are the same token and would have to be
   * changed together anyway.
   */
  // `min-h-0` joins the list now that the panel is a flex COLUMN child rather
  // than a row one: a column child defaults to `min-height: auto`, refuses to
  // shrink below its content, and the `overflow-y-auto` in `surface` then has
  // nothing to scroll against — the page scrolls instead of the panel, and the
  // top bar leaves the screen with it.
  const className = cn("relative min-h-0 min-w-0 flex-1 bg-panel", surface);

  return (
    // `h-dvh`, not `h-screen` — the dynamic viewport unit, so a phone's
    // address bar sliding away does not leave a strip of `bg-background`
    // showing under the frame. The left/right insets are the same safe-area
    // accommodation on the other two edges: a phone in landscape (or one with
    // a notch) can inset the viewport from either side.
    //
    // A ROW, NOT A COLUMN — AND THAT IS THIS FILE'S SECOND REVERSAL.
    //
    // It was a column: a full-width bar across the top with [rail | panel]
    // underneath. Both 8 September frames draw the other arrangement, and the
    // metadata is unambiguous about it — in 58:5824 the sidebar is
    // `x=0 y=0 260x1200` (the FULL height of the frame) and the top bar is
    // `x=260 y=0 1660x65`, a child of the content column rather than a sibling
    // above it.
    //
    // The difference is visible and was reported as "the navbars are
    // overlapping wrong": with the bar on top, the account cluster sits ABOVE
    // the workspace switcher instead of beside it, and the rail's own top edge
    // starts 60px down the screen where the design has it at zero.
    //
    // The earlier column had a reason, recorded here because it is now dead:
    // "a bar spanning both would put the workspace switcher above the
    // navigation that switches it". That was written when the switcher lived
    // in the BAR. It lives in the rail's head block now, so the bar spans only
    // the content column and the objection has no subject.
    <div
      className="flex h-dvh bg-background"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* THE RAIL, FULL HEIGHT, FIRST IN THE ROW. It owns the whole left edge
          — there is nothing above it — which is why its head block carries the
          workspace switcher at the same y as the bar's account cluster. */}
      <Sidebar hide={hide} views={views} workspace={workspace} account={account} />

      {/* THE CONTENT COLUMN — the 8px GUTTER, and nothing else.
          `min-w-0` is load bearing on a flex child that contains a
          horizontally scrolling tab strip: without it the column refuses to
          shrink below its content and the whole page gains a sideways
          scrollbar.

          THE GUTTER IS THREE-SIDED, AND THE MISSING SIDE IS THE POINT. Node
          35:6024 is `pr-[8px] py-[8px]` with NO left padding, so the panel's
          left edge sits flush against the rail and only its two left corners
          cut into it. Adding `pl-frame` would put a strip of page between rail
          and panel and turn one seam into two.

          IT IS A DESKTOP FACT, hence `md:`. Below `md` there is no rail, the
          panel runs the full width of the viewport, and an 8px gutter with a
          rounded corner against the edge of a phone screen reads as a
          rendering fault rather than as a frame. */}
      <div className="flex min-w-0 flex-1 flex-col md:py-frame md:pr-frame">
        {/* THE PANEL — ONE BOX: cornered, hairlined, and clipping the bars and
            the board inside it.

            `overflow-hidden` IS WHAT MAKES THE CORNER REAL. The top bar paints
            its own `bg-topbar` to the full width of this box, so without a clip
            the white band squares off the two corners it passes through and the
            radius draws on nothing. Everything that has to escape the panel
            already portals to `<body>` — every popover, dropdown, dialog and
            tooltip in the kit — and the one inline overlay in the chrome
            (`NavSearch`'s result list) drops 4px below a field at the top of
            this box, nowhere near an edge.

            `bg-panel` here as well as on the scroll region: this is the ground
            the corners cut INTO, and a transparent box would show the page
            through its own rounding. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel md:rounded-frame md:border md:border-border">
          {/* THE DRAWER IS BUILT HERE BECAUSE THIS IS WHERE THE NAVIGATION DATA
              IS. `AppFrame` already holds the workspace, the account, the view
              list and `hide`; the bar holds none of them and should not start.
              Below `md` this is the only way into any of it — the rail is not
              rendered at all. */}
          {/* THE BAR TAKES ONLY THE DRAWER NOW. It used to be handed the
              account, the view list and `hide` as well, because it carried a
              search field and an avatar; both moved into the rail on 10 Sep
              2026 (nodes 35:5931 and 35:6000), so the data goes only where it
              is drawn. The drawer stays a prop because it is built HERE, where
              the navigation data already is — the bar holds none of it. */}
          <TopBar menu={<MobileDrawer hide={hide} views={views} workspace={workspace} account={account} />} />
          {/* `min-h-0` is the vertical twin of the `min-w-0` above: without it a
              flex column with a scrolling child never shrinks past its content's
              natural height, and the panel's `overflow-y-auto` never gets
              anything to scroll AGAINST. */}
          {ownsMain ? (
            <main id="main" className={className}>
              {children}
            </main>
          ) : (
            <div className={className}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
