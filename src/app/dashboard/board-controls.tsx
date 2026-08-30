"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy as CopyIcon, MoreHorizontal, PenLine, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/flow/controls/Popover";
import { deleteViewAction, duplicateViewAction, renameViewAction } from "./board-actions";
import { MENU_ROW } from "./board-tile-menu";
import { BOARD_GRID } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { COLUMN_W, LANE_GAP } from "./board-shape";
import { canvasCells, type GridBox } from "@/lib/board/grid";

/**
 * THE BOARD'S FILTERS, ANSWERING IMMEDIATELY.
 *
 * The range and the source live in the URL, which is right — a board someone
 * shares should open on what they were looking at. But they were plain links,
 * and a link to a `force-dynamic` page that recomputes classic metrics is one
 * to two seconds of NOTHING: the pill you pressed stayed grey, the old numbers
 * sat there looking current, and the only feedback was the browser's own
 * loading bar. Pressed twice, which is how a slow interface teaches people to
 * distrust it.
 *
 * Nothing here makes the server faster. What it changes is who waits for it:
 *
 *   - the pill you pressed goes active on the press, before anything is sent;
 *   - the tiles become skeletons at the same instant, so the numbers underneath
 *     stop claiming to answer a question nobody asked any more;
 *   - the URL still updates, so the back button and a shared link both work.
 *
 * `useTransition` is what makes that safe rather than a lie: React keeps the
 * old screen mounted while the next one is fetched, so the optimistic pill is
 * only ever shown for exactly as long as `isPending`. The moment the server's
 * answer lands, the server's own `activeRange` takes over — there is no local
 * copy of the truth to drift.
 */
/**
 * WHICH CONTROL IS MID-PRESS — the dimension as well as the value.
 *
 * This was a bare `string`, shared by the range pills and the view tabs, and
 * the sharing was the bug: pressing a view tab set `picked` to a view id, the
 * range pills compared that id against "7d" and "yesterday", none matched, and
 * every range pill went dark for the length of the navigation. Reported as
 * "the timeline thing stops being selected for a second when swapping views".
 *
 * It also swallowed the DEFAULT view, whose key is the empty string: `if
 * (rangeKey)` is false for "", so pressing "Dashboard" left the previous pick
 * in place and lit the wrong tab on the way there.
 *
 * A control now trusts the optimistic value only when it is the one that was
 * pressed, which is the rule the whole file already believed it followed.
 */
export type PickDim = "range" | "source" | "view";
type Pick = { dim: PickDim; key: string };
type BoardCtx = { pending: boolean; go: (href: string, pick?: Pick) => void; picked: Pick | null };

const Ctx = createContext<BoardCtx | null>(null);

function useBoard(): BoardCtx {
  const ctx = useContext(Ctx);
  // A hard error rather than a silent no-op: the pills and the tile area only
  // work as a pair, and a stray one outside the provider would render as an
  // ordinary link that never shows a pending state — a regression nobody sees.
  if (!ctx) throw new Error("Board controls must be rendered inside <BoardControls>.");
  return ctx;
}

export function BoardControls({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Pick | null>(null);

  const go = (href: string, pick?: Pick) => {
    // `?? null` and not `if (pick)`: a press with no dimension (the source
    // menu) must CLEAR the last one, or a stale pick outlives its navigation.
    setPicked(pick ?? null);
    startTransition(() => {
      // `scroll: false`: this is a filter, not a navigation. Jumping to the top
      // of the page after changing the range loses the reader's place on a
      // board they were half-way down.
      router.push(href, { scroll: false });
    });
  };

  return <Ctx.Provider value={{ pending, go, picked }}>{children}</Ctx.Provider>;
}

/**
 * One range pill. It is still an `<a>` with a real `href` — middle-click,
 * copy-link and "open in new tab" all keep working, and a viewer with no
 * JavaScript gets the plain navigation this replaces.
 */
export function RangeLink({
  href,
  rangeKey,
  activeRange,
  className,
  activeClassName,
  idleClassName,
  children,
}: {
  href: string;
  rangeKey: string;
  /** The range the SERVER rendered — the truth, once the transition settles. */
  activeRange: string;
  className: string;
  activeClassName: string;
  idleClassName: string;
  children: ReactNode;
}) {
  const { pending, go, picked } = useBoard();
  // The optimistic answer is only trusted WHILE the transition is in flight.
  // Once it settles, the server's value is the only one on screen — so a failed
  // or redirected navigation cannot leave a pill lit for a range nobody is
  // looking at.
  const active = (pending && picked?.dim === "range" ? picked.key : activeRange) === rangeKey;
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      onClick={(e) => {
        // Let the browser handle every click that means "somewhere else":
        // new tab, new window, download, or a non-primary button.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        go(href, { dim: "range", key: rangeKey });
      }}
      className={cn(className, active ? activeClassName : idleClassName)}
    >
      {children}
    </a>
  );
}

