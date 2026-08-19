import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getConnection, getSigningSecret, previewLatest, webhookUrlFor } from "@/lib/connections";
import { CopyField } from "@/components/copy-field";
import { catalogEntry, isStreamScoped, syncGuarantee } from "@/connectors/catalog";
import {
  disconnectAction,
  importHistoryAction,
  reconnectAction,
  replayDeadLetterAction,
  syncNewAction,
  fullResyncAction,
  reprocessAction,
} from "@/app/integrations/actions";
import { getReadDb } from "@/db/client";
import { unresolvedDeadLetters } from "@/lib/dead-letter";
import type { CanonicalEvent } from "@/connectors/types";
import { eventTimeChoice, eventTimeNote, readEventTime } from "@/lib/webhooks/event-time";
import { EventTimePicker } from "./EventTimePicker";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget: `?preview=1` runs `previewLatest` — a REAL
 * provider call (bounded at PROVIDER_CALL_BUDGET_MS) — during render, and the
 * sync controls' server actions run under this segment too. The platform
 * default (10s Hobby) kills the render mid-call. 60 is the Hobby ceiling;
 * pinned by tests/timeout-budgets.test.ts.
 */
export const maxDuration = 60;

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string; replay?: string }>;
}) {
  const { id } = await params;
  const { preview, replay } = await searchParams;
  const { orgId, userId, auth } = await requireOrg();

  const conn = await getConnection(orgId, id);
  if (!conn) notFound();

  const entry = catalogEntry(conn.source);
  const signingSecret = getSigningSecret(conn);
  const webhookUrl = webhookUrlFor(conn.id);
  const eventTime = readEventTime(conn.config);
  // The DLQ door: the payloads that exhausted retries, visible where the
  // ConnectionRow's "delivery status →" link has always promised they'd be.
  // Best-effort read — a failed listing must not take down the page that
  // hosts the fix.
  const deadLetters = await unresolvedDeadLetters(getReadDb(), orgId, conn.id).catch(() => []);

  // "Preview latest records" — the connect-time trust builder.
  let previewRows: CanonicalEvent[] | null = null;
  let previewError: string | null = null;
  if (preview === "1") {
    try {
      previewRows = await previewLatest(orgId, conn.id, 3);
    } catch (err) {
      previewError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/integrations" className="text-sm text-neutral-500 hover:text-foreground">
          &larr; Integrations
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-display font-semibold tracking-tight text-foreground">{conn.name}</h1>
            <p className="text-sm text-neutral-500">{entry?.name ?? conn.source}</p>
          </div>
          <StatusBadge status={conn.status} />
        </div>

        {/* F.3/F.6: a paused connection is never a dead end — it says WHY and
            WHEN it resumes, and it retries itself with no human action. */}
        {conn.pausedUntil && new Date(conn.pausedUntil).getTime() > Date.now() ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <b>Paused, retrying automatically.</b>{" "}
            {conn.pausedReason ?? "Waiting before the next attempt."} Next attempt around{" "}
            {new Date(conn.pausedUntil).toLocaleTimeString()} — nothing is lost, syncing resumes on its own.
          </div>
        ) : (
          conn.lastError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {conn.lastError}
            </div>
          )
        )}

        <dl className="mt-6 grid grid-cols-2 gap-4 rounded-md border border-neutral-200 p-4 text-sm">
          <div>
            <dt className="text-neutral-500">Data status</dt>
            <dd className="mt-0.5">
              <SyncStatusBadge status={conn.syncStatus} />
            </dd>
          </div>
          <Field
            label="Last full sync"
            value={conn.historicalSyncedAt ? new Date(conn.historicalSyncedAt).toLocaleString() : "Never"}
          />
          <Field label="Last event" value={conn.lastEventAt ? new Date(conn.lastEventAt).toLocaleString() : "—"} />
          <Field label="Created" value={new Date(conn.createdAt).toLocaleString()} />
          <Field label="Instant webhook" value={entry?.instant ? "Yes" : "No"} />
          <Field label="Polling / backfill" value={entry?.poll ? "Yes" : "No"} />
          <Field label="Data guarantee" value={GUARANTEE_LABEL[syncGuarantee(conn.source)]} />
        </dl>

        {/* A source whose class is not uniform across its streams says so here.
            The field above is one value per SOURCE, which is exact everywhere
            except Instantly — whose analytics streams are provider totals while a
            legacy per-email stream is an ordinary incremental walk. Rendering the
            source-wide value alone told a per-email user they had a guarantee
            they do not have. */}
        {entry?.syncNote && <p className="mt-2 text-xs text-neutral-500">{entry.syncNote}</p>}

        {/* The weaker guarantee class is stated plainly, not hidden in a tooltip:
            with no list endpoint to reconcile against, a webhook this provider
            fails to deliver (downtime, expired subscription) is not recoverable
            by polling. */}
        {syncGuarantee(conn.source) === "webhook-only" && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <b>Webhook-only source.</b> {entry?.name ?? conn.source} offers no reliable way to re-read
            history, so your data here is as complete as the webhooks that actually arrived. If a
            webhook is missed while the provider or endpoint is down, that event will be absent until
            the provider redelivers it. Sources with polling don&rsquo;t have this limitation.
          </div>
        )}

        {/* No data config lives here — every "what to pull" choice is on the flow's Get
            data step, so one connected account can feed many flows differently. */}
        {entry?.flowFields && entry.flowFields.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Configuration</h2>
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
              This account is connected. Choose {entry.flowFields.map((f) => f.label.toLowerCase()).join(" and ")} inside each
              flow&rsquo;s <b>Get data</b> step — every flow can pull from a different one.
            </p>
          </section>
        )}

        {/* Inbound webhook URL + secret (manual providers / custom webhook) */}
        {entry?.instant && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Inbound webhook</h2>
            {entry.webhookSetup && <p className="mb-2 text-sm text-neutral-600">{entry.webhookSetup}</p>}
            <CopyField label="URL" value={webhookUrl} isUrl />
            {signingSecret && <CopyField label="Signing secret" value={signingSecret} />}
            {/* Only the catch-hook has this question. Every other source reads a
                documented timestamp field of its own, so there is nothing to
                choose and nothing to be wrong about. */}
            {conn.source === "webhook" && (
              <EventTimePicker
                connectionId={conn.id}
                choice={eventTimeChoice(eventTime)}
                note={eventTimeNote(eventTime)}
                options={eventTime.state?.options ?? []}
                pending={eventTime.restampRequestedAt != null}
              />
            )}
          </section>
        )}

        {/* Preview latest records (connection-scoped sources only — stream-scoped
            sources preview inside the flow's Get data step, where the resource is).
            Gated on SCOPE, not flowFields presence: Close carries a readFilter-only
            flowField and is still connection-scoped — the old presence check
            silently removed this section, its one connect-time "is data flowing"
            answer, the day that field appeared. */}
        {!isStreamScoped(conn.source) && (
          <section className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Latest records</h2>
              <Link href={`/connections/${conn.id}?preview=1`} className="text-sm text-blue-600 hover:underline">
                Preview latest
              </Link>
            </div>
            {preview !== "1" && (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                Click &ldquo;Preview latest&rdquo; to pull the most recent records from this source.
              </p>
            )}
            {previewError && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{previewError}</p>
            )}
            {previewRows && <PreviewTable rows={previewRows} />}
          </section>
        )}

        {/* Delivery issues — the dead-letter queue's door. Rendered only when
            rows exist: a healthy connection should not carry an empty "issues"
            section implying trouble. */}
        {(deadLetters.length > 0 || replay) && (
          <section className="mt-10">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Delivery issues</h2>
            {replay === "failed" && (
              <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                That replay failed again — the row stays here, nothing was lost. The error below is updated.
              </p>
            )}
            {replay === "ok" && (
              <p className="mb-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                Replayed. The payload was reprocessed from its stored raw body.
              </p>
            )}
            {deadLetters.length === 0 ? (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                No unresolved delivery issues.
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm text-neutral-500">
                  These payloads were received and safely stored, but failed processing after every retry. Replaying
                  reprocesses the stored payload — nothing is re-fetched from the provider.
                </p>
                <div className="overflow-x-auto rounded-md border border-neutral-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Received</th>
                        <th className="px-3 py-2 font-medium">Error</th>
                        <th className="px-3 py-2 font-medium">Attempts</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {deadLetters.map((row) => (
                        <tr key={row.id}>
                          <td className="whitespace-nowrap px-3 py-2 text-neutral-500" title={new Date(row.createdAt).toLocaleString()}>
                            {new Date(row.createdAt).toLocaleDateString()}
                          </td>
                          <td className="max-w-md px-3 py-2 text-red-700" title={row.error}>
                            {row.error.length > 120 ? `${row.error.slice(0, 120)}…` : row.error}
                          </td>
                          <td className="px-3 py-2 text-neutral-500">{row.attempts}</td>
                          <td className="px-3 py-2 text-right">
                            {row.rawEventId ? (
                              <form action={replayDeadLetterAction}>
                                <input type="hidden" name="connectionId" value={conn.id} />
                                <input type="hidden" name="rawEventId" value={row.rawEventId} />
                                <button type="submit" className="text-sm font-medium text-blue-600 hover:underline">
                                  Replay
                                </button>
                              </form>
                            ) : (
                              // A row with no stored raw body predates raw capture
                              // for its path; there is nothing to reprocess from.
                              <span className="text-xs text-neutral-400" title="No stored payload to reprocess">
                                not replayable
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* Data & sync controls */}
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Data &amp; sync</h2>
          <div className="rounded-md border border-neutral-200 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {entry?.poll && (
                <SyncControl
                  action={syncNewAction}
                  id={conn.id}
                  label="Sync new"
                  hint="Pull records added since the last sync. Additive — nothing is removed."
                />
              )}
              {entry?.poll && (
                <SyncControl
                  action={fullResyncAction}
                  id={conn.id}
                  label="Full re-sync"
                  hint="Safely rebuild the full dataset and drop records deleted upstream. Your data stays live during the sync."
                />
              )}
              <SyncControl
                action={reprocessAction}
                id={conn.id}
                label="Reprocess"
                hint="Re-run normalization from stored raw events. No provider calls."
              />
              {/* Backfill walks STREAMS (importHistoryAction iterates
                  activeStreams), so the button belongs to stream-scoped
                  sources only — on Close it would render and silently do
                  nothing, since a connection-scoped source has no stream
                  rows to deepen. */}
              {entry?.poll && isStreamScoped(conn.source) && (
                <SyncControl
                  action={importHistoryAction}
                  id={conn.id}
                  label="Import more history"
                  hint="Reach further back, a slice at a time, in the background. Runs below normal syncing so nothing else slows down; asking twice does nothing."
                />
              )}
            </div>
          </div>
        </section>

        <div className="mt-8 flex items-center justify-end gap-4">
          {conn.status === "disabled" ? (
            <>
              <p className="text-right text-xs text-neutral-500">
                Disconnected. Its records are hidden, not deleted &mdash; reconnecting brings them back with no
                re-import.
              </p>
              <form action={reconnectAction}>
                <input type="hidden" name="id" value={conn.id} />
                <button className="shrink-0 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
                  Reconnect
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-right text-xs text-neutral-500">
                Stops syncing and hides this connection&rsquo;s records from dashboards and flows.
                {/* Reversibility is the whole point of keeping the row, and the
                    user has to know it, or they will re-add the account and get
                    a second copy of everything instead of this one back. */}{" "}
                You can reconnect it later and the data returns.
              </p>
              <form action={disconnectAction}>
                <input type="hidden" name="id" value={conn.id} />
                <button className="shrink-0 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                  Disconnect
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function PreviewTable({ rows }: { rows: CanonicalEvent[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
        No records found yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Subject</th>
            <th className="px-3 py-2 font-medium">Occurred</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.eventId} className="border-t border-neutral-100">
              <td className="px-3 py-2">{r.eventType}</td>
              <td className="px-3 py-2 text-neutral-700">{r.subject ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-700">{new Date(r.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Guarantee-class copy (docs/DATA_MODEL.md): stated on every connection. */
const GUARANTEE_LABEL: Record<ReturnType<typeof syncGuarantee>, string> = {
  mirror: "Mirror — always matches the source",
  incremental: "Incremental — gaps reconciled by polling",
  // Source-agnostic: this map is keyed by CLASS, and naming one provider in it
  // reads as a fact about the class.
  "derived-mirror": "Provider totals — the numbers the provider reports, refreshed",
  "webhook-only": "Webhook-only — no poll backstop",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}


function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-green-100 text-green-800"
      : status === "error"
        ? "bg-red-100 text-red-800"
        : "bg-neutral-100 text-neutral-700";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

const SYNC_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  live: { label: "Live", className: "bg-green-100 text-green-800" },
  synced: { label: "Synced", className: "bg-green-100 text-green-800" },
  importing: { label: "Importing…", className: "bg-blue-100 text-blue-800" },
  outdated: { label: "Outdated", className: "bg-amber-100 text-amber-800" },
  error: { label: "Sync error", className: "bg-red-100 text-red-800" },
};

function SyncStatusBadge({ status }: { status: string }) {
  const s = SYNC_STATUS_STYLES[status] ?? { label: status, className: "bg-neutral-100 text-neutral-700" };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function SyncControl({
  action,
  id,
  label,
  hint,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  label: string;
  hint: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <button className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
        {label}
      </button>
      <p className="text-xs leading-relaxed text-neutral-500">{hint}</p>
    </form>
  );
}
