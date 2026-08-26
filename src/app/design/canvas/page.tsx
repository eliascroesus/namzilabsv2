import { canvasCells, GRID_COLS, ROW_UNIT_PX, type GridBox } from "@/lib/board/grid";
import { PageContainer, SectionHeading } from "@/components/ui/page";
import { Card } from "@/components/ui/card";

/**
 * THE CUSTOM VIEW'S GRID, DRIVABLE WITHOUT AUTHENTICATION.
 *
 * The dashboard sits behind WorkOS, so no screenshot and no browser harness can
 * reach it — which is exactly how three drag regressions shipped in a row on the
 * groups board, each one invisible to a suite that read source and asserted what
 * it said. `/design/board` ended that cycle by mounting the real component with
 * fake data; this is the same move for the canvas, and it exists BEFORE the
 * gestures rather than after them, so there is somewhere to point a harness at
 * the moment there is something to drag.
 *
 * The geometry here is real: `canvasCells` is the function the dashboard calls,
 * and the CSS is the same two classes. Only the cards are fake.
 */
export const dynamic = "force-static";

type Specimen = GridBox & { label: string };

/**
 * Deliberately AWKWARD. A row of quarter-width tiles, a wide chart beside a tall
 * one, and a full-width strip — the arrangement that catches a packer which
 * cannot fit a short tile beside a tall one, and the widths that do not halve
 * cleanly into six columns.
 */
const TILES: Specimen[] = [
  { id: "t1", label: "Booked Leads · number", x: 0, y: 0, w: 3, h: 4 },
  { id: "t2", label: "Total Leads · number", x: 3, y: 0, w: 3, h: 4 },
  { id: "t3", label: "On Calendar · bar", x: 6, y: 0, w: 6, h: 6 },
  { id: "t4", label: "Pickup Rate · progress", x: 0, y: 4, w: 3, h: 4 },
  { id: "t5", label: "Claimed by rep · category", x: 3, y: 4, w: 3, h: 6 },
  { id: "t6", label: "Speed to Lead · bar", x: 0, y: 10, w: 12, h: 6 },
];

export default function CanvasSpecimen() {
  const cells = canvasCells(TILES);
  return (
    <div className="min-h-screen bg-canvas-bg py-10">
      <PageContainer>
        <SectionHeading>Custom view canvas</SectionHeading>
        <p className="mt-1 text-small text-muted-foreground">
          {GRID_COLS} columns at desktop, 6 at tablet, 1 on a phone — one stored layout, three renderings. A row unit is{" "}
          {ROW_UNIT_PX}px including its gutter. Narrow the window to watch it reflow.
        </p>

        <div className="board-canvas mt-6">
          {cells.map(({ tile, vars }) => (
            <div key={tile.id} className="board-cell" style={vars as React.CSSProperties}>
              <Card variant="surface" className="flex h-full flex-col justify-between p-4">
                <span className="text-small font-semibold text-foreground">{tile.label}</span>
                <span className="text-tiny text-muted-foreground tnum">
                  {tile.w}×{tile.h}
                </span>
              </Card>
            </div>
          ))}
        </div>
      </PageContainer>
    </div>
  );
}
