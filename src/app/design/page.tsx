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
import { ThemeToggle } from "@/components/theme";
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
const BRAND: Array<{ step: string; cls: string; hex: string }> = [
  { step: "50", cls: "bg-brand-50", hex: "#f3eeff" },
  { step: "100", cls: "bg-brand-100", hex: "#e7dcff" },
  { step: "200", cls: "bg-brand-200", hex: "#d0bcff" },
  { step: "300", cls: "bg-brand-300", hex: "#b494ff" },
  { step: "400", cls: "bg-brand-400", hex: "#9670ff" },
  { step: "500", cls: "bg-brand-500", hex: "#7c4dff" },
  { step: "600", cls: "bg-brand-600", hex: "#6d3aff" },
  { step: "700", cls: "bg-brand-700", hex: "#6229f0" },
];
const INK: Array<{ step: string; cls: string; hex: string }> = [
  { step: "950", cls: "bg-ink-950", hex: "#0f0f0f" },
  { step: "900", cls: "bg-ink-900", hex: "#1a1a1a" },
  { step: "800", cls: "bg-ink-800", hex: "#2b2b2b" },
  { step: "700", cls: "bg-ink-700", hex: "#3d3d3d" },
  { step: "400", cls: "bg-ink-400", hex: "#a3a3a3" },
  { step: "100", cls: "bg-ink-100", hex: "#e8e8e8" },
  { step: "50", cls: "bg-ink-50", hex: "#fafafa" },
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
    rule: "The band never inverts",
    why: "The rail and top bar are ink-950 at both exposures; only the page inside them switches. A rail that changes colour with the theme is a rail with no identity — it is the one thing on screen that says where you are before you read a word.",
  },
  {
    rule: "Content floats on the ground",
    why: "Nothing sits flat on the page but a heading or a caption. Everything with content in it is an island with an edge — and it follows the theme rather than fighting it, because a card pinned to one exposure carries ink solved for the other.",
  },
  {
    rule: "One colour, one job",
    why: "Near-black works, violet marks selection, yellow is the single hero act per screen, green says which slice of this page. Yellow's scarcity IS its meaning; a second one halves the value of the first.",
  },
  {
    rule: "Pills press, rectangles contain",
    why: "Everything clickable is a full pill; everything holding something takes 8 / 12 / 16px. The exception proves it — a control that WRAPS takes the 8px radius, because a full radius on a two-line box renders as a circle.",
  },
  {
    rule: "Two sizes do the work",
    why: "14px interface, 12px labels. 16px is reading prose only. The micro-label voice — 12px, ALL CAPS, tracked, muted — is the product's signature and what lets a small string read as a label rather than as very small prose.",
  },
  {
    rule: "The active thing is the heavier one",
    why: "Weight, ink and the mark all move together. This ran backwards in the view strip for a while, so the five tabs you were NOT on were the boldest words in the row.",
  },
  {
    rule: "A press lands immediately",
    why: "The control lights on the press and its content becomes content-shaped skeletons while the server answers. Never dim the old numbers — a legible figure under a pill that now says something else is a wrong answer shown confidently.",
  },
  {
    rule: "Honesty over tidiness",
    why: "A number says when it was true. An em-dash is not a zero. A fabricated comparison is worse than none, deltas are never green or red, and a figure that leaves data out has to admit it.",
  },
];

