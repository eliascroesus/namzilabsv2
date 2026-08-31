import { BoardLayout } from "@/app/dashboard/board-layout";
import { BoardControls, TileArea, ViewTab, ViewTitle } from "@/app/dashboard/board-controls";
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

export default function BoardLab() {
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
              screenshotted like everything else on /design. */}
          <PageHeader title={<ViewTitle viewId="v-demo" name="Dashboard" canEdit />} />
          {/* The builder's flow-name field, on the same public route and for the
              same reason: its box was judged from class names and shipped at the
              wrong width twice. Rendered on the bar's own near-black so the
              hover wash is judged against the surface it actually sits on. */}
          <div className="dark mb-4 flex w-fit items-center rounded-control bg-background px-6 py-3">
            <FlowNameField name="Untitled flow" />
          </div>
          <TileArea count={TILES.length} columns={GROUPS.length}>
            <BoardLayout
              tiles={TILES}
              groups={GROUPS}
              placements={PLACEMENTS}
              canEdit
              viewId={null}
              viewStrip={
                /* THE REAL TABS, not a drawing of them — the whole point of
                   this page. Enough of them to show the strip wrapping rather
                   than scrolling, with the active one wearing its kebab. */
                <div className="-mx-1 flex flex-wrap items-center gap-1 px-1 py-1">
                  {/* The DEFAULT view first, named as the real strip names it —
                      it has no row, so nothing else can put it there. */}
                  <ViewTab href="#" viewId={null} activeView={null} canEdit defaultHref="#">
                    Dashboard
                  </ViewTab>
                  {[
                    { id: "v2", name: "Pipeline health" },
                    { id: "v3", name: "Revenue" },
                    { id: "v4", name: "Team" },
                    { id: "v5", name: "Weekly review" },
                  ].map((v) => (
                    <ViewTab key={v.id} href="#" viewId={v.id} activeView={null} canEdit defaultHref="#">
                      {v.name}
                    </ViewTab>
                  ))}
                  <ViewTab href="#" viewId="v6" activeView="v6" canEdit defaultHref="#">
                    Ops
                  </ViewTab>
                </div>
              }
            />
          </TileArea>
        </BoardControls>
      </PageContainer>
    </div>
  );
}
