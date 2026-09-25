import { BoardHarness } from "../board/harness";
import type { CanvasTile } from "@/app/dashboard/custom-board";
import { TemplatePreview } from "@/components/templates/template-preview";
import { PageContainer, SectionHeading } from "@/components/ui/page";
import { planApply } from "@/lib/templates/snapshot";
import { SNAPSHOT } from "./fixtures";
import { parseTileConfig } from "@/lib/board/tile-config";
import type { BoardGroup } from "@/lib/board/types";
import { CanvasHarness } from "../canvas/harness";
import { TemplatesSection } from "@/app/dashboard/settings/TemplatesSection";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * A TEMPLATE, END TO END, WITHOUT A DATABASE OR A SESSION.
 *
 * The public page and the boards a template lands on both sit behind things a
 * screenshot cannot reach — a row in `workspace_templates`, a signed-in
 * workspace. This mounts the real components on a fixture built by the REAL
 * builder: an author's three views go through `buildSnapshot` exactly as they
 * would on "Share as template", then through `planApply` exactly as they would
 * on "Use this template", and what the recipient's boards receive is drawn by
 * `CustomBoard` and `BoardLayout` themselves. So a layout bug in any of the
 * three surfaces shows up here first — see [[source-tests-cannot-see-layout]]
 * in the project notes for why that matters in this repo.
 */

let n = 0;
const RECEIVED = planApply(SNAPSHOT, {
  viewPos: ["a", "b", "c"],
  groupPos: (count) => Array.from({ length: count }, (_, i) => `g${i}`),
  id: () => `design-${++n}`,
});

const canvasView = RECEIVED.views.find((v) => v.kind === "custom")!;
const SLOTS: CanvasTile[] = RECEIVED.tiles
  .filter((t) => t.viewId === canvasView.id)
  .map((t) => ({
    id: t.id,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    chart: t.chart,
    tileKey: t.tileKey,
    charts: ["number", "line", "area", "bar"],
    metricName: "",
    config: parseTileConfig(t.config),
    attention: 0,
    data: null,
  }));

const groupsView = RECEIVED.views.find((v) => v.kind === "groups")!;
const COLUMNS: BoardGroup[] = RECEIVED.groups
  .filter((g) => g.viewId === groupsView.id)
  .map((g) => {
    const note = RECEIVED.notes.find((x) => x.targetKind === "group" && x.targetId === g.id);
    return { id: g.id, name: g.name, color: g.color, pos: g.pos, sortKey: g.sortKey, note: note?.note ?? null, apps: note?.apps ?? [] };
  });

export default function TemplatesDesignPage() {
  return (
    <PageContainer>
      <SectionHeading>What a template&rsquo;s page shows</SectionHeading>
      <div data-design-template-preview className="mt-3 max-w-4xl">
        <TemplatePreview snapshot={SNAPSHOT} />
      </div>

      <SectionHeading className="mt-12">What the student&rsquo;s canvas receives — Calendly connected, Stripe not</SectionHeading>
      <div data-design-template-canvas className="mt-3">
        <CanvasHarness tiles={SLOTS} options={[]} connectedApps={["calendly"]} slotId="template-canvas-add" />
      </div>

      <SectionHeading className="mt-12">What the author manages — Settings → Templates</SectionHeading>
      <div data-design-template-settings className="mt-3 max-w-3xl">
        <Card variant="surface" padding="none" className="overflow-hidden">
          <TemplatesSection
            templates={[
              {
                id: "tpl-1",
                name: "Agency scorecard",
                description: "The numbers we review every Monday.",
                link: "https://namzilabs.co/t/K7M2Q9XA3B",
                path: "/design/templates/landing",
                enabled: true,
                views: 3,
                uses: 12,
                updated: "25 Sep 2026",
              },
              {
                id: "tpl-2",
                name: "Sales calls only",
                description: null,
                link: "https://namzilabs.co/t/9QZ4MX2K7P",
                path: "/design/templates/landing",
                enabled: false,
                views: 1,
                uses: 0,
                updated: "24 Sep 2026",
              },
            ]}
            views={[
              { id: "v1", name: "Overview", kind: "custom" },
              { id: "v2", name: "Sales", kind: "groups" },
              { id: "v3", name: "Bookings", kind: "calendar" },
            ]}
            preselect="v2"
            made="tpl-1"
            unavailable={false}
          />
        </Card>
      </div>

      <SectionHeading className="mt-12">What the student&rsquo;s columns receive</SectionHeading>
      <div data-design-template-columns className="mt-3">
        <BoardHarness tiles={[]} groups={COLUMNS} placements={[]} connectedApps={["calendly"]} />
      </div>
    </PageContainer>
  );
}
