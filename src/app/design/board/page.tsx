import { BoardHarness } from "./harness";
import { BoardControls, TileArea, ViewStrip, ViewTitle } from "@/app/dashboard/board-controls";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { FlowTile } from "@/components/flow-tile";
import { FlowNameField } from "@/components/flow/FlowToolbar";
import type { BoardGroup, BoardTile, TilePlacement } from "@/lib/board/types";

/**
 * THE BOARD, WITH FAKE METRICS, ON A PUBLIC ROUTE.
 *
 * It exists because three drag regressions shipped in a row, and every one of
 * them was a thing that could not be caught by reading source: the real
 * dashboard is behind WorkOS and the test runner has no DOM, so every assertion
 * about this feature was about its TEXT rather than its behaviour. That catches
 * "someone deleted the guard" and cannot catch "the guard is wrong".
 *
 * This is the same board, in the same frame the dashboard puts it in — and the
 * frame is the point. The app scrolls in a DIV with `overflow-y-auto`, not the
 * window, which the drag has to survive and for two commits did not.
 *
 * `/design` is deliberately unauthenticated and renders no customer data, which
 * is exactly why the kit lives here. Drive it with `node scripts/board-drag-check.mjs`.
 */
export const dynamic = "force-dynamic";

const tile = (name: string, value: number) => ({
  flowId: `f-${name.replace(/\W/g, "")}`,
  outputNodeId: "n1",
  tile: { name, viz: "number", format: "number", precision: 0, value },
  status: "fresh",
  error: null,
  computedAt: new Date(Date.now() - 3_600_000),
});

const ROWS = [
  tile("Revenue - Fees", 0),
  tile("Total Revenue", 0),
  tile("Total Leads", 35),
  tile("Pickup Rate", 50),
  tile("Loose One", 3),
];

const TILES: BoardTile[] = ROWS.map((r) => ({
  key: `flow:${r.flowId}:n1`,
  title: (r.tile as { name: string }).name,
  unitKey: "number::",
  value: (r.tile as { value: number }).value,
  attention: 0,
  node: <FlowTile key={`${r.flowId}:n1`} row={r} />,
}));

const GROUPS: BoardGroup[] = [
  { id: "g1", name: "Total", color: "green", pos: "i", sortKey: "manual" },
  { id: "g2", name: "Confirmation", color: "pink", pos: "r", sortKey: "manual" },
  // Deliberately SORTED. Its tiles must still be draggable OUT of it, and a
  // card dropped into it must not be promised a position the sort will
  // overrule — both of which were shipped broken.
  { id: "g3", name: "User", color: "blue", pos: "v", sortKey: "value_desc" },
];

const PLACEMENTS: TilePlacement[] = [
  { tileKey: TILES[0].key, groupId: "g1", pos: "i" },
  { tileKey: TILES[1].key, groupId: "g1", pos: "r" },
  { tileKey: TILES[2].key, groupId: "g1", pos: "v" },
  { tileKey: TILES[3].key, groupId: "g2", pos: "i" },
  { tileKey: TILES[4].key, groupId: "g3", pos: "i" },
];

