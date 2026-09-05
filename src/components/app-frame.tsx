import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileDrawer } from "./mobile-drawer";
import { cn } from "@/lib/utils";
import type { BoardView } from "@/lib/board/types";

/**
 * THE FRAME — a full-width bar above a row of [rail | panel].
 *
 * IT USED TO RUN THE OTHER WAY: the rail full height on the left, the bar
 * confined to the content column beside it, on the argument that a bar
 * spanning both would put the workspace switcher above the navigation that
 * switches it. That argument dissolved when the switcher moved OFF the bar
 * and into the rail's own head block (see `Sidebar`) — there is no longer
 * anything in the bar for the rail to sit "above" in that sense, and the
 * Figma this re-theme follows draws one continuous bar across the top with
 * the rail hanging beneath its left end, which is what this file now does.
 *
 * THREE SURFACES, NOT ONE. The bar and the rail are `--chrome`; the panel
 * under them is `--panel`, its own material, which is what gives a corner
 * something to reveal again after two days at `--radius-frame: 0`.
 *
 * IT IS THE TOP-RIGHT CORNER, AND THAT REVERSES THIS FILE'S OWN HISTORY.
 * Every previous era cut the panel's TOP-LEFT — the corner nearest the rail —
 * because the rail was a different material and the notch was how the page
 * wrapped around it. The 4 September Figma does not: the panel butts square
 * against the rail behind a hairline, and the corner it softens is the far
 * one, under the bar at the opposite end of the row. Followed literally
 * rather than corrected toward the old convention, and pinned in
 * `tests/page-width.test.ts` so the convention cannot quietly reassert itself.
 *
 * `surface` is still the caller's, because the pages genuinely disagree about
 * SCROLLING: list pages scroll, the builder does not.
 */
export function AppFrame({
  account,
  workspace,
  firstName,
  views,
  surface,
  hide,
  railPinned,
  ownsMain = false,
  children,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /** The workspace's own name — shown beside its avatar in the rail's own head block, not the top bar (see `Sidebar`). */
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
  /**
   * Whether the rail is pinned open. A pass-through, read from a cookie by
   * `AppShell` — it has to be known during RENDER, because a pinned rail is
   * 260px of the layout rather than an overlay, and discovering that a frame
   * later would drag the top bar and the whole page sideways on every load.
   */
  railPinned?: boolean;
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
   * THE NOTCH IS BACK, ON THE OTHER SIDE — IN DARK. `--radius-frame` went to
   * 0 when the rail, the bar and the page became one `#0F1011`: a radius
   * reveals whatever is BEHIND the element it is cut into, and cutting a
   * corner out of a colour to reveal the same colour draws nothing at the
   * cost of a gap the bar's hairline then has to stop short of. Dark has
   * three surfaces again — the panel is `--panel` (`#181818`), the bar and
   * rail `--chrome` (`#111111`) — so there is something behind the cut there,
   * and the token is 8px.
   *
   * IT IS A DARK-THEME DEVICE, THOUGH, NOT A UNIVERSAL ONE — the spec says so
   * explicitly (amended 5 Sep after the shell review) because this comment
   * did not: in LIGHT, `--panel` is `var(--background)`, both `#F7F8F9`, so
   * the exact failure above is what this corner does to itself there — a
   * colour cut out of the same colour, drawing nothing. That is not a bug to
   * fix; light was never meant to show a seam here, and `md:rounded-tr-frame`
   * costs nothing to leave on where it is invisible.
   *
   * WHICH corner is the part that changed, in dark. Every previous notch was
   * TOP-LEFT, nearest the rail. The 4 September Figma cuts the TOP-RIGHT
   * instead and leaves the rail-side corner square, so that is what this
   * spells.
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
  const className = cn("relative min-w-0 flex-1 md:rounded-tr-frame bg-panel", surface);

  return (
    // `h-dvh`, not `h-screen` — the dynamic viewport unit, so a phone's
    // address bar sliding away does not leave a strip of `bg-background`
    // showing under the frame. The left/right insets below are the same
    // safe-area accommodation, on the other two edges: a phone in landscape
    // (or one with a notch) can inset the viewport from either side, and
    // without these two the bar's own edge-to-edge content would render
    // partly behind the device's own chrome.
    <div
      className="flex h-dvh flex-col bg-background"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* THE BAR SPANS EVERYTHING, ABOVE THE RAIL RATHER THAN BESIDE IT.
          It no longer receives `workspace` — the workspace switcher moved into
          the rail's own head block, and it needs `workspace`/`account` for
          that, not the bar — and it no longer takes a metric count either,
          because the setup ring that was the only reader of it is gone (the
          Figma has no ring; the dashboard's checklist reports the same
          progress). What the bar draws on its own account is the wordmark,
          the greeting and the right-hand cluster. */}
      {/* THE DRAWER IS BUILT HERE BECAUSE THIS IS WHERE THE NAVIGATION DATA
          IS. `AppFrame` already holds the workspace, the account, the view
          list and `hide` for the rail beside it; the bar holds none of them
          and should not start. Below `md` this is the only way into any of
          it — the rail is not rendered at all. */}
      <TopBar
        account={account}
        firstName={firstName}
        menu={<MobileDrawer hide={hide} views={views} workspace={workspace} account={account} />}
      />
      {/* THE ROW BELOW THE BAR — the rail, then the panel. `min-h-0` is load
          bearing: without it a flex row with a scrolling child never shrinks
          past its content's natural height, and the panel's own
          `overflow-y-auto` never gets anything to scroll AGAINST. */}
      <div className="flex min-h-0 flex-1">
        <Sidebar hide={hide} views={views} pinned={railPinned} workspace={workspace} account={account} />
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
