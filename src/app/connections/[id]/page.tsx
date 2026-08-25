import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getConnection, getSigningSecret, previewLatest, webhookUrlFor } from "@/lib/connections";
import { CopyField } from "@/components/copy-field";
import { catalogEntry, eventTypeLabel, isStreamScoped, syncGuarantee } from "@/connectors/catalog";
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
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";

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
      <PageContainer width="narrow">
        {/* The back link says "Apps", matching the page it returns to and the
            rail item that is the only way to either — a back link naming a
            title that no longer exists is a broken promise about where you
            land. */}
        <PageHeader
          back={{ href: "/integrations", label: "Apps" }}
          title={conn.name}
          lede={entry?.name ?? conn.source}
          actions={
            <>
              <ConnectionStatusPill status={conn.status} />
              {conn.status === "disabled" ? (
                <form action={reconnectAction}>
                  <input type="hidden" name="id" value={conn.id} />
                  <Button type="submit" variant="secondary">
                    Reconnect
                  </Button>
                </form>
              ) : (
                <form action={disconnectAction}>
                  <input type="hidden" name="id" value={conn.id} />
                  <Button type="submit" variant="destructiveOutline">
                    Disconnect
                  </Button>
                </form>
              )}
            </>
          }
        />

        {/* F.3/F.6: a paused connection is never a dead end — it says WHY and
            WHEN it resumes, and it retries itself with no human action. */}
        {conn.pausedUntil && new Date(conn.pausedUntil).getTime() > Date.now() ? (
          <div className="mt-4 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
            <b>Paused, retrying automatically.</b>{" "}
            {conn.pausedReason ?? "Waiting before the next attempt."} Next attempt around{" "}
            {formatTime(new Date(conn.pausedUntil))} — nothing is lost, syncing resumes on its own.
          </div>
        ) : (
          conn.lastError && (
            <div className="mt-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-base text-danger-ink">
              {conn.lastError}
            </div>
          )
        )}

        <Card variant="surface" className="mt-6">
          <dl className="grid gap-4 text-base sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Data status</dt>
              <dd className="mt-0.5">
                <SyncStatusPill status={conn.syncStatus} />
              </dd>
            </div>
            <Field
              label="Last full sync"
              value={conn.historicalSyncedAt ? formatDateTime(new Date(conn.historicalSyncedAt)) : "Never"}
            />
            <Field label="Last event" value={conn.lastEventAt ? formatDateTime(new Date(conn.lastEventAt)) : "—"} />
            <Field label="Created" value={formatDateTime(new Date(conn.createdAt))} />
            <Field label="Instant webhook" value={entry?.instant ? "Yes" : "No"} />
            <Field label="Polling / backfill" value={entry?.poll ? "Yes" : "No"} />
            <Field label="Data guarantee" value={GUARANTEE_LABEL[syncGuarantee(conn.source)]} />
          </dl>
        </Card>

        {/* A source whose class is not uniform across its streams says so here.
            The field above is one value per SOURCE, which is exact everywhere
            except Instantly — whose analytics streams are provider totals while a
            legacy per-email stream is an ordinary incremental walk. Rendering the
            source-wide value alone told a per-email user they had a guarantee
            they do not have. */}
        {entry?.syncNote && <p className="mt-2 text-tiny text-muted-foreground">{entry.syncNote}</p>}

        {/* The weaker guarantee class is stated plainly, not hidden in a tooltip:
            with no list endpoint to reconcile against, a webhook this provider
            fails to deliver (downtime, expired subscription) is not recoverable
            by polling. */}
        {syncGuarantee(conn.source) === "webhook-only" && (
          <div className="mt-4 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
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
            <SectionHeading>Configuration</SectionHeading>
            <p className="rounded-card border border-border bg-card p-4 text-base text-muted-foreground">
              This account is connected. Choose {entry.flowFields.map((f) => f.label.toLowerCase()).join(" and ")} inside each
              flow&rsquo;s <b>Get data</b> step — every flow can pull from a different one.
            </p>
          </section>
        )}

        {/* Inbound webhook URL + secret (manual providers / custom webhook) */}
        {entry?.instant && (
          <section className="mt-8">
            <SectionHeading>Inbound webhook</SectionHeading>
            {entry.webhookSetup && <p className="mb-2 text-base text-muted-foreground">{entry.webhookSetup}</p>}
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
            <div className="mb-3 flex items-center justify-between">
              <SectionHeading className="mb-0">Latest records</SectionHeading>
              <Link
                href={`/connections/${conn.id}?preview=1`}
                className="rounded-control text-base font-medium text-primary transition-colors hover:underline"
              >
                Preview latest
              </Link>
            </div>
            {preview !== "1" && (
              <p className="rounded-card border border-border bg-card p-4 text-base text-muted-foreground">
                Click &ldquo;Preview latest&rdquo; to pull the most recent records from this source.
              </p>
            )}
            {previewError && (
              <p className="rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
                {previewError}
              </p>
            )}
            {previewRows && <PreviewTable rows={previewRows} source={conn.source} />}
          </section>
        )}

        {/* Delivery issues — the dead-letter queue's door. Rendered only when
            rows exist: a healthy connection should not carry an empty "issues"
            section implying trouble. */}
        {(deadLetters.length > 0 || replay) && (
          <section className="mt-10">
            <SectionHeading>Delivery issues</SectionHeading>
            {replay === "failed" && (
              <p className="mb-3 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
                That replay failed again — the row stays here, nothing was lost. The error below is updated.
              </p>
            )}
            {replay === "ok" && (
              <p className="mb-3 rounded-card border border-success-soft bg-success-soft/50 p-4 text-base text-success-ink">
                Replayed. The payload was reprocessed from its stored raw body.
              </p>
            )}
            {deadLetters.length === 0 ? (
              <EmptyState className="p-6" title="No unresolved delivery issues" />
            ) : (
              <>
                <p className="mb-2 text-base text-muted-foreground">
                  These payloads were received and safely stored, but failed processing after every retry. Replaying
                  reprocesses the stored payload — nothing is re-fetched from the provider.
                </p>
                <TableShell>
                  <Table>
                    <THead>
                      <TR static>
                        <TH>Received</TH>
                        <TH>Error</TH>
                        <TH>Attempts</TH>
                        <TH />
                      </TR>
                    </THead>
                    <TBody>
                      {deadLetters.map((row) => (
                        <TR key={row.id}>
                          <TD
                            className="whitespace-nowrap text-muted-foreground"
                            title={formatDateTime(new Date(row.createdAt))}
                          >
                            {formatDate(new Date(row.createdAt))}
                          </TD>
                          <TD className="max-w-md text-danger-ink" title={row.error}>
                            {row.error.length > 120 ? `${row.error.slice(0, 120)}…` : row.error}
                          </TD>
                          <TD className="tnum text-muted-foreground">{row.attempts}</TD>
                          <TD className="text-right">
                            {row.rawEventId ? (
                              <form action={replayDeadLetterAction}>
                                <input type="hidden" name="connectionId" value={conn.id} />
                                <input type="hidden" name="rawEventId" value={row.rawEventId} />
                                <Button type="submit" variant="link" size="sm" className="h-auto px-0">
                                  Replay
                                </Button>
                              </form>
                            ) : (
                              // A row with no stored raw body predates raw capture
                              // for its path; there is nothing to reprocess from.
                              <span className="text-tiny text-muted-foreground" title="No stored payload to reprocess">
                                not replayable
                              </span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableShell>
              </>
            )}
          </section>
        )}

        {/* Data & sync controls */}
        <section className="mt-10">
          <SectionHeading>Data &amp; sync</SectionHeading>
          <Card variant="card" padding="compact">
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
          </Card>
        </section>

        <p className="mt-8 text-tiny text-muted-foreground">
          {conn.status === "disabled" ? (
            <>
              Disconnected. Its records are hidden, not deleted &mdash; reconnecting brings them back with no
              re-import.
            </>
          ) : (
            <>
              Disconnecting stops syncing and hides this connection&rsquo;s records from dashboards and flows.
              {/* Reversibility is the whole point of keeping the row, and the
                  user has to know it, or they will re-add the account and get
                  a second copy of everything instead of this one back. */}{" "}
              You can reconnect it later and the data returns.
            </>
          )}
        </p>
      </PageContainer>
    </AppShell>
  );
}

function PreviewTable({ rows, source }: { rows: CanonicalEvent[]; source: string }) {
  if (rows.length === 0) {
    return <EmptyState className="p-6" title="No records found yet" />;
  }
  return (
    <TableShell>
      <Table>
        <THead>
          <TR static>
            <TH>Type</TH>
            <TH>Subject</TH>
            <TH>Occurred</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.eventId} static>
              <TD title={r.eventType}>{eventTypeLabel(source, r.eventType)}</TD>
              <TD className="text-muted-foreground">{r.subject ?? "—"}</TD>
              <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(new Date(r.occurredAt))}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableShell>
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
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ConnectionStatusPill({ status }: { status: string }) {
  if (status === "active") {
    return (
      <StatusPill tone="success" dot>
        Active
      </StatusPill>
    );
  }
  if (status === "error") return <StatusPill tone="danger">Needs attention</StatusPill>;
  if (status === "disabled") return <StatusPill tone="pending">Disabled</StatusPill>;
  return <StatusPill tone="pending">{status}</StatusPill>;
}

const SYNC_STATUS: Record<string, { label: string; tone: "success" | "warn" | "danger" | "pending" }> = {
  live: { label: "Live", tone: "success" },
  synced: { label: "Synced", tone: "success" },
  importing: { label: "Importing…", tone: "pending" },
  outdated: { label: "Outdated", tone: "warn" },
  error: { label: "Sync error", tone: "danger" },
};

function SyncStatusPill({ status }: { status: string }) {
  const s = SYNC_STATUS[status] ?? { label: status, tone: "pending" as const };
  return (
    <StatusPill tone={s.tone} dot={status === "live"}>
      {s.label}
    </StatusPill>
  );
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
      <Button type="submit" variant="secondary">
        {label}
      </Button>
      <p className="text-tiny leading-relaxed text-muted-foreground">{hint}</p>
    </form>
  );
}
