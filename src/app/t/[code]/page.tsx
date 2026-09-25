import type { Metadata } from "next";
import { cache } from "react";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { getReadDb } from "@/db/client";
import { getPublicTemplate, TemplatesUnavailable, type TemplateRow } from "@/lib/templates/store";
import { TemplateLanding, TemplateUnavailable, type TemplateViewer } from "../landing";

export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/t/<code>` — A SHARED TEMPLATE, AND THE ONE DOOR INTO IT.
 *
 * Public: a coach sends this link to students who have no account yet, and the
 * page has to do the whole job for them — show what they are getting, then get
 * them into a workspace built from it. So it is auth-AWARE rather than
 * auth-gated (`src/proxy.ts` runs AuthKit on it but does not protect it), and
 * the call to action is whichever of three is true of the visitor:
 *
 *   signed out            → "Use this template", which remembers the choice
 *                           and goes to sign-up, which comes back here.
 *   signed in, no space   → name a workspace and create it from this.
 *   signed in, in one     → add it to the workspace they are in, or make a
 *                           new one from it.
 *
 * NOTHING HERE READS THE AUTHOR'S WORKSPACE. The page draws the stored
 * snapshot and prints the author's chosen name; see `workspace_templates` in
 * the schema for why that boundary is the whole safety argument.
 *
 * NOT INDEXED. A template link is unlisted, like a Notion page shared by link:
 * the coach decides who gets it, and a search engine is not on that list.
 */
/**
 * ONE READ PER REQUEST, not two: `generateMetadata` and the page both need the
 * template, and `cache()` makes the second ask the first one's answer.
 */
const load = cache(async (raw: string): Promise<{ template: TemplateRow | null; unavailable: boolean }> => {
  try {
    return { template: await getPublicTemplate(getReadDb(), raw), unavailable: false };
  } catch (e) {
    if (e instanceof TemplatesUnavailable) return { template: null, unavailable: true };
    throw e;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  const { template } = await load(code);
  const live = template?.enabled && template.snapshot;
  return {
    title: live ? `${template.name} · a Namzilabs template` : "Template · Namzilabs",
    description: live ? (template.description ?? "A dashboard layout, shared on Namzilabs.") : undefined,
    robots: { index: false, follow: false },
  };
}

/** Errors arrive as CODES — see `src/app/t/actions.ts` for why never as text. */
const ERRORS: Record<string, string> = {
  rank: "Your role in this workspace doesn't allow adding views. Ask a workspace admin, or start a new workspace from it.",
  limit:
    "This workspace doesn't have room for this template's views. Delete a view or two first, or start a new workspace from it.",
  groups: "This template's columns would take this workspace past its limit of groups. Delete a few first, or start a new workspace from it.",
  name: "You already have a workspace with that name. Pick another name for the new one, or add the template to that workspace from here.",
  off: "The person who shared this template has turned its link off.",
  failed: "Something went wrong adding it. Nothing was changed — try again in a moment.",
};

export default async function TemplatePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ code: raw }, sp] = await Promise.all([params, searchParams]);
  const { template, unavailable } = await load(raw);

  if (!template || !template.enabled || !template.snapshot) return <TemplateUnavailable unavailable={unavailable} />;

  const auth = await withAuth();
  const orgId = auth.user ? (auth.organizationId ?? null) : null;
  const viewer: TemplateViewer = !auth.user
    ? { kind: "signedOut" }
    : !orgId
      ? { kind: "noWorkspace" }
      : {
          kind: "inWorkspace",
          mine: orgId === template.orgId,
          workspaceName: await getWorkOS()
            .organizations.getOrganization(orgId)
            .then((o) => o.name)
            .catch(() => null),
        };
  const error = ERRORS[Array.isArray(sp.error) ? (sp.error[0] ?? "") : (sp.error ?? "")] ?? null;

  return (
    <TemplateLanding
      template={{
        code: template.code,
        name: template.name,
        description: template.description,
        authorName: template.authorName,
        snapshot: template.snapshot,
      }}
      viewer={viewer}
      error={error}
    />
  );
}
