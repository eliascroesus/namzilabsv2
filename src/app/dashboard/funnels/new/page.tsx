import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { computeFunnel, distinctSources, distinctEventTypes } from "@/lib/metrics/compute";
import { FunnelSchema } from "@/lib/metrics/types";
import { resolveRange } from "@/lib/metrics/range";
import { createFunnelMetricAction } from "@/app/dashboard/metrics/actions";
import { FunnelView } from "@/components/funnel-view";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
const STAGES = [0, 1, 2, 3];

export default async function NewFunnelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, auth } = await requireOrg();

  const [sources, eventTypes] = await Promise.all([
    distinctSources(getDb(), orgId).catch(() => []),
    distinctEventTypes(getDb(), orgId, null).catch(() => []),
  ]);

  const stages = STAGES.map((i) => ({
    label: one(sp[`stage${i}_label`]),
    source: one(sp[`stage${i}_source`]) || null,
    eventType: one(sp[`stage${i}_eventType`]),
  })).filter((s) => s.label && s.eventType);

  const previewed = stages.length >= 2;
  let funnel: Awaited<ReturnType<typeof computeFunnel>> | null = null;
  let previewError: string | null = null;
  if (previewed) {
    try {
      const def = FunnelSchema.parse({
        kind: "funnel",
        stages: stages.map((s) => ({ ...s, filters: { combinator: "and", rules: [] } })),
      });
      funnel = await computeFunnel(getDb(), orgId, def, resolveRange("90d").range);
    } catch (err) {
      previewError = err instanceof Error ? err.message : String(err);
    }
  }

  const hiddenKeys = ["name", ...STAGES.flatMap((i) => [`stage${i}_label`, `stage${i}_source`, `stage${i}_eventType`])];

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">New funnel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Order the stages a lead moves through. We count distinct people reaching each stage and
          surface the biggest drop-off.
        </p>
        {one(sp.error) === "need_two_stages" && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            A funnel needs at least two stages.
          </p>
        )}

        <form method="get" className="mt-8 space-y-4 rounded-lg border border-neutral-200 p-5">
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-600">Funnel name</span>
            <input name="name" defaultValue={one(sp.name)} placeholder="SMS → Booked → Showed"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </label>
          {STAGES.map((i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input name={`stage${i}_label`} defaultValue={one(sp[`stage${i}_label`])} placeholder={`Stage ${i + 1} name`}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
              <select name={`stage${i}_eventType`} defaultValue={one(sp[`stage${i}_eventType`])}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                <option value="">event type…</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select name={`stage${i}_source`} defaultValue={one(sp[`stage${i}_source`])}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                <option value="">any source</option>
                {sources.map((srcName) => (
                  <option key={srcName} value={srcName}>{srcName}</option>
                ))}
              </select>
            </div>
          ))}
          <button className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
            Preview
          </button>
        </form>

        {previewed && (
          <section className="mt-6 rounded-lg border border-neutral-200 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Live preview (last 90 days)</h2>
            {previewError ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{previewError}</p>
            ) : (
              funnel && (
                <>
                  <div className="mt-3">
                    <FunnelView result={funnel} />
                  </div>
                  <form action={createFunnelMetricAction} className="mt-5">
                    {hiddenKeys.map((k) => (
                      <input key={k} type="hidden" name={k} value={one(sp[k])} />
                    ))}
                    <button className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800">
                      Save funnel
                    </button>
                  </form>
                </>
              )
            )}
          </section>
        )}
      </main>
    </>
  );
}
