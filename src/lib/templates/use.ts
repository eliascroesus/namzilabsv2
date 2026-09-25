import type { DB } from "@/db/types";
import { recordAudit } from "@/lib/audit";
import { applySnapshot, recordTemplateUse, TemplateRefusal, type TemplateRow } from "./store";

/**
 * A TEMPLATE, TAKEN — written into a workspace, counted, and recorded.
 *
 * The one path both doors go through: "Add to this workspace" on the template's
 * page, and creating a workspace from it (at onboarding or on that page). Two
 * copies of this sequence would be two chances to forget the count or the
 * audit row on one of them.
 *
 * A DISABLED LINK IS REFUSED HERE TOO, not only on the page. The page is where
 * a visitor learns it, but the form that posts here was drawn before the author
 * turned it off, and the author's "off" has to mean off.
 *
 * THE COUNT AND THE AUDIT ROW NEVER UNDO THE COPY. The views are the person's
 * the moment the statement lands; a failed bookkeeping insert after that must
 * not report the whole act as failed, or they would press again and get it
 * twice.
 */
export async function takeTemplate(
  db: DB,
  input: { template: TemplateRow; orgId: string; userId: string; newWorkspace: boolean },
): Promise<{ viewIds: string[] }> {
  const { template, orgId, userId, newWorkspace } = input;
  if (!template.enabled || !template.snapshot) {
    throw new TemplateRefusal("This template's link has been turned off by the person who shared it.", "off");
  }
  const { viewIds } = await applySnapshot(db, orgId, template.snapshot);
  try {
    await recordTemplateUse(db, { templateId: template.id, orgId, userId, version: template.version, newWorkspace });
  } catch (e) {
    console.error("[templates] use count failed", e);
  }
  await recordAudit(db, {
    action: "template.use",
    orgId,
    actorId: userId,
    target: template.id,
    detail: { views: viewIds.length, version: template.version, newWorkspace },
  });
  return { viewIds };
}
