import { eq } from "drizzle-orm";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { workspaceSettings } from "@/db/schema";
import type { DB } from "@/db/types";
import { effectiveAccess, type Access, type PermissionKey } from "@/lib/permissions";
import type { McpAuth } from "@/lib/mcp/auth";
import { resolveWorkspace } from "@/lib/mcp/workspace";
import { checkRateLimit, recordCall, summarizeArgs } from "@/lib/mcp/audit";
import { fail, ok, type ToolResult } from "@/lib/mcp/result";

export type McpCallContext = {
  db: DB; orgId: string; userId: string; role?: string; access: Access; clientId: string; bindingKey: string; workspaceName: string;
};
export type ServerCtx = { authInfo?: unknown; http?: { authInfo?: unknown } };
export type ToolRun<A> = (ctx: McpCallContext, args: A, auth: McpAuth) => Promise<ToolResult>;
export type ToolHandler<A> = (args: A, serverCtx?: ServerCtx) => Promise<ToolResult>;
export type ToolOptions = {
  /** false for list_workspaces / select_workspace: token only, no workspace, no rank. */
  needsWorkspace?: boolean;
  /** Every key must hold. Default ["use_ai_assistants"]; list_sources adds "view_integrations". */
  permissions?: PermissionKey[];
  /** Tests shorten it; production is TOOL_DEADLINE_MS. */
  deadlineMs?: number;
};

export const TOOL_DEADLINE_MS = 20_000;
export const DEADLINE_SENTENCE = "That request took too long; try a narrower range or fewer groups.";
const CAUGHT_SENTENCE = "That request could not be answered right now; try again in a moment.";

const DENIED: Partial<Record<PermissionKey, string>> = {
  use_ai_assistants: "Your role in this workspace does not include AI assistants.",
  view_integrations: "Your role in this workspace does not include viewing data sources.",
};
function deniedMessage(key: PermissionKey): string {
  return DENIED[key] ?? `Your role in this workspace does not include ${key.replace(/_/g, " ")}.`;
}

/** Pre-workspace tools get an allow-all Access: there is no workspace to rank against yet. */
const NO_WORKSPACE_ACCESS: Access = { admin: false, can: () => true, canSeeMetric: () => true };

