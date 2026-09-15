import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusPill } from "@/components/ui/badge";
import { TableShell, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { requireStaff } from "@/lib/admin/access";
import { findWorkspaces, workspaceCard, type WorkspaceCard } from "@/lib/admin/lookup";

export const dynamic = "force-dynamic";

/**
 * LOOK UP ONE WORKSPACE OR ACCOUNT — and only on submit.
 *
 * THE WHOLE COST MODEL IS IN THE FIRST LINE OF THE BODY: with no `?q=`, this
 * page renders a form and runs no query at all. The owner's instruction was to
 * avoid a dashboard that keeps a database busy, and the way to honour that is
 * for the expensive path to be the one somebody deliberately asks for.
 *
 * A PLAIN GET FORM, not a client component with state. Submitting navigates to
 * `?q=…`, which means the browser's back button works, a result is a URL you
 * can paste into a support thread, and there is no JavaScript on the page at
 * all. The same zero-client-JS pattern the rest of this codebase uses for
 * forms.
 *
 * FIVE CARDS MAXIMUM. Each one is several queries plus two WorkOS calls, so a
 * name search matching forty workspaces renders the ids and makes you pick.
 */

const LIMIT = 5;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  );
}

function Workspace({ card }: { card: WorkspaceCard }) {
  const broken = card.connections.filter((c) => c.status === "error" || c.syncStatus === "error").length;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-md font-semibold">{card.name ?? "(name unavailable)"}</h3>
        {broken > 0 ? <StatusPill tone="danger">{broken} broken</StatusPill> : <StatusPill tone="success">healthy</StatusPill>}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{card.orgId}</p>

      <div className="border-t border-border pt-2">
        <Row label="Owner" value={card.ownerEmail ?? card.ownerUserId ?? "unknown"} />
        <Row label="Members" value={card.members === null ? "unknown" : String(card.members)} />
        <Row label="Created" value={card.claimedAt ? card.claimedAt.toISOString().slice(0, 10) : "unknown"} />
      </div>

      <div className="border-t border-border pt-2">
        <Row label="Connections" value={String(card.connections.length)} />
        <Row label="Flows" value={String(card.flows)} />
        <Row label="Metrics" value={String(card.metrics)} />
        <Row label="Board tiles" value={String(card.tiles)} />
        <Row label="Events" value={String(card.events)} />
        <Row label="AI assistants" value={String(card.aiGrants)} />
      </div>

      {card.connections.length > 0 ? (
        <div className="border-t border-border pt-2">
          <SectionHeading>Apps</SectionHeading>
          <ul className="flex flex-wrap gap-1.5">
            {card.connections.map((c, i) => (
              <li key={`${c.source}-${i}`}>
                <StatusPill tone={c.status === "error" || c.syncStatus === "error" ? "danger" : "pending"}>
                  {c.source}
                </StatusPill>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.recentGovernance.length > 0 ? (
        <div className="border-t border-border pt-2">
          <SectionHeading>Recent governance</SectionHeading>
          <ul className="space-y-1">
            {card.recentGovernance.map((g, i) => (
              <li key={`${g.action}-${i}`} className="flex justify-between gap-4 text-xs">
                <span className="font-mono">{g.action}</span>
                <span className="text-muted-foreground">{g.at.toISOString().slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff();
  const q = (await searchParams).q?.trim() ?? "";

  // NOTHING RUNS WITHOUT A TERM. This early shape is the cost model.
  const result = q ? await findWorkspaces(q) : null;
  const cards: WorkspaceCard[] = [];
  if (result) {
    for (const orgId of result.orgIds.slice(0, LIMIT)) {
      const card = await workspaceCard(orgId);
      if (card) cards.push(card);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Look up
            <InfoTip label="what you can search">
              An email finds the account and every workspace it belongs to — one request, however many customers
              exist. An org id works if you paste it. A name has to be searched the slow way, because WorkOS cannot
              filter organizations by name, so it walks up to 2,000 of them and tells you if it stopped early. Nothing
              runs until you press Search.
            </InfoTip>
          </span>
        }
      />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="email, workspace name, or org_…"
          aria-label="Search for an account or workspace"
          className="max-w-md"
        />
        <Button type="submit">Search</Button>
      </form>

      {result === null ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Search to look a workspace up. Nothing is loaded until you do.
        </p>
      ) : null}

      {result && result.note ? (
        <Card className="mt-6">
          <span className="text-sm text-muted-foreground">{result.note}</span>
        </Card>
      ) : null}

      {result && result.orgIds.length === 0 && !result.note ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing matched &ldquo;{q}&rdquo;.</p>
      ) : null}

      {cards.length > 0 ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {cards.map((card) => (
            <Workspace key={card.orgId} card={card} />
          ))}
        </div>
      ) : null}

      {result && result.orgIds.length > LIMIT ? (
        <div className="mt-6">
          <SectionHeading>{result.orgIds.length - LIMIT} more matched</SectionHeading>
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Workspace id</TH>
                </TR>
              </THead>
              <TBody>
                {result.orgIds.slice(LIMIT).map((id) => (
                  <TR key={id} static>
                    {/*
                      Ids only. Rendering a full card for each is several
                      queries and two WorkOS calls apiece — paste one back into
                      the box to open it.
                    */}
                    <TD className="font-mono text-xs">{id}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        </div>
      ) : null}
    </PageContainer>
  );
}
