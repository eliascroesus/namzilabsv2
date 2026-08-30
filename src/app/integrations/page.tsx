import Link from "next/link";
import { Lock, X } from "lucide-react";
import { requireOrg, requestAccess } from "@/lib/auth";
import { getReadDb } from "@/db/client";
import { connectionImportStatuses, type ImportStatus } from "@/lib/sync/import-status";
import { AppShell } from "@/components/app-shell";
import { integrationsErrorMessage } from "./error-messages";
import { connectionRecordCounts, listConnections, webhookUrlFor } from "@/lib/connections";
import { CONNECTOR_CATALOG, catalogEntry, type ConnectorCatalogEntry } from "@/connectors/catalog";
import { AppDirectory, ConnectionRow, type DirectoryApp } from "./ConnectionRow";
import { connectApiKeyAction } from "./actions";
import { eventTimeNote, readEventTime } from "@/lib/webhooks/event-time";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input, NO_AUTOFILL } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
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
  const access = await requestAccess(orgId, userId, role);
  if (!access.can("view_integrations")) {
    return (
      <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
        <PageContainer>
          <PageHeader title="Apps" />
          <EmptyState
            className="mt-8"
            icon={<Lock />}
            title="Your role doesn’t include the Apps page"
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
  // The list's own head line — "3 syncing · 1 disconnected". Every row carries
  // its own state pill, but a column of eight says nothing at a glance about
  // how many are actually working, which is the question this page is opened
  // to answer. Only non-zero terms appear: "0 need attention" is noise wearing
  // the shape of a warning.
  const byStatus = (s: string) => connected.filter((c) => c.status === s).length;
  const tally = (
    [
      [byStatus("active"), "syncing"],
      [byStatus("error"), "need attention"],
      [byStatus("disabled"), "disconnected"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);

  /**
   * THE CATALOGUE, FLATTENED FOR THE GRID — AND THE CONNECT FORM WITH IT.
   *
   * The form is built HERE, on the server, and handed to the directory as a
   * slot. That is not ceremony. `connectApiKeyAction` is a server action, and
   * the masked fields are pinned by tests/no-autofill.test.ts, which reads THIS
   * file: the one part of this page that must never drift into a client bundle
   * is the part a client-side grid would otherwise have to own. The directory
   * decides WHEN the dialog holding a form is on screen; it never has to know
   * what is inside one.
   */
  const apps: DirectoryApp[] = CONNECTOR_CATALOG.map((entry) => ({
    source: entry.source,
    name: entry.name,
    description: entry.description,
    instant: entry.instant,
    poll: entry.poll,
    // Disconnected connections are deliberately not counted — see countBySource.
    connectedCount: countBySource[entry.source] ?? 0,
    // Google's connectors leave the app to connect, so there is nothing to type
    // and no dialog to open: the card links straight out to the consent screen.
    oauthHref: entry.connect === "google" ? `/api/oauth/google/start?source=${entry.source}` : undefined,
    form: entry.connect === "apiKey" ? <ConnectForm entry={entry} /> : undefined,
  }));

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* A WHITE PAGE, WITH ONE OFF-WHITE SECTION ON IT.
          Every other screen in this app sits directly on the off-white canvas,
          which works when a page is a handful of islands. A catalogue is not: it
          is a field of white cards, and on off-white a field of white cards has
          no ground under it and no figure on it — everything sits one step from
          everything. So the page takes `bg-card` and the collection gets a
          recessed band of its own (the shelf, in AppDirectory). White page,
          off-white section, white cards: three steps where there were two, which
          is what lets the cards read as objects rather than as outlines.

          `min-h-full` because the frame's own surface is the canvas colour: a
          white page that stops where its content does leaves an off-white strip
          under it that reads as a rendering fault rather than as a margin. */}
      <PageContainer className="min-h-full bg-card">
        {/* "Apps", NOT "Integrations" — the rail item is the only door to this
            page and it has always said Apps, so the page said one word and the
            way in said another. A first-time user clicking a thing called Apps
            and landing on a page called Integrations has to spend a beat
            deciding whether they went where they meant to.

            The lede stays gone. The toolbar directly under this title says what
            the page is for in controls rather than in a sentence, which is the
            one form of instruction nobody skips. */}
        <PageHeader title="Apps" />

        {errorCode && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink">
            <p>
              {integrationsErrorMessage(errorCode)}{" "}
              <span className="text-xs text-danger-ink">({errorCode})</span>
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

        {/* THE TWO SECTIONS ARE TWO VIEWS NOW.
            The page used to be your connections stacked on top of a catalogue
            of everything else, which put the thing most people come for — add
            an app — below the fold on any workspace with four connections, and
            gave the thing they come for second — fix the one that broke — no
            way to be found except by scrolling. A segment puts both one press
            apart and makes DISCOVER the view you land on.

            `key` on the error code does exactly one job. A failed connect
            redirects back here with `?error=…`, which is a soft navigation: the
            directory stays mounted, and its dialog stays OPEN on top of the
            banner explaining why the dialog failed. Re-keying remounts it
            closed the instant a code arrives. */}
        <AppDirectory
          key={errorCode || "ok"}
          apps={apps}
          connectionsUnavailable={connectionsUnavailable}
          tally={tally.join(" · ")}
          connected={connected.map((c) => ({
            id: c.id,
            name: c.name,
            source: c.source,
            row: (
              <ConnectionRow
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
            ),
          }))}
        />
      </PageContainer>
    </AppShell>
  );
}

/**
 * THE CREDENTIAL FORM — one connector's, rendered into the connect dialog.
 *
 * IT IS NO LONGER IN THE DOM UNTIL SOMEBODY ASKS FOR IT, and that is half the
 * reason for the move. Every connector's form used to live inside a collapsed
 * `<details>` on this page, so all seven were present the moment the tab
 * loaded and four password managers had seven masked fields to fill with
 * somebody's unrelated login. A dialog mounts one form when it opens and
 * unmounts it when it closes; the opt-outs below are still the belt.
 *
 * NOTHING HERE IS A LOGIN, and a password manager has to be told so in four
 * dialects — see `NO_AUTOFILL` in ui/input.tsx. The masked fields get it
 * automatically from `Input`; the name field asks for it here, because a text
 * box sitting directly above a masked one is precisely the shape a manager
 * reads as "username, password" and fills with somebody's email.
 */
function ConnectForm({ entry }: { entry: ConnectorCatalogEntry }) {
  return (
    // No tray wash and no card of its own: the dialog IS the surface, and a
    // recessed panel inside a floating one is two containers for one form.
    <form action={connectApiKeyAction} autoComplete="off" className="mt-6 space-y-4">
      <input type="hidden" name="source" value={entry.source} />
      <div>
        <FieldLabel htmlFor={`name-${entry.source}`}>Connection name</FieldLabel>
        <Input id={`name-${entry.source}`} name="name" placeholder={entry.name} {...NO_AUTOFILL} />
      </div>
      {entry.credentialFields.map((f) => (
        <div key={f.key}>
          <FieldLabel htmlFor={`cred-${entry.source}-${f.key}`}>{f.label}</FieldLabel>
          {/* No `autoComplete` override here on purpose: `Input` sets
              `new-password` for a masked field, and "off" — which this call
              site used to pass — is the one value browsers ignore on one.
              Passing it back re-opens the bug. */}
          <Input
            id={`cred-${entry.source}-${f.key}`}
            name={`cred_${f.key}`}
            type="password"
            placeholder={f.placeholder ?? ""}
          />
        </div>
      ))}
      {/* A source with no credentials to enter (Custom Webhook) gives no clue
          that saving is only step one — the URL it mints is the whole product,
          and it appears on the row this creates. It names MANAGE now, because
          that is where the row it is describing lives. */}
      {entry.credentialFields.length === 0 && entry.instant && (
        <p className="text-xs text-muted-foreground">
          Saving creates the inbound URL. Find the new connection under{" "}
          <span className="font-semibold text-foreground">Manage</span>, open{" "}
          <span className="font-semibold text-foreground">Webhook URL</span> on its row, and point any app at it.
        </p>
      )}
      {/* THE PAGE'S ONE YELLOW, and the sheet's rule for it exactly: the hero is
          the single act a screen exists for, at most once per screen. Nothing
          behind this dialog is yellow, and the seven Connect buttons in the
          catalogue must not be — seven heroes is a menu, and the accent would be
          spent on a list of choices. Here there is one button and one act, and
          it is the act the whole page exists for. Black ink, because the yellow
          is far too bright to carry white. */}
      <SubmitButton variant="yellow" pendingLabel="Connecting…" className="w-full">
        Connect {entry.name}
      </SubmitButton>
    </form>
  );
}
