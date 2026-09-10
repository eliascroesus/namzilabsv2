# -*- coding: utf-8 -*-
import io

def edit(path, pairs):
    s = io.open(path, encoding="utf-8").read()
    for why, old, new in pairs:
        n = s.count(old)
        assert n == 1, "%s in %s: expected 1, found %d" % (why, path, n)
        s = s.replace(old, new)
    io.open(path, "w", encoding="utf-8").write(s)
    print("ok:", path)


# ══ 1 + 3. THE CALENDAR'S OWN CONTROLS ═════════════════════════════════════
edit("src/components/calendar/calendar-board.tsx", [
 ("this month + UTC",
"""            <Button
              variant="ghost"
              onClick={() => setMonthIdx(months.length - 1)}
              disabled={monthIdx === months.length - 1}
              className={cn(PERIOD_PILL, "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              This month
            </Button>
          </div>""",
"""            <Button
              variant="ghost"
              onClick={() => setMonthIdx(months.length - 1)}
              disabled={monthIdx === months.length - 1}
              /* THE UTC FOOTNOTE RIDES THIS LABEL NOW — see the note below on
                 the pill that used to carry it. The `title` is what actually
                 explains it; the three letters are the reminder. */
              title="Days are UTC — the same days your metrics are counted in"
              className={cn(PERIOD_PILL, "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              This month - UTC
            </Button>
          </div>"""),
 ("utc pill out",
"""          {/* THE ONE FACT THE DELETED LEDE WAS CARRYING.
              Every value on this sheet is filed under a UTC day, so a viewer
              east of Greenwich reading these as local days is off by one for
              part of every evening — the difference between "Tuesday was our
              best day" and a number they cannot reproduce. Three letters on
              the control that changes days says it where it applies, instead
              of a sentence at the top of the page that says it once.
              NOT A CIRCLE AFTER ALL — three letters and horizontal padding
              make this an oval, not the true circle the "badge and count"
              exception (the day-cell numeral, the legend swatch below) is
              actually for, so it takes the same 8px the sheet's other chips
              do rather than keeping a pill shape nothing else in the row
              still wears. It stays neutral: a footnote that took a colour
              from the accent set would be the third hue in a bar that
              already has two. */}
          <span
            title="Days are UTC — the same days your metrics are counted in"
            className="rounded-control border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            UTC
          </span>
    </div>""",
"""          {/* THE UTC PILL IS GONE, AND ITS FACT MOVED ONTO THE LABEL BESIDE IT.
              The fact is worth keeping and was never in doubt: every value on
              this sheet is filed under a UTC day, so a viewer east of Greenwich
              reading these as local days is off by one for part of every
              evening — the difference between "Tuesday was our best day" and a
              number they cannot reproduce.
              What was wrong was the OBJECT. It was a bordered chip sitting
              outside the groove, which made a footnote look like a second
              control on a row that already had one; the owner asked for the
              three letters on "This month" instead. Same words, same `title`,
              in the place the reader is already looking when they change which
              days they are looking at. */}
    </div>"""),
 ("select trigger",
"""          <Select
            triggerClassName="h-8 gap-2 rounded-control border-border bg-card px-3 text-sm font-medium shadow-xs"
            leading={
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground"
              >
                <CalendarDays className="size-3.5" />
              </span>
            }""",
"""          {/* THE BOARD'S OWN BUTTON GEOMETRY, DOWN TO THE ROLE. It wore
              `bg-card` at `text-sm font-medium` (14/500) with a shadow, beside
              a row of `bg-secondary` controls at 13/400 — the same mismatch the
              calendar's month stepper had. `--secondary` is the role that means
              "a button's face" in both themes, and `text-button` is the rung
              the 10 September frames set every labelled control on.
              AND THE GLYPH LOST ITS PLATE. It sat in a 20px `bg-accent` disc in
              its own muted ink — a grey circle inside a grey button, which read
              as a second object rather than as this control's mark, and the
              owner asked it out. `text-current` so the icon takes the label's
              own colour and the two read as one thing. */}
          <Select
            triggerClassName="h-8 gap-2 rounded-control border-border bg-secondary px-3 text-button shadow-xs"
            leading={<CalendarDays aria-hidden className="size-4 shrink-0 text-current" />}"""),
])


