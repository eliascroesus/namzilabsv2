import { z } from "zod";
import { withToolContext } from "@/lib/mcp/context";
import { describe, fail, ok } from "@/lib/mcp/result";
import { listUserWorkspaces, selectWorkspace } from "@/lib/mcp/workspace";

export const listWorkspacesTool = {
  name: "list_workspaces",
  title: "List workspaces",
  description: describe("Lists the Namzilabs workspaces the signed-in person belongs to. Call this first when a tool answers with code \"workspace_required\", then call select_workspace with one id."),
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ workspaces: z.array(z.object({ id: z.string(), name: z.string() })) }),
  handler: withToolContext<Record<string, never>>("list_workspaces", { needsWorkspace: false }, async (_ctx, _args, auth) => {
    const ws = await listUserWorkspaces(auth.extra.userId);
    return ok({ workspaces: ws.map((w) => ({ id: w.orgId, name: w.name })) });
  }),
};

export const selectWorkspaceTool = {
  name: "select_workspace",
  title: "Select workspace",
  description: describe("Chooses which Namzilabs workspace this assistant reads. The choice is remembered for this assistant; other connected assistants keep their own choice."),
  inputSchema: z.object({ workspaceId: z.string().min(1) }).strict(),
  outputSchema: z.object({ workspace: z.object({ id: z.string(), name: z.string() }) }),
  handler: withToolContext<{ workspaceId: string }>("select_workspace", { needsWorkspace: false }, async (ctx, args, auth) => {
    const r = await selectWorkspace(ctx.db, auth, args.workspaceId);
    if (!r.ok) {
      // M1 (round 2 review): the switch is now checked INSIDE selectWorkspace,
      // between membership verification and the grant write — a refused
      // select must never clear an admin's Disconnect or rebind the client.
      // Same sentence withToolContext already uses for every other tool once
      // a workspace is resolved (context.ts).
      if (r.reason === "disabled") return fail("AI assistants are turned off for this workspace by its owner.");
      return fail("You are not a member of that workspace.");
    }
    const ws = await listUserWorkspaces(auth.extra.userId);
    const name = ws.find((w) => w.orgId === r.ws.orgId)?.name ?? r.ws.orgId;
    return ok({ workspace: { id: r.ws.orgId, name } });
  }),
};
