"use client";

import Link from "next/link";
import { Bell, ChevronDown, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — who you are, how much you are tracking, and the two things you
 * start from.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A RESKIN.
 *
 * The bar was 64px of OFF-WHITE, then 70px of charcoal, and it is 56px of
 * `--background` now — the same colour as the rail to its left and the page
 * below it, closed by a 1px hairline that is the only thing separating any of
 * the three. The mark lives in the rail's top block, because a band that says
 * "Namzilabs" in two corners is saying it once too often. What this bar carries
 * instead is the answer to WHICH WORKSPACE and HOW MUCH OF IT IS MEASURED: the
 * workspace avatar, its name, and the metrics ring.
 *
 * 56 = the reference's 40px content row plus 8px of padding top and bottom. The
 * 14px it gives back over the old 70 go to the page, which is the point of a
 * console: the chrome should cost what it costs and not a pixel more.
 *
 * THE SCOPED `dark` CLASS IS GONE, AND ITS WHOLE PROBLEM WENT WITH IT.
 *
 * This header carried `className="dark …"` for one reason. The flow builder
 * PORTALS its entire toolbar into `#topbar-slot` below, and every one of those
 * controls is spelled in roles — `text-foreground`, `bg-card`, `border-border`.
 * On a light document those resolved to near-black ink on a white island, which
 * on a charcoal bar was near-black on near-black: an invisible toolbar on the
 * one screen that cannot function without it. Scoping `dark` re-inked the
 * portal's contents for the surface they actually landed on.
 *
 * The bar is `--background` now and so is everything else, so a role means the
 * same thing on both sides of a portal by construction. There is no surface to
 * warn a subtree about.
 *
 * That also deletes the constraint the rest of this file was written under.
 * Everything the bar drew ITSELF had to be spelled in CONSTANTS — `bg-ink-950`,
 * `bg-white`, `text-neutral-900`, and nine `--chrome-*` roles declared only in
 * `:root` — precisely so the scoped class could not move the bar's own
 * furniture while it re-inked the portal's. All nine of those tokens are
 * retired; this file speaks the same roles as every other file now.
 *
 * ONE GREEN, IN THREE SHAPES. The kit ran "yellow FILLS, violet DRAWS" because
 * #eecf00 is 1.55:1 as a line on white — it could not be both. On this ground
 * the green is 9.83:1 as a stroke and 7.70:1 as a fill, so the bar spends it as
 * a FILL on the hero pill and the unread badge, as a STROKE on the setup ring's
 * arc, and as INK on nothing here at all. The workspace avatar is neutral: it
 * was the one place the marker was allowed to be a fill, because identity is
 * not a control — and with the brand doing every other job on this bar, a
 * coloured avatar would be the fourth green competing with three that are
 * actually pressable.
 */

/** The ring: r=9 in a 24px box, so a 4px stroke sits inside with a pixel spare. */
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * WHERE THE RING STOPS ASKING — six metrics, and the cap is the whole design.
 *
 * The ring is not a percentage of anything: a workspace has no natural
 * denominator, so "3 of the 47 metrics you could theoretically build" is a
 * fraction that only ever shrinks as the product grows. Six is the number at
 * which a workspace is measuring its business rather than trying the product,
 * and past it the ring has nothing left to ask for — ten metrics reads 6/6 and
 * the copy changes from a nudge to an acknowledgement. It is a FLOOR under the
 * praise, not a ceiling on the work.
 */
const METRIC_GOAL = 6;

export function TopBar({
  account,
  workspace,
  firstName,
  metricCount,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /**
   * The active workspace's own name. A DEFAULT rather than a required prop
   * because the frame's membership lookup can come back short, and a bar that
   * throws because WorkOS was slow is worse than a bar that says "Workspace".
   */
  workspace?: string;
  /**
   * The greeting's name. Optional, and the fallback is a greeting with NO name
   * in it — "Welcome back!" — rather than "Welcome back, there!". A product
   * that guesses at your name is worse than one that does not use it.
   */
  firstName?: string;
  /**
   * How many metrics this workspace has — published flow tiles plus classic
   * metrics, already narrowed to what this viewer's rank may see.
   *
   * `undefined` MEANS "NOBODY COUNTED", AND IT IS NOT THE SAME AS ZERO. Only
   * the dashboard resolves this number as part of the work it was already
   * doing; the other nine routes that render `AppShell` never read the metrics
   * table, and a second query there would be a round trip on every page load to
   * fill in a decoration. So the ring STANDS DOWN when the count is missing
   * rather than drawing an empty 0/6 over a workspace with twenty metrics in
   * it — the same rule the address group already follows when the builder
   * supplies no workspace. A ring is a claim; it may only be drawn by someone
   * who knows the answer.
   */
  metricCount?: number;
  /** Unread notifications. Placeholder until notifications have a store. */
  unread?: number;
}) {
  // The workspace's initial for the avatar. `.trim()` first: an org named
  // " Acme" would otherwise render a blank blue square.
  const initial = (workspace ?? "").trim().charAt(0).toUpperCase() || "W";
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
  /**
   * THE CAP IS APPLIED HERE, ONCE, so the arc, the numeral and the fraction
   * cannot disagree. `Math.trunc` before the clamp because a count arriving as
   * a float is a caller bug, and half an arc under a whole numeral is the shape
   * that bug would take on screen. `null` is the "nobody counted" case above,
   * and it is carried as a distinct value rather than collapsed into 0.
   */
  const tracked =
    metricCount == null ? null : Math.max(0, Math.min(Math.trunc(metricCount), METRIC_GOAL));
  const arc = tracked == null ? 0 : (RING_CIRCUMFERENCE * tracked) / METRIC_GOAL;
  /**
   * THE TWO MESSAGES, and the short one is the one at the top.
   *
   * Under the goal it is an IMPERATIVE — the ring is asking for something, and
   * the shortest honest way to ask is to say what to do. At 6/6 there is
   * nothing to ask for, so it stops instructing and simply acknowledges; kept
   * to three words because praise that runs on reads as a product congratulating
   * itself. The count itself is not repeated in here — the fraction is sitting
   * right beside the bubble, and the trigger's `aria-label` carries it for
   * anyone who cannot see it.
   */
  const ringMessage = tracked === METRIC_GOAL ? "You're tracking plenty" : "Track more data";

  // The identity group: avatar, name, chevron. Rendered once and placed either
  // inside a menu trigger or bare, because a CHEVRON IS A PROMISE — the old
  // note in this file put it exactly right, that "a chevron on something that
  // does not open is a promise the bar cannot keep". The account panel is the
  // thing that holds the workspace switcher, so when there is a panel this
  // group opens it and the chevron is honest; when there is no panel (the
  // design route renders the frame without an account) the group is text and
  // the chevron is dropped rather than left pointing at nothing.
  const identity = (
    <>
      {/* THE ONE COLOUR IN THE CHROME THAT IS NEITHER BRAND NOR STATE. It is
          IDENTITY — which workspace you are in — and it is drawn from its own
          role precisely so it can differ per workspace one day without ever
          colliding with selection violet or the yellow hero. A square at the
          control radius, not a disc: the account avatar at the far end of this
          bar is the disc, and two circles side by side would claim to be the
          same kind of object. */}
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-neutral-700 text-xs font-semibold text-foreground"
      >
        {initial}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {/* `font-semibold`, matching the avatar beside it and every other
            heading in the product. It was `font-bold` — a fourth weight, used
            in three places in this file and nowhere else, sitting 100 units
            heavier than the initial it shares a baseline with. The export sets
            this at 700 and it is one of the five places this build deliberately
            does not follow it: the kit's ladder is 400/500/600 and `check:ui`
            fails on the fourth rung. */}
        <span className="truncate text-sm font-medium text-foreground">{workspace}</span>
        {account && <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
      </span>
    </>
  );

  return (
    // 70px, and the height is not arbitrary: the rail's top block is 70px too,
    // so the bar's bottom hairline and the rail's right hairline meet at one
    // corner and the chrome reads as a single seam rather than two edges that
    // nearly line up.
    /* 56px: the reference's 40px content row plus its 8px of padding top and
       bottom. Down from 70, and the 14px it gives back go to the page.

       THE EDGES ARE 24 BOTH SIDES, which is what the reference measures and
       what this bar briefly had before. It went to 24/40 on the argument that
       "the right edge carries four controls and the left carries one address,
       so the busier end gets more air" — a reasonable-sounding rule that the
       reference does not follow and that nothing else in the product does
       either. Every page below this bar is inset 24px on both sides; a header
       whose right edge stood 16px further in than the content beneath it was a
       misalignment you could see down the whole right-hand side of every screen.

       THE BOTTOM RULE IS BACK, AND IT IS NOW THE ONLY THING HOLDING THIS BAR
       UP. It was removed, correctly, when the bar was charcoal: below it was
       the ground at #f5f5f5, so the seam was a 40-point luminance step between
       two different materials, and a rule drawn where two different materials
       already meet is a rule doing nothing. Below it now is #0f1011 — the same
       colour as the bar itself — so without `border-b` there is no seam at all
       and the chrome bleeds into the page. This is the inversion at the centre
       of the re-theme, in one class.

       The prose sits ABOVE the tag deliberately: tests/page-width.test.ts reads
       this bar's height by matching `<header className="…"`, and a comment
       between the two breaks the check that keeps the loading skeleton's band
       the same height as the real one. */
    <header className="flex h-[56px] shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 py-2">
      {/* ── WHERE YOU ARE ───────────────────────────────────────────────────
          Workspace, then a slash, then how much of it you are measuring. It
          reads as a path because it IS one: the workspace is the root and the
          ring is how far into it you have got. */}
      {/* THE ADDRESS, AND IT IS ALL OR NOTHING. Everything in this group —
          the avatar, the name, the slash, the metrics ring — answers "where am
          I". The builder supplies none of it on purpose (no membership fetch
          per editor load), so on that one route the whole group stands down
          rather than inventing a blue "W" for a workspace it never looked up.
          The bar then opens with the portalled toolbar, which is what that
          screen is actually about.

          The ring has its OWN guard inside this one, because the two facts
          arrive from different places: the name comes from the shell's
          membership list and the count from the page's own metric reads, so a
          route can honestly have one and not the other. */}
      {workspace && (
      <div className="flex min-w-0 items-center gap-6">
        {account ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The kit's Button, not a raw one. `-mx-2 px-2` gives the hover
                  wash a shape around the group while leaving the avatar's left
                  edge exactly 24px from the bar's edge — the padding gives back
                  precisely what the negative margin took. */}
              <Button
                variant="ghost"
                // `[&_svg]:size-3` is not decoration: the size variant ships
                // `[&_svg]:size-[18px]`, and a descendant rule beats the
                // chevron's own `size-3` on specificity no matter which order
                // they are written in. Overriding at the same level is the only
                // spelling that actually lands.
                className="-mx-2 h-auto min-w-0 gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-neutral-700 active:bg-neutral-700 [&_svg]:size-3"
                aria-label={`${workspace} — workspace and account`}
              >
                {identity}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 p-0">
              {account.panel}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="flex min-w-0 items-center gap-2.5">{identity}</span>
        )}

        {/* ── HOW MUCH IS MEASURED ────────────────────────────────────────
            THE SLASH AND THE RING ARE ONE OCCUPANT, which is why they share a
            guard. The slash is a real slash rather than a hairline because the
            two things either side of it are levels of one address, not two
            unrelated groups — so with nothing on its right it is not a
            separator, it is a dangling mark at the end of a workspace name.
            `aria-hidden`: a screen reader announcing "slash" between a name and
            a fraction is noise.

            IT GOES WHEN THE COUNT DOES, and the count is missing on every route
            but the dashboard — see `metricCount` above for why nobody else pays
            a query for it. The same rule already governed the group as a whole:
            the builder renders `AppFrame` with no workspace, deliberately, to
            avoid a WorkOS membership fetch on every editor load, and the bar
            that was already fighting for width there stopped spending ~250px on
            a blue "W" and a ring about a workspace it had not looked up. No
            answer, no ring.

            A RING AND A FRACTION SAYING THE SAME NUMBER TWICE, deliberately:
            the ring is the thing you notice from across the room and the
            fraction is the thing you read. The arc is drawn from the VALUE —
            `strokeDashoffset` is the circumference minus the tracked share of
            it — so three metrics is half a ring and six is a closed one, with
            no static shape anywhere in the file to fall out of step. At 0 it is
            a bare track, which is what an unmeasured workspace should look
            like. */}
        {tracked != null && (
          <>
            <span aria-hidden className="text-sm font-light text-muted-foreground">
              /
            </span>

            {/* THE KIT'S TOOLTIP, NOT A `title`. This carried
                `title="Setup steps completed"`, which is the one hint mechanism
                that reaches neither a touch user (no hover to trigger it) nor a
                keyboard user (no focus to trigger it) — so the message existed
                for exactly the audience least likely to need it. Radix opens on
                hover AND on focus, and the trigger is a tab stop, so the ring
                explains itself by pointer, by key and by screen reader.

                `tabIndex`/`role="img"` because the ring DOES NOTHING when
                pressed. This bar already argues that a chevron on something
                that does not open is a promise it cannot keep; a Button here
                would be the same broken promise with a hover wash on it. A
                focusable image is the honest spelling: it has a name, it takes
                focus so the bubble can be summoned, and it claims no action.
                `role="img"` also collapses the subtree, so the numeral inside
                the ring and the fraction beside it are announced once as the
                label rather than as "0, 0 of 6".

                THE RING IT TAKES IS THE PRODUCT'S OWN. This carried
                `focus-ring-light` — a sanctioned white twin — because `--ring`
                was violet and invisible against a charcoal band. `--ring` is
                the brand green at 9.83:1 on this exact surface now, so the twin
                is retired and the global rule in globals.css already selects
                `[tabindex]`: the outline lands without this element spelling
                one. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={`${tracked} of ${METRIC_GOAL} metrics tracked`}
                  className="flex shrink-0 items-center gap-2 rounded-[var(--radius-control)]"
                >
                  <span className="relative flex size-6 items-center justify-center">
                    {/* `-rotate-90` starts the arc at twelve o'clock — an arc
                        that begins at three reads as a dial rather than as
                        progress. */}
                    <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 size-6 -rotate-90">
                      <circle
                        cx="12"
                        cy="12"
                        r={RING_RADIUS}
                        fill="none"
                        strokeWidth="3"
                        className="stroke-neutral-500"
                      />
                      {arc > 0 && (
                        <circle
                          cx="12"
                          cy="12"
                          r={RING_RADIUS}
                          fill="none"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeDasharray={RING_CIRCUMFERENCE}
                          strokeDashoffset={RING_CIRCUMFERENCE - arc}
                          /* THE ARC IS THE STROKE STEP, NOT THE FILL ONE.
                             This was `stroke-primary` and it was the single
                             exemption in the whole `yellow-as-stroke` gate rule
                             — #eecf00 measures 1.42:1 as a line on the light
                             ground and 8.77:1 on the charcoal band, so the one
                             surface in the product where the brand could be
                             drawn rather than filled was this one.
                             There is no exemption left to take: `--marker` is
                             #00d492 at 9.83:1 on this ground and on every other
                             surface in the app, and it is what every line in
                             the product is drawn in. A ring that fills as you
                             build the thing the product is for is still exactly
                             what the brand should be pointing at. */
                          className="stroke-marker"
                        />
                      )}
                    </svg>
                    {/* THE NUMERAL IS BACK, and it is the export's own. It was
                        removed once and the arc thickened to 4px to compensate,
                        on the argument that the arc had become the figure and
                        had to carry the reading alone. With the numeral present
                        that argument is void, so the stroke returns to the
                        export's 3px and the two halves share the job again:
                        the ring is what you notice, the digit is what you read.
                        `text-xs` rather than the export's 10px — the type scale
                        is closed at 12px and a sixth size for one glyph inside
                        a 24px circle is not a trade the kit makes. */}
                    <span className="relative text-xs font-semibold leading-none tabular-nums text-muted-foreground">
                      {tracked}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {tracked}/{METRIC_GOAL}
                  </span>
                </span>
              </TooltipTrigger>
              {/* Below, not beside: the bar is 70px of chrome at the top of the
                  viewport, so a bubble on any other side opens off-screen or
                  over the workspace name it is explaining. */}
              <TooltipContent side="bottom">{ringMessage}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      )}

      {/* ── WHAT YOU ARE LOOKING AT ─────────────────────────────────────────
          One centred region with two occupants that are never both present.

          THE SLOT IS WHERE A PAGE PUTS ITS OWN CHROME. The flow builder used to
          float its entire toolbar over the canvas in a rounded island — the
          flow's name, save state, run, undo, redo, publish — which meant the
          app had two top bars stacked, one of them covering the thing being
          edited. It portals into here instead, so there is one bar and the
          canvas gets its space back. A portal target rather than a prop because
          those controls sit deep inside the canvas's own client tree, holding
          its undo stack and its save state; lifting them would mean lifting all
          of that with them.

          KEEP THE ID. Losing `#topbar-slot` does not degrade the builder, it
          breaks it: `getElementById` returns null and the toolbar renders
          nowhere at all.

          THE HAIRLINE BEFORE IT IS DRAWN BY THE SLOT ITSELF, and only when the
          slot has something in it — `empty:` is the only thing that can know,
          because a portal APPENDS DOM children and there is no state to pass
          down. (A `::before` does not count against `:empty`, which is what
          makes the pair work.) It is kept alongside `empty:hidden` on purpose:
          the hidden rule is what stops an empty slot claiming the centre from
          the greeting, and the `before:` rule is the one that would still be
          correct if the slot ever went back to being laid out when empty.

          THE GREETING IS THE OTHER OCCUPANT, and it steps aside rather than
          sharing: `peer` + `:not(:empty)` lets the slot's own contents do the
          hiding, so no page has to remember to tell this bar what it is doing.
          On the builder there is a toolbar here; everywhere else there is a
          greeting. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div
          id="topbar-slot"
          /**
           * NO LEADING RULE ANY MORE.
           *
           * This carried a `before:` hairline meant to divide the workspace
           * block from the builder's toolbar. It rendered at the START of the
           * slot — which is to say to the LEFT of the back chevron, hard against
           * the rail, separating the toolbar from nothing. A 1px line floating
           * at the edge of a bar reads as a rendering fault rather than as a
           * seam, which is exactly how it was reported.
           *
           * The division it was drawing already exists without it: the toolbar's
           * own controls are white pills on near-black, and the workspace block
           * to their left is text. Two materials do not need a rule between them.
           */
          className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden"
        />
        <span className="truncate text-sm font-medium text-foreground peer-[:not(:empty)]:hidden">{greeting}</span>
      </div>

      {/* ── WHAT YOU CAN START ──────────────────────────────────────────────
          Two acts, then two objects that are about you rather than about the
          product. Both buttons are LIGHT on this dark band and stay light in
          both themes — they are the same pills the page below wears, and a bar
          whose buttons invert while its ground does not is a bar with two
          materials in it. */}
      <div className="flex shrink-0 items-center gap-4">
        {/* A SECOND PORTAL, FOR STATE RATHER THAN FOR ACTS.
            `#topbar-slot` above holds the builder's toolbar and sits in the
            bar's centre column. A save state is not a toolbar control — it is a
            fact about the session, and it belongs at the edge with the other
            things that are about YOU rather than about the page. So the builder
            portals it here instead, first in this group, and it renders nothing
            at all on every route that has no save state to report. */}
        <div id="topbar-status" className="flex shrink-0 items-center empty:hidden" />
        {/* `sm` — 36px in a 70px band. The bar is furniture; the page is the
            content, and a 44px default here would put the chrome's controls at
            the same weight as the page's own. */}
        <Link
          href="/dashboard/settings"
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            // The secondary variant is spelled in ROLES, which the scoped
            // `dark` above would answer in dark — a near-black pill on a
            // near-black bar. Pinned to the chrome's own constants instead,
            // which are declared only in `:root` and therefore cannot invert:
            // a white chip, the chrome's hairline, near-black ink. These are
            // the same three values the bell and the account chip wear, which
            // is what makes the four controls read as one row.
            "border-border bg-card text-foreground hover:bg-neutral-700 active:bg-neutral-700",
          )}
          title="Invite someone to this workspace"
        >
          <UserPlus />
          <span className="hidden sm:inline">Invite members</span>
        </Link>
        {/* THE HERO, AND IT IS NOW SPELLED AS THE PRIMARY RATHER THAN AS A
            COLOUR. It was `variant="yellow"` — a variant that existed because
            the primary was violet and the hero needed a name of its own. Yellow
            IS the primary now, so that variant was two names for one object and
            has gone; `accent` is `bg-primary` + `text-primary-foreground`.
            The plus is the export's: a verb reads faster with a mark in front
            of it, and this is the one control in the bar that makes something. */}
        <Link href="/dashboard/flows" className={cn(buttonVariants({ variant: "accent", size: "sm" }))}>
          <Plus />
          <span>New flow</span>
        </Link>

        {/* THE BELL, ON A WHITE CHIP WITH AN EDGE. The chip INVERTED with the
            rebrand: it was a solid grey disc, and the export draws a white one
            with a hairline — the same material as the two pills to its left, so
            the four controls read as one row at one elevation rather than as
            two buttons and two blobs.
            THE BADGE IS THE BRAND. It was blue, on the argument that a count is
            neither a failure (danger) nor a selection (violet) and deserved a
            third colour. The rebrand answered that rather than overruling it:
            selection is not violet any more, so there is nothing left for a
            yellow badge to collide with, and a fourth hue in a band already
            holding charcoal, yellow and violet says less than three do. Its
            hairline is the near-white behind it, so the badge reads as lifted
            OFF the chip rather than punched into it. */}
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
          className="relative border border-border bg-card text-foreground hover:bg-neutral-700 active:bg-neutral-700"
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-background bg-primary text-2xs font-semibold leading-none text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>

        {/* THE ACCOUNT, LAST, where Miro, Notion and Figma all keep it — and it
            is the control you reach for least, which is why it sits after the
            hero rather than before it.
            NEAR-BLACK INITIALS, NOT VIOLET ONES. They were `brand-700`, back
            when that step was a violet that could carry text. `brand-*` is the
            YELLOW ramp now, so the same class would have set these initials in
            #d4b800 — 2.0:1 on a white chip, and the kind of breakage a rename
            causes silently, because the class still compiles and still looks
            deliberate. The export sets them in #1a1a1a. */}
        {account && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Account"
                className="border border-border bg-card text-xs font-semibold text-foreground hover:bg-neutral-700 active:bg-neutral-700 data-[state=open]:bg-neutral-700"
              >
                {/* THE PICTURE IF THERE IS ONE, the initials if not — and the
                    initials are not a placeholder for a missing image, they are
                    the default. `<img>` rather than `next/image` because the
                    URL is user-supplied on a blob host: the optimizer would
                    need that hostname allow-listed in next.config, which fails
                    CLOSED at runtime on a 28px image it can barely improve.
                    `object-cover` so a non-square upload is cropped rather than
                    squashed — the one thing that makes an avatar look broken. */}
                {account.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.avatarUrl} alt="" className="size-full rounded-full object-cover" />
                ) : (
                  account.initials
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-0">
              {account.panel}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

/**
 * THERE IS NO SECOND BAR ANY MORE.
 *
 * `SubBar` lived here and carried the dashboard's period pills, source filter
 * and Refresh all as a third full-bleed band — app bar, then filter bar, then
 * the view-tab row, all before a single number. Miro has ONE chrome bar and
 * puts its filters IN the content beside the view controls; three stacked
 * bands is most of what "the navs look messy" was.
 *
 * Those controls are the BOARD's, not the app's, so they went back to the
 * board: an ordinary toolbar row on the page, above the tabs. Deleted rather
 * than left exported, because a bar nothing renders is a bar someone
 * reintroduces.
 */
