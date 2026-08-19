import { Sidebar } from "@/components/sidebar";
import { FlowNodeCard } from "@/components/flow/flow-canvas-preview";

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
        footer={
          <div className="flex items-center gap-2.5 rounded-control px-2 py-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-800 text-micro font-semibold text-ink-100">EC</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-tiny font-medium text-ink-100">Namzilabs</span>
              <span className="block truncate text-micro text-ink-400">elias@namzilabs.co</span>
            </span>
          </div>
        }
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-10 py-12">
          <p className="text-micro font-semibold uppercase tracking-widest text-brand-600">Design system</p>
          <h1 className="mt-2 text-display font-semibold tracking-tight text-neutral-900">The Namzilabs UI kit</h1>
          <p className="mt-2 max-w-xl text-base text-neutral-500">
            One accent, neutral surfaces, seven type sizes, three radii. Colour is reserved for identity and for state — never for
            decoration.
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

          <Section title="Ink" note="The navigation rail and every dark surface. Four steps of elevation, cool-shifted.">
            <div className="flex overflow-hidden rounded-card border border-neutral-200">
              {INK.map(([name, cls]) => (
                <div key={name} className="flex-1">
                  <div className={`h-16 ${cls}`} />
                  <p className="border-t border-neutral-200 px-2 py-1.5 text-micro text-neutral-500">{name}</p>
                </div>
              ))}
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
                  <span className={`${t.cls} min-w-0 flex-1 font-medium text-neutral-900`}>Speed to lead</span>
                  <code className="shrink-0 text-micro text-neutral-400">{t.token}</code>
                  <span className="w-10 shrink-0 text-right text-micro text-neutral-400">{t.px}</span>
                  <span className="w-56 shrink-0 text-tiny text-neutral-500">{t.use}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Radius and elevation" note="Three radii, two shadows. Everything else was a one-off.">
            <div className="grid grid-cols-3 gap-3">
              {[
                { cls: "rounded-control", label: "control · 8px", body: "Inputs, buttons, nav items" },
                { cls: "rounded-card", label: "card · 12px", body: "Step cards, tiles, sections" },
                { cls: "rounded-surface", label: "surface · 16px", body: "Panels, modals, popovers" },
              ].map((r) => (
                <div key={r.cls} className={`${r.cls} border border-neutral-200 bg-white p-4 shadow-raised`}>
                  <p className="text-small font-semibold text-neutral-800">{r.label}</p>
                  <p className="mt-0.5 text-tiny text-neutral-500">{r.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-card border border-neutral-200 bg-white p-4 shadow-raised">
                <p className="text-small font-semibold text-neutral-800">shadow-raised</p>
                <p className="mt-0.5 text-tiny text-neutral-500">On the page</p>
              </div>
              <div className="rounded-card border border-neutral-200 bg-white p-4 shadow-lifted">
                <p className="text-small font-semibold text-neutral-800">shadow-lifted</p>
                <p className="mt-0.5 text-tiny text-neutral-500">Hovered or floating</p>
              </div>
            </div>
          </Section>

          <Section title="Buttons" note="One filled style. A second filled colour would be a second primary action.">
            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-control bg-brand-600 px-4 py-2 text-base font-semibold text-white shadow-sm shadow-brand-600/20">
                Review &amp; publish
              </button>
              <button className="rounded-control border border-neutral-200 bg-white px-4 py-2 text-base font-medium text-neutral-700">
                Secondary
              </button>
              <button className="rounded-control px-3 py-2 text-base font-medium text-neutral-600">Quiet</button>
              <button disabled className="rounded-control bg-neutral-200 px-4 py-2 text-base font-semibold text-neutral-400">
                Disabled
              </button>
              <button className="rounded-control bg-red-600 px-4 py-2 text-base font-semibold text-white">Delete</button>
            </div>
          </Section>

          <Section title="Controls" note="Every input is 8px, hairline, with the same 4px brand focus ring.">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Text field</span>
                <input
                  readOnly
                  value="Speed to lead"
                  className="w-full rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-800"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Focused</span>
                <input
                  readOnly
                  value="Focused state"
                  className="w-full rounded-control border border-brand-400 bg-white px-3 py-2 text-base text-neutral-800 ring-4 ring-brand-100"
                />
              </label>
              <div>
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Segmented</span>
                <div className="inline-flex w-full rounded-control border border-neutral-300 bg-neutral-100 p-0.5">
                  <span className="flex-1 rounded-[6px] bg-white px-2.5 py-1.5 text-center text-small font-medium text-neutral-900 shadow-sm">
                    A number
                  </span>
                  <span className="flex-1 px-2.5 py-1.5 text-center text-small font-medium text-neutral-500">A length of time</span>
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-small font-medium text-neutral-700">Select</span>
                <div className="flex w-full items-center justify-between rounded-control border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-800">
                  Last 30 days <span className="text-neutral-400">▾</span>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Step cards" note="The canvas's only content. Chroma is the step's identity; the dot is its state.">
            <div className="flex flex-wrap items-start gap-4 rounded-card bg-canvas-bg p-6">
              <FlowNodeCard variant="app" title="1. Google Sheets" body="49 loaded" status="ready" />
              <FlowNodeCard variant="filter" title="2. Filter" body="24 passed" status="ready" publishes />
              <FlowNodeCard variant="unite_match" title="3. Match" body="Needs two steps" status="setup" />
              <FlowNodeCard variant="formula_compare" title="4. Compare" body="38" status="untested" />
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
      <h2 className="text-title font-semibold tracking-tight text-neutral-900">{title}</h2>
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
        <span className="text-small font-semibold text-neutral-800">{label}</span>
      </span>
      <p className="mt-1 text-tiny text-neutral-500">{body}</p>
    </div>
  );
}
