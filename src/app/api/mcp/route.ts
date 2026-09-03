import { NextResponse } from "next/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { mcpEnabled, mcpResourceUrl } from "@/lib/mcp/env";
import { verifyMcpToken } from "@/lib/mcp/auth";
import { registerNamzilabsTools } from "@/lib/mcp/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Same budget and reasoning as src/app/api/replay/route.ts. */
export const maxDuration = 60;

const mcp = createMcpHandler((server) => registerNamzilabsTools(server), { serverInfo: { name: "namzilabs", version: "1" } });

/**
 * Built lazily, on first use, and memoized after that — never at module
 * import. `withMcpAuth` needs `resourceUrl` (below) so its 401 challenge
 * names THIS resource even behind a proxy or a preview alias, rather than
 * whatever `Request.url`/forwarding headers happen to say; but computing it
 * calls `mcpResourceUrl()`, which THROWS when neither MCP_RESOURCE_URL nor
 * APP_BASE_URL is set. A deploy that hasn't configured MCP yet must still
 * import this route cleanly and answer 404 via `guarded()` below — not crash
 * the moment the module loads.
 */
let authed: ((req: Request) => Promise<Response>) | undefined;
function authedHandler(): (req: Request) => Promise<Response> {
  if (!authed) {
    authed = withMcpAuth(mcp, verifyMcpToken, {
      required: true,
      resourceMetadataPath: "/.well-known/oauth-protected-resource",
      resourceUrl: new URL(mcpResourceUrl()).origin,
    });
  }
  return authed;
}

/**
 * Off = 404, not 401: a deploy before WorkOS is configured must expose nothing.
 * A browser Origin that is not this app is refused (DNS-rebinding rule from the
 * transport spec); assistants send no Origin.
 */
function guarded(req: Request): Response | null {
  if (!mcpEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(mcpResourceUrl()).origin) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  return null;
}

export async function GET(req: Request) { return guarded(req) ?? authedHandler()(req); }
export async function POST(req: Request) { return guarded(req) ?? authedHandler()(req); }
