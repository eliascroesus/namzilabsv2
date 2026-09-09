import type { ReactNode } from "react";
import { Inbox, LayoutDashboard, Plug, Plus, Settings, Workflow, X } from "lucide-react";
import { AppFrame } from "@/components/app-frame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ModalTitle } from "@/components/ui/modal";
import { PageHeader, SectionHeading } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { CanvasPreview, FlowNodeCard } from "@/components/flow/flow-canvas-preview";
import { EmptyCanvasPreview } from "@/components/flow/empty-canvas-preview";
import { EmptyBoard } from "@/components/board-empty";
import { ConditionEditorPreview } from "@/components/flow/condition-editor-preview";
import { NodeIcon } from "@/components/flow/icons";
import { PanelTabsPreview } from "@/components/flow/panel-preview";
import { PANEL_SHELL } from "@/components/flow/panel-chrome";
import { FlowList } from "@/app/dashboard/flows/FlowRow";
import { CalendarBoard, type CalendarMetric } from "@/components/calendar/calendar-board";
import { calendarMonths, dayKey, daysInMonth } from "@/lib/metrics/calendar";
import { Delta, GroupBars, Sparkbars, TargetBar } from "@/components/charts";
import { SourceMark } from "@/components/source-mark";
import { PrimitiveSpecimens } from "./primitives";
import { BrandSheet } from "./brand-sheet";
import { Gallery } from "./gallery";
import { CoverageAudit, PatternAudit } from "./audit";

/**
 * THE BRAND KIT, RENDERED.
 *
 * A design system that only exists as tokens in a stylesheet is a system
 * nobody checks. This page is the check: every colour, size, radius and
 * component in one scroll, built from the SAME tokens and the SAME components
 * the product uses — so a drift shows up here before a customer finds it.
 * The written half is docs/BRAND_KIT.md; the tokens in globals.css win over
 * both when they disagree.
 *
 * Deliberately public (it is not under /dashboard, /integrations or
 * /connections, the proxy's protected prefixes) and it reads no data, touches
 * no session and queries nothing. That is what makes it openable in a
 * headless browser during development, which is the only way to actually LOOK
 * at the interface rather than reason about its class names.
 */
export const metadata = { title: "Namzilabs — UI kit" };

/**
 * THE SWATCH LABELS ARE THE ONE PLACE A HEX IS ALLOWED TO BE COPIED — and the
 * copy is checked.
 *
 * The tile itself renders from the TOKEN (`bg-brand-600`); only the caption
 * beside it is a literal, because a documentation page that cannot print the
 * value it is documenting is not documenting anything. That makes this the
 * exact drift the kit forbids everywhere else, so it is pinned instead:
 * tests/design-swatches.test.ts reads globals.css and fails if any caption
 * here disagrees with the token it sits under.
 *
 * That test is not hypothetical. The warm re-theme moved every value below,
 * and for one render the page showed ultramarine tiles captioned with the old
 * indigo hexes — a kit page confidently lying about the kit.
 */
/**
 * THE BRAND RAMP IS ONE BLUE, ACROSS THREE JOBS.
 *
 * `600` fills (`--primary`, both themes, under white ink at 4.68:1). `500` is
 * the brand itself — the Figma's own #B6FF56 — bright enough to carry
 * white text at 4.5:1 (3.98:1), so it never fills, but exactly right as the
 * hover of the fill, a decorative dot, a chart's default series and the
 * workspace-initial tint. `400` and `800` draw: the dark stroke and the light
 * stroke, one rung lighter than the fill on each surface, because a 1px ring
 * owes more room than a button's own ink needs.
 */
const BRAND: Array<{ step: string; cls: string; hex: string }> = [
  { step: "50", cls: "bg-brand-50", hex: "#f4ffe4" },
  { step: "100", cls: "bg-brand-100", hex: "#e9ffc9" },
  { step: "200", cls: "bg-brand-200", hex: "#dbffa6" },
  { step: "300", cls: "bg-brand-300", hex: "#c9ff7d" },
  { step: "400", cls: "bg-brand-400", hex: "#b6ff56" },
  { step: "500", cls: "bg-brand-500", hex: "#a2e844" },
  { step: "600", cls: "bg-brand-600", hex: "#8acc2e" },
  { step: "700", cls: "bg-brand-700", hex: "#6fa61c" },
  { step: "800", cls: "bg-brand-800", hex: "#4f7a00" },
  { step: "900", cls: "bg-brand-900", hex: "#3d5e00" },
];
/**
 * THE SURFACE HALF of the neutral ramp — eight steps now, because the
 * interface is built out of THREE grounds instead of one: `950` is the page,
 * `925` is the chrome (the top bar and the rail, and the card fill), `900` is
 * the panel under the top bar, and `850` is a control, a step up from the
 * panel and the card. `800` and `700` are raised further still — a grey
 * button's hover, a menu row, an avatar circle. `600` is the hairline; `500`
 * is the heavier rule a checkbox or a switch track owes.
 */
const SURFACE: Array<{ step: string; cls: string; hex: string }> = [
  { step: "950", cls: "bg-neutral-950", hex: "#121214" },
  { step: "925", cls: "bg-neutral-925", hex: "#121214" },
  { step: "900", cls: "bg-neutral-900", hex: "#191919" },
  { step: "850", cls: "bg-neutral-850", hex: "#202020" },
  { step: "800", cls: "bg-neutral-800", hex: "#333333" },
  { step: "700", cls: "bg-neutral-700", hex: "#3a3a3a" },
  { step: "600", cls: "bg-neutral-600", hex: "#343434" },
  { step: "500", cls: "bg-neutral-500", hex: "#4a4a4a" },
];
/**
 * THE INK HALF — three ROLE steps, and a deliberate gap before the surface
 * half above. `450` is a caps-label-only step ("Main Menu" and nothing that
 * reads as a sentence); `400` is the first step body TEXT may be set in
 * (`--muted-foreground`); `200` is body and headings both, since the Figma
 * sets both in white.
 *
 * `300`, `100` and `50` follow: no ROLE reads them any more, but
 * `scroll-area.tsx`'s thumb, `switch.tsx`'s off track and `button.tsx`'s
 * `white` variant (hover and active) still spell them directly, so their
 * hexes stay pinned here too rather than falling out of this page's coverage.
 */
const INK: Array<{ step: string; cls: string; hex: string }> = [
  { step: "450", cls: "bg-neutral-450", hex: "#6e6e6e" },
  { step: "400", cls: "bg-neutral-400", hex: "#828282" },
  { step: "200", cls: "bg-neutral-200", hex: "#ffffff" },
  { step: "300", cls: "bg-neutral-300", hex: "#b5b5b5" },
  { step: "100", cls: "bg-neutral-100", hex: "#e5e5e5" },
  { step: "50", cls: "bg-neutral-50", hex: "#fafafa" },
];
/**
 * THE DECISIONS THE TOKEN TABLES CANNOT HOLD.
 *
 * Each row is a rule that shaped a surface, paired with the reason it exists —
 * because "use the brand colours" is not a rule anybody can apply twice the
 * same way, and every one of these was learned by getting it wrong once.
 */