# ══ 2. THE PICKER TAKES COMPARE TO'S PLACE ON A CALENDAR ═══════════════════
edit("src/app/dashboard/page.tsx", [
 ("compare to / calendar tools",
"""              {/* COMPARE TO — DRAWN, AND NOT WIRED, and it belongs on the REAL
                  board rather than only on the design harness. Node 0:5 puts it
                  between the period and the refresh. What it would open is a
                  comparison SERIES this product does not compute — DESIGN.md
                  has recorded the two-series legend as unbuilt since before the
                  chrome rebuild — so it ships disabled with a title that says
                  so, rather than as a menu that opens onto nothing. */}
              <Button
                variant="white"

                disabled
                title="Comparison periods are not built yet"
                className="shrink-0"
              >
                <ChartLine />
                Compare To
                <ChevronDown />
              </Button>""",
"""              {/* COMPARE TO — DRAWN, AND NOT WIRED. Node 0:5 puts it between
                  the period and the refresh. What it would open is a comparison
                  SERIES this product does not compute — DESIGN.md has recorded
                  the two-series legend as unbuilt since before the chrome
                  rebuild — so it ships disabled with a title that says so,
                  rather than as a menu that opens onto nothing.

                  AND IT STANDS DOWN ON A CALENDAR, where the metric picker
                  takes its place. Two reasons, and the second is the real one:
                  a comparison PERIOD is meaningless on a sheet that answers two
                  fixed months, and the slot is the best position on the row for
                  the one control a calendar genuinely has — the picker was
                  living on a row of its own below the header, which is the
                  third-bar mismatch this whole chrome pass has been removing.
                  `#calendar-tools` is filled by `CalendarBoard`'s portal; an
                  empty div collapses if it never is. */}
              {activeKind === "calendar" ? (
                <div id="calendar-tools" className="flex shrink-0 items-center gap-2 empty:hidden" />
              ) : (
                <Button
                  variant="white"
                  disabled
                  title="Comparison periods are not built yet"
                  className="shrink-0"
                >
                  <ChartLine />
                  Compare To
                  <ChevronDown />
                </Button>
              )}"""),
 ("lower slot out",
"""            {/* THE METRIC PICKER'S OWN SLOT — the one thing left on this row
                now that "+ Add" and Refresh all both moved into the page
                header (see the note above). `justify-end` so the picker, once
                `CalendarBoard` portals it in, sits at the row's right edge —
                the same edge every other view's action row ends on.
                `empty:hidden` so a view with no tools does not leave a
                zero-height flex row taking up space above the calendar sheet. */}
            <div id="calendar-tools" className="flex items-center justify-end gap-2 empty:hidden" />
""",
"""            {/* THE METRIC PICKER'S SLOT MOVED UP INTO THE HEADER, into the
                position "Compare To" holds on every other view — see the note
                there. This row is empty now and kept only as the calendar's
                own container; there must be exactly ONE `#calendar-tools` in
                the document, because `getElementById` answers with the first
                and a portal aimed at a second one renders nowhere. */}
"""),
])


# ══ 4. "NEW GROUP" JOINS THE HEADER, BESIDE THE DATE RANGE ═════════════════
edit("src/app/dashboard/board-layout.tsx", [
 ("new group portal",
"""      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-4">
          <Button variant="secondary" size="sm" onClick={addGroup} disabled={busy} className="shrink-0">
            <Plus size={15} />
            New group
          </Button>
        </div>
      )}""",
"""      {/* NEW GROUP PORTALS INTO THE HEADER NOW, beside the date range.
          The note above explains why it could never be rendered BY the header:
          it calls `addGroup`, which writes optimistically into the `groups`
          this client component owns, so a server-rendered slot cannot
          instantiate it. What it can do is hold the POSITION — the identical
          arrangement `#canvas-add-chart` and `#calendar-tools` already use, and
          for the identical reason: the state belongs to the client, the place
          belongs to the header, and neither can hand the other what it has.
          The owner asked for it on the bar next to the date range; this row was
          the last thing standing between the header and the board, so with it
          gone the group view finally has the same two bands every other view
          has rather than three. */}
      {canEdit && (
        <Slot id="board-new-group">
          <Button variant="white" onClick={addGroup} disabled={busy} className="shrink-0">
            <Plus />
            New group
          </Button>
        </Slot>
      )}"""),
])
