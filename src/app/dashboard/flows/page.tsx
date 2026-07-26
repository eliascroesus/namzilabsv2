import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getReadDb } from "@/db/client";
import { listFlows } from "@/lib/flow/store";
import { createFlowAction } from "./actions";
import { FlowRow } from "./FlowRow";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget.
 *
 * Vercel's default is 10s on Hobby and 15s on Pro. Neither is survivable for
 * this route: a sync issues a provider call (bounded at PROVIDER_CALL_BUDGET_MS
 * in src/lib/http-client.ts) plus ten or more Neon round trips, each of which is
 * its own HTTPS request on the http driver. Under the default the container is
 * killed mid-run — Inngest sees a failure, and the test_runs row is stranded at
 * `running` because it is stamped before the work starts.
 *
 * 60 is the Hobby ceiling and is valid on Pro too; raise to 300 on Pro if a
 * first sync ever needs it. Whatever this is, it MUST stay above the HTTP
 * budget in src/lib/http-client.ts — tests/http-client.test.ts pins that.
 */
export const maxDuration = 60;


export default async function FlowsPage() {
  const { orgId, userId, auth } = await requireOrg();
  const flows = await listFlows(getReadDb(), orgId).catch(() => []);

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Metric flows</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Build metrics visually: connect an app, filter and aggregate, then output to your dashboard.
            </p>
          </div>
          <form action={createFlowAction}>
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              New flow
            </button>
          </form>
        </div>

        {flows.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-10 text-center">
            <p className="text-neutral-600">No flows yet.</p>
            <p className="mt-1 text-sm text-neutral-500">
              Create your first visual metric — e.g. Calendly &rarr; Filter booked &rarr; Count &rarr; Output.
            </p>
          </div>
        ) : (
          <div className="mt-8 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {flows.map((f) => (
              <FlowRow key={f.id} id={f.id} name={f.name} status={f.status} updatedAt={new Date(f.updatedAt).toISOString()} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