const DIRECTION: Array<{ rule: string; why: string }> = [
  {
    rule: "Quiet chrome, loud numbers",
    why: "Six tools disagree and this app answers in one figure. The number is the only thing allowed to be loud; everything around it is furniture, and furniture that shouts is why most operational tools are exhausting by 4pm.",
  },
  {
    rule: "Three darks, and a hairline",
    why: "ONE surface. The page, the top bar, the rail and the content area are all #121214, and the only thing that steps away is the card, at #191919 — 1.06:1, which is to say invisible on its own. This is the second reversal of the same argument in four days: one surface, then three, and one again. What it does to the hairline is the interesting half. There is no page/chrome or chrome/panel edge left to draw, because a rule between two identical surfaces draws nothing — so #343434 is not doing LESS work, it is doing all of the work there is, on the single card edge that remains. A surface change nobody can see without its edge is not a flatter surface, it is an invisible one.",
  },
  {
    rule: "Content floats on the ground",
    why: "Nothing sits flat on the page but a heading or a caption. Everything with content in it is an island with an EDGE, and the edge is the whole of it: a card is #191919 on a #121214 page — 1.06:1 — so the border is not trim on a surface you can already see, it is the only thing making the surface visible at all.",
  },
  {
    rule: "One blue, two jobs",
    why: "#B6FF56 replaces the blue everywhere, and it inverts the ink. Blue was a fill under WHITE; white on lime is 1.20:1, so --primary-foreground is near-black (#2C2C2C) at 11.59:1 in BOTH themes. On dark it needs no second step at all: brand-400 is the STROKE (--marker: links, the focus ring, a selected edge — NOT the active tab's rule, which is the grey --tab-rule role instead) at 15.53:1 on the page, and the FILL, and the default chart series. Light is where the split survives, because lime cannot draw on white: --marker there is a solved-down #4F7A00 at 5.10:1. The 'glyph is location' job the cyan carried folded into this one instead — the rail's active row takes a neutral --control fill UNDER the glyph, and RailChip keeps text-marker on the glyph itself, so location is now two signals rather than the Figma's one colourless fill. Success is still NOT the brand: it keeps the green the brand vacated, because a DONE badge and a New-flow button being one colour puts the loudest state and the loudest act in one vocabulary. Warn and danger are the other two state hues, and status is still quiet when fine.",
  },
  {
    rule: "Ten contains, eight presses",
    why: "Everything that contains something is 10px — cards, panels, popovers, a select's own open menu. Everything pressable is 8: buttons, chips, inputs, selects, tabs, nav rows, the period switch. A badge is 4. Circles are reserved for four things that are never an action — an avatar, the bell's unread badge, the freshness dot, and the tile's active-count numeral. This replaced 'everything pressable is a full pill' for the second time, and the 4 September 2026 Figma is named as the reference so a third flip needs a new design rather than a preference.",
  },
  {
    rule: "Three sizes do the work",
    why: "15px interface, 13px labels, 11px for the micro badge. 17px is reading prose only — legal pages, marketing copy — and the app's body is not that. The micro-label voice — 11px, ALL CAPS, tracked, muted, available as .label-micro — is the product's signature and what lets a very small string read as a LABEL rather than as very small prose. A chip is the one small object that is NOT caps: a badge carries a status you scan, a chip carries a name the customer chose.",
  },
  {
    rule: "The active thing is the heavier one",
    why: "Weight, ink and the mark all move together. This ran backwards in the view strip for a while, so the five tabs you were NOT on were the boldest words in the row.",
  },
  {
    rule: "A press lands immediately",
    why: "The control lights on the press and its content becomes content-shaped skeletons while the server answers. Never dim the old numbers — a legible figure under a chip that now says something else is a wrong answer shown confidently.",
  },
  {
    rule: "Honesty over tidiness",
    why: "A number says when it was true. An em-dash is not a zero. A fabricated comparison is worse than none, deltas are never green or red, and a figure that leaves data out has to admit it.",
  },
];

const TYPE: Array<{ token: string; cls: string; px: string; use: string; sample: string }> = [
  { token: "text-display-md", cls: "stat-numeral text-display-md", px: "28px", use: "Headline numbers, via formatMetricValue — the ledger numeral, set in Inter", sample: "1,204" },
  { token: "text-display-sm", cls: "font-display text-display-sm font-semibold", px: "30px", use: "Reserved — no in-app consumer since page titles came down to 24", sample: "Speed to lead" },
  { token: "text-display-xs", cls: "text-display-xs font-semibold", px: "26px", use: "Page titles (PageHeader), and the legal pages' h1", sample: "Speed to lead" },
  { token: "text-xl", cls: "text-xl font-semibold tracking-tight", px: "20px", use: "The step above a card title, where a section needs one", sample: "Speed to lead" },
  { token: "text-lg", cls: "text-lg font-semibold tracking-tight", px: "18px", use: "Card and modal titles", sample: "Speed to lead" },
  { token: "text-md", cls: "text-md font-semibold", px: "17px", use: "Panel titles, hero list rows", sample: "Speed to lead" },
  { token: "text-sm", cls: "text-sm", px: "14px", use: "Body, menu items, table cells — the default", sample: "Speed to lead" },
  { token: "text-xs", cls: "text-xs", px: "12px", use: "Helper text, captions, dense controls, buttons and field labels", sample: "Speed to lead" },
  {
    token: "text-2xs",
    cls: "label-micro",
    px: "11px",
    use: "The micro badge — ALL CAPS at --tracking-label, and never prose. At 11px a sentence is not small text, it is unreadable text",
    sample: "Speed to lead",
  },
];
const RADII: Array<{ cls: string; label: string; body: string }> = [
  { cls: "rounded-control", label: "control · 8px", body: "Buttons, inputs, selects, tabs, nav rows, the period switch — no pill, final word" },
  { cls: "rounded-card", label: "card · 10px", body: "Tiles, list rows, board cards" },
  { cls: "rounded-surface", label: "surface · 10px", body: "Panels, modals, tables, step cards — the same radius as a card, on a bigger object" },
  /* THE FRAME IS BACK, ON THE OTHER CORNER. It was 32px while the frame
     painted a gradient behind a transparent rail, then 16px, then 0 when the
     rail, the bar and the page became one surface and a notch had nothing
     left to reveal. There is one surface again — page, bar, rail and panel
     all #121214 — so the token is back to 0, and the note below it
     because the step it reveals is a fraction of what the light page was.
     Applied to the panel's TOP-RIGHT corner: every earlier era cut the
     top-left, nearest the rail, and the 4 Sep 2026 Figma does not. The rail
     side butts square behind a hairline. THIS IS A DARK-THEME DEVICE: in
     light, --panel is --background (#F7F8F9) — the page's own colour — so
     the identical cut reveals nothing there, same as it did not two days
     ago. */
  { cls: "rounded-frame", label: "frame · 8px", body: "The panel's top-right corner, under the bar away from the rail" },
];
/**
 * SAMPLE DAYS FOR THE CALENDAR SECTION.
 *
 * Generated rather than typed out, because the kit renders the CURRENT month
 * and a hand-written May would be an empty grid by June. Deterministic on
 * purpose — no `Math.random`, so two renders of this page are the same page,
 * and the heat ramp can be judged against a stable spread. Two metrics, so the
 * picker has something to pick and the two formats (a count and a rate) both
 * get seen.
 */
