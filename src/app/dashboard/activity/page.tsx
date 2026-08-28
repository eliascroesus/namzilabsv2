import Link from "next/link";
import { Radio } from "lucide-react";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { connections, events } from "@/db/schema";
import { unresolvedDeadLetterCountsByConnection } from "@/lib/dead-letter";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SourceMark } from "@/components/source-mark";
import { connectedSources } from "@/lib/metrics/compute";
import { catalogEntry, eventTypeLabel } from "@/connectors/catalog";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

/**
 * How many rows the feed shows. Fifty rather than the six it had on the
 * dashboard, and the increase is the reason this page exists rather than a
 * cost it carries: six rows was never a feed, it was a liveness indicator
 * squeezed into the bottom of a board.
 *
 * The five columns below are ~100 bytes a row, so the whole page is about 5KB
 * of egress — and it is paid ONCE, when somebody opens this route, instead of
 * on every dashboard render.
 */
const FEED_ROWS = 50;

/**
 * WORKSPACE ACTIVITY — what has arrived, and what failed to.
 *
 * THIS USED TO BE A CARD AT THE FOOT OF THE DASHBOARD, and it was in the wrong
 * place twice over. For the reader, it sat under the metric tiles competing
 * with them for the same glance while answering an entirely different question
 * — the board is "what do my numbers say", this is "is data still coming in".
 * For the server, it meant two queries on the most-rendered page in the
 * product: `FreshnessPoller` calls `router.refresh()` on every results-version
 * change, so the dashboard re-runs its whole component tree, feed and all, for
 * every viewer whose data moved.
 *
 * On its own route both problems go away at once. The dashboard is down two
 * queries per render, and this page — which nobody opens on a loop — can
 * afford to show fifty rows and a filter.
 *
 * DELIBERATELY NO `FreshnessPoller`. A feed is the one surface where a poller
 * looks obviously right and is obviously wrong: it would re-run the read on a
 * timer for anyone who left the tab open, which is exactly the cost this move
 * just removed from the dashboard. The rows are timestamped and the browser
 * has a reload button.
 *
 * NOT RANK-GATED, matching the card it replaces exactly. Event rows are not
 * metric tiles, so `canSeeMetric` has nothing to say about them, and the
 * connection pages the dead-letter counts link to are org-scoped rather than
 * rank-gated — so this page shows no member anything a link on the old
 * dashboard did not already reach.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, auth } = await requireOrg();
  const db = getReadDb(); // read-only surface: rides the DB_DRIVER_READ soak seam (B.3)

  const source = one(sp.source) || null;

  // `null` means the read FAILED; `[]` means nothing has arrived yet. The two
  // are drawn differently everywhere in this product, because collapsing them
  // renders a database outage as "you have no data" — which reads as "your
  // data is gone" to the person whose data it is.
  let rows: Array<{ id: string; source: string; eventType: string; subject: string | null; occurredAt: Date }> | null =
    null;
  let sources: string[] = [];
  let dlqByConnection: Array<{ connectionId: string; name: string; count: number }> = [];
  let connCount = 0;

  try {
    [rows, sources, dlqByConnection, connCount] = await Promise.all([
      /**
       * FIVE COLUMNS, NOT SEVENTEEN. The feed renders source, type, subject and
       * a timestamp; a bare `select()` also carries `properties` — the whole
       * provider record, 5–30KB for a Close event log entry and up to 50KB for
       * an Instantly email — to display none of it. At fifty rows that is the
       * difference between 5KB and something north of a megabyte.
       *
       * Live rows only: every events read filters `deleted_at` (the query
       * convention in src/db/schema.ts). `receivedAt` ordering is right for a
       * feed — "when did this reach us", not "when did it happen" — and the two
       * genuinely differ for a backfill.
       */
      db
        .select({
          id: events.id,
          source: events.source,
          eventType: events.eventType,
          subject: events.subject,
          occurredAt: events.occurredAt,
        })
        .from(events)
        .where(
          and(
            eq(events.orgId, orgId),
            isNull(events.deletedAt),
            // The filter is part of the WHERE rather than a slice of the
            // result: filtering after the limit would show "no Close events"
            // to a workspace whose last fifty rows happened to be Calendly's.
            ...(source ? [eq(events.source, source)] : []),
          ),
        )
        .orderBy(desc(events.receivedAt))
        .limit(FEED_ROWS),
      // The apps this workspace has CONNECTED, not the ones its history
      // mentions — a tens-of-rows table rather than a heap scan of `events`
      // for a picker that never holds more than about six items. Same helper
      // and same reasoning as the dashboard's source filter.
      connectedSources(db, orgId),
      // Per-connection, not a scalar: each red number links to the page that
      // hosts the Replay button, instead of being a dead end.
      unresolvedDeadLetterCountsByConnection(db, orgId),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(connections)
        .where(eq(connections.orgId, orgId))
        .then((r) => Number(r[0]?.c ?? 0)),
    ]);
  } catch (err) {
    // The exception goes to the log, never to the page: this read can fail with
    // schema internals and occasionally a connection string in its message.
    console.error("[activity] feed read failed", err);
    rows = null;
  }

  const qs = (nextSource: string) => (nextSource ? `/dashboard/activity?source=${encodeURIComponent(nextSource)}` : "/dashboard/activity");
  const activeSourceLabel = source ? (catalogEntry(source)?.name ?? source) : "All sources";
  // Render the Subject column only when some row has one to show. A column of
  // em-dashes is not information, and most sources carry no subject.
  const hasSubjects = (rows ?? []).some((e) => e.subject);

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader title="Activity" />

        {/* The filter island, the same object the dashboard and the flows board
            put their own controls in — and now with the same THING inside it.
            It was a <details> popover: one grey summary button hiding six
            options, on a page whose entire chrome is that one control. A
            workspace has at most a handful of connected apps, so every answer
            fits on the bar, and a row of chips says what the filter can do
            without being opened. Same recipe as `ui/chip.tsx` — see FilterChip
            for why this cannot BE that component. */}
        {sources.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-1.5 rounded-surface border border-border bg-card p-2 shadow-card">
            <FilterChip href={qs("")} active={!source} label="All sources" />
            {/* The connector's own name, not its storage key — this row used to
                read "gsheets" while every other screen says "Google Sheets". */}
            {sources.map((srcName) => (
              <FilterChip
                key={srcName}
                href={qs(srcName)}
                active={source === srcName}
                label={catalogEntry(srcName)?.name ?? srcName}
                source={srcName}
              />
            ))}
          </div>
        )}

        {rows === null ? (
          <EmptyState
            className="mt-8"
            icon={<Radio />}
            title="Your activity couldn’t be loaded"
            description="This is a problem on our side — nothing has stopped syncing and no data has been lost. Refresh to try again."
          />
        ) : (
          /* ONE SURFACE, HEADER AND ALL. The connection summary is the table's
             own head rather than a caption floating above it: on the warm canvas
             a heading sitting on the page beside a white table reads as a
             caption that lost its card. */
          <Card variant="surface" padding="none" className="mt-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-foreground/5 px-4 py-3">
              {/* `text-xs` rather than the `text-micro` alias — same 12px, and
                  the alias is the legacy spelling each surface drops as it is
                  rebuilt. */}
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {source ? `${activeSourceLabel} · last ${FEED_ROWS}` : `Last ${FEED_ROWS} records`}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {connCount} connection{connCount === 1 ? "" : "s"}
                </span>
                {/* A FAILURE COUNT IS A STATE, so it wears the danger trio as a
                    pill rather than as red words inside a grey sentence — this
                    is the one thing in this head that can need the user, and it
                    was set at the same weight as "3 connections". Still a link,
                    to the page that hosts the Replay button. */}
                {dlqByConnection.length > 0
                  ? dlqByConnection.map((d) => (
                      <Link key={d.connectionId} href={`/connections/${d.connectionId}`} className="rounded-full">
                        <StatusPill tone="danger" className="tnum">
                          {d.count} in dead-letter · {d.name}
                        </StatusPill>
                      </Link>
                    ))
                  : "· no failures"}
              </span>
            </div>
            {rows.length === 0 ? (
              // THE LINK VIOLET, not the fill violet: `--primary` is brand-500,
              // 4.42:1 on the page and under AA, and the sheet is explicit that
              // the 500 fills while the 700 (`accent-foreground`) speaks.
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {source ? (
                  <>
                    Nothing from {activeSourceLabel} yet.{" "}
                    <Link href={qs("")} className="font-semibold text-accent-foreground hover:underline">
                      Show all sources
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    No events ingested yet.{" "}
                    <Link href="/integrations" className="font-semibold text-accent-foreground hover:underline">
                      Connect a source
                    </Link>
                    .
                  </>
                )}
              </p>
            ) : (
              // The Card is the shell, so the table needs only its own
              // horizontal scroller — a TableShell here would draw a second
              // border and a second radius inside the first.
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <TH>Source</TH>
                      <TH>Type</TH>
                      {hasSubjects && <TH>Subject</TH>}
                      <TH className="text-right">Occurred</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {/* Humanised the way the builder's own pickers do it —
                        "Close CRM · Lead created", not "close · lead_created".
                        The raw type rides along in the title attribute, because
                        it IS what a Filter step matches on. */}
                    {rows.map((e) => (
                      <TR key={e.id} static>
                        <TD>
                          {/* The mark is the column's information — the word
                              beside it is the caption. So the name carries the
                              weight and the row reads by colour first, which is
                              the only way a fifty-row feed is scannable at all. */}
                          <span className="flex items-center gap-2.5">
                            <SourceMark source={e.source} size={22} />
                            <span className="truncate font-medium text-foreground">
                              {catalogEntry(e.source)?.name ?? e.source}
                            </span>
                          </span>
                        </TD>
                        {/* The event type is a CATEGORY, not prose, and it is
                            drawn from a closed set — so it wears the quiet pill
                            the kit keeps for facts, the way a select column
                            reads in any database view. Grey text in a grey
                            column made it indistinguishable from the subject
                            beside it. The raw type stays in the title, because
                            it IS what a Filter step matches on. */}
                        <TD title={e.eventType}>
                          <Badge>{eventTypeLabel(e.source, e.eventType)}</Badge>
                        </TD>
                        {hasSubjects && <TD className="text-muted-foreground">{e.subject ?? "—"}</TD>}
                        <TD className="whitespace-nowrap text-right text-muted-foreground">
                          {formatDateTime(new Date(e.occurredAt))}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>
        )}
      </PageContainer>
    </AppShell>
  );
}

/**
 * ONE OPTION OF THE SOURCE FILTER, WORN AS A CHIP.
 *
 * It is `ui/chip.tsx`'s recipe — h-8, `rounded-full`, 12px semibold ALL CAPS
 * with `tracking-wide`, violet FILL when selected — and it deliberately is not
 * that component: `Chip` is a `<button>` in a client component, and this filter
 * lives in the URL. Every option here has to be a real `<a>` so the page stays
 * server-rendered, shareable and back-button-correct, which is also why the
 * control it replaced was a hand-rolled `<details>` rather than a `<select>`.
 *
 * The FILL is the vibrant violet doing its one job on this sheet — marking
 * SELECTION — and the off state hovers to the violet TINT rather than to
 * `bg-muted`, because `--muted` and the page are the same colour and a hover
 * you cannot see is the same as not having one.
 */
function FilterChip({
  href,
  active,
  label,
  source,
}: {
  href: string;
  active: boolean;
  label: string;
  /** Present on every chip but "All sources" — the connector's own mark. */
  source?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3.5 text-xs font-semibold uppercase tracking-wide transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        active
          ? "bg-primary text-primary-foreground hover:bg-brand-600"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {source && <SourceMark source={source} size={16} />}
      {label}
    </Link>
  );
}
