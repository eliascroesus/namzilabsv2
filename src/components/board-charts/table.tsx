"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/**
 * THE NUMBERS THEMSELVES, ROW BY ROW.
 *
 * THE ONE CLIENT MARK IN THE KIT, and only because pagination is state. Its
 * props are plain strings — every value is formatted on the way IN, where the
 * format bag lives, so the one-formatter rule never crosses the boundary and
 * this component cannot develop an opinion about how a duration reads.
 */
export function ChartTable({
  head,
  rows,
  pageSize = 8,
}: {
  head: [string, string];
  /** Pre-formatted. See above — this component formats nothing. */
  rows: Array<{ label: string; value: string }>;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const at = Math.min(page, pages - 1);
  const slice = rows.slice(at * pageSize, at * pageSize + pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto quiet-scroll">
        <Table>
          <THead>
            <TR>
              <TH>{head[0]}</TH>
              <TH className="text-right">{head[1]}</TH>
            </TR>
          </THead>
          <TBody>
            {/* Keyed by POSITION as well as label: two rows can share one —
                `bucketLabel` drops the year, so "W34" repeats across years and
                a monthly series over All time repeats "Aug 1". */}
            {slice.map((r, i) => (
              <TR key={`${r.label}-${i}`}>
                <TD className="max-w-0 truncate">{r.label}</TD>
                <TD className="tnum text-right">{r.value}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="mt-1.5 flex shrink-0 items-center justify-between">
          <span className="tnum text-tiny text-muted-foreground">
            {at * pageSize + 1}–{Math.min(rows.length, (at + 1) * pageSize)} of {rows.length}
          </span>
          <span className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
              Back
            </Button>
            <Button variant="ghost" size="sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
              Next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