function kitCalendarDays(seed: number, scale: number, gaps: number[]): Record<string, { value: number; records?: number }> {
  const out: Record<string, { value: number; records?: number }> = {};
  for (const month of calendarMonths()) {
    for (let d = 1; d <= daysInMonth(month); d++) {
      // Weekends off and a few blank weekdays — a real month is not solid.
      const ms = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, d);
      const dow = new Date(ms).getUTCDay();
      if (dow === 0 || dow === 6 || gaps.includes(d)) continue;
      const wave = Math.abs(Math.sin((d + seed) * 1.7));
      out[dayKey(ms)] = { value: Math.round(wave * scale * 10) / 10, records: 1 + Math.round(wave * 26) };
    }
  }
  return out;
}

const KIT_CALENDAR_METRICS: CalendarMetric[] = [
  {
    id: "kit-1",
    flowId: "kit-flow-1",
    flowName: "Speed to lead",
    name: "Leads booked",
    format: { format: "number", precision: 0 },
    days: kitCalendarDays(2, 24, [7, 8, 19]),
    status: "fresh",
    error: null,
    computedAt: null,
  },
  {
    id: "kit-2",
    flowId: "kit-flow-2",
    flowName: "Pickup rate",
    name: "Pickup rate",
    format: { format: "percent", precision: 1 },
    days: kitCalendarDays(5, 100, [3, 14]),
    status: "fresh",
    error: null,
    computedAt: null,
  },
];

const SHADOWS: Array<{ cls: string; body: string }> = [
  { cls: "shadow-card", body: "Rest" },
  { cls: "shadow-card-hover", body: "Hover, drag" },
  { cls: "shadow-surface", body: "Floating over the canvas" },
  { cls: "shadow-panel", body: "Modals" },
];

