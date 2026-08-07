import Link from "next/link";

/**
 * The guided path a brand-new workspace sees instead of a bare "No metrics
 * yet." — three steps, each checked off from REAL state (connection count,
 * flow count, published-tile count), so it doubles as a progress readout: a
 * user who connected yesterday and stalled sees exactly where they stopped.
 *
 * Deliberately NOT a wizard and NOT sample data. The canonical `events` table
 * is what the single-writer pipeline protects, and every downstream system —
 * metrics compute, the field registry the pickers read, flow Test sampling,
 * the invariant scan's empty-mirror check — treats its rows as truth. Sample
 * rows would need a synthetic connection, would register fake fields in every
 * picker, and would need purge logic to un-lie four subsystems. Three real
 * steps are cheaper than that, and the first one takes about a minute.
 */
export function OnboardingChecklist({
  hasConnection,
  hasFlow,
  hasPublished,
}: {
  hasConnection: boolean;
  hasFlow: boolean;
  hasPublished: boolean;
}) {
  const steps: Array<{ done: boolean; title: string; detail: string; href: string; cta: string }> = [
    {
      done: hasConnection,
      title: "Connect an integration",
      detail: "Close, Calendly, Google Sheets, a custom webhook — anywhere your data already lives.",
      href: "/integrations",
      cta: "Connect →",
    },
    {
      done: hasFlow,
      title: "Build your first flow",
      detail: "Pick the data, filter and group it visually, and Test it on real records as you go.",
      href: "/dashboard/flows",
      cta: "New flow →",
    },
    {
      done: hasPublished,
      title: "Publish it",
      detail: "Publishing puts the number on this dashboard and keeps it updating by itself.",
      href: "/dashboard/flows",
      cta: "Open flows →",
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-8">
      <h2 className="text-lg font-semibold text-neutral-800">Get your first metric live</h2>
      <p className="mt-1 text-sm text-neutral-500">Three steps — the first takes about a minute.</p>
      <ol className="mt-5 space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            {step.done ? (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
                ✓
              </span>
            ) : (
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  i === next ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-400"
                }`}
              >
                {i + 1}
              </span>
            )}
            <div>
              <p className={`font-medium ${step.done ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{step.title}</p>
              {!step.done && (
                <p className="mt-0.5 text-sm text-neutral-500">
                  {step.detail}{" "}
                  {i === next && (
                    <Link href={step.href} className="whitespace-nowrap font-medium text-blue-600 hover:underline">
                      {step.cta}
                    </Link>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
