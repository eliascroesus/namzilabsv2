import { Button } from "@/components/ui/button";
import { AppFrame } from "@/components/app-frame";
import { CanvasPreview, FlowNodeCard } from "@/components/flow/flow-canvas-preview";
import { EmptyCanvasPreview } from "@/components/flow/empty-canvas-preview";
import { NodeIcon } from "@/components/flow/icons";
import { LayoutDashboard, Workflow } from "lucide-react";
import { ToolbarPreview } from "@/components/flow/toolbar-preview";
import { PanelTabsPreview } from "@/components/flow/panel-preview";
import { PANEL_SHELL } from "@/components/flow/panel-chrome";
import { FlowList } from "@/app/dashboard/flows/FlowRow";
import { STATUS_META, type NodeStatus } from "@/components/flow/node-meta";

/**
 * THE UI KIT, RENDERED.
 *
 * A design system that only exists as tokens in a stylesheet is a system
 * nobody checks. This page is the check: every colour, size, radius and
 * component in one scroll, built from the SAME tokens and the SAME components
 * the product uses — so a drift shows up here before a customer finds it.
 *
 * Deliberately public (it is not under /dashboard, /integrations or
 * /connections, the proxy's protected prefixes) and it reads no data, touches
 * no session and queries nothing. That is what makes it openable in a
 * headless browser during development, which is the only way to actually LOOK
 * at the interface rather than reason about its class names.
 */
export const metadata = { title: "Namzilabs — UI kit" };

const BRAND: Array<[string, string]> = [
  ["50", "bg-brand-50"],
  ["100", "bg-brand-100"],
  ["200", "bg-brand-200"],
  ["300", "bg-brand-300"],
  ["400", "bg-brand-400"],
  ["500", "bg-brand-500"],
  ["600", "bg-brand-600"],
  ["700", "bg-brand-700"],
];
const INK: Array<[string, string]> = [
  ["950", "bg-ink-950"],
  ["900", "bg-ink-900"],
  ["800", "bg-ink-800"],
  ["700", "bg-ink-700"],
  ["400", "bg-ink-400"],
  ["100", "bg-ink-100"],
  ["50", "bg-ink-50"],
];
const TYPE: Array<{ token: string; cls: string; px: string; use: string }> = [
  { token: "text-display", cls: "text-display", px: "24px", use: "Page headings" },
  { token: "text-title", cls: "text-title", px: "17px", use: "Section and modal titles" },
  { token: "text-lead", cls: "text-lead", px: "15px", use: "Panel titles, navigation" },
  { token: "text-base", cls: "text-base", px: "14px", use: "Body, field labels — the default" },
  { token: "text-small", cls: "text-small", px: "13px", use: "Dense UI: menu items, options" },
  { token: "text-tiny", cls: "text-tiny", px: "12px", use: "Helper text, captions, rail labels" },
  { token: "text-micro", cls: "text-micro", px: "11px", use: "Badges, chips, micro-labels" },
];

