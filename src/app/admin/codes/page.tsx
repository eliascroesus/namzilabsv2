import { createCodeAction, toggleCodeAction } from "@/app/admin/actions";
import { CopyField } from "@/components/copy-field";
import { StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/admin/access";
import { listCodes, type CodeRow } from "@/lib/admin/billing";
import { PLANS, isPaidPlan } from "@/lib/billing/plans";
import { normaliseCode } from "@/lib/billing/state";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
const base = () => (process.env.APP_BASE_URL ?? "https://namzilabs.co").replace(/\/$/, "");

const ERRORS: Record<string, string> = {
  code: "A code is 3–32 letters, numbers, dashes or underscores.",
  plan: "Choose Growth or Scale.",
  duration: "Choose how long the code gives.",
  cap: "The cap is a whole number from 1 to 100,000.",
  date: "The redeem-by date has to be in the future.",
  taken: "That code already exists.",
};

function state(c: CodeRow, now: Date): { label: string; tone: "success" | "pending" | "danger" | "warn" } {
  if (c.disabledAt) return { label: "off", tone: "danger" };
  if (c.redeemBy && c.redeemBy.getTime() <= now.getTime()) return { label: "expired", tone: "pending" };
  if (c.maxRedemptions != null && c.redeemed >= c.maxRedemptions) return { label: "used up", tone: "warn" };
  return { label: "live", tone: "success" };
}

/**
 * ACCESS CODES — free Growth or Scale for some months or for life. Shared as
 * `namzilabs.co/p/CODE` (applied to the workspace the visitor makes, or at
 * once if they are signed in) or typed into the plan picker. One use per
 * workspace; switching a code off stops new redemptions and keeps the rest.
 */
export default async function AdminCodesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const codes = await listCodes();
  const now = new Date();
  // Only a well-formed code is echoed back — nothing arbitrary from a URL is printed here.
  const made = one(sp.done) === "create" ? (normaliseCode(one(sp.code)) ?? "") : "";
  const error = Object.hasOwn(ERRORS, one(sp.error)) ? ERRORS[one(sp.error)] : null;

  return (
    <PageContainer>
      <PageHeader title="Codes" />

      {error && (
        <p role="alert" className="mb-6 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink">
          {error}
        </p>
      )}
      {made && (
        <div role="status" className="mb-6 flex flex-col gap-2 rounded-card border border-success-soft bg-success-soft/50 p-4 text-sm text-success-ink">
          <p>
            <b>{made}</b> is live. Share the link, or give them the code to type in.
          </p>
          <CopyField value={`${base()}/p/${made}`} label="Share link" isUrl />
        </div>
      )}

      <section>
        <SectionHeading>New code</SectionHeading>
        <Card>
          <form action={createCodeAction} className="grid gap-4 sm:grid-cols-3">
            <div>
              <FieldLabel htmlFor="code">Code</FieldLabel>
              <Input id="code" name="code" required placeholder="STUDENTS30" className="uppercase placeholder:normal-case" maxLength={32} />
            </div>
            <div>
              <FieldLabel htmlFor="plan">Plan</FieldLabel>
              <NativeSelect id="plan" name="plan" defaultValue="growth">
                <option value="growth">Growth</option>
                <option value="scale">Scale</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel htmlFor="duration">Free for</FieldLabel>
              <NativeSelect id="duration" name="duration" defaultValue="3">
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
                <option value="24">24 months</option>
                <option value="lifetime">For life</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel htmlFor="maxRedemptions">Most uses (optional)</FieldLabel>
              <Input id="maxRedemptions" name="maxRedemptions" type="number" min={1} max={100000} placeholder="No limit" />
            </div>
            <div>
              <FieldLabel htmlFor="redeemBy">Redeem by (optional)</FieldLabel>
              <Input id="redeemBy" name="redeemBy" type="date" />
            </div>
            <div>
              <FieldLabel htmlFor="note">Note (optional)</FieldLabel>
              <Input id="note" name="note" placeholder="Who it's for" maxLength={200} />
            </div>
            <div className="sm:col-span-3">
              <SubmitButton pendingLabel="Creating…">Create code</SubmitButton>
            </div>
          </form>
        </Card>
      </section>

      <section className="mt-8">
        <SectionHeading>All codes</SectionHeading>
        {codes.length === 0 ? (
          <Card>
            <span className="text-sm text-muted-foreground">No codes yet.</span>
          </Card>
        ) : (
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Code</TH>
                  <TH>Gives</TH>
                  <TH>Used</TH>
                  <TH>Redeem by</TH>
                  <TH>State</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {codes.map((c) => {
                  const s = state(c, now);
                  return (
                    <TR key={c.id} static>
                      <TD>
                        <span className="font-mono text-sm">{c.code}</span>
                        {c.note ? <span className="block max-w-56 truncate text-xs text-muted-foreground">{c.note}</span> : null}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {isPaidPlan(c.plan) ? PLANS[c.plan].name : c.plan}, {c.months == null ? "for life" : `${c.months} ${c.months === 1 ? "month" : "months"}`}
                      </TD>
                      <TD className="tabular-nums">
                        {c.redeemed}
                        {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ""}
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{c.redeemBy ? c.redeemBy.toISOString().slice(0, 10) : "—"}</TD>
                      <TD>
                        <StatusPill tone={s.tone}>{s.label}</StatusPill>
                      </TD>
                      <TD>
                        <form action={toggleCodeAction}>
                          <input type="hidden" name="codeId" value={c.id} />
                          <input type="hidden" name="disable" value={c.disabledAt ? "0" : "1"} />
                          <SubmitButton variant="ghost" size="sm" pendingLabel="Saving…">
                            {c.disabledAt ? "Switch on" : "Switch off"}
                          </SubmitButton>
                        </form>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableShell>
        )}
      </section>
    </PageContainer>
  );
}
