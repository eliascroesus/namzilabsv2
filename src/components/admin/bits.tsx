import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OrgNames } from "@/lib/admin/org-names";

/**
 * The overview's small parts, in one file because they only make sense
 * together: a page of fleet numbers is a page of the same four shapes repeated,
 * and repeating them by hand is how two tables end up printing a workspace two
 * different ways.
 */

const num = new Intl.NumberFormat("en-GB");

/**
 * A WORKSPACE, NAMED, AND CLICKABLE.
 *
 * Both halves are the point. The name is what makes the row mean something; the
 * link is what makes the page a place you act from rather than a place you copy
 * ids out of. Every workspace on this panel now goes one click to its own
 * record in Look up.
 *
 * The id stays underneath in mono, small — it is what you paste into WorkOS or
 * a support thread, and dropping it entirely would trade one kind of uselessness
 * for another.
 */
export function Workspace({ orgId, names }: { orgId: string | null; names: OrgNames }) {
  if (!orgId) return <span className="text-muted-foreground">—</span>;
  const name = names.get(orgId);
  return (
    <Link href={`/admin/search?q=${encodeURIComponent(orgId)}`} className="group inline-flex flex-col gap-0.5">
      <span className="text-sm font-medium text-foreground group-hover:underline">
        {/* A workspace whose name would not resolve is almost always one that
            has been deleted — the audit log outlives the tenant, deliberately.
            Saying so beats printing a bare id and letting the reader wonder. */}
        {name ?? <span className="text-muted-foreground">Deleted or unavailable</span>}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{names.short(orgId)}</span>
    </Link>
  );
}

/**
 * A timestamp a person can read at a glance.
 *
 * The page was printing `2026-09-16 11:39` into a narrow column, which wrapped
 * onto three lines and still needed arithmetic to be useful. What an operator
 * actually wants from a governance log is "how long ago", with the exact moment
 * available when it matters — so that is the order they are in.
 */
export function When({ at }: { at: Date | null }) {
  if (!at) return <span className="text-muted-foreground">never</span>;
  const mins = Math.floor((Date.now() - at.getTime()) / 60_000);
  const rel =
    mins < 1 ? "just now"
    : mins < 60 ? `${mins}m ago`
    : mins < 60 * 24 ? `${Math.floor(mins / 60)}h ago`
    : `${Math.floor(mins / 1440)}d ago`;
  return (
    <span className="whitespace-nowrap" title={at.toISOString()}>
      {rel}
    </span>
  );
}

/**
 * THE FOUR NUMBERS THAT MATTER, and then the rest.
 *
 * Eight identical tiles is a wall, not a hierarchy — every figure shouting at
 * the same volume means the reader picks whichever is left-most. Workspaces,
 * people, connections and flows are the health of the business; board tiles and
 * referrals are detail. So the first four are cards with room, and the rest are
 * a quiet strip underneath.
 */
export function PrimaryStat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <Card className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="stat-numeral text-display-sm font-semibold leading-none tabular-nums">{num.format(value)}</span>
      {hint ? (
        <span className={cn("text-xs", tone === "warn" ? "font-medium text-warn-ink" : "text-muted-foreground")}>{hint}</span>
      ) : null}
    </Card>
  );
}

/** The detail figures: same information, a tenth of the volume. */
export function MinorStats({ items }: { items: Array<{ label: string; value: number; hint?: string }> }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-8 gap-y-3">
      {items.map((s) => (
        <div key={s.label} className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums">{num.format(s.value)}</span>
          <span className="text-xs text-muted-foreground">{s.label}</span>
        </div>
      ))}
    </Card>
  );
}