export default function DesignPage() {
  return (
    // The kit is rendered in the REAL frame, notches and all — a page that
    // showed the rail without the wash behind the canvas would be exactly the
    // drift it exists to catch. It takes `framed` although it is not the
    // builder: the cut is the thing that needs looking at, and the Frame
    // section below says plainly that only the builder gets it.
    <AppFrame
      framed
      surface="overflow-y-auto bg-white"
      account={{
        initials: "EC",
        panel: (
          /* Duplicates the account panel from src/components/app-shell.tsx — spacing, the Workspace label and the rule above the email must track that file. */
          <div className="space-y-3">
            <p className="text-micro font-semibold uppercase tracking-wide text-neutral-400">Workspace</p>
            <p className="truncate text-small font-semibold text-foreground">Namzilabs</p>
            <button className="w-full rounded-control border border-neutral-200 px-3 py-1.5 text-small font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
              Sign out
            </button>
            <p className="truncate border-t border-neutral-100 pt-2 text-tiny text-neutral-500">elias@namzilabs.co</p>
          </div>
        ),
      }}
    >
      <div className="mx-auto max-w-4xl px-10 py-12">
        <p className="text-micro font-semibold uppercase tracking-widest text-brand-600">Design system</p>
        <h1 className="mt-2 text-display font-semibold tracking-tight text-foreground">The Namzilabs UI kit</h1>
        <p className="mt-2 max-w-xl text-base text-neutral-500">
          One accent, one coloured rail, seven type sizes, three radii, four elevations in two finishes. Colour carries identity and
          state — the rail is the one surface allowed to carry mood.
        </p>

        <Section title="Accent" note="Every primary action, selection and focus ring. One colour, so it means something.">
          <div className="flex overflow-hidden rounded-card border border-neutral-200">
            {BRAND.map(([name, cls]) => (
              <div key={name} className="flex-1">
                <div className={`h-16 ${cls}`} />
                <p className="border-t border-neutral-200 px-2 py-1.5 text-micro text-neutral-500">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Ink" note="The dark end of the neutral scale. Only the canvas toast uses it today — the account panel is white and every tooltip is a native title. Seven steps, kept whole so a dark surface has somewhere to go.">
          <div className="flex overflow-hidden rounded-card border border-neutral-200">
            {INK.map(([name, cls]) => (
              <div key={name} className="flex-1">
                <div className={`h-16 ${cls}`} />
                <p className="border-t border-neutral-200 px-2 py-1.5 text-micro text-neutral-500">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Rail" note="The one place in the product allowed to be loud. Everything right of it stays neutral, which is what lets it.">
          <div className="flex items-stretch gap-4">
            {/* Duplicates the rail's item markup from src/components/sidebar.tsx — width, padding, gap, tile and label must track
                that file. The `bg-rail` here is the swatch's own: the real rail is transparent and takes its colour from the frame
                behind it, which a swatch standing on white has to supply for itself. */}
            <div className="bg-rail flex w-[100px] shrink-0 flex-col items-center gap-[30px] rounded-card px-2.5 py-3">
              <span className="flex w-full flex-col items-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-control bg-white/22 text-white">
                  <LayoutDashboard size={24} strokeWidth={2.1} />
                </span>
                <span className="px-1 text-center text-tiny font-medium leading-4 text-white">Active</span>
              </span>
              <span className="flex w-full flex-col items-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-control text-white">
                  <Workflow size={24} strokeWidth={2.1} />
                </span>
                <span className="px-1 text-center text-tiny font-medium leading-4 text-white/75">Rest</span>
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1 text-tiny text-muted-foreground">
              <p><code className="text-foreground">--color-rail</code></p>
              <p>A wash down the column: #3A32A8 → #262A6E → #10606B. Indigo into teal rather than Make&rsquo;s purple into magenta — the same idea, a different axis of the wheel, so it is not their rail in a new hue. Flat read as the one dead surface once the step marks got their own colour.</p>
              <p className="mt-1">Selected highlights the 40px tile alone — a white wash behind the glyph, the label just brightening to full white while resting items sit at 75%. Highlighting the whole item as one white pill was a heavier thing entirely.</p>
            </div>
          </div>
        </Section>

        <Section title="Frame" note="The builder only. A canvas is a workspace you look into, so the app cuts 32px out of it and shows its own colour through the notch; a list of flows runs flush off the rail, square. One element paints the wash — the rail is transparent inside it and the surface sits on top opaque — so the colour behind the canvas and the colour of the rail are not two values kept in sync, they are one gradient and cannot drift.">
          {/* The frame at figure size: the wash on the outer box, the rail's own
              100px of it left bare, and the surface cut 16px at its two left
              corners so the wash shows through them. Only the left corners — the
              other three edges run flush to the viewport, because a card inset on
              all four sides is a smaller-feeling app than this one. */}
          <div className="bg-rail flex h-40 overflow-hidden rounded-card">
            <div className="w-[100px] shrink-0" />
            <div className="flex-1 rounded-l-surface bg-white" />
          </div>
        </Section>

        <Section title="State" note="The only other colours. The DOT always carries the state; the border only takes colour when the step blocks publish or broke, because a canvas that outlines every working step has nothing left to point with — which is why two of these four are a plain neutral card.">
          <div className="grid grid-cols-4 gap-3">
            <StateChip status="ready" body="Ran and returned data" />
            <StateChip status="setup" body="Blocks publish" />
            <StateChip status="error" body="Broke on its last run" />
            <StateChip status="untested" body="Fine, just unrun" />
          </div>
        </Section>

        <Section title="Type" note="Seven sizes and nothing between them. Anything smaller than 11px is not content.">
          <div className="divide-y divide-neutral-100 rounded-card border border-neutral-200">
            {TYPE.map((t) => (
              <div key={t.token} className="flex items-baseline gap-4 px-4 py-3">
                <span className={`${t.cls} min-w-0 flex-1 font-medium text-foreground`}>Speed to lead</span>
                <code className="shrink-0 text-micro text-neutral-400">{t.token}</code>
                <span className="w-10 shrink-0 text-right text-micro text-neutral-400">{t.px}</span>
                <span className="w-56 shrink-0 text-tiny text-neutral-500">{t.use}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radius and elevation" note="Three radii, and ONE elevation ladder in two finishes: on the page, hovered, over the canvas, modal. Which finish a surface takes is decided by whether it has a border, not by taste.">
          {/* These swatches take the ring-free rung themselves — they are
              bordered white boxes, which is exactly the case the row below
              them documents. They used to carry `shadow-raised`, i.e. the kit
              breaking its own rule in the section that states it. */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { cls: "rounded-control", label: "control · 8px", body: "Inputs, buttons, nav items" },
              { cls: "rounded-card", label: "card · 12px", body: "Tiles, sections, list rows" },
              { cls: "rounded-surface", label: "surface · 16px", body: "Step cards, panels, modals, popovers" },
            ].map((r) => (
              <div key={r.cls} className={`${r.cls} border border-neutral-200 bg-white p-4 shadow-card`}>
                <p className="text-small font-semibold text-foreground">{r.label}</p>
                <p className="mt-0.5 text-tiny text-neutral-500">{r.body}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-6 text-tiny text-neutral-500">
            <span className="font-semibold text-foreground">Ringed</span> — each opens with a 1px spread that stands in for an edge.
            Only for a surface with NO border of its own; these swatches have none.
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { cls: "shadow-raised", body: "On the page" },
              { cls: "shadow-lifted", body: "Hovered" },
              { cls: "shadow-float", body: "Over the canvas" },
              { cls: "shadow-pop", body: "Modals" },
            ].map((e) => (
              <div key={e.cls} className={`rounded-card bg-card p-4 ${e.cls}`}>
                <p className="text-small font-semibold text-foreground">{e.cls}</p>
                <p className="mt-0.5 text-tiny text-muted-foreground">{e.body}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-6 text-tiny text-neutral-500">
            <span className="font-semibold text-foreground">Ring-free</span> — the same four rungs with the spread removed, for a
            surface that draws its own border. A real border over a ring is two 1px bands in different hues, the outer one darker:
            the rim reads 2px thick and dirty, and hovering swaps a lighter ring under a border that never moved.
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { cls: "shadow-card", body: "Step cards, list rows" },
              { cls: "shadow-card-hover", body: "Hovered" },
              { cls: "shadow-island", body: "The builder's islands" },
              { cls: "shadow-panel", body: "The config panel" },
            ].map((e) => (
              <div key={e.cls} className={`rounded-card border border-border bg-card p-4 ${e.cls}`}>
                <p className="text-small font-semibold text-foreground">{e.cls}</p>
                <p className="mt-0.5 text-tiny text-muted-foreground">{e.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons" note="One component, seven variants. Every clickable thing in the product comes from it.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Review &amp; publish</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Quiet</Button>
            <Button variant="success">Success</Button>
            <Button disabled>Disabled</Button>
            <Button variant="destructive">Delete</Button>
          </div>
        </Section>

        <Section title="Icons" note="lucide — one family, one grid, one stroke. Nothing hand-drawn anywhere in the app.">
          <div className="flex flex-wrap gap-2">
            {(["app", "unite", "unite_match", "filter", "paths", "formula", "formula_compare", "time_between"] as const).map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-card border border-border bg-card px-3 py-2">
                <NodeIcon type={t.startsWith("unite") ? "unite" : t.startsWith("formula") ? "formula" : t} variant={t.includes("_") ? t : undefined} size={28} />
                <code className="text-micro text-muted-foreground">{t}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Controls" note="Every control in the builder is 8px, hairline, 36px tall, with the same 4px brand focus ring. The settings and onboarding forms predate this and still use 6px. The label matches the Configure tab — 14px semibold, true black — because a label is the question and may never be lighter than its answer.">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-base font-semibold text-foreground">Text field</span>
              <input
                readOnly
                value="Speed to lead"
                className="w-full rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-foreground"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-base font-semibold text-foreground">Focused</span>
              <input
                readOnly
                value="Focused state"
                className="w-full rounded-control border border-brand-400 bg-white px-3 py-2 text-base text-foreground ring-4 ring-brand-100"
              />
            </label>
            <div>
              <span className="mb-1.5 block text-base font-semibold text-foreground">Segmented</span>
              <div className="inline-flex w-full rounded-control border border-neutral-300 bg-neutral-100 p-0.5">
                <span className="flex-1 rounded-[6px] bg-white px-2.5 py-1.5 text-center text-small font-medium text-foreground shadow-sm">
                  A number
                </span>
                <span className="flex-1 px-2.5 py-1.5 text-center text-small font-medium text-neutral-500">A length of time</span>
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-base font-semibold text-foreground">Select</span>
              <div className="flex w-full items-center justify-between rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-foreground">
                Last 30 days <span className="text-neutral-400">▾</span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Builder chrome" note="One bar, full width, three groups by KIND. Left: what this flow is and what state it is in. Centre, held dead-centre by the grid so it does not drift as the name grows: what you do to the view. Right: what you do with the flow — run it, ship it. The run button is a green play glyph and nothing else at rest, and earns its words back while a run is going, because 'Stop · 2/6' is a receipt.">
          {/* THE INNER CANVAS IS 1292px BECAUSE A REAL ONE IS — a 1440 viewport
              minus the 100px rail minus the two 24px insets. The bar fills it:
              1244px, with the centre group measured dead-centre (470px of bar
              on each side of it).

              Rendered at this page's own 816px column it was a lie: the bar hit
              its max-width, squeezed, and showed a flow name clipped in a way
              the product does not do at any width a laptop has. So the box
              scrolls sideways rather than compressing the specimen. 256px tall
              is the clearance for one 58px bar at a 24px inset, with canvas
              below it. */}
          <div className="-mx-24 overflow-x-auto overflow-y-hidden rounded-card">
            <div className="relative h-64 w-[1292px] bg-canvas-bg">
              <div
                className="absolute inset-0"
                style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
              />
              <ToolbarPreview />
            </div>
          </div>
        </Section>

        <Section title="Flow list" note="Zapier's per-row switch, the inspo's table. Off is paused, not deleted — the tiles come back with it.">
          <FlowList
            flows={[
              { id: "1", name: "Speed to lead", state: "active", updatedAt: "2026-08-19T14:45:00Z", summary: "6 steps · Close CRM", source: "close" },
              { id: "2", name: "Pickup rate", state: "active", updatedAt: "2026-08-18T11:20:00Z", summary: "4 steps · Close CRM", source: "close" },
              { id: "3", name: "Claimed leads", state: "paused", updatedAt: "2026-08-17T09:10:00Z", summary: "3 steps · Google Sheets", source: "gsheets" },
              { id: "4", name: "Meetings booked", state: "draft", updatedAt: "2026-08-14T16:05:00Z", summary: "2 steps · Calendly", source: "calendly" },
            ]}
          />
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

        <Section title="Step cards" note="300px, a 44px mark, the step number as its own chip so it stops eating the title. A 16px corner on the ring-free elevation — the card draws its own border — lifting on hover. Only the amber one is outlined, because only it blocks publish.">
          <div className="relative flex flex-wrap items-start gap-4 overflow-hidden rounded-card bg-canvas-bg p-6">
              {/* The same dot field the other two canvas specimens carry — a card
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
          note="The most-used surface in the product, and the one the kit could never show — so every change to it was made blind, twice reported done against a component nobody had touched. The shell and the tab row below are IMPORTED from panel-chrome.tsx, the same two exports ConfigPanel renders, so there is one definition of them and a change lands here or nowhere. Everything between them is sample content: a Summarize step, mid-configure."
        >
          {/* On the canvas colour, because that is what it floats over: a white
              panel on a white page is an invisible box, and its border, its
              elevation and its 16px corner are the whole point of showing it.

              The real panel is `absolute right-6 top-chrome-band
              bottom-chrome-band z-20` INSIDE the canvas: 24px off the right
              edge, and 106px clear of the top and the bottom, which is the
              58px chrome island plus a 24px inset above it and a 24px gap
              below — the toolbar and the bottom bar keep their band, and the
              panel never makes them move. That position belongs to the canvas,
              not to the panel, which is why panel-chrome does not carry it.
              There is no canvas here to be inset from, so the position is
              stripped rather than fought: this box supplies a 24px gutter with
              `p-6`, pins the panel to the right the way the builder does, and
              gives it a fixed height where the real one takes the band between
              the two bars. The 452px width IS the real one (it yields on a
              narrow viewport there; here the page column is wider than that, so
              it never has to). */}
          <div className="relative overflow-hidden rounded-card bg-canvas-bg p-6">
            <div
              className="absolute inset-0"
              style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
            />
            <div className="relative flex justify-end">
              <aside className={`h-[440px] w-[452px] max-w-full ${PANEL_SHELL}`}>
                {/* Duplicates the panel header from src/components/flow/ConfigPanel.tsx — the 38px mark, the title input's
                    invisible-until-hovered chrome and the status pill must track that file. ONE white plane cut by hairlines:
                    the header is not a darker band. */}
                <div className="flex items-center justify-between gap-3 border-b border-border bg-white px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <NodeIcon type="formula" size={38} />
                    <input
                      readOnly
                      value="Summarize"
                      className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-title font-semibold text-foreground hover:border-border hover:bg-white focus:border-input focus:bg-white focus:outline-none"
                    />
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold ${STATUS_META.ready.cls}`}>
                    {STATUS_META.ready.label}
                  </span>
                </div>

                <PanelTabsPreview />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-4 p-5">
                    <PanelField label="Calculation">
                      {/* Duplicates the closed state of controls/Select.tsx. */}
                      <div className="flex w-full items-center justify-between rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-foreground">
                        #&nbsp;&nbsp;Count records <span className="text-neutral-400">▾</span>
                      </div>
                    </PanelField>
                    <PanelField label="Measuring">
                      <PanelSegmented a="A number" b="A length of time" />
                    </PanelField>
                    <PanelField label="Result">
                      <PanelSegmented a="One number" b="A trend" />
                    </PanelField>
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

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-title font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mb-4 mt-0.5 text-tiny text-neutral-500">{note}</p>
      {children}
    </section>
  );
}

/**
 * One sample field in the config panel, label above control.
 *
 * The label string is `FIELD_LABEL` from ConfigPanel.tsx, character for
 * character: 14px semibold true black, because the label is the QUESTION and
 * may never read lighter than its answer. That is the rule most worth being
 * able to SEE, so it is the one thing this sample is not allowed to improvise.
 */
function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-base font-semibold text-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Duplicates controls/Segmented.tsx — the panel's answer to a two-way choice. */
function PanelSegmented({ a, b }: { a: string; b: string }) {
  return (
    <div className="inline-flex w-full rounded-control border border-neutral-300 bg-neutral-100 p-0.5">
      <span className="min-w-0 flex-1 truncate rounded-[6px] bg-white px-2.5 py-1.5 text-center text-small font-medium text-foreground shadow-sm">{a}</span>
      <span className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-center text-small font-medium text-neutral-500">{b}</span>
    </div>
  );
}

/**
 * Reads its border, dot and label straight out of STATUS_META rather than
 * naming the colours a second time. The amber pair here had drifted a whole
 * hue behind the product after needs-attention went orange — a swatch that is
 * wrong about the thing it documents is worse than no swatch.
 */
function StateChip({ status, body }: { status: NodeStatus; body: string }) {
  const sm = STATUS_META[status];
  return (
    <div className={`rounded-card border ${sm.border} bg-white p-3`}>
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${sm.dot}`} />
        <span className="text-small font-semibold text-foreground">{sm.label}</span>
      </span>
      <p className="mt-1 text-tiny text-neutral-500">{body}</p>
    </div>
  );
}
