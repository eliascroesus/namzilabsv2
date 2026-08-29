import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";

/**
 * THE COVERAGE AUDIT — the half of a design system nobody renders.
 *
 * Every other section of this page shows what the kit CAN do. This one shows
 * what the product actually reaches for, and the gap between the two is the
 * most useful thing on the page: fourteen of the thirty-one primitives in
 * `src/components/ui/` are imported by NOTHING outside this kit page.
 *
 * That is not a tidiness problem, it is the whole answer to why a product
 * built on a careful token layer still reads as inconsistent. A primitive
 * that ships unused does not leave a hole in the interface — something took
 * its place, and that something was written once, by hand, for one screen.
 * `ui/alert.tsx` is complete, carries `role="alert"`, and is used nowhere;
 * twenty-two files draw their own banner on the state trios instead, and no
 * two of them agree on padding, type size or whether the thing can be
 * dismissed. Multiply that by fourteen and you have an app whose every
 * surface is very slightly its own design.
 *
 * The numbers below are counted, not estimated: an import-path grep across
 * `src/`, excluding `src/components/ui/` (a primitive importing a primitive
 * is not a consumer) and `src/app/design/` (this page renders everything by
 * definition, so counting it would make every row look healthy).
 */

type Row = {
  file: string;
  consumers: number;
  /** What the product uses instead, where the primitive is unused. */
  insteadOf?: string;
};

/**
 * Ordered by consumers ascending, so the unused half reads first — this table
 * exists to make the gap obvious, not to flatter the kit.
 */
const ROWS: Row[] = [
  { file: "alert.tsx", consumers: 0, insteadOf: "22 files draw their own banner on the state trios; none carries role=\"alert\"" },
  { file: "tabs.tsx", consumers: 0, insteadOf: "three hand-rolled strips — a violet tint on the board, a filled Button on Apps, a violet underline in the builder — and none answers arrow keys" },
  { file: "dialog.tsx", consumers: 0, insteadOf: "ui/modal.tsx plus three bespoke floating surfaces; Review & publish, the highest-stakes one, has no focus trap" },
  { file: "select.tsx", consumers: 0, insteadOf: "flow/controls/Select.tsx, 182 hand-written lines" },
  { file: "popover.tsx", consumers: 0, insteadOf: "flow/controls/Popover.tsx, 177 lines of hand-written viewport positioning" },
  { file: "checkbox.tsx", consumers: 0, insteadOf: "raw <input type=\"checkbox\"> with an accent-brand-600 class" },
  { file: "label.tsx", consumers: 0, insteadOf: "ui/field.tsx FieldLabel, which is the kit's real answer" },
  { file: "separator.tsx", consumers: 0, insteadOf: "inline <div className=\"h-px bg-border\" />" },
  { file: "avatar.tsx", consumers: 0, insteadOf: "hand-rolled circles in Settings and a bespoke rail avatar" },
  { file: "sheet.tsx", consumers: 0 },
  { file: "breadcrumb.tsx", consumers: 0 },
  { file: "command.tsx", consumers: 0 },
  { file: "progress.tsx", consumers: 0 },
  { file: "scroll-area.tsx", consumers: 0 },
  { file: "tooltip.tsx", consumers: 1, insteadOf: "~130 native title= attributes, which never appear for keyboard or touch" },
  { file: "chip.tsx", consumers: 2 },
  { file: "dropdown-menu.tsx", consumers: 2 },
  { file: "legal.tsx", consumers: 2 },
  { file: "modal.tsx", consumers: 4 },
  { file: "submit-button.tsx", consumers: 4 },
  { file: "switch.tsx", consumers: 4 },
  { file: "table.tsx", consumers: 4, insteadOf: "the one real table (Activity) wraps a Card and builds its own head strip, stacking two recessed greys" },
  { file: "toast.tsx", consumers: 4 },
  { file: "skeleton.tsx", consumers: 6 },
  { file: "empty-state.tsx", consumers: 8, insteadOf: "four other \"nothing here\" spellings ship beside it" },
  { file: "field.tsx", consumers: 9 },
  { file: "badge.tsx", consumers: 12 },
  { file: "card.tsx", consumers: 14 },
  { file: "page.tsx", consumers: 18 },
  { file: "input.tsx", consumers: 23 },
  { file: "button.tsx", consumers: 36 },
];

const UNUSED = ROWS.filter((r) => r.consumers === 0).length;

