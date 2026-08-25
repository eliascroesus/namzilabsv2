import Link from "next/link";
import { Lock, Plug, X } from "lucide-react";
import { requireOrg } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getReadDb } from "@/db/client";
import { connectionImportStatuses, type ImportStatus } from "@/lib/sync/import-status";
import { AppShell } from "@/components/app-shell";
import { integrationsErrorMessage } from "./error-messages";
import { connectionRecordCounts, listConnections, webhookUrlFor } from "@/lib/connections";
import { CONNECTOR_CATALOG, catalogEntry, type ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectionRow } from "./ConnectionRow";
import { connectApiKeyAction } from "./actions";
import { eventTimeNote, readEventTime } from "@/lib/webhooks/event-time";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, NO_AUTOFILL } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { SourceMark } from "@/components/source-mark";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const { orgId, userId, role, auth } = await requireOrg();

  // The rank gate, before any connection data is even queried: a member whose
  // rank lacks "view_integrations" gets the page shell and one quiet card —
  // not a stripped list that hints at what exists. Mutations are gated again
  // in actions.ts ("connect_integrations"); this is the read wall.
  const access = await effectiveAccess(getReadDb(), { orgId, userId, role });
  if (!access.can("view_integrations")) {
    return (
      <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
        <PageContainer>
          <PageHeader title="Integrations" />
          <EmptyState
            className="mt-8"
            icon={<Lock />}
            title="Your rank doesn’t include the Apps page"
            description="Ask a workspace admin if you need to see connected apps."
          />
        </PageContainer>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const errorCode = one(sp.error);
  // `null` means the read FAILED; `[]` means there genuinely are none. Merging
  // the two rendered a database outage as "No connections yet", which reads as
  // "your integrations are gone" to the person whose integrations they are.
  const connectedOrNull = await listConnections(orgId).catch((err) => {
    console.error("[integrations] connection list read failed", err);
    return null;
  });
  const connectionsUnavailable = connectedOrNull === null;
  const connected = connectedOrNull ?? [];
  // Best-effort: a failed count must not take down the page, and the delete
  // warning falls back to naming no number rather than naming a wrong one.
  const records = await connectionRecordCounts(orgId).catch(() => ({}) as Record<string, number>);
  // "Is history still loading?" per connection, from stored state only (no
  // provider calls). Best-effort like the counts: a progress line must never
  // be the reason this page fails to render.
  const importStatuses = await connectionImportStatuses(
    getReadDb(),
    orgId,
    connected.filter((c) => c.status !== "disabled").map((c) => c.id),
  ).catch(() => new Map<string, ImportStatus>());
  // Disconnected connections still exist (their rows and data survive so they
  // can be reconnected), but they are not CONNECTED — counting them would tell
  // someone a source is live when nothing is syncing from it.
  const countBySource = connected.reduce<Record<string, number>>((acc, c) => {
    if (c.status === "disabled") return acc;
    acc[c.source] = (acc[c.source] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader
          title="Integrations"
          lede="Connect a tool and its data flows into your unified dashboard. Connect an account, then preview the latest records to confirm it’s live."
        />

        {errorCode && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-base text-danger-ink">
            <p>
              {integrationsErrorMessage(errorCode)}{" "}
              <span className="text-tiny text-danger-ink">({errorCode})</span>
            </p>
            {/* Dismissal without client JS: dropping the query param re-renders
                the page clean (this segment is force-dynamic). */}
            <Link
              href="/integrations"
              aria-label="Dismiss"
              className={cn(
                buttonVariants({ variant: "ghost", size: "iconSm" }),
                "text-danger-ink/70 hover:bg-danger-soft hover:text-danger-ink",
              )}
            >
              <X />
            </Link>
          </div>
        )}

        <section className="mt-8">
          <SectionHeading className="mb-2">Your connections</SectionHeading>
          {connectionsUnavailable ? (
            <EmptyState
              icon={<Plug />}
              title="Your connections couldn’t be loaded"
              description="This is a problem on our side — nothing has been disconnected and no data has been lost. Refresh to try again."
            />
          ) : connected.length === 0 ? (
            <EmptyState
              icon={<Plug />}
              title="No connections yet"
              description="Pick a tool below and connect an account — its records start arriving here."
            />
          ) : (
            <>
              {/* The two removal buttons keep two different promises, and this is
                  where that difference is said BEFORE anyone is inside a confirm
                  dialog: disconnect keeps everything and reverses; the trash is
                  immediate and total. Matches disableConnection /
                  deleteConnectionPermanently — if those change, change this. */}
              <p className="mb-3 text-tiny text-muted-foreground">
                Disconnecting a source pauses it and keeps all its data — reconnect any time and everything comes back.
                Deleting one (the trash icon) permanently removes it and everything synced from it, immediately.
              </p>
              <div className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-card shadow-card">
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
                        ? `${c.pausedReason ?? "Waiting before the next attempt."} Retries automatically around ${formatTime(c.pausedUntil)} — nothing is lost.`
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
                    // Shown while importing AND when an import stopped early;
                    // "done" is quiet, and "unknown" says nothing at all.
                    importNote={importStatuses.get(c.id)?.state !== "done" ? importStatuses.get(c.id)?.note : undefined}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <section className="mt-8">
          <SectionHeading>Add a connection</SectionHeading>
          {/* Three-up above `xl`, matching the dashboard's tiles and the flows
              board: one grid rhythm for the whole product. */}
          <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {CONNECTOR_CATALOG.map((entry) => (
              <ConnectorCard key={entry.source} entry={entry} connectedCount={countBySource[entry.source] ?? 0} />
            ))}
          </div>
        </section>
      </PageContainer>
    </AppShell>
  );
}

function ConnectorCard({ entry, connectedCount }: { entry: ConnectorCatalogEntry; connectedCount: number }) {
  return (
    // `surface`, like every other island in the app now — and the connector's
    // own mark in front of its name, because this grid is the one place in the
    // product where you are picking a TOOL rather than reading about one, and a
    // logo is recognised a great deal faster than a word.
    <Card variant="surface" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <SourceMark source={entry.source} size={26} className="mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{entry.name}</h3>
            <p className="mt-1 text-base text-muted-foreground">{entry.description}</p>
          </div>
        </div>
        {connectedCount > 0 && <Badge className="tnum shrink-0">{connectedCount} connected</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {entry.instant && <Badge>Instant webhook</Badge>}
        {entry.poll && <Badge>Polling</Badge>}
      </div>

      <div className="mt-4">
        {entry.connect === "google" ? (
          <a href={`/api/oauth/google/start?source=${entry.source}`} className={cn(buttonVariants())}>
            Connect with Google
          </a>
        ) : (
          <details>
            <summary className={cn(buttonVariants(), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
              Connect
            </summary>
            {/* NOTHING ON THIS FORM IS A LOGIN, and a password manager has to
                be told so in four dialects — see `NO_AUTOFILL` in ui/input.tsx.
                The masked fields get it automatically from `Input`; the name
                field asks for it here, because a text box sitting directly
                above a masked one is precisely the shape a manager reads as
                "username, password" and fills with somebody's email. */}
            <form action={connectApiKeyAction} autoComplete="off" className="mt-3 space-y-3">
              <input type="hidden" name="source" value={entry.source} />
              <div>
                <FieldLabel htmlFor={`name-${entry.source}`}>Connection name</FieldLabel>
                <Input id={`name-${entry.source}`} name="name" placeholder={entry.name} {...NO_AUTOFILL} />
              </div>
              {entry.credentialFields.map((f) => (
                <div key={f.key}>
                  <FieldLabel htmlFor={`cred-${entry.source}-${f.key}`}>{f.label}</FieldLabel>
                  {/* No `autoComplete` override here on purpose: `Input` sets
                      `new-password` for a masked field, and "off" — which this
                      call site used to pass — is the one value browsers ignore
                      on one. Passing it back re-opens the bug. */}
                  <Input
                    id={`cred-${entry.source}-${f.key}`}
                    name={`cred_${f.key}`}
                    type="password"
                    placeholder={f.placeholder ?? ""}
                  />
                </div>
              ))}
              <SubmitButton variant="secondary" pendingLabel="Saving…" className="w-full">
                Save connection
              </SubmitButton>
              {/* A source with no credentials to enter (Custom Webhook) gives no
                  clue that saving is only step one — the URL it mints is the
                  whole product, and it appears above once the row exists. */}
              {entry.credentialFields.length === 0 && entry.instant && (
                <p className="text-tiny text-muted-foreground">
                  Saving creates the inbound URL. It appears under{" "}
                  <span className="font-semibold text-foreground">Your connections</span> above — open{" "}
                  <span className="font-semibold text-foreground">Webhook URL</span> on the new row and point any app at
                  it.
                </p>
              )}
            </form>
          </details>
        )}
      </div>
    </Card>
  );
}