export default async function BoardLab({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  /**
   * THE WINDOW THIS HARNESS IS STANDING ON — and it is a query param rather
   * than a constant for one specific regression.
   *
   * The strip is a client component that holds the tab order. It used to hold
   * the whole tab OBJECTS, re-synced on a signature of `key:pos` — which does
   * not move when a date range rewrites every `href`. So the tabs kept the
   * links they were first rendered with, and the owner's drawn window was
   * silently dropped the moment he pressed another tab. Every href the server
   * built was correct; nobody was re-rendering them.
   *
   * That is exactly the class this page was made for: the real board is behind
   * WorkOS and the runner has no DOM, so it shipped green. Building the hrefs
   * from `?range=` lets `board-drag-check` press one link and assert the TABS
   * changed with it — the owner's journey, on a public route.
   */
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const range = one(sp.range) ?? "7d";
  const tabHref = (view: string) => `/design/board?range=${encodeURIComponent(range)}&view=${view}`;

  /* THE REAL TABS, not a drawing of them — the whole point of this page.
     Enough of them to show the strip wrapping rather than scrolling, with
     the active one wearing its kebab.
     `ViewStrip`, NOT a row of `ViewTab`s — the strip is the component the
     product renders, and it owns the drag. Drawing the tabs by hand here
     meant the one behaviour worth checking on this page (can you reorder
     them?) was the one thing the page could not show.
     HOISTED OUT OF `BoardLayout`, AS OF THE 4 SEP 2026 BLUE RETHEME. The
     dashboard moved its own strip into `PageHeader`'s `tabs` slot; this
     public harness mirrors the same wiring rather than a shape the product
     no longer draws. */
  const viewStrip = (
    <ViewStrip
      views={[
        /* The DEFAULT view first, named as the real strip names it.
           `id: null` — it has no row until it is adopted, which is
           also why it is the one tab here that will not drag. */
        { key: "default", id: null, name: "Dashboard", href: tabHref("default"), pos: "a1" },
        { key: "v2", id: "v2", name: "Pipeline health", href: tabHref("v2"), pos: "a2" },
        { key: "v3", id: "v3", name: "Revenue", href: tabHref("v3"), pos: "a3" },
        { key: "v4", id: "v4", name: "Team", href: tabHref("v4"), pos: "a4" },
        { key: "v5", id: "v5", name: "Weekly review", href: tabHref("v5"), pos: "a5" },
        { key: "v6", id: "v6", name: "Ops", href: tabHref("v6"), pos: "a6" },
      ]}
      activeView="v6"
      canEdit
      defaultHref={tabHref("default")}
    />
  );

  return (
    // The dashboard's own scroll region: a DIV that clips, not the window.
    <div className="relative min-w-0 flex-1 overflow-y-auto rounded-l-frame bg-canvas-bg" style={{ height: "100vh" }}>
      <PageContainer>
        <BoardControls>
          {/* THE PAGE TITLE, ON A PUBLIC ROUTE, BECAUSE IT COULD NOT BE LOOKED AT.
              `ViewTitle` only renders behind WorkOS, so every judgement about it
              was made from class names — and it was fixed wrong three times in a
              row on exactly that basis: the padding, then the radius, then the
              flex alignment, while the class that would have worked was being
              deleted by `cn()` on the way out. This is the same control the
              dashboard mounts, with `canEdit` on, so its hover box can be
              screenshotted like everything else on /design.
              `tabs={viewStrip}` for the same reason as the dashboard: the strip
              lives in the header's own zone now, not inside `BoardLayout`. */}
          {/* THE "NEW GROUP" SLOT, as the dashboard's header carries it. The
              button portals into `#board-new-group` (see board-layout.tsx), so
              a page without the slot renders no button at all — which is how
              this fixture lost it when the button moved into the header, and
              why `pnpm board:drag`'s tab-row check went red with every class
              in the product still correct. */}
          <PageHeader
            tabs={viewStrip}
            title={<ViewTitle viewId="v-demo" name="Dashboard" canEdit />}
            actions={<div id="board-new-group" className="flex items-center empty:hidden" />}
          />
          {/* THE RANGE PRESS, AS A PLAIN LINK — the second half of the repro
              above. Pressing one is a client-side navigation on this same
              route, which is what the product's range pill does: the page
              re-renders with new tab hrefs WITHOUT remounting the strip. If the
              strip is holding stale tabs, the links below change and the tabs
              above do not, which is the whole bug in one screen.
              `data-range-link` and `data-current-range` are what
              `board-drag-check` reads; nothing else on the page needs them. */}
          <div data-current-range={range} className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>Window: {range}</span>
            <Link data-range-link="7d" href="/design/board?range=7d" className="underline">
              7d
            </Link>
            <Link data-range-link="custom" href="/design/board?range=2026-09-01..2026-09-16" className="underline">
              1–16 Sep
            </Link>
          </div>
          {/* The builder's flow-name field, on the same public route and for the
              same reason: its box was judged from class names and shipped at the
              wrong width twice. Rendered on the bar's own near-black so the
              hover wash is judged against the surface it actually sits on. */}
          <div className="dark mb-4 flex w-fit items-center rounded-control bg-background px-6 py-3">
            <FlowNameField name="Untitled flow" />
          </div>
          <TileArea count={TILES.length} columns={GROUPS.length}>
            {/* Through the harness: its writes fail in place instead of
                redirecting a session-less page to sign-in — see harness.tsx. */}
            <BoardHarness tiles={TILES} groups={GROUPS} placements={PLACEMENTS} />
          </TileArea>
        </BoardControls>
      </PageContainer>
    </div>
  );
}
