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


edit("src/app/dashboard/page.tsx", [
 ("compare to / calendar tools",
'''              <Button
                variant="white"

                disabled
                title="Comparison periods are not built yet"
                className="shrink-0"
              >
                <ChartLine />
                Compare To
                <ChevronDown />
              </Button>''',
'''              {/* AND IT STANDS DOWN ON A CALENDAR, where the metric picker
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
              )}'''),

 ("new group slot",
'''              {activeKind === "custom" && <div id="canvas-add-chart" className="flex items-center empty:hidden" />}''',
'''              {activeKind === "custom" && <div id="canvas-add-chart" className="flex items-center empty:hidden" />}
              {/* "NEW GROUP", BESIDE THE DATE RANGE. Same arrangement as the
                  two slots around it and for the same reason: the button calls
                  `addGroup`, which writes optimistically into the `groups`
                  `board-layout.tsx` owns, so this async server component cannot
                  instantiate it — it holds the POSITION and the client portals
                  the control in. It stood on a row of its own between the
                  header and the board, which was the last third band left in
                  the product. */}
              {activeKind === "groups" && <div id="board-new-group" className="flex items-center empty:hidden" />}'''),

 ("lower slot out",
'''            {/* THE METRIC PICKER'S OWN SLOT — the one thing left on this row
                now that "+ Add" and Refresh all both moved into the page
                header (see the note above). `justify-end` so the picker, once
                `CalendarBoard` portals it in, sits at the row's right edge —
                the same edge every other view's action row ends on.
                `empty:hidden` so a view with no tools does not leave a
                zero-height flex row taking up space above the calendar sheet. */}
            <div id="calendar-tools" className="flex items-center justify-end gap-2 empty:hidden" />
''',
'''            {/* THE METRIC PICKER'S SLOT MOVED UP INTO THE HEADER, into the
                position "Compare To" holds on every other view — see the note
                there. There must be exactly ONE `#calendar-tools` in the
                document: `getElementById` answers with the first, so a second
                one here would be the portal's target and the picker would
                render back down on a row of its own. */}
'''),
])


edit("src/app/dashboard/board-layout.tsx", [
 ("new group portal",
'''      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-4">
          <Button variant="secondary" size="sm" onClick={addGroup} disabled={busy} className="shrink-0">
            <Plus size={15} />
            New group
          </Button>
        </div>
      )}''',
'''      {/* NEW GROUP PORTALS INTO THE HEADER NOW, beside the date range.
          The note above explains why it could never be rendered BY the header:
          it calls `addGroup`, which writes optimistically into the `groups`
          this client component owns, so a server-rendered slot cannot
          instantiate it. What a slot CAN do is hold the position — the
          identical arrangement `#canvas-add-chart` and `#calendar-tools`
          already use, and for the identical reason.

          `variant="white"` rather than `secondary`, and no `size`: the header's
          row is four white 32px controls at 13/400, and a grey `sm` button in
          the middle of them was the drift. `<Plus />` without an explicit
          `size` for the same reason — the variant's own `[&_svg]:size-4` is
          what every other control in that row draws.

          WITH THIS GONE THE GROUP VIEW HAS TWO BANDS like every other view,
          rather than a third one carrying a single button. */}
      {canEdit && (
        <Slot id="board-new-group">
          <Button variant="white" onClick={addGroup} disabled={busy} className="shrink-0">
            <Plus />
            New group
          </Button>
        </Slot>
      )}'''),

 ("board top gap",
'''        <div className={`mt-4 items-start ${BOARD_GRID}`}>{board.tiles.map((t) => t.node)}</div>''',
'''        /* NO `mt-4` — 24px ON EVERY SIDE, WHICH IS THE CONTAINER'S OWN INSET.
           That margin was this row's gap from the action row above it, and the
           action row is gone. Left in place it put the board 16px below a
           header that already ends in `pb-4`, so the group view sat lower than
           every other view and its top inset did not match its left, right or
           bottom. The owner asked for the whole thing moved up to a uniform
           24. */
        <div className={`items-start ${BOARD_GRID}`}>{board.tiles.map((t) => t.node)}</div>'''),
])