/**
 * A link inside the source menu. Same transition, and it closes the `<details>`
 * it was chosen from — the menu is a disclosure, and one left hanging open over
 * a board that is already reloading reads as a click that missed.
 */
export function SourceLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { go } = useBoard();
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        go(href);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * ONE TAB IN THE VIEW STRIP.
 *
 * A real `<a href>` for the same reasons the range pills are: the view lives in
 * the URL, so back and forward work and a link pasted into Slack opens on the
 * view the sender was looking at. What the transition adds is that the press
 * LANDS immediately — the tab lights and the board becomes skeletons while the
 * server re-renders, instead of a second of nothing under a tab that has not
 * moved yet.
 */
export function ViewTab({
  href,
  viewId,
  activeView,
  canEdit,
  defaultHref,
  children,
}: {
  href: string;
  /** `null` is the default view, which has no row and no `?view=` in the URL. */
  viewId: string | null;
  activeView: string | null;
  /** Rename and delete are gated on the same permission as everything else. */
  canEdit: boolean;
  /** Where to land after deleting the view you are standing on. */
  defaultHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { pending, go, picked } = useBoard();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Shown instead of the server's name until the refresh carrying it lands. */
  const [renamed, setRenamed] = useState<string | null>(null);
  /** The one place a view write can refuse: a cap. Said in the menu, where the press was. */
  const [error, setError] = useState<string | null>(null);

  const key = viewId ?? "";
  // The optimistic answer is trusted only WHILE the transition is in flight,
  // and only when THIS dimension is the one mid-press — see PickDim.
  const active = (pending && picked?.dim === "view" ? picked.key : (activeView ?? "")) === key;
  const name = renamed ?? (typeof children === "string" ? children : "");

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name is a tab with no handle. Snapping back says nothing
    // happened, which is true, rather than raising an error about a field the
    // customer has already left. The board-column rename does the same.
    //
    // `!viewId` is deliberately NOT a bail: null is the default board before it
    // has a row, and renaming it is what mints one. The action takes null and
    // adopts; `router.refresh()` below brings the tab back carrying an id.
    if (!next || next === name) return;
    setRenamed(next);
    setMenuOpen(false);
    void renameViewAction(viewId, next)
      .then((r) => {
        if (!r.ok) setRenamed(null);
        router.refresh();
      })
      .catch(() => setRenamed(null));
  };

  /**
   * A COPY TO EXPERIMENT ON — and YOU LAND ON THE COPY.
   *
   * That last part is the whole point rather than a nicety: duplicating exists
   * so a shared board can be rearranged without anybody watching, and leaving
   * the customer standing on the original means their next drag lands on the
   * one thing they were trying not to touch. The push carries the optimistic
   * pick so the new tab reads as selected before the refresh arrives.
   */
  const duplicate = () => {
    if (!viewId) return;
    setBusy(true);
    setError(null);
    void duplicateViewAction(viewId)
      .then((r) => {
        setBusy(false);
        if (!r.ok) return setError(r.error);
        setMenuOpen(false);
        // Built from THIS tab's own href so every other search param — the
        // range pill, the source filter — survives the move.
        const url = new URL(href, "http://local");
        url.searchParams.set("view", r.viewId);
        go(`${url.pathname}${url.search}`, { dim: "view", key: r.viewId });
      })
      .catch(() => {
        setBusy(false);
        setError("Couldn't copy that view — the page may be out of date. Reload and try again.");
      });
  };

  const remove = () => {
    if (!viewId) return;
    setBusy(true);
    void deleteViewAction(viewId)
      .then((r) => {
        setBusy(false);
        setMenuOpen(false);
        if (!r.ok) return;
        // Standing on the view that just went away, so leave before the
        // refresh does it abruptly. Deleting an OTHER tab keeps you put.
        if (active) go(defaultHref, { dim: "view", key: "" });
        else router.refresh();
      })
      .catch(() => setBusy(false));
  };

  /**
   * THE MENU BELONGS TO THE TAB YOU ARE ON.
   *
   * Notion's rule, and it is the right one for a reason beyond imitation: a
   * kebab on every tab is a row of dots competing with the names, and one that
   * appears on hover makes every tab change width as the pointer crosses it.
   *
   * THE DEFAULT VIEW HAS ONE NOW. It used to be excluded on the grounds that it
   * had "no row to rename or delete" — true of delete, and no longer true of
   * rename, which is what mints the row. So the menu appears, and the two acts
   * that genuinely need a row to point at are the ones withheld until there is
   * one: see `hasRow` below.
   */
  const editable = canEdit && active;
  /**
   * Duplicate and delete need something to copy or destroy, and before adoption
   * the default board is the ABSENCE of a row — there is no id to hand either
   * action. Rename is the one that changes that, so it is the one offered first.
   * A press on it turns this tab into an ordinary view and the other two appear
   * on the next render.
   */
  const hasRow = viewId != null;

  return (
    <span
      // `scripts/board-drag-check.mjs` proves the view strip shares a row with
      // New group. It found this by scanning `span, a` for the exact text
      // "Dashboard" — so both the element type and the copy were load-bearing.
      data-view-tab
      /**
       * A TAB IS UNDERLINED NOW, AND THE PERIOD KEEPS THE VIOLET.
       *
       * The two rows still answer two different questions — the period narrows
       * WHICH NUMBERS, the tabs choose WHICH ARRANGEMENT — so they still have
       * to be marked differently. What swapped is which one gets the fill.
       * Violet moved UP to the period pills, where it is the app's selection
       * colour sitting in a segmented track; the tab takes the green rule,
       * because a tab is not a selected object, it is a place in a document,
       * and every product that has this row draws it as a rule.
       *
       * The colour is `--tab-underline`, one value in both themes on purpose.
       * That is affordable ONLY because the underline is never the sole mark:
       * the active tab is also the one set in `--ground-ink` while its
       * neighbours sit muted. It measures 9.02:1 on the dark ground and 1.78:1
       * on the light one — see the token's own note. If this row ever loses the
       * weight-and-ink change, the rule alone cannot carry the state.
       *
       * `border-b-3` sits on the wrapper rather than on the anchor so the
       * kebab, which is a sibling inside this span, rides the same rule instead
       * of hanging off the end of a shorter one.
       *
       * THREE PIXELS, AND CLOSER TO THE WORD. At 2px, eight below the label,
       * the rule was thinner than the tint under the period pills sitting one
       * row above it and read as a hairline the tab happened to be standing on
       * rather than as the mark of where you are. A tab's underline is the only
       * thing on this row carrying the state, so it has to be the heavier of the
       * two lines, and it has to belong to the word: the anchor's bottom padding
       * drops from 8px to 4px (`pb-1`, keeping `pt-2`), which pulls the rule up
       * under the label without moving the label itself — the row's height is
       * set by the 24px gap and the kebab beside it, not by this padding.
       */
      /**
       * THE WEIGHT WAS THE WRONG WAY ROUND, and the note above is what makes
       * that a defect rather than a preference.
       *
       * It argues the green rule is affordable at 1.78:1 on the light ground
       * "ONLY because the underline is never the sole mark: the active tab is
       * also the one set in `--ground-ink` while its neighbours sit muted."
       * True of the ink. The WEIGHT ran the other way — active at 500, inactive
       * at 600 — so on the light theme the five tabs you are not on were the
       * boldest words in the row, and the one you were on was the lightest.
       * Measured in the browser, not inferred: active w500, neighbours w600.
       *
       * Now the active tab is the heavier of the two, which is the direction
       * every other selected thing in the product runs.
       */
      className={cn(
        "inline-flex shrink-0 items-center border-b-3 text-sm transition-colors duration-(--duration-fast)",
        active
          ? "border-tab-underline font-semibold text-ground-ink"
          : "border-transparent font-medium text-muted-foreground hover:text-ground-ink",
      )}
    >
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label={`Rename ${name}`}
          className="h-7 w-28 px-2 py-0 text-sm font-semibold"
        />
      ) : (
        <a
          href={href}
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            go(href, { dim: "view", key });
          }}
          /* 8px above, 4px below, 4px either side. Narrow horizontally on
             purpose: a tab's hit area is its LABEL plus the rule under it, so
             padding here only pushes the names apart and the 24px row gap
             already does that.
             4px top AND bottom, and the symmetry is the point. The underline
             sits UNDER THE WORD at 4px rather than floating a line below it —
             see the note on `border-b-3` above — but the padding also has to be
             EQUAL, because the row this tab lives on centres its two halves
             against each other. With 8px above and 4px below, the box centre
             and the text centre were 2px apart, so centring the boxes left the
             labels visibly off from the action pills beside them. Equal padding
             makes the two centres the same point.
             The transparent 3px TOP border is the other half of that: the
             underline is a bottom border, so it lengthens the box downward
             only, and equal padding inside an unequal box still leaves the text
             1.5px high. A matching invisible border on top restores the
             symmetry without drawing anything.
             It is spelled on the anchor, which every tab renders, so active and
             idle labels stay on one baseline; putting it on the active branch
             alone would make the row twitch by 4px each time you changed
             views. */
          className={cn("inline-flex items-center gap-1.5 border-t-3 border-t-transparent px-1 py-1", editable && "pr-0.5")}
        >
          {renamed ?? children}
        </a>
      )}

      {editable && !editing && (
        <Popover
          open={menuOpen}
          setOpen={(o) => {
            setMenuOpen(o);
            if (!o) setConfirming(false);
          }}
          /* Fixed for the same reason the column kebab is: the strip sits in a
             row that can clip, and a menu cut off at its edge loses Delete. */
          fixed
          align="right"
          width={216}
          anchor={
            <Button
              variant="ghost"
              size="iconSm"
              /* `editable` is gated on `active`, so this trigger only ever
                 exists on the tab that is filled violet — hence no conditional
                 here. The ghost's own grey ink and grey hover wash would both
                 disappear into that fill, so it takes the fill's foreground and
                 hovers by lightening the violet rather than by painting a
                 neutral square on top of it. */
              /* NOT `primary-foreground`. That is white, and it belongs on a
                     violet FILL — which this tab has not had since the active
                     state became an underline on the page itself. White at 75%
                     over `#f5f5f5` composites to ~`#fcfcfc`: 1.05:1, a kebab
                     you cannot see in the light theme at all. It read fine in
                     dark, which is exactly why it survived. The row's own ink
                     is the right answer and it follows the theme. */
                  className="mr-0.5 size-6 text-ground-ink-muted hover:bg-foreground/10 hover:text-ground-ink"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={`Options for ${name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal />
            </Button>
          }
        >
          <div className="cursor-default p-1.5">
            <Button
              variant="ghost"
              size="sm"
              className={MENU_ROW}
              onClick={() => {
                setDraft(name);
                setEditing(true);
                setMenuOpen(false);
              }}
            >
              <PenLine />
              Rename
            </Button>

            {/* DUPLICATE AND DELETE NEED A ROW TO POINT AT, and the default
                board has none until it is renamed — there is no id to hand
                either action. Hiding them is the honest answer: a disabled
                control advertising something the interface will refuse is
                worse than one that is not there yet, and Rename, which is
                sitting directly above, is the press that brings them. */}
            {hasRow && (
              <Button
                variant="ghost"
                size="sm"
                className={MENU_ROW}
                disabled={busy}
                onClick={duplicate}
              >
                <CopyIcon />
                Duplicate
              </Button>
            )}

            {error && (
              <p role="alert" className="px-1.5 py-1 text-xs text-danger-ink">
                {error}
              </p>
            )}

            {hasRow && <div className="my-1.5 h-px bg-border" />}

            {!hasRow ? null : confirming ? (
              /* INLINE, not a modal — the RanksPanel precedent. The sentence
                 says what survives, because "delete view" one inch from a
                 board full of numbers reads like it might take them with it.
                 It never does. */
              <div className="px-1.5 py-1">
                <p className="text-xs text-muted-foreground">
                  Delete this view? Its columns go with it. Your metrics stay on the board.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button variant="destructive" size="sm" disabled={busy} onClick={remove}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="destructiveGhost"
                size="sm"
                className={MENU_ROW}
                onClick={() => setConfirming(true)}
              >
                <Trash2 />
                Delete view
              </Button>
            )}
          </div>
        </Popover>
      )}
    </span>
  );
}

/**
 * THE PAGE TITLE IS THE VIEW'S OWN NAME, AND YOU CAN TYPE IN IT.
 *
 * NO NEW STORE, AND THAT IS THE POINT. A view has had a `name` since the strip
 * existed — it is the word on the tab — and `renameViewAction` has always
 * written it. The h1 was a hard-coded "Dashboard" sitting an inch above a tab
 * saying something else, so a workspace that renamed "View 2" to "Revenue" got
 * a page headed Dashboard with Revenue underlined beneath it. One fact, one
 * place it is stored, two places it is shown.
 *
 * THE DEFAULT VIEW IS NOT EDITABLE, and that is a property of the data rather
 * than a policy: it has no row (see the schema note on `dashboard_views` — the
 * default board is the ABSENCE of a view), so there is nothing to write a name
 * to. Shipping a field here that accepted a name and dropped it on reload is
 * precisely the thing not to do, so the default view's title stays static text.
 * It is the same rule the tab kebab already follows one row down.
 *
 * The commit behaviour is `BoardColumn`'s rename, copied deliberately: blur or
 * Enter commits, Escape abandons, and an EMPTY name snaps back rather than
 * raising an error about a field the customer has already walked away from.
 * "Untitled" is the fallback for a name that is somehow blank — it is never
 * what a rename can store, because `nameSchema` refuses it.
 *
 * `renamed` is the optimistic value, held only until the `router.refresh()`
 * carrying the server's own name lands; a refusal clears it and the real name
 * comes back. The page keys this component by the active view, so the value
 * cannot outlive the view it was typed into.
 */
export function ViewTitle({
  viewId,
  name,
  canEdit,
}: {
  /**
   * `null` is the default view while it is still the absence of a row. It IS
   * renameable now — the first commit adopts it into a real row server-side (see
   * `adoptDefaultView`), and `router.refresh()` brings back a tab carrying an
   * id. Nothing here has to know which of the two happened.
   */
  viewId: string | null;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [renamed, setRenamed] = useState<string | null>(null);

  const shown = (renamed ?? name).trim() || "Untitled";

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // `!viewId` is NOT a bail any more — null is the un-adopted default board,
    // and renaming it is exactly what mints its row. An empty name still is:
    // snapping back says nothing happened, which is true, rather than raising an
    // error about a field the customer has already left.
    if (!next || next === shown) return setDraft(shown);
    setRenamed(next);
    void renameViewAction(viewId, next)
      .then((r) => {
        if (!r.ok) setRenamed(null);
        // The tab strip renders the same name from the server's copy, so this
        // is what stops the header and the tab disagreeing until the next poll.
        router.refresh();
      })
      .catch(() => setRenamed(null));
  };

  if (!canEdit) return <>{shown}</>;

  /**
   * THE TITLE'S TYPE — `PageHeader`'s h1 recipe, verbatim.
   *
   * IT USED TO BE A DIFFERENT SIZE FROM THE TITLE IT REPLACES, which is the
   * bug. Twelve lines up, the default view returns bare text and inherits the
   * h1 it is sitting in — `text-display-sm`, 30px. Every OTHER view came
   * through here at `display-xs`, 24px. So the page's title changed size as you
   * moved between tabs, in the one slot on the screen that names where you are,
   * and nothing reported it because both steps are legal.
   *
   * THE ARBITRARY SPELLING IS GONE WITH IT. It was here because `cn()` could
   * not resolve a kit type name against `Button`'s own `text-sm` — tailwind
   * -merge read our names as colours, so both survived and alphabetical order
   * handed `.text-sm` the win. That was true of the LEGACY names; `lib/utils.ts`
   * registers the `display-*` steps, so the named class now beats the
   * primitive's base outright. Pinned by tests/cn-merge.test.ts, which asserts
   * exactly this pair rather than trusting the claim.
   *
   * No `leading-8` either: the named step carries the token's own line-height,
   * where the arbitrary form set the size alone and needed one supplied.
   */
  const TITLE_TYPE = "font-display text-display-sm font-semibold";

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(shown);
            setEditing(false);
          }
        }}
        aria-label={`Rename ${shown}`}
        className={`h-auto max-w-md px-2 py-0.5 ${TITLE_TYPE}`}
      />
    );
  }

  return (
    /* IT IS A BUTTON, because the affordance is that the title is the thing you
       press to change it — `BoardColumn`'s group name, one level down, is the
       same control for the same reason. Pulled left by its own padding so the
       words still line up with the subtitle under them, the way `PageHeader`'s
       back link is.
       The hover wash is an alpha of `--ground-ink` rather than the ghost
       variant's `bg-muted`: `--muted` and the light page are the same off-white,
       so the stock ghost would answer the pointer with nothing on exactly the
       surface this title lives on. An alpha of the page's own ink reads in both
       themes and needs no second token. */
    <Button
      variant="ghost"
      onClick={() => {
        setDraft(shown);
        setEditing(true);
      }}
      title="Rename this view"
      className={`-mx-2 h-auto min-w-0 max-w-full justify-start px-2 py-0.5 ${TITLE_TYPE} text-ground-ink hover:bg-ground-ink/10 hover:text-ground-ink active:bg-ground-ink/15`}
    >
      <span className="truncate">{shown}</span>
    </Button>
  );
}

/**
 * The tiles, or their shape while the next set is on its way.
 *
 * SKELETONS RATHER THAN A DIMMED COPY. Fading the old numbers keeps them
 * legible, and a legible number under a pill that now says "Today" is a WRONG
 * number being shown confidently — the one failure this whole file exists to
 * prevent. Cards of the same size, in the same grid, say "this is being
 * answered" without answering it.
 *
 * `count` is how many tiles the board is currently showing, so the page does
 * not change height while it waits and the scroll position stays put.
 *
 * `columns` is how many the board is ARRANGED into. A dashboard with groups is
 * a set of columns, not a three-up grid, so a grid of skeletons over it would
 * reshape the page for half a second and reshape it back — which is the jump
 * the count is there to prevent, arriving by the other door. Absent (or zero)
 * means no groups, and the grid is right.
 */
export function TileArea({
  count,
  columns,
  canvas,
  children,
}: {
  count: number;
  columns?: number;
  /**
   * The CANVAS's own boxes, when the active view is a custom one.
   *
   * A third shape, for the reason the second one exists. `columns` is zero on a
   * canvas — it has no groups — so without this a range press would swap a grid
   * of placed charts for a three-up column of skeletons and swap it back, which
   * is precisely the "it changes height and stuff" this component was already
   * fixed for once. Skeletons at the STORED footprints keep every box where it
   * was, so only the numbers inside them change.
   */
  canvas?: GridBox[];
  children: ReactNode;
}) {
  const { pending, picked } = useBoard();
  /**
   * A VIEW SWITCH GETS A WASH, NOT A SKELETON — and it used to get nothing.
   *
   * `answering()` is still false for a view, so the real tiles stay mounted:
   * skeletoning here is what blanked the caption, collapsed the board and
   * repainted twice, and that argument holds. But "hold the tiles still" was
   * implemented as "change nothing at all", so pressing a tab moved the pill
   * and then sat there for the length of a full server round trip with no sign
   * anything had been heard. That is the whole of "it takes a solid second".
   *
   * Opacity shifts no box by a pixel, costs no reflow, and says the true thing:
   * this arrangement is being replaced. It also covers the range press's own
   * gap between the pill lighting up and the skeletons arriving.
   */
  if (!pending || !answering(picked)) {
    return (
      <div
        aria-busy={pending || undefined}
        className={cn("transition-opacity duration-(--duration-fast)", pending && "pointer-events-none opacity-55")}
      >
        {children}
      </div>
    );
  }
  if (canvas && canvas.length > 0) {
    return (
      <div className="board-canvas mt-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading metrics…</span>
        {canvasCells(canvas).map(({ tile, vars }) => (
          <div key={tile.id} className="board-cell" style={vars as React.CSSProperties}>
            <div className="h-full rounded-surface border border-border bg-card p-5 shadow-card">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-3 h-9 w-1/2" />
              <Skeleton className="mt-3 h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (columns && columns > 0) {
    return (
      <div className={`mt-4 flex items-start ${LANE_GAP} overflow-hidden`} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading metrics…</span>
        {Array.from({ length: columns }, (_, c) => (
          <div key={c} className={`${COLUMN_W} shrink-0`}>
            {/* THE COLUMN'S OWN SHAPE, not a bare stack of cards.
                A column is a tinted panel capped by an accent bar with its
                header INSIDE it, so a skeleton that drew loose cards under a
                floating label swapped the board's whole geometry for half a
                second and swapped it back — the reshaping this component exists
                to prevent, arriving one layer down. Untinted, because the
                skeleton cannot know which group is which and inventing a colour
                per placeholder would be a guess the real board then contradicts. */}
            <div className="overflow-hidden rounded-card bg-foreground/[0.04]">
              <div className="h-1 w-full bg-foreground/10" />
              <div className="flex h-11 items-center gap-2 px-2.5">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className={`flex flex-col px-2.5 pb-2.5 ${LANE_GAP}`}>
                {Array.from({ length: Math.max(1, Math.round(count / columns)) }, (_, i) => (
                  <TileSkeleton key={i} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`mt-4 items-start ${BOARD_GRID}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading metrics…</span>
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        // The tile's own anatomy: a title line, the numeral, a mark, a footer.
        // A plain grey block is a placeholder for "something"; this is a
        // placeholder for a tile, so nothing moves when the real one lands.
        <TileSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * The tile's own anatomy: a title line, the numeral, a mark, a footer.
 *
 * A plain grey block is a placeholder for "something"; this is a placeholder
 * for a TILE, so nothing moves when the real one lands. One spelling, used by
 * both shapes above, or the grid and the board would drift apart in the one
 * state nobody looks at twice.
 */
function TileSkeleton() {
  return (
    <div className="rounded-surface border border-border bg-card p-5 shadow-card">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="mt-3 h-9 w-1/2" />
      <Skeleton className="mt-3 h-10 w-full" />
      <Skeleton className="mt-3 h-3 w-1/3" />
    </div>
  );
}

/**
 * IS THE NAVIGATION IN FLIGHT GOING TO CHANGE ANY NUMBER?
 *
 * The range and the source do: every tile is about to answer a different
 * question, so leaving the old figures legible under a pill that now says
 * "Today" is a wrong number shown confidently, and the skeletons are the fix.
 *
 * A VIEW SWITCH CHANGES NO NUMBER AT ALL. It is the same metrics in a different
 * arrangement — a Notion view, doing what Notion views do. Skeletoning there
 * bought nothing and cost three things at once, all of them reported: the
 * caption blanked ("some text removes"), the board collapsed into placeholder
 * cards and back ("it changes height and stuff"), and the whole thing had to
 * repaint twice to arrive where it started. Holding the real tiles still while
 * the server re-arranges them is both calmer AND more honest, because the
 * numbers under the new tab are the numbers that were under the old one.
 */
function answering(picked: Pick | null): boolean {
  return picked?.dim !== "view";
}
