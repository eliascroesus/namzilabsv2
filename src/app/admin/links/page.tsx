import { archiveLinkAction, createLinkAction } from "@/app/admin/actions";
import { FunnelTable } from "@/components/admin/funnel-table";
import { CopyField } from "@/components/copy-field";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireStaff } from "@/lib/admin/access";
import { growthFunnel } from "@/lib/admin/billing";
import { LINK_ERRORS, normaliseSlug, type LinkError } from "@/lib/growth/links";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
const base = () => (process.env.APP_BASE_URL ?? "https://namzilabs.co").replace(/\/$/, "");

/**
 * TRACKING LINKS — one per place you post (Instagram bio, a Facebook ad, a
 * YouTube description), each at `namzilabs.co/go/<slug>`. Each row is its own
 * funnel: clicks, the workspaces made after one, and how far they got. The
 * table under it adds the links up by source, beside everyone who arrived
 * without one (Direct).
 */
export default async function AdminLinksPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const funnel = await growthFunnel();
  const made = one(sp.done) === "create" ? normaliseSlug(one(sp.slug)) : null;
  const errorKey = one(sp.error);
  const error = Object.hasOwn(LINK_ERRORS, errorKey) ? LINK_ERRORS[errorKey as LinkError] : null;

  return (
    <PageContainer>
      <PageHeader title="Links" />

      {error && (
        <p role="alert" className="mb-6 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink">
          {error}
        </p>
      )}
      {made && (
        <div role="status" className="mb-6 flex flex-col gap-2 rounded-card border border-success-soft bg-success-soft/50 p-4 text-sm text-success-ink">
          <p>The link is live. Post it wherever this source is.</p>
          <CopyField value={`${base()}/go/${made}`} label="Tracking link" isUrl />
        </div>
      )}

      <section>
        <SectionHeading>New link</SectionHeading>
        <Card>
          <form action={createLinkAction} className="grid gap-4 sm:grid-cols-3">
            <div>
              <FieldLabel htmlFor="label">Name</FieldLabel>
              <Input id="label" name="label" required placeholder="Instagram bio" maxLength={80} />
            </div>
            <div>
              <FieldLabel htmlFor="slug">Slug (namzilabs.co/go/…)</FieldLabel>
              <Input id="slug" name="slug" required placeholder="ig-bio" maxLength={48} />
            </div>
            <div>
              <FieldLabel htmlFor="destination">Sends them to</FieldLabel>
              <Input id="destination" name="destination" defaultValue="/" placeholder="/ or /pricing" maxLength={200} />
            </div>
            <div>
              <FieldLabel htmlFor="source">Source</FieldLabel>
              <Input id="source" name="source" required placeholder="instagram" list="link-sources" maxLength={40} />
              <datalist id="link-sources">
                {["instagram", "facebook", "tiktok", "youtube", "x", "linkedin", "newsletter", "podcast", "google"].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <FieldLabel htmlFor="medium">Medium</FieldLabel>
              <Input id="medium" name="medium" required placeholder="social" list="link-mediums" maxLength={40} />
              <datalist id="link-mediums">
                {["social", "paid", "email", "video", "referral", "organic"].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <FieldLabel htmlFor="campaign">Campaign (optional)</FieldLabel>
              <Input id="campaign" name="campaign" placeholder="launch" maxLength={40} />
            </div>
            <div className="sm:col-span-3">
              <SubmitButton pendingLabel="Creating…">Create link</SubmitButton>
            </div>
          </form>
        </Card>
      </section>

      <section className="mt-8">
        <SectionHeading>By source</SectionHeading>
        <FunnelTable rows={funnel.sources.map((r) => ({ key: r.source, name: r.source === "direct" ? "Direct (no link)" : r.source, ...r }))} />
      </section>

      <section className="mt-8">
        <SectionHeading>By link</SectionHeading>
        <FunnelTable
          rows={funnel.links.map((r) => ({
            key: r.linkId,
            name: r.label,
            sub: `/go/${r.slug} · ${r.source} / ${r.medium}${r.campaign ? ` / ${r.campaign}` : ""}`,
            ...r,
            action: r.archived ? null : (
              <form action={archiveLinkAction}>
                <input type="hidden" name="linkId" value={r.linkId} />
                <SubmitButton variant="ghost" size="sm" pendingLabel="Archiving…">
                  Archive
                </SubmitButton>
              </form>
            ),
          }))}
          empty="No links yet — make one above and post it."
        />
      </section>
    </PageContainer>
  );
}
