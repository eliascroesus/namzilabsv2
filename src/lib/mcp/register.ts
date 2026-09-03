import type { z } from "zod";
import type { ServerCtx } from "@/lib/mcp/context";
import type { ToolResult } from "@/lib/mcp/result";
import { listWorkspacesTool, selectWorkspaceTool } from "@/lib/mcp/tools/workspaces";
import { listMetricsTool, getMetricTool, getMetricDaysTool } from "@/lib/mcp/tools/metrics";

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export type NamzilabsTool = {
  name: string; title: string; description: string;
  inputSchema: z.ZodTypeAny;
  /**
   * Documentation only — see the ruling on `registerNamzilabsTools` below for
   * why this is never handed to the SDK.
   */
  outputSchema: z.ZodTypeAny;
  /**
   * Exactly what withToolContext returns. `never` for args lets tools with
   * different argument shapes share one list; the ctx type must stay
   * `ServerCtx` (not `unknown`) or strictFunctionTypes rejects the assignment.
   */
  handler: (args: never, ctx?: ServerCtx) => Promise<ToolResult>;
};

/** Every tool the server exposes, in the order clients see them. Later tasks append here. */
export const TOOLS: NamzilabsTool[] = [listWorkspacesTool, selectWorkspaceTool, listMetricsTool, getMetricTool, getMetricDaysTool];

/**
 * A structural stand-in for the SDK's `McpServer`, so this module (and its
 * tests) need not import `@modelcontextprotocol/server` types directly. The
 * handler's parameter and return types are `any`, not `never`/`unknown`:
 * McpServer's real `registerTool` overloads return a concrete `CallToolResult`
 * shape and take a concrete `(args, ctx)` callback, and strictFunctionTypes
 * rejects a narrower `Registrable` when the real server is passed in below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Registrable = { registerTool: (name: string, config: Record<string, unknown>, handler: (...a: any[]) => any) => unknown };

/**
 * RULING (Tasks 6-7 review, fix round 1): `outputSchema` is deliberately NOT
 * forwarded to `registerTool`. The SDK validates every non-error tool result
 * against a declared outputSchema, but a pre-workspace tool can legitimately
 * answer with the `workspace_required` escape-hatch shape (`{ code, message,
 * workspaces }`) instead of its documented success shape — a shape neither
 * tool's real outputSchema can ever satisfy. Declaring it would make the SDK
 * reject that answer outright. `NamzilabsTool.outputSchema` stays on the tool
 * object purely for documentation (and for a future tool whose result shape
 * has no such escape hatch to register it for real).
 */
export function registerNamzilabsTools(server: Registrable): void {
  for (const t of TOOLS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: READ_ONLY }, t.handler as (...a: never[]) => unknown);
  }
}