function withDeadline(p: Promise<ToolResult>, ms: number): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ToolResult>((resolve) => { timer = setTimeout(() => resolve(fail(DEADLINE_SENTENCE)), ms); });
  return Promise.race([p, late]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * The installed SDK (v2) delivers auth at `ctx.http.authInfo` — see
 * mcp-handler's migration notes ("extra.authInfo is now ctx.http?.authInfo")
 * and @modelcontextprotocol/server's `ServerContext.http` field. `ctx.authInfo`
 * is checked first only as a defensive fallback for a differently-shaped
 * transport/version, not because it is the documented shape.
 */
export function authOf(serverCtx: ServerCtx | undefined): McpAuth | undefined {
  const a = (serverCtx?.authInfo ?? serverCtx?.http?.authInfo) as McpAuth | undefined;
  return a && typeof a === "object" && a.extra && typeof a.extra.userId === "string" ? a : undefined;
}

const names = new Map<string, { at: number; name: string }>();
export async function getWorkspaceName(orgId: string): Promise<string> {
  const hit = names.get(orgId);
  if (hit && Date.now() - hit.at < 300_000) return hit.name;
  const org = await getWorkOS().organizations.getOrganization(orgId);
  names.set(orgId, { at: Date.now(), name: org.name });
  return org.name;
}

export async function assistantsEnabled(db: DB, orgId: string): Promise<boolean> {
  const [s] = await db.select({ on: workspaceSettings.aiAssistantsEnabled }).from(workspaceSettings).where(eq(workspaceSettings.orgId, orgId)).limit(1);
  return s ? s.on : true;
}

export function withToolContext<A>(tool: string, opts: ToolOptions, run: ToolRun<A>): ToolHandler<A> {
  const needsWorkspace = opts.needsWorkspace ?? true;
  const permissions = opts.permissions ?? ["use_ai_assistants"];
  const deadlineMs = opts.deadlineMs ?? TOOL_DEADLINE_MS;
  return async (args, serverCtx) => {
    const started = Date.now();
    const auth = authOf(serverCtx);
    if (!auth) return fail("Sign in again: this request carried no valid token.");
    const userId = auth.extra.userId;

    // `db` is acquired INSIDE the outer try below (getDb() itself can throw —
    // no DATABASE_URL — and that must not escape either); `finish` tolerates
    // it being unset so a throw before we ever get a handle still logs
    // instead of crashing the closure that every return path goes through.
    let db: DB | undefined;
    // Best-effort attribution for the outer catch and for a "revoked" refusal:
    // updated as soon as a workspace is actually known. Stays "" if nothing
    // ever got that far (workspace_required, not_member, or a throw before
    // resolution completed).
    let knownOrgId = "";

    /**
     * EVERY outcome from here on — success or refusal alike — is recorded and
     * logged through this ONE path (review ruling, Tasks 6-7 fix round 1): a
     * denied caller must still count toward the rate limiter and show up in
     * the audit trail, not vanish silently. A failing audit write is itself
     * surfaced (logged, flagged) rather than swallowed — a silently-broken
     * write is a silently-disabled rate limiter.
     */
    const finish = async (orgId: string, result: ToolResult): Promise<ToolResult> => {
      const text = result.content[0]?.text ?? "";
      const bytes = Buffer.byteLength(text, "utf8");
      const rows = typeof result.structuredContent?.rows === "number" ? (result.structuredContent.rows as number) : 0;
      const durationMs = Date.now() - started;
      let auditFailed = false;
      if (db) {
        try {
          await recordCall(db, {
            orgId, userId, clientId: auth.clientId, tool, argsSummary: summarizeArgs(args), rows, bytes, durationMs,
            revealContacts: Boolean((args as { revealContacts?: boolean } | undefined)?.revealContacts), error: result.isError ? text : null,
          });
        } catch (e) {
          auditFailed = true;
          console.error(`[mcp] audit write failed for ${tool}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        auditFailed = true; // no db handle at all — nothing to write against
      }
      console.log(JSON.stringify({ mcp: tool, orgId, userId, clientId: auth.clientId, durationMs, bytes, error: result.isError ? true : undefined, auditFailed: auditFailed || undefined }));
      return result;
    };

    try {
      db = getDb();

      // 1. Which workspace, and may this person use assistants there.
      let ctx: McpCallContext;
      if (needsWorkspace) {
        // Rate limit BEFORE resolution too (review ruling): workspace_required,
        // not_member and revoked are all refusals reached before any org is
        // known, and workspace_required in particular costs a WorkOS call —
        // without this, a caller stuck on any of them bypasses the limiter
        // entirely and calls WorkOS for free on every single request.
        // Per-user only (empty orgId): there is no workspace yet to count
        // against. The org-aware check below still runs after resolution.
        const preLimit = await checkRateLimit(db, { orgId: "", userId, tool });
        if (!preLimit.allowed) return finish("", fail(preLimit.reason));

        const res = await resolveWorkspace(db, auth);
        if (!res.ok) {
          if (res.reason === "workspace_required") return finish("", ok({ code: "workspace_required", message: "Choose a workspace with select_workspace before asking about metrics.", workspaces: res.workspaces ?? [] }));
          if (res.reason === "revoked") {
            // Membership WAS verified here (that's how "revoked" is reached),
            // but `Resolution`'s failure shape doesn't carry which org that
            // was — only the claim path's target is recoverable from `auth`
            // alone; the binding and single-live-grant paths don't surface
            // it. Blank there is safer than a wrong guess.
            //
            // No instruction to reconnect (amended 3 Sep 2026 after the final
            // review): the previous sentence told the assistant to call
            // select_workspace itself, which let an LLM undo an admin's
            // Disconnect on its very next turn. A member may still reconnect
            // deliberately; the permission and the workspace switch are the
            // admin-grade controls (spec, Revocation).
            return finish(auth.extra.orgIdClaim ?? "", fail("This assistant was disconnected from the workspace by a person in Settings → AI assistants."));
          }
          return finish("", fail("You are not a member of that workspace."));
        }
        const { orgId, role } = res.ws;
        knownOrgId = orgId;

        // Rate limit right after resolution, BEFORE the switch and permission
        // checks below (review ruling): a refused caller must still be
        // throttled and counted, not get an unlimited, invisible stream of
        // refusals.
        const limit = await checkRateLimit(db, { orgId, userId, tool });
        if (!limit.allowed) return finish(orgId, fail(limit.reason));

        if (!(await assistantsEnabled(db, orgId))) return finish(orgId, fail("AI assistants are turned off for this workspace by its owner."));
        const access = await effectiveAccess(db, { orgId, userId, role });
        for (const key of permissions) if (!access.can(key)) return finish(orgId, fail(deniedMessage(key)));
        ctx = { db, orgId, userId, role, access, clientId: auth.clientId, bindingKey: auth.extra.bindingKey, workspaceName: await getWorkspaceName(orgId) };
      } else {
        const limit = await checkRateLimit(db, { orgId: "", userId, tool });
        if (!limit.allowed) return finish("", fail(limit.reason));
        ctx = { db, orgId: "", userId, access: NO_WORKSPACE_ACCESS, clientId: auth.clientId, bindingKey: auth.extra.bindingKey, workspaceName: "" };
      }

      // 2. The tool itself, under a deadline.
      const result = await withDeadline(run(ctx, args, auth), deadlineMs);

      // select_workspace has no ctx.orgId; its result names the org it chose.
      const chosen = (result.structuredContent?.workspace as { id?: unknown } | undefined)?.id;
      const resultOrgId = ctx.orgId || (typeof chosen === "string" ? chosen : "");
      return await finish(resultOrgId, result);
    } catch (e) {
      console.error(`[mcp] ${tool} failed: ${e instanceof Error ? e.message : String(e)}`);
      return finish(knownOrgId, fail(CAUGHT_SENTENCE));
    }
  };
}
