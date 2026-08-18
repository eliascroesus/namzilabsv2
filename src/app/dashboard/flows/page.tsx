import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getReadDb } from "@/db/client";
import { listFlows } from "@/lib/flow/store";
import { createFlowAction } from "./actions";
import { FlowList } from "./FlowRow";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget. This segment governs ONLY the flows list and
 * `createFlowAction` — a server action runs under the page the user is ON,
 * so the canvas's Test path, option pickers and Publish are governed by
 * `flows/[id]/page.tsx`'s declaration, not this one. (An earlier comment
 * here claimed otherwise, and the timeout test pinned this file while the
 * canvas ran on the platform default — the exact outage the pin exists to
 * prevent.) Kept because it costs nothing and createFlowAction does DB work.
 */
export const maxDuration = 60;


type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

export default async function FlowsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, userId, auth } = await requireOrg();
  const sp = await searchParams;
  const flows = await listFlows(getReadDb(), orgId).catch(() => []);

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        {one(sp.error) === "flow_limit" && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>This workspace has reached its flow limit, so nothing was created. Contact us and we&rsquo;ll raise it.</p>
            <Link href="/dashboard/flows" aria-label="Dismiss" className="font-semibold text-red-400 hover:text-red-700">
              ✕
            </Link>
          </div>
        )}
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
              Press <b>New flow</b> to build one step by step.
            </p>
          </div>
        ) : (
          <FlowList flows={flows.map((f) => ({ id: f.id, name: f.name, status: f.status, updatedAt: new Date(f.updatedAt).toISOString() }))} />
        )}
      </main>
    </>
  );
}
