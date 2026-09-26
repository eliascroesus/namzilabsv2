import type * as React from "react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { FunnelRow } from "@/lib/growth/links";

/**
 * THE FUNNEL, ONE ROW PER LINK OR SOURCE: clicks → sign-ups → connected an
 * app → built a metric → trial → paying. Each step shows its count and, under
 * it, what share of the step before got there — the number that says where a
 * channel leaks.
 */

type Row = FunnelRow & { key: string; name: string; sub?: string; archived?: boolean; action?: React.ReactNode };

const STEPS: Array<{ key: keyof FunnelRow; label: string }> = [
  { key: "clicks", label: "Clicks" },
  { key: "signups", label: "Sign-ups" },
  { key: "connected", label: "Connected an app" },
  { key: "metric", label: "Built a metric" },
  { key: "trials", label: "Trial" },
  { key: "paying", label: "Paying" },
];

const pct = (n: number, of: number | null) => (of == null || of === 0 ? null : `${Math.round((n / of) * 100)}%`);

export function FunnelTable({ rows, empty = "Nothing yet." }: { rows: Row[]; empty?: string }) {
  if (rows.length === 0)
    return (
      <Card>
        <span className="text-sm text-muted-foreground">{empty}</span>
      </Card>
    );
  const hasAction = rows.some((r) => r.action);
  return (
    <TableShell>
      <Table>
        <THead>
          <TR static>
            <TH>Where</TH>
            {STEPS.map((s) => (
              <TH key={s.key} className="text-right">
                {s.label}
              </TH>
            ))}
            {hasAction ? <TH /> : null}
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.key} static>
              <TD>
                <span className="font-medium text-foreground">{r.name}</span>
                {r.archived ? (
                  <StatusPill tone="pending" className="ml-2">
                    archived
                  </StatusPill>
                ) : null}
                {r.sub ? <span className="block font-mono text-xs text-muted-foreground">{r.sub}</span> : null}
              </TD>
              {STEPS.map((s, i) => {
                const v = r[s.key];
                const prev = i === 0 ? null : r[STEPS[i - 1].key];
                // Sign-ups are measured against clicks only where there were clicks to measure against.
                const share = v == null ? null : pct(v, i === 0 ? null : prev);
                return (
                  <TD key={s.key} className="text-right tabular-nums">
                    {v == null ? <span className="text-muted-foreground">—</span> : v}
                    {share ? <span className="block text-xs text-muted-foreground">{share}</span> : null}
                  </TD>
                );
              })}
              {hasAction ? <TD>{r.action}</TD> : null}
            </TR>
          ))}
        </TBody>
      </Table>
    </TableShell>
  );
}
