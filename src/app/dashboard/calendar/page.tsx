import { CalendarDays } from "lucide-react";
import { requireOrg } from "@/lib/auth";
import { getReadDb } from "@/db/client";
import { effectiveAccess } from "@/lib/permissions";
import { calendarFlowTiles } from "@/lib/flow/materialize";
import { listFlows } from "@/lib/flow/store";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { calendarMonths, dayKey, monthLabel } from "@/lib/metrics/calendar";
import { CalendarBoard, type CalendarMetric } from "./CalendarBoard";
import type { TileSpec } from "@/lib/flow/types";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget: the "Compute now" button on this page posts to
 * `refreshFlowAction`, which runs `materializeFlow` INLINE under this segment's
 * config — a full flow compute — and the platform default (10s Hobby) kills it
 * mid-write. 60 is the Hobby ceiling; pinned by tests/timeout-budgets.test.ts.
 */
export const maxDuration = 60;

/**
 * THE CALENDAR — one published metric, broken down day by day.
 *
 * The dashboard answers "what is this number over the last 7 days"; this
 * answers "which days made it". They read the SAME stored rows: the
 * materializer computes every day of the two months this view can show at the
 * same time it computes the range pills (see `byDay` in flow/types.ts), so this
 * page is one query and no flow run — the reason changing metric or month here
 * costs nothing at all.
 *
 * RANK-GATED LIKE THE BOARD IT MIRRORS. A metric hidden from a member on the
 * dashboard must be hidden from every other way of looking at the same number,
 * or the restriction is decoration. Same key, same helper.
 */
export default async function CalendarPage() {
  const { orgId, userId, role, auth } = await requireOrg();
  const db = getReadDb(); // read-only surface: rides the DB_DRIVER_READ soak seam (B.3)
  const access = await effectiveAccess(db, { orgId, userId, role });

  // `null` means the read FAILED; `[]` means there genuinely are no published
  // metrics. Collapsing the two renders a database outage as "you have not
  // built anything yet", which is the product telling a customer their work is
  // gone — the same distinction the flows list and the dashboard both draw.
  // The narrow read: the name, the six keys that decide how a number is
  // spelled, and the day map — never the stored sample records or the
  // dashboard's own ranges. See `calendarFlowTiles`.
  const rows = await calendarFlowTiles(db, orgId).catch((err) => {
    console.error("[calendar] tile read failed", err);
    return null;
  });

  // Flow names, for the picker's hint: two flows may each publish a metric
  // called "Booked", and a dropdown with two identical rows is a coin toss.
  // Best-effort — a missing name costs a hint, never the page.
  const flowNames = new Map<string, string>();
  if (rows) {
    try {
      for (const f of await listFlows(db, orgId)) flowNames.set(f.id, f.name);
    } catch {
      // No hints rather than no calendar.
    }
  }

  const metrics: CalendarMetric[] = (rows ?? [])
    .filter((r) => access.canSeeMetric(`flow:${r.flowId}`))
    .map((r) => {
      const tile = (r.tile ?? {}) as TileSpec;
      return {
        id: `${r.flowId}:${r.outputNodeId}`,
        flowId: r.flowId,
        flowName: flowNames.get(r.flowId) ?? "Flow",
        // A row whose tile jsonb is null has never computed successfully, so
        // there is no stored name — the output id is the only honest handle.
        name: tile.name ?? `Output ${r.outputNodeId.slice(0, 8)}`,
        format: {
          format: tile.format,
          precision: tile.precision,
          unit: tile.unit,
          currency: tile.currency,
          durationDisplay: tile.durationDisplay,
        },
        days: tile.byDay ?? {},
        status: r.status,
        error: r.error,
        computedAt: r.computedAt ? new Date(r.computedAt).toISOString() : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-US"));

  // Decided on the SERVER and handed down. Every value was filed under a UTC
  // day, so a browser working out "today" from its own clock would ring the
  // wrong square for anyone east of Greenwich after 00:00 local.
  const months = calendarMonths();
  const todayKey = dayKey(new Date());

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader
          title="Calendar"
          lede={`One published metric, day by day. ${monthLabel(months[0])} and ${monthLabel(months[months.length - 1])} — dates are UTC, the same days your metrics are counted in.`}
        />
        {rows === null ? (
          <EmptyState
            className="mt-8"
            icon={<CalendarDays />}
            title="Your metrics couldn’t be loaded"
            description="This is a problem on our side — nothing has been deleted and no number has changed. Refresh to try again."
          />
        ) : (
          <CalendarBoard metrics={metrics} months={months} todayKey={todayKey} />
        )}
      </PageContainer>
    </AppShell>
  );
}
