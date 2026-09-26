import { Workspace, When } from "@/components/admin/bits";
import { Card } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/admin/access";
import { adminLog } from "@/lib/admin/billing";
import { resolveOrgNames } from "@/lib/admin/org-names";

export const dynamic = "force-dynamic";

/** What each act was, in words — the action names are the closed list in `lib/audit.ts`. */
const WHAT: Record<string, string> = {
  "admin.grant": "Granted a plan",
  "admin.revoke": "Revoked a grant",
  "admin.code_create": "Created a code",
  "admin.code_toggle": "Switched a code",
  "admin.link_create": "Created a link",
  "admin.link_archive": "Archived a link",
  "admin.launch_trials": "Started launch trials",
  "billing.trial_start": "Started a trial",
  "billing.code_redeem": "Redeemed a code",
  "billing.referral_reward": "Referral reward",
};

const detailText = (d: unknown) =>
  Object.entries((d ?? {}) as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k} ${String(v)}`))
    .join(" · ");

/**
 * THE LOG — every back-office act (who, when, on what) beside the billing
 * events customers cause themselves: trials started, codes redeemed, referral
 * rewards paid or refused. A refused Stripe credit shows here as
 * `form failed`, which is the owner's cue to credit it by hand.
 */
export default async function AdminLogPage() {
  await requireStaff();
  const rows = await adminLog(200);
  const names = await resolveOrgNames(rows.map((r) => r.orgId));

  return (
    <PageContainer>
      <PageHeader title="Log" />
      {rows.length === 0 ? (
        <Card>
          <span className="text-sm text-muted-foreground">Nothing yet.</span>
        </Card>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <TR static>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Workspace</TH>
                <TH>Detail</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} static>
                  <TD className="text-muted-foreground">
                    <When at={r.at} />
                  </TD>
                  <TD>
                    {WHAT[r.action] ?? r.action}
                    <span className="block font-mono text-xs text-muted-foreground">{r.action}</span>
                  </TD>
                  <TD>{r.orgId ? <Workspace orgId={r.orgId} names={names} /> : <span className="text-muted-foreground">—</span>}</TD>
                  <TD className="text-xs text-muted-foreground">{detailText(r.detail)}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{r.actorId ? names.short(r.actorId) : "system"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}
    </PageContainer>
  );
}
