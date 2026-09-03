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
const authed = withMcpAuth(mcp, verifyMcpToken, { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" });

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

export async function GET(req: Request) { return guarded(req) ?? authed(req); }
export async function POST(req: Request) { return guarded(req) ?? authed(req); }
