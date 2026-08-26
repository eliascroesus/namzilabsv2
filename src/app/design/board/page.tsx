import { BoardLayout } from "@/app/dashboard/board-layout";
import { BoardControls, TileArea } from "@/app/dashboard/board-controls";
import { PageContainer } from "@/components/ui/page";
import { FlowTile } from "@/components/flow-tile";
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
          <TileArea count={TILES.length} columns={GROUPS.length}>
            <BoardLayout tiles={TILES} groups={GROUPS} placements={PLACEMENTS} canEdit viewId={null} />
          </TileArea>
        </BoardControls>
      </PageContainer>
    </div>
  );
}
