import { TemplateLanding, TemplateUnavailable, type TemplateViewer } from "@/app/t/landing";
import { SNAPSHOT } from "../fixtures";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/t/<code>` AS A STRANGER SEES IT, without a template row or a session —
 * `?viewer=out|new|in|mine|gone` picks which call to action is drawn, and
 * `?error=limit` draws the refusal banner. The page is the one surface of the
 * feature a student meets before they have an account, so it is the one most
 * worth photographing before it ships.
 */
export default async function TemplateLandingDesign({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const which = one(sp.viewer) || "out";
  if (which === "gone") return <TemplateUnavailable unavailable={false} />;
  const viewer: TemplateViewer =
    which === "new"
      ? { kind: "noWorkspace" }
      : which === "in" || which === "mine"
        ? { kind: "inWorkspace", workspaceName: "Sam's agency", mine: which === "mine" }
        : { kind: "signedOut" };
  return (
    <TemplateLanding
      template={{
        code: "K7M2Q9XA3B",
        name: "Agency scorecard",
        description: "The numbers we review every Monday, laid out the way the course teaches them.",
        authorName: "Casey Coach",
        snapshot: SNAPSHOT,
      }}
      viewer={viewer}
      error={one(sp.error) === "limit" ? "This workspace doesn't have room for this template's views. Delete a view or two first, or start a new workspace from it." : null}
    />
  );
}
