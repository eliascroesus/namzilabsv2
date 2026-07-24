import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/db/client";
import { listFlows } from "@/lib/flow/store";
import { createFlowAction } from "./actions";
import { FlowRow } from "./FlowRow";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const { orgId, userId, auth } = await requireOrg();
  const flows = await listFlows(getDb(), orgId).catch(() => []);

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
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
    </AppShell>
  );
}
