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

/** mcp-handler documents `ctx.http?.authInfo`; the server package types `ctx.authInfo`. Read whichever is set. */
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

async function assistantsEnabled(db: DB, orgId: string): Promise<boolean> {
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
    const db = getDb();
    const userId = auth.extra.userId;

    // 1. Which workspace, and may this person use assistants there.
    let ctx: McpCallContext;
    if (needsWorkspace) {
      const res = await resolveWorkspace(db, auth);
      if (!res.ok) {
        if (res.reason === "workspace_required") return ok({ code: "workspace_required", message: "Choose a workspace with select_workspace before asking about metrics.", workspaces: res.workspaces ?? [] });
        if (res.reason === "revoked") return fail("This assistant was disconnected from the workspace. Call select_workspace to reconnect it, or ask an owner in Settings → AI assistants.");
        return fail("You are not a member of that workspace.");
      }
      const { orgId, role } = res.ws;
      if (!(await assistantsEnabled(db, orgId))) return fail("AI assistants are turned off for this workspace by its owner.");
      const access = await effectiveAccess(db, { orgId, userId, role });
      for (const key of permissions) if (!access.can(key)) return fail(deniedMessage(key));
      ctx = { db, orgId, userId, role, access, clientId: auth.clientId, bindingKey: auth.extra.bindingKey, workspaceName: await getWorkspaceName(orgId) };
    } else {
      ctx = { db, orgId: "", userId, access: NO_WORKSPACE_ACCESS, clientId: auth.clientId, bindingKey: auth.extra.bindingKey, workspaceName: "" };
    }

    // 2. Limits, then the tool under a deadline; nothing thrown ever leaves.
    const limit = await checkRateLimit(db, { orgId: ctx.orgId, userId, tool });
    if (!limit.allowed) return fail(limit.reason);
    let result: ToolResult;
    try {
      result = await withDeadline(run(ctx, args, auth), deadlineMs);
    } catch (e) {
      result = fail("That request could not be answered right now; try again in a moment.");
      console.error(`[mcp] ${tool} failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. One audit row and one log line. select_workspace has no ctx.orgId; its result names the org.
    const text = result.content[0]?.text ?? "";
    const chosen = (result.structuredContent?.workspace as { id?: unknown } | undefined)?.id;
    const orgId = ctx.orgId || (typeof chosen === "string" ? chosen : "");
    const rows = typeof result.structuredContent?.rows === "number" ? (result.structuredContent.rows as number) : 0;
    const durationMs = Date.now() - started;
    await recordCall(db, {
      orgId, userId, clientId: auth.clientId, tool, argsSummary: summarizeArgs(args), rows, bytes: text.length, durationMs,
      revealContacts: Boolean((args as { revealContacts?: boolean } | undefined)?.revealContacts), error: result.isError ? text : null,
    }).catch(() => {});
    console.log(JSON.stringify({ mcp: tool, orgId, userId, clientId: auth.clientId, durationMs, bytes: text.length, error: result.isError ? true : undefined }));
    return result;
  };
}
