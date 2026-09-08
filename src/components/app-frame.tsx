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
 * TWO MATERIALS, AND ONLY ONE OF THEM HAS A THEME. The rail and the bar are
 * `--chrome`, which is #121214 in BOTH themes — 49:5268 and 58:5824 draw that
 * band identically and only the content beside it goes light. The panel is
 * `--panel`, which does flip. That is why the chrome has its own ink, hairline
 * and control roles (`--chrome-*`): it cannot borrow the content's, because it
 * is not on the content's ground.
 *
 * THE NOTCH IS 0 AGAIN. `--radius-frame` cuts the panel's top-RIGHT corner —
 * the far one, under the bar, which reversed this file's own convention when
 * the 4 September Figma drew it there. It reveals whatever is behind it, and
 * page, chrome and panel are one colour on dark now, so it reveals nothing.
 * The spelling stays for the day the surfaces separate again.
 *
 * `surface` is still the caller's, because the pages genuinely disagree about
 * SCROLLING: list pages scroll, the builder does not.
 */
export function AppFrame({
  account,
  workspace,
  accountName,
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
   * The signed-in person's name, for the top bar's account cluster.
   *
   * A PASS-THROUGH the shell is the only place that can fill: it is the one
   * component in the frame that has already resolved the session and read the
   * profile. It was `firstName` and went unpassed for three re-themes — see
   * the note on `TopBar`'s own prop.
   */
  accountName?: string;
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
   * THE CORNER IS A DESKTOP FACT. It reveals the page behind the panel where
   * the bar's rule ends and the rail's begins — and below `md` there is no
   * rail, so the panel runs the full width of the viewport and the only thing
   * an 8px notch could reveal is the 8px of `--background` outside it. A
   * rounded corner against the edge of a phone screen reads as a rendering
   * fault, which is the same argument that took the notch off when the
   * surfaces were one colour, in a different axis.
   *
   * `md:rounded-tr-frame bg-panel` in that order on purpose: the pair is
   * matched as a literal by `tests/page-width.test.ts`, on both sides of the
   * frame/skeleton mirror.
   */
  // `min-h-0` joins the list now that the panel is a flex COLUMN child rather
  // than a row one: a column child defaults to `min-height: auto`, refuses to
  // shrink below its content, and the `overflow-y-auto` in `surface` then has
  // nothing to scroll against — the page scrolls instead of the panel, and the
  // top bar leaves the screen with it.
  const className = cn("relative min-h-0 min-w-0 flex-1 md:rounded-tr-frame bg-panel", surface);

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

      {/* THE CONTENT COLUMN — bar, then panel. `min-w-0` is load bearing on a
          flex child that contains a horizontally scrolling tab strip: without
          it the column refuses to shrink below its content and the whole page
          gains a sideways scrollbar. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* THE DRAWER IS BUILT HERE BECAUSE THIS IS WHERE THE NAVIGATION DATA
            IS. `AppFrame` already holds the workspace, the account, the view
            list and `hide`; the bar holds none of them and should not start.
            Below `md` this is the only way into any of it — the rail is not
            rendered at all. */}
        <TopBar
          account={account}
          accountName={accountName}
          menu={<MobileDrawer hide={hide} views={views} workspace={workspace} account={account} />}
        />
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
  );
}