export function CoverageAudit() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card variant="surface">
          <p className="stat-numeral text-display-md text-foreground">{UNUSED}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            of 31 primitives are imported by nothing outside this page
          </p>
        </Card>
        <Card variant="surface">
          <p className="stat-numeral text-display-md text-foreground">22</p>
          <p className="mt-1 text-sm text-muted-foreground">
            files draw their own banner while <span className="font-mono text-xs">ui/alert.tsx</span> sits unused
          </p>
        </Card>
        <Card variant="surface">
          <p className="stat-numeral text-display-md text-foreground">4</p>
          <p className="mt-1 text-sm text-muted-foreground">
            separate floating-surface recipes for one idea — dialog, modal, and two bespoke ones
          </p>
        </Card>
      </div>

      <div className="overflow-hidden rounded-surface border border-border">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border bg-muted px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primitive</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consumers</p>
        </div>
        <ul>
          {ROWS.map((r) => (
            <li
              key={r.file}
              className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <span className="font-mono text-sm text-foreground">ui/{r.file}</span>
                {r.insteadOf && <p className="mt-1 text-xs text-muted-foreground">Instead: {r.insteadOf}</p>}
              </div>
              {r.consumers === 0 ? (
                <StatusPill tone="danger">unused</StatusPill>
              ) : (
                <span className="tnum text-sm text-muted-foreground">{r.consumers}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * THE COMPOSED PATTERNS, AND WHAT IS WRONG WITH EACH.
 *
 * Loose primitives cannot answer "does this look finished" — a reviewer sees
 * composed screens, and every weakness below was found by reading the screen
 * rather than the component. They are listed with their file so a decision to
 * redesign one has somewhere to start.
 */
const PATTERNS: Array<{ name: string; where: string; weakness: string }> = [
  {
    name: "Metric tile",
    where: "components/flow-tile.tsx:184 · a second, incompatible one at dashboard/page.tsx:1056",
    weakness:
      "Two different tiles ship in the same grid, so a workspace with a classic metric shows two card designs side by side. The recessed tray is bg-foreground/3 — three per cent, effectively invisible — and the tile rests at shadow-xs, so a board reads as a field of flat rectangles until you hover one.",
  },
  {
    name: "Board group column",
    where: "app/dashboard/board-column.tsx:146",
    weakness:
      "The most confident visual design in the product, and all of its colour arrives through inline style — so the one genuinely branded surface sits outside the token system and cannot follow the theme. In dark mode a 6% wash over a dark card is close to nothing. Its 44px header height also matches nothing else in the kit.",
  },
  {
    name: "Flows list row",
    where: "app/dashboard/flows/FlowRow.tsx:287",
    weakness:
      "The columns line up only because three literal widths are re-declared on every row — there is no shared grid, so the head strip and the rows agree by hand. The row hovers to a violet wash while the structurally identical connection row two routes away hovers to grey: two hover languages for one row type.",
  },
  {
    name: "Connection row",
    where: "app/integrations/ConnectionRow.tsx:285",
    weakness:
      "Each destructive state replaces the row's markup, so confirming a disconnect changes the row height and the list jumps under the pointer at the moment the user is being asked to aim. Both action icons are opacity-0 until hover, so on touch the row appears to have no controls at all.",
  },
  {
    name: "Settings section",
    where: "app/dashboard/settings/page.tsx:77",
    weakness:
      "Four near-identical white slabs with no rhythm between them. The avatar palette is three unrelated ideas in one column — solid violet for the owner, pastels for members, a dashed grey circle for invitees — and the one yellow on the page sits on 'Send invite', the least consequential row.",
  },
  {
    name: "Activity table",
    where: "app/dashboard/activity/page.tsx:186",
    weakness:
      "The product's only real table does not use the kit's TableShell: it wraps a Card and hand-builds a head strip, and the THead under it paints its own grey — two recessed greys stacked directly on top of each other. No zebra, no sticky header, no sort, no pagination.",
  },
  {
    name: "Builder chrome",
    where: "components/flow/FlowToolbar.tsx:231 — the canvas and nodes are out of scope",
    weakness:
      "Every control is hand-sized at 42px, which matches none of the kit's five sizes, so the builder is the one screen whose buttons are a bespoke height. The flow name is a borderless transparent input that only reveals itself on hover — a text field with no resting affordance at the centre of the chrome.",
  },
];

export function PatternAudit() {
  return (
    <ul className="space-y-3">
      {PATTERNS.map((p) => (
        <li key={p.name}>
          <Card variant="surface">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-md font-semibold text-foreground">{p.name}</h3>
              <span className="font-mono text-xs text-muted-foreground">{p.where}</span>
            </div>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">{p.weakness}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