const TYPE: Array<{ token: string; cls: string; px: string; use: string; sample: string }> = [
  { token: "text-display-md", cls: "stat-numeral text-display-md", px: "36px", use: "Headline numbers, via formatMetricValue — set in the display face", sample: "1,204" },
  { token: "text-display-sm", cls: "font-display text-display-sm font-semibold", px: "30px", use: "Page titles (PageHeader) — display face", sample: "Speed to lead" },
  { token: "text-display-xs", cls: "font-display text-display-xs font-semibold", px: "24px", use: "Document headings — the legal pages' h1", sample: "Speed to lead" },
  { token: "text-xl", cls: "text-xl font-semibold tracking-tight", px: "20px", use: "The step above a card title, where a section needs one", sample: "Speed to lead" },
  { token: "text-lg", cls: "text-lg font-semibold tracking-tight", px: "18px", use: "Card and modal titles", sample: "Speed to lead" },
  { token: "text-md", cls: "text-md font-semibold", px: "16px", use: "Panel titles, hero list rows", sample: "Speed to lead" },
  { token: "text-sm", cls: "text-sm", px: "14px", use: "Body, menu items, table cells — the default", sample: "Speed to lead" },
  { token: "text-xs", cls: "text-xs", px: "12px", use: "Helper text, captions, badges, and field labels — which are ALL CAPS with tracking", sample: "Speed to lead" },
];
const RADII: Array<{ cls: string; label: string; body: string }> = [
  { cls: "rounded-control", label: "control · pill", body: "Buttons, inputs, menu rows" },
  { cls: "rounded-card", label: "card · 10px", body: "Tiles, list rows, rail tiles" },
  { cls: "rounded-surface", label: "surface · 16px", body: "Panels, modals, tables, step cards" },
  { cls: "rounded-frame", label: "frame · 0", body: "Retired — the sidebar is flush with the page now" },
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
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Brand kit</p>
          {/* THE TOGGLE BELONGS ON THIS PAGE MORE THAN ANYWHERE ELSE. Half the
              kit is a set of role tokens that resolve differently under
              `.dark`, and a swatch board that can only be seen at one exposure
              is documenting half of itself. */}
          <ThemeToggle />
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
          note="DESIGN.md is the argued version — this is the shape of it. The band and the furniture are settled; the metric card and the chart card are mid-rework and are deliberately NOT a reference for anything else yet."
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
          note="The supplied sheets, rendered from the shipping components rather than drawn — deep black doing the work, a neon yellow hero, vibrant violet as the branded action, and a four-colour accent set for chips and tabs. Everything is a full pill and every micro label is ALL CAPS, which is the sheet's own voice. Where the two sheets disagreed, the first won on hierarchy: black is the workhorse and colour arrives only where it means something."
        >
          <BrandSheet />
        </Section>

        <Section
          title="Colour"
          note="Three colours carry the brand: DEEP BLACK #1A1A1A, OFF-WHITE #F5F5F5 and VIBRANT VIOLET #7C4DFF. Fills take brand-500, the violet the sheet names; text and links take brand-700, because the 500 measures 4.42:1 on off-white and that is under AA — the colour survives, the reading of it is legal. Beside them sits a four-colour accent set (yellow, orange, pink, periwinkle) for surfaces that need to be identifiable rather than to mean something; success, warn and danger keep the job of meaning."
        >
          <p className="mb-2 text-xs font-medium text-muted-foreground">Accent — brand-*</p>
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
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">Ink — dark surfaces, ink-*</p>
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

        <Section title="Type" note="An 8px baseline and 16px spacing, set in Helvetica Neue — native on macOS, with Inter carrying every other platform rather than dropping to Arial. One name per size: the kit's old aliases (micro/tiny/small/base/lead/title/display/stat/hero) have been deleted from the theme, and check:ui fails on them.">
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
          note="Pill-first, the way the sheet draws it: every button, input and menu row is fully round, cards take 10px and panels 16px. One elevation ladder — hairline borders carry structure, shadows only say how far a surface floats."
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

        <Section title="Buttons" note="One component, eight variants, five sizes — every clickable thing in the product comes from it. Links dressed as buttons compose buttonVariants() rather than re-typing the string.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Publish flow</Button>
            <Button variant="yellow">Sign in with Apple</Button>
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
              <div className="inline-flex items-center gap-3 rounded-surface bg-ink-900 px-4 py-2.5 text-sm text-ink-50">
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
          note="The 30 of the 60/30/10 split: ink-950 warm near-black carrying a 100px icon column, so primary ultramarine has something to pop against. These tiles are a swatch — the real markup lives in src/components/sidebar.tsx and nowhere else."
        >
          <div className="flex items-stretch gap-4">
            <div className="bg-rail inline-flex items-start gap-3 rounded-card px-5 py-4">
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-card bg-white/15 text-white">
                  <LayoutDashboard size={24} strokeWidth={2} />
                </span>
                <span className="px-1 text-center text-xs font-medium leading-4 text-white">Active</span>
              </span>
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-card bg-white/10 text-white">
                  <Workflow size={24} strokeWidth={2} />
                </span>
                <span className="px-1 text-center text-xs font-medium leading-4 text-white">Hover</span>
              </span>
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-card text-white">
                  <Plug size={24} strokeWidth={2} />
                </span>
                <span className="px-1 text-center text-xs font-medium leading-4 text-white/75">Rest</span>
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1 text-xs text-muted-foreground">
              <p>
                <code className="font-mono text-foreground">--color-rail</code> = ink-950. Flat, not a gradient.
              </p>
              <p>
                Selection highlights the 40px tile alone — white/15 behind the glyph, white/10 on hover, and the label
                steps from 75% to full white. Glyphs stay full white at every state.
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="Frame"
          note="Every authenticated page, not just the builder: the app cuts the 32px frame radius out of the page's left corners and lets the rail's wash show through, so the shape of the application never changes as you move around it. Right, top and bottom stay flush to the viewport — a card inset on all four sides is a smaller-feeling app. AppFrame paints the wash once and the rail sits transparent on top of it, so the two colours cannot drift."
        >
          <div className="bg-rail flex h-40 overflow-hidden rounded-card">
            <div className="w-[100px] shrink-0" />
            <div className="flex-1 rounded-l-frame bg-canvas-bg" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The page inside the notch is <code className="font-mono text-foreground">--color-canvas-bg</code> — the same
            warm surface the builder's canvas uses. Content sits on it in white islands, never flat on the page.
          </p>
        </Section>

        <Section
          title="Marks"
          note="What a dashboard tile is made of. The series is violet, the last bucket takes the ink (a positional fact, not a verdict), a met goal turns success, and a breakdown walks the accent four. Yellow is deliberately absent — a board is a wall of these, and a hero that appears twenty times is not a hero. Every value goes through formatMetricValue, so the tooltip and the headline say the same quantity the same way. A delta is never green or red: up is good for Booked Leads and bad for Speed to Lead, and nothing on a tile knows which — so it is coloured by WHETHER it moved, and the arrow alone carries direction."
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
            <div className="flex h-[460px] items-center justify-center rounded-card bg-ground p-6">
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
            <div className="flex h-[460px] items-center justify-center rounded-card bg-ground p-6">
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
          {/* On the canvas colour, because that is what it floats over: a white
              panel on a white page is an invisible box, and its border, its
              elevation and its 16px corner are the whole point of showing it.
              The 452px width IS the real one; the fixed height stands in for
              the band between the builder's two chrome bars. */}
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
                    <X size={18} strokeWidth={2} />
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
                className="block rounded-control px-2 py-1 text-xs text-muted-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted hover:text-foreground"
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