export default function DesignPage() {
  return (
    // The kit is rendered in the REAL frame, notches and all — a page that
    // showed the rail without the wash behind the canvas would be exactly the
    // drift it exists to catch.
    //
    // It scrolls on `bg-card` rather than the app's warm canvas: this page is
    // a sheet of documentation with swatches printed on it, and half of those
    // swatches ARE surfaces. Rendering white cards on the warm page they are
    // meant to float over would make the samples argue with the sample board.
    <AppFrame
      /* Six specimen views, so the rail's nested list under Dashboard — and its
         "Show all" fold past five — can be looked at rather than reasoned about.
         The kit page is the only public route that mounts the real frame. */
      views={[
        { id: null, name: "Dashboard", pos: "a", kind: "groups", isDefault: true },
        { id: "v1", name: "Revenue", pos: "b", kind: "groups" },
        { id: "v2", name: "Pipeline health", pos: "c", kind: "custom" },
        { id: "v3", name: "Team", pos: "d", kind: "groups" },
        { id: "v4", name: "Weekly review", pos: "e", kind: "custom" },
        { id: "v5", name: "Ops", pos: "f", kind: "groups" },
      ]}
      // The switcher (and the account panel it opens) is gated on `workspace`
      // being truthy — `{workspace && (…)}` in `RailContent` — so without this
      // the kit page's own account panel below is unreachable: no switcher
      // renders, no trigger opens it. "Namzilabs" matches the panel's own
      // hardcoded workspace name a few lines down.
      workspace="Namzilabs"
      surface="overflow-y-auto bg-card"
      account={{
        initials: "EC",
        // Tracks the real panel in src/components/app-shell.tsx: workspace,
        // then identity, then the way out.
        panel: (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
              <p className="truncate text-sm font-semibold text-foreground">Namzilabs</p>
            </div>
            <p className="truncate border-t border-border pt-2 text-xs text-muted-foreground">elias@namzilabs.co</p>
            <Button variant="secondary" size="sm" className="w-full">
              Sign out
            </Button>
          </div>
        ),
      }}
    >
      {/* TWO COLUMNS, AND THE LEFT ONE IS THE REASON THE PAGE IS USABLE.
          Nineteen sections was already a long scroll; with every primitive on
          it as well this is a document, and a document needs a table of
          contents. The index is sticky, hidden below `xl` (where it would eat
          the specimens' width), and derives its hrefs from the same
          `sectionId` the sections do — so a section cannot be renamed without
          its link moving with it. */}
      <div className="mx-auto flex max-w-[1400px] items-start gap-10 px-6 py-12">
        <KitIndex />

        <div className="min-w-0 max-w-4xl flex-1">
        <div className="flex items-start justify-between gap-4">
          {/* `text-marker`, and the eyebrow no longer needs a second token to
              say so. This is TEXT in the brand, which under the old yellow was
              the one thing the brand could not be — #eecf00 measures 1.55:1 on
              a light sheet, so a caps label in it was unreadable on the one
              page whose entire job is to be read, and `--marker-ink` existed to
              carry exactly this case. The blue measures 6.59:1 on the chrome
              this page's `bg-card` renders on, 6.20:1 on the dark panel,
              5.80:1 on white and 5.46:1 on the light page. */}
          <p className="text-xs font-semibold uppercase tracking-widest text-marker">Brand kit</p>
          {/* THE TOGGLE IS GONE, along with the theme it toggled. It belonged on
              this page more than anywhere else while half the kit was role
              tokens that resolved differently under `.dark` — a swatch board
              that can only be seen at one exposure was documenting half of
              itself. There is one exposure now, so the board is complete. */}
        </div>
        {/* The h1 comes from PageHeader like every other page's — a kit page
            that re-typed the title recipe would be the first thing on it that
            had drifted. */}
        <PageHeader
          className="mt-2"
          title="The Namzilabs UI kit"
          lede={
            <span className="block max-w-xl">
              Every token and primitive in one scroll, rendered from the components the product ships. The written half
              is docs/BRAND_KIT.md; when the two disagree, the tokens in globals.css win and both of us are bugs.
            </span>
          }
        />

        {/* THE DIRECTION, ABOVE THE INVENTORY.
            This page is a parts bin: it answers "what is the radius of a menu
            row" and cannot answer "why does the screen look like this". The
            band, the ground and the colour ratio are decisions rather than
            tokens, and somebody arriving here to build a new surface needs them
            first — so they are stated at the top and argued in full in
            DESIGN.md, which this section is the index to. */}
        <Section
          title="The direction"
          note="DESIGN.md is the argued version — this is the shape of it. The chrome, the furniture and the primitives are settled; the metric card, the chart card and the builder's canvas are out of scope for this pass and are deliberately NOT a reference for anything else yet."
        >
          <Card padding="none" className="divide-y divide-border">
            {DIRECTION.map((d) => (
              <div key={d.rule} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <p className="w-56 shrink-0 text-sm font-semibold text-foreground">{d.rule}</p>
                <p className="min-w-0 text-sm text-muted-foreground">{d.why}</p>
              </div>
            ))}
          </Card>
        </Section>

        <Section
          title="Brand sheet"
          note="The supplied sheets, rendered from the shipping components rather than drawn. Kept as the historical record of a language this kit no longer speaks: deep black doing the work, a yellow carrying the act, a violet drawing every line, and everything shaped as a full pill. What survived is the argument rather than the palette — the workhorse is quiet and colour arrives only where it means something, which is now one blue doing a stroke's job and a fill's, across three near-black surfaces."
        >
          <BrandSheet />
        </Section>

        <Section
          title="Colour"
          note="ONE LIME, ONE VALUE ON DARK, and every number measured. #B6FF56 FILLS under NEAR-BLACK ink (#2C2C2C) at 11.59:1 — the inversion is the headline, because blue filled under WHITE and white on lime is 1.20:1, an unreadable label rather than a dim one. The same #B6FF56 DRAWS on dark at 15.53:1, so unlike blue it needs no second step to do both jobs. On white it has the yellow's old problem exactly — 1.20:1, an absent line — so light alone keeps a solved-down stroke at #4F7A00 (5.10:1). The split did not retire, it MOVED: not fill-versus-stroke inside a theme, but one value on dark and one for light's stroke. Beside them sits a three-colour accent set (orange, pink, periwinkle) for surfaces that need to be identifiable rather than to mean something; success, warn and danger keep the job of meaning, and the tile's freshness dot has its own #34C759 so retuning a status can never move it."
        >
          <p className="mb-2 text-xs font-medium text-muted-foreground">Brand — 500 draws, 600 fills, brand-*</p>
          <div className="flex overflow-hidden rounded-card border border-border">
            {BRAND.map((s) => (
              <div key={s.step} className="min-w-0 flex-1">
                <div className={`h-16 ${s.cls}`} />
                <div className="border-t border-border px-2 py-1.5">
                  <p className="text-xs font-medium text-foreground">{s.step}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.hex}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            Surface — eight steps, three of them grounds: 950 page, 925 chrome and card, 900 panel, neutral-*
          </p>
          <div className="flex overflow-hidden rounded-card border border-border">
            {SURFACE.map((s) => (
              <div key={s.step} className="min-w-0 flex-1">
                <div className={`h-16 ${s.cls}`} />
                <div className="border-t border-border px-2 py-1.5">
                  <p className="text-xs font-medium text-foreground">{s.step}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.hex}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            Ink — three values, one per job, neutral-* · 450 is faint — the caps section label only, 3.67:1 on #121214,
            and never a sentence
          </p>
          <div className="flex overflow-hidden rounded-card border border-border">
            {INK.map((s) => (
              <div key={s.step} className="min-w-0 flex-1">
                <div className={`h-16 ${s.cls}`} />
                <div className="border-t border-border px-2 py-1.5">
                  <p className="text-xs font-medium text-foreground">{s.step}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.hex}</p>
                </div>
              </div>
            ))}
          </div>
          {/* THREE ROLES THAT FLIP WITH THE THEME, added 5 Sep 2026. Unlike the
              ramps above, each of these names a DIFFERENT hex per theme by
              construction — that is the entire reason they are roles rather
              than a ramp step — so this row has no single hex to caption and
              is deliberately outside `tests/design-swatches.test.ts`'s ramp
              parser; `tests/theme-roles.test.ts` pins the values in
              globals.css instead. Reload the page in each theme to see the
              swatch itself change. */}
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            Roles that flip with the theme — one name, two values, so a component never spells `dark:`
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <div className="h-16 rounded-card border border-border bg-tab-rule" />
              <p className="mt-1.5 text-xs font-medium text-foreground">tab rule</p>
              <p className="text-xs text-muted-foreground">
                the active tab&apos;s 1px underline: muted-foreground on dark, heading on light
              </p>
            </div>
            <div className="min-w-0">
              <div className="h-16 rounded-card bg-primary-hover" />
              <p className="mt-1.5 text-xs font-medium text-foreground">primary hover</p>
              <p className="text-xs text-muted-foreground">
                brand-500 on dark, brand-700 on light; white ink is 5.22:1 on light&apos;s hover, 3.98:1 on dark&apos;s — a known trade for &quot;raised means lighter&quot;
              </p>
            </div>
            <div className="min-w-0">
              <div className="h-16 rounded-card bg-primary-active" />
              <p className="mt-1.5 text-xs font-medium text-foreground">primary active</p>
              <p className="text-xs text-muted-foreground">the pressed step — brand-700 in both themes</p>
            </div>
          </div>
        </Section>

        <Section
          title="State"
          note="StatusPill wears state; Badge states facts. Five tones and no more — pending is deliberately neutral and replaces every blue 'testing / updating' state, so nothing competes with the accent. Labels are plain English, never raw enums."
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="success" dot>
              Active
            </StatusPill>
            <StatusPill tone="warn" dot>
              Needs attention
            </StatusPill>
            <StatusPill tone="danger" dot>
              Failing
            </StatusPill>
            <StatusPill tone="pending" dot>
              Updating
            </StatusPill>
            <StatusPill tone="brand" dot>
              Selected
            </StatusPill>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge>6 steps</Badge>
            <Badge>Google Sheets</Badge>
            <Badge className="tnum">12</Badge>
          </div>
        </Section>

        <Section title="Type" note="An 8px baseline and 16px spacing, set in INTER — it leads both --font-sans and --font-display as of 6 September 2026, with system-ui and the platform keywords behind it as the fallback. Inter sat fifth in that stack for four days, which meant the webfont loaded on every page was never reached and only the two rules that named it directly (.stat-numeral, .wordmark) actually drew in it; those two name no family now and inherit like everything else. One name per size: the kit's old aliases (micro/tiny/small/base/lead/title/display/stat/hero) have been deleted from the theme, and check:ui fails on them.">
          <Card padding="none" className="divide-y divide-border">
            {TYPE.map((t) => (
              <div key={t.token} className="flex items-baseline gap-4 px-4 py-3">
                <span className={`${t.cls} min-w-0 flex-1 truncate text-foreground`}>{t.sample}</span>
                <code className="shrink-0 font-mono text-xs text-muted-foreground">{t.token}</code>
                <span className="tnum w-10 shrink-0 text-right text-xs text-muted-foreground">{t.px}</span>
                <span className="w-56 shrink-0 text-xs text-muted-foreground">{t.use}</span>
              </div>
            ))}
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Plus text-display-lg (48px) and the fluid text-banner — marketing and the landing page only, never in-app.
          </p>
        </Section>

        <Section
          title="Radius and elevation"
          note="8px-first, the way the 4 September 2026 Figma draws it: every button, input, select, tab, nav row and the period switch is an 8px rectangle, cards and panels take 10px, and circles are reserved for avatars, the bell badge, the freshness dot and the active-count numeral. One elevation ladder — hairline borders carry structure, shadows only say how far a surface floats, and --shadow-card is the export's own value in both themes."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RADII.map((r) => (
              <div key={r.cls} className={`${r.cls} border border-border bg-card p-4 shadow-card`}>
                <p className="text-sm font-semibold text-foreground">{r.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* The real Card, with only its shadow overridden — cn resolves the
                rung, so each tile is the product's surface at a different
                height rather than four re-typed boxes. */}
            {SHADOWS.map((e) => (
              <Card key={e.cls} padding="compact" className={e.cls}>
                <p className="text-sm font-semibold text-foreground">{e.cls}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{e.body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each rung has a ringed twin (raised, lifted, float, pop) whose 1px spread stands in for an edge — for
            borderless surfaces only. Under a real border the rim reads 2px thick and dirty.
          </p>
        </Section>

        <Section title="Buttons" note="One component, twelve variants, seven sizes — every clickable thing in the product comes from it, and 32px is the default because every control in the reference is 32: the date picker, the selects, the segmented groups. The ladder came down from 28/36/44/52, which put a 44px button beside a 40px period track beside a 24px title with nothing in the row standing on the same line. The WORKHORSE is a bordered card chip rather than a solid fill — what a console's ordinary act looks like — which is exactly why the PRIMARY act has to say so: SubmitButton defaults to the brand, because a submit is the primary act by definition and Save rendering as the same object as Cancel is a form with no primary. Links dressed as buttons compose buttonVariants() rather than re-typing the string.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Publish flow</Button>
            <Button variant="accent">Review &amp; publish</Button>
            <Button variant="soft">Pressed</Button>
            <Button variant="outlineAccent">Deject</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Quiet</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="success">Run test</Button>
            <Button variant="destructiveGhost">Remove</Button>
            <Button variant="destructiveOutline">Disconnect</Button>
            <Button variant="link">Learn more</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" variant="secondary" aria-label="Settings">
              <Settings />
            </Button>
            <Button size="iconSm" variant="secondary" aria-label="Add">
              <Plus />
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section
          title="Primitives"
          note="The Radix layer, styled to this kit. Every one of these replaces something the app hand-rolled — a focus trap that re-queried the DOM on each keypress, a 177-line popover positioner, three tab strips that answered no arrow keys, and ~130 title attributes a keyboard user could never reach. Worth testing with the keyboard rather than the pointer: that is the half that changed."
        >
          <PrimitiveSpecimens />
        </Section>

        <Section
          title="Controls"
          note="One field recipe: 40px tall — the same height as the Button beneath it, which the two had drifted apart on (36 vs 40) — hairline border, and the same 4px ring on focus — fields show it whenever they hold focus, buttons only for keyboard users. The label is the question and never reads lighter than its answer. Autofill and spellcheck are OFF by default, because twenty-two of the app's twenty-three fields ask for something no browser has ever stored; a masked field goes further and opts out in four password managers' own dialects (NO_AUTOFILL), since `autocomplete=off` is the one value browsers ignore on one."
        >
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="kit-input">Flow name</FieldLabel>
              <Input id="kit-input" defaultValue="Speed to lead" />
            </div>
            <div>
              <FieldLabel htmlFor="kit-secret">Personal access token</FieldLabel>
              {/* THE REAL COMPONENT, so the attributes below are the ones the
                  connect form ships. A masked field here is not a password —
                  it is an API key pasted once from another tab, which no
                  manager has saved and every manager used to try to fill. */}
              <Input id="kit-secret" type="password" placeholder="cal_live_…" />
              <FieldHint>Never autofilled: `new-password` plus one opt-out per manager.</FieldHint>
            </div>
            <div>
              <FieldLabel htmlFor="kit-input-disabled">Disabled</FieldLabel>
              <Input id="kit-input-disabled" disabled defaultValue="Locked while running" />
            </div>
            <div>
              <FieldLabel htmlFor="kit-select">Source</FieldLabel>
              <NativeSelect id="kit-select" defaultValue="close">
                <option value="close">Close CRM</option>
                <option value="gsheets">Google Sheets</option>
                <option value="calendly">Calendly</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel htmlFor="kit-textarea">Description</FieldLabel>
              <Textarea id="kit-textarea" placeholder="What this flow measures, in a sentence" />
            </div>
            <div>
              <FieldLabel htmlFor="kit-hint">Workspace name</FieldLabel>
              <Input id="kit-hint" defaultValue="Namzilabs" />
              <FieldHint>Shown to teammates in the account panel.</FieldHint>
            </div>
            <div>
              <FieldLabel htmlFor="kit-error">Webhook URL</FieldLabel>
              <Input id="kit-error" aria-invalid defaultValue="not-a-url" />
              <FieldError>Enter a full https:// URL.</FieldError>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-5">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Switch — both sizes</p>
              <div className="flex items-center gap-3">
                <Switch checked />
                <Switch checked={false} />
                <Switch checked size="sm" />
                <Switch checked={false} size="sm" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Chip — a question with one answer showing</p>
              <div className="flex items-center gap-2">
                <Chip active count={12}>
                  Active
                </Chip>
                <Chip count={4}>Paused</Chip>
                <Chip>Drafts</Chip>
              </div>
            </div>
          </div>
          <div className="mt-6 max-w-sm">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Skeleton — sized at the call site to hold its content&apos;s shape</p>
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </Section>

        <Section
          title="Surfaces"
          note="Two rungs of Card carry every boxed thing that is not a button: card for tiles in the page flow, surface for the bigger pieces — tables, panels, places rather than items. Both draw a real border and take the ring-free shadow."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <p className="text-sm font-semibold text-foreground">Card</p>
              <p className="mt-1 text-xs text-muted-foreground">variant=&quot;card&quot; — rounded-card, shadow-card. Tiles and sections.</p>
            </Card>
            <Card variant="surface">
              <p className="text-sm font-semibold text-foreground">Surface</p>
              <p className="mt-1 text-xs text-muted-foreground">variant=&quot;surface&quot; — rounded-surface. Panels, tables, modals.</p>
            </Card>
          </div>

          <TableShell className="mt-4">
            <Table>
              <THead>
                <TR static>
                  <TH>Flow</TH>
                  <TH>Status</TH>
                  <TH>Last run</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD className="font-medium text-foreground">Speed to lead</TD>
                  <TD>
                    <StatusPill tone="success" dot>
                      Active
                    </StatusPill>
                  </TD>
                  <TD className="text-muted-foreground">{formatDate(new Date("2026-08-19T14:45:00Z"))}</TD>
                </TR>
                <TR>
                  <TD className="font-medium text-foreground">Pickup rate</TD>
                  <TD>
                    <StatusPill tone="warn" dot>
                      Needs attention
                    </StatusPill>
                  </TD>
                  <TD className="text-muted-foreground">{formatDate(new Date("2026-08-18T11:20:00Z"))}</TD>
                </TR>
                <TR>
                  <TD className="font-medium text-foreground">Meetings booked</TD>
                  <TD>
                    <StatusPill tone="pending">Draft</StatusPill>
                  </TD>
                  <TD className="text-muted-foreground">—</TD>
                </TR>
              </TBody>
            </Table>
          </TableShell>

          <EmptyState
            className="mt-4"
            icon={<Inbox />}
            title="No flows yet"
            description="Connect an app, then build your first flow from its data."
            action={
              <Button size="sm">
                <Plus />
                New flow
              </Button>
            }
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Card variant="surface" className="shadow-panel">
                <ModalTitle>Delete this flow?</ModalTitle>
                <p className="mt-2 text-sm text-muted-foreground">Its steps and run history go with it. This cannot be undone.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" size="sm">
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm">
                    Delete flow
                  </Button>
                </div>
              </Card>
              <p className="mt-2 text-xs text-muted-foreground">
                The modal, shown flat. The real one floats on the one scrim — neutral-950/40 with backdrop blur — traps
                focus while it is open, locks the page behind it, and returns focus to whatever opened it. Escape or an
                outside press closes it.
              </p>
            </div>
            <div>
              {/* `neutral-700` is the toast's rung — the ladder's "raised"
                  step, which is what `ui/toast.tsx` actually paints. On a
                  near-black surface raised means LIGHTER, so it sits above the
                  page rather than below it. (The `ink-*` ramp this comment used
                  to name was retired with the light theme.) */}
              <div className="inline-flex items-center gap-3 rounded-surface bg-neutral-700 px-4 py-2.5 text-sm text-foreground">
                Flow published
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The toast, shown flat. The real one is fixed bottom-centre and dark on purpose — it floats over the
                working area as chrome, not content.
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="Rail"
          note="A 260px column on --chrome (#121214), the SAME value as the page beside it, separated by one hairline and nothing else. These tiles are a swatch — the real markup lives in src/components/sidebar.tsx and nowhere else, and it has moved on from what is drawn here: the column no longer opens or closes at all, and its foot carries an Invite Members card over the lime New button. The active row takes a neutral --control fill UNDER its glyph, and the glyph keeps text-marker on top of it — two signals, not the Figma's one — so the brand's 'location' job did not retire with the cyan after all; it just no longer carries the state alone."
        >
          <div className="flex items-stretch gap-4">
            {/* `bg-rail`, which is what the real rail is painted. It was
                `bg-background` while the rail, the bar and the page were one
                colour and the distinction cost nothing; under three surfaces
                that would draw the swatch on the PAGE's step and quietly
                misreport the one thing this specimen exists to show. (`--rail`
                itself is long retired — see the retired-token table.) */}
            <div className="inline-flex items-start gap-3 rounded-card bg-rail px-5 py-4">
              <span className="flex w-14 flex-col items-center">
                {/* THE ACTIVE ROW IS NEUTRAL UNDER THE GLYPH, NOT INSTEAD OF
                    IT. The 4 Sep 2026 Figma marks the active row with a
                    `--control` fill and an uncoloured glyph — but RailChip
                    (sidebar.tsx) overrules that on purpose, keeping
                    `text-marker` on the glyph on top of the fill, per WCAG
                    1.4.1: colour cannot carry state alone. Two signals, not
                    the Figma's one. */}
                <span className="flex size-10 items-center justify-center rounded-control bg-control text-marker">
                  <LayoutDashboard size={24} />
                </span>
                <span className="px-1 text-center text-xs font-medium leading-4 text-white">Active</span>
              </span>
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-control bg-neutral-700 text-white">
                  <Workflow size={24} />
                </span>
                <span className="px-1 text-center text-xs font-medium leading-4 text-white">Hover</span>
              </span>
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-control text-white">
                  <Plug size={24} />
                </span>
                <span className="px-1 text-center text-xs font-medium leading-4 text-muted-foreground">Rest</span>
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1 text-xs text-muted-foreground">
              <p>
                The rail is <code className="font-mono text-foreground">--chrome</code>{" "}(#121214), the same value as the
                top bar above it and as the page itself — the card is the one surface that steps away, to #191919
                panel, so its right edge is a real 1px hairline rather than a luminance step you could see unaided.
              </p>
              <p>
                REST IS NOTHING AT ALL. Every chip but one is a bare glyph on the chrome — a white mark measures 18.88:1
                there, so it does not need a plate to be found, and seven pale squares down the column were the loudest
                thing in it. Hover raises to <code className="font-mono text-foreground">--accent</code>{" "}and ACTIVE takes
                a <code className="font-mono text-foreground">--control</code>{" "}fill: neutral, not the brand, because
                where you are is not something you press.
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="Frame"
          note="THE NOTCH IS GONE AGAIN AND --radius-frame IS 0, by its own argument. A radius reveals whatever is BEHIND the element it is cut into. It went to 0 when the rail, the bar and the page were one colour; it came back at 8px on 4 September because a third surface appeared for it to cut into; and the 8 September Figma removes that surface — panel, chrome and page are all #121214 — so the cut reveals #121214 against #121214 and draws nothing at all. This is the same sentence that reinstated it, read in the other direction. The token stays defined so rounded-frame remains a legal spelling for whatever the shell decides next."
        >
          <div className="flex h-40 overflow-hidden rounded-card bg-rail">
            {/* The rail's width, holding the chrome's own colour — the panel
                butts square against it, which is the half of this specimen
                that is easy to miss. */}
            <div className="w-[100px] shrink-0" />
            <div className="flex-1 rounded-tr-frame bg-panel" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A radius reveals whatever is BEHIND the element it is cut into, which is why this specimen paints the frame{" "}
            <code className="font-mono text-foreground">--chrome</code> and the panel inside it{" "}
            <code className="font-mono text-foreground">--panel</code>: with both the same colour the corner would be
            perfectly invisible, which is exactly the argument that took the token to 0 two days ago. Content sits on the
            panel in islands, never flat.
          </p>
        </Section>

        <Section
          title="Marks"
          note="What a dashboard tile is made of. The series is the BRAND — --color-brand-400 (#B6FF56), the same lime as the buttons, with a wash under it — and on dark that is also the stroke step, because the lime clears its bar both ways where the blue did not. A breakdown walks that blue plus the accent three. TargetBar drew met in --success and in-progress in --marker, which were the same green while success WAS the brand — so it rendered both states identically and stopped reporting the only thing it exists to report. That collision is long gone, but the fix outlived it on its own merits: the unmet meter is greyscale and colour ARRIVES when the goal lands, which is the honest reading anyway — a bar at 40% is not good, it is 40%. Every value goes through formatMetricValue, so the tooltip and the headline say the same quantity the same way. A delta is never green or red: up is good for Booked Leads and bad for Speed to Lead, and nothing on a tile knows which — so it is coloured by WHETHER it moved, and the arrow alone carries direction."
        >
          <div className="grid gap-4 rounded-card bg-canvas-bg p-4 sm:grid-cols-2">
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-sm font-semibold text-foreground">Total leads</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <p className="stat-numeral text-display-md leading-none">44</p>
                <Delta current={44} previous={32} format={{ format: "number" }} since="vs prior" />
              </div>
              <Sparkbars
                series={[4, 7, 5, 9, 12, 8, 14, 11, 16, 13, 18, 15].map((v, i) => ({ bucket: `d${i}`, value: v }))}
                format={{ format: "number" }}
              />
            </div>
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-sm font-semibold text-foreground">Pickup rate</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <p className="stat-numeral text-display-md leading-none">57.1%</p>
                <Delta current={57.1} previous={55.1} format={{ format: "percent", precision: 1 }} since="vs yesterday" />
              </div>
              <TargetBar value={57.1} target={50} format={{ format: "percent", precision: 1 }} />
            </div>
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-sm font-semibold text-foreground">Leads by owner</p>
              <p className="stat-numeral mt-1.5 text-display-md leading-none">41</p>
              <GroupBars
                groups={[
                  { label: "Afeef", value: 23 },
                  { label: "Arman", value: 18 },
                  { label: "Unassigned", value: 6 },
                  { label: "Tristan", value: 4 },
                  { label: "Sam", value: 2 },
                ]}
                total={41}
                format={{ format: "number" }}
              />
            </div>
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-sm font-semibold text-foreground">Source marks</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A connector&rsquo;s brand tile, at list scale — rows are read by shape before they are read by word.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {["gsheets", "close", "gcal", "whop", "calendly", "instantly", "webhook"].map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <SourceMark source={s} />
                    <code className="font-mono text-xs text-muted-foreground">{s}</code>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Step icons" note="The step marks — one family, one grid, drawn from node-accent's own colours. Everything else iconographic is lucide: 14 dense, 16 default, 18 toolbar, 24 rail.">
          <div className="flex flex-wrap gap-2">
            {(["app", "unite", "unite_match", "filter", "paths", "formula", "formula_compare", "time_between"] as const).map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-card border border-border bg-card px-3 py-2">
                <NodeIcon type={t.startsWith("unite") ? "unite" : t.startsWith("formula") ? "formula" : t} variant={t.includes("_") ? t : undefined} size={28} />
                <code className="font-mono text-xs text-muted-foreground">{t}</code>
              </div>
            ))}
          </div>
        </Section>

        {/* THE BUILDER'S TOOLBAR HAS NO SPECIMEN ANY MORE, because it is no
            longer a thing of its own to specimen: it portals into the app's
            top bar, which is already at the top of THIS page. Rendering it here
            put a second copy of Review & publish into that bar, on top of New
            flow — a kit page actively lying about the kit.

            What is left of the builder's own chrome — the zoom column, the
            config panel, the step cards — is specimened in the sections below.
            The bar itself is visible on every screen in the product, which is
            the best documentation it could have. */}
        <Section title="Flow list" note="A board of cards, not a spreadsheet of rows — the same grid, radius and elevation the dashboard's tiles use, because the two screens people move between most should be built out of the same object. Zapier's per-row switch is kept: off is paused, not deleted, and the tiles come back with it. The whole card is the link (a stretched overlay), with the switch and the two actions floating above it.">
          {/* Rendered on the warm canvas, which is where it actually lives.
              On this page's white sheet a white card on white is the one thing
              the kit could show that the product never looks like. */}
          <div className="rounded-card bg-canvas-bg p-4">
            <FlowList
              flows={[
                { id: "1", name: "Speed to lead", state: "active", updatedAt: "2026-08-19T14:45:00Z", summary: "6 steps · Close CRM", source: "close" },
                { id: "2", name: "Pickup rate", state: "active", updatedAt: "2026-08-18T11:20:00Z", summary: "4 steps · Close CRM", source: "close", unpublished: true },
                { id: "3", name: "Claimed leads", state: "paused", updatedAt: "2026-08-17T09:10:00Z", summary: "3 steps · Google Sheets", source: "gsheets" },
                { id: "4", name: "Meetings booked", state: "draft", updatedAt: "2026-08-14T16:05:00Z", summary: "2 steps · Calendly", source: "calendly" },
              ]}
            />
          </div>
        </Section>

        <Section
          title="Calendar"
          note="One published metric, day by day, over the two months the materializer stores values for. The fill is a heat ramp keyed to the month's largest day — never green-good/red-bad, because up is good for Booked Leads and bad for Speed to Lead and nothing on a tile says which. A negative day is the one exception and takes the danger tint: below zero is a fact, not an opinion. Every square's number goes through formatMetricValue, so a day reads exactly like the tile it came from."
        >
          {/* The real component with sample days — the same board the product
              ships, so a change to a square lands here or nowhere. */}
          <div className="rounded-card bg-canvas-bg p-4">
            <CalendarBoard metrics={KIT_CALENDAR_METRICS} months={calendarMonths()} todayKey={dayKey(new Date())} />
          </div>
        </Section>

        {/* THE FIRST THING ANYONE EVER SEES, and until now the one surface the
            kit never showed. That is not a coincidence: the line rendering it
            was deleted by accident and every new flow opened onto a blank grid
            for days, because nothing looked at it — not the kit, not
            check:orphans (it is not an exported function), not the type
            checker (it was not asked). All three gaps are closed now; this is
            the third. */}
        <Section
          title="Empty dashboard"
          note="What a workspace with no views sees. The page keeps a heading — that is where you are, not chrome — and drops everything that describes a board: the period track, the tab strip, the action row. The card itself is the same shell as the empty flow below it, because they are the same moment in two places. Left: someone who can create, whose button opens the three-template picker (Columns, Custom, Calendar — the last asks which metric next). Right: someone whose rank cannot, who is told so rather than given a button that will refuse."
        >
          {/* BOTH STATES, the way the empty flow below shows both of its own.
              The second one is the whole reason the gate exists and would
              otherwise have no coverage at all. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-h-[560px] items-center justify-center rounded-card bg-background p-6">
              {/* THE METRIC LIST IS FED HERE so the picker's SECOND step has
                  something to draw. Without it this page could only ever show
                  the "nothing published yet" branch, and the populated list —
                  the one every customer with a metric will see — would have no
                  coverage on the only screen where it can be looked at. Same
                  metrics the calendar section below uses. */}
              <EmptyBoard
                rangeKey="7d"
                source={null}
                canCreate
                calendarOptions={KIT_CALENDAR_METRICS.map((m) => ({
                  key: `flow:${m.id}`,
                  name: m.name,
                  hint: m.flowName,
                }))}
              />
            </div>
            <div className="flex min-h-[560px] items-center justify-center rounded-card bg-background p-6">
              <EmptyBoard rangeKey="7d" source={null} canCreate={false} />
            </div>
          </div>
        </Section>

        <Section title="Empty flow" note="Both states of the first screen. With an account connected the button MAKES a Get data step and opens its panel — the old version opened the full picker, from which a first-timer could choose a step that needs an input there is no way to give it.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="relative h-[420px] overflow-hidden rounded-card bg-canvas-bg">
              <div
                className="absolute inset-0"
                style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
              />
              <EmptyCanvasPreview hasConnections />
            </div>
            <div className="relative h-[420px] overflow-hidden rounded-card bg-canvas-bg">
              <div
                className="absolute inset-0"
                style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
              />
              <EmptyCanvasPreview hasConnections={false} />
            </div>
          </div>
        </Section>

        <Section title="The canvas" note="Cards, connectors and the ghost next-step — the rhythm between them is most of what a canvas is.">
          <CanvasPreview />
        </Section>

        <Section title="Step cards" note="300px, a 44px mark, the step number as its own chip, and 4px of the step's own colour on the leading edge. The rest of the border is one grey and never changes — status is the dot and the hint line; selection is a halo outside the border, so the card never wears two rims at once.">
          <div className="relative flex flex-wrap items-start gap-4 overflow-hidden rounded-card bg-canvas-bg p-6">
            {/* The same dot field the other canvas specimens carry — a card
                judged against flat grey is judged against a surface the product
                does not have. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
            />
            <span className="relative flex flex-wrap items-start gap-4">
              <FlowNodeCard variant="unite_match" title="Match" body="Needs two steps" status="setup" stepNo={3} />
              <FlowNodeCard variant="formula_compare" title="Calculate" body="38" status="ready" stepNo={4} />
            </span>
          </div>
        </Section>

        <Section
          title="Config panel"
          note="The most-used surface in the product. The shell and the tab row are IMPORTED from panel-chrome.tsx — the same two exports ConfigPanel renders, so there is one definition of them and a change lands here or nowhere. Everything between them is sample content built from the kit's own fields: a Summarize step, mid-configure."
        >
          {/* On the canvas colour, because that is what it floats over: the
              canvas is frozen (--canvas-bg, out of scope for this pass) and
              the panel is --card, so its border, its elevation and its 10px
              corner (rounded-surface) are what keep it from reading as more
              canvas. The 452px width IS the real one; the fixed height
              stands in for the band between the builder's two chrome bars. */}
          <div className="relative overflow-hidden rounded-card bg-canvas-bg p-6">
            <div
              className="absolute inset-0"
              style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
            />
            <div className="relative flex justify-end">
              <aside className={`h-[440px] w-[452px] max-w-full ${PANEL_SHELL}`}>
                {/* The header's SHAPE, mirroring ConfigPanel: which step and
                    what state on the eyebrow, the editable name at full width
                    beneath it, and a close control — the panel used to be
                    dismissable only by finding empty canvas to click. */}
                <div className="flex items-center gap-3 border-b border-border bg-card px-5 py-4">
                  <NodeIcon type="formula" size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 3</span>
                      <StatusPill tone="success">Tested</StatusPill>
                    </div>
                    <p className="-ml-1.5 mt-0.5 truncate px-1.5 py-1 text-lg font-semibold tracking-tight text-foreground">Summarize</p>
                  </div>
                  <span className="-mr-1.5 shrink-0 self-start rounded-control p-1.5 text-muted-foreground">
                    <X size={18} />
                  </span>
                </div>

                <PanelTabsPreview />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-4 p-5">
                    <div>
                      <FieldLabel htmlFor="kit-panel-calc">Calculation</FieldLabel>
                      <NativeSelect id="kit-panel-calc" defaultValue="count">
                        <option value="count">Count records</option>
                        <option value="sum">Sum a field</option>
                        <option value="avg">Average a field</option>
                      </NativeSelect>
                    </div>
                    <div>
                      <FieldLabel htmlFor="kit-panel-measure">Measuring</FieldLabel>
                      <NativeSelect id="kit-panel-measure" defaultValue="number">
                        <option value="number">A number</option>
                        <option value="duration">A length of time</option>
                      </NativeSelect>
                    </div>
                    <div>
                      <FieldLabel htmlFor="kit-panel-result">Result</FieldLabel>
                      <NativeSelect id="kit-panel-result" defaultValue="one">
                        <option value="one">One number</option>
                        <option value="trend">A trend</option>
                      </NativeSelect>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </Section>

        <Section
          title="Filter conditions"
          note="The REAL ConditionEditor, live — press Duplicate and it copies the condition in place, directly under the one it came from. It is here because it could not be looked at anywhere else: this control only appears inside a Filter step's panel, which is behind auth, and it earned a Duplicate button precisely because building three alternatives on one field meant choosing that field and its operator three times. Position is cosmetic — every condition joins by the same combinator — so the copy goes where it reads best."
        >
          {/* On the canvas colour and at the panel's real 452px, because that
              is the width these controls are actually laid out in: a condition
              card measured across a full page proves nothing about the box it
              ships in. */}
          <div className="rounded-card bg-canvas-bg p-6">
            <div className="w-[452px] max-w-full rounded-card border border-border bg-card p-5">
              <ConditionEditorPreview />
            </div>
          </div>
        </Section>

        <Section
          title="Every component"
          note="All 138 exports from the 31 files in src/components/ui, with every variant axis enumerated to its last value. The nine primitives this page used to show were the nine that happened to be interesting; the twenty-odd that arrive through a trailing export block — alert, avatar, breadcrumb, command, progress, scroll-area, sheet, tabs — were not on the page at all, which is most of how they came to ship unused. Anything that portals (dialog, sheet, select, menu, popover, tooltip) renders nothing until you open it, so those are working triggers rather than pictures."
        >
          <Gallery />
        </Section>

        <Section
          title="Coverage"
          note="What the kit can do, against what the product actually reaches for. Counted by import-path grep across src/, excluding the primitives themselves and this page. This is the section to read first if the app feels inconsistent: fourteen of the thirty-one primitives are imported by nothing, and every one of them has a hand-written stand-in somewhere that was designed once, for one screen."
        >
          <CoverageAudit />
        </Section>

        <Section
          title="Patterns, and what is wrong with each"
          note="A reviewer sees composed screens, not loose primitives, so this is where 'does it look finished' is actually decided. Each entry names the file to start from. The flow builder's canvas and nodes are deliberately absent — they are out of scope."
        >
          <PatternAudit />
        </Section>

        <div className="h-16" />
        </div>
      </div>
    </AppFrame>
  );
}

/**
 * THE INDEX. Titles are listed once here and hashed through the same
 * `sectionId` the sections use, so the two cannot drift apart silently.
 */
const SECTIONS = [
  // First, because it is the argument the rest of the page is an inventory of.
  "The direction",
  "Brand sheet",
  "Colour",
  "State",
  "Type",
  "Radius and elevation",
  "Buttons",
  "Primitives",
  "Controls",
  "Surfaces",
  "Rail",
  "Frame",
  "Marks",
  "Step icons",
  "Flow list",
  "Calendar",
  "Empty dashboard",
  "Empty flow",
  "The canvas",
  "Step cards",
  "Config panel",
  "Filter conditions",
  "Every component",
  "Coverage",
  "Patterns, and what is wrong with each",
];

function KitIndex() {
  return (
    <aside className="sticky top-6 hidden w-56 shrink-0 xl:block">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
      <nav>
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s}>
              <a
                href={`#${sectionId(s)}`}
                className="block rounded-control px-2 py-1 text-xs text-muted-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-accent hover:text-foreground"
              >
                {s}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

/**
 * `id` is derived from the title rather than passed, so a section cannot be
 * added to the page and left out of the index — the two read the same list.
 */
export function sectionId(title: string): string {
  return "s-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section id={sectionId(title)} className="mt-12 scroll-mt-20">
      <SectionHeading className="mb-0">{title}</SectionHeading>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}
