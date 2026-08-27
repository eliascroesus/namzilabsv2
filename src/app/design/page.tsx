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
import { NodeIcon } from "@/components/flow/icons";
import { ToolbarPreview } from "@/components/flow/toolbar-preview";
import { PanelTabsPreview } from "@/components/flow/panel-preview";
import { PANEL_SHELL } from "@/components/flow/panel-chrome";
import { FlowList } from "@/app/dashboard/flows/FlowRow";
import { CalendarBoard, type CalendarMetric } from "@/app/dashboard/calendar/CalendarBoard";
import { calendarMonths, dayKey, daysInMonth } from "@/lib/metrics/calendar";
import { Delta, GroupBars, Sparkbars, TargetBar } from "@/components/charts";
import { SourceMark } from "@/components/source-mark";
import { PrimitiveSpecimens } from "./primitives";

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
  { step: "50", cls: "bg-brand-50", hex: "#eef1fe" },
  { step: "100", cls: "bg-brand-100", hex: "#e0e5fd" },
  { step: "200", cls: "bg-brand-200", hex: "#c5cdfb" },
  { step: "300", cls: "bg-brand-300", hex: "#9eaaf7" },
  { step: "400", cls: "bg-brand-400", hex: "#7183f1" },
  { step: "500", cls: "bg-brand-500", hex: "#4a5ee8" },
  { step: "600", cls: "bg-brand-600", hex: "#2b44d8" },
  { step: "700", cls: "bg-brand-700", hex: "#2135b3" },
];
const INK: Array<{ step: string; cls: string; hex: string }> = [
  { step: "950", cls: "bg-ink-950", hex: "#1b1a18" },
  { step: "900", cls: "bg-ink-900", hex: "#262421" },
  { step: "800", cls: "bg-ink-800", hex: "#322f2b" },
  { step: "700", cls: "bg-ink-700", hex: "#423e39" },
  { step: "400", cls: "bg-ink-400", hex: "#9c958b" },
  { step: "100", cls: "bg-ink-100", hex: "#e9e5df" },
  { step: "50", cls: "bg-ink-50", hex: "#f8f6f3" },
];
/**
 * UNTITLED UI'S SCALE. The legacy names still compile as aliases onto these
 * steps while the app is migrated surface by surface, so this table lists the
 * step you should REACH FOR — not the eight spellings currently in the tree.
 *
 * Two pairs collapsed on the way in: micro (11px) and tiny (12px) both became
 * `xs`, and small (13px) and base (14px) both became `sm`. Neither pair was a
 * step anyone could pick out of a line-up.
 */
