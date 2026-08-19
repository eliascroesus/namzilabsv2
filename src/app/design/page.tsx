import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/sidebar";
import { CanvasPreview, FlowNodeCard } from "@/components/flow/flow-canvas-preview";
import { NodeIcon } from "@/components/flow/icons";
import { LayoutDashboard, Workflow } from "lucide-react";
import { ToolbarPreview } from "@/components/flow/toolbar-preview";
import { FlowList } from "@/app/dashboard/flows/FlowRow";

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
  { token: "text-base", cls: "text-base", px: "14px", use: "Body — the default" },
  { token: "text-small", cls: "text-small", px: "13px", use: "Dense UI: field labels, options" },
  { token: "text-tiny", cls: "text-tiny", px: "12px", use: "Helper text, captions" },
  { token: "text-micro", cls: "text-micro", px: "11px", use: "Badges, chips, micro-labels" },
];

export default function DesignPage() {
  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        account={{
          initials: "EC",
          panel: (
            <div className="space-y-2">
              <p className="text-small font-semibold text-foreground">Namzilabs</p>
              <p className="truncate text-tiny text-neutral-500">elias@namzilabs.co</p>
              <button className="w-full rounded-control border border-neutral-200 px-3 py-1.5 text-small font-medium text-neutral-700">Sign out</button>
            </div>
          ),
        }}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-10 py-12">
          <p className="text-micro font-semibold uppercase tracking-widest text-brand-600">Design system</p>
          <h1 className="mt-2 text-display font-semibold tracking-tight text-foreground">The Namzilabs UI kit</h1>
          <p className="mt-2 max-w-xl text-base text-neutral-500">
            One accent, one coloured rail, seven type sizes, three radii, four elevations. Colour carries identity and state — the rail
            is the one surface allowed to carry mood.
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

          <Section title="Ink" note="Dark surfaces: toasts, tooltips, the account panel. Four steps of elevation.">
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
              <div className="bg-rail flex w-[76px] shrink-0 flex-col items-stretch gap-1 rounded-card py-3 px-2.5">
                {/* Selected is a SOLID white tile with the brand glyph — Miro's
                    tinted selected tool, translated onto a coloured rail. */}
                <span className="flex flex-col items-center gap-1.5 rounded-card bg-white px-1 py-2.5 text-brand-600 shadow-sm">
                  <LayoutDashboard size={24} strokeWidth={2.1} />
                  <span className="text-micro font-semibold leading-none">Active</span>
                </span>
                <span className="flex flex-col items-center gap-1.5 rounded-card px-1 py-2.5 text-white/70">
                  <Workflow size={24} strokeWidth={2.1} />
                  <span className="text-micro font-semibold leading-none">Rest</span>
                </span>
              </div>
              <div className="flex flex-1 flex-col justify-center gap-1 text-tiny text-muted-foreground">
                <p><code className="text-foreground">--gradient-rail</code></p>
                <p>Brand at the top, warming through violet to fuchsia. One declaration, so it dials back in one edit.</p>
                <p className="mt-1">Selected is solid white with the brand glyph — a translucent wash could not say &ldquo;you are here&rdquo; loudly enough on a coloured surface.</p>
              </div>
            </div>
          </Section>

          <Section title="State" note="The only other colours. Each answers a question the user has to act on.">
            <div className="grid grid-cols-4 gap-3">
              <StateChip tone="green" dot="bg-green-500" label="Tested" body="Ran and returned data" />
              <StateChip tone="amber" dot="bg-amber-500" label="Needs setup" body="Blocks publish" />
              <StateChip tone="red" dot="bg-red-500" label="Error" body="Broke on its last run" />
              <StateChip tone="neutral" dot="bg-neutral-300" label="Not tested" body="Fine, just unrun" />
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

          <Section title="Radius and elevation" note="Three radii, four shadows — layered as a ring plus ambient plus contact, never one glow.">
            <div className="grid grid-cols-3 gap-3">
              {[
                { cls: "rounded-control", label: "control · 8px", body: "Inputs, buttons, nav items" },
                { cls: "rounded-card", label: "card · 12px", body: "Step cards, tiles, sections" },
                { cls: "rounded-surface", label: "surface · 16px", body: "Panels, modals, popovers" },
              ].map((r) => (
                <div key={r.cls} className={`${r.cls} border border-neutral-200 bg-white p-4 shadow-raised`}>
                  <p className="text-small font-semibold text-foreground">{r.label}</p>
                  <p className="mt-0.5 text-tiny text-neutral-500">{r.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3">
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
          </Section>

          <Section title="Buttons" note="One component, six variants. Every clickable thing in the product comes from it.">
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

          <Section title="Controls" note="Every input is 8px, hairline, with the same 4px brand focus ring.">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Text field</span>
                <input
                  readOnly
                  value="Speed to lead"
                  className="w-full rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-foreground"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Focused</span>
                <input
                  readOnly
                  value="Focused state"
                  className="w-full rounded-control border border-brand-400 bg-white px-3 py-2 text-base text-foreground ring-4 ring-brand-100"
                />
              </label>
              <div>
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Segmented</span>
                <div className="inline-flex w-full rounded-control border border-neutral-300 bg-neutral-100 p-0.5">
                  <span className="flex-1 rounded-[6px] bg-white px-2.5 py-1.5 text-center text-small font-medium text-foreground shadow-sm">
                    A number
                  </span>
                  <span className="flex-1 px-2.5 py-1.5 text-center text-small font-medium text-neutral-500">A length of time</span>
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Select</span>
                <div className="flex w-full items-center justify-between rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-foreground">
                  Last 30 days <span className="text-neutral-400">▾</span>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Builder chrome" note="Two full-width bars with matching insets, framing the canvas: the flow above, the canvas controls below.">
            <div className="relative h-72 overflow-hidden rounded-card bg-canvas-bg">
              <div
                className="absolute inset-0"
                style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 1px, transparent 1px)", backgroundSize: "26px 26px" }}
              />
              <ToolbarPreview />
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

          <Section title="The canvas" note="Cards, connectors and the ghost next-step — the rhythm between them is most of what a canvas is.">
            <CanvasPreview />
          </Section>

          <Section title="Step cards" note="300px, a 44px mark, the step number as its own chip so it stops eating the title.">
            <div className="flex flex-wrap items-start gap-4 rounded-card bg-canvas-bg p-6">
              <FlowNodeCard variant="unite_match" title="Match" body="Needs two steps" status="setup" stepNo={3} />
              <FlowNodeCard variant="formula_compare" title="Compare" body="38" status="untested" stepNo={4} />
            </div>
          </Section>

          <div className="h-16" />
        </div>
      </main>
    </div>
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

function StateChip({ tone, dot, label, body }: { tone: string; dot: string; label: string; body: string }) {
  const border: Record<string, string> = {
    green: "border-green-300",
    amber: "border-amber-300",
    red: "border-red-300",
    neutral: "border-neutral-300",
  };
  return (
    <div className={`rounded-card border ${border[tone]} bg-white p-3`}>
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-small font-semibold text-foreground">{label}</span>
      </span>
      <p className="mt-1 text-tiny text-neutral-500">{body}</p>
    </div>
  );
}
