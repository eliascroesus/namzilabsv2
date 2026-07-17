import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { listFlows } from "@/lib/flow/store";
import { createFlowAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const { orgId, userId, auth } = await requireOrg();
  const flows = await listFlows(getDb(), orgId).catch(() => []);

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
              <Link key={f.id} href={`/dashboard/flows/${f.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50">
                <span className="font-medium">{f.name}</span>
                <span className="flex items-center gap-3 text-sm text-neutral-500">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${f.status === "published" ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-600"}`}>
                    {f.status}
                  </span>
                  <span>{new Date(f.updatedAt).toLocaleDateString()}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
