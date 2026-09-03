import type { z } from "zod";
import type { ServerCtx } from "@/lib/mcp/context";
import type { ToolResult } from "@/lib/mcp/result";
import { listWorkspacesTool, selectWorkspaceTool } from "@/lib/mcp/tools/workspaces";

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export type NamzilabsTool = {
  name: string; title: string; description: string;
  inputSchema: z.ZodTypeAny; outputSchema: z.ZodTypeAny;
  /**
   * Exactly what withToolContext returns. `never` for args lets tools with
   * different argument shapes share one list; the ctx type must stay
   * `ServerCtx` (not `unknown`) or strictFunctionTypes rejects the assignment.
   */
  handler: (args: never, ctx?: ServerCtx) => Promise<ToolResult>;
};

/** Every tool the server exposes, in the order clients see them. Later tasks append here. */
export const TOOLS: NamzilabsTool[] = [listWorkspacesTool, selectWorkspaceTool];

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

export function registerNamzilabsTools(server: Registrable): void {
  for (const t of TOOLS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: READ_ONLY }, t.handler as (...a: never[]) => unknown);
  }
}
