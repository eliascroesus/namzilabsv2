import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { listConnections } from "@/lib/connections";
import { CONNECTOR_CATALOG, type ConnectorCatalogEntry } from "@/connectors/catalog";
import { connectApiKeyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { orgId, userId, auth } = await requireOrg();
  const connected = await listConnections(orgId).catch(() => []);
  const countBySource = connected.reduce<Record<string, number>>((acc, c) => {
    acc[c.source] = (acc[c.source] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Connect a tool and its data flows into your unified dashboard. Connect an account, then
          preview the latest records to confirm it&rsquo;s live.
        </p>

        {connected.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Your connections
            </h2>
            <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
              {connected.map((c) => (
                <Link
                  key={c.id}
                  href={`/connections/${c.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="flex items-center gap-3 text-sm text-neutral-500">
                    <span>{c.source}</span>
                    <StatusDot status={c.status} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Add a connection</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {CONNECTOR_CATALOG.map((entry) => (
              <ConnectorCard key={entry.source} entry={entry} connectedCount={countBySource[entry.source] ?? 0} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function ConnectorCard({ entry, connectedCount }: { entry: ConnectorCatalogEntry; connectedCount: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{entry.name}</h3>
          <p className="mt-1 text-sm text-neutral-600">{entry.description}</p>
        </div>
        {connectedCount > 0 && (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            {connectedCount} connected
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2 text-xs text-neutral-500">
        {entry.instant && <span className="rounded bg-neutral-100 px-2 py-0.5">Instant webhook</span>}
        {entry.poll && <span className="rounded bg-neutral-100 px-2 py-0.5">Polling</span>}
      </div>

      <div className="mt-4">
        {entry.connect === "google" ? (
          <a
            href={`/api/oauth/google/start?source=${entry.source}`}
            className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Connect with Google
          </a>
        ) : (
          <details>
            <summary className="cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              Connect
            </summary>
            <form action={connectApiKeyAction} className="mt-3 space-y-2">
              <input type="hidden" name="source" value={entry.source} />
              <input
                name="name"
                placeholder={`${entry.name} account name`}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              {entry.credentialFields.map((f) => (
                <input
                  key={f.key}
                  name={`cred_${f.key}`}
                  type="password"
                  placeholder={f.label}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              ))}
              {(entry.configFields ?? []).map((f) => (
                <input
                  key={f.key}
                  name={`cfg_${f.key}`}
                  placeholder={f.label}
                  required={f.required}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              ))}
              <button
                type="submit"
                className="w-full rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                Save connection
              </button>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "active" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-neutral-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={status} />;
}