const TYPE: Array<{ token: string; cls: string; px: string; use: string; sample: string }> = [
  { token: "text-display-md", cls: "stat-numeral text-display-md", px: "36px", use: "Headline numbers, via formatMetricValue — set in the display face", sample: "1,204" },
  { token: "text-display-xs", cls: "font-display text-display-xs font-semibold", px: "24px", use: "Page titles (PageHeader) — display face", sample: "Speed to lead" },
  { token: "text-xl", cls: "text-xl font-semibold tracking-tight", px: "20px", use: "The step above a card title, where a section needs one", sample: "Speed to lead" },
  { token: "text-lg", cls: "text-lg font-semibold tracking-tight", px: "18px", use: "Card and modal titles", sample: "Speed to lead" },
  { token: "text-md", cls: "text-md font-semibold", px: "16px", use: "Panel titles, hero list rows", sample: "Speed to lead" },
  { token: "text-sm", cls: "text-sm", px: "14px", use: "Body, field labels, menu items — the default", sample: "Speed to lead" },
  { token: "text-xs", cls: "text-xs", px: "12px", use: "Helper text, captions, rail labels, badges", sample: "Speed to lead" },
];
const RADII: Array<{ cls: string; label: string; body: string }> = [
  { cls: "rounded-control", label: "control · 8px", body: "Buttons, inputs, menu rows" },
  { cls: "rounded-card", label: "card · 12px", body: "Tiles, list rows, rail tiles" },
  { cls: "rounded-surface", label: "surface · 16px", body: "Panels, modals, tables, step cards" },
  { cls: "rounded-frame", label: "frame · 32px", body: "The app's own left edge" },
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
      surface="overflow-y-auto bg-card"
      account={{
        initials: "EC",
        // Tracks the real panel in src/components/app-shell.tsx: workspace,
        // then identity, then the way out.
        panel: (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
              <p className="truncate text-small font-semibold text-foreground">Namzilabs</p>
            </div>
            <p className="truncate border-t border-border pt-2 text-tiny text-muted-foreground">elias@namzilabs.co</p>
            <Button variant="secondary" size="sm" className="w-full">
              Sign out
            </Button>
          </div>
        ),
      }}
    >
      <div className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-micro font-semibold uppercase tracking-widest text-primary">Brand kit</p>
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

        <Section
          title="Colour"
          note="One accent: ultramarine. brand-600 is every primary action and link (7.19:1 on white), brand-400 the focus ring, 50/100 the selection washes. Ink is the warm dark end of the neutral scale — the rail sits on ink-950, the toast on ink-900. Everything else is a role (bg-card, border-border, text-muted-foreground) or a state trio."
        >
          <p className="mb-2 text-tiny font-medium text-muted-foreground">Accent — ultramarine, brand-*</p>
          <div className="flex overflow-hidden rounded-card border border-border">
            {BRAND.map((s) => (
              <div key={s.step} className="min-w-0 flex-1">
                <div className={`h-16 ${s.cls}`} />
                <div className="border-t border-border px-2 py-1.5">
                  <p className="text-micro font-medium text-foreground">{s.step}</p>
                  <p className="truncate font-mono text-micro text-muted-foreground">{s.hex}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-5 text-tiny font-medium text-muted-foreground">Ink — warm dark surfaces, ink-*</p>
          <div className="flex overflow-hidden rounded-card border border-border">
            {INK.map((s) => (
              <div key={s.step} className="min-w-0 flex-1">
                <div className={`h-16 ${s.cls}`} />
                <div className="border-t border-border px-2 py-1.5">
                  <p className="text-micro font-medium text-foreground">{s.step}</p>
                  <p className="truncate font-mono text-micro text-muted-foreground">{s.hex}</p>
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

        <Section title="Type" note="Untitled UI's scale, and nothing between the steps. The kit's old names (micro/tiny/small/base/lead/title/display/stat) still compile as aliases while the app migrates, but new work reaches for these. Weights stop at font-semibold — font-bold does not exist here.">
          <Card padding="none" className="divide-y divide-border">
            {TYPE.map((t) => (
              <div key={t.token} className="flex items-baseline gap-4 px-4 py-3">
                <span className={`${t.cls} min-w-0 flex-1 truncate text-foreground`}>{t.sample}</span>
                <code className="shrink-0 font-mono text-micro text-muted-foreground">{t.token}</code>
                <span className="tnum w-10 shrink-0 text-right text-micro text-muted-foreground">{t.px}</span>
                <span className="w-56 shrink-0 text-tiny text-muted-foreground">{t.use}</span>
              </div>
            ))}
          </Card>
          <p className="mt-2 text-tiny text-muted-foreground">
            Plus text-hero (40px) — marketing and the landing page only, never in-app.
          </p>
        </Section>

        <Section
          title="Radius and elevation"
          note="Four radius tokens plus rounded-full for pills, avatars and switches — stock rounded/-md/-lg/-xl are banned and do not compile. One elevation ladder: hairline borders carry structure, shadows only say how far a surface floats."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RADII.map((r) => (
              <div key={r.cls} className={`${r.cls} border border-border bg-card p-4 shadow-card`}>
                <p className="text-small font-semibold text-foreground">{r.label}</p>
                <p className="mt-0.5 text-tiny text-muted-foreground">{r.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* The real Card, with only its shadow overridden — cn resolves the
                rung, so each tile is the product's surface at a different
                height rather than four re-typed boxes. */}
            {SHADOWS.map((e) => (
              <Card key={e.cls} padding="compact" className={e.cls}>
                <p className="text-small font-semibold text-foreground">{e.cls}</p>
                <p className="mt-0.5 text-tiny text-muted-foreground">{e.body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-tiny text-muted-foreground">
            Each rung has a ringed twin (raised, lifted, float, pop) whose 1px spread stands in for an edge — for
            borderless surfaces only. Under a real border the rim reads 2px thick and dirty.
          </p>
        </Section>

        <Section title="Buttons" note="One component, eight variants, five sizes — every clickable thing in the product comes from it. Links dressed as buttons compose buttonVariants() rather than re-typing the string.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Publish flow</Button>
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
          note="One field recipe: 36px tall, hairline border, and the same 4px ring on focus — fields show it whenever they hold focus, buttons only for keyboard users. The label is the question and never reads lighter than its answer. Autofill and spellcheck are OFF by default, because twenty-two of the app's twenty-three fields ask for something no browser has ever stored; a masked field goes further and opts out in four password managers' own dialects (NO_AUTOFILL), since `autocomplete=off` is the one value browsers ignore on one."
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
              <p className="mb-2 text-tiny font-medium text-muted-foreground">Switch — both sizes</p>
              <div className="flex items-center gap-3">
                <Switch checked />
                <Switch checked={false} />
                <Switch checked size="sm" />
                <Switch checked={false} size="sm" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-tiny font-medium text-muted-foreground">Chip — a question with one answer showing</p>
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
            <p className="mb-2 text-tiny font-medium text-muted-foreground">Skeleton — sized at the call site to hold its content&apos;s shape</p>
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
              <p className="text-base font-semibold text-foreground">Card</p>
              <p className="mt-1 text-tiny text-muted-foreground">variant=&quot;card&quot; — rounded-card, shadow-card. Tiles and sections.</p>
            </Card>
            <Card variant="surface">
              <p className="text-base font-semibold text-foreground">Surface</p>
              <p className="mt-1 text-tiny text-muted-foreground">variant=&quot;surface&quot; — rounded-surface. Panels, tables, modals.</p>
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
                <p className="mt-2 text-base text-muted-foreground">Its steps and run history go with it. This cannot be undone.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" size="sm">
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm">
                    Delete flow
                  </Button>
                </div>
              </Card>
              <p className="mt-2 text-tiny text-muted-foreground">
                The modal, shown flat. The real one floats on the one scrim — neutral-950/40 with backdrop blur — traps
                focus while it is open, locks the page behind it, and returns focus to whatever opened it. Escape or an
                outside press closes it.
              </p>
            </div>
            <div>
              <div className="inline-flex items-center gap-3 rounded-surface bg-ink-900 px-4 py-2.5 text-base text-ink-50">
                Flow published
              </div>
              <p className="mt-2 text-tiny text-muted-foreground">
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
                <span className="px-1 text-center text-tiny font-medium leading-4 text-white">Active</span>
              </span>
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-card bg-white/10 text-white">
                  <Workflow size={24} strokeWidth={2} />
                </span>
                <span className="px-1 text-center text-tiny font-medium leading-4 text-white">Hover</span>
              </span>
              <span className="flex w-14 flex-col items-center">
                <span className="flex size-10 items-center justify-center rounded-card text-white">
                  <Plug size={24} strokeWidth={2} />
                </span>
                <span className="px-1 text-center text-tiny font-medium leading-4 text-white/75">Rest</span>
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1 text-tiny text-muted-foreground">
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
          <p className="mt-2 text-tiny text-muted-foreground">
            The page inside the notch is <code className="font-mono text-foreground">--color-canvas-bg</code> — the same
            warm surface the builder's canvas uses. Content sits on it in white islands, never flat on the page.
          </p>
        </Section>

        <Section
          title="Marks"
          note="What a dashboard tile is made of. Bars are brand-600, a met goal turns success, tracks are bg-muted, and every value a mark prints goes through formatMetricValue — the tooltip and the headline must say the same quantity the same way. A delta is never green or red: up is good for Booked Leads and bad for Speed to Lead, and nothing on a tile says which."
        >
          <div className="grid gap-4 rounded-card bg-canvas-bg p-4 sm:grid-cols-2">
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-base font-semibold text-foreground">Total leads</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <p className="stat-numeral text-stat leading-none">44</p>
                <Delta current={44} previous={32} format={{ format: "number" }} since="vs prior" />
              </div>
              <Sparkbars
                series={[4, 7, 5, 9, 12, 8, 14, 11, 16, 13, 18, 15].map((v, i) => ({ bucket: `d${i}`, value: v }))}
                format={{ format: "number" }}
              />
            </div>
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-base font-semibold text-foreground">Pickup rate</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <p className="stat-numeral text-stat leading-none">57.1%</p>
                <Delta current={57.1} previous={55.1} format={{ format: "percent", precision: 1 }} since="vs yesterday" />
              </div>
              <TargetBar value={57.1} target={50} format={{ format: "percent", precision: 1 }} />
            </div>
            <div className="rounded-surface border border-border bg-card p-5 shadow-card">
              <p className="text-base font-semibold text-foreground">Leads by owner</p>
              <p className="stat-numeral mt-1.5 text-stat leading-none">41</p>
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
              <p className="text-base font-semibold text-foreground">Source marks</p>
              <p className="mt-1 text-tiny text-muted-foreground">
                A connector&rsquo;s brand tile, at list scale — rows are read by shape before they are read by word.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {["gsheets", "close", "gcal", "whop", "calendly", "instantly", "webhook"].map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <SourceMark source={s} />
                    <code className="font-mono text-micro text-muted-foreground">{s}</code>
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
                <code className="font-mono text-micro text-muted-foreground">{t}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Builder chrome" note="Two surfaces. The bar spans the top: back and the step menu on the left, the flow's NAME dead-centre — the one thing here that is about the flow rather than about what you can do to it — then saved, on/off, undo, redo, run and ship on the right. Zoom and fit are the only controls about LOOKING rather than about the flow, so they sit apart in their own column at the foot.">
          {/* THE INNER CANVAS IS 1292px BECAUSE A REAL ONE IS — a 1440 viewport
              minus the 100px rail minus the two 24px insets. The bar fills it:
              1244px, with the centre group measured dead-centre (470px of bar
              on each side of it).

              Rendered at this page's own column it was a lie: the bar hit
              its max-width, squeezed, and showed a flow name clipped in a way
              the product does not do at any width a laptop has. So the box
              scrolls sideways rather than compressing the specimen. */}
          <div className="-mx-24 overflow-x-auto overflow-y-hidden rounded-card">
            <div className="relative h-[380px] w-[1292px] bg-canvas-bg">
              <div
                className="absolute inset-0"
                style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
              />
              <ToolbarPreview />
            </div>
          </div>
        </Section>

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
                      <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Step 3</span>
                      <StatusPill tone="success">Tested</StatusPill>
                    </div>
                    <p className="-ml-1.5 mt-0.5 truncate px-1.5 py-1 text-title font-semibold tracking-tight text-foreground">Summarize</p>
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

        <div className="h-16" />
      </div>
    </AppFrame>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <SectionHeading className="mb-0">{title}</SectionHeading>
      <p className="mb-4 mt-1 text-tiny text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}
