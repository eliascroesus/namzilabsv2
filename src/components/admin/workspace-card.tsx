import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { SectionHeading } from "@/components/ui/page";
import type { WorkspaceCard } from "@/lib/admin/lookup";

/**
 * ONE WORKSPACE, AS STAFF SEE IT — who owns it, what it has built, what is
 * broken. Shared by the search results and the workspace's own page.
 */

export function AdminRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  );
}

/** The workspace at a glance. `link` makes its name open the workspace's own page. */
export function WorkspaceCardView({ card, link = false }: { card: WorkspaceCard; link?: boolean }) {
  const broken = card.connections.filter((c) => c.status === "error" || c.syncStatus === "error").length;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-md font-semibold">
          {link ? (
            <Link href={`/admin/workspaces/${encodeURIComponent(card.orgId)}`} className="hover:underline">
              {card.name ?? "(name unavailable)"}
            </Link>
          ) : (
            (card.name ?? "(name unavailable)")
          )}
        </h3>
        {broken > 0 ? <StatusPill tone="danger">{broken} broken</StatusPill> : <StatusPill tone="success">healthy</StatusPill>}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{card.orgId}</p>

      <div className="border-t border-border pt-2">
        <AdminRow label="Owner" value={card.ownerEmail ?? card.ownerUserId ?? "unknown"} />
        <AdminRow label="Members" value={card.members === null ? "unknown" : String(card.members)} />
        <AdminRow label="Created" value={card.claimedAt ? card.claimedAt.toISOString().slice(0, 10) : "unknown"} />
      </div>

      <div className="border-t border-border pt-2">
        <AdminRow label="Connections" value={String(card.connections.length)} />
        <AdminRow label="Flows" value={String(card.flows)} />
        <AdminRow label="Metrics" value={String(card.metrics)} />
        <AdminRow label="Board tiles" value={String(card.tiles)} />
        <AdminRow label="Events" value={String(card.events)} />
        <AdminRow label="AI assistants" value={String(card.aiGrants)} />
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
