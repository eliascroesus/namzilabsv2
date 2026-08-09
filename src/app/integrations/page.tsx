import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { getReadDb } from "@/db/client";
import { connectionImportStatus, type ImportStatus } from "@/lib/sync/import-status";
import { AppHeader } from "@/components/app-header";
import { integrationsErrorMessage } from "./error-messages";
import { connectionRecordCounts, listConnections, webhookUrlFor } from "@/lib/connections";
import { CONNECTOR_CATALOG, catalogEntry, type ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectionRow } from "./ConnectionRow";
import { connectApiKeyAction } from "./actions";
import { eventTimeNote, readEventTime } from "@/lib/webhooks/event-time";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget: `connectApiKeyAction` runs under this segment
 * and does real provider work inline — `createConnection` registers the
 * webhook with the provider (one bounded provider call) before returning.
 * The platform default (10s Hobby) can kill it between the DB write and the
 * registration, leaving a connection with no instant path. 60 is the Hobby
 * ceiling; pinned by tests/timeout-budgets.test.ts.
 */
export const maxDuration = 60;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, userId, auth } = await requireOrg();
  const sp = await searchParams;
  const errorCode = one(sp.error);
  const connected = await listConnections(orgId).catch(() => []);
  // Best-effort: a failed count must not take down the page, and the delete
  // warning falls back to naming no number rather than naming a wrong one.
  const records = await connectionRecordCounts(orgId).catch(() => ({}) as Record<string, number>);
  // "Is history still loading?" per connection, from stored state only (no
  // provider calls). Best-effort like the counts: a progress line must never
  // be the reason this page fails to render.
  const importStatuses = new Map<string, ImportStatus>(
    await Promise.all(
      connected
        .filter((c) => c.status !== "disabled")
        .map(async (c) => [c.id, await connectionImportStatus(getReadDb(), orgId, c.id).catch(() => ({ state: "unknown" as const }))] as const),
    ),
  );
  // Disconnected connections still exist (their rows and data survive so they
  // can be reconnected), but they are not CONNECTED — counting them would tell
  // someone a source is live when nothing is syncing from it.
  const countBySource = connected.reduce<Record<string, number>>((acc, c) => {
    if (c.status === "disabled") return acc;
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

        {errorCode && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>
              {integrationsErrorMessage(errorCode)} <span className="text-xs text-red-400">({errorCode})</span>
            </p>
            {/* Dismissal without client JS: dropping the query param re-renders
                the page clean (this segment is force-dynamic). */}
            <Link href="/integrations" aria-label="Dismiss" className="font-semibold text-red-400 hover:text-red-700">
              ✕
            </Link>
          </div>
        )}

        {connected.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Your connections
            </h2>
            {/* The two removal buttons keep two different promises, and this is
                where that difference is said BEFORE anyone is inside a confirm
                dialog: disconnect keeps everything and reverses; the trash is
                immediate and total. Matches disableConnection /
                deleteConnectionPermanently — if those change, change this. */}
            <p className="mb-3 text-xs text-neutral-500">
              Disconnecting a source pauses it and keeps all its data — reconnect any time and everything comes back.
              Deleting one (the trash icon) permanently removes it and everything synced from it, immediately.
            </p>
            <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
              {connected.map((c) => (
                <ConnectionRow
                  key={c.id}
                  id={c.id}
                  name={c.name}
                  source={c.source}
                  status={c.status}
                  // F.3/F.6 surfaced on the LIST, not only the detail page: a
                  // paused source looked simply "connected" here while it sat
                  // out a breaker window, and the one page users actually visit
                  // said nothing. Preformatted on the server so the client row
                  // renders one stable string (no hydration-time re-clocking).
                  pausedNote={
                    c.pausedUntil && c.pausedUntil.getTime() > Date.now()
                      ? `${c.pausedReason ?? "Waiting before the next attempt."} Retries automatically around ${c.pausedUntil.toLocaleTimeString()} — nothing is lost.`
                      : undefined
                  }
                  lastError={c.status === "error" ? (c.lastError ?? undefined) : undefined}
                  // Webhook-capable sources carry their inbound URL right here.
                  // It used to live only on the connection page, which meant a
                  // Custom Webhook — a connector that is nothing BUT its URL —
                  // was saved and then led nowhere.
                  webhookUrl={catalogEntry(c.source)?.instant ? webhookUrlFor(c.id) : undefined}
                  webhookSetup={catalogEntry(c.source)?.webhookSetup}
                  // Only the catch-hook has this question: every other source
                  // reads a documented timestamp field of its own.
                  eventTimeNote={c.source === "webhook" ? eventTimeNote(readEventTime(c.config)) : undefined}
                  records={records[c.id]}
                  importNote={
                    importStatuses.get(c.id)?.state === "importing"
                      ? (importStatuses.get(c.id)?.note ?? "Still importing history.")
                      : undefined
                  }
                />
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
            <form action={connectApiKeyAction} className="mt-3 space-y-3">
              <input type="hidden" name="source" value={entry.source} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600">Connection name</span>
                <input
                  name="name"
                  placeholder={entry.name}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              {entry.credentialFields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600">{f.label}</span>
                  <input
                    name={`cred_${f.key}`}
                    type="password"
                    autoComplete="off"
                    placeholder={f.placeholder ?? ""}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                </label>
              ))}
              <button
                type="submit"
                className="w-full rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                Save connection
              </button>
              {/* A source with no credentials to enter (Custom Webhook) gives no
                  clue that saving is only step one — the URL it mints is the
                  whole product, and it appears above once the row exists. */}
              {entry.credentialFields.length === 0 && entry.instant && (
                <p className="text-xs text-neutral-500">
                  Saving creates the inbound URL. It appears under <b>Your connections</b> above —
                  open <b>Webhook URL</b> on the new row and point any app at it.
                </p>
              )}
            </form>
          </details>
        )}
      </div>
    </div>
  );
}

